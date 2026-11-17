# Bakes the light in one ADU plan into a lightmap with Blender Cycles.
#
#   blender -b --python scripts/blender/bake_lightmaps.py -- \
#       --in <plan.glb> --out <plan_baked.glb> --hdri public/hdri/noon_grass_1k.hdr --size 1024 \
#       [--samples 256 --rects rects.json --sun-dir x,y,z --denoise oidn|blur|none]
#
# or, without the Blender app, with the Blender Python module (pip install bpy):
#   python3 scripts/blender/bake_lightmaps.py -- --in ... (same arguments)
#
# Targets Blender 4.2+ / 5.x (tested with bpy 5.3). Normally run for you by `npm run bake`
# (scripts/bake-lighting.mjs), which exports each plan's static geometry from the tour engine.
#
# Input glTF (from lib/tourEngine.js exportBakeScene; any glTF works with the naming below):
#   bake_<name>    static architecture to bake (walls, trim, floor, tile, ceiling). If it has a second
#                  UV map (TEXCOORD_1) that layout is kept (the tour's atlas, lib/lightmap.js); if not,
#                  one is made with Smart UV Project (one atlas shared by every bake_ mesh).
#   occ_<name>     only blocks and bounces light (furniture, exterior, fence, ground).
#   portal_glass   window glass: turned into Cycles light portals (less noise from the sky through
#                  windows), not rendered.
#
# Light: the HDRI as the world, with its sun clamped out (the tour draws the sun live, because its
# patches move with the house's heading on the lot; baking it would double it). Sky + bounce light
# + furniture contact shadows end up in the lightmap. With --sun-dir, a second pass adds only the
# sun's bounce light (a sun lamp carrying the energy the clamp removed), so rooms aren't sky-blue.
#
# Output:
#   <out>.glb                    the bake targets with UV2 and the lightmap as their emissive
#                                texture (for inspection in any glTF viewer; the app doesn't load it)
#   <lightmap> (default <out>.png)   irradiance only, no surface color (DIFFUSE direct+indirect), sRGB-encoded,
#                                scaled so the brightest 0.5% reach ~0.92; the scale is in:
#   <lightmap>.json              {"scale", "intensity" (= scale*pi, for three.js lightMapIntensity), ...}
import bpy, sys, os, json, math, argparse, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser(prog="bake_lightmaps.py")
ap.add_argument("--in", dest="inp", required=True, help="plan glTF/glb exported from the tour")
ap.add_argument("--out", required=True, help="baked .glb to write (the lightmap goes next to it)")
ap.add_argument("--hdri", required=True, help="equirectangular .hdr/.exr for the sky")
ap.add_argument("--size", type=int, default=1024, help="lightmap size in px (square)")
ap.add_argument("--samples", type=int, default=256)
ap.add_argument("--lightmap", help="lightmap PNG path (default: <out without .glb>.png)")
ap.add_argument("--rects", help="JSON [[x,y,w,h],...] atlas patches in px (keeps denoise inside each patch)")
ap.add_argument("--sun-clamp", type=float, default=0, help="clamp HDRI radiance to this (0 = automatic)")
ap.add_argument("--denoise", choices=["oidn", "blur", "none"], default="oidn")
ap.add_argument("--margin", type=int, default=4, help="bake margin in px")
ap.add_argument("--no-glb", action="store_true", help="skip writing the baked .glb")
ap.add_argument("--sun-dir", help="x,y,z direction TO the sun in glTF axes (Y up); adds the sun's bounce light")
ap.add_argument("--sun-samples", type=int, default=0, help="samples for the sun-bounce pass (default: same as --samples)")
ap.add_argument("--threads", type=int, default=0, help="CPU threads (0 = all)")
args = ap.parse_args(argv)
size = args.size
out_glb = args.out
lm_path = args.lightmap or os.path.splitext(out_glb)[0] + ".png"
rects = json.load(open(args.rects)) if args.rects else None
t0 = time.time()
def log(*a): print("[bake]", *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.inp))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = args.samples
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 0
scene.cycles.transmission_bounces = 0
scene.cycles.sample_clamp_indirect = 8.0
if args.threads or os.cpu_count():
    scene.render.threads_mode = "FIXED"
    scene.render.threads = args.threads or os.cpu_count()

# ---------------------------------------------------------------- sky (HDRI with the sun clamped)
hdri = bpy.data.images.load(os.path.abspath(args.hdri))
clamp = args.sun_clamp
if clamp <= 0:
    px = np.array(hdri.pixels[:], dtype=np.float32).reshape(-1, 4)[:, :3]
    lum = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # the sun is a tiny, extremely bright spot: clamp a bit above the bright sky around it
    clamp = float(max(np.percentile(lum, 99.5) * 2.0, 1.0))
    log(f"HDRI {hdri.size[0]}x{hdri.size[1]}, max {lum.max():.0f}, clamp {clamp:.2f}")
# the sun's energy that the clamp removes: irradiance E = sum((L - clamp) * solid angle), per channel
W, H = hdri.size
pix = np.array(hdri.pixels[:], dtype=np.float32).reshape(H, W, 4)[..., :3]
dw = (2 * math.pi / W) * (math.pi / H) * np.cos((np.arange(H) + 0.5) / H * math.pi - math.pi / 2)[:, None, None]
sun_rgb = (np.clip(pix - clamp, 0, None) * dw).sum((0, 1))
del pix
log(f"clamped-out sun irradiance {sun_rgb.round(2).tolist()}")
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
nt = world.node_tree
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = hdri
mn = nt.nodes.new("ShaderNodeVectorMath")
mn.operation = "MINIMUM"
mn.inputs[1].default_value = (clamp, clamp, clamp)
bg = nt.nodes.get("Background") or nt.nodes.new("ShaderNodeBackground")
nt.links.new(env.outputs["Color"], mn.inputs[0])
nt.links.new(mn.outputs["Vector"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0
wo = nt.nodes.get("World Output") or nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(bg.outputs["Background"], wo.inputs["Surface"])

# ---------------------------------------------------------------- materials (plain diffuse albedos)
ALBEDO = {
    "bake_walls": (0.78, 0.76, 0.72), "bake_trim": (0.86, 0.86, 0.84), "bake_floor": (0.48, 0.36, 0.24),
    "bake_tile": (0.75, 0.74, 0.72), "bake_ceiling": (0.86, 0.86, 0.84),
    "occ_furniture": (0.42, 0.38, 0.34), "occ_detail": (0.62, 0.6, 0.57), "occ_exterior": (0.6, 0.6, 0.6),
    "occ_fence": (0.36, 0.27, 0.19), "occ_ground": (0.11, 0.15, 0.06),
}
lm = bpy.data.images.new("lightmap", size, size, float_buffer=True, alpha=False)

def material(name, bake):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    for k in list(n):
        n.remove(k)
    bsdf = n.new("ShaderNodeBsdfDiffuse")
    bsdf.inputs["Color"].default_value = (*ALBEDO.get(name, (0.5, 0.5, 0.5)), 1)
    o = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(bsdf.outputs["BSDF"], o.inputs["Surface"])
    if bake:
        t = n.new("ShaderNodeTexImage")
        t.image = lm
        n.active = t
        t.select = True
    return m

def base_name(ob):
    b = ob.name.split(".")[0]
    if b.startswith(("bake_", "occ_", "portal_")):
        return b
    return ob.data.materials[0].name.split(".")[0] if ob.data.materials else b

# ---------------------------------------------------------------- window portals
portals = [ob for ob in scene.objects if ob.type == "MESH" and base_name(ob).startswith("portal_")]
targets, center = [], None
bake_obs = [ob for ob in scene.objects if ob.type == "MESH" and base_name(ob).startswith("bake_")]
if not bake_obs:
    raise SystemExit("no bake_* meshes in the input")
allv = np.concatenate([np.array([ob.matrix_world @ v.co for v in ob.data.vertices]) for ob in bake_obs])
center = (allv.min(0) + allv.max(0)) / 2
n_portals = 0
for ob in portals:
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
for ob in [o for o in scene.objects if o.type == "MESH" and base_name(o).startswith("portal_")]:
    v = np.array([ob.matrix_world @ p.co for p in ob.data.vertices])
    lo, hi = v.min(0), v.max(0)
    ext = hi - lo
    thin = int(np.argmin(ext))  # the glass pane's normal axis
    if ext[thin] > 0.2 or sorted(ext)[1] < 0.05:
        bpy.data.objects.remove(ob); continue
    c = (lo + hi) / 2
    if thin == 2:  # horizontal glass (a skylight): not used by these plans
        bpy.data.objects.remove(ob); continue
    # Blender is Z-up after the glTF import. An area light shines along its local -Z: point that
    # into the house; local Y follows world up, so size = pane width, size_y = pane height.
    inward = Vector((0.0, 0.0, 0.0)); inward[thin] = 1.0 if center[thin] > c[thin] else -1.0
    light = bpy.data.lights.new(f"portal{n_portals}", "AREA")
    light.shape = "RECTANGLE"
    light.size, light.size_y = float(ext[1 - thin]) * 1.05, float(ext[2]) * 1.05
    light.cycles.is_portal = True
    lo_ = bpy.data.objects.new(light.name, light)
    scene.collection.objects.link(lo_)
    lo_.location = Vector(c.tolist())
    lo_.rotation_euler = (-inward).to_track_quat("Z", "Y").to_euler()
    bpy.data.objects.remove(ob)
    n_portals += 1
log(f"{n_portals} window portals")

# ---------------------------------------------------------------- bake targets + UV2
need_uv = []
for ob in list(scene.objects):
    if ob.type != "MESH":
        continue
    name = base_name(ob)
    bake = name.startswith("bake_")
    ob.data.materials.clear()
    ob.data.materials.append(material(name, bake))
    if bake:
        uvs = ob.data.uv_layers
        if len(uvs) >= 2:
            uvs.active = uvs[1]
        else:
            if not len(uvs):
                uvs.new(name="UVMap")
            uvs.active = uvs.new(name="Lightmap")
            need_uv.append(ob)
        targets.append(ob)
if need_uv:
    # no atlas came with the model: one Smart UV Project over all the bake targets, with a margin
    log(f"Smart UV Project on {len(need_uv)} meshes")
    bpy.ops.object.select_all(action="DESELECT")
    for ob in need_uv:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = need_uv[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=max(0.002, 2 * args.margin / size), area_weight=1.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    rects = None  # patch rectangles only exist for the tour's own atlas

bpy.ops.object.select_all(action="DESELECT")
for ob in targets:
    ob.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
def bake(passes):
    bpy.ops.object.bake(type="DIFFUSE", pass_filter=passes, margin=args.margin, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES")
    return np.array(lm.pixels[:], dtype=np.float32).reshape(size, size, 4)[..., :3].copy()
log(f"baking {len(targets)} meshes into {size}x{size}: sky, {args.samples} samples")
px = bake({"DIRECT", "INDIRECT"})
log(f"sky baked in {time.time() - t0:.0f} s")
sun_note = None
if args.sun_dir and sun_rgb.max() > 0:
    # Pass 2: the sun's BOUNCE light only (its direct light is drawn live in the tour). Sky off, a sun
    # lamp with the energy the clamp removed, from the tour's sun direction. Warms the rooms the way
    # sunlit floors do; without it the bake is sky-blue.
    gx, gy, gz = (float(v) for v in args.sun_dir.split(","))
    d = Vector((gx, -gz, gy)).normalized()  # glTF (Y up) -> Blender (Z up)
    bg.inputs["Strength"].default_value = 0.0
    for o in scene.objects:
        if o.type == "LIGHT" and o.data.type == "AREA": o.data.cycles.is_portal = False; o.hide_render = True
    sun = bpy.data.lights.new("sun", "SUN")
    strength = float(sun_rgb.max())
    sun.energy = strength
    sun.color = tuple(float(c) / strength for c in sun_rgb)
    sun.angle = math.radians(0.53)
    so = bpy.data.objects.new("sun", sun); scene.collection.objects.link(so)
    so.rotation_euler = d.to_track_quat("Z", "Y").to_euler()  # a sun shines along its local -Z
    scene.cycles.samples = args.sun_samples or args.samples
    # a sun's bounce light is spiky (small sunlit spots light whole rooms): clamp fireflies harder,
    # relative to the sun's strength, or the denoiser turns them into blotches
    scene.cycles.sample_clamp_indirect = max(0.5, 0.25 * strength)
    t1 = time.time()
    px = px + bake({"INDIRECT"})
    sun_note = {"dir": [gx, gy, gz], "irradiance": sun_rgb.round(3).tolist(), "samples": scene.cycles.samples}
    log(f"sun bounce baked in {time.time() - t1:.0f} s")
    bpy.data.objects.remove(so)
    bg.inputs["Strength"].default_value = 1.0
    scene.cycles.sample_clamp_indirect = 8.0

# ---------------------------------------------------------------- denoise
def oidn(a):
    """Open Image Denoise through the compositor's Denoise node (Blender 5.x node-group API, 4.x fallback)."""
    src = bpy.data.images.new("noisy", size, size, float_buffer=True, alpha=False)
    buf = np.ones((size, size, 4), np.float32); buf[..., :3] = a
    src.pixels = buf.ravel()
    sc = bpy.data.scenes.new("denoise")
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.engine = "CYCLES"; sc.cycles.samples = 1
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    tmp = os.path.splitext(lm_path)[0] + ".denoise.exr"
    sc.render.filepath = tmp
    if hasattr(sc, "compositing_node_group"):  # Blender 5.x
        ng = bpy.data.node_groups.new("denoise", "CompositorNodeTree")
        sc.compositing_node_group = ng
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out = ng.nodes.new("NodeGroupOutput")
    else:  # Blender 4.x
        sc.use_nodes = True
        ng = sc.node_tree
        for k in list(ng.nodes): ng.nodes.remove(k)
        out = ng.nodes.new("CompositorNodeComposite")
    im = ng.nodes.new("CompositorNodeImage"); im.image = src
    dn = ng.nodes.new("CompositorNodeDenoise")
    if "HDR" in dn.inputs: dn.inputs["HDR"].default_value = True
    elif hasattr(dn, "use_hdr"): dn.use_hdr = True
    ng.links.new(im.outputs["Image"], dn.inputs["Image"])
    ng.links.new(dn.outputs["Image"], out.inputs[0])
    with bpy.context.temp_override(scene=sc):
        bpy.ops.render.render(write_still=True, scene=sc.name)
    res = bpy.data.images.load(tmp)
    d = np.array(res.pixels[:], dtype=np.float32).reshape(size, size, 4)[..., :3].copy()
    try: os.remove(tmp)
    except OSError: pass
    return d

def gauss1d(sig):
    r = max(1, int(sig * 2.5)); x = np.arange(-r, r + 1, dtype=np.float32); k = np.exp(-x * x / (2 * sig * sig)); return k / k.sum(), r
def smooth(a, sig):
    k, r = gauss1d(sig)
    for axis in (0, 1):
        pad = [(0, 0)] * 3; pad[axis] = (r, r)
        ap_ = np.pad(a, pad, mode="edge")
        a = sum(k[i] * np.take(ap_, range(i, i + a.shape[axis]), axis=axis) for i in range(len(k)))
    return a

if args.denoise == "oidn":
    try:
        px = oidn(px)
        log("denoised (OIDN)")
    except Exception as e:  # e.g. a Blender build without OIDN
        log("OIDN failed, falling back to blur:", e)
        args.denoise = "blur"
if rects:
    # keep each patch self-contained: blur (if asked) inside the rectangle, then re-extend its edges
    # into the 3-texel padding so texture filtering at seams never picks up a neighbour's light
    res = px.copy()
    for x, y, w, h in rects:
        x, y, w, h = int(x), int(y), int(w), int(h)
        if w < 1 or h < 1: continue
        patch = px[y:y + h, x:x + w]
        # OIDN can't tell noise from detail in strips a few texels wide (trim, casings): blur those
        small = min(w, h) < 24
        if (args.denoise == "blur" or (args.denoise == "oidn" and small)) and w >= 2 and h >= 2:
            patch = smooth(patch, max(0.8, min(3.0, min(w, h) / 6)) if args.denoise == "blur" else max(1.0, min(4.0, max(w, h) / 10)))
        P = 3; y0, y1, x0, x1 = max(0, y - P), min(size, y + h + P), max(0, x - P), min(size, x + w + P)
        res[y0:y1, x0:x1] = np.pad(patch, ((y - y0, y1 - y - h), (x - x0, x1 - x - w), (0, 0)), mode="edge")
    px = res

# ---------------------------------------------------------------- encode + save
lit = px[px.max(-1) > 1e-5]
scale = float(np.percentile(lit, 99.5)) / 0.92 if lit.size else 1.0
lin = np.clip(px / scale, 0, 1)
enc = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)  # sRGB: more precision in the shadows
o = bpy.data.images.new("out", size, size, alpha=False)
a = np.ones((size, size, 4), np.float32); a[..., :3] = enc
o.pixels = a.ravel()
o.filepath_raw = lm_path
o.file_format = "PNG"
o.save()
meta = {"scale": scale, "intensity": scale * math.pi, "samples": args.samples, "size": size, "denoise": args.denoise,
        "portals": n_portals, "sun_clamp": clamp, "sun_bounce": sun_note, "hdri": os.path.basename(args.hdri), "blender": bpy.app.version_string,
        "seconds": round(time.time() - t0)}
json.dump(meta, open(lm_path + ".json", "w"), indent=1)
log("lightmap", lm_path, f"scale {scale:.4f}")

# ---------------------------------------------------------------- baked glb (UV2 kept)
if not args.no_glb:
    lmi = bpy.data.images.load(lm_path)
    for ob in list(scene.objects):
        if ob.type == "MESH" and ob not in targets:
            bpy.data.objects.remove(ob)
        elif ob.type == "LIGHT":
            bpy.data.objects.remove(ob)
    for ob in targets:
        m = bpy.data.materials.new(base_name(ob) + "_baked"); m.use_nodes = True
        nn = m.node_tree.nodes
        for k in list(nn): nn.remove(k)
        bsdf = nn.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = (*ALBEDO.get(base_name(ob), (0.5, 0.5, 0.5)), 1)
        tex = nn.new("ShaderNodeTexImage"); tex.image = lmi
        uvn = nn.new("ShaderNodeUVMap"); uvn.uv_map = ob.data.uv_layers.active.name
        m.node_tree.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
        o_ = nn.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(bsdf.outputs["BSDF"], o_.inputs["Surface"])
        ob.data.materials.clear(); ob.data.materials.append(m)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(out_glb), export_format="GLB", use_selection=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_lights=False, export_cameras=False)
    log("glb", out_glb)
log(f"done in {time.time() - t0:.0f} s")
