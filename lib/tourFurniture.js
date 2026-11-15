// Real furniture models for the walk-in tour (Poly Haven, CC0; see public/furniture/CREDITS.md).
// public/furniture/manifest.json maps a furniture key from lib/floorplan.js CATALOG to a
// Draco-compressed GLB made by scripts/process-assets.mjs:
//   { "sofa": { "src": "sofa.glb", "fit": "contain", "rotY": 0 }, ... }
// Each model is turned so its front faces the room (+z in item space), scaled uniformly to fit
// inside the piece's footprint and height from the floor plan, centered, and stood on the floor.
// Keys without a model keep the low-poly kit pieces.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const FT = 0.3048;
let loader = null;
function gltfLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  loader.setDRACOLoader(draco);
  return loader;
}

let manifestPromise = null;
export function loadFurnitureManifest() {
  manifestPromise ??= fetch("/furniture/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifestPromise;
}

const models = new Map();
function loadModel(src) {
  if (!models.has(src)) {
    models.set(src, gltfLoader().loadAsync(`/furniture/${src}`).then((g) => {
      const root = g.scene;
      root.updateMatrixWorld(true);
      // bake node transforms into the geometry, so each piece is one flat list of meshes
      const parts = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        const mat = o.material;
        for (const m of Array.isArray(mat) ? mat : [mat]) {
          if (m.map) m.map.anisotropy = 8;
        }
        parts.push({ geo, mat });
      });
      const box = new THREE.Box3();
      for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
      return { parts, box };
    }).catch((e) => { console.warn("furniture model failed", src, e); return null; }));
  }
  return models.get(src);
}

// Places every item that has a model. Returns meshes, their world boxes, and the keys handled.
export async function placeFurniture({ items, X, Z, FLOOR }) {
  const manifest = await loadFurnitureManifest();
  const want = items.filter((it) => manifest[it.key]);
  const loaded = new Map();
  await Promise.all([...new Set(want.map((it) => manifest[it.key].src))].map(async (src) => loaded.set(src, await loadModel(src))));
  const meshes = [], placed = [], handled = new Set();
  // repeated pieces (dining chairs, nightstands) share geometry through instancing
  const groups = new Map();
  for (const it of want) {
    const entry = manifest[it.key];
    const m = loaded.get(entry.src);
    if (!m) continue;
    handled.add(it.key);
    // model space -> item space: turn so the front is +z, then scale to fit the footprint
    const rot = new THREE.Matrix4().makeRotationY(((entry.rotY || 0) * Math.PI) / 180);
    const b = m.box.clone().applyMatrix4(rot);
    const size = b.getSize(new THREE.Vector3());
    const W = it.w * FT, D = it.d * FT, H = it.h * FT;
    let sx, sy, sz;
    if (entry.fit === "stretch") { sx = W / size.x; sy = H / size.y; sz = D / size.z; }
    else {
      const s = Math.min(W / size.x, D / size.z, H / size.y);
      // allow a little stretch to fill the footprint without visibly distorting the piece
      const k = entry.stretch ?? 0.08;
      sx = Math.min(s * (1 + k), W / size.x); sz = Math.min(s * (1 + k), D / size.z); sy = Math.min(s * (1 + k / 2), H / size.y);
      if (entry.uniformHeight) sy = s;
    }
    const center = b.getCenter(new THREE.Vector3());
    const toItem = new THREE.Matrix4().makeScale(sx, sy, sz)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -b.min.y, -center.z))
      .multiply(rot);
    // the depth is fitted from the back: pieces sit against their wall like the 2D plan shows
    const back = new THREE.Matrix4().makeTranslation(0, 0, it.back === "wall" ? -(D - size.z * sz) / 2 : 0);
    const world = new THREE.Matrix4().makeTranslation(X(it.x), FLOOR + it.elev * FT, Z(it.y))
      .multiply(new THREE.Matrix4().makeRotationY((it.rot * Math.PI) / 180))
      .multiply(back).multiply(toItem);
    if (!groups.has(entry.src)) groups.set(entry.src, { m, list: [] });
    groups.get(entry.src).list.push({ it, world });
    const wb = m.box.clone().applyMatrix4(world);
    placed.push({ key: it.key, box: wb, model: true, rot: it.rot });
  }
  for (const { m, list } of groups.values()) {
    for (const p of m.parts) {
      let mesh;
      if (list.length === 1) {
        mesh = new THREE.Mesh(p.geo, p.mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(list[0].world);
      } else {
        mesh = new THREE.InstancedMesh(p.geo, p.mat, list.length);
        list.forEach((q, i) => mesh.setMatrixAt(i, q.world));
        mesh.computeBoundingSphere();
      }
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = "furniture-model";
      meshes.push(mesh);
    }
  }
  return { meshes, placed, handled };
}
