// Pure floor-plan geometry shared by the walk-in tour, its mini-map and the exterior model
// builder (so windows and doors line up inside and out). All inputs/outputs here are in FEET
// in plan coordinates: origin at the front-left exterior corner of the main body, x to the
// right along the front wall, y back into the house (see lib/floorplans/*.json).

export const FLOOR_FT = 0.12 / 0.3048; // finished floor sits on a 0.12 m slab (level with the porch)
export const DOOR_HEAD_FT = 6.9; // top of door openings, above the floor
export const OPENING_HEAD_FT = 7.2; // wide cased openings between rooms

// Real-world sizes (feet) for each furniture key in public/models/furniture-kit.glb.
// w = across the front, d = front-to-back, h = height, elev = height of its base off the floor.
export const CATALOG = {
  bedDouble: { w: 5, d: 6.8, h: 2.3 },
  bedSingle: { w: 3.3, d: 6.6, h: 2.1 },
  nightstand: { w: 1.7, d: 1.4, h: 2 },
  dresser: { w: 4, d: 1.6, h: 2.7 },
  sofa: { w: 7, d: 3, h: 2.8 },
  armchair: { w: 2.8, d: 2.8, h: 2.7 },
  coffeeTable: { w: 3.6, d: 2, h: 1.4 },
  tvStand: { w: 5, d: 1.4, h: 1.8 },
  tv: { w: 3.6, d: 0.3, h: 2.2, elev: 1.8 },
  diningTable: { w: 4.5, d: 3, h: 2.5 },
  chair: { w: 1.5, d: 1.5, h: 2.9 },
  stool: { w: 1.3, d: 1.3, h: 2.6 },
  fridge: { w: 3, d: 2.4, h: 5.8 },
  range: { w: 2.5, d: 2.1, h: 3 },
  sink: { w: 3, d: 2.1, h: 3 },
  cabinet: { w: 2, d: 2.1, h: 3 },
  upper: { w: 2, d: 1.1, h: 2.4, elev: 4.6 },
  hood: { w: 2.5, d: 1.6, h: 1.2, elev: 5.2 },
  toilet: { w: 1.6, d: 2.4, h: 2.6 },
  vanity: { w: 2.5, d: 1.8, h: 2.9 },
  bathtub: { w: 5, d: 2.5, h: 1.7 },
  shower: { w: 3, d: 3, h: 6.8 },
  mirror: { w: 2, d: 0.25, h: 2.4, elev: 3.8 },
  washerDryer: { w: 2.3, d: 2.3, h: 6 },
  rug: { w: 8, d: 5, h: 0.03, walkable: true },
  rugRound: { w: 6, d: 6, h: 0.03, walkable: true },
  plant: { w: 1.5, d: 1.5, h: 3.6 },
  floorLamp: { w: 1.2, d: 1.2, h: 5.3 },
  tableLamp: { w: 1, d: 1, h: 1.6, elev: 2 },
  bookcase: { w: 3, d: 1.2, h: 5.5 },
  desk: { w: 4, d: 2, h: 2.5 },
  deskChair: { w: 2, d: 2, h: 3.3 },
};

// Room-type buttons in the tour, in display order
export const ROOM_BUTTONS = [
  { type: "living", label: "Living" },
  { type: "kitchen", label: "Kitchen" },
  { type: "dining", label: "Dining" },
  { type: "bedroom", label: "Bedroom" },
  { type: "bath", label: "Bath" },
];

const FACE_ANGLE = { front: 0, right: 90, back: 180, left: 270 }; // degrees, plan-view clockwise from "front"
const FACE_VEC = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };

// ---------------------------------------------------------------- exterior outline
export function outline(plan, model) {
  const { W, D } = model;
  if (model.shape !== "L") {
    return {
      verts: [[0, 0], [W, 0], [W, D], [0, D]],
      edges: [
        edge("front", [0, 0], [W, 0], [0, -1]),
        edge("right", [W, 0], [W, D], [1, 0]),
        edge("back", [W, D], [0, D], [0, 1]),
        edge("left", [0, D], [0, 0], [-1, 0]),
      ],
    };
  }
  const wx = W - model.ww, wd = model.wd;
  return {
    verts: [[0, 0], [wx, 0], [wx, -wd], [W, -wd], [W, D], [0, D]],
    edges: [
      edge("front", [0, 0], [wx, 0], [0, -1]),
      edge("wingLeft", [wx, 0], [wx, -wd], [-1, 0]),
      edge("wingFront", [wx, -wd], [W, -wd], [0, -1]),
      edge("right", [W, -wd], [W, D], [1, 0]),
      edge("back", [W, D], [0, D], [0, 1]),
      edge("left", [0, D], [0, 0], [-1, 0]),
    ],
  };
}
function edge(name, a, b, n) {
  const horiz = a[1] === b[1];
  return { name, a, b, n, horiz, lo: horiz ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]), hi: horiz ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]), line: horiz ? a[1] : a[0] };
}

// Interior (finished-floor) rectangles of the living space, inset by the exterior wall
export function floorRects(plan, model) {
  const t = plan.extWall;
  const { W, D } = model;
  if (model.shape !== "L") return [{ x0: t, y0: t, x1: W - t, y1: D - t }];
  const wx = W - model.ww;
  return [
    { x0: t, y0: t, x1: W - t, y1: D - t },
    { x0: wx + t, y0: -model.wd + t, x1: W - t, y1: t },
  ];
}

// Openings on the exterior walls: windows, the front door and an optional patio door
export function exteriorOpenings(plan) {
  const list = (plan.windows || []).map((w) => ({ ...w, kind: "window" }));
  const fd = plan.frontDoor;
  list.push({ wall: fd.wall, at: fd.at, w: fd.w || 3, sill: 0, head: DOOR_HEAD_FT, kind: "door" });
  if (plan.patio) list.push({ wall: plan.patio.wall, at: plan.patio.at, w: plan.patio.w || 6, sill: 0, head: 7.2, kind: "patio" });
  return list;
}

// ---------------------------------------------------------------- walls as boxes
// Every wall is returned as axis-aligned boxes {x0,x1,y0,y1,z0,z1} in feet (z above the floor),
// already cut around doors and windows. ext = exterior wall (outer face gets the siding).
export function wallBoxes(plan, model) {
  const H = plan.wallHeight || 9;
  const out = [];
  const { edges } = outline(plan, model);
  const t = plan.extWall;
  const openings = exteriorOpenings(plan);
  const SKIN = 0.03; // keep the box just inside the exterior model's wall face (no z-fighting)
  for (const e of edges) {
    const ops = openings.filter((o) => o.wall === e.name).map((o) => [o.at - o.w / 2, o.at + o.w / 2, o.sill, o.head]);
    // inward offset range across the wall thickness
    const inward = e.horiz ? (e.n[1] < 0 ? [e.line + SKIN, e.line + t] : [e.line - t, e.line - SKIN]) : e.n[0] < 0 ? [e.line + SKIN, e.line + t] : [e.line - t, e.line - SKIN];
    for (const p of cutAlong(e.lo, e.hi, ops, H)) {
      out.push(e.horiz
        ? { x0: p.s0, x1: p.s1, y0: inward[0], y1: inward[1], z0: p.z0, z1: p.z1, ext: true, n: e.n, opening: p.opening }
        : { x0: inward[0], x1: inward[1], y0: p.s0, y1: p.s1, z0: p.z0, z1: p.z1, ext: true, n: e.n, opening: p.opening });
    }
  }
  // fill the notch at the inside corner of L plans (where the front wall meets the wing)
  if (model.shape === "L") {
    const wx = model.W - model.ww;
    out.push({ x0: wx, x1: wx + t, y0: 0, y1: t, z0: 0, z1: H, ext: false });
  }
  // interior partitions
  const ti = plan.intWall;
  for (const w of plan.walls || []) {
    const horiz = w.a[1] === w.b[1];
    const lo = (horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1])) - ti / 2;
    const hi = (horiz ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1])) + ti / 2;
    const line = horiz ? w.a[1] : w.a[0];
    const ops = [
      ...(w.doors || []).map((d) => [d.at - d.w / 2, d.at + d.w / 2, 0, DOOR_HEAD_FT, "door"]),
      ...(w.openings || []).map((d) => [d.at - d.w / 2, d.at + d.w / 2, 0, OPENING_HEAD_FT, "opening"]),
    ];
    for (const p of cutAlong(lo, hi, ops, H)) {
      out.push(horiz
        ? { x0: p.s0, x1: p.s1, y0: line - ti / 2, y1: line + ti / 2, z0: p.z0, z1: p.z1, ext: false }
        : { x0: line - ti / 2, x1: line + ti / 2, y0: p.s0, y1: p.s1, z0: p.z0, z1: p.z1, ext: false });
    }
  }
  return out;
}

// Split a wall run [lo,hi] around openings [s0,s1,sill,head] into solid pieces.
function cutAlong(lo, hi, ops, H) {
  const sorted = ops.filter((o) => o[1] > lo && o[0] < hi).sort((a, b) => a[0] - b[0]);
  const pieces = [];
  let cur = lo;
  for (const [s0, s1, sill, head] of sorted) {
    if (s0 > cur + 1e-3) pieces.push({ s0: cur, s1: s0, z0: 0, z1: H });
    if (sill > 0) pieces.push({ s0, s1, z0: 0, z1: sill, opening: "below" });
    if (head < H) pieces.push({ s0, s1, z0: head, z1: H, opening: "above" });
    cur = Math.max(cur, s1);
  }
  if (hi > cur + 1e-3) pieces.push({ s0: cur, s1: hi, z0: 0, z1: H });
  return pieces;
}

// Door openings in interior walls (for door leaves, casings and the mini-map)
export function interiorDoors(plan) {
  const out = [];
  for (const w of plan.walls || []) {
    const horiz = w.a[1] === w.b[1];
    const line = horiz ? w.a[1] : w.a[0];
    for (const d of w.doors || []) out.push({ horiz, line, at: d.at, w: d.w, leaf: true });
    for (const d of w.openings || []) out.push({ horiz, line, at: d.at, w: d.w, leaf: false });
  }
  return out;
}

// ---------------------------------------------------------------- furniture
// Resolves "run" entries (kitchen runs) into single items; returns
// {key, x, y, w, d, h, elev, rot} with rot = degrees clockwise in plan view from facing "front".
export function furnitureItems(plan) {
  const out = [];
  const add = (key, x, y, face, over = {}) => {
    const c = CATALOG[key];
    if (!c) return;
    out.push({ key, x, y, face, w: over.w ?? c.w, d: over.d ?? c.d, h: over.h ?? c.h, elev: over.elev ?? c.elev ?? 0, rot: FACE_ANGLE[face] ?? 0, walkable: !!c.walkable });
  };
  for (const f of plan.furniture || []) {
    if (f.run) {
      const dir = FACE_VEC[f.dir], fv = FACE_VEC[f.face];
      let t = 0;
      for (const [key, w] of f.parts) {
        const d = CATALOG[key].d;
        const cx = f.run[0] + dir[0] * (t + w / 2) + fv[0] * (d / 2);
        const cy = f.run[1] + dir[1] * (t + w / 2) + fv[1] * (d / 2);
        add(key, cx, cy, f.face, { w });
        if (f.uppers && key === "cabinet") {
          const u = CATALOG.upper;
          add("upper", f.run[0] + dir[0] * (t + w / 2) + fv[0] * (u.d / 2), f.run[1] + dir[1] * (t + w / 2) + fv[1] * (u.d / 2), f.face, { w });
        }
        if (f.uppers && key === "range") {
          const u = CATALOG.hood;
          add("hood", f.run[0] + dir[0] * (t + w / 2) + fv[0] * (u.d / 2), f.run[1] + dir[1] * (t + w / 2) + fv[1] * (u.d / 2), f.face, { w: Math.min(w, u.w) });
        }
        t += w;
      }
    } else add(f.item, f.x, f.y, f.face, f);
  }
  return out;
}

// Plan-view footprint of an item: [x0,y0,x1,y1]
export function itemRect(it) {
  const sideways = it.rot === 90 || it.rot === 270;
  const hw = (sideways ? it.d : it.w) / 2, hd = (sideways ? it.w : it.d) / 2;
  return [it.x - hw, it.y - hd, it.x + hw, it.y + hd];
}

// ---------------------------------------------------------------- rooms
export const roomDims = (r) => `${Math.round(r.w)}′×${Math.round(r.d)}′`;
export const roomLabel = (r) => `${r.name} · ${roomDims(r)}`;
export const roomCenter = (r) => [r.x + r.w / 2, r.y + r.d / 2];
export function roomAt(plan, x, y) {
  return (plan.rooms || []).find((r) => x >= r.x - 0.2 && x <= r.x + r.w + 0.2 && y >= r.y - 0.2 && y <= r.y + r.d + 0.2) || null;
}

// Where the tour starts: on the porch, a step back from the front door, looking in
export function entryPose(plan, model) {
  const fd = plan.frontDoor;
  let porch = 3.5; // feet of porch in front of the door (matches lib/models.js geometryFt)
  if (model) porch = model.shape === "L" ? Math.min(5.5, model.wd - 0.7) : model.conversion ? 3.5 : Math.min(5, model.D * 0.16);
  return { x: fd.at, y: -Math.max(2.4, Math.min(3.6, porch - 0.5)), yaw: 0 };
}

// Plan (ft) -> exterior-model frame (meters; x right, z toward the front, y up)
// using the same placement math as lib/models.js geometryFt().
export function planToModelFrame(model) {
  const FT = 0.3048;
  let fFront;
  if (model.shape !== "L") {
    const pd = model.conversion ? 0 : Math.min(5, model.D * 0.16);
    fFront = model.D / 2 - pd / 2;
  } else fFront = model.D / 2 - model.wd / 2;
  return {
    x: (x) => (x - model.W / 2) * FT,
    z: (y) => (fFront - y) * FT,
    fromX: (X) => X / FT + model.W / 2,
    fromZ: (Z) => fFront - Z / FT,
  };
}
