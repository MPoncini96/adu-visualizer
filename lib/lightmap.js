// Baked lighting for the walk-in tour.
// The house shell (walls, trim, floors, ceilings) is made of axis-aligned rectangles, so its
// lightmap layout is computed here, deterministically: every quad gets its own patch in one atlas
// (uv1). scripts/bake-lighting.mjs exports the same geometry, Blender (Cycles) bakes sky light,
// bounce light and the soft shadows of furniture into that atlas, and the tour applies it when
// public/bake/<plan>.json matches the current plan (see bakeKey).
import * as THREE from "three";

export const BAKE_VERSION = 2;

// FNV-1a over the plan and the footprint numbers that shape the shell
export function bakeKey(plan, model) {
  const s = JSON.stringify({ v: BAKE_VERSION, plan, m: [model.id, model.W, model.D, model.shape, model.ww, model.wd, model.conversion] });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

// fingerprint of an atlas layout: a bake only fits geometry laid out exactly the same way
export function layoutKey(rects) {
  const t = JSON.stringify(rects);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

// Pairs of triangles -> rectangles. Geometry must be non-indexed, two triangles per quad.
function quads(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, out = [];
  for (let i = 0; i + 5 < p.count; i += 6) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? ["x", "z"] : ax >= az ? ["z", "y"] : ["x", "y"];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = i; k < i + 6; k++) {
      const pu = u === "x" ? p.getX(k) : p.getZ(k), pv = v === "y" ? p.getY(k) : p.getZ(k);
      u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
    }
    out.push({ i, u, v, u0, u1, v0, v1, w: u1 - u0, h: v1 - v0 });
  }
  return out;
}

// Adds uv1 to every target mesh's geometry and returns the atlas size in texels.
export function addLightmapUVs(meshes) {
  const all = [], hidden = [];
  for (const m of meshes) {
    if (!m) continue;
    if (m.geometry.index) m.geometry = m.geometry.toNonIndexed();
    const skip = m.geometry.userData.lmSkip; // quads nobody can see (inside walls, behind siding)
    quads(m.geometry).forEach((q, k) => { if (!skip?.[k]) all.push({ ...q, geo: m.geometry }); else hidden.push({ ...q, geo: m.geometry }); });
  }
  const area = all.reduce((s, q) => s + q.w * q.h, 0);
  const pad = 3; // texels of padding around every patch (Blender's bake margin fills them)
  let size = 1024, density = 0;
  for (size of [1024, 2048]) {
    density = Math.min(48, Math.sqrt((0.62 * size * size) / Math.max(area, 1)));
    if (density >= 28 || size === 2048) break;
  }
  // shelf packing, tallest first; shrink density until everything fits
  const sorted = [...all].sort((a, b) => b.h - a.h || b.w - a.w);
  for (let tries = 0; tries < 20; tries++) {
    let x = 0, y = 0, rowH = 0, ok = true;
    for (const q of sorted) {
      const w = Math.max(1, Math.ceil(q.w * density)) + 2 * pad, h = Math.max(1, Math.ceil(q.h * density)) + 2 * pad;
      if (x + w > size - 4) { x = 0; y += rowH; rowH = 0; } // keep the corner free for the hidden-quad patch
      if (y + h > size) { ok = false; break; }
      q.px = x + pad; q.py = y + pad; q.pw = w - 2 * pad; q.ph = h - 2 * pad;
      x += w; rowH = Math.max(rowH, h);
    }
    if (ok) break;
    density *= 0.93;
  }
  // hidden quads all share one tiny patch in the corner
  for (const q of hidden) { q.px = size - 3; q.py = size - 3; q.pw = 1; q.ph = 1; }
  // write uv1 (px/py from the atlas origin; with flipY = false that's the image's top-left corner)
  const attrs = new Map();
  for (const q of [...all, ...hidden]) {
    if (!attrs.has(q.geo)) attrs.set(q.geo, new Float32Array(q.geo.attributes.position.count * 2));
    const a = attrs.get(q.geo), p = q.geo.attributes.position;
    for (let k = q.i; k < q.i + 6; k++) {
      const pu = q.u === "x" ? p.getX(k) : p.getZ(k), pv = q.v === "y" ? p.getY(k) : p.getZ(k);
      const s = q.w > 0 ? (pu - q.u0) / q.w : 0, t = q.h > 0 ? (pv - q.v0) / q.h : 0;
      a[k * 2] = (q.px + s * q.pw) / size;
      a[k * 2 + 1] = (q.py + t * q.ph) / size;
    }
  }
  for (const [geo, a] of attrs) geo.setAttribute("uv1", new THREE.BufferAttribute(a, 2));
  return { size, density, rects: all.map((q) => [q.px, q.py, q.pw, q.ph]) };
}

// KTX2 lightmaps need the renderer (to pick the GPU format to transcode to); createTour sets it.
let ktx2 = null, ktxRenderer = null;
export function setLightmapRenderer(renderer) {
  if (renderer === ktxRenderer) return;
  ktxRenderer = renderer;
  ktx2?.dispose();
  ktx2 = null;
}
async function loadKTX2(url) {
  if (!ktxRenderer) throw new Error("no renderer for KTX2");
  if (!ktx2) {
    const { KTX2Loader } = await import("three/examples/jsm/loaders/KTX2Loader.js");
    ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(ktxRenderer);
  }
  return ktx2.loadAsync(url);
}

// Loads public/bake/<plan>.json + its lightmap (.ktx2 or .webp) when they match this plan; otherwise null.
const bakeCache = new Map();
export function loadBake(plan, model) {
  const key = bakeKey(plan, model);
  if (!bakeCache.has(key)) {
    bakeCache.set(key, (async () => {
      try {
        const r = await fetch(`/bake/${model.id}.json`, { cache: "no-cache" });
        if (!r.ok) return null;
        const meta = await r.json();
        if (meta.key !== key) return null; // the plan changed since it was baked
        const url = `/bake/${meta.image}`;
        let tex;
        if (meta.image.endsWith(".ktx2")) {
          tex = await loadKTX2(url); // with mipmaps; KTX2 textures are never flipped (flipY = false)
        } else {
          tex = await new THREE.TextureLoader().loadAsync(url);
          // The image's top row is uv1 v = 0 (Blender's glTF import flips V, so its bake comes out
          // that way). Before Nov 2026 this was flipY = true, which put every patch's light on the
          // wrong surface; the old blurred bakes hid it.
          tex.flipY = false;
          tex.generateMipmaps = true;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.channel = 1;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        return { ...meta, tex };
      } catch (e) {
        console.warn("lightmap not loaded", e);
        bakeCache.delete(key); // try again next time (e.g. a renderer is available then)
        return null;
      }
    })());
  }
  return bakeCache.get(key);
}
