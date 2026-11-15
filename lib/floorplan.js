// Pure floor-plan geometry shared by the walk-in tour, the 2D floor plans, the plan checker
// (scripts/check-floorplans.mjs) and the exterior model builder, so all of them agree.
// Units are FEET in plan coordinates: origin at the front-left exterior corner of the main body,
// x to the right along the front wall, y back into the house (see lib/floorplans/*.json).
import { geometryFt } from "./models.js";

export const FLOOR_FT = 0.12 / 0.3048; // finished floor sits on a 0.12 m slab (level with the porch)
export const DOOR_HEAD_FT = 6.9; // top of door openings, above the floor
export const OPENING_HEAD_FT = 7.2; // wide cased openings between rooms
export const LEAF_T = 0.13; // door leaf thickness

// Real-world sizes (feet) for each furniture key in public/models/furniture-kit.glb.
// w = across the front, d = front-to-back, h = height, elev = height of its base off the floor.
// Every model's "front" is +z in the kit; `back` says what the back of the piece must touch.
//   wall    = back against a wall          sofa  = against a wall, or facing the TV
//   partner = faces the item it belongs to free  = no rule (rugs, lamps, plants, tables)
//   stack   = sits on / hangs above another item
export const CATALOG = {
  bedDouble: { w: 5, d: 6.8, h: 2.3, back: "wall" }, // queen
  bedSingle: { w: 3.3, d: 6.6, h: 2.1, back: "wall" }, // twin / daybed
  nightstand: { w: 1.7, d: 1.4, h: 2, back: "wall" },
  dresser: { w: 4, d: 1.6, h: 2.7, back: "wall" },
  sofa: { w: 7, d: 3, h: 2.8, back: "sofa" },
  armchair: { w: 2.8, d: 2.8, h: 2.7, back: "partner" },
  coffeeTable: { w: 3.6, d: 2, h: 1.4, back: "free" },
  tvStand: { w: 5, d: 1.4, h: 1.8, back: "wall" },
  tv: { w: 3.6, d: 0.3, h: 2.2, elev: 1.8, back: "stack" },
  diningTable: { w: 4.5, d: 3, h: 2.5, back: "free" },
  chair: { w: 1.5, d: 1.5, h: 2.9, back: "partner" },
  stool: { w: 1.3, d: 1.3, h: 2.6, back: "partner" },
  fridge: { w: 3, d: 2.4, h: 5.8, back: "wall" },
  range: { w: 2.5, d: 2.1, h: 3, back: "wall" },
  sink: { w: 3, d: 2.1, h: 3, back: "wall" },
  cabinet: { w: 2, d: 2.1, h: 3, back: "wall" },
  upper: { w: 2, d: 1.1, h: 2.4, elev: 4.6, back: "wall" },
  hood: { w: 2.5, d: 1.6, h: 1.2, elev: 5.2, back: "wall" },
  toilet: { w: 1.6, d: 2.4, h: 2.6, back: "wall" },
  vanity: { w: 2.5, d: 1.8, h: 2.9, back: "wall" },
  bathtub: { w: 5, d: 2.5, h: 1.7, back: "wall" },
  shower: { w: 3, d: 3, h: 6.8, back: "wall" },
  mirror: { w: 2, d: 0.25, h: 2.4, elev: 3.8, back: "wall" },
  washerDryer: { w: 2.3, d: 2.3, h: 6, back: "wall" },
  rug: { w: 8, d: 5, h: 0.03, walkable: true, back: "free" },
  plant: { w: 1.5, d: 1.5, h: 3.6, back: "free" },
  floorLamp: { w: 1.2, d: 1.2, h: 5.3, back: "free" },
  bookcase: { w: 3, d: 1.2, h: 5.5, back: "wall" },
  desk: { w: 4, d: 2, h: 2.5, back: "wall" },
  deskChair: { w: 2, d: 2, h: 3.3, back: "partner" },
};

// Room-type buttons in the tour, in display order
export const ROOM_BUTTONS = [
  { type: "living", label: "Living" },
  { type: "sleep", label: "Sleeping area" },
  { type: "kitchen", label: "Kitchen" },
  { type: "dining", label: "Dining" },
  { type: "bedroom", label: "Bedroom" },
  { type: "bath", label: "Bath" },
];
// What the camera points at when you arrive in a room
export const MAIN_ITEM = {
  living: ["sofa"], sleep: ["bedDouble", "bedSingle"], bedroom: ["bedDouble", "bedSingle"],
  bath: ["vanity"], kitchen: ["range", "sink"], dining: ["diningTable"], laundry: ["washerDryer"],
};
// Rooms that must be closed in by walls and doors (no open sides)
export const PRIVATE_ROOMS = new Set(["bedroom", "bath", "closet", "laundry"]);

export const FACE_ANGLE = { front: 0, right: 90, back: 180, left: 270 }; // plan-view clockwise from "front"
export const FACE_VEC = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { left: "right", right: "left", front: "back", back: "front" };
const faceFromVec = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "back" : "front");

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
    const inward = e.horiz ? (e.n[1] < 0 ? [e.line + SKIN, e.line + t] : [e.line - t, e.line - SKIN]) : e.n[0] < 0 ? [e.line + SKIN, e.line + t] : [e.line - t, e.line - SKIN];
    for (const p of cutAlong(e.lo, e.hi, ops, H)) {
      out.push(e.horiz
        ? { x0: p.s0, x1: p.s1, y0: inward[0], y1: inward[1], z0: p.z0, z1: p.z1, ext: true, n: e.n, edge: e.name, opening: p.opening }
        : { x0: inward[0], x1: inward[1], y0: p.s0, y1: p.s1, z0: p.z0, z1: p.z1, ext: true, n: e.n, edge: e.name, opening: p.opening });
    }
  }
  // fill the notch at the inside corner of L plans (where the front wall meets the wing)
  if (model.shape === "L") {
    const wx = model.W - model.ww;
    out.push({ x0: wx, x1: wx + t, y0: 0, y1: t, z0: 0, z1: H, ext: false });
  }
  const ti = plan.intWall;
  for (const w of plan.walls || []) {
    const horiz = w.a[1] === w.b[1];
    const lo = (horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1])) - ti / 2;
    const hi = (horiz ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1])) + ti / 2;
    const line = horiz ? w.a[1] : w.a[0];
    const ops = [
      ...(w.doors || []).map((d) => [d.at - d.w / 2, d.at + d.w / 2, 0, DOOR_HEAD_FT]),
      ...(w.sliders || []).map((d) => [d.at - d.w / 2, d.at + d.w / 2, 0, DOOR_HEAD_FT]),
      ...(w.openings || []).map((d) => [d.at - d.w / 2, d.at + d.w / 2, 0, OPENING_HEAD_FT]),
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

// ---------------------------------------------------------------- doors
// Every doorway in the plan, including the front door.
//   kind: "swing" (hinged leaf), "slider" (closet bypass doors, shown closed), "opening" (no door)
//   For swing doors: swing = +1/-1 (which side of the wall the leaf opens into: +x/+y or -x/-y),
//   hinge = "lo"/"hi" (which end of the opening the hinges are on).
export function doorways(plan, model) {
  const out = [];
  const ti = plan.intWall;
  for (const w of plan.walls || []) {
    const horiz = w.a[1] === w.b[1];
    const line = horiz ? w.a[1] : w.a[0];
    for (const d of w.doors || []) out.push({ horiz, line, half: ti / 2, at: d.at, w: d.w, kind: "swing", swing: d.swing === "-" ? -1 : 1, hinge: d.hinge === "hi" ? "hi" : "lo" });
    for (const d of w.sliders || []) out.push({ horiz, line, half: ti / 2, at: d.at, w: d.w, kind: "slider" });
    for (const d of w.openings || []) out.push({ horiz, line, half: ti / 2, at: d.at, w: d.w, kind: "opening" });
  }
  const fd = plan.frontDoor;
  const t = plan.extWall;
  out.push({ horiz: true, line: t / 2, half: t / 2, at: fd.at, w: fd.w || 3, kind: "swing", swing: 1, hinge: fd.hinge === "hi" ? "hi" : "lo", front: true });
  return out.map((d) => ({ ...d, ...(d.kind === "swing" ? swingGeometry(d) : {}) }));
}
// Hinge point, the open leaf (at 90°) and the swing arc of a hinged door
function swingGeometry(d) {
  const L = d.w - 0.08;
  const along = d.hinge === "lo" ? d.at - d.w / 2 : d.at + d.w / 2;
  const toward = d.hinge === "lo" ? 1 : -1; // direction from the hinge across the opening
  const across = d.line + d.swing * d.half;
  const P = (a, c) => (d.horiz ? [a, c] : [c, a]);
  const hingePt = P(along, across);
  const leafAlong = [along, along + toward * LEAF_T].sort((a, b) => a - b);
  const leafAcross = [across, across + d.swing * L].sort((a, b) => a - b);
  const leaf = d.horiz ? [leafAlong[0], leafAcross[0], leafAlong[1], leafAcross[1]] : [leafAcross[0], leafAlong[0], leafAcross[1], leafAlong[1]];
  // swing arc polygon: hinge + quarter circle from "closed" (along the wall) to "open" (90°)
  const arc = [hingePt];
  for (let k = 0; k <= 12; k++) {
    const th = (k / 12) * (Math.PI / 2);
    arc.push(P(along + toward * L * Math.cos(th), across + d.swing * L * Math.sin(th)));
  }
  return { L, hingePt, leaf, arc, toward };
}

// ---------------------------------------------------------------- furniture
// Resolves the plan's furniture list into placed items. Placement rule, everywhere:
//   anchored pieces ({room, wall, at}) sit with their back on that side of the room and face in;
//   paired pieces face their partner (chair -> table, sofa -> TV); groups place their parts.
// Each item: {key, x, y, w, d, h, elev, rot, face, anchor, ...}; rot = degrees clockwise from facing "front".
export function furnitureItems(plan) {
  const out = [];
  const rooms = Object.fromEntries((plan.rooms || []).map((r) => [r.id, r]));
  const GAP = 0.02;
  const add = (key, x, y, face, extra = {}) => {
    const c = CATALOG[key];
    if (!c) throw new Error(`${plan.id}: unknown furniture "${key}"`);
    const it = {
      key, x, y, face, rot: FACE_ANGLE[face],
      w: extra.w ?? c.w, d: extra.d ?? c.d, h: extra.h ?? c.h, elev: extra.elev ?? c.elev ?? 0,
      walkable: !!c.walkable, back: c.back, anchor: extra.anchor || { kind: "free" }, room: extra.room, group: extra.group,
    };
    out.push(it);
    return it;
  };
  // side line of a room and the into-room face for a wall side
  const sideOf = (room, side) => {
    const r = rooms[room];
    if (!r) throw new Error(`${plan.id}: furniture refers to unknown room "${room}"`);
    const line = { left: r.x, right: r.x + r.w, front: r.y, back: r.y + r.d }[side];
    return { r, line, face: OPPOSITE[side], horiz: side === "front" || side === "back" };
  };
  // place a piece with its back on a room side, centered at `at` along that side
  const anchored = (key, room, side, at, extra = {}) => {
    const s = sideOf(room, side);
    const c = CATALOG[key];
    const d = extra.d ?? c.d;
    const off = (extra.off ?? 0) + GAP + d / 2;
    const fv = FACE_VEC[s.face];
    const x = s.horiz ? at : s.line + fv[0] * off;
    const y = s.horiz ? s.line + fv[1] * off : at;
    return add(key, x, y, s.face, { ...extra, room, anchor: { kind: "wall", side, room, line: s.line } });
  };

  for (const f of plan.furniture || []) {
    if (f.run) {
      // kitchen run along one side of a room: parts in order from `from`, going + or - along the wall
      const s = sideOf(f.room, f.wall);
      const sign = f.dir === "-" ? -1 : 1;
      let t = 0;
      const group = `run:${f.room}:${f.wall}:${f.from}`;
      for (const [key, w] of f.parts) {
        const mid = f.from + sign * (t + w / 2);
        const part = anchored(key, f.room, f.wall, mid, { w, group });
        part.run = group;
        if (f.uppers !== false && key === "cabinet") anchored("upper", f.room, f.wall, mid, { w, group });
        if (key === "range") anchored("hood", f.room, f.wall, mid, { w, group });
        t += w;
      }
    } else if (f.living) {
      // TV on a stand against a wall, sofa facing it (against the far wall or `dist` feet away),
      // coffee table between them and a rug under the coffee table
      // a TV console can also stand free as a room divider ({divider: true, x, y, face}), facing the sofa
      const tvS = f.tv.divider ? { horiz: f.tv.face === "front" || f.tv.face === "back", face: f.tv.face } : sideOf(f.room, f.tv.wall);
      const stand = f.tv.divider
        ? add("tvStand", f.tv.x, f.tv.y, f.tv.face, { w: f.tv.w, room: f.room, group: "living", anchor: { kind: "divider" } })
        : anchored("tvStand", f.room, f.tv.wall, f.tv.at, { w: f.tv.w, group: "living" });
      add("tv", stand.x, stand.y, stand.face, { elev: stand.h, room: f.room, group: "living", anchor: { kind: "stack", on: "tvStand" } });
      const fv = FACE_VEC[tvS.face];
      let sofa;
      if (f.sofa.wall) sofa = anchored("sofa", f.room, f.sofa.wall, f.sofa.at ?? f.tv.at, { w: f.sofa.w, group: "living" });
      else {
        const dist = f.sofa.dist; // from the TV wall to the sofa's back
        const d = f.sofa.d ?? CATALOG.sofa.d;
        const cx = tvS.horiz ? f.tv.at : tvS.line + fv[0] * (dist - d / 2);
        const cy = tvS.horiz ? tvS.line + fv[1] * (dist - d / 2) : f.tv.at;
        sofa = add("sofa", cx, cy, OPPOSITE[tvS.face], { w: f.sofa.w, room: f.room, group: "living", anchor: { kind: "partner", of: "tv" } });
      }
      const sv = FACE_VEC[sofa.face];
      if (f.coffee !== false) {
        const ct = CATALOG.coffeeTable, cw = f.coffeeW ?? Math.min(ct.w, sofa.w - 2);
        const off = sofa.d / 2 + 1.5 + ct.d / 2;
        const cx = sofa.x + sv[0] * off, cy = sofa.y + sv[1] * off;
        add("coffeeTable", cx, cy, sofa.face, { w: cw, room: f.room, group: "living", anchor: { kind: "partner", of: "sofa" } });
        if (f.rug !== false) {
          const rw = f.rugW ?? Math.min(8, sofa.w + 1), rd = f.rugD ?? 5;
          const ro = sofa.d / 2 - 0.6 + rd / 2;
          add("rug", sofa.x + sv[0] * ro, sofa.y + sv[1] * ro, sofa.face, { w: rw, d: rd, room: f.room, group: "living" });
        }
      }
    } else if (f.dining) {
      // table plus chairs tucked in a fixed 0.2 ft from the table edge, each facing the table
      const t = f.dining;
      const longX = t.w >= t.d;
      const table = add("diningTable", t.x, t.y, longX ? "front" : "right", { w: longX ? t.w : t.d, d: longX ? t.d : t.w, room: f.room, group: "dining" });
      const halfX = t.w / 2, halfY = t.d / 2, ch = CATALOG.chair, tuck = 0.2;
      for (const [side, n] of Object.entries(t.seats || {})) {
        if (!n) continue;
        const horizSide = side === "front" || side === "back";
        const len = horizSide ? t.w : t.d;
        for (let k = 0; k < n; k++) {
          const along = (horizSide ? t.x - halfX : t.y - halfY) + (len * (k + 0.5)) / n;
          const off = (horizSide ? halfY : halfX) + tuck + ch.d / 2;
          const v = FACE_VEC[side];
          const x = horizSide ? along : t.x + v[0] * off, y = horizSide ? t.y + v[1] * off : along;
          add("chair", x, y, OPPOSITE[side], { room: f.room, group: "dining", anchor: { kind: "partner", of: "diningTable" } });
        }
      }
      void table;
    } else if (f.item) {
      const c = CATALOG[f.item];
      if (!c) throw new Error(`${plan.id}: unknown furniture "${f.item}"`);
      if (f.wall) {
        const it = anchored(f.item, f.room, f.wall, f.at, f);
        if (f.item.startsWith("bed") && f.nightstands !== "none") {
          const ns = CATALOG.nightstand, s = sideOf(f.room, f.wall);
          const sides = f.nightstands === "lo" ? [-1] : f.nightstands === "hi" ? [1] : [-1, 1];
          for (const sd of sides) anchored("nightstand", f.room, f.wall, f.at + sd * (it.w / 2 + 0.15 + ns.w / 2), { group: "bed" });
          void s;
        }
        if (f.item === "vanity" && f.mirror !== false) anchored("mirror", f.room, f.wall, f.at, { w: Math.min(it.w, 2.4) });
        if (f.item === "desk" && f.chair !== false) {
          const v = FACE_VEC[it.face], dc = CATALOG.deskChair;
          const off = it.d / 2 + 0.2 + dc.d / 2; // tucked 0.2 ft from the desk edge, like dining chairs
          add("deskChair", it.x + v[0] * off, it.y + v[1] * off, OPPOSITE[it.face], { room: f.room, anchor: { kind: "partner", of: "desk" } });
        }
      } else {
        // free piece: explicit face, or `faces` = key of the partner it should turn toward
        let face = f.face || "front";
        if (f.faces) {
          const partner = nearestOf(out, f.faces, f.x, f.y);
          if (partner) face = faceFromVec(partner.x - f.x, partner.y - f.y);
        }
        add(f.item, f.x, f.y, face, { ...f, room: f.room, anchor: f.faces ? { kind: "partner", of: f.faces } : { kind: "free" } });
      }
    }
  }
  return out;
}
function nearestOf(items, key, x, y) {
  let best = null, bd = Infinity;
  for (const it of items) {
    if (it.key !== key && !(key === "bed" && it.key.startsWith("bed"))) continue;
    const d = (it.x - x) ** 2 + (it.y - y) ** 2;
    if (d < bd) { bd = d; best = it; }
  }
  return best;
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
  const rs = plan.rooms || [];
  return rs.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d)
    || rs.find((r) => x >= r.x - 0.25 && x <= r.x + r.w + 0.25 && y >= r.y - 0.25 && y <= r.y + r.d + 0.25) || null;
}

// Porch posts (plan feet), from the same numbers the exterior model builder uses
export function porchPosts(model) {
  const g = geometryFt(model);
  if (!g.porch) return [];
  const fr = planToModelFrame(model);
  const FTm = 0.3048;
  const rect = (x0, x1, z0, z1) => { const xs = [fr.fromX(x0), fr.fromX(x1)].sort((a, b) => a - b), ys = [fr.fromZ(z0), fr.fromZ(z1)].sort((a, b) => a - b); return [xs[0], ys[0], xs[1], ys[1]]; };
  const px0 = g.porch.x0 * FTm, px1 = g.porch.x1 * FTm, pz1 = g.porch.f1 * FTm;
  if (model.shape !== "L") return [px0 + 0.12, px1 - 0.12].map((x) => rect(x - 0.08, x + 0.08, pz1 - 0.24, pz1 - 0.08));
  return [rect(px0 + 0.05, px0 + 0.21, pz1 - 0.21, pz1 - 0.05)];
}

// Where the tour starts: in the front yard, a few steps back from the porch, facing the front door
export function entryPose(plan, model) {
  const fd = plan.frontDoor;
  const g = model ? geometryFt(model) : null;
  const porch = g?.porch ? g.porch.f1 - g.porch.f0 : 0;
  return { x: fd.at, y: -(porch + 5.5), yaw: 0, pitch: 0.02 };
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

// The fenced yard around the house (plan feet)
export function yardRect(plan, model) {
  const o = outline(plan, model);
  const xs = o.verts.map((v) => v[0]), ys = o.verts.map((v) => v[1]);
  return { x0: Math.min(...xs) - 14, x1: Math.max(...xs) + 14, y0: Math.min(...ys) - 16, y1: Math.max(...ys) + 12 };
}

// Everything you can't walk through, as plan rectangles [x0,y0,x1,y1]:
// walls (not door headers), furniture on the floor, open door leaves, closed closet sliders,
// the patio door glass, porch posts and the yard fence.
export function collidersFor(plan, model, items = furnitureItems(plan), { leaves = true } = {}) {
  const t = plan.extWall;
  const out = wallBoxes(plan, model).filter((b) => b.z0 < 3).map((b) => [b.x0, b.y0, b.x1, b.y1]);
  for (const it of items) if (!it.walkable && !it.elev) out.push(itemRect(it));
  for (const d of doorways(plan, model)) {
    if (d.kind === "swing" && leaves) out.push(d.leaf);
    if (d.kind === "slider") out.push(d.horiz ? [d.at - d.w / 2, d.line - d.half, d.at + d.w / 2, d.line + d.half] : [d.line - d.half, d.at - d.w / 2, d.line + d.half, d.at + d.w / 2]);
  }
  const { edges } = outline(plan, model);
  for (const op of exteriorOpenings(plan)) {
    if (op.kind !== "patio") continue;
    const e = edges.find((q) => q.name === op.wall);
    const a0 = op.at - op.w / 2, a1 = op.at + op.w / 2;
    if (e.horiz) out.push([a0, Math.min(e.line, e.line - e.n[1] * t), a1, Math.max(e.line, e.line - e.n[1] * t)]);
    else out.push([Math.min(e.line, e.line - e.n[0] * t), a0, Math.max(e.line, e.line - e.n[0] * t), a1]);
  }
  out.push(...porchPosts(model));
  const y = yardRect(plan, model), ft = 0.5;
  out.push([y.x0 - ft, y.y0, y.x0, y.y1], [y.x1, y.y0, y.x1 + ft, y.y1], [y.x0, y.y0 - ft, y.x1, y.y0], [y.x0, y.y1, y.x1, y.y1 + ft]);
  return out;
}
