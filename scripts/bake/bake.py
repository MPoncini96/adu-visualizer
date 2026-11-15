# Bakes the light in one ADU plan with Blender's Cycles renderer (run by scripts/bake-lighting.mjs).
#   python3 scripts/bake/bake.py -- <scene.glb> <out-basename> <atlas-size> [samples]
# Needs the Blender Python module: pip install bpy  (Blender 5.x; no Blender app required).
#
# The scene comes from the tour engine (lib/tourEngine.js exportBakeScene): meshes named bake_*
# carry a lightmap UV layout (second UV map); occ_* meshes only block and bounce light.
# Light: the Poly Haven "Noon Grass" sky (CC0) with the sun clamped, because the sun itself is
# drawn live in the tour (it turns with the house on the lot). The result is irradiance only (no
# surface color): the tour multiplies it by each surface's own textures.
import bpy, sys, os, json, math
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out_base, size = argv[0], argv[1], int(argv[2])
samples = int(argv[3]) if len(argv) > 3 else 256
rects = json.load(open(argv[4])) if len(argv) > 4 else None  # [x, y, w, h] per patch, from the tour engine
here = os.path.dirname(os.path.abspath(__file__))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 0
scene.cycles.transmission_bounces = 0
scene.cycles.sample_clamp_indirect = 8.0
scene.render.threads_mode = "AUTO"

# sky
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
nt = world.node_tree
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(here, "sky.hdr"))
bg = nt.nodes.get("Background") or nt.nodes.new("ShaderNodeBackground")
nt.links.new(env.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0
out = nt.nodes.get("World Output") or nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

# surface albedos (what light bounces off): painted walls, oak floor, grass...
ALBEDO = {
    "bake_walls": (0.78, 0.76, 0.72), "bake_trim": (0.86, 0.86, 0.84), "bake_floor": (0.48, 0.36, 0.24),
    "bake_tile": (0.75, 0.74, 0.72), "bake_ceiling": (0.86, 0.86, 0.84),
    "occ_furniture": (0.42, 0.38, 0.34), "occ_detail": (0.62, 0.6, 0.57), "occ_exterior": (0.6, 0.6, 0.6),
    "occ_fence": (0.36, 0.27, 0.19), "occ_ground": (0.11, 0.15, 0.06),
}
img = bpy.data.images.new("lightmap", size, size, float_buffer=True, alpha=False)

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
        t.image = img
        n.active = t
        t.select = True
    return m

targets = []
for ob in list(scene.objects):
    if ob.type != "MESH":
        continue
    base = ob.name.split(".")[0]
    name = base if base in ALBEDO else (ob.data.materials[0].name.split(".")[0] if ob.data.materials else base)
    bake = name.startswith("bake_")
    ob.data.materials.clear()
    ob.data.materials.append(material(name, bake))
    if bake:
        uvs = ob.data.uv_layers
        if len(uvs) < 2:
            raise SystemExit(f"{ob.name}: no lightmap UVs")
        uvs.active = uvs[1]
        targets.append(ob)

bpy.ops.object.select_all(action="DESELECT")
for ob in targets:
    ob.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
print(f"baking {len(targets)} meshes into {size}x{size}, {samples} samples", flush=True)
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES")

px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)[..., :3]
# Denoise: sky and bounce light on a flat patch change slowly, so smooth each patch on its own
# (a separable Gaussian inside the rectangle, edges clamped), which removes sampling noise
# without bleeding light across neighbouring patches.
def gauss1d(sig):
    r = max(1, int(sig * 2.5)); x = np.arange(-r, r + 1, dtype=np.float32); k = np.exp(-x * x / (2 * sig * sig)); return k / k.sum(), r
def smooth(a, sig):
    k, r = gauss1d(sig)
    for axis in (0, 1):
        pad = [(0, 0)] * 3; pad[axis] = (r, r)
        ap = np.pad(a, pad, mode="edge")
        a = sum(k[i] * np.take(ap, range(i, i + a.shape[axis]), axis=axis) for i in range(len(k)))
    return a
blur = px.copy()
if rects:
    for x, y, w, h in rects:
        x, y, w, h = int(x), int(y), int(w), int(h)
        if w < 2 or h < 2: continue
        sig = max(0.8, min(3.0, min(w, h) / 6))
        sm = smooth(px[y:y + h, x:x + w], sig)
        # re-extend the smoothed edges into the 3-texel padding so filtering at seams stays clean
        P = 3; y0, y1, x0, x1 = max(0, y - P), min(size, y + h + P), max(0, x - P), min(size, x + w + P)
        blur[y0:y1, x0:x1] = np.pad(sm, ((y - y0, y1 - y - h), (x - x0, x1 - x - w), (0, 0)), mode="edge")
lit = blur[blur.max(-1) > 1e-5]
scale = float(np.percentile(lit, 99.5)) / 0.92 if lit.size else 1.0
lin = np.clip(blur / scale, 0, 1)
enc = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)  # sRGB: more precision in the shadows

o = bpy.data.images.new("out", size, size, alpha=False)
a = np.ones((size, size, 4), np.float32)
a[..., :3] = enc
o.pixels = a.ravel()
o.filepath_raw = out_base + ".png"
o.file_format = "PNG"
o.save()
with open(out_base + ".scale.json", "w") as f:
    json.dump({"scale": scale, "intensity": scale * math.pi, "samples": samples, "size": size}, f)
print("done", out_base, "scale", scale, flush=True)
