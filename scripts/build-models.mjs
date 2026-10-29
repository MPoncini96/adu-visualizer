// Generates placeholder cottage/craftsman ADU models (.glb) for every plan x style.
// Units are meters, Y is up, the front door faces +Z, origin = footprint center at ground level.
// Run: npm run models
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync, readFileSync } from "node:fs";
import { MODELS, STYLES, geometryFt, ROOF } from "../lib/models.js";
import { outline, exteriorOpenings, planToModelFrame, FLOOR_FT } from "../lib/floorplan.js";

// Windows and doors come from the same floor plans the walk-in tour uses (lib/floorplans/*.json)
const planFor = (id) => JSON.parse(readFileSync(new URL(`../lib/floorplans/${id}.json`, import.meta.url)));
const FLOOR = FLOOR_FT * 0.3048; // finished floor height (m), level with the porch slab

const FT = 0.3048;
const EAVE = ROOF.eaveFt * FT; // top of wall
const PITCH = ROOF.pitch; // 6/12 roof
const OVER = 0.38; // eave overhang
const ROOF_T = ROOF.thicknessFt * FT;

const WHITE = [0.95, 0.95, 0.93];
const PALETTES = {
  cottage: {
    siding: "lap", wall: [0.42, 0.46, 0.52], base: [0.55, 0.55, 0.53], roof: [0.2, 0.21, 0.23],
    trim: WHITE, door: WHITE, glass: [0.11, 0.15, 0.19], lite: [0.11, 0.15, 0.19], porch: [0.72, 0.71, 0.68], frame: [0.09, 0.09, 0.09],
  },
  sage: {
    siding: "bb", wall: [0.52, 0.57, 0.4], base: [0.26, 0.3, 0.23], roof: [0.28, 0.28, 0.29],
    trim: WHITE, door: WHITE, glass: [0.11, 0.15, 0.19], lite: [0.11, 0.15, 0.19], porch: [0.72, 0.71, 0.68], frame: [0.09, 0.09, 0.09],
  },
  craftsman: {
    siding: "bb", wall: [0.74, 0.68, 0.54], base: [0.52, 0.27, 0.19], roof: [0.31, 0.29, 0.27], wainscot: 0.75,
    trim: WHITE, door: [0.36, 0.25, 0.17], glass: [0.11, 0.15, 0.19], lite: [0.11, 0.15, 0.19], porch: [0.72, 0.71, 0.68], frame: [0.09, 0.09, 0.09],
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

// Rectangles covering [t0,t1] x [y0,y1] minus the openings [{t0,t1,y0,y1}]
function piecesAround(t0, t1, y0, y1, ops) {
  const hit = ops.filter((o) => o.t1 > t0 && o.t0 < t1 && o.y1 > y0 && o.y0 < y1);
  if (!hit.length) return [[t0, t1, y0, y1]];
  const ts = [...new Set([t0, t1, ...hit.flatMap((o) => [o.t0, o.t1]).filter((v) => v > t0 && v < t1)])].sort((a, b) => a - b);
  const ys = [...new Set([y0, y1, ...hit.flatMap((o) => [o.y0, o.y1]).filter((v) => v > y0 && v < y1)])].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const tm = (ts[i] + ts[i + 1]) / 2, ym = (ys[j] + ys[j + 1]) / 2;
      if (hit.some((o) => tm > o.t0 && tm < o.t1 && ym > o.y0 && ym < o.y1)) continue;
      // merge with the cell below when it is the same column
      const prev = out[out.length - 1];
      if (prev && prev[0] === ts[i] && prev[1] === ts[i + 1] && prev[3] === ys[j]) prev[3] = ys[j + 1];
      else out.push([ts[i], ts[i + 1], ys[j], ys[j + 1]]);
    }
  }
  return out;
}

function walls(mb, pal, edges) {
  const baseH = pal.wainscot ?? 0.3;
  for (const e of edges) {
    const out = [e.n[0], 0, e.n[1]];
    const ops = e.ops.map((o) => ({ t0: o.t0, t1: o.t1, y0: o.y0, y1: o.y1 }));
    const quad = (mat, t0, t1, y0, y1) => {
      const P = (t, y) => [e.a[0] + e.dir[0] * t, y, e.a[1] + e.dir[1] * t];
      mb.face(mat, [P(t0, y0), P(t1, y0), P(t1, y1), P(t0, y1)], out);
    };
    for (const [t0, t1, y0, y1] of piecesAround(0, e.len, 0, baseH, ops)) quad("base", t0, t1, y0, y1);
    for (const [t0, t1, y0, y1] of piecesAround(0, e.len, baseH, EAVE, ops)) quad("wall", t0, t1, y0, y1);
    if (pal.wainscot) for (const [t0, t1] of piecesAround(0, e.len, baseH - 0.02, baseH + 0.06, ops)) onEdge(mb, "trim", e, t0, t1, baseH - 0.02, baseH + 0.06, 0, 0.04);
    if (pal.siding === "lap") {
      for (let y = baseH + 0.2; y < EAVE - 0.05; y += 0.2)
        for (const [t0, t1, y0, y1] of piecesAround(0, e.len, y - 0.025, y, ops)) onEdge(mb, "wall", e, t0, t1, y0, y1, 0, 0.018);
    } else {
      for (let t = 0.2; t < e.len - 0.1; t += 0.42)
        for (const [t0, t1, y0, y1] of piecesAround(t - 0.025, t + 0.025, baseH, EAVE, ops)) onEdge(mb, "wall", e, t0, t1, y0, y1, 0, 0.025);
    }
    for (const o of e.ops) {
      if (o.kind === "window") windowOn(mb, e, o);
      else if (o.kind === "door") doorOn(mb, e, o);
      else frenchDoorOn(mb, e, o);
    }
  }
  // white corner boards
  for (const e of edges) { const [x, z] = e.a; mb.box("trim", x - 0.07, x + 0.07, 0.02, EAVE, z - 0.07, z + 0.07); }
}

// Casing as a frame (open in the middle, so the opening can be seen through from inside)
function casing(mb, e, t0, t1, y0, y1, c, sill = true) {
  onEdge(mb, "trim", e, t0 - c, t0, y0, y1 + c, 0, 0.05);
  onEdge(mb, "trim", e, t1, t1 + c, y0, y1 + c, 0, 0.05);
  onEdge(mb, "trim", e, t0, t1, y1, y1 + c, 0, 0.05);
  if (sill) onEdge(mb, "trim", e, t0 - c, t1 + c, y0 - 0.06, y0, 0, 0.07);
}
function windowOn(mb, e, o) {
  const { t0, t1, y0, y1 } = o, t = (t0 + t1) / 2;
  casing(mb, e, t0, t1, y0, y1, 0.09);
  onEdge(mb, "glass", e, t0, t1, y0, y1, 0.05, 0.065);
  onEdge(mb, "trim", e, t - 0.025, t + 0.025, y0, y1, 0.065, 0.08); // mullion
  onEdge(mb, "trim", e, t0, t1, (y0 + y1) / 2 + 0.2, (y0 + y1) / 2 + 0.25, 0.065, 0.08);
}
function doorOn(mb, e, o) {
  const { t0, t1, y0, y1 } = o, t = (t0 + t1) / 2;
  casing(mb, e, t0, t1, y0, y1, 0.1, false);
  onEdge(mb, "door", e, t0, t1, y0, y1, 0.05, 0.07);
  onEdge(mb, "lite", e, t - 0.3, t + 0.3, y1 - 0.67, y1 - 0.17, 0.07, 0.08); // door lite (own material so the tour can hide it with the door)
}
function frenchDoorOn(mb, e, o) {
  const { t0, t1, y0, y1 } = o, t = (t0 + t1) / 2;
  casing(mb, e, t0, t1, y0, y1, 0.08, false);
  onEdge(mb, "frame", e, t0, t0 + 0.08, y0, y1, 0.05, 0.07);
  onEdge(mb, "frame", e, t1 - 0.08, t1, y0, y1, 0.05, 0.07);
  onEdge(mb, "frame", e, t0, t1, y1 - 0.08, y1, 0.05, 0.07);
  onEdge(mb, "frame", e, t0, t1, y0, y0 + 0.1, 0.05, 0.07);
  onEdge(mb, "frame", e, t - 0.04, t + 0.04, y0, y1, 0.05, 0.07);
  onEdge(mb, "glass", e, t0 + 0.08, t1 - 0.08, y0 + 0.1, y1 - 0.08, 0.06, 0.065);
}

// Exterior edges (meters, model frame) with their openings, from the floor plan
function planEdges(model, plan) {
  const fr = planToModelFrame(model);
  const P = ([x, y]) => [fr.x(x), fr.z(y)];
  const ops = exteriorOpenings(plan);
  return outline(plan, model).edges.map((pe) => {
    const a = P(pe.a), b = P(pe.b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const along = (v) => (pe.horiz ? v - pe.a[0] : v - pe.a[1]) * Math.sign(pe.horiz ? pe.b[0] - pe.a[0] : pe.b[1] - pe.a[1]) * FT;
    const mine = ops.filter((o) => o.wall === pe.name).map((o) => {
      const ta = along(o.at - o.w / 2), tb = along(o.at + o.w / 2);
      return { kind: o.kind, t0: Math.min(ta, tb), t1: Math.max(ta, tb), y0: FLOOR + o.sill * FT, y1: FLOOR + o.head * FT };
    });
    return { a, b, len, dir, n: [pe.n[0], -pe.n[1]], ops: mine };
  });
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
  const g = geometryFt(model);
  const M = (pts) => pts.map(([x, f]) => [x * FT, f * FT]);
  const body = M(g.body);
  walls(mb, pal, planEdges(model, planFor(model.id)));

  if (model.shape !== "L") {
    // Rectangle: front-facing gable; covered gable porch in front of the door
    const xs = body.map((p) => p[0]), zs = body.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    gableRoof(mb, { x0, x1, z0, z1, axis: "z", vent: true });
    if (g.porch) {
      const px0 = g.porch.x0 * FT, px1 = g.porch.x1 * FT, pz0 = g.porch.f0 * FT, pz1 = g.porch.f1 * FT;
      mb.box("porch", px0, px1, 0, 0.12, pz0, pz1);
      for (const x of [px0 + 0.12, px1 - 0.12]) mb.box("trim", x - 0.08, x + 0.08, 0.12, EAVE - 0.2, pz1 - 0.24, pz1 - 0.08);
      gableRoof(mb, { x0: px0 + 0.05, x1: px1 - 0.05, z0: pz0 + 0.01, z1: pz1 - 0.1, axis: "z", eave: EAVE - 0.15, ends: ["hi"], overBack: false });
    }
  } else {
    // L: side-gable main body + front-gable wing (cross gable), shed porch in the inside corner
    const W = model.W * FT;
    const wingX0 = g.wingX0 * FT;
    const mainZ0 = g.main.f0 * FT, mainZ1 = g.main.f1 * FT;
    const wingZ1 = Math.max(...body.map((p) => p[1]));
    gableRoof(mb, { x0: -W / 2, x1: W / 2, z0: mainZ0, z1: mainZ1, axis: "x" });
    gableRoof(mb, { x0: wingX0, x1: W / 2, z0: (mainZ0 + mainZ1) / 2, z1: wingZ1, axis: "z", ends: ["hi"], vent: true, overBack: false });

    const px0 = g.porch.x0 * FT, px1 = g.porch.x1 * FT, pz0 = g.porch.f0 * FT, pz1 = g.porch.f1 * FT;
    const depth = pz1 - pz0;
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
      .setRoughnessFactor(name === "glass" || name === "lite" ? 0.12 : name === "roof" ? 0.75 : 0.8)
      .setMetallicFactor(name === "glass" || name === "lite" ? 0.35 : 0));

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
