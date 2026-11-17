// Physically based materials for the walk-in tour.
// Each surface uses a real texture set from public/textures/<set>/ (color, normal, roughness, and
// optionally ao) when one is listed in public/textures/manifest.json (Poly Haven / ambientCG, CC0);
// otherwise it falls back to a procedural texture drawn here, so the tour always works.
import * as THREE from "three";

const FT = 0.3048;

// ---------------------------------------------------------------- canvas helpers
function canvas(w, h) {
  return typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// Largest texture edge kept on the GPU. Phones get 512 px copies of the procedural textures
// (about 1/4 of the memory; the tour's ~13 1024 px sets are ~60 MB with mipmaps). Set by createTour.
let maxTexPx = 4096, maxAniso = 8;
export function setTextureBudget(px, aniso = 8) { maxTexPx = px; maxAniso = aniso; }
function fit(c) {
  const k = maxTexPx / Math.max(c.width, c.height);
  if (k >= 1) return c;
  const o = canvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
  const g = o.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(c, 0, 0, o.width, o.height);
  return o;
}
function tex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(fit(c));
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}
// grayscale height canvas -> tangent-space normal map
function heightToNormal(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext("2d").getImageData(0, 0, w, h).data;
  const out = canvas(w, h), g = out.getContext("2d"), img = g.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}
function noise(g, w, h, r, n, alpha, size = 1.5) {
  for (let i = 0; i < n; i++) {
    const v = r() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(r() * w, r() * h, size, size);
  }
}

// ---------------------------------------------------------------- procedural sets (fallbacks)
// Each returns {map, normalMap, roughnessMap, size}: size = meters covered by one texture repeat.
function woodPlankSet() {
  const w = 1024, h = 1024, r = rng(7);
  const col = canvas(w, h), hc = canvas(w, h), rc = canvas(w, h);
  const g = col.getContext("2d"), gh = hc.getContext("2d"), gr = rc.getContext("2d");
  gh.fillStyle = "#808080"; gh.fillRect(0, 0, w, h);
  gr.fillStyle = "#8a8a8a"; gr.fillRect(0, 0, w, h);
  const planks = 8, pw = w / planks; // 8 planks of 6" across 4 ft
  for (let i = 0; i < planks; i++) {
    let y = -r() * h;
    while (y < h) {
      const len = h * (0.35 + r() * 0.5);
      const base = [188 + r() * 30, 150 + r() * 26, 104 + r() * 22];
      const grd = g.createLinearGradient(i * pw, 0, (i + 1) * pw, 0);
      grd.addColorStop(0, `rgb(${base[0] - 8},${base[1] - 8},${base[2] - 8})`);
      grd.addColorStop(0.5, `rgb(${base[0]},${base[1]},${base[2]})`);
      grd.addColorStop(1, `rgb(${base[0] - 6},${base[1] - 7},${base[2] - 6})`);
      g.fillStyle = grd; g.fillRect(i * pw, y, pw, len);
      // grain: long wavy lines and a few knots
      for (let k = 0; k < 26; k++) {
        const x = i * pw + r() * pw, a = 0.04 + r() * 0.1;
        g.strokeStyle = `rgba(${90 + r() * 30},${60 + r() * 20},${32},${a})`;
        g.lineWidth = 0.6 + r() * 1.8;
        g.beginPath(); g.moveTo(x, y);
        const wob = (r() - 0.5) * 10;
        g.bezierCurveTo(x + wob, y + len / 3, x - wob, y + (2 * len) / 3, x + (r() - 0.5) * 6, y + len); g.stroke();
      }
      if (r() < 0.35) {
        const kx = i * pw + pw * (0.25 + r() * 0.5), ky = y + len * r();
        const rad = 4 + r() * 6;
        const kg = g.createRadialGradient(kx, ky, 0, kx, ky, rad * 2.2);
        kg.addColorStop(0, "rgba(80,50,25,0.55)"); kg.addColorStop(1, "rgba(80,50,25,0)");
        g.fillStyle = kg; g.fillRect(kx - rad * 3, ky - rad * 3, rad * 6, rad * 6);
      }
      // seams: a dark groove in color, a dip in height
      g.fillStyle = "rgba(70,48,28,0.55)"; g.fillRect(i * pw, y, pw, 2);
      gh.fillStyle = "#3a3a3a"; gh.fillRect(i * pw, y, pw, 3);
      gr.fillStyle = `rgb(${120 + r() * 30},${120},${120})`; gr.fillRect(i * pw + 3, y + 3, pw - 6, len - 6);
      y += len;
    }
    g.fillStyle = "rgba(70,48,28,0.6)"; g.fillRect(i * pw, 0, 2, h);
    gh.fillStyle = "#3a3a3a"; gh.fillRect(i * pw, 0, 3, h);
  }
  noise(gh, w, h, r, 30000, 0.15);
  return { map: tex(col), normalMap: tex(heightToNormal(hc, 3), { srgb: false }), roughnessMap: tex(rc, { srgb: false }), size: 4 * FT };
}
function tileSet({ n = 4, grout = "#a9a59c", base = 226, sizeFt = 4, gloss = 70 } = {}) {
  const w = 1024, h = 1024, r = rng(3), s = w / n, gw = 5;
  const col = canvas(w, h), hc = canvas(w, h), rc = canvas(w, h);
  const g = col.getContext("2d"), gh = hc.getContext("2d"), gr = rc.getContext("2d");
  g.fillStyle = grout; g.fillRect(0, 0, w, h);
  gh.fillStyle = "#202020"; gh.fillRect(0, 0, w, h);
  gr.fillStyle = "#e0e0e0"; gr.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = base + r() * 10;
    g.fillStyle = `rgb(${v},${v - 2},${v - 7})`;
    g.fillRect(i * s + gw, j * s + gw, s - 2 * gw, s - 2 * gw);
    // faint marble-like veining
    for (let k = 0; k < 5; k++) {
      g.strokeStyle = `rgba(150,145,138,${0.05 + r() * 0.08})`; g.lineWidth = 0.8 + r() * 1.5;
      g.beginPath(); g.moveTo(i * s + r() * s, j * s + r() * s); g.quadraticCurveTo(i * s + r() * s, j * s + r() * s, i * s + r() * s, j * s + r() * s); g.stroke();
    }
    gh.fillStyle = "#c8c8c8"; gh.fillRect(i * s + gw + 2, j * s + gw + 2, s - 2 * gw - 4, s - 2 * gw - 4);
    gh.fillStyle = "#b4b4b4"; gh.fillRect(i * s + gw, j * s + gw, s - 2 * gw, 2); // slightly eased edge
    gr.fillStyle = `rgb(${gloss + r() * 12},0,0)`; gr.fillRect(i * s + gw, j * s + gw, s - 2 * gw, s - 2 * gw);
  }
  // roughness is read from the green channel
  const rcc = canvas(w, h), gg = rcc.getContext("2d");
  gg.drawImage(rc, 0, 0);
  const d = gg.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { d.data[i + 1] = d.data[i]; d.data[i + 2] = d.data[i]; } gg.putImageData(d, 0, 0);
  return { map: tex(col), normalMap: tex(heightToNormal(hc, 4), { srgb: false }), roughnessMap: tex(rcc, { srgb: false }), size: sizeFt * FT };
}
// subway tile, 3"x6" running bond, for backsplashes and the shower
function subwaySet() {
  const w = 1024, h = 1024, r = rng(9), rows = 16, cols = 4, th = h / rows, tw = w / cols, gw = 3;
  const col = canvas(w, h), hc = canvas(w, h);
  const g = col.getContext("2d"), gh = hc.getContext("2d");
  g.fillStyle = "#cfcbc3"; g.fillRect(0, 0, w, h);
  gh.fillStyle = "#151515"; gh.fillRect(0, 0, w, h);
  for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
    const x = i * tw + (j % 2 ? tw / 2 : 0), y = j * th, v = 240 + r() * 8;
    g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(x + gw, y + gw, tw - 2 * gw, th - 2 * gw);
    const hg = gh.createLinearGradient(0, y, 0, y + th);
    hg.addColorStop(0, "#9a9a9a"); hg.addColorStop(0.12, "#d8d8d8"); hg.addColorStop(0.88, "#d8d8d8"); hg.addColorStop(1, "#9a9a9a");
    gh.fillStyle = hg; gh.fillRect(x + gw, y + gw, tw - 2 * gw, th - 2 * gw);
  }
  return { map: tex(col), normalMap: tex(heightToNormal(hc, 5), { srgb: false }), size: 2 * FT };
}
// matte paint: a very light orange-peel texture so walls catch light like drywall does
function paintSet() {
  const w = 512, h = 512, r = rng(13);
  const hc = canvas(w, h), gh = hc.getContext("2d");
  gh.fillStyle = "#808080"; gh.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const x = r() * w, y = r() * h, rad = 1.5 + r() * 4, v = 110 + r() * 40;
    const gg = gh.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, `rgba(${v},${v},${v},0.5)`); gg.addColorStop(1, "rgba(128,128,128,0)");
    gh.fillStyle = gg; gh.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return { normalMap: tex(heightToNormal(hc, 0.6), { srgb: false }), size: 1.2 };
}
function quartzSet() {
  const w = 1024, h = 1024, r = rng(21);
  const col = canvas(w, h), g = col.getContext("2d");
  g.fillStyle = "#f1efea"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) { const v = 150 + r() * 90; g.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.15 + r() * 0.3})`; g.fillRect(r() * w, r() * h, 1 + r() * 1.6, 1 + r() * 1.6); }
  for (let k = 0; k < 6; k++) {
    g.strokeStyle = `rgba(160,152,140,${0.12 + r() * 0.12})`; g.lineWidth = 1 + r() * 3;
    g.beginPath(); let x = r() * w, y = 0; g.moveTo(x, y);
    while (y < h) { x += (r() - 0.5) * 60; y += 30 + r() * 60; g.lineTo(x, y); }
    g.stroke();
  }
  return { map: tex(col), size: 1.2 };
}
function brushedSet() {
  const w = 512, h = 64, r = rng(5);
  const hc = canvas(w, h), gh = hc.getContext("2d");
  gh.fillStyle = "#808080"; gh.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { const v = 100 + r() * 56; gh.fillStyle = `rgba(${v},${v},${v},0.6)`; gh.fillRect(0, r() * h, w, 0.6 + r()); }
  return { normalMap: tex(heightToNormal(hc, 0.8), { srgb: false }), size: 0.5 };
}
function fabricSet() {
  const w = 256, h = 256, r = rng(17);
  const hc = canvas(w, h), gh = hc.getContext("2d");
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const v = ((x / 2 + y / 2) % 2 ? 150 : 106) + r() * 20; gh.fillStyle = `rgb(${v},${v},${v})`; gh.fillRect(x, y, 2, 2); }
  return { normalMap: tex(heightToNormal(hc, 1.2), { srgb: false }), size: 0.12 };
}
function grassSet() {
  const w = 512, h = 512, r = rng(11);
  const col = canvas(w, h), g = col.getContext("2d");
  g.fillStyle = "#6f8a45"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(78,104,46,${0.35 + r() * 0.4})` : `rgba(140,160,84,${0.25 + r() * 0.35})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 2 + r() * 4);
  }
  return { map: tex(col), size: 2.5 };
}

// continuous wood grain (no plank seams) for furniture; light oak or walnut
function woodGrainSet(dark = false) {
  const w = 512, h = 512, r = rng(dark ? 41 : 43);
  const col = canvas(w, h), g = col.getContext("2d");
  const base = dark ? [104, 70, 46] : [196, 160, 118];
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 220; k++) {
    const y0 = r() * h, a = 0.05 + r() * 0.12, d = dark ? 30 : 50;
    g.strokeStyle = `rgba(${base[0] - d},${base[1] - d},${base[2] - d * 0.7},${a})`;
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath(); g.moveTo(0, y0);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y0 + Math.sin(x / (40 + r() * 30) + k) * (2 + r() * 3));
    g.stroke();
  }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1); }
  return { map: tex(col), size: 0.9 };
}
// flatweave rug: soft border and a simple diamond pattern
function rugSet() {
  const w = 1024, h = 640, r = rng(29);
  const col = canvas(w, h), g = col.getContext("2d");
  g.fillStyle = "#d9cdb8"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#8b7d68"; g.lineWidth = 18; g.strokeRect(36, 36, w - 72, h - 72);
  g.strokeStyle = "#b8a68a"; g.lineWidth = 6; g.strokeRect(70, 70, w - 140, h - 140);
  g.strokeStyle = "rgba(120,104,84,0.55)"; g.lineWidth = 4;
  for (let x = 120; x < w - 100; x += 80) for (let y = 120; y < h - 100; y += 80) { g.beginPath(); g.moveTo(x, y - 26); g.lineTo(x + 26, y); g.lineTo(x, y + 26); g.lineTo(x - 26, y); g.closePath(); g.stroke(); }
  for (let i = 0; i < 60000; i++) { const v = r() > 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${r() * 0.07})`; g.fillRect(r() * w, r() * h, 2, 1); }
  const t = tex(col, { repeat: false });
  return { map: t, size: 1 };
}

const PROCEDURAL = {
  floorWood: woodPlankSet, floorTile: () => tileSet({ n: 4, sizeFt: 4 }), showerTile: () => tileSet({ n: 8, sizeFt: 2, base: 236, grout: "#bdb8ae" }),
  backsplash: subwaySet, wallPaint: paintSet, countertop: quartzSet, brushed: brushedSet, fabric: fabricSet, grass: grassSet,
  oak: () => woodGrainSet(false), walnut: () => woodGrainSet(true), rug: rugSet,
};

// ---------------------------------------------------------------- downloaded sets
const texLoader = new THREE.TextureLoader();
let manifestPromise = null;
function loadManifest() {
  manifestPromise ??= fetch("/textures/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifestPromise;
}
async function loadSet(name, entry) {
  const base = `/textures/${entry.dir}/`;
  const get = (file, srgb) => texLoader.loadAsync(base + file).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  });
  const out = { size: entry.size };
  const jobs = [];
  if (entry.color) jobs.push(get(entry.color, true).then((t) => (out.map = t)));
  if (entry.normal) jobs.push(get(entry.normal, false).then((t) => (out.normalMap = t)));
  if (entry.rough) jobs.push(get(entry.rough, false).then((t) => (out.roughnessMap = t)));
  await Promise.all(jobs);
  return out;
}

const cache = new Map();
// One shared material library per page (textures are reused across plans and styles).
export function loadMaterialLibrary() {
  const key = `lib:${maxTexPx}`; // the AR export may build one at full size first
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const manifest = await loadManifest();
    const sets = {};
    await Promise.all(Object.keys(PROCEDURAL).map(async (k) => {
      try { sets[k] = manifest[k] ? await loadSet(k, manifest[k]) : PROCEDURAL[k](); }
      catch { sets[k] = PROCEDURAL[k](); }
    }));
    return buildLibrary(sets);
  })();
  cache.set(key, p);
  return p;
}

// UVs on the generated geometry are in meters, so a set's repeat is 1 / (meters per tile)
function apply(set, m) {
  for (const k of ["map", "normalMap", "roughnessMap"]) {
    if (!set[k]) continue;
    const t = set[k].clone();
    t.needsUpdate = true;
    t.repeat.set(1 / set.size, 1 / set.size);
    m[k] = t;
  }
  return m;
}

function buildLibrary(sets) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const lib = {
    // walls: per-vertex paint color (living vs bath), drywall texture, flat paint sheen
    walls: apply(sets.wallPaint, S({ vertexColors: true, roughness: 0.92, metalness: 0 })),
    // casings, baseboards, doors: semi-gloss paint
    trim: apply({ normalMap: sets.wallPaint.normalMap, size: 2 }, S({ vertexColors: true, roughness: 0.38, metalness: 0 })),
    ceiling: S({ color: "#f4f2ed", roughness: 0.95 }),
    floorWood: apply(sets.floorWood, S({ color: "#ffffff", roughness: 0.55, metalness: 0 })),
    floorTile: apply(sets.floorTile, S({ color: "#ffffff", roughness: 0.35, metalness: 0 })),
    showerTile: apply(sets.showerTile, S({ color: "#ffffff", roughness: 0.25 })),
    backsplash: apply(sets.backsplash, S({ color: "#ffffff", roughness: 0.18 })),
    countertop: apply(sets.countertop, S({ color: "#ffffff", roughness: 0.22, metalness: 0 })),
    cabinet: S({ color: "#eeebe4", roughness: 0.42 }),
    cabinetInside: S({ color: "#d9d3c8", roughness: 0.7 }),
    vanityWood: S({ color: "#7a5a3e", roughness: 0.5 }),
    fabricShade: S({ color: "#efe8da", roughness: 0.9, side: THREE.DoubleSide, emissive: "#fff3da", emissiveIntensity: 0.12 }),
    steel: apply(sets.brushed, S({ color: "#c9ccce", roughness: 0.32, metalness: 1 })),
    darkSteel: S({ color: "#2b2d2f", roughness: 0.35, metalness: 0.6 }),
    blackGlass: S({ color: "#0c0d0e", roughness: 0.08, metalness: 0.1 }),
    brass: S({ color: "#b48a52", roughness: 0.3, metalness: 1 }),
    chrome: S({ color: "#e6e8ea", roughness: 0.08, metalness: 1 }),
    porcelain: S({ color: "#f7f7f4", roughness: 0.12, metalness: 0 }),
    mirror: S({ color: "#ffffff", roughness: 0.02, metalness: 1 }),
    plate: S({ color: "#f8f7f2", roughness: 0.35 }), // outlets and switches
    plateDark: S({ color: "#3a3a3a", roughness: 0.5 }),
    fixtureGlass: S({ color: "#fbfaf6", roughness: 0.3, emissive: "#fff6e0", emissiveIntensity: 0.25 }),
    canTrim: S({ color: "#f7f6f2", roughness: 0.4, emissive: "#fffaf0", emissiveIntensity: 0.12 }),
    frameWood: S({ color: "#3b2a1d", roughness: 0.55 }),
    frameBlack: S({ color: "#1f1f1f", roughness: 0.45 }),
    canvasMat: (map) => S({ map, roughness: 0.85 }),
    furniture: S({ vertexColors: true, roughness: 0.75, metalness: 0 }),
    furnitureGloss: S({ vertexColors: true, roughness: 0.2, metalness: 0 }),
    fabric: (color) => apply(sets.fabric, S({ color, roughness: 0.95 })),
    oak: apply(sets.oak, S({ color: "#ffffff", roughness: 0.55 })),
    walnut: apply(sets.walnut, S({ color: "#ffffff", roughness: 0.5 })),
    linen: apply(sets.fabric, S({ color: "#7d8a92", roughness: 0.95 })), // headboard
    bedding: apply(sets.fabric, S({ color: "#f1ede4", roughness: 0.95 })),
    duvet: apply(sets.fabric, S({ color: "#e7e0d2", roughness: 0.95 })),
    throwSage: apply(sets.fabric, S({ color: "#a9b394", roughness: 0.95 })),
    pillowAccent: apply(sets.fabric, S({ color: "#d9c4a6", roughness: 0.95 })),
    mattress: S({ color: "#f4f3ef", roughness: 0.9 }),
    rug: S({ map: sets.rug.map, roughness: 0.98 }),
    tvScreen: S({ color: "#050607", roughness: 0.12, metalness: 0.2 }),
    tvBody: S({ color: "#1a1b1c", roughness: 0.4, metalness: 0.3 }),
    showerGlass: new THREE.MeshPhysicalMaterial({ color: "#eef4f4", roughness: 0.05, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false }),
    appliance: S({ color: "#f3f3f1", roughness: 0.3 }),
    bookColors: ["#7a3b2e", "#2f4858", "#c9a227", "#55745a", "#a94f3a", "#e3dccb", "#3c3c3c", "#8a6f9e"].map((c) => S({ color: c, roughness: 0.7 })),
    grass: apply(sets.grass, new THREE.MeshLambertMaterial({ color: "#ffffff" })),
    fence: S({ vertexColors: true, roughness: 0.9 }),
  };
  return lib;
}
