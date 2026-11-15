// Procedural fixtures for the walk-in tour: shaker kitchen and bath cabinets with rounded edges,
// counters, sinks and faucets, a slide-in range, a French-door fridge, a canopy hood, mirrors,
// outlets and switches, ceiling lights and framed art. Everything is built at its real size from
// the same furniture items the 2D plan draws, then merged into one mesh per material.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const FT = 0.3048, IN = FT / 12;

// ---------------------------------------------------------------- batching
// Collects geometries per material key; geometry gets meters-based planar UVs so tiled
// textures (quartz, brushed steel) line up across pieces.
export class Batches {
  constructor() { this.g = new Map(); }
  add(key, geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.g.has(key)) this.g.set(key, []);
    this.g.get(key).push(g);
  }
  meshes(lib, { cast = true, receive = true } = {}) {
    const out = [];
    for (const [key, list] of this.g) {
      const geo = mergeGeometries(list);
      planarUV(geo);
      const mat = typeof key !== "string" ? key : key.startsWith("bookColors") ? lib.bookColors[+key.slice(10) % lib.bookColors.length] : lib[key];
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast; m.receiveShadow = receive;
      m.name = `detail:${typeof key === "string" ? key : mat.name || "custom"}`;
      out.push(m);
    }
    return out;
  }
}
// world-space planar UVs in meters, picked per triangle by its normal
export function planarUV(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i), p.getZ(i));
    else if (ax >= az) uv.setXY(i, p.getZ(i), p.getY(i));
    else uv.setXY(i, p.getX(i), p.getY(i));
  }
  uv.needsUpdate = true;
}

// box in local item space (meters): x across, y up, z toward the front
function rbox(w, h, d, x, y, z, r = 0.004) {
  const rr = Math.min(r, Math.min(w, h, d) / 2 - 0.0005); // big radii make soft shapes (pillows, cushions)
  const g = rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, rr > 0.02 ? 4 : 2, rr) : new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}
function cyl(r, h, x, y, z, axis = "y", seg = 16, r2 = r) {
  const g = new THREE.CylinderGeometry(r, r2, h, seg);
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

// ---------------------------------------------------------------- pieces (local space, front = +z)
// Shaker door or drawer front: a frame with a recessed center panel and a bar pull.
function shakerFront(B, x0, x1, y0, y1, zf, { pull = "v", side = 1, mat = "cabinet" } = {}) {
  const w = x1 - x0, h = y1 - y0, rail = Math.min(2.25 * IN, w / 4, h / 4), t = 0.75 * IN, cx = (x0 + x1) / 2;
  B.add(mat, rbox(w - 0.003, h - 0.003, 0.25 * IN, cx, y0 + 0.0015, zf + 0.125 * IN, 0)); // panel
  B.add(mat, rbox(w, rail, t, cx, y0, zf + t / 2, 0.002));
  B.add(mat, rbox(w, rail, t, cx, y1 - rail, zf + t / 2, 0.002));
  B.add(mat, rbox(rail, h - 2 * rail, t, x0 + rail / 2, y0 + rail, zf + t / 2, 0.002));
  B.add(mat, rbox(rail, h - 2 * rail, t, x1 - rail / 2, y0 + rail, zf + t / 2, 0.002));
  // bar pull, standing off the face on two posts
  const zp = zf + t + 0.6 * IN;
  if (pull === "v") {
    const len = Math.min(5 * IN, h * 0.5), px = side > 0 ? x1 - rail / 2 : x0 + rail / 2, py = h > 18 * IN ? y1 - rail - len / 2 - IN : (y0 + y1) / 2;
    B.add("steel", cyl(0.22 * IN, len, px, py, zp));
    for (const s of [-1, 1]) B.add("steel", cyl(0.16 * IN, 0.6 * IN, px, py + s * (len / 2 - 0.4 * IN), zp - 0.3 * IN, "z"));
  } else if (pull === "h") {
    const len = Math.min(6 * IN, w * 0.5), py = (y0 + y1) / 2;
    B.add("steel", cyl(0.22 * IN, len, cx, py, zp, "x"));
    for (const s of [-1, 1]) B.add("steel", cyl(0.16 * IN, 0.6 * IN, cx + s * (len / 2 - 0.4 * IN), py, zp - 0.3 * IN, "z"));
  }
}

// Countertop slab with an optional rectangular cut-out [x0,x1,z0,z1] (local)
function counter(B, w, d, top, { hole = null, over = 1 * IN, sideOver = [0, 0], mat = "countertop" } = {}) {
  const t = 1.25 * IN, y = top - t, x0 = -w / 2 - sideOver[0], x1 = w / 2 + sideOver[1], z0 = -d / 2, z1 = d / 2 + over;
  if (!hole) { B.add(mat, rbox(x1 - x0, t, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, 0.003)); return; }
  const [hx0, hx1, hz0, hz1] = hole;
  const piece = (a0, a1, b0, b1) => { if (a1 - a0 > 0.002 && b1 - b0 > 0.002) B.add(mat, rbox(a1 - a0, t, b1 - b0, (a0 + a1) / 2, y, (b0 + b1) / 2, 0.002)); };
  piece(x0, x1, z0, hz0); piece(x0, x1, hz1, z1); piece(x0, hx0, hz0, hz1); piece(hx1, x1, hz0, hz1);
}

function faucet(B, x, top, z, { reach = 8 * IN, height = 14 * IN, mat = "chrome" } = {}) {
  B.add(mat, cyl(1.1 * IN, 1.2 * IN, x, top + 0.6 * IN, z, "y", 20));
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(x, top + IN, z), new THREE.Vector3(x, top + height * 1.25, z),
    new THREE.Vector3(x, top + height * 1.25, z + reach), new THREE.Vector3(x, top + height * 0.62, z + reach));
  B.add(mat, new THREE.TubeGeometry(curve, 24, 0.42 * IN, 10));
  B.add(mat, cyl(0.6 * IN, 1.6 * IN, x, top + height * 0.62 - 0.8 * IN, z + reach, "y", 12));
  B.add(mat, cyl(0.35 * IN, 3 * IN, x + 1.8 * IN, top + 2 * IN, z, "x", 10)); // lever
}

// base cabinet run piece: 34.5" box on a recessed toe kick, 1.25" top. type: cabinet | sink | vanity
function baseCabinet(B, it, { type = "cabinet", top = 3 * FT, mat = "cabinet" } = {}) {
  const w = it.w * FT, d = it.d * FT;
  const toe = 3.5 * IN, ct = 1.25 * IN, boxTop = top - ct, zf = d / 2 - 0.75 * IN;
  B.add("cabinetInside", rbox(w - 0.004, toe, d - 3 * IN, 0, 0, -1.5 * IN, 0)); // toe kick
  B.add(mat, rbox(w, boxTop - toe, d - 0.75 * IN, 0, toe, -0.375 * IN, 0.002)); // carcass
  const g = 0.12 * IN; // reveal between fronts
  const doors = w > 1.75 * FT ? 2 : 1;
  if (type === "cabinet") {
    const dh = 5.5 * IN, ytop = boxTop - g;
    shakerFront(B, -w / 2 + g, w / 2 - g, ytop - dh, ytop, zf, { pull: "h", mat });
    for (let i = 0; i < doors; i++) {
      const a = -w / 2 + (w * i) / doors + g, b = -w / 2 + (w * (i + 1)) / doors - g;
      shakerFront(B, a, b, toe + g, ytop - dh - g, zf, { pull: "v", side: doors === 2 ? (i === 0 ? 1 : -1) : 1, mat });
    }
  } else {
    // sink base / vanity: false front up top, doors below
    const fh = 6 * IN, ytop = boxTop - g;
    B.add(mat, rbox(w - 2 * g, fh, 0.75 * IN, 0, ytop - fh, zf + 0.375 * IN, 0.002));
    for (let i = 0; i < doors; i++) {
      const a = -w / 2 + (w * i) / doors + g, b = -w / 2 + (w * (i + 1)) / doors - g;
      shakerFront(B, a, b, toe + g, ytop - fh - g, zf, { pull: "v", side: doors === 2 ? (i === 0 ? 1 : -1) : 1, mat });
    }
  }
}

function kitchenSink(B, it) {
  const w = it.w * FT, d = it.d * FT, top = 3 * FT;
  baseCabinet(B, it, { type: "sink", top });
  // undermount single bowl: counter cut-out with a stainless basin below it
  const bw = Math.min(w - 6 * IN, 27 * IN), bd = 16 * IN, bz = 0.5 * IN, depth = 8.5 * IN, y0 = top - 1.25 * IN - depth;
  counter(B, w, d, top, { hole: [-bw / 2, bw / 2, bz - bd / 2, bz + bd / 2] });
  const wall = 0.06 * IN;
  B.add("steel", rbox(bw, 0.05 * IN, bd, 0, y0, bz, 0));
  B.add("steel", rbox(bw, depth, wall, 0, y0, bz - bd / 2, 0));
  B.add("steel", rbox(bw, depth, wall, 0, y0, bz + bd / 2, 0));
  B.add("steel", rbox(wall, depth, bd, -bw / 2, y0, bz, 0));
  B.add("steel", rbox(wall, depth, bd, bw / 2, y0, bz, 0));
  B.add("darkSteel", cyl(1.6 * IN, 0.1 * IN, 0, y0 + 0.08 * IN, bz, "y", 20)); // drain
  faucet(B, 0, top, -d / 2 + 2.6 * IN, { reach: 8.5 * IN });
}

function range(B, it) {
  const w = it.w * FT, d = it.d * FT, h = 3 * FT;
  // stainless body, black glass top with cast-iron grates, oven door with a window
  B.add("steel", rbox(w - 0.004, h - 1.2 * IN, d - IN, 0, 0, -0.5 * IN, 0.004));
  B.add("blackGlass", rbox(w, 0.5 * IN, d - 0.5 * IN, 0, h - 1.2 * IN, 0, 0.003));
  const gx = [-w / 4, w / 4], gz = [-d / 4 + IN, d / 4 - 0.5 * IN];
  for (const x of gx) for (const z of gz) {
    B.add("darkSteel", cyl(1.6 * IN, 0.6 * IN, x, h - 0.4 * IN, z, "y", 18));
    B.add("darkSteel", cyl(1.0 * IN, 0.35 * IN, x, h + 0.05 * IN, z, "y", 14));
  }
  for (const s of [-1, 1]) B.add("darkSteel", rbox(w - 2 * IN, 0.5 * IN, 0.6 * IN, 0, h - 0.2 * IN, s * (d / 4 - IN / 4), 0));
  for (const x of [-w / 2 + IN, 0, w / 2 - IN]) B.add("darkSteel", rbox(0.6 * IN, 0.5 * IN, d - 3 * IN, x, h - 0.2 * IN, 0, 0));
  // control panel with knobs on the front
  const zf = d / 2 - 0.5 * IN;
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / 5;
    B.add("darkSteel", cyl(0.9 * IN, 1 * IN, x, h - 3.4 * IN, zf + 0.5 * IN, "z", 16));
  }
  // oven door: window and a bar handle
  B.add("blackGlass", rbox(w - 7 * IN, 9 * IN, 0.2 * IN, 0, 10 * IN, zf + 0.1 * IN, 0.002));
  B.add("steel", cyl(0.45 * IN, w - 4 * IN, 0, h - 7 * IN, zf + 1.6 * IN, "x", 14));
  for (const s of [-1, 1]) B.add("steel", cyl(0.3 * IN, 1.4 * IN, s * (w / 2 - 3 * IN), h - 7 * IN, zf + 0.9 * IN, "z", 10));
  B.add("darkSteel", rbox(w - 2 * IN, 3.5 * IN, 0.2 * IN, 0, 0, zf, 0)); // drawer kick
}

function fridge(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT;
  const zf = d / 2 - 3.8 * IN, split = h * 0.36, g = 0.15 * IN; // doors and handles stay inside the footprint
  B.add("steel", rbox(w, h, d - 3.8 * IN, 0, 0, -1.9 * IN, 0.006)); // cabinet
  // French doors above, freezer drawer below
  B.add("steel", rbox(w / 2 - g, h - split - g, 2 * IN, -w / 4, split + g, zf, 0.008));
  B.add("steel", rbox(w / 2 - g, h - split - g, 2 * IN, w / 4, split + g, zf, 0.008));
  B.add("steel", rbox(w - g, split - 1.5 * IN, 2 * IN, 0, 1.5 * IN, zf, 0.008));
  B.add("darkSteel", rbox(w - 0.004, 1.5 * IN, d - 3 * IN, 0, 0, -1.5 * IN, 0)); // grille
  const hz = zf + 2 * IN + 1.1 * IN, hl = (h - split) * 0.55, hy = split + (h - split) * 0.42;
  for (const s of [-1, 1]) {
    B.add("steel", cyl(0.45 * IN, hl, s * 1.6 * IN, hy + hl / 2, hz, "y", 14));
    for (const e of [-1, 1]) B.add("steel", cyl(0.3 * IN, 1.4 * IN, s * 1.6 * IN, hy + hl / 2 + e * (hl / 2 - IN), hz - 0.7 * IN, "z", 10));
  }
  B.add("steel", cyl(0.45 * IN, w * 0.6, 0, split - 4 * IN, hz, "x", 14));
}

function upperCabinet(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, zf = d / 2 - 0.75 * IN, g = 0.12 * IN;
  B.add("cabinet", rbox(w, h, d - 0.75 * IN, 0, 0, -0.375 * IN, 0.002));
  const doors = w > 1.75 * FT ? 2 : 1;
  for (let i = 0; i < doors; i++) {
    const a = -w / 2 + (w * i) / doors + g, b = -w / 2 + (w * (i + 1)) / doors - g;
    shakerFront(B, a, b, g, h - g, zf, { pull: "v", side: doors === 2 ? (i === 0 ? 1 : -1) : 1 });
  }
  B.add("cabinet", rbox(w, 1.5 * IN, 1 * IN, 0, -1.5 * IN, d / 2 - 0.5 * IN, 0.002)); // light rail
}

// chimney hood: a tapered canopy and a flue up to the ceiling (ceilY = local height of the ceiling)
function hood(B, it, ceilY) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT;
  const can = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.36, Math.SQRT1_2, 1, 4, 1);
  can.rotateY(Math.PI / 4);
  can.scale(w, h * 0.55, d);
  can.translate(0, h * 0.55 / 2 + 1.5 * IN, 0);
  B.add("steel", can);
  B.add("steel", rbox(w, 1.5 * IN, d, 0, 0, 0, 0.002));
  const fw = w * 0.36, fd = d * 0.6;
  B.add("steel", rbox(fw, Math.max(0.05, ceilY - h * 0.55 - 1.5 * IN), fd, 0, h * 0.55 + 1.5 * IN, -d / 2 + fd / 2, 0));
}

function vanity(B, it) {
  const w = it.w * FT, d = it.d * FT, top = it.h * FT;
  baseCabinet(B, it, { type: "vanity", top, mat: "vanityWood" });
  counter(B, w, d, top, { over: 0.75 * IN });
  // oval vessel bowl on the counter
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; pts.push(new THREE.Vector2(0.16 * Math.sin(a) + 0.005, 0.11 - 0.11 * Math.cos(a))); }
  pts.push(new THREE.Vector2(0.17, 0.115), new THREE.Vector2(0.16, 0.118));
  for (let i = 12; i >= 0; i--) { const a = (i / 12) * Math.PI / 2; pts.push(new THREE.Vector2(0.15 * Math.sin(a) + 0.004, 0.115 - 0.1 * Math.cos(a))); }
  const bowl = new THREE.LatheGeometry(pts, 32);
  bowl.scale(1, 1, 0.78);
  bowl.translate(0, top, 0.6 * IN);
  B.add("porcelain", bowl);
  faucet(B, 0, top, -d / 2 + 2.2 * IN, { reach: 6 * IN, height: 11 * IN });
}

function mirror(B, it) {
  const w = it.w * FT, h = it.h * FT, d = 0.75 * IN;
  B.add("frameBlack", rbox(w, h, d, 0, 0, -it.d * FT / 2 + d / 2, 0.003));
  B.add("mirror", rbox(w - 1.5 * IN, h - 1.5 * IN, 0.1 * IN, 0, 0.75 * IN, -it.d * FT / 2 + d + 0.05 * IN, 0));
}

// ---------------------------------------------------------------- bedroom and living pieces
function drawerFront(B, x0, x1, y0, y1, zf, mat, pullMat = "brass") {
  const w = x1 - x0, h = y1 - y0, t = 0.7 * IN;
  B.add(mat, rbox(w, h, t, (x0 + x1) / 2, y0, zf + t / 2, 0.003));
  const len = Math.min(5 * IN, w * 0.4), py = y0 + h / 2, zp = zf + t + 0.55 * IN;
  B.add(pullMat, cyl(0.2 * IN, len, (x0 + x1) / 2, py, zp, "x", 12));
  for (const s of [-1, 1]) B.add(pullMat, cyl(0.15 * IN, 0.55 * IN, (x0 + x1) / 2 + s * (len / 2 - 0.3 * IN), py, zp - 0.28 * IN, "z", 8));
}
function legs(B, w, d, h, mat, { inset = 1.5 * IN, r = 0.75 * IN, taper = 0.6 } = {}) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(mat, cyl(r, h, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset), "y", 12, r * taper));
}
function tableLamp(B, x, y, z) {
  B.add("porcelain", cyl(2.2 * IN, 7 * IN, x, y + 3.5 * IN, z, "y", 20, 2.8 * IN));
  B.add("brass", cyl(0.25 * IN, 5 * IN, x, y + 9.5 * IN, z, "y", 8));
  B.add("fabricShade", new THREE.CylinderGeometry(4 * IN, 5.2 * IN, 7 * IN, 28, 1, true).translate(x, y + 15 * IN, z));
}
function bed(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, single = it.key === "bedSingle";
  const baseTop = 0.95 * FT, legH = 0.35 * FT, matH = 0.85 * FT, zHead = -d / 2;
  legs(B, w - 0.04, d - 0.04, legH, "walnut", { r: 0.9 * IN, taper: 0.8 });
  B.add("linen", rbox(w - 0.03, baseTop - legH, d - 0.05, 0, legH, 0.025, 0.012)); // upholstered base
  B.add("linen", rbox(w, h - legH, 0.28 * FT, 0, legH, zHead + 0.14 * FT, 0.03)); // headboard
  const mz = 0.14 * FT;
  B.add("mattress", rbox(w - 0.1, matH, d - 0.32 * FT, 0, baseTop, mz, 0.05));
  const top = baseTop + matH;
  // duvet over the lower two-thirds, falling a little over the sides and foot
  const dz0 = zHead + 0.32 * FT + (d - 0.32 * FT) * 0.3, dz1 = d / 2 - 0.035;
  B.add("duvet", rbox(w - 0.02, 0.16 * FT, dz1 - dz0, 0, top - 0.04, (dz0 + dz1) / 2, 0.035));
  for (const sx of [-1, 1]) B.add("duvet", rbox(0.04, matH * 0.75, dz1 - dz0, sx * (w / 2 - 0.03), top - matH * 0.75, (dz0 + dz1) / 2, 0.018));
  B.add("duvet", rbox(w - 0.02, matH * 0.75, 0.04, 0, top - matH * 0.75, dz1 + 0.015, 0.018));
  // folded throw across the foot, pillows at the head
  B.add("throwSage", rbox(w - 0.01, 0.1 * FT, 1.1 * FT, 0, top + 0.04, d / 2 - 0.9 * FT, 0.03));
  const n = single ? 1 : 2, pw = single ? w * 0.7 : w / 2 - 0.06;
  for (let i = 0; i < n; i++) {
    const x = single ? 0 : (i ? 1 : -1) * (w / 4);
    B.add("bedding", rbox(pw, 0.42 * FT, 1.15 * FT, x, top - 0.02, zHead + 0.32 * FT + 0.6 * FT, 0.09));
    B.add("pillowAccent", rbox(pw * 0.62, 0.36 * FT, 0.5 * FT, x, top + 0.02, zHead + 0.32 * FT + 1.35 * FT, 0.07));
  }
}
function nightstand(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, legH = 0.4 * FT;
  legs(B, w, d, legH, "walnut", { r: 0.6 * IN });
  B.add("walnut", rbox(w, h - legH, d, 0, legH, 0, 0.004));
  drawerFront(B, -w / 2 + 0.01, w / 2 - 0.01, h - 0.62 * FT, h - 0.06 * FT, d / 2, "walnut");
  tableLamp(B, -w * 0.15, h, -d * 0.1);
}
function dresser(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, legH = 0.35 * FT;
  legs(B, w, d, legH, "walnut", { r: 0.7 * IN });
  B.add("oak", rbox(w, h - legH, d, 0, legH, 0, 0.004));
  const rows = 3, g = 0.12 * IN;
  for (let c = 0; c < 2; c++) for (let rr = 0; rr < rows; rr++) {
    const x0 = -w / 2 + (w * c) / 2 + g, x1 = -w / 2 + (w * (c + 1)) / 2 - g;
    const y0 = legH + 0.05 + ((h - legH - 0.1) * rr) / rows + g, y1 = legH + 0.05 + ((h - legH - 0.1) * (rr + 1)) / rows - g;
    drawerFront(B, x0, x1, y0, y1, d / 2, "oak");
  }
  // a few things on top
  B.add("bookColors1", rbox(0.75 * FT, 0.16 * FT, 0.55 * FT, w * 0.25, h, 0, 0.005));
  B.add("bookColors3", rbox(0.68 * FT, 0.12 * FT, 0.5 * FT, w * 0.25, h + 0.16 * FT, 0, 0.005));
  B.add("porcelain", cyl(2 * IN, 8 * IN, -w * 0.25, h + 4 * IN, 0, "y", 18, 1.4 * IN));
}
function tvStand(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, legH = 0.4 * FT;
  legs(B, w, d, legH, "walnut", { r: 0.7 * IN, inset: 2.5 * IN });
  B.add("walnut", rbox(w, h - legH, d, 0, legH, 0, 0.004));
  const doors = 3, g = 0.12 * IN;
  for (let i = 0; i < doors; i++) {
    const x0 = -w / 2 + (w * i) / doors + g, x1 = -w / 2 + (w * (i + 1)) / doors - g;
    if (i === 1) { B.add("cabinetInside", rbox(x1 - x0, h - legH - 0.12, 0.05, (x0 + x1) / 2, legH + 0.06, d / 2 - 0.08, 0)); continue; } // open center
    B.add("oak", rbox(x1 - x0, h - legH - 0.08, 0.7 * IN, (x0 + x1) / 2, legH + 0.04, d / 2 + 0.35 * IN, 0.003));
  }
}
function tv(B, it) {
  const w = it.w * FT, h = it.h * FT, d = 1.6 * IN;
  // panel on a slim stand
  B.add("tvBody", rbox(w, h * 0.92, d, 0, h * 0.08, 0, 0.004));
  B.add("tvScreen", rbox(w - 0.6 * IN, h * 0.92 - 0.6 * IN, 0.1 * IN, 0, h * 0.08 + 0.3 * IN, d / 2 + 0.05 * IN, 0));
  B.add("tvBody", rbox(w * 0.3, 0.3 * IN, it.d * FT - 0.2 * IN, 0, 0, 0, 0.002));
  B.add("tvBody", rbox(2.5 * IN, h * 0.12, 1 * IN, 0, 0, -0.3 * IN, 0.002));
}
function coffeeTable(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, t = 1.2 * IN;
  legs(B, w - 0.06, d - 0.06, h - t, "walnut", { r: 0.85 * IN, taper: 0.55, inset: 2 * IN });
  B.add("oak", rbox(w, t, d, 0, h - t, 0, 0.006));
  B.add("oak", rbox(w - 0.25, 0.6 * IN, d - 0.25, 0, 0.25 * FT, 0, 0.004)); // lower shelf
  B.add("bookColors0", rbox(0.75 * FT, 0.12 * FT, 0.55 * FT, w * 0.2, h, 0, 0.004));
  B.add("bookColors2", rbox(0.6 * FT, 0.1 * FT, 0.45 * FT, w * 0.2, h + 0.12 * FT, 0.02, 0.004));
  B.add("porcelain", cyl(2.4 * IN, 3 * IN, -w * 0.22, h + 1.5 * IN, 0, "y", 18, 3 * IN));
}
function bookcase(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, t = 0.75 * IN, shelves = 5;
  B.add("oak", rbox(t, h, d, -w / 2 + t / 2, 0, 0, 0.002));
  B.add("oak", rbox(t, h, d, w / 2 - t / 2, 0, 0, 0.002));
  B.add("oak", rbox(w, h, 0.3 * IN, 0, 0, -d / 2 + 0.15 * IN, 0));
  let seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i <= shelves; i++) {
    const y = (h - t) * (i / shelves);
    B.add("oak", rbox(w - 2 * t, t, d - 0.3 * IN, 0, y, 0.15 * IN, 0.002));
    if (i === shelves) continue;
    let x = -w / 2 + t + 0.02;
    while (x < w / 2 - t - 0.08 && r() > 0.08) {
      const bw = (0.9 + r() * 1.4) * IN, bh = ((h - t) / shelves) * (0.55 + r() * 0.3);
      B.add(`bookColors${Math.floor(r() * 8)}`, rbox(bw, bh, d * 0.75, x + bw / 2, y + t, 0, 0.002));
      x += bw + (r() < 0.1 ? 3 * IN : 0.1 * IN);
    }
  }
}
function desk(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, t = 1.2 * IN;
  legs(B, w - 0.04, d - 0.04, h - t, "walnut", { r: 0.8 * IN, taper: 0.7 });
  B.add("oak", rbox(w, t, d, 0, h - t, 0, 0.005));
  tableLamp(B, w * 0.32, h, -d * 0.2);
  B.add("tvBody", rbox(1.1 * FT, 0.05 * FT, 0.75 * FT, -w * 0.1, h, 0.05, 0.004)); // laptop
}
// ---------------------------------------------------------------- bath and laundry
function toilet(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT;
  const zBack = -d / 2;
  // tank
  B.add("porcelain", rbox(w, h - 1.45 * FT, 0.6 * FT, 0, 1.45 * FT, zBack + 0.33 * FT, 0.02));
  B.add("porcelain", rbox(w, 0.08 * FT, 0.66 * FT, 0, h - 0.08 * FT, zBack + 0.33 * FT, 0.015));
  B.add("chrome", cyl(0.3 * IN, 2.2 * IN, -w * 0.32, h - 0.35 * FT, zBack + 0.66 * FT, "x", 8));
  // bowl and seat: a lathe profile squashed into an oval
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.11, 0), new THREE.Vector2(0.1, 0.12), new THREE.Vector2(0.15, 0.3), new THREE.Vector2(0.18, 0.38), new THREE.Vector2(0.17, 0.4), new THREE.Vector2(0.12, 0.36), new THREE.Vector2(0.06, 0.22)];
  const bowl = new THREE.LatheGeometry(pts, 32); bowl.scale((w * 0.42) / 0.18, 1, 1.25); bowl.translate(0, 0, zBack + 0.66 * FT + 0.25);
  B.add("porcelain", bowl);
  const ring = new THREE.Shape(); ring.absellipse(0, 0, 0.185, 0.235, 0, Math.PI * 2);
  const lid = new THREE.ExtrudeGeometry(ring, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 32 });
  lid.rotateX(-Math.PI / 2); lid.scale((w * 0.42) / 0.185, 1, 1.25 * 0.18 / 0.235); lid.translate(0, 0.405, zBack + 0.66 * FT + 0.25);
  B.add("porcelain", lid);
}
function bathtub(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, rim = 0.28 * FT;
  // shell with a rounded-rect basin cut into the top
  const shape = new THREE.Shape(); shape.moveTo(-w / 2, -d / 2); shape.lineTo(w / 2, -d / 2); shape.lineTo(w / 2, d / 2); shape.lineTo(-w / 2, d / 2); shape.closePath();
  const hole = new THREE.Path(), iw = w / 2 - rim, id = d / 2 - rim, cr = 0.25;
  hole.moveTo(-iw + cr, -id); hole.lineTo(iw - cr, -id); hole.quadraticCurveTo(iw, -id, iw, -id + cr); hole.lineTo(iw, id - cr); hole.quadraticCurveTo(iw, id, iw - cr, id); hole.lineTo(-iw + cr, id); hole.quadraticCurveTo(-iw, id, -iw, id - cr); hole.lineTo(-iw, -id + cr); hole.quadraticCurveTo(-iw, -id, -iw + cr, -id);
  shape.holes.push(hole);
  const shell = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 10 });
  shell.rotateX(-Math.PI / 2);
  B.add("porcelain", shell);
  const floor = new THREE.ShapeGeometry(new THREE.Shape(hole.getPoints(10)), 10); floor.rotateX(-Math.PI / 2); floor.translate(0, 0.3 * FT, 0);
  B.add("porcelain", floor);
  // spout and handle at the wall end
  B.add("chrome", cyl(0.6 * IN, 5 * IN, -w / 2 + rim / 2, h + 2 * IN, -d / 2 + 0.08, "z", 12));
  B.add("chrome", cyl(1.4 * IN, 0.5 * IN, -w / 2 + rim / 2, h + 8 * IN, -d / 2 + 0.01, "z", 18));
  // curtain rod across the open side
  B.add("chrome", cyl(0.5 * IN, w, 0, 6.6 * FT - FT * it.elev, d / 2 - 0.05, "x", 10));
  B.add("bedding", rbox(w * 0.32, 5.4 * FT, 0.04, -w / 2 + w * 0.16, 1.2 * FT, d / 2 - 0.05, 0.01)); // gathered curtain
}
function shower(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT;
  B.add("porcelain", rbox(w, 0.25 * FT, d, 0, 0, 0, 0.01)); // pan with curb
  B.add("showerTile", rbox(w, h - 0.25 * FT, 0.04, 0, 0.25 * FT, -d / 2 + 0.02, 0));
  B.add("showerGlass", rbox(w - 0.04, h - 0.6 * FT, 0.02, 0, 0.25 * FT, d / 2 - 0.02, 0));
  B.add("chrome", rbox(0.04, h - 0.6 * FT, 0.04, w / 2 - 0.03, 0.25 * FT, d / 2 - 0.02, 0));
  B.add("chrome", cyl(0.4 * IN, 0.5 * FT, 0, h - 0.6 * FT, -d / 2 + 0.25 * FT, "z", 10));
  B.add("chrome", cyl(2.5 * IN, 0.4 * IN, 0, h - 0.62 * FT, -d / 2 + 0.5 * FT, "y", 20));
  B.add("chrome", cyl(1.4 * IN, 0.6 * IN, 0, 3.8 * FT, -d / 2 + 0.06, "z", 18));
}
function washerDryer(B, it) {
  const w = it.w * FT, d = it.d * FT, h = it.h * FT, unit = (h - 0.05) / 2;
  for (let i = 0; i < 2; i++) {
    const y = i * unit;
    const fz = d / 2 - 2.4 * IN; // front face, leaving room for the door ring inside the footprint
    B.add("appliance", rbox(w, unit - 0.01, d - 2.4 * IN, 0, y, -1.2 * IN, 0.012));
    B.add("darkSteel", rbox(w - 0.06, 0.28 * FT, 0.02, 0, y + unit - 0.36 * FT, fz, 0.004)); // control strip
    B.add("chrome", cyl(0.9 * IN, 0.8 * IN, w * 0.3, y + unit - 0.22 * FT, fz + 0.3 * IN, "z", 16));
    const door = new THREE.TorusGeometry(0.62 * FT * 0.5 * 1.2, 1.1 * IN, 10, 36); door.translate(0, y + unit * 0.45, fz + 1 * IN);
    B.add("chrome", door);
    B.add("blackGlass", cyl(0.62 * FT * 0.5 * 1.15, 0.4 * IN, 0, y + unit * 0.45, fz + 0.6 * IN, "z", 36));
  }
}

// ---------------------------------------------------------------- build everything for a plan
// it -> world transform used by the engine (same as the furniture: rotate, then move to the item)
export function buildFixtures({ items, X, Z, FLOOR, CEIL, lib }) {
  const B = new Batches();
  const placed = [];
  const handled = new Set(["cabinet", "sink", "range", "fridge", "upper", "hood", "vanity", "mirror",
    "bedDouble", "bedSingle", "nightstand", "dresser", "tvStand", "tv", "coffeeTable", "bookcase", "desk",
    "toilet", "bathtub", "shower", "washerDryer", "rug"]);
  const extra = [], mirrors = [];
  for (const it of items) {
    if (!handled.has(it.key)) continue;
    const L = new Batches();
    const baseY = FLOOR + it.elev * FT;
    if (it.key === "cabinet") { baseCabinet(L, it); counter(L, it.w * FT, it.d * FT, 3 * FT); }
    else if (it.key === "sink") kitchenSink(L, it);
    else if (it.key === "range") range(L, it);
    else if (it.key === "fridge") fridge(L, it);
    else if (it.key === "upper") upperCabinet(L, it);
    else if (it.key === "hood") hood(L, it, CEIL - baseY);
    else if (it.key === "vanity") vanity(L, it);
    else if (it.key === "mirror") {
      mirror(L, it);
      // where the glass is, for a live reflection on desktop (see createTour)
      const gw = it.w * FT - 1.5 * IN, gh = it.h * FT - 1.5 * IN;
      const mm = new THREE.Matrix4().makeRotationY((it.rot * Math.PI) / 180).premultiply(new THREE.Matrix4().makeTranslation(X(it.x), FLOOR + it.elev * FT, Z(it.y)))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0.75 * IN + gh / 2, -it.d * FT / 2 + 0.75 * IN + 0.16 * IN));
      mirrors.push({ matrix: mm, w: gw, h: gh });
    }
    else if (it.key === "bedDouble" || it.key === "bedSingle") bed(L, it);
    else if (it.key === "nightstand") nightstand(L, it);
    else if (it.key === "dresser") dresser(L, it);
    else if (it.key === "tvStand") tvStand(L, it);
    else if (it.key === "tv") tv(L, it);
    else if (it.key === "coffeeTable") coffeeTable(L, it);
    else if (it.key === "bookcase") bookcase(L, it);
    else if (it.key === "desk") desk(L, it);
    else if (it.key === "toilet") toilet(L, it);
    else if (it.key === "bathtub") bathtub(L, it);
    else if (it.key === "shower") shower(L, it);
    else if (it.key === "washerDryer") washerDryer(L, it);
    else if (it.key === "rug") {
      // its own mesh: the pattern is one image across the whole rug (not tiled)
      const g = new THREE.BoxGeometry(it.w * FT, 0.012, it.d * FT);
      g.translate(0, 0.006, 0);
      const m2 = new THREE.Matrix4().makeRotationY((it.rot * Math.PI) / 180).premultiply(new THREE.Matrix4().makeTranslation(X(it.x), FLOOR + 0.002, Z(it.y)));
      g.applyMatrix4(m2);
      const mesh = new THREE.Mesh(g, lib.rug); mesh.receiveShadow = true; mesh.name = "detail:rug";
      extra.push(mesh);
      g.computeBoundingBox();
      placed.push({ key: it.key, box: g.boundingBox.clone(), rot: it.rot });
      continue;
    }
    const m = new THREE.Matrix4().makeRotationY((it.rot * Math.PI) / 180).premultiply(new THREE.Matrix4().makeTranslation(X(it.x), baseY, Z(it.y)));
    const bb = new THREE.Box3();
    for (const [key, list] of L.g) for (const g of list) { g.applyMatrix4(m); g.computeBoundingBox(); bb.union(g.boundingBox); B.add(key, g); }
    placed.push({ key: it.key, box: bb, rot: it.rot });
  }
  return { meshes: [...B.meshes(lib), ...extra], placed, handled, mirrors };
}

// Outlets (every ~10 ft at 16", above counters at 44") and switches beside room doors (48").
// segments: [{a:[x,y], b:[x,y], n:[nx,ny], kind:'wall'|'counter'}] in plan feet, n pointing into the room.
export function buildWallDevices({ segments, switches, X, Z, FLOOR, rotOf }) {
  const B = new Batches();
  const plate = (px, py, n, zFt, tall = 4.5, wide = 2.75, dark = false) => {
    const geo = rbox(wide * IN, tall * IN, 0.22 * IN, 0, -tall * IN / 2, 0.11 * IN, 0.02 * IN);
    const ang = (rotOf(n) * Math.PI) / 180; // same rotation rule as the furniture: the plate's +z faces into the room
    const m = new THREE.Matrix4().makeRotationY(ang).premultiply(new THREE.Matrix4().makeTranslation(X(px), FLOOR + zFt * FT, Z(py)));
    geo.applyMatrix4(m); B.add(dark ? "plateDark" : "plate", geo);
    return { m };
  };
  for (const s of segments) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    if (len < 2.5) continue;
    const step = s.kind === "counter" ? 4 : 10, z = s.kind === "counter" ? 3.65 : 1.35;
    const count = Math.max(1, Math.floor(len / step));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count, px = s.a[0] + (s.b[0] - s.a[0]) * t + s.n[0] * 0.02, py = s.a[1] + (s.b[1] - s.a[1]) * t + s.n[1] * 0.02;
      const { m } = plate(px, py, s.n, z);
      // two receptacle faces
      for (const dy of [-1.15, -3.35]) {
        const f = rbox(1.35 * IN, 1.1 * IN, 0.12 * IN, 0, dy * IN - 0.55 * IN, 0.28 * IN, 0.08 * IN);
        f.applyMatrix4(m); B.add("plate", f);
        for (const dx of [-0.25, 0.25]) { const slot = rbox(0.08 * IN, 0.4 * IN, 0.05 * IN, dx * IN, dy * IN - 0.2 * IN, 0.4 * IN, 0); slot.applyMatrix4(m); B.add("plateDark", slot); }
      }
    }
  }
  for (const sw of switches) {
    const { m } = plate(sw.x + sw.n[0] * 0.02, sw.y + sw.n[1] * 0.02, sw.n, 4.15);
    const t = rbox(0.6 * IN, 1.0 * IN, 0.35 * IN, 0, -2.75 * IN, 0.35 * IN, 0.1 * IN); t.applyMatrix4(m); B.add("plate", t);
  }
  return B;
}

// Ceiling lights: 6" recessed cans in kitchens, baths and halls; a drum flush-mount elsewhere.
export function buildFixturesCeiling({ rooms, X, Z, CEIL }) {
  const B = new Batches();
  for (const r of rooms) {
    if (r.type === "closet" || r.type === "laundry") continue;
    const cx = r.x + r.w / 2, cy = r.y + r.d / 2;
    if (r.type === "kitchen" || r.type === "bath" || r.type === "hall") {
      const nx = Math.max(1, Math.round(r.w / 5)), ny = Math.max(1, Math.round(r.d / 5));
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = r.x + (r.w * (i + 0.5)) / nx, y = r.y + (r.d * (j + 0.5)) / ny;
        const ring = new THREE.CylinderGeometry(3.6 * IN, 3.6 * IN, 0.25 * IN, 24); ring.translate(X(x), CEIL - 0.125 * IN, Z(y)); B.add("canTrim", ring);
        const lens = new THREE.CircleGeometry(2.6 * IN, 20); lens.rotateX(Math.PI / 2); lens.translate(X(x), CEIL - 0.3 * IN, Z(y)); B.add("fixtureGlass", lens);
      }
    } else {
      const drum = new THREE.CylinderGeometry(7 * IN, 7 * IN, 4.5 * IN, 32, 1, true); drum.translate(X(cx), CEIL - 2.25 * IN - 0.3 * IN, Z(cy)); B.add("fabricShade", drum);
      const disk = new THREE.CircleGeometry(6.8 * IN, 28); disk.rotateX(Math.PI / 2); disk.translate(X(cx), CEIL - 4.6 * IN, Z(cy)); B.add("fixtureGlass", disk);
      const cap = new THREE.CylinderGeometry(2.5 * IN, 2.5 * IN, 0.4 * IN, 20); cap.translate(X(cx), CEIL - 0.2 * IN, Z(cy)); B.add("brass", cap);
    }
  }
  return B;
}

// Framed prints (generated abstract landscapes) over the sofa and bed.
export function artTexture(seed, w = 512, h = 384) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = c.getContext("2d");
  let s = seed >>> 0; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const palettes = [["#d9c7a7", "#b98b5e", "#6f7d63", "#40524a", "#e8dcc6"], ["#e3d5c3", "#9fb3b5", "#5f7f86", "#2f4a52", "#c8a27c"], ["#efe2cf", "#d4a373", "#a3b18a", "#588157", "#3a5a40"]];
  const p = palettes[Math.floor(r() * palettes.length)];
  g.fillStyle = p[0]; g.fillRect(0, 0, w, h);
  // layered rolling hills, like a Valley orchard at dusk
  for (let k = 1; k < p.length; k++) {
    g.fillStyle = p[k];
    g.beginPath(); g.moveTo(0, h);
    const base = h * (0.35 + k * 0.13);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base + Math.sin(x / (60 + k * 30) + r() * 0.2 + k) * (14 + k * 4) + Math.sin(x / 23 + k * 3) * 3);
    g.lineTo(w, h); g.closePath(); g.fill();
  }
  g.fillStyle = "rgba(255,250,235,0.55)"; g.beginPath(); g.arc(w * (0.2 + r() * 0.6), h * 0.25, h * 0.08, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.04})`; g.fillRect(r() * w, r() * h, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function buildArt({ items, plan, X, Z, FLOOR, lib, wallBehind, windowAt }) {
  const meshes = [];
  const B = new Batches();
  let seed = 3;
  const hang = (it, wFt, hFt, zFt) => {
    // on the wall behind the piece, centered
    const v = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] }[it.face];
    const px = it.x - v[0] * (it.d / 2 + 0.03), py = it.y - v[1] * (it.d / 2 + 0.03);
    const m = new THREE.Matrix4().makeRotationY((it.rot * Math.PI) / 180).premultiply(new THREE.Matrix4().makeTranslation(X(px), FLOOR + zFt * FT, Z(py)));
    const W = wFt * FT, H = hFt * FT, D = 1 * IN, b = 1 * IN, mat = 2 * IN;
    for (const g of [rbox(W, b, D, 0, 0, D / 2, 0.002), rbox(W, b, D, 0, H - b, D / 2, 0.002), rbox(b, H - 2 * b, D, -W / 2 + b / 2, b, D / 2, 0.002), rbox(b, H - 2 * b, D, W / 2 - b / 2, b, D / 2, 0.002)]) { g.applyMatrix4(m); B.add("frameBlack", g); }
    const mt = rbox(W - 2 * b, H - 2 * b, 0.1 * IN, 0, b, 0.15 * IN, 0); mt.applyMatrix4(m); B.add("plate", mt);
    const pic = new THREE.PlaneGeometry(W - 2 * b - 2 * mat, H - 2 * b - 2 * mat); pic.translate(0, H / 2, 0.3 * IN); pic.applyMatrix4(m);
    const mesh = new THREE.Mesh(pic, lib.canvasMat(artTexture(seed++)));
    mesh.receiveShadow = true;
    meshes.push(mesh);
  };
  for (const it of items) {
    // only on a plain stretch of wall: not over a window
    if (it.key === "sofa" && wallBehind(it) && !windowAt(it, Math.min(4, it.w * 0.6))) hang(it, Math.min(4, it.w * 0.6), 2.6, 4.4);
    else if ((it.key === "bedDouble" || it.key === "bedSingle") && !windowAt(it, Math.min(3.6, it.w * 0.7))) hang(it, Math.min(3.6, it.w * 0.7), 2.4, 4.6);
    else if (it.key === "diningTable") { /* table is free-standing: no wall behind it */ }
  }
  void plan;
  return { meshes: [...meshes, ...B.meshes(lib)] };
}
