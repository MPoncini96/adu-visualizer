// Walk-in interior tour, generated from the floor-plan JSON (lib/floorplans/*.json).
// Scene units are meters in the exterior model's frame (x right, z toward the front door, y up),
// so the generated interior sits exactly inside public/models/<plan>-<style>.glb.
// Walking, collision and path-finding happen in plan feet (see lib/floorplan.js).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  FLOOR_FT, DOOR_HEAD_FT, outline, floorRects, wallBoxes, exteriorOpenings, interiorDoors,
  furnitureItems, itemRect, roomLabel, roomAt, entryPose, planToModelFrame,
} from "./floorplan.js";
import { modelSrc, ROOF } from "./models.js";

const FT = 0.3048;
const FLOOR = FLOOR_FT * FT;
const EYE_FT = 5 + 4 / 12; // 5'4"
const RADIUS_FT = 0.9;
const WALK_FTPS = 4.6;
const GLIDE_FTPS = 7.5;

// ---------------------------------------------------------------- asset loading (cached)
const loader = new GLTFLoader();
let kitPromise = null;
function loadKit() {
  kitPromise ??= loader.loadAsync("/models/furniture-kit.glb").then((g) => {
    const out = {};
    g.scene.traverse((o) => {
      if (o.isMesh) {
        const geo = o.geometry.clone();
        geo.computeBoundingBox();
        out[o.name] = geo;
      }
    });
    return out;
  });
  return kitPromise;
}
const exteriorCache = new Map();
function loadExterior(modelId, styleId) {
  const src = modelSrc(modelId, styleId);
  if (!exteriorCache.has(src)) exteriorCache.set(src, loader.loadAsync(src));
  return exteriorCache.get(src);
}

// ---------------------------------------------------------------- procedural textures
function canvasTex(w, h, draw, repeat = true) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// rand with a fixed seed so every visit looks the same
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Light oak luxury vinyl plank: texture covers 4 ft x 4 ft, planks 6" wide
function lvpTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(7);
    const planks = 8, pw = w / planks;
    for (let i = 0; i < planks; i++) {
      let y = -r() * h;
      while (y < h) {
        const len = h * (0.45 + r() * 0.5);
        const base = 196 + r() * 22;
        g.fillStyle = `rgb(${base + 20},${base + 2},${base - 34})`;
        g.fillRect(i * pw, y, pw, len);
        for (let k = 0; k < 9; k++) {
          g.strokeStyle = `rgba(120,88,52,${0.05 + r() * 0.08})`;
          g.lineWidth = 0.6 + r() * 1.2;
          const x = i * pw + r() * pw;
          g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 6, y + len / 3, x + (r() - 0.5) * 6, y + (2 * len) / 3, x + (r() - 0.5) * 4, y + len); g.stroke();
        }
        g.fillStyle = "rgba(90,66,40,0.35)";
        g.fillRect(i * pw, y, pw, 1.5);
        y += len;
      }
      g.fillStyle = "rgba(90,66,40,0.35)";
      g.fillRect(i * pw, 0, 1.5, h);
    }
  });
}
// 12" porcelain tile: texture covers 4 ft x 4 ft
function tileTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(3);
    const n = 4, s = w / n;
    g.fillStyle = "#b9b6ae"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 220 + r() * 14;
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      g.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
    }
  });
}
function grassTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = "#7d9a55"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = r();
      g.fillStyle = v < 0.5 ? `rgba(95,125,60,${0.4 + r() * 0.4})` : `rgba(150,170,95,${0.25 + r() * 0.35})`;
      g.fillRect(r() * w, r() * h, 1.5 + r() * 2, 1.5 + r() * 2);
    }
  });
}
function labelTexture(text) {
  const font = "600 44px system-ui, -apple-system, Segoe UI, sans-serif";
  const c = document.createElement("canvas");
  const g0 = c.getContext("2d"); g0.font = font;
  const tw = Math.ceil(g0.measureText(text).width);
  c.width = tw + 64; c.height = 84;
  const g = c.getContext("2d");
  g.font = font;
  g.fillStyle = "rgba(29,42,34,0.82)";
  const R = 42;
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, R); g.fill();
  g.fillStyle = "#fff"; g.textBaseline = "middle";
  g.fillText(text, 32, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: c.width / c.height };
}

// ---------------------------------------------------------------- geometry helpers
// Accumulates axis-aligned boxes (meters) into one non-indexed geometry with per-vertex colors.
class BoxBatch {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; }
  // faces: optional {skip: Set of "px","nx","py","ny","pz","nz"}, color per face via colorFn(faceKey)
  box(x0, x1, y0, y1, z0, z1, color, opts = {}) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const F = {
      px: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
      nx: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
      py: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
      ny: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
      pz: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      nz: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
    };
    for (const k in F) {
      if (opts.skip?.has(k)) continue;
      const [a, b, c, d, nn] = F[k];
      const col = new THREE.Color(typeof color === "function" ? color(k) : color);
      for (const v of [a, b, c, a, c, d]) {
        this.p.push(...v); this.n.push(...nn); this.c.push(col.r, col.g, col.b);
        // world-space planar UVs (meters) for tiling textures
        this.uv.push(k[1] === "x" ? v[2] : v[0], k[1] === "y" ? v[2] : v[1]);
      }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

function planeXZ(x0, x1, z0, z1, y, up, texMeters) {
  const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0));
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  if (texMeters) {
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / texMeters, pos.getZ(i) / texMeters);
  }
  return g;
}

// ---------------------------------------------------------------- scene builder (no renderer)
// Returns everything the tour needs; also used headless to export the interior for AR.
export async function buildTourScene({ plan, model, styleId, heading = 180 }) {
  const fr = planToModelFrame(model);
  const X = fr.x, Z = fr.z;
  const H = plan.wallHeight || 9;
  // ceiling sits just under the roof slab where it crosses the inside face of the eave walls
  const CEIL = Math.min(FLOOR + H * FT, (ROOF.eaveFt - ROOF.thicknessFt + plan.extWall * ROOF.pitch) * FT - 0.008);
  const Yz = (z, isWall) => (isWall && z <= 0 ? 0 : z >= H ? CEIL : FLOOR + z * FT);
  const [kit, ext] = await Promise.all([loadKit(), loadExterior(model.id, styleId)]);

  const root = new THREE.Group();
  const exportable = new THREE.Group(); // what goes into the AR walk-in model
  root.add(exportable);

  const PAINT = "#efe9df", TRIM = "#fbfaf6", BATH_PAINT = "#e7ecea";
  const shell = new BoxBatch(); // walls (painted)
  const trims = new BoxBatch(); // casings, baseboards, door leaves
  const ft = (x0, x1, y0, y1) => [X(x0), X(x1), Z(y1), Z(y0)];

  // walls
  const boxes = wallBoxes(plan, model);
  for (const b of boxes) {
    const [x0, x1, z0, z1] = ft(b.x0, b.x1, b.y0, b.y1);
    const inBath = (px, py) => roomAt(plan, px, py)?.type === "bath";
    // pick paint per face by which room it faces
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const color = (k) => {
      const probe = { px: [b.x1 + 0.3, cy], nx: [b.x0 - 0.3, cy], pz: [cx, b.y0 - 0.3], nz: [cx, b.y1 + 0.3] }[k];
      return probe && inBath(probe[0], probe[1]) ? BATH_PAINT : PAINT;
    };
    shell.box(x0, x1, Yz(b.z0, true), Yz(b.z1, true), z0, z1, color, { skip: b.z0 <= 0 ? new Set(["ny"]) : undefined });
    // baseboards on faces that meet the floor
    if (b.z0 <= 0) {
      const bh = 0.32 * FT, bt = 0.035;
      const longX = b.x1 - b.x0 >= b.y1 - b.y0;
      const faces = longX ? [["pz", b.y0], ["nz", b.y1]] : [["nx", b.x0], ["px", b.x1]];
      for (const [k, line] of faces) {
        if (b.ext && ((k === "pz" && b.n?.[1] < 0) || (k === "nz" && b.n?.[1] > 0) || (k === "nx" && b.n?.[0] < 0) || (k === "px" && b.n?.[0] > 0))) continue; // outer face
        if (longX) {
          const z = Z(line), dz = k === "pz" ? bt : -bt;
          trims.box(x0, x1, FLOOR, FLOOR + bh, z, z + dz, TRIM);
        } else {
          const x = X(line), dx = k === "px" ? bt : -bt;
          trims.box(x, x + dx, FLOOR, FLOOR + bh, z0, z1, TRIM);
        }
      }
    }
  }

  // window stools/casings and the front door threshold on the inside
  const { edges } = outline(plan, model);
  const t = plan.extWall;
  for (const op of exteriorOpenings(plan)) {
    const e = edges.find((q) => q.name === op.wall);
    if (!e) continue;
    const inward = e.horiz ? -e.n[1] : -e.n[0];
    const face = e.line + inward * t; // inner face line (plan ft)
    const a0 = op.at - op.w / 2, a1 = op.at + op.w / 2;
    const c = 0.28, d = 0.06; // casing width / projection (ft)
    const put = (s0, s1, o0, o1, zz0, zz1) => {
      const [p0, p1] = [face + inward * o0, face + inward * o1];
      if (e.horiz) trims.box(X(s0), X(s1), Yz(zz0), Yz(zz1), Z(p0), Z(p1), TRIM);
      else trims.box(X(p0), X(p1), Yz(zz0), Yz(zz1), Z(s0), Z(s1), TRIM);
    };
    put(a0 - c, a0, 0, d, op.sill, op.head + c);
    put(a1, a1 + c, 0, d, op.sill, op.head + c);
    put(a0, a1, 0, d, op.head, op.head + c);
    if (op.kind === "window") {
      put(a0 - c, a1 + c, -0.4, 0.22, op.sill - 0.08, op.sill); // stool
      put(a0 - c * 0.7, a1 + c * 0.7, 0, d, op.sill - 0.45, op.sill - 0.08); // apron
    }
    if (op.kind === "door") {
      // threshold across the wall thickness (and down to the porch)
      const [p0, p1] = [e.line, face];
      if (e.horiz) trims.box(X(a0), X(a1), 0, FLOOR + 0.01, Z(Math.max(p0, p1)), Z(Math.min(p0, p1)), "#cfc6b4");
    }
  }

  // interior door casings + open door leaves
  const leafColor = "#f7f5ef";
  const doorColliders = [];
  const items = furnitureItems(plan);
  const overlaps = (a, b2) => a[0] < b2[2] && a[2] > b2[0] && a[1] < b2[3] && a[3] > b2[1];
  const floorsFt = floorRects(plan, model);
  // places that a door leaf must not cover: solid walls, furniture, other doorways, windows
  const leafBlockers = [
    ...boxes.filter((b2) => b2.z0 < 3).map((b2) => [b2.x0, b2.y0, b2.x1, b2.y1]),
    ...items.filter((i) => !i.walkable).map(itemRect),
    ...interiorDoors(plan).map((q) => (q.horiz ? [q.at - q.w / 2, q.line - 1.4, q.at + q.w / 2, q.line + 1.4] : [q.line - 1.4, q.at - q.w / 2, q.line + 1.4, q.at + q.w / 2])),
  ];
  for (const op of exteriorOpenings(plan)) {
    const e = outline(plan, model).edges.find((q) => q.name === op.wall);
    if (!e) continue;
    const lo = Math.min(e.line, e.line - (e.horiz ? e.n[1] : e.n[0]) * (t + 1.4)), hi = Math.max(e.line, e.line - (e.horiz ? e.n[1] : e.n[0]) * (t + 1.4));
    leafBlockers.push(e.horiz ? [op.at - op.w / 2, lo, op.at + op.w / 2, hi] : [lo, op.at - op.w / 2, hi, op.at + op.w / 2]);
  }
  // A door leaf opened flat against the wall beside its opening (so it never blocks the doorway).
  // Tries each hinge side and wall face; falls back to standing open at 90° when nothing fits.
  function placeLeaf(horiz, line, half, a0, a1, faces, head, color, th = 0.12) {
    const L = a1 - a0 - 0.1, gap = 0.07;
    for (const side of faces) {
      for (const end of ["lo", "hi"]) {
        const s0 = end === "lo" ? a0 - L : a1, s1 = s0 + L;
        const c0 = side > 0 ? line + half + gap : line - half - gap - th, c1 = c0 + th;
        const r = horiz ? [s0, c0, s1, c1] : [c0, s0, c1, s1];
        const inFloor = floorsFt.some((f) => r[0] >= f.x0 - 0.01 && r[2] <= f.x1 + 0.01 && r[1] >= f.y0 - 0.01 && r[3] <= f.y1 + 0.01);
        if (!inFloor || leafBlockers.some((q) => overlaps(r, q))) continue;
        if (horiz) trims.box(X(r[0]), X(r[2]), FLOOR + 0.03, Yz(head - 0.05), Z(r[3]), Z(r[1]), color);
        else trims.box(X(r[0]), X(r[2]), FLOOR + 0.03, Yz(head - 0.05), Z(r[3]), Z(r[1]), color);
        return;
      }
    }
    // fallback: open 90° into the first face, hinged at the low end (no collider; it's thin)
    const side = faces[0];
    const c0 = side > 0 ? line + half : line - half - (a1 - a0 - 0.1);
    const r = horiz ? [a0 + 0.02, c0, a0 + 0.02 + th, c0 + (a1 - a0 - 0.1)] : [c0, a0 + 0.02, c0 + (a1 - a0 - 0.1), a0 + 0.02 + th];
    trims.box(X(r[0]), X(r[2]), FLOOR + 0.03, Yz(head - 0.05), Z(r[3]), Z(r[1]), color);
  }
  for (const dr of interiorDoors(plan)) {
    const ti = plan.intWall, c = 0.25, d = 0.05;
    const head = dr.leaf ? DOOR_HEAD_FT : 7.2;
    const a0 = dr.at - dr.w / 2, a1 = dr.at + dr.w / 2;
    for (const side of [-1, 1]) {
      const f0 = dr.line + side * (ti / 2), f1 = f0 + side * d;
      const put = (s0, s1, zz0, zz1) => {
        if (dr.horiz) trims.box(X(s0), X(s1), Yz(zz0), Yz(zz1), Z(f0), Z(f1), TRIM);
        else trims.box(X(f0), X(f1), Yz(zz0), Yz(zz1), Z(s0), Z(s1), TRIM);
      };
      put(a0 - c, a0, 0, head + c);
      put(a1, a1 + c, 0, head + c);
      put(a0, a1, head, head + c);
    }
    if (dr.leaf) placeLeaf(dr.horiz, dr.line, plan.intWall / 2, a0, a1, [1, -1], head, leafColor);
  }
  // front door, swung open flat against the inside of the front wall
  {
    const fd = plan.frontDoor;
    placeLeaf(true, t / 2, t / 2, fd.at - fd.w / 2, fd.at + fd.w / 2, [1], DOOR_HEAD_FT, styleId === "craftsman" ? "#5c4029" : "#f7f5ef", 0.15);
  }

  // floors and ceilings
  const lvp = lvpTexture(), tile = tileTexture();
  lvp.anisotropy = tile.anisotropy = 4;
  const floorMat = new THREE.MeshLambertMaterial({ map: lvp });
  const tileMat = new THREE.MeshLambertMaterial({ map: tile });
  const ceilMat = new THREE.MeshLambertMaterial({ color: "#f6f4ef", emissive: "#4a4740" });
  const floorGeos = [], ceilGeos = [], tileGeos = [];
  const pad = 0.05;
  for (const r of floorRects(plan, model)) {
    const [x0, x1, z0, z1] = ft(r.x0 - pad, r.x1 + pad, r.y0 - pad, r.y1 + pad);
    floorGeos.push(planeXZ(x0, x1, z0, z1, FLOOR, true, 4 * FT));
    ceilGeos.push(planeXZ(x0, x1, z0, z1, CEIL, false));
  }
  for (const r of plan.rooms.filter((q) => q.type === "bath" || q.type === "laundry")) {
    const [x0, x1, z0, z1] = ft(r.x, r.x + r.w, r.y, r.y + r.d);
    tileGeos.push(planeXZ(x0, x1, z0, z1, FLOOR + 0.003, true, 4 * FT));
  }
  const floorMesh = new THREE.Mesh(mergeGeometries(floorGeos), floorMat);
  floorMesh.receiveShadow = true;
  floorMesh.name = "floor";
  const ceilMesh = new THREE.Mesh(mergeGeometries(ceilGeos), ceilMat);
  ceilMesh.castShadow = true;
  exportable.add(floorMesh);
  root.add(ceilMesh);
  let tileMesh = null;
  if (tileGeos.length) {
    tileMesh = new THREE.Mesh(mergeGeometries(tileGeos), tileMat);
    tileMesh.receiveShadow = true;
    tileMesh.name = "floor";
    exportable.add(tileMesh);
  }
  // simple flush ceiling lights, one per room
  const lampGeos = [];
  for (const r of plan.rooms) {
    if (r.type === "closet") continue;
    const g = new THREE.CircleGeometry(r.type === "hall" ? 0.12 : 0.18, 20);
    g.rotateX(Math.PI / 2);
    g.translate(X(r.x + r.w / 2), CEIL - 0.01, Z(r.y + r.d / 2));
    lampGeos.push(g);
  }
  root.add(new THREE.Mesh(mergeGeometries(lampGeos), new THREE.MeshBasicMaterial({ color: "#fffdf3" })));

  // furniture: every piece scaled to its real size and merged into a single mesh
  const pieces = [];
  for (const it of items) {
    if (it.key === "upper") {
      // wall cabinets are simple boxes (the kit's upper cabinet doesn't read well at this scale)
      const [x0, y0, x1, y1] = itemRect(it);
      const zb = FLOOR + it.elev * FT, zt = zb + it.h * FT;
      trims.box(X(x0), X(x1), zb, zt, Z(y1), Z(y0), "#e4ded2");
      continue;
    }
    const src = kit[it.key];
    if (!src) continue;
    const g = src.clone();
    const bb = g.boundingBox;
    const sx = (it.w * FT) / (bb.max.x - bb.min.x), sy = (it.h * FT) / (bb.max.y - bb.min.y), sz = (it.d * FT) / (bb.max.z - bb.min.z);
    g.scale(sx, sy, sz);
    g.rotateY((it.rot * Math.PI) / 180);
    g.translate(X(it.x), FLOOR + it.elev * FT + (it.walkable ? 0.004 : 0), Z(it.y));
    if (!g.attributes.color) continue;
    // normalize the color attribute type so pieces merge cleanly
    const col = g.attributes.color;
    if (!(col.array instanceof Float32Array)) {
      const f = new Float32Array(col.count * 3);
      for (let i = 0; i < col.count; i++) { f[i * 3] = col.getX(i); f[i * 3 + 1] = col.getY(i); f[i * 3 + 2] = col.getZ(i); }
      g.setAttribute("color", new THREE.BufferAttribute(f, 3));
    } else if (col.itemSize === 4) {
      const f = new Float32Array(col.count * 3);
      for (let i = 0; i < col.count; i++) { f[i * 3] = col.getX(i); f[i * 3 + 1] = col.getY(i); f[i * 3 + 2] = col.getZ(i); }
      g.setAttribute("color", new THREE.BufferAttribute(f, 3));
    }
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color"].includes(k)) g.deleteAttribute(k);
    pieces.push(g.index ? g.toNonIndexed() : g);
  }
  if (pieces.length) {
    const furn = new THREE.Mesh(mergeGeometries(pieces), new THREE.MeshLambertMaterial({ vertexColors: true }));
    furn.castShadow = true; furn.receiveShadow = true;
    exportable.add(furn);
  }

  // painted walls + all the white trim (casings, baseboards, door leaves, wall cabinets)
  const shellMesh = new THREE.Mesh(shell.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  shellMesh.castShadow = true; shellMesh.receiveShadow = true;
  const trimMesh = new THREE.Mesh(trims.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  trimMesh.receiveShadow = true; trimMesh.castShadow = true;
  exportable.add(shellMesh, trimMesh);

  // the exterior model (siding, trim, roof, porch, glass) for this plan + style
  const shellGLB = ext.scene.clone(true);
  shellGLB.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name;
    if (name === "door" || name === "lite") { o.visible = false; return; }
    o.material = o.material.clone();
    if (name === "glass") {
      o.material.transparent = true;
      o.material.opacity = 0.14;
      o.material.depthWrite = false;
      o.castShadow = false;
    } else {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  exportable.add(shellGLB);
  const porchFloors = [];
  shellGLB.traverse((o) => { if (o.isMesh && o.material?.name === "porch") porchFloors.push(o); });

  // room labels
  const labels = new THREE.Group();
  for (const r of plan.rooms) {
    if (r.type === "closet" || r.type === "hall") continue;
    const { tex, aspect } = labelTexture(roomLabel(r));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    const h = 0.2;
    s.scale.set(h * aspect, h, 1);
    s.position.set(X(r.x + r.w / 2), FLOOR + 7.3 * FT, Z(r.y + r.d / 2));
    s.renderOrder = 5;
    labels.add(s);
  }
  root.add(labels);

  // collision (plan feet): full-height wall pieces + floor furniture + door leaves + patio glass
  const colliders = boxes.filter((b) => b.z0 < 3).map((b) => [b.x0, b.y0, b.x1, b.y1]);
  for (const it of items) if (!it.walkable && !it.elev) colliders.push(itemRect(it));
  colliders.push(...doorColliders);
  for (const op of exteriorOpenings(plan)) {
    if (op.kind !== "patio") continue;
    const e = edges.find((q) => q.name === op.wall);
    const a0 = op.at - op.w / 2, a1 = op.at + op.w / 2;
    if (e.horiz) colliders.push([a0, Math.min(e.line, e.line - e.n[1] * t), a1, Math.max(e.line, e.line - e.n[1] * t)]);
    else colliders.push([Math.min(e.line, e.line - e.n[0] * t), a0, Math.max(e.line, e.line - e.n[0] * t), a1]);
  }
  // keep visitors in the yard: a fence around the house
  const o = outline(plan, model);
  const xs = o.verts.map((v) => v[0]), ys = o.verts.map((v) => v[1]);
  const yard = { x0: Math.min(...xs) - 14, x1: Math.max(...xs) + 14, y0: Math.min(...ys) - 16, y1: Math.max(...ys) + 12 };
  const fenceT = 0.5;
  colliders.push([yard.x0 - fenceT, yard.y0, yard.x0, yard.y1], [yard.x1, yard.y0, yard.x1 + fenceT, yard.y1], [yard.x0, yard.y0 - fenceT, yard.x1, yard.y0], [yard.x0, yard.y1, yard.x1, yard.y1 + fenceT]);

  // yard: grass, a wood fence, a few trees, sky
  const outside = new THREE.Group();
  const grass = grassTexture();
  const ground = new THREE.Mesh(planeXZ(-120, 120, -120, 120, 0, true, 3), new THREE.MeshLambertMaterial({ map: grass }));
  ground.receiveShadow = true;
  ground.name = "ground";
  outside.add(ground);
  const fence = new BoxBatch();
  const fh = 6 * FT;
  const [fx0, fx1, fz0, fz1] = ft(yard.x0, yard.x1, yard.y0, yard.y1);
  for (const [a, b, c2, d2] of [[fx0, fx1, fz0, fz0 + 0.04], [fx0, fx1, fz1 - 0.04, fz1], [fx0, fx0 + 0.04, fz0, fz1], [fx1 - 0.04, fx1, fz0, fz1]]) fence.box(a, b, 0, fh, c2, d2, "#a5876a");
  for (let x = fx0; x <= fx1; x += 2.4) { fence.box(x - 0.05, x + 0.05, 0, fh + 0.05, fz0 - 0.05, fz0 + 0.09, "#8b6f55"); fence.box(x - 0.05, x + 0.05, 0, fh + 0.05, fz1 - 0.09, fz1 + 0.05, "#8b6f55"); }
  for (let z = fz0; z <= fz1; z += 2.4) { fence.box(fx0 - 0.05, fx0 + 0.09, 0, fh + 0.05, z - 0.05, z + 0.05, "#8b6f55"); fence.box(fx1 - 0.09, fx1 + 0.05, 0, fh + 0.05, z - 0.05, z + 0.05, "#8b6f55"); }
  const fenceMesh = new THREE.Mesh(fence.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  fenceMesh.receiveShadow = true;
  outside.add(fenceMesh);
  // trees beyond the fence
  const r = rng(5), treeGeos = [];
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + r() * 0.4;
    const rad = Math.max(fx1 - fx0, fz1 - fz0) / 2 + 4 + r() * 6;
    const cx = (fx0 + fx1) / 2 + Math.cos(ang) * rad, cz = (fz0 + fz1) / 2 + Math.sin(ang) * rad;
    const hgt = 5 + r() * 4;
    const trunk = new THREE.CylinderGeometry(0.18, 0.25, hgt * 0.45, 6).translate(cx, hgt * 0.22, cz);
    const crown = new THREE.IcosahedronGeometry(hgt * 0.32, 0).translate(cx, hgt * 0.62, cz);
    const paint = (g, c) => { const col = new THREE.Color(c); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let k = 0; k < n; k++) a.set([col.r, col.g, col.b], k * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); g.deleteAttribute("uv"); return g.index ? g.toNonIndexed() : g; };
    treeGeos.push(paint(trunk, "#6b5240"), paint(crown, i % 2 ? "#5d7d43" : "#4f6f3c"));
  }
  const trees = new THREE.Mesh(mergeGeometries(treeGeos), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  trees.castShadow = true;
  outside.add(trees);
  // sky dome with a vertical gradient
  const skyGeo = new THREE.SphereGeometry(300, 24, 12);
  const top = new THREE.Color("#7fb2df"), hor = new THREE.Color("#e6eef2");
  const sc = new Float32Array(skyGeo.attributes.position.count * 3);
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const k = Math.max(0, skyGeo.attributes.position.getY(i) / 300);
    const c = hor.clone().lerp(top, Math.pow(k, 0.6));
    sc.set([c.r, c.g, c.b], i * 3);
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  outside.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false })));
  root.add(outside);

  // sun: mid-afternoon in the Valley (from the south-west), turned into the house's frame
  const SUN_AZ = 222, SUN_EL = 40;
  const d = ((SUN_AZ - heading) * Math.PI) / 180, el = (SUN_EL * Math.PI) / 180;
  const sunDir = new THREE.Vector3(-Math.sin(d) * Math.cos(el), Math.sin(el), Math.cos(d) * Math.cos(el)).normalize();

  return {
    root, exportable, labels, ceilMesh, shellGLB, colliders, yard, sunDir, items,
    floors: [floorMesh, ground, ...porchFloors, ...(tileMesh ? [tileMesh] : [])],
    toScene: (x, y) => new THREE.Vector3(X(x), 0, Z(y)),
    toPlan: (v) => [fr.fromX(v.x), fr.fromZ(v.z)],
    extent: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
  };
}

// ---------------------------------------------------------------- navigation (plan feet)
function circleRectPush(x, y, r, b) {
  const cx = Math.max(b[0], Math.min(x, b[2])), cy = Math.max(b[1], Math.min(y, b[3]));
  const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; return [dx * k, dy * k]; }
  // center inside the box: push out the shortest way
  const opts = [[b[0] - r - x, 0], [b[2] + r - x, 0], [0, b[1] - r - y], [0, b[3] + r - y]];
  return opts.sort((a, b2) => Math.hypot(...a) - Math.hypot(...b2))[0];
}

export function makeNav(colliders, yard) {
  function resolve(x, y) {
    for (let it = 0; it < 6; it++) {
      let moved = false;
      for (const b of colliders) {
        const p = circleRectPush(x, y, RADIUS_FT, b);
        if (p) { x += p[0]; y += p[1]; moved = true; }
      }
      if (!moved) break;
    }
    return [x, y];
  }
  function move(x, y, dx, dy) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
    for (let i = 0; i < steps; i++) [x, y] = resolve(x + dx / steps, y + dy / steps);
    return [x, y];
  }
  // occupancy grid for A*
  const cell = 0.5;
  const gx0 = yard.x0, gy0 = yard.y0;
  const nx = Math.ceil((yard.x1 - yard.x0) / cell), ny = Math.ceil((yard.y1 - yard.y0) / cell);
  const blocked = new Uint8Array(nx * ny);
  const R = RADIUS_FT + 0.1;
  for (const b of colliders) {
    const i0 = Math.max(0, Math.floor((b[0] - R - gx0) / cell)), i1 = Math.min(nx - 1, Math.ceil((b[2] + R - gx0) / cell));
    const j0 = Math.max(0, Math.floor((b[1] - R - gy0) / cell)), j1 = Math.min(ny - 1, Math.ceil((b[3] + R - gy0) / cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const px = gx0 + (i + 0.5) * cell, py = gy0 + (j + 0.5) * cell;
      const cx = Math.max(b[0], Math.min(px, b[2])), cy = Math.max(b[1], Math.min(py, b[3]));
      if ((px - cx) ** 2 + (py - cy) ** 2 < R * R) blocked[j * nx + i] = 1;
    }
  }
  const idx = (x, y) => { const i = Math.floor((x - gx0) / cell), j = Math.floor((y - gy0) / cell); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
  const center = (k) => [gx0 + ((k % nx) + 0.5) * cell, gy0 + (Math.floor(k / nx) + 0.5) * cell];
  function nearestFree(x, y, maxR = 8) {
    const k = idx(x, y);
    if (k >= 0 && !blocked[k]) return [x, y];
    let best = null, bd = Infinity;
    const rr = Math.ceil(maxR / cell);
    const i0 = Math.floor((x - gx0) / cell), j0 = Math.floor((y - gy0) / cell);
    for (let i = i0 - rr; i <= i0 + rr; i++) for (let j = j0 - rr; j <= j0 + rr; j++) {
      if (i < 0 || j < 0 || i >= nx || j >= ny || blocked[j * nx + i]) continue;
      const [px, py] = center(j * nx + i), dd = (px - x) ** 2 + (py - y) ** 2;
      if (dd < bd) { bd = dd; best = [px, py]; }
    }
    return best;
  }
  function lineFree(a, b) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5));
    for (let s = 0; s <= n; s++) {
      const k = idx(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n);
      if (k < 0 || blocked[k]) return false;
    }
    return true;
  }
  // Dijkstra over the whole grid from `from`, then pick the best reachable goal:
  // inside `rect` (a room) nearest its middle, or nearest the point `to`.
  function path(from, to, rect = null) {
    let start = idx(from[0], from[1]);
    if (start < 0) return null;
    if (blocked[start]) { const s = nearestFree(from[0], from[1], 3); if (!s) return null; start = idx(s[0], s[1]); }
    const dist = new Float64Array(nx * ny).fill(Infinity), came = new Int32Array(nx * ny).fill(-1);
    dist[start] = 0;
    const heap = [[0, start]];
    const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, k] = pop();
      if (d > dist[k]) continue;
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const nk = nj * nx + ni;
        if (blocked[nk] || (di && dj && (blocked[j * nx + ni] || blocked[nj * nx + i]))) continue;
        const nd = d + (di && dj ? 1.414 : 1) * cell;
        if (nd < dist[nk]) { dist[nk] = nd; came[nk] = k; push([nd, nk]); }
      }
    }
    // choose the goal cell
    const tx = rect ? (rect[0] + rect[2]) / 2 : to[0], ty = rect ? (rect[1] + rect[3]) / 2 : to[1];
    let gk = -1, best = Infinity;
    for (let k = 0; k < nx * ny; k++) {
      if (dist[k] === Infinity) continue;
      const [cx, cy] = center(k);
      if (rect && (cx < rect[0] + 0.2 || cx > rect[2] - 0.2 || cy < rect[1] + 0.2 || cy > rect[3] - 0.2)) continue;
      const dd = (cx - tx) ** 2 + (cy - ty) ** 2;
      if (dd < best) { best = dd; gk = k; }
    }
    if (gk < 0 || gk === start) return null;
    if (!rect && best > 16) return null; // tapped somewhere you can't stand (e.g. behind furniture)
    const cells = [];
    for (let k = gk; k !== -1 && k !== start; k = came[k]) cells.push(center(k));
    cells.reverse();
    if (!rect && idx(to[0], to[1]) === gk) cells[cells.length - 1] = to;
    // string-pull to straight segments
    const pts = [from];
    let anchor = from;
    for (let i = 0; i < cells.length; i++) {
      const next = cells[i + 1];
      if (!next || !lineFree(anchor, next)) { pts.push(cells[i]); anchor = cells[i]; }
    }
    return pts;
  }
  return { move, resolve, path, nearestFree, grid: { blocked, nx, ny, cell, gx0, gy0 } };
}

// ---------------------------------------------------------------- the interactive tour
export async function createTour({ canvas, plan, model, styleId, heading = 180, mobile = false, onPose, onRoom }) {
  const isPhone = mobile;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isPhone || window.devicePixelRatio < 2, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // everything is static: draw the shadow map once

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e6eef2", 60, 260);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);

  let built = await buildTourScene({ plan, model, styleId, heading });
  scene.add(built.root);
  const hemi = new THREE.HemisphereLight("#fbf8f1", "#d9ccb5", 1.55);
  const amb = new THREE.AmbientLight("#ffffff", 0.45);
  const sun = new THREE.DirectionalLight("#fff1dc", 2.4);
  scene.add(hemi, amb, sun, sun.target);
  function placeSun() {
    const c = built.toScene((built.extent.x0 + built.extent.x1) / 2, (built.extent.y0 + built.extent.y1) / 2);
    const span = Math.max(built.extent.x1 - built.extent.x0, built.extent.y1 - built.extent.y0) * FT;
    sun.position.copy(c).addScaledVector(built.sunDir, 40);
    sun.target.position.copy(c);
    const cam = sun.shadow.camera;
    const half = span * 0.75 + 3;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 10; cam.far = 80;
    cam.updateProjectionMatrix();
    sun.castShadow = true;
    sun.shadow.mapSize.set(isPhone ? 1024 : 2048, isPhone ? 1024 : 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    renderer.shadowMap.needsUpdate = true;
  }
  placeSun();

  let nav = makeNav(built.colliders, built.yard);
  const start = entryPose(plan, model);
  const pose = { x: start.x, y: start.y, yaw: 0, pitch: -0.04 };
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  let glide = null; // {pts, i, finalYaw}
  let lastRoom = null;

  function setCamera() {
    const v = built.toScene(pose.x, pose.y);
    camera.position.set(v.x, FLOOR + (pose.eyeFt ?? EYE_FT) * FT, v.z);
    camera.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 78 : 70;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function walkTo(tx, ty, rect = null) {
    const pts = nav.path([pose.x, pose.y], [tx, ty], rect);
    if (!pts || pts.length < 2) return false;
    glide = { pts, i: 1 };
    return true;
  }
  // glide to the open floor nearest the room's middle (reachable from here), facing the way we walked
  function goToRoom(id) {
    const r = plan.rooms.find((q) => q.id === id);
    if (!r) return false;
    return walkTo(0, 0, [r.x, r.y, r.x + r.w, r.y + r.d]);
  }

  const clock = new THREE.Timer();
  let running = true, frames = 0, fpsT = 0, fps = 60;
  const angleTo = (dx, dy) => Math.atan2(-dx, dy); // plan direction -> yaw
  function tick() {
    if (!running) return;
    clock.update();
    const dt = Math.min(0.05, clock.getDelta());
    frames++; fpsT += dt;
    if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    // input: keys + joystick
    let f = 0, s = 0, turn = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD")) s += 1;
    if (keys.has("KeyA")) s -= 1;
    if (keys.has("ArrowLeft") || keys.has("KeyQ")) turn += 1;
    if (keys.has("ArrowRight") || keys.has("KeyE")) turn -= 1;
    f += -joy.y; s += joy.x;
    pose.yaw += turn * 1.8 * dt;
    if (f || s) {
      glide = null;
      const len = Math.max(1, Math.hypot(f, s));
      const fx = -Math.sin(pose.yaw), fy = Math.cos(pose.yaw), rx = Math.cos(pose.yaw), ry = Math.sin(pose.yaw);
      const speed = WALK_FTPS * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1.7 : 1);
      const dx = ((fx * f + rx * s) / len) * speed * dt, dy = ((fy * f + ry * s) / len) * speed * dt;
      [pose.x, pose.y] = nav.move(pose.x, pose.y, dx, dy);
    } else if (glide) {
      const [tx, ty] = glide.pts[glide.i];
      const dx = tx - pose.x, dy = ty - pose.y, dist = Math.hypot(dx, dy);
      const step = GLIDE_FTPS * dt * (window.__tourFast || 1); // __tourFast: test hook
      if (dist > 0.05) {
        const want = angleTo(dx, dy);
        let dyaw = ((want - pose.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        pose.yaw += dyaw * Math.min(1, dt * 5);
        pose.pitch += (-0.04 - pose.pitch) * Math.min(1, dt * 3);
      }
      if (dist <= step) {
        pose.x = tx; pose.y = ty;
        glide.i++;
        if (glide.i >= glide.pts.length) glide = null;
      } else {
        // the A* path already keeps the body clear of walls, so glide straight along it
        pose.x += (dx / dist) * step;
        pose.y += (dy / dist) * step;
      }
    }
    setCamera();
    // fade labels by distance so the nearest room's label doesn't fill the screen
    for (const s2 of built.labels.children) {
      const dd = s2.position.distanceTo(camera.position);
      s2.material.opacity = THREE.MathUtils.clamp((dd - 1.2) / 1.5, 0, 1);
      s2.visible = s2.material.opacity > 0.02;
    }
    renderer.render(scene, camera);
    onPose?.(pose, fps);
    const room = roomAt(plan, pose.x, pose.y);
    if ((room?.id || null) !== lastRoom) { lastRoom = room?.id || null; onRoom?.(room); }
    requestAnimationFrame(tick);
  }

  // look controls
  function look(dx, dy, k = 0.0024) {
    pose.yaw -= dx * k;
    pose.pitch = THREE.MathUtils.clamp(pose.pitch - dy * k, -1.2, 1.2);
  }
  // tap/click the floor to walk there
  const ray = new THREE.Raycaster();
  function floorPointAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...built.floors, built.root], true).filter((h) => h.object.visible && h.object.material && !h.object.material.transparent);
    const hit = hits[0];
    if (!hit || !built.floors.includes(hit.object)) return null;
    return built.toPlan(hit.point);
  }
  function tapAt(clientX, clientY) {
    const p = floorPointAt(clientX, clientY);
    if (!p) return false;
    return walkTo(p[0], p[1]);
  }

  async function setStyle(newStyle) {
    styleId = newStyle;
    const next = await buildTourScene({ plan, model, styleId, heading });
    scene.remove(built.root);
    disposeTree(built.root);
    built = next;
    scene.add(built.root);
    nav = makeNav(built.colliders, built.yard);
    placeSun();
  }

  setCamera();
  requestAnimationFrame(tick);
  return {
    keys, joy, pose, look, tapAt, walkTo, goToRoom, setStyle, resize, renderer, scene, camera,
    get fps() { return fps; },
    setLabels(on) { built.labels.visible = on; },
    get nav() { return nav; },
    get colliders() { return built.colliders; },
    get walking() { return !!glide; },
    reset() { pose.x = start.x; pose.y = start.y; pose.yaw = 0; pose.pitch = -0.04; glide = null; },
    dispose() {
      running = false;
      ro.disconnect();
      disposeTree(scene);
      renderer.dispose();
    },
  };
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose(); m.dispose(); }
  });
}

// ---------------------------------------------------------------- AR export
// Builds the same interior (no ceiling, no yard) inside the exterior model and returns a GLB blob.
export async function exportWalkInGLB({ plan, model, styleId }) {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const built = await buildTourScene({ plan, model, styleId });
  const group = built.exportable.clone(true);
  group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const m = o.material;
    o.material = new THREE.MeshStandardMaterial({
      name: m.name, color: m.color, map: m.map || null, vertexColors: !!m.vertexColors,
      roughness: m.roughness ?? 0.85, metalness: m.metalness ?? 0, transparent: !!m.transparent, opacity: m.opacity ?? 1,
    });
  });
  // drop hidden door meshes and the roof: a roofless "dollhouse" shows the rooms from the yard
  const hidden = [];
  group.traverse((o) => { if (o.isMesh && (!o.visible || o.material?.name === "roof")) hidden.push(o); });
  hidden.forEach((o) => o.parent?.remove(o));
  const buf = await new GLTFExporter().parseAsync(group, { binary: true });
  disposeTree(built.root);
  return new Blob([buf], { type: "model/gltf-binary" });
}
