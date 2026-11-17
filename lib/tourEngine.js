// Walk-in interior tour, generated from the floor-plan JSON (lib/floorplans/*.json).
// Scene units are meters in the exterior model's frame (x right, z toward the front door, y up),
// so the generated interior sits exactly inside public/models/<plan>-<style>.glb.
// Walking, collision and path-finding happen in plan feet (see lib/floorplan.js).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { orientKitGeometry } from "./kitOrient.js";
import {
  FLOOR_FT, DOOR_HEAD_FT, outline, floorRects, wallBoxes, exteriorOpenings, doorways,
  furnitureItems, itemRect, roomLabel, roomAt, entryPose, planToModelFrame, collidersFor, yardRect,
} from "./floorplan.js";
import { makeNav, roomViews, EYE_FT } from "./planNav.js";
import { modelSrc, ROOF } from "./models.js";
import { loadMaterialLibrary, setTextureBudget } from "./tourMaterials.js";
import { addLightmapUVs, loadBake, layoutKey, setLightmapRenderer } from "./lightmap.js";
import { placeFurniture, loadFurnitureManifest } from "./tourFurniture.js";
import { buildFixtures, buildWallDevices, buildFixturesCeiling, buildArt, Batches } from "./tourDetails.js";
import { FACE_ANGLE, FACE_VEC } from "./floorplan.js";

const FT = 0.3048;
const FLOOR = FLOOR_FT * FT;
const WALK_FTPS = 4.6;

// ---------------------------------------------------------------- asset loading (cached)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // the furniture kit is meshopt-compressed
let kitPromise = null;
function loadKit() {
  kitPromise ??= loader.loadAsync("/models/furniture-kit.glb").then((g) => {
    const out = {};
    g.scene.traverse((o) => {
      if (o.isMesh) {
        // meshopt quantization keeps positions as integers and puts the scale in the node: bake it in
        o.updateMatrix();
        const geo = o.geometry.clone();
        for (const k of Object.keys(geo.attributes)) { const a = geo.attributes[k]; if (a.normalized || a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array)) geo.setAttribute(k, deinterleave(a)); }
        geo.applyMatrix4(o.matrix);
        orientKitGeometry(geo); // the kit faces -Z; the tour wants fronts at +Z (lib/kitOrient.js)
        out[o.name] = geo;
      }
    });
    return out;
  });
  return kitPromise;
}
// plain Float32 copy of a (normalized / interleaved) attribute, so merging and transforms stay simple
function deinterleave(a) {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(out, a.itemSize);
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
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.hide = []; }
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
      this.hide.push(!!opts.hidden?.has(k)); // never seen: no room in the lightmap
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
    g.userData.lmSkip = this.hide;
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

// toilets, tubs and showers from the kit get a glossy porcelain finish
const GLOSSY = new Set(["toilet", "bathtub", "shower"]);
const faceOf = (n) => (Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? "right" : "left") : n[1] > 0 ? "back" : "front");

// Keeps only the parts of each outlet run that have a full-height wall behind them, and the switches
// that do. A point counts as on a wall when the spot 2" behind its face is inside a wall box.
function onRealWalls({ segments, switches }, boxes) {
  const inWall = (x, y) => boxes.some((b) => x >= b.x0 - 0.02 && x <= b.x1 + 0.02 && y >= b.y0 - 0.02 && y <= b.y1 + 0.02);
  const behind = (x, y, n) => inWall(x - n[0] * 0.17, y - n[1] * 0.17);
  const out = [];
  for (const s of segments) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), steps = Math.max(1, Math.ceil(len / 0.25));
    let run = null;
    const flush = (t1) => { if (run !== null && (t1 - run) * len >= 2.5) out.push({ ...s, a: lerp2(s.a, s.b, run), b: lerp2(s.a, s.b, t1) }); run = null; };
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, [x, y] = lerp2(s.a, s.b, t);
      if (behind(x, y, s.n)) { if (run === null) run = t; } else flush(Math.max(0, (i - 1) / steps));
    }
    flush(1);
  }
  return { segments: out, switches: switches.filter((w) => behind(w.x, w.y, w.n)) };
}
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Wall runs inside each room for outlets (skipping doors, windows and tall pieces) and a light
// switch on the latch side of every door. Plan feet; n points into the room.
function wallSegments(plan, model, items) {
  const segments = [], switches = [];
  const doors = doorways(plan, model);
  const windows = exteriorOpenings(plan);
  const { edges } = outline(plan, model);
  const tall = items.filter((it) => ["fridge", "bookcase", "washerDryer", "shower", "bathtub", "dresser", "tvStand"].includes(it.key));
  const counters = items.filter((it) => ["cabinet", "sink", "range"].includes(it.key));
  for (const r of plan.rooms) {
    if (r.type === "closet") continue;
    const sides = [
      { line: r.y, horiz: true, a: r.x, b: r.x + r.w, n: [0, 1] }, { line: r.y + r.d, horiz: true, a: r.x, b: r.x + r.w, n: [0, -1] },
      { line: r.x, horiz: false, a: r.y, b: r.y + r.d, n: [1, 0] }, { line: r.x + r.w, horiz: false, a: r.y, b: r.y + r.d, n: [-1, 0] },
    ];
    for (const sd of sides) {
      // blocked spans along this side
      const cuts = [];
      for (const d of doors) if (d.horiz === sd.horiz && Math.abs(d.line - sd.line) < d.half + 0.3) cuts.push([d.at - d.w / 2 - 0.4, d.at + d.w / 2 + 0.4]);
      for (const w of windows) {
        const e = edges.find((q) => q.name === w.wall);
        if (e && e.horiz === sd.horiz && Math.abs(e.line - sd.line) < plan.extWall + 0.3 && (w.kind !== "window" || w.sill < 2)) cuts.push([w.at - w.w / 2 - 0.3, w.at + w.w / 2 + 0.3]);
      }
      const near = (it) => { const [x0, y0, x1, y1] = itemRect(it); return sd.horiz ? (Math.min(Math.abs(y0 - sd.line), Math.abs(y1 - sd.line)) < 0.3 ? [x0, x1] : null) : (Math.min(Math.abs(x0 - sd.line), Math.abs(x1 - sd.line)) < 0.3 ? [y0, y1] : null); };
      for (const it of tall) { const sp = near(it); if (sp) cuts.push([sp[0] - 0.2, sp[1] + 0.2]); }
      const counterSpans = counters.map((it) => (it.key === "range" ? null : near(it))).filter(Boolean);
      for (const it of counters) { const sp = near(it); if (sp) cuts.push(sp); }
      // what's left is plain wall
      let pieces = [[sd.a + 0.6, sd.b - 0.6]];
      for (const [c0, c1] of cuts) pieces = pieces.flatMap(([p0, p1]) => (c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, Math.max(p0, c0)], [Math.min(p1, c1), p1]].filter(([q0, q1]) => q1 - q0 > 0.4)));
      const P = (t) => (sd.horiz ? [t, sd.line] : [sd.line, t]);
      for (const [p0, p1] of pieces) segments.push({ a: P(p0), b: P(p1), n: sd.n, kind: "wall" });
      for (const [p0, p1] of counterSpans) segments.push({ a: P(p0), b: P(p1), n: sd.n, kind: "counter" });
    }
  }
  for (const d of doors) {
    if (d.kind !== "swing") continue;
    const latch = d.hinge === "lo" ? d.at + d.w / 2 + 0.45 : d.at - d.w / 2 - 0.45;
    const off = d.line + d.swing * (d.half + 0.01);
    switches.push(d.horiz ? { x: latch, y: off, n: [0, d.swing] } : { x: off, y: latch, n: [d.swing, 0] });
  }
  return { segments, switches };
}

// ---------------------------------------------------------------- scene builder (no renderer)
// Returns everything the tour needs; also used headless to export the interior for AR.
export async function buildTourScene({ plan, model, styleId, heading = 180, useBake = true }) {
  const fr = planToModelFrame(model);
  const X = fr.x, Z = fr.z;
  const H = plan.wallHeight || 9;
  // ceiling sits just under the roof slab where it crosses the inside face of the eave walls
  const CEIL = Math.min(FLOOR + H * FT, (ROOF.eaveFt - ROOF.thicknessFt + plan.extWall * ROOF.pitch) * FT - 0.008);
  const Yz = (z, isWall) => (isWall && z <= 0 ? 0 : z >= H ? CEIL : FLOOR + z * FT);
  const [kit, ext, lib, bake] = await Promise.all([loadKit(), loadExterior(model.id, styleId), loadMaterialLibrary(), useBake ? loadBake(plan, model) : null, loadFurnitureManifest()]);

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
    // hidden faces: tops/bottoms (under the ceiling, on the floor) and the outer face of an exterior wall (behind the siding)
    const outer = b.ext && b.n ? (b.n[1] < 0 ? "pz" : b.n[1] > 0 ? "nz" : b.n[0] < 0 ? "nx" : "px") : null;
    shell.box(x0, x1, Yz(b.z0, true), Yz(b.z1, true), z0, z1, color, { skip: b.z0 <= 0 ? new Set(["ny"]) : undefined, hidden: new Set(["py", "ny", ...(outer ? [outer] : [])]) });
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

  // door casings, the open door leaves (at 90°, exactly where the 2D plan draws them) and closet sliders
  const leafColor = "#f7f5ef";
  const items = furnitureItems(plan);
  for (const dr of doorways(plan, model)) {
    const c = 0.25, d = 0.05;
    const head = dr.kind === "opening" ? 7.2 : DOOR_HEAD_FT;
    const a0 = dr.at - dr.w / 2, a1 = dr.at + dr.w / 2;
    if (!dr.front) {
      for (const side of [-1, 1]) {
        const f0 = dr.line + side * dr.half, f1 = f0 + side * d;
        const put = (s0, s1, zz0, zz1) => {
          if (dr.horiz) trims.box(X(s0), X(s1), Yz(zz0), Yz(zz1), Z(f0), Z(f1), TRIM);
          else trims.box(X(f0), X(f1), Yz(zz0), Yz(zz1), Z(s0), Z(s1), TRIM);
        };
        put(a0 - c, a0, 0, head + c);
        put(a1, a1 + c, 0, head + c);
        put(a0, a1, head, head + c);
      }
    }
    if (dr.kind === "swing") {
      const r = dr.leaf;
      const col = dr.front ? (styleId === "craftsman" ? "#5c4029" : "#f7f5ef") : leafColor;
      trims.box(X(r[0]), X(r[2]), FLOOR + 0.03, Yz(DOOR_HEAD_FT - 0.05), Z(r[3]), Z(r[1]), col);
    } else if (dr.kind === "slider") {
      // two bypass panels, closed, set in the opening
      for (const [s0, s1, off] of [[a0, dr.at + 0.15, -0.06], [dr.at - 0.15, a1, 0.06]]) {
        const r = dr.horiz ? [s0, dr.line + off - 0.04, s1, dr.line + off + 0.04] : [dr.line + off - 0.04, s0, dr.line + off + 0.04, s1];
        trims.box(X(r[0]), X(r[2]), FLOOR + 0.02, Yz(DOOR_HEAD_FT - 0.02), Z(r[3]), Z(r[1]), "#ece7dd");
      }
    }
  }

  // floors and ceilings
  const floorMat = lib.floorWood, tileMat = lib.floorTile, ceilMat = lib.ceiling;
  const floorGeos = [], ceilGeos = [], tileGeos = [];
  const pad = 0.05;
  for (const r of floorRects(plan, model)) {
    const [x0, x1, z0, z1] = ft(r.x0 - pad, r.x1 + pad, r.y0 - pad, r.y1 + pad);
    floorGeos.push(planeXZ(x0, x1, z0, z1, FLOOR, true, 1));
    ceilGeos.push(planeXZ(x0, x1, z0, z1, CEIL, false));
  }
  for (const r of plan.rooms.filter((q) => q.type === "bath" || q.type === "laundry")) {
    const [x0, x1, z0, z1] = ft(r.x, r.x + r.w, r.y, r.y + r.d);
    tileGeos.push(planeXZ(x0, x1, z0, z1, FLOOR + 0.003, true, 1));
  }
  const floorMesh = new THREE.Mesh(mergeGeometries(floorGeos), floorMat);
  floorMesh.receiveShadow = true;
  floorMesh.name = "floor";
  const ceilMesh = new THREE.Mesh(mergeGeometries(ceilGeos), ceilMat);
  ceilMesh.castShadow = true; ceilMesh.receiveShadow = true;
  exportable.add(floorMesh);
  root.add(ceilMesh);
  let tileMesh = null;
  if (tileGeos.length) {
    tileMesh = new THREE.Mesh(mergeGeometries(tileGeos), tileMat);
    tileMesh.receiveShadow = true;
    tileMesh.name = "floor";
    exportable.add(tileMesh);
  }
  // ceiling lights, outlets and switches, framed art
  for (const m of buildFixturesCeiling({ rooms: plan.rooms, X, Z, CEIL }).meshes(lib, { cast: false })) root.add(m);
  const boxesForArt = boxes.filter((b) => b.z0 <= 0 && b.z1 >= 7);
  // outlets and switches only where a full-height wall is really behind them (room edges in an open
  // plan, e.g. living into kitchen, have no wall)
  const wallSegs = onRealWalls(wallSegments(plan, model, items), boxesForArt);
  const devices = buildWallDevices({ ...wallSegs, X, Z, FLOOR, rotOf: (n) => FACE_ANGLE[faceOf(n)] });
  for (const m of devices.meshes(lib, { cast: false })) exportable.add(m);
  const wallBehind = (it) => {
    const v = FACE_VEC[it.face], bx = it.x - v[0] * (it.d / 2 + 0.25), by = it.y - v[1] * (it.d / 2 + 0.25);
    return boxesForArt.some((b) => bx >= b.x0 - 0.05 && bx <= b.x1 + 0.05 && by >= b.y0 - 0.05 && by <= b.y1 + 0.05);
  };
  const { edges: outEdges } = outline(plan, model);
  const windowAt = (it, wFt) => {
    // any window on the wall behind the piece within the art's width
    const v = FACE_VEC[it.face], bx = it.x - v[0] * (it.d / 2), by = it.y - v[1] * (it.d / 2);
    return exteriorOpenings(plan).some((w) => {
      const e = outEdges.find((q) => q.name === w.wall);
      if (!e) return false;
      const horizBack = v[0] === 0;
      if (e.horiz !== horizBack) return false;
      const dist = Math.abs((horizBack ? by : bx) - e.line);
      const c = horizBack ? it.x : it.y;
      return dist < plan.extWall + 0.6 && Math.abs(w.at - c) < w.w / 2 + wFt / 2 + 0.3;
    });
  };
  for (const m of buildArt({ items, plan, X, Z, FLOOR, lib, wallBehind, windowAt }).meshes) exportable.add(m);

  // furniture: every piece scaled to its real size and merged into a single mesh
  const pieces = [], glossy = [];
  const placed = []; // world-space footprint of every piece, for checking the 3D scene against the 2D plan
  // kitchen and bath cabinetry, appliances and mirrors are built procedurally at their exact size
  const fx = buildFixtures({ items, X, Z, FLOOR, CEIL, lib });
  for (const m of fx.meshes) exportable.add(m);
  // which way a piece's front (+z in its own space) points in the plan, from its rotation
  const frontOf = (rot) => {
    const ry = (rot * Math.PI) / 180, X0 = X(0), Z0 = Z(0);
    const fdx = fr.fromX(X0 + Math.sin(ry)) - fr.fromX(X0), fdy = fr.fromZ(Z0 + Math.cos(ry)) - fr.fromZ(Z0), fl = Math.hypot(fdx, fdy) || 1;
    return [fdx / fl, fdy / fl];
  };
  for (const q of fx.placed) {
    const xs3 = [fr.fromX(q.box.min.x), fr.fromX(q.box.max.x)].sort((p1, p2) => p1 - p2), ys3 = [fr.fromZ(q.box.min.z), fr.fromZ(q.box.max.z)].sort((p1, p2) => p1 - p2);
    placed.push({ key: q.key, rect: [xs3[0], ys3[0], xs3[1], ys3[1]], z0: (q.box.min.y - FLOOR) / FT, z1: (q.box.max.y - FLOOR) / FT, procedural: true, front: frontOf(q.rot) });
  }
  // tiled backsplash behind base cabinets, between the counter and the wall cabinets
  const splash = new Batches();
  for (const it of items) {
    if (!["cabinet", "sink", "range"].includes(it.key)) continue;
    const v = FACE_VEC[it.face], bx = it.x - v[0] * (it.d / 2 + 0.01), by = it.y - v[1] * (it.d / 2 + 0.01);
    const half = it.w / 2, t = 0.03;
    const along = v[1] !== 0;
    const r0 = along ? [bx - half, by - (v[1] > 0 ? 0 : t)] : [bx - (v[0] > 0 ? 0 : t), by - half];
    const r1 = along ? [bx + half, by + (v[1] > 0 ? t : 0)] : [bx + (v[0] > 0 ? t : 0), by + half];
    const top = it.key === "range" ? 5.2 : 4.6;
    const g = new THREE.BoxGeometry(Math.abs(X(r1[0]) - X(r0[0])), (top - 3) * FT, Math.abs(Z(r1[1]) - Z(r0[1])));
    g.translate((X(r0[0]) + X(r1[0])) / 2, FLOOR + ((3 + top) / 2) * FT, (Z(r0[1]) + Z(r1[1])) / 2);
    splash.add("backsplash", g);
  }
  for (const m of splash.meshes(lib, { cast: false })) exportable.add(m);
  // real furniture models where there is one (public/furniture/manifest.json), kit pieces otherwise
  const real = await placeFurniture({ items: items.filter((it) => !fx.handled.has(it.key)), X, Z, FLOOR });
  for (const m of real.meshes) exportable.add(m);
  for (const q of real.placed) {
    const xs3 = [fr.fromX(q.box.min.x), fr.fromX(q.box.max.x)].sort((p1, p2) => p1 - p2), ys3 = [fr.fromZ(q.box.min.z), fr.fromZ(q.box.max.z)].sort((p1, p2) => p1 - p2);
    placed.push({ key: q.key, rect: [xs3[0], ys3[0], xs3[1], ys3[1]], z0: (q.box.min.y - FLOOR) / FT, z1: (q.box.max.y - FLOOR) / FT, model: true, front: frontOf(q.rot) });
  }
  for (const it of items) {
    if (fx.handled.has(it.key) || real.handled.has(it.key)) continue;
    if (it.key === "hood") {
      // canopy hood + chimney, centered on the range below it
      const [x0, y0, x1, y1] = itemRect(it);
      const zb = FLOOR + it.elev * FT, zt = zb + 0.45 * FT;
      trims.box(X(x0), X(x1), zb, zt, Z(y1), Z(y0), "#b9bcbc");
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, v = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] }[it.face];
      const bx = cx - v[0] * (it.d / 2 - 0.45), by = cy - v[1] * (it.d / 2 - 0.45);
      trims.box(X(bx - 0.45), X(bx + 0.45), zt, Yz(9), Z(by + 0.45), Z(by - 0.45), "#c4c7c7");
      placed.push({ key: it.key, rect: [x0, y0, x1, y1], z0: it.elev, z1: it.elev + it.h });
      continue;
    }
    if (it.key === "upper") {
      // wall cabinets are simple boxes (the kit's upper cabinet doesn't read well at this scale)
      const [x0, y0, x1, y1] = itemRect(it);
      const zb = FLOOR + it.elev * FT, zt = zb + it.h * FT;
      trims.box(X(x0), X(x1), zb, zt, Z(y1), Z(y0), "#e4ded2");
      placed.push({ key: it.key, rect: [x0, y0, x1, y1], z0: it.elev, z1: it.elev + it.h });
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
    g.computeBoundingBox();
    const bb2 = g.boundingBox;
    const xs2 = [fr.fromX(bb2.min.x), fr.fromX(bb2.max.x)].sort((p, q) => p - q), ys2 = [fr.fromZ(bb2.min.z), fr.fromZ(bb2.max.z)].sort((p, q) => p - q);
    // which way the model's front (+z in the kit) points once placed, in plan coordinates
    const ry = (it.rot * Math.PI) / 180, X0 = X(it.x), Z0 = Z(it.y);
    const fdx = fr.fromX(X0 + Math.sin(ry)) - fr.fromX(X0), fdy = fr.fromZ(Z0 + Math.cos(ry)) - fr.fromZ(Z0), fl = Math.hypot(fdx, fdy) || 1;
    placed.push({ key: it.key, rect: [xs2[0], ys2[0], xs2[1], ys2[1]], z0: (bb2.min.y - FLOOR) / FT, z1: (bb2.max.y - FLOOR) / FT, front: [fdx / fl, fdy / fl] });
    (GLOSSY.has(it.key) ? glossy : pieces).push(g.index ? g.toNonIndexed() : g);
  }
  for (const [list, mat] of [[pieces, lib.furniture], [glossy, lib.furnitureGloss]]) {
    if (!list.length) continue;
    const furn = new THREE.Mesh(mergeGeometries(list), mat);
    furn.castShadow = true; furn.receiveShadow = true;
    furn.name = "furniture";
    exportable.add(furn);
  }

  // painted walls + all the white trim (casings, baseboards, door leaves, wall cabinets)
  const shellMesh = new THREE.Mesh(shell.geometry(), lib.walls);
  shellMesh.castShadow = true; shellMesh.receiveShadow = true;
  const trimMesh = new THREE.Mesh(trims.geometry(), lib.trim);
  trimMesh.receiveShadow = true; trimMesh.castShadow = true;
  exportable.add(shellMesh, trimMesh);
  shellMesh.name = "walls"; trimMesh.name = "trim"; ceilMesh.name = "ceiling";

  // baked light: every shell quad has a patch in one lightmap atlas (uv1); see lib/lightmap.js
  const bakeTargets = { walls: shellMesh, trim: trimMesh, floor: floorMesh, tile: tileMesh, ceiling: ceilMesh };
  const atlas = addLightmapUVs(Object.values(bakeTargets));
  const bakeFits = !!(bake && bake.size === atlas.size && bake.layout === layoutKey(atlas.rects));
  if (bakeFits) {
    for (const m of Object.values(bakeTargets)) {
      if (!m) continue;
      m.material = m.material.clone();
      m.material.lightMap = bake.tex;
      m.material.lightMapIntensity = bake.intensity;
      m.material.envMapIntensity = 0.12; // the probe would count the same light twice; keep just the sheen
    }
  }

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
    const { tex, aspect } = labelTexture(roomLabel(r));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, toneMapped: false }));
    const h = 0.2;
    s.scale.set(h * aspect, h, 1);
    s.position.set(X(r.x + r.w / 2), FLOOR + 7.3 * FT, Z(r.y + r.d / 2));
    s.renderOrder = 5;
    labels.add(s);
  }
  root.add(labels);

  // collision (plan feet), from the same rules the plan checker uses
  const colliders = collidersFor(plan, model, items);
  const o = outline(plan, model);
  const xs = o.verts.map((v) => v[0]), ys = o.verts.map((v) => v[1]);
  const yard = yardRect(plan, model);

  // yard: grass and a wood fence; beyond it, the Poly Haven sky and tree line (scene background)
  const outside = new THREE.Group();
  const ground = new THREE.Mesh(planeXZ(-60, 60, -60, 60, 0, true, 1), lib.grass);
  ground.receiveShadow = true;
  ground.name = "ground";
  outside.add(ground);
  const fence = new BoxBatch();
  const fh = 6 * FT;
  const [fx0, fx1, fz0, fz1] = ft(yard.x0, yard.x1, yard.y0, yard.y1);
  const r = rng(5);
  // dog-eared cedar pickets on rails, with a little color variation board to board
  const picket = (a0, a1, fixed, alongX, inward) => {
    for (let p = Math.min(a0, a1); p < Math.max(a0, a1) - 0.02; p += 0.145) {
      const c = new THREE.Color("#9c7a5a").offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08);
      const hh = fh + (r() - 0.5) * 0.01;
      if (alongX) fence.box(p, p + 0.14, 0, hh, fixed, fixed + inward * 0.018, c);
      else fence.box(fixed, fixed + inward * 0.018, 0, hh, p, p + 0.14, c);
    }
  };
  picket(fx0, fx1, fz0, true, 1); picket(fx0, fx1, fz1, true, -1); picket(fz0, fz1, fx0, false, 1); picket(fz0, fz1, fx1, false, -1);
  for (const yy of [0.35, 1.6]) {
    fence.box(fx0, fx1, yy, yy + 0.09, fz0 + 0.018, fz0 + 0.058, "#8b6f55"); fence.box(fx0, fx1, yy, yy + 0.09, fz1 - 0.058, fz1 - 0.018, "#8b6f55");
    fence.box(fx0 + 0.018, fx0 + 0.058, yy, yy + 0.09, fz0, fz1, "#8b6f55"); fence.box(fx1 - 0.058, fx1 - 0.018, yy, yy + 0.09, fz0, fz1, "#8b6f55");
  }
  for (let x = fx0; x <= fx1; x += 2.4) { fence.box(x - 0.045, x + 0.045, 0, fh - 0.1, fz0 + 0.058, fz0 + 0.148, "#7f654d"); fence.box(x - 0.045, x + 0.045, 0, fh - 0.1, fz1 - 0.148, fz1 - 0.058, "#7f654d"); }
  for (let z = fz0; z <= fz1; z += 2.4) { fence.box(fx0 + 0.058, fx0 + 0.148, 0, fh - 0.1, z - 0.045, z + 0.045, "#7f654d"); fence.box(fx1 - 0.148, fx1 - 0.058, 0, fh - 0.1, z - 0.045, z + 0.045, "#7f654d"); }
  const fenceMesh = new THREE.Mesh(fence.geometry(), lib.fence);
  fenceMesh.receiveShadow = true; fenceMesh.castShadow = true;
  outside.add(fenceMesh);
  root.add(outside);

  // sun: mid-afternoon in the Valley (from the south-west), turned into the house's frame
  const SUN_AZ = 222, SUN_EL = 40;
  const d = ((SUN_AZ - heading) * Math.PI) / 180, el = (SUN_EL * Math.PI) / 180;
  const sunDir = new THREE.Vector3(-Math.sin(d) * Math.cos(el), Math.sin(el), Math.cos(d) * Math.cos(el)).normalize();

  return {
    root, exportable, labels, ceilMesh, shellGLB, colliders, yard, sunDir, items, placed, lib, mirrors: fx.mirrors, devices: devices.devices,
    bakeTargets, atlas, baked: bakeFits, bake: bakeFits ? bake : null, fenceMesh, ground,
    floors: [floorMesh, ground, ...porchFloors, ...(tileMesh ? [tileMesh] : [])],
    toScene: (x, y) => new THREE.Vector3(X(x), 0, Z(y)),
    toPlan: (v) => [fr.fromX(v.x), fr.fromZ(v.z)],
    extent: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
  };
}

// Image-based light (Poly Haven, CC0; see public/hdri/README.md):
//  - "Noon Grass": a 2k LDR panorama for the view out the windows + its 1k HDR for reflections
//    and the light on the outside of the house
//  - "Studio Small 09": a neutral studio HDR, the indoor fill when a plan has no (current) bake
// Phones and ?light=legacy (the Oct 2026 lighting, for before/after comparisons) use the 256 px sky HDR.
export const HDRI = {
  skyBackground: "/hdri/noon_grass_bg.jpg",
  sky: "/hdri/noon_grass_1k.hdr",
  skyLegacy: "/hdri/noon_grass_256.hdr",
  studio: "/hdri/studio_small_09_1k.hdr",
};
const hdrCache = new Map();
function loadHDR(url) {
  if (!hdrCache.has(url)) {
    hdrCache.set(url, import("three/examples/jsm/loaders/HDRLoader.js").then(({ HDRLoader }) => new HDRLoader().loadAsync(url)).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    }));
  }
  return hdrCache.get(url);
}
let skyBgPromise = null;
async function loadSky(pmrem, legacy = false) {
  skyBgPromise ??= new THREE.TextureLoader().loadAsync(HDRI.skyBackground).then((bg) => {
    bg.mapping = THREE.EquirectangularReflectionMapping; bg.colorSpace = THREE.SRGBColorSpace;
    return bg;
  });
  const [background, hdr] = await Promise.all([skyBgPromise, loadHDR(legacy ? HDRI.skyLegacy : HDRI.sky)]);
  return { background, env: pmrem.fromEquirectangular(hdr).texture };
}
async function loadStudio(pmrem) {
  return pmrem.fromEquirectangular(await loadHDR(HDRI.studio)).texture;
}

// The scene for scripts/bake-lighting.mjs: bake targets (with uv1) plus everything that blocks or
// bounces light, with plain named materials so Blender can assign albedos. Returns a GLB.
export async function exportBakeScene(built) {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const g = new THREE.Group();
  const plain = (name) => new THREE.MeshStandardMaterial({ name, color: "#ffffff" });
  const targets = new Set(Object.values(built.bakeTargets).filter(Boolean));
  for (const [name, m] of Object.entries(built.bakeTargets)) {
    if (!m) continue;
    const c = new THREE.Mesh(m.geometry, plain(`bake_${name}`));
    c.name = `bake_${name}`;
    g.add(c);
  }
  built.exportable.updateMatrixWorld(true);
  built.exportable.traverse((o) => {
    if (!o.isMesh || targets.has(o) || !o.visible) return;
    const mn = o.material?.name || "";
    if (mn === "door" || mn === "lite") return;
    let inShell = false;
    for (let p = o; p; p = p.parent) if (p === built.shellGLB) inShell = true;
    if (mn === "glass") { // window panes: Blender turns these into light portals (not rendered)
      if (!inShell) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
      const c = new THREE.Mesh(geo, plain("portal_glass")); c.name = "portal_glass"; g.add(c);
      return;
    }
    const mats = [];
    if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { const mm = new THREE.Matrix4(); o.getMatrixAt(i, mm); mats.push(mm.premultiply(o.matrixWorld)); }
    else mats.push(o.matrixWorld);
    const occ = inShell ? "occ_exterior" : o.name.startsWith("furniture") ? "occ_furniture" : "occ_detail";
    for (const mw of mats) {
      const geo = o.geometry.clone().applyMatrix4(mw);
      for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
      const c = new THREE.Mesh(geo, plain(occ));
      c.name = occ;
      g.add(c);
    }
  });
  for (const [m, name] of [[built.fenceMesh, "occ_fence"], [built.ground, "occ_ground"]]) {
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
    const c = new THREE.Mesh(geo, plain(name)); c.name = name; g.add(c);
  }
  const glb = await new GLTFExporter().parseAsync(g, { binary: true });
  return { glb, atlas: built.atlas, sunDir: built.sunDir.toArray() };
}

// ---------------------------------------------------------------- the interactive tour
export async function createTour({ canvas, plan, model, styleId, heading = 180, mobile = false, onPose, onRoom, quality }) {
  const isPhone = mobile;
  // Lighting levels. Tunable from the URL for testing (?exp=&expin=&env=&envb=&studio=&hemi=&hemiin=
  // &sun=&lm=&tone=aces|agx|neutral&fill=auto|probe|studio|none&quality=low|high&nobake), live with
  // ?light=debug (a panel, see lib/lightDebug.js), and ?light=legacy restores the Oct 2026 lighting.
  const qp = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const legacy = qp.get("light") === "legacy";
  const num = (k, d) => (qp.has(k) && qp.get(k) !== "" && isFinite(+qp.get(k)) ? +qp.get(k) : d);
  const LV = {
    exp: num("exp", 0.85), // outdoors
    expIn: num("expin", 2.6), // indoors, with a bake
    expLive: num("explive", 1.0), // indoors, live light only
    env: num("env", 0.45), // light-probe fill without a bake (legacy and fill=probe)
    envBaked: num("envb", 1), // light-probe fill with a bake (reflections + furniture)
    studio: num("studio", 0.6), // studio HDRI lighting the room while the probe is captured (no bake)
    hemi: num("hemi", 0.3), hemiIn: num("hemiin", legacy ? 0.04 : 0), hemiLive: num("hemilive", legacy ? 0.9 : 0),
    sun: num("sun", 3.2),
    lm: num("lm", 1), // lightmap intensity multiplier
    tone: legacy ? "aces" : qp.get("tone") || "aces",
    fill: legacy ? "probe" : qp.get("fill") || "auto", // auto | probe | probe+studio | studio | none
    bake: !qp.has("nobake"),
  };
  const q = quality || qp.get("quality");
  const high = q ? q === "high" : !isPhone; // ambient occlusion pass + bigger shadow map
  const useBake = LV.bake;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !high && (!isPhone || window.devicePixelRatio < 2), powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };
  renderer.toneMapping = TONE[LV.tone] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LV.exp;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // with shadow.radius: soft-edged sun patches
  renderer.shadowMap.autoUpdate = false; // everything is static: draw the shadow map once

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  const pmrem = new THREE.PMREMGenerator(renderer);
  setLightmapRenderer(renderer);
  if (!high) setTextureBudget(512, 4); // phones: half-size procedural textures (see tourMaterials.js)

  // phones get the 256 px sky HDR (the PMREM blur hides the difference; saves 1.5 MB); the studio
  // HDRI loads only when it's the fill (no current bake, or fill=studio)
  let studioEnv = null, studioP = null;
  const getStudio = () => (studioP ??= legacy ? Promise.resolve(null) : loadStudio(pmrem).catch(() => null).then((t) => (studioEnv = t)));
  const needStudio = (b) => !legacy && (LV.fill === "studio" || LV.fill === "probe+studio" || (LV.fill === "auto" && !(b.baked && LV.bake)));
  const builtP = buildTourScene({ plan, model, styleId, heading, useBake });
  const [builtFirst, sky] = await Promise.all([
    builtP,
    loadSky(pmrem, legacy || (isPhone && !qp.has("sky1k"))),
    builtP.then((b) => (needStudio(b) ? getStudio() : null)),
  ]);
  let built = builtFirst;
  scene.add(built.root);
  // the view out the windows (an LDR panorama: sharper than the lighting HDR, and already tone-mapped)
  scene.background = sky.background;
  scene.backgroundIntensity = 1.05;
  // what the HDRIs and the bake don't cover: a faint sky/ground tint outdoors (off indoors)
  const hemi = new THREE.HemisphereLight("#dfe9f5", "#b8a68a", LV.hemi);
  // the sun stays live: its patches on the floor move with the house's heading on the lot, so they
  // can't be baked; the shadow map is drawn once (nothing moves)
  const sun = new THREE.DirectionalLight("#fff0da", LV.sun);
  scene.add(hemi, sun, sun.target);
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
    sun.shadow.mapSize.set(high ? 4096 : 2048, high ? 4096 : 2048);
    sun.shadow.radius = high ? 5 : 3;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    renderer.shadowMap.needsUpdate = true;
  }
  placeSun();
  // the outside of the house reflects the sky; inside, a light probe of the room itself (below)
  const useSkyEnv = (root) => root.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial) { o.material.envMap = sky.env; o.material.envMapIntensity = 0.9; } });
  useSkyEnv(built.shellGLB); useSkyEnv(built.fenceMesh);

  // baked light on (the bake fits this plan and isn't switched off from the debug panel)
  let bakeOn = true;
  const isBaked = () => built.baked && bakeOn;
  function applyBake() {
    for (const m of Object.values(built.bakeTargets)) {
      if (!m || !built.bake) continue;
      const want = isBaked() ? built.bake.tex : null;
      if (m.material.lightMap !== want) { m.material.lightMap = want; m.material.needsUpdate = true; }
      m.material.lightMapIntensity = built.bake.intensity * LV.lm;
      m.material.envMapIntensity = isBaked() ? 0.12 : 1; // with a bake the probe would count the same light twice; keep the sheen
    }
  }
  applyBake();
  // Indoor fill (scene.environment, for everything that isn't baked and for reflections):
  //   "probe"        a light probe of the lit room (one bounce): the default with a bake
  //   "probe+studio" the same probe, captured while the studio HDRI lights the room: the default
  //                  without a bake (neutral fill that the bake would otherwise provide)
  //   "studio"       the studio HDRI directly; "none"
  const needStudioNow = (mode) => mode === "studio" || mode === "probe+studio";
  const fillMode = () => {
    const want = LV.fill === "auto" ? (isBaked() ? "probe" : "probe+studio") : LV.fill;
    if (needStudioNow(want) && !studioEnv) { // until it arrives (or for good, if it can't load)
      if (!studioP) getStudio().then((t) => { if (t && running) dropProbe(); }); // recapture with it
      return "probe";
    }
    return want;
  };
  let probe = null, probeMode = null;
  function dropProbe() { scene.environment = null; probe?.dispose(); probe = null; } // tick() recaptures
  function updateProbe() {
    // one bounce of indirect light: render the lit interior from the middle of the house into an
    // environment map that every interior surface then uses for fill light and reflections
    const c = built.toScene((built.extent.x0 + built.extent.x1) / 2, (built.extent.y0 + built.extent.y1) / 2);
    c.y = FLOOR + 4.5 * FT;
    built.labels.visible = false;
    const prev = scene.background;
    scene.background = null;
    probeMode = fillMode();
    scene.environment = probeMode === "probe+studio" ? studioEnv : null;
    scene.environmentIntensity = LV.studio;
    const rt = pmrem.fromScene(scene, 0.02, 0.05, 60, { size: 128, position: c });
    scene.background = prev;
    built.labels.visible = labelsOn;
    probe?.dispose();
    probe = rt;
    applyFill();
  }
  function applyFill() {
    const mode = fillMode();
    if (probe && (mode === "probe+studio") !== (probeMode === "probe+studio")) { dropProbe(); return; } // recapture next frame
    scene.environment = mode === "studio" ? studioEnv : mode === "none" ? null : probe?.texture ?? null;
    scene.environmentIntensity = mode === "studio" ? LV.studio : isBaked() ? LV.envBaked : LV.env;
  }

  // ambient occlusion (desktop): contact shadows where furniture meets floors and walls
  let composer = null;
  if (high) {
    try {
      const [{ EffectComposer }, { OutputPass }, { N8AOPass }] = await Promise.all([
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/OutputPass.js"),
        import("n8ao"),
      ]);
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, target);
      const ao = new N8AOPass(scene, camera, 1, 1);
      ao.configuration.aoRadius = 0.55;
      ao.configuration.distanceFalloff = 0.9;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = true;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.transparencyAware = true;
      ao.configuration.gammaCorrection = false; // the OutputPass does tone mapping and sRGB
      ao.setQualityMode("Medium");
      composer.addPass(ao);
      composer.addPass(new OutputPass());
    } catch (e) {
      console.warn("ambient occlusion unavailable", e);
      composer = null;
    }
  }
  let labelsOn = true;
  // bathroom mirrors: a live reflection on desktop (phones keep the reflection of the light probe)
  let reflectors = [];
  async function addMirrors() {
    for (const r of reflectors) { r.parent?.remove(r); r.dispose(); }
    reflectors = [];
    if (!high || !built.mirrors?.length) return;
    const { Reflector } = await import("three/examples/jsm/objects/Reflector.js");
    for (const m of built.mirrors) {
      const r = new Reflector(new THREE.PlaneGeometry(m.w, m.h), { textureWidth: 512, textureHeight: Math.round(512 * m.h / m.w), color: "#c9cccc", clipBias: 0.003 });
      r.matrixAutoUpdate = false;
      r.matrix.copy(m.matrix);
      built.root.add(r);
      reflectors.push(r);
    }
  }
  await addMirrors();

  let nav = makeNav(built.colliders, built.yard);
  let views = roomViews(plan, model, built.items, nav); // per-room start views (same rules as the checker)
  const start = entryPose(plan, model);
  const pose = { x: start.x, y: start.y, yaw: start.yaw, pitch: start.pitch };
  const view = { yaw: pose.yaw, pitch: pose.pitch }; // where the look controls are steering; pose eases toward it
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  let glide = null;
  let lastRoom = undefined, forcedRoom = null;

  function setCamera() {
    const v = built.toScene(pose.x, pose.y);
    camera.position.set(v.x, FLOOR + (pose.eyeFt ?? EYE_FT) * FT, v.z);
    camera.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 78 : 70;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const angleTo = (dx, dy) => Math.atan2(-dx, dy); // plan direction -> yaw
  const wrap = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
  const smooth = (u) => { const c = Math.max(0, Math.min(1, u)); return c * c * (3 - 2 * c); };

  // A glide follows a planned path in a fixed short time (0.6–1.5 s), easing in and out.
  function startGlide(pts, final = null, room = null) {
    if (!pts || pts.length < 2) return false;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    if (L < 0.05 && !final) return false;
    glide = { pts, cum, L, T: Math.max(0.6, Math.min(1.5, L / 11)), t: 0, yaw0: pose.yaw, pitch0: pose.pitch, final, room };
    return true;
  }
  function walkTo(tx, ty) {
    forcedRoom = null;
    return startGlide(nav.path([pose.x, pose.y], [tx, ty]));
  }
  // Glide to the room's start view: just inside the doorway, 2 ft from walls, facing the bed/sofa/vanity
  function goToRoom(id) {
    const r = plan.rooms.find((q) => q.id === id);
    const v = views[id];
    if (!r) return false;
    let pts = v && nav.pathTo([pose.x, pose.y], [v.x, v.y]);
    if (!pts) { const p = nav.path([pose.x, pose.y], [0, 0], [r.x, r.y, r.x + r.w, r.y + r.d]); pts = p; }
    if (!pts) return false;
    if (pts.length < 2) pts = [[pose.x, pose.y], [pose.x, pose.y]];
    // show the destination's name right away
    forcedRoom = r;
    onRoom?.(r);
    lastRoom = r.id;
    return startGlide(pts, v ? { yaw: v.yaw, pitch: v.pitch } : null, r) || (forcedRoom = null, false);
  }

  const clock = new THREE.Timer();
  let running = true, frames = 0, fpsT = 0, fps = 60;
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
    view.yaw += turn * 1.6 * dt;
    if (f || s) {
      if (glide) { glide = null; forcedRoom = null; }
      const len = Math.max(1, Math.hypot(f, s));
      const fx = -Math.sin(pose.yaw), fy = Math.cos(pose.yaw), rx = Math.cos(pose.yaw), ry = Math.sin(pose.yaw);
      const speed = WALK_FTPS * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1.7 : 1);
      const dx = ((fx * f + rx * s) / len) * speed * dt, dy = ((fy * f + ry * s) / len) * speed * dt;
      [pose.x, pose.y] = nav.move(pose.x, pose.y, dx, dy);
    } else if (glide) {
      const gl = glide;
      gl.t += dt * (window.__tourFast || 1); // __tourFast: test hook
      const u = Math.min(1, gl.t / gl.T), dist = smooth(u) * gl.L;
      let i = 1;
      while (i < gl.pts.length - 1 && gl.cum[i] < dist) i++;
      const [ax, ay] = gl.pts[i - 1], [bx, by] = gl.pts[i];
      const seg = Math.max(1e-6, gl.cum[i] - gl.cum[i - 1]), k = Math.max(0, Math.min(1, (dist - gl.cum[i - 1]) / seg));
      // the planned path keeps the body clear of walls, so follow it exactly
      pose.x = ax + (bx - ax) * k;
      pose.y = ay + (by - ay) * k;
      const travel = gl.L > 0.3 ? angleTo(bx - ax, by - ay) : gl.yaw0;
      let yaw = lerpAngle(gl.yaw0, travel, smooth(u / 0.3));
      let pitch = gl.pitch0 + (-0.05 - gl.pitch0) * smooth(u / 0.3);
      if (gl.final) {
        const w = smooth((u - 0.35) / 0.65);
        yaw = lerpAngle(yaw, gl.final.yaw, w);
        pitch = pitch + (gl.final.pitch - pitch) * w;
      }
      view.yaw = yaw; view.pitch = pitch;
      pose.yaw = yaw; pose.pitch = pitch;
      if (u >= 1) glide = null; // the destination's label stays until you walk away
    }
    // ease the view toward where the look controls point (smooths drags and turns)
    const ease = Math.min(1, dt * 14);
    pose.yaw += wrap(view.yaw - pose.yaw) * ease;
    pose.pitch += (view.pitch - pose.pitch) * ease;
    setCamera();
    // fade labels by distance so the nearest room's label doesn't fill the screen
    for (const s2 of built.labels.children) {
      const dd = s2.position.distanceTo(camera.position);
      s2.material.opacity = THREE.MathUtils.clamp((dd - 1.2) / 1.5, 0, 1);
      s2.visible = s2.material.opacity > 0.02;
    }
    // eyes adjust: indoors (where only the baked sky and bounce light reach) the exposure opens up
    const inside = !!roomAt(plan, pose.x, pose.y);
    // (without a bake for this plan, a stronger sky fill stands in for the bounce light)
    const tExp = inside ? (isBaked() ? LV.expIn : LV.expLive) : LV.exp, tHemi = inside ? (isBaked() ? LV.hemiIn : LV.hemiLive) : LV.hemi;
    const k2 = Math.min(1, dt * 2.5);
    renderer.toneMappingExposure += (tExp - renderer.toneMappingExposure) * k2;
    hemi.intensity += (tHemi - hemi.intensity) * k2;
    sun.intensity = LV.sun;
    if (!probe) updateProbe();
    if (composer) composer.render(); else renderer.render(scene, camera);
    onPose?.(pose, fps);
    if (!forcedRoom) {
      const room = roomAt(plan, pose.x, pose.y);
      if ((room?.id || null) !== lastRoom) { lastRoom = room?.id || null; onRoom?.(room); }
    }
    requestAnimationFrame(tick);
  }

  // look controls: k is radians per pixel; the view eases toward the target each frame
  function look(dx, dy, k = 0.002) {
    if (glide) { glide = null; forcedRoom = null; }
    view.yaw -= dx * k;
    view.pitch = THREE.MathUtils.clamp(view.pitch - dy * k, -1.1, 1.1);
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
    const next = await buildTourScene({ plan, model, styleId, heading, useBake });
    scene.remove(built.root);
    disposeTree(built.root);
    built = next;
    scene.add(built.root);
    nav = makeNav(built.colliders, built.yard);
    views = roomViews(plan, model, built.items, nav);
    useSkyEnv(built.shellGLB); useSkyEnv(built.fenceMesh);
    placeSun();
    applyBake();
    dropProbe();
    await addMirrors();
  }
  function setPose(p) {
    Object.assign(pose, p);
    if (p.yaw != null) view.yaw = p.yaw;
    if (p.pitch != null) view.pitch = p.pitch;
    glide = null; forcedRoom = null;
  }

  // live controls for the debug panel (?light=debug)
  const lighting = {
    LV, legacy,
    get baked() { return built.baked; },
    get bakeOn() { return bakeOn; },
    get fill() { return fillMode(); },
    get exposure() { return renderer.toneMappingExposure; },
    get calls() { return renderer.info.render.calls; },
    get fps() { return fps; },
    apply() {
      const tm = TONE[LV.tone] ?? THREE.ACESFilmicToneMapping;
      if (tm !== renderer.toneMapping) { // tone mapping is compiled into the shaders
        renderer.toneMapping = tm;
        scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
      }
      applyBake();
      if (fillMode() === "probe+studio") dropProbe(); else applyFill(); // the studio level is baked into that probe
    },
    setBake(on) { bakeOn = on; applyBake(); dropProbe(); }, // the probe sees the walls, so recapture it
  };
  let panel = null;
  if (qp.get("light") === "debug") import("./lightDebug.js").then(({ mountLightDebug }) => { if (running) panel = mountLightDebug(canvas, lighting); });

  setCamera();
  requestAnimationFrame(tick);
  return {
    lighting,
    keys, joy, pose, look, tapAt, walkTo, goToRoom, setStyle, setPose, resize, renderer, scene, camera,
    get fps() { return fps; },
    get views() { return views; },
    get placed() { return built.placed; },
    get devices() { return built.devices; }, // outlets and switches: {x, y, n, z, kind} in plan feet (for scripts/check-tour.mjs)
    get baked() { return built.baked; },
    exportBake: () => exportBakeScene(built),
    get items() { return built.items; },
    setLabels(on) { labelsOn = on; built.labels.visible = on; },
    get nav() { return nav; },
    get colliders() { return built.colliders; },
    get walking() { return !!glide; },
    reset() { setPose({ x: start.x, y: start.y, yaw: start.yaw, pitch: start.pitch }); },
    dispose() {
      running = false;
      panel?.remove();
      ro.disconnect();
      disposeTree(scene);
      probe?.dispose(); pmrem.dispose(); composer?.dispose?.();
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
  const built = await buildTourScene({ plan, model, styleId, useBake: false }); // AR gets plain materials anyway
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
