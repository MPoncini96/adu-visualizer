"""Builds public/models/furniture-kit.glb from Kenney's Furniture Kit 2.0 (CC0).

Source: the RoomFit mirror of Kenney Furniture Kit 2.0 (USDZ inside JSON packs):
  https://github.com/age0110/roomfit-furniture-packs  (original: https://kenney.nl/assets/furniture-kit)
Run (one-off; the output GLB is committed):
  pip install usd-core
  git clone --depth 1 https://github.com/age0110/roomfit-furniture-packs /tmp/rf
  python scripts/build-furniture.py /tmp/rf/packs/kenney-v1 public/models/furniture-kit.glb

Each kept item becomes one node (named by key below) with vertex colours, Y-up, centred on X/Z,
resting on Y=0, at Kenney's native size. The tour scales each piece to real-world dimensions.
"""
import base64, json, os, struct, sys, tempfile

from pxr import Usd, UsdGeom, UsdShade, Gf

PICK = {
    "bedDouble": "Bed double", "bedSingle": "Bed single", "nightstand": "Cabinet bed drawer",
    "dresser": "Side table drawers", "sofa": "Lounge sofa", "armchair": "Lounge chair",
    "coffeeTable": "Table coffee", "tvStand": "Cabinet television", "tv": "Television modern",
    "diningTable": "Table", "chair": "Chair cushion", "stool": "Stool bar",
    "fridge": "Kitchen fridge large", "range": "Kitchen stove", "sink": "Kitchen sink",
    "cabinet": "Kitchen cabinet drawer", "upper": "Kitchen cabinet upper", "hood": "Hood modern",
    "microwave": "Kitchen microwave", "toilet": "Toilet", "vanity": "Bathroom sink square",
    "bathtub": "Bathtub", "shower": "Shower", "mirror": "Bathroom mirror",
    "washerDryer": "Washer dryer stacked", "rug": "Rug rectangle", "rugRound": "Rug round",
    "plant": "Potted plant", "floorLamp": "Lamp round floor", "tableLamp": "Lamp square table",
    "bookcase": "Bookcase open", "desk": "Desk", "deskChair": "Chair desk",
}


def load_assets(pack_dir):
    by_name = {}
    for f in sorted(os.listdir(pack_dir)):
        if f.endswith(".json"):
            for a in json.load(open(os.path.join(pack_dir, f)))["assets"]:
                by_name[a["asset"]["name"]] = a
    return by_name


def mesh_data(usdz_bytes):
    tmp = tempfile.NamedTemporaryFile(suffix=".usdz", delete=False)
    tmp.write(usdz_bytes); tmp.close()
    stage = Usd.Stage.Open(tmp.name)
    verts = {}  # (pos, nrm, col) -> index
    pos, nrm, col, idx = [], [], [], []
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        m = UsdGeom.Mesh(prim)
        xf = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        pts = m.GetPointsAttr().Get()
        counts = m.GetFaceVertexCountsAttr().Get()
        fvi = m.GetFaceVertexIndicesAttr().Get()
        normals = m.GetNormalsAttr().Get()
        interp = m.GetNormalsInterpolation()
        mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
        c = (0.8, 0.8, 0.8)
        if mat:
            for sh in Usd.PrimRange(mat.GetPrim()):
                if sh.GetTypeName() == "Shader":
                    v = UsdShade.Shader(sh).GetInput("diffuseColor")
                    if v and v.Get() is not None:
                        c = tuple(v.Get())
        c = tuple(round(x, 3) for x in c)
        k = 0
        for n_ in counts:
            face = []
            for j in range(n_):
                pi = fvi[k + j]
                p = xf.Transform(Gf.Vec3d(*pts[pi]))
                if normals is not None and len(normals):
                    nv = normals[k + j] if interp == "faceVarying" else normals[pi]
                    nn = xf.TransformDir(Gf.Vec3d(*nv)).GetNormalized()
                else:
                    nn = Gf.Vec3d(0, 1, 0)
                key = (tuple(round(x, 5) for x in p), tuple(round(x, 3) for x in nn), c)
                if key not in verts:
                    verts[key] = len(pos)
                    pos.append(key[0]); nrm.append(key[1]); col.append(c)
                face.append(verts[key])
            for j in range(1, n_ - 1):
                idx += [face[0], face[j], face[j + 1]]
            k += n_
    os.unlink(tmp.name)
    xs = [p[0] for p in pos]; ys = [p[1] for p in pos]; zs = [p[2] for p in pos]
    cx, cz, y0 = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2, min(ys)
    pos = [(p[0] - cx, p[1] - y0, p[2] - cz) for p in pos]
    return pos, nrm, col, idx


def write_glb(items, out):
    bin_ = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def add(data, fmt, count, comp, typ, target, minmax=None, normalized=False):
        while len(bin_) % 4:
            bin_.append(0)
        off = len(bin_)
        bin_.extend(struct.pack("<" + fmt * (len(data)), *data))
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(bin_) - off, "target": target})
        a = {"bufferView": len(views) - 1, "componentType": comp, "count": count, "type": typ}
        if normalized:
            a["normalized"] = True
        if minmax:
            a["min"], a["max"] = minmax
        accessors.append(a)
        return len(accessors) - 1

    for key, (pos, nrm, col, idx) in items:
        flat = [v for p in pos for v in p]
        mn = [min(p[i] for p in pos) for i in range(3)]
        mx = [max(p[i] for p in pos) for i in range(3)]
        ap = add(flat, "f", len(pos), 5126, "VEC3", 34962, (mn, mx))
        an = add([v for n in nrm for v in n], "f", len(nrm), 5126, "VEC3", 34962)
        # colours as normalized RGBA bytes (4-byte aligned) keep the file small
        ac = add([round(v * 255) for c in col for v in (*c, 1.0)], "B", len(col), 5121, "VEC4", 34962, normalized=True)
        ai = add(idx, "H" if len(pos) < 65536 else "I", len(idx), 5123 if len(pos) < 65536 else 5125, "SCALAR", 34963)
        meshes.append({"name": key, "primitives": [{"attributes": {"POSITION": ap, "NORMAL": an, "COLOR_0": ac}, "indices": ai, "material": 0}]})
        nodes.append({"name": key, "mesh": len(meshes) - 1, "extras": {"size": [mx[i] - mn[i] for i in range(3)]}})
    gltf = {
        "asset": {"version": "2.0", "generator": "valley-adu build-furniture.py", "copyright": "Kenney Furniture Kit 2.0, CC0 (kenney.nl)"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
        "materials": [{"name": "kenney", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.75}}],
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    while len(bin_) % 4:
        bin_.append(0)
    with open(out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)


if __name__ == "__main__":
    pack_dir, out = sys.argv[1], sys.argv[2]
    assets = load_assets(pack_dir)
    items = []
    for key, name in PICK.items():
        a = assets[name]
        items.append((key, mesh_data(base64.b64decode(a["model"]))))
        print(f"{key:12s} {name:24s} tris={len(items[-1][1][3]) // 3}")
    write_glb(items, out)
    print("wrote", out, os.path.getsize(out), "bytes")
