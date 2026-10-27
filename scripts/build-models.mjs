// Generates placeholder cottage/craftsman ADU models (.glb) for every plan x style.
// Units are meters, Y is up, the front door faces +Z, origin = footprint center at ground level.
// Run: npm run models
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync } from "node:fs";
import { MODELS, STYLES, footprintFt, doorFt } from "../lib/models.js";

const FT = 0.3048;
const EAVE = 2.75; // top of wall (~9 ft)
const PITCH = 0.5; // 6/12 roof
const OVER = 0.38; // eave overhang
const ROOF_T = 0.14;

const WHITE = [0.95, 0.95, 0.93];
const PALETTES = {
  cottage: {
    siding: "lap", wall: [0.42, 0.46, 0.52], base: [0.55, 0.55, 0.53], roof: [0.2, 0.21, 0.23],
    trim: WHITE, door: WHITE, glass: [0.11, 0.15, 0.19], porch: [0.72, 0.71, 0.68], frame: [0.09, 0.09, 0.09],
  },
  sage: {
    siding: "bb", wall: [0.52, 0.57, 0.4], base: [0.26, 0.3, 0.23], roof: [0.28, 0.28, 0.29],
    trim: WHITE, door: WHITE, glass: [0.11, 0.15, 0.19], porch: [0.72, 0.71, 0.68], frame: [0.09, 0.09, 0.09],
  },
  craftsman: {
    siding: "bb", wall: [0.74, 0.68, 0.54], base: [0.52, 0.27, 0.19], roof: [0.31, 0.29, 0.27], wainscot: 0.75,
    trim: WHITE, door: [0.36, 0.25, 0.17], glass: [0.11, 0.15, 0.19], porch: [0.72, 0.71, 0.68], frame: [0.09, 0.09, 0.09],
  },
};

// ---------------------------------------------------------------- mesh builder
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function crossN(a, b, c) {
  const u = sub(b, a), w = sub(c, a);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}

class MeshBuilder {
  constructor() { this.parts = {}; }
  part(mat) { return (this.parts[mat] ??= { pos: [], nrm: [], idx: [] }); }
  // Planar polygon (3 or 4 verts). Winding is fixed so the normal points along `out`.
  face(mat, verts, out) {
    let v = verts;
    let n = crossN(v[0], v[1], v[2]);
    if (out && dot(n, out) < 0) { v = v.slice().reverse(); n = n.map((x) => -x); }
    const p = this.part(mat);
    const i = p.pos.length / 3;
    for (const q of v) { p.pos.push(...q); p.nrm.push(...n); }
    p.idx.push(i, i + 1, i + 2);
    if (v.length === 4) p.idx.push(i, i + 2, i + 3);
  }
  box(mat, x0, x1, y0, y1, z0, z1) {
    [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)];
    [z0, z1] = [Math.min(z0, z1), Math.max(z0, z1)];
    const P = (x, y, z) => [x, y, z];
    this.face(mat, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], [0, 0, 1]);
    this.face(mat, [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], [0, 0, -1]);
    this.face(mat, [P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)], [1, 0, 0]);
    this.face(mat, [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], [-1, 0, 0]);
    this.face(mat, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], [0, 1, 0]);
    this.face(mat, [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], [0, -1, 0]);
  }
  // A roof plane with thickness: top in `mat`, edges in `edge` (white fascia), underside in `mat`.
  slab(mat, edge, q, th) {
    const b = q.map(([x, y, z]) => [x, y - th, z]);
    const c = q.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4 - th / 2, s[2] + p[2] / 4], [0, 0, 0]);
    const outFrom = (vs) => {
      const m = vs.reduce((s, p) => [s[0] + p[0] / vs.length, s[1] + p[1] / vs.length, s[2] + p[2] / vs.length], [0, 0, 0]);
      return sub(m, c);
    };
    this.face(mat, q, [0, 1, 0]);
    this.face(mat, b, [0, -1, 0]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const vs = [q[i], q[j], b[j], b[i]];
      this.face(edge, vs, outFrom(vs));
    }
  }
}

// ---------------------------------------------------------------- house parts
// Edge helper: an axis-aligned wall edge a->b with outward normal n (in x/z).
function edgeOf(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  return { a, b, len, dir: [dx / len, dz / len], n: [dz / len, -dx / len] };
}
// Box hugging a wall edge: t0..t1 along the edge, y0..y1 up, o0..o1 outward from the wall.
function onEdge(mb, mat, e, t0, t1, y0, y1, o0, o1) {
  const P = (t, o) => [e.a[0] + e.dir[0] * t + e.n[0] * o, e.a[1] + e.dir[1] * t + e.n[1] * o];
  const p = P(t0, o0), q = P(t1, o1);
  mb.box(mat, p[0], q[0], y0, y1, p[1], q[1]);
}

function walls(mb, pal, body) {
  const baseH = pal.wainscot ?? 0.3;
  for (let i = 0; i < body.length; i++) {
    const e = edgeOf(body[i], body[(i + 1) % body.length]);
    const out = [e.n[0], 0, e.n[1]];
    const A = (y) => [e.a[0], y, e.a[1]], B = (y) => [e.b[0], y, e.b[1]];
    mb.face("base", [A(0), B(0), B(baseH), A(baseH)], out);
    mb.face("wall", [A(baseH), B(baseH), B(EAVE), A(EAVE)], out);
    if (pal.wainscot) onEdge(mb, "trim", e, 0, e.len, baseH - 0.02, baseH + 0.06, 0, 0.04); // cap on the brick
    if (pal.siding === "lap") {
      for (let y = baseH + 0.2; y < EAVE - 0.05; y += 0.2) onEdge(mb, "wall", e, 0, e.len, y - 0.025, y, 0, 0.018);
    } else {
      for (let t = 0.2; t < e.len - 0.1; t += 0.42) onEdge(mb, "wall", e, t - 0.025, t + 0.025, baseH, EAVE, 0, 0.025);
    }
  }
  // white corner boards
  for (const [x, z] of body) mb.box("trim", x - 0.07, x + 0.07, 0.02, EAVE, z - 0.07, z + 0.07);
}

function windowOn(mb, e, t, w, sill, head) {
  onEdge(mb, "trim", e, t - w / 2 - 0.09, t + w / 2 + 0.09, sill - 0.12, head + 0.09, 0, 0.05); // casing + sill
  onEdge(mb, "glass", e, t - w / 2, t + w / 2, sill, head, 0.05, 0.065);
  onEdge(mb, "trim", e, t - 0.025, t + 0.025, sill, head, 0.065, 0.08); // mullion
  onEdge(mb, "trim", e, t - w / 2, t + w / 2, (sill + head) / 2 + 0.2, (sill + head) / 2 + 0.25, 0.065, 0.08);
}
function doorOn(mb, e, t) {
  onEdge(mb, "trim", e, t - 0.56, t + 0.56, 0.02, 2.24, 0, 0.05);
  onEdge(mb, "door", e, t - 0.46, t + 0.46, 0.02, 2.12, 0.05, 0.07);
  onEdge(mb, "glass", e, t - 0.3, t + 0.3, 1.45, 1.95, 0.07, 0.08); // door lite
}
function frenchDoorOn(mb, e, t) {
  onEdge(mb, "trim", e, t - 1.0, t + 1.0, 0.02, 2.3, 0, 0.05);
  onEdge(mb, "frame", e, t - 0.92, t + 0.92, 0.02, 2.2, 0.05, 0.07);
  onEdge(mb, "glass", e, t - 0.84, t - 0.04, 0.1, 2.12, 0.07, 0.08);
  onEdge(mb, "glass", e, t + 0.04, t + 0.84, 0.1, 2.12, 0.07, 0.08);
}

function openings(mb, body, door, french) {
  for (let i = 0; i < body.length; i++) {
    const e = edgeOf(body[i], body[(i + 1) % body.length]);
    if (e.len < 1.6) continue;
    const isFront = e.n[1] > 0.9;
    const doorHere = isFront && Math.abs(e.a[1] - door.z) < 0.05 && door.x > Math.min(e.a[0], e.b[0]) && door.x < Math.max(e.a[0], e.b[0]);
    const avoid = [];
    if (doorHere) {
      const t = (door.x - e.a[0]) / e.dir[0];
      doorOn(mb, e, t);
      avoid.push([t - 1.0, t + 1.0]);
    }
    const isRight = e.n[0] > 0.9;
    if (french && isRight && e.len > 4) {
      const t = e.len / 2;
      frenchDoorOn(mb, e, t);
      avoid.push([t - 1.5, t + 1.5]);
    }
    const n = Math.max(1, Math.floor(e.len / 3.0));
    for (let k = 0; k < n; k++) {
      const t = (e.len / n) * (k + 0.5);
      const w = isFront && !doorHere ? 1.2 : 0.9;
      if (avoid.some(([a, b]) => t + w / 2 > a && t - w / 2 < b)) continue;
      if (t - w / 2 < 0.35 || t + w / 2 > e.len - 0.35) continue;
      windowOn(mb, e, t, w, 0.95, 2.15);
    }
  }
}

// Gable roof over a rectangle. axis "z": ridge runs front-to-back; "x": ridge runs side to side.
// ends: which gable ends get a wall triangle ("lo" = -axis end, "hi" = +axis end).
function gableRoof(mb, { x0, x1, z0, z1, axis, eave = EAVE, ends = ["lo", "hi"], vent = false, overBack = true }) {
  const o = OVER;
  const yE = eave - o * PITCH;
  if (axis === "z") {
    const xm = (x0 + x1) / 2, yR = eave + ((x1 - x0) / 2) * PITCH;
    const zb = overBack ? z0 - o : z0, zf = z1 + o;
    mb.slab("roof", "trim", [[x0 - o, yE, zb], [x0 - o, yE, zf], [xm, yR, zf], [xm, yR, zb]], ROOF_T);
    mb.slab("roof", "trim", [[xm, yR, zb], [xm, yR, zf], [x1 + o, yE, zf], [x1 + o, yE, zb]], ROOF_T);
    for (const end of ends) {
      const z = end === "hi" ? z1 : z0;
      mb.face("wall", [[x0, eave, z], [x1, eave, z], [xm, yR - 0.02, z]], [0, 0, end === "hi" ? 1 : -1]);
      if (vent && end === "hi") mb.box("trim", xm - 0.28, xm + 0.28, eave + (yR - eave) * 0.3, eave + (yR - eave) * 0.3 + 0.36, z, z + 0.05);
    }
  } else {
    const zm = (z0 + z1) / 2, yR = eave + ((z1 - z0) / 2) * PITCH;
    mb.slab("roof", "trim", [[x0 - o, yE, z0 - o], [x1 + o, yE, z0 - o], [x1 + o, yR, zm], [x0 - o, yR, zm]], ROOF_T);
    mb.slab("roof", "trim", [[x0 - o, yR, zm], [x1 + o, yR, zm], [x1 + o, yE, z1 + o], [x0 - o, yE, z1 + o]], ROOF_T);
    for (const end of ends) {
      const x = end === "hi" ? x1 : x0;
      mb.face("wall", [[x, eave, z0], [x, eave, z1], [x, yR - 0.02, zm]], [end === "hi" ? 1 : -1, 0, 0]);
    }
  }
}

// ---------------------------------------------------------------- whole house
function buildHouse(model, style) {
  const pal = PALETTES[style];
  const mb = new MeshBuilder();
  const outline = footprintFt(model).map(([x, f]) => [x * FT, f * FT]);
  const d = doorFt(model);
  const door = { x: d.x * FT, z: d.f * FT };
  const french = model.beds >= 2 && model.shape !== "L";

  if (model.shape !== "L") {
    // Rectangle: front-facing gable, covered gable porch over the door (inside the footprint)
    const W = model.W * FT, D = model.D * FT;
    const pd = Math.min(1.5, D * 0.16);
    const front = D / 2 - pd;
    const body = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, front], [-W / 2, front]];
    door.z = front;
    walls(mb, pal, body);
    openings(mb, body, door, french);
    gableRoof(mb, { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: front, axis: "z", vent: true });

    const half = Math.min(1.3, W / 2 - 0.2);
    const px0 = Math.max(-W / 2 + 0.1, door.x - half), px1 = Math.min(W / 2 - 0.1, door.x + half);
    mb.box("porch", px0 - 0.1, px1 + 0.1, 0, 0.12, front, D / 2);
    for (const x of [px0 + 0.1, px1 - 0.1]) mb.box("trim", x - 0.08, x + 0.08, 0.12, EAVE - 0.2, D / 2 - 0.25, D / 2 - 0.09);
    gableRoof(mb, { x0: px0, x1: px1, z0: front - 0.6, z1: D / 2 - 0.1, axis: "z", eave: EAVE - 0.15, ends: ["hi"], overBack: false });
  } else {
    // L: side-gable main body + front-gable wing (cross gable), shed porch in the inside corner
    const W = model.W * FT, D = model.D * FT, ww = model.ww * FT, wd = model.wd * FT;
    const s = -wd / 2;
    const mainZ0 = -D / 2 + s, mainZ1 = D / 2 + s, wingX0 = W / 2 - ww;
    walls(mb, pal, outline);
    openings(mb, outline, door, false);
    gableRoof(mb, { x0: -W / 2, x1: W / 2, z0: mainZ0, z1: mainZ1, axis: "x" });
    gableRoof(mb, { x0: wingX0, x1: W / 2, z0: (mainZ0 + mainZ1) / 2, z1: mainZ1 + wd, axis: "z", ends: ["hi"], vent: true, overBack: false });

    const depth = Math.min(1.7, wd - 0.2);
    const px0 = Math.max(-W / 2 + 0.2, door.x - 1.6), px1 = wingX0;
    const pz0 = mainZ1, pz1 = mainZ1 + depth;
    mb.box("porch", px0, px1, 0, 0.12, pz0, pz1);
    mb.box("trim", px0 + 0.05, px0 + 0.21, 0.12, EAVE - 0.35, pz1 - 0.21, pz1 - 0.05);
    const yTop = EAVE - 0.08, yLow = yTop - (depth + 0.25) * 0.3;
    mb.slab("roof", "trim", [[px0 - 0.25, yTop, pz0], [px1, yTop, pz0], [px1, yLow, pz1 + 0.25], [px0 - 0.25, yLow, pz1 + 0.25]], 0.1);
  }
  return mb;
}

async function writeGlb(model, style, path) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pal = PALETTES[style];
  const mats = {};
  const material = (name) =>
    (mats[name] ??= doc
      .createMaterial(name)
      .setBaseColorFactor([...pal[name], 1])
      .setDoubleSided(true)
      .setRoughnessFactor(name === "glass" ? 0.12 : name === "roof" ? 0.75 : 0.8)
      .setMetallicFactor(name === "glass" ? 0.35 : 0));

  const mb = buildHouse(model, style);
  const mesh = doc.createMesh(`${model.id}-${style}`);
  for (const [name, p] of Object.entries(mb.parts)) {
    const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(p.pos)).setBuffer(buffer);
    const nrm = doc.createAccessor().setType("VEC3").setArray(new Float32Array(p.nrm)).setBuffer(buffer);
    const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(p.idx)).setBuffer(buffer);
    mesh.addPrimitive(
      doc.createPrimitive().setAttribute("POSITION", pos).setAttribute("NORMAL", nrm).setIndices(idx).setMaterial(material(name)),
    );
  }
  doc.createScene("scene").addChild(doc.createNode(`${model.name} (${style})`).setMesh(mesh));
  await new NodeIO().write(path, doc);
}

mkdirSync("public/models", { recursive: true });
for (const model of MODELS) {
  for (const style of STYLES) {
    const path = `public/models/${model.id}-${style.id}.glb`;
    await writeGlb(model, style.id, path);
  }
}
console.log(`wrote ${MODELS.length * STYLES.length} models`);
