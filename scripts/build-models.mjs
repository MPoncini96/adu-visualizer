// Generates simple placeholder ADU models (.glb) for every plan x style.
// Units are meters, Y is up, the front door faces +Z, origin = footprint center at ground level.
// Run: npm run models
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync } from "node:fs";
import { MODELS, STYLES } from "../lib/models.js";

const FT = 0.3048;

const PALETTES = {
  modern: {
    wall: [0.29, 0.30, 0.31], accent: [0.62, 0.42, 0.24], roof: [0.17, 0.17, 0.18],
    trim: [0.08, 0.08, 0.08], glass: [0.16, 0.22, 0.27], door: [0.08, 0.08, 0.08],
    base: [0.6, 0.6, 0.58], porch: [0.55, 0.38, 0.22], post: [0.08, 0.08, 0.08],
  },
  farmhouse: {
    wall: [0.95, 0.94, 0.91], accent: [0.95, 0.94, 0.91], roof: [0.15, 0.16, 0.17],
    trim: [0.97, 0.97, 0.96], glass: [0.16, 0.22, 0.27], door: [0.42, 0.27, 0.15],
    base: [0.6, 0.6, 0.58], porch: [0.55, 0.38, 0.22], post: [0.97, 0.97, 0.96],
  },
};

class MeshBuilder {
  constructor() { this.parts = {}; }
  part(mat) { return (this.parts[mat] ??= { pos: [], nrm: [], idx: [] }); }
  quad(mat, a, b, c, d) {
    // a,b,c,d counter-clockwise seen from outside
    const p = this.part(mat);
    const n = normal(a, b, c);
    const i = p.pos.length / 3;
    for (const v of [a, b, c, d]) { p.pos.push(...v); p.nrm.push(...n); }
    p.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  tri(mat, a, b, c) {
    const p = this.part(mat);
    const n = normal(a, b, c);
    const i = p.pos.length / 3;
    for (const v of [a, b, c]) { p.pos.push(...v); p.nrm.push(...n); }
    p.idx.push(i, i + 1, i + 2);
  }
  box(mat, x0, x1, y0, y1, z0, z1) {
    const v = (x, y, z) => [x, y, z];
    this.quad(mat, v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)); // +z
    this.quad(mat, v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0)); // -z
    this.quad(mat, v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1)); // +x
    this.quad(mat, v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)); // -x
    this.quad(mat, v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0)); // +y
    this.quad(mat, v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)); // -y
  }
}

function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}

// A window on one of the four walls. side: "front" | "back" | "left" | "right".
// c = position along the wall (meters from wall center), y0/y1 = sill/head heights.
function windowOn(m, side, W, D, c, w, y0, y1, glassMat = "glass", frameMat = "trim") {
  const t = 0.04, f = 0.07;
  const hw = W / 2, hd = D / 2;
  const add = (mat, inset, out) => {
    const a = c - w / 2 - inset, b = c + w / 2 + inset, lo = y0 - inset, hi = y1 + inset;
    if (side === "front") m.box(mat, a, b, lo, hi, hd, hd + out);
    if (side === "back") m.box(mat, -b, -a, lo, hi, -hd - out, -hd);
    if (side === "right") m.box(mat, hw, hw + out, lo, hi, -b, -a);
    if (side === "left") m.box(mat, -hw - out, -hw, lo, hi, a, b);
  };
  add(frameMat, f, t);
  add(glassMat, 0, t + 0.01);
}

function buildHouse(model, style) {
  const m = new MeshBuilder();
  const W = model.widthFt * FT;
  const Dtot = model.depthFt * FT;
  const farm = style === "farmhouse";
  const porchD = farm ? Math.min(1.8, Dtot * 0.2) : 0;
  const D = Dtot - porchD; // enclosed depth
  const zc = -porchD / 2; // shift body back so porch fits inside footprint
  const H = farm ? 2.9 : 3.2;
  const baseH = 0.3;

  // Wrap builder so body geometry is offset by zc on z.
  const body = {
    box: (mat, x0, x1, y0, y1, z0, z1) => m.box(mat, x0, x1, y0, y1, z0 + zc, z1 + zc),
  };

  // Foundation + walls
  body.box("base", -W / 2 - 0.05, W / 2 + 0.05, 0, baseH, -D / 2 - 0.05, D / 2 + 0.05);
  body.box("wall", -W / 2, W / 2, baseH, H, -D / 2, D / 2);

  // Modern wood accent panel on the front-left
  if (!farm) body.box("accent", -W / 2 - 0.02, -W / 2 + W * 0.38, baseH, H, D / 2, D / 2 + 0.03);

  // Door on the front, right of center
  const doorX = farm ? 0 : W * 0.18;
  body.box("door", doorX - 0.46, doorX + 0.46, baseH, baseH + 2.1, D / 2, D / 2 + 0.05);
  body.box("trim", doorX - 0.55, doorX + 0.55, baseH, baseH + 2.2, D / 2, D / 2 + 0.03);

  // Windows (positions in a body-local frame; apply zc by wrapping)
  const win = (side, c, w, y0, y1) => {
    const proxy = { box: (mat, x0, x1, a, b, z0, z1) => m.box(mat, x0, x1, a, b, z0 + zc, z1 + zc) };
    windowOn(proxy, side, W, D, c, w, y0, y1);
  };
  const sill = baseH + 0.9, head = baseH + 2.1;
  if (farm) {
    win("front", -W * 0.3, 0.9, sill, head);
    win("front", W * 0.3, 0.9, sill, head);
  } else {
    win("front", W * 0.36, Math.min(1.6, W * 0.2), baseH + 0.5, head);
  }
  const sideCount = Math.max(1, Math.floor(D / 3.5));
  for (let i = 0; i < sideCount; i++) {
    const c = -D / 2 + (D / sideCount) * (i + 0.5);
    win("right", c, farm ? 0.9 : 1.4, sill, head);
    win("left", c, farm ? 0.9 : 1.4, sill, head);
  }
  win("back", 0, farm ? 0.9 : 2.0, farm ? sill : baseH + 1.0, head);

  // Roof
  if (farm) {
    // Gable roof, ridge front-to-back (gable faces the street), 6/12 pitch, small overhang
    const o = 0.3;
    const rise = (W / 2 + o) * 0.5;
    const z0 = -D / 2 - o + zc, z1 = D / 2 + o + zc;
    const xL = -W / 2 - o, xR = W / 2 + o, yE = H, yR = H + rise;
    const th = 0.12;
    // top surfaces
    m.quad("roof", [xR, yE, z1], [xR, yE, z0], [0, yR, z0], [0, yR, z1]);
    m.quad("roof", [xL, yE, z0], [xL, yE, z1], [0, yR, z1], [0, yR, z0]);
    // undersides
    m.quad("roof", [xR, yE - th, z0], [xR, yE - th, z1], [0, yR - th, z1], [0, yR - th, z0]);
    m.quad("roof", [xL, yE - th, z1], [xL, yE - th, z0], [0, yR - th, z0], [0, yR - th, z1]);
    // fascia edges
    m.quad("roof", [xL, yE - th, z1], [0, yR - th, z1], [0, yR, z1], [xL, yE, z1]);
    m.quad("roof", [0, yR - th, z1], [xR, yE - th, z1], [xR, yE, z1], [0, yR, z1]);
    m.quad("roof", [0, yR - th, z0], [xL, yE - th, z0], [xL, yE, z0], [0, yR, z0]);
    m.quad("roof", [xR, yE - th, z0], [0, yR - th, z0], [0, yR, z0], [xR, yE, z0]);
    // gable end walls (triangles) front and back
    const zf = D / 2 + zc, zb = -D / 2 + zc, r2 = (W / 2) * 0.5;
    m.tri("wall", [-W / 2, H, zf], [W / 2, H, zf], [0, H + r2, zf]);
    m.tri("wall", [W / 2, H, zb], [-W / 2, H, zb], [0, H + r2, zb]);
    // board-and-batten hint: thin vertical battens on the front gable wall
    for (let x = -W / 2 + 0.4; x < W / 2; x += 0.4) {
      m.box("trim", x - 0.02, x + 0.02, baseH, H, D / 2 + zc, D / 2 + zc + 0.02);
    }

    // Front porch: deck, two posts, shed roof
    const pz0 = D / 2 + zc, pz1 = Dtot / 2;
    m.box("porch", -W / 2, W / 2, 0, baseH, pz0, pz1);
    for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) m.box("post", x - 0.08, x + 0.08, baseH, H - 0.2, pz1 - 0.25, pz1 - 0.09);
    m.box("roof", -W / 2 - 0.2, W / 2 + 0.2, H - 0.25, H - 0.13, pz0, pz1 + 0.15);
  } else {
    // Flat roof slab with overhang and a thin fascia
    body.box("roof", -W / 2 - 0.45, W / 2 + 0.45, H, H + 0.25, -D / 2 - 0.45, D / 2 + 0.45);
  }

  return m;
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
      .setRoughnessFactor(name === "glass" ? 0.15 : name === "roof" ? 0.45 : 0.85)
      .setMetallicFactor(name === "glass" ? 0.4 : name === "roof" ? 0.3 : 0));

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
  const node = doc.createNode(`${model.name} (${style})`).setMesh(mesh);
  doc.createScene("scene").addChild(node);
  await new NodeIO().write(path, doc);
}

mkdirSync("public/models", { recursive: true });
for (const model of MODELS) {
  for (const style of STYLES) {
    const path = `public/models/${model.id}-${style.id}.glb`;
    await writeGlb(model, style.id, path);
    console.log("wrote", path);
  }
}
