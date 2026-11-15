// Layout rules for every floor plan. scripts/check-floorplans.mjs runs these on all plans and
// fails the build if any rule is broken. Units: feet, plan coordinates (see lib/floorplan.js).
import {
  CATALOG, FACE_VEC, PRIVATE_ROOMS, ROOM_BUTTONS, wallBoxes, doorways, exteriorOpenings, outline,
  furnitureItems, itemRect, floorRects, collidersFor, yardRect, entryPose,
} from "./floorplan.js";
import { makeNav, roomViews, VIEW_WALL_CLEAR_FT, VIEW_ITEM_CLEAR_FT } from "./planNav.js";

export const PATH_WIDTH_FT = 3; // 36" walking path from the entry to every room
const TOL = 0.06;

const rectsOverlap = (a, b, e = 0.02) => a[0] < b[2] - e && a[2] > b[0] + e && a[1] < b[3] - e && a[3] > b[1] + e;
const zOverlap = (a0, a1, b0, b1) => a0 < b1 - 0.02 && a1 > b0 + 0.02;
const backSide = { front: "back", back: "front", left: "right", right: "left" };
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const where = (it) => `${it.key}@(${fmt(it.x)},${fmt(it.y)})`;

// convex polygon vs convex polygon (separating axis)
function polysOverlap(P, Q) {
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2;
      if (!nx && !ny) continue;
      let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity;
      for (const [x, y] of P) { const d = x * nx + y * ny; pmin = Math.min(pmin, d); pmax = Math.max(pmax, d); }
      for (const [x, y] of Q) { const d = x * nx + y * ny; qmin = Math.min(qmin, d); qmax = Math.max(qmax, d); }
      const len = Math.hypot(nx, ny);
      if (pmax <= qmin + 0.01 * len || qmax <= pmin + 0.01 * len) return false;
    }
  }
  return true;
}
const rectPoly = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

// back edge of an item's footprint: {horiz, line, lo, hi}
function backEdge(it) {
  const r = itemRect(it), side = backSide[it.face];
  if (side === "left") return { horiz: false, line: r[0], lo: r[1], hi: r[3], out: -1 };
  if (side === "right") return { horiz: false, line: r[2], lo: r[1], hi: r[3], out: 1 };
  if (side === "front") return { horiz: true, line: r[1], lo: r[0], hi: r[2], out: -1 };
  return { horiz: true, line: r[3], lo: r[0], hi: r[2], out: 1 };
}
// fraction of an edge backed by wall faces (boxes whose facing side sits on the edge line)
function wallSupport(edge, walls, zTop) {
  const segs = [];
  for (const b of walls) {
    if (b.z0 > 0.05 || b.z1 < Math.min(zTop, 2.5)) continue; // wall piece must reach up behind the item
    const face = edge.horiz ? (edge.out < 0 ? b.y1 : b.y0) : edge.out < 0 ? b.x1 : b.x0;
    if (Math.abs(face - edge.line) > 0.12) continue;
    const lo = edge.horiz ? b.x0 : b.y0, hi = edge.horiz ? b.x1 : b.y1;
    const a = Math.max(lo, edge.lo), c = Math.min(hi, edge.hi);
    if (c > a) segs.push([a, c]);
  }
  segs.sort((a, b) => a[0] - b[0]);
  let covered = 0, cur = edge.lo;
  for (const [a, c] of segs) { if (c <= cur) continue; covered += c - Math.max(a, cur); cur = c; }
  return covered / Math.max(1e-6, edge.hi - edge.lo);
}

export function checkPlan(plan, model) {
  const fails = [];
  const fail = (rule, msg) => fails.push({ plan: plan.id, rule, msg });
  let items;
  try { items = furnitureItems(plan); } catch (e) { fail("config", e.message); return fails; }
  const boxes = wallBoxes(plan, model);
  const walls = boxes.map((b) => ({ ...b, r: [b.x0, b.y0, b.x1, b.y1] }));
  const doors = doorways(plan, model);
  const rooms = plan.rooms || [];
  const floors = floorRects(plan, model);
  const roomOf = (x, y) => rooms.find((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.d) || null;
  const inFloor = (x, y) => floors.some((f) => x >= f.x0 - 0.01 && x <= f.x1 + 0.01 && y >= f.y0 - 0.01 && y <= f.y1 + 0.01);

  // ---- 1. orientation: every piece's back is on a wall, or it faces its partner
  for (const it of items) {
    const top = it.elev + it.h;
    if (it.anchor.kind === "divider") {
      // a TV console used as a room divider: allowed when it faces a sofa (checked below)
      if (it.key !== "tvStand") fail("orientation", `${where(it)} can't be a divider`);
    } else if (it.back === "wall" || (it.back === "sofa" && it.anchor.kind === "wall")) {
      const sup = wallSupport(backEdge(it), walls, Math.min(top, 3));
      if (sup < 0.8) fail("orientation", `${where(it)} faces ${it.face} but its back isn't against a wall (${Math.round(sup * 100)}% backed)`);
    }
    if (it.back === "sofa" && it.anchor.kind !== "wall") {
      const tv = items.find((q) => q.key === "tv" && q.room === it.room);
      if (!tv) fail("orientation", `${where(it)} floats in the room with no TV to face and no wall behind it`);
    }
    if (it.back === "partner") {
      const partnerKey = it.key === "chair" ? "diningTable" : it.key === "deskChair" ? "desk" : it.key === "stool" ? "sink" : it.anchor.of;
      const ps = items.filter((q) => q.key === partnerKey || (partnerKey === "bed" && q.key.startsWith("bed")));
      const p = ps.sort((a, b) => Math.hypot(a.x - it.x, a.y - it.y) - Math.hypot(b.x - it.x, b.y - it.y))[0];
      if (!p) { fail("orientation", `${where(it)} has no ${partnerKey} to face`); continue; }
      const v = FACE_VEC[it.face], dx = p.x - it.x, dy = p.y - it.y;
      if (v[0] * dx + v[1] * dy <= 0.1) fail("orientation", `${where(it)} faces ${it.face}, away from its ${p.key}`);
      if (it.key === "chair" || it.key === "deskChair") {
        const a = itemRect(it), b = itemRect(p);
        const gap = Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);
        if (gap < 0.05) fail("overlap", `${where(it)} pushes into the ${p.key}`);
        else if (gap > 0.6) fail("orientation", `${where(it)} sits ${fmt(gap)} ft back from the ${p.key} (should be tucked in)`);
      }
    }
  }
  // sofa <-> TV: facing each other, lined up, sensible distance
  for (const tv of items.filter((q) => q.key === "tv")) {
    const sofa = items.filter((q) => q.key === "sofa" && q.room === tv.room)[0];
    if (!sofa) { fail("orientation", `${where(tv)} has no sofa in its room`); continue; }
    const sv = FACE_VEC[sofa.face], tvv = FACE_VEC[tv.face];
    const dx = tv.x - sofa.x, dy = tv.y - sofa.y;
    const ahead = sv[0] * dx + sv[1] * dy, lateral = Math.abs(sv[0] * dy - sv[1] * dx);
    if (ahead < 5 || ahead > 14) fail("orientation", `sofa and TV in ${tv.room} are ${fmt(ahead)} ft apart along the sofa's view (want 5–14 ft, TV in front)`);
    if (lateral > 1.0) fail("orientation", `TV in ${tv.room} is ${fmt(lateral)} ft off the sofa's center line`);
    if (tvv[0] * -dx + tvv[1] * -dy <= 0) fail("orientation", `TV screen in ${tv.room} faces away from the sofa`);
  }

  // ---- 2. overlaps: item vs item (3D, so a TV on its stand or a mirror over a vanity is fine), item vs wall
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (a.walkable) continue;
    const ra = itemRect(a);
    if (!inFloor(ra[0], ra[1]) || !inFloor(ra[2], ra[3]) || !inFloor(ra[0], ra[3]) || !inFloor(ra[2], ra[1])) fail("overlap", `${where(a)} sticks outside the house`);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (b.walkable) continue;
      if (rectsOverlap(ra, itemRect(b)) && zOverlap(a.elev, a.elev + a.h, b.elev, b.elev + b.h)) fail("overlap", `${where(a)} overlaps ${where(b)}`);
    }
    for (const w of walls) {
      if (rectsOverlap(ra, w.r) && zOverlap(a.elev, a.elev + a.h, w.z0, w.z1)) { fail("overlap", `${where(a)} runs into a wall`); break; }
    }
  }
  // tall pieces must not stand in front of a window
  const { edges } = outline(plan, model);
  for (const op of exteriorOpenings(plan).filter((o) => o.kind === "window")) {
    const e = edges.find((q) => q.name === op.wall);
    const inner = e.line - (e.horiz ? e.n[1] : e.n[0]) * plan.extWall;
    for (const it of items) {
      if (it.walkable) continue;
      const be = backEdge(it);
      const onWall = be.horiz === e.horiz && Math.abs(be.line - inner) < 0.15;
      const r = itemRect(it);
      const lo = e.horiz ? r[0] : r[1], hi = e.horiz ? r[2] : r[3];
      if (onWall && lo < op.at + op.w / 2 - 0.05 && hi > op.at - op.w / 2 + 0.05 && it.elev + it.h > op.sill + 0.05 && it.elev < op.head) {
        fail("overlap", `${where(it)} covers the ${op.wall} window at ${op.at}`);
      }
    }
  }
  // door swings: clear of furniture, walls and each other; a 3 ft landing on the other side too
  const swings = doors.filter((d) => d.kind === "swing");
  const approach = (d, side) => {
    const a0 = d.at - d.w / 2, a1 = d.at + d.w / 2;
    const c0 = d.line + side * d.half, c1 = c0 + side * 3;
    return d.horiz ? [a0, Math.min(c0, c1), a1, Math.max(c0, c1)] : [Math.min(c0, c1), a0, Math.max(c0, c1), a1];
  };
  const doorName = (d) => (d.front ? "front door" : `door at ${d.horiz ? "y" : "x"}=${d.line}, ${d.at}`);
  for (const d of swings) {
    const arc = d.arc.map(([x, y]) => (d.horiz ? [x, y + d.swing * 0.03] : [x + d.swing * 0.03, y]));
    for (const it of items) {
      if (it.walkable || it.elev >= 6.9) continue;
      if (polysOverlap(arc, rectPoly(itemRect(it)))) fail("door swing", `${doorName(d)} swings into ${where(it)}`);
    }
    for (const w of walls) if (w.z0 < 6.9 && polysOverlap(arc, rectPoly(w.r))) { fail("door swing", `${doorName(d)} swings into a wall`); break; }
    for (const o of swings) if (o !== d && polysOverlap(arc, o.arc)) fail("door swing", `${doorName(d)} and ${doorName(o)} swing into each other`);
  }
  for (const d of doors.filter((q) => q.kind !== "slider")) {
    for (const side of d.kind === "swing" ? [-d.swing] : [-1, 1]) {
      if (d.front && side < 0) continue; // outside the front door is the porch
      const z = approach(d, side);
      for (const it of items) if (!it.walkable && !it.elev && rectsOverlap(z, itemRect(it))) fail("path", `${where(it)} crowds the ${d.kind === "swing" ? "door" : "opening"} at ${d.horiz ? "y" : "x"}=${d.line}, ${d.at}`);
    }
  }
  for (const d of doors.filter((q) => q.kind === "slider")) {
    // the side that isn't the closet needs a clear 3 ft landing
    for (const side of [-1, 1]) {
      const z = approach(d, side), c = [(z[0] + z[2]) / 2, (z[1] + z[3]) / 2];
      const inside = roomOf(c[0], c[1]);
      if (inside && (inside.type === "closet" || inside.type === "laundry")) continue;
      for (const it of items) if (!it.walkable && !it.elev && rectsOverlap(z, itemRect(it))) fail("path", `${where(it)} blocks the closet doors at ${d.horiz ? "y" : "x"}=${d.line}, ${d.at}`);
    }
  }

  // ---- 3. 36" walking path from the entry to every room
  // open door leaves aren't obstacles here: the doorway rule below covers them
  const colliders = collidersFor(plan, model, items, { leaves: false });
  const yard = yardRect(plan, model);
  const nav36 = makeNav(colliders, yard, { radius: PATH_WIDTH_FT / 2, margin: 0, cell: 0.125 });
  // a doorway is passable at its own clear width (the landings above keep furniture away from it)
  const g = nav36.grid;
  for (const d of doors.filter((q) => q.kind !== "slider")) {
    const a0 = d.at - d.w / 2 + 0.2, a1 = d.at + d.w / 2 - 0.2, c0 = d.line - d.half - 1.6, c1 = d.line + d.half + 1.6;
    const r = d.horiz ? [a0, c0, a1, c1] : [c0, a0, c1, a1];
    for (let i = 0; i < g.nx; i++) for (let j = 0; j < g.ny; j++) {
      const x = g.gx0 + (i + 0.5) * g.cell, y = g.gy0 + (j + 0.5) * g.cell;
      if (x > r[0] && x < r[2] && y > r[1] && y < r[3] && !colliders.some((c) => x > c[0] && x < c[2] && y > c[1] && y < c[3])) g.blocked[j * g.nx + i] = 0;
    }
  }
  const entry = entryPose(plan, model);
  const fieldE = nav36.field([entry.x, entry.y]);
  for (const r of rooms) {
    let ok = false;
    const onlySliders = doors.filter((d) => touchesRoom(d, r)).every((d) => d.kind === "slider") && doors.some((d) => touchesRoom(d, r));
    if (r.type === "closet" || onlySliders) {
      // reach the landing in front of the closet's doors
      // closets behind sliding doors: reach the landing in front of the doors
      const sl = doors.filter((d) => d.kind !== "opening" && touchesRoom(d, r));
      for (const d of sl) for (const side of [-1, 1]) {
        const z = approach(d, side), cx = (z[0] + z[2]) / 2, cy = (z[1] + z[3]) / 2;
        if (roomOf(cx, cy) === r) continue;
        for (let k = 0; k < g.nx * g.ny && !ok; k++) {
          if (!fieldE || fieldE.dist[k] === Infinity) continue;
          const [x, y] = nav36.center(k);
          if (x > z[0] - 0.5 && x < z[2] + 0.5 && y > z[1] - 0.5 && y < z[3] + 0.5) ok = true;
        }
      }
    } else if (!PRIVATE_ROOMS.has(r.type) && r.type !== "hall") {
      // open-plan areas (living, kitchen, dining, sleeping area): reach the area or its open edge
      for (let k = 0; k < g.nx * g.ny && !ok; k++) {
        if (!fieldE || fieldE.dist[k] === Infinity) continue;
        const [x, y] = nav36.center(k);
        if (x > r.x - 0.5 && x < r.x + r.w + 0.5 && y > r.y - 0.5 && y < r.y + r.d + 0.5) ok = true;
      }
    } else {
      for (let k = 0; k < g.nx * g.ny && !ok; k++) {
        if (!fieldE || fieldE.dist[k] === Infinity) continue;
        const [x, y] = nav36.center(k);
        if (x > r.x + 0.1 && x < r.x + r.w - 0.1 && y > r.y + 0.1 && y < r.y + r.d - 0.1) ok = true;
      }
    }
    if (!ok) fail("path", `no 36-inch path from the front door to ${r.name}`);
  }

  // ---- 4. rooms: labeled, entered by a door or opening, enclosed if private, drawn = labeled size
  for (const r of rooms) if (!r.name || !r.type) fail("rooms", `room ${r.id} needs a name and type`);
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    if (rectsOverlap([a.x, a.y, a.x + a.w, a.y + a.d], [b.x, b.y, b.x + b.w, b.y + b.d], 0.05)) fail("rooms", `${a.name} and ${b.name} overlap`);
  }
  let floorArea = 0, roomArea = 0;
  for (const f of floors) floorArea += (f.x1 - f.x0) * (f.y1 - f.y0);
  for (const r of rooms) roomArea += r.w * r.d;
  if (roomArea < floorArea * 0.9) fail("rooms", `rooms cover only ${Math.round((roomArea / floorArea) * 100)}% of the floor; every space needs a label`);
  for (const r of rooms) {
    const sides = [
      { horiz: true, line: r.y, lo: r.x, hi: r.x + r.w, out: -1 },
      { horiz: true, line: r.y + r.d, lo: r.x, hi: r.x + r.w, out: 1 },
      { horiz: false, line: r.x, lo: r.y, hi: r.y + r.d, out: -1 },
      { horiz: false, line: r.x + r.w, lo: r.y, hi: r.y + r.d, out: 1 },
    ];
    let doorsHere = 0, openRun = 0, maxOpen = 0, badRun = 0;
    for (const s of sides) {
      let run = 0;
      for (let a = s.lo + 0.125; a < s.hi; a += 0.25) {
        const x = s.horiz ? a : s.line, y = s.horiz ? s.line : a;
        const px = s.horiz ? x : x + s.out * 0.2, py = s.horiz ? y + s.out * 0.2 : y;
        // what is on the other side of this bit of the room's edge?
        const onWall = walls.some((w) => w.z0 < 3 && (s.horiz
          ? Math.abs((s.out < 0 ? w.y1 : w.y0) - s.line) < TOL && x > w.x0 - 0.01 && x < w.x1 + 0.01
          : Math.abs((s.out < 0 ? w.x1 : w.x0) - s.line) < TOL && y > w.y0 - 0.01 && y < w.y1 + 0.01));
        const inDoor = doors.some((d) => d.horiz === s.horiz && Math.abs(d.line - s.out * d.half - s.line) < TOL && a > d.at - d.w / 2 - 0.01 && a < d.at + d.w / 2 + 0.01);
        const patio = exteriorOpenings(plan).some((o) => o.kind === "patio" && edges.some((e) => e.name === o.wall && e.horiz === s.horiz && Math.abs(e.line - (e.horiz ? e.n[1] : e.n[0]) * plan.extWall - s.line) < TOL) && Math.abs(a - o.at) < o.w / 2 + 0.01);
        const other = roomOf(px, py);
        if (inDoor) { doorsHere++; run = 0; continue; }
        if (onWall || patio) { run = 0; continue; }
        if (other && other !== r) { run += 0.25; openRun += 0.25; maxOpen = Math.max(maxOpen, run); continue; }
        badRun += 0.25;
      }
    }
    if (badRun > 0.5) fail("rooms", `${r.name}'s drawn edges don't line up with its walls (labeled ${fmt(r.w)}×${fmt(r.d)} ft)`);
    if (!doorsHere && maxOpen < 3) fail("rooms", `${r.name} has no door or opening`);
    if (PRIVATE_ROOMS.has(r.type) && openRun > 0.3) fail("rooms", `${r.name} is open to the next room; it needs walls and a door`);
    if (PRIVATE_ROOMS.has(r.type) && !doorsHere) fail("rooms", `${r.name} needs a door`);
  }
  // bathrooms are not entered through the kitchen work area
  const workZones = items.filter((it) => it.run && ["sink", "range", "cabinet", "fridge"].includes(it.key)).map((it) => {
    const v = FACE_VEC[it.face], r = itemRect(it);
    const ext = 4; // the 4 ft in front of the counters
    return [Math.min(r[0], r[0] + v[0] * ext), Math.min(r[1], r[1] + v[1] * ext), Math.max(r[2], r[2] + v[0] * ext), Math.max(r[3], r[3] + v[1] * ext)];
  });
  for (const d of doors.filter((q) => q.kind !== "slider" && !q.front)) {
    for (const side of [-1, 1]) {
      const z = approach(d, side), zc = [(z[0] + z[2]) / 2, (z[1] + z[3]) / 2], other = approach(d, -side), oc = [(other[0] + other[2]) / 2, (other[1] + other[3]) / 2];
      const here = roomOf(zc[0], zc[1]), there = roomOf(oc[0], oc[1]);
      if (there?.type !== "bath") continue;
      if (here?.type === "kitchen") fail("rooms", `${there.name} is entered from the kitchen`);
      else if (workZones.some((w) => rectsOverlap(z, w))) fail("rooms", `${there.name} is entered through the kitchen work area`);
    }
  }

  // ---- 5. kitchen: sink, range, fridge; work triangle; fridge at a run end; hood over the cooktop
  const k = (key) => items.filter((it) => it.key === key);
  const [sink] = k("sink"), [range] = k("range"), [fridge] = k("fridge");
  if (!sink || !range || !fridge) fail("kitchen", "kitchen needs a sink, a range and a fridge");
  else {
    const fp = (it) => { const v = FACE_VEC[it.face]; return [it.x + (v[0] * it.d) / 2, it.y + (v[1] * it.d) / 2]; };
    const legs = [[sink, range], [range, fridge], [fridge, sink]].map(([a, b]) => Math.hypot(fp(a)[0] - fp(b)[0], fp(a)[1] - fp(b)[1]));
    const total = legs.reduce((s, v) => s + v, 0);
    const names = ["sink→range", "range→fridge", "fridge→sink"];
    legs.forEach((l, i) => { if (l < 4 || l > 9) fail("kitchen", `work triangle ${names[i]} is ${fmt(l)} ft (want 4–9 ft)`); });
    if (total < 13 || total > 26) fail("kitchen", `work triangle totals ${fmt(total)} ft (want 13–26 ft)`);
    const runParts = items.filter((it) => it.run === fridge.run && it.elev === 0);
    const order = runParts.map((it) => it.key);
    if (order[0] !== "fridge" && order[order.length - 1] !== "fridge") fail("kitchen", "the fridge sits between counters; it should end a run");
    for (const it of items.filter((q) => q.run && q.run !== fridge.run && q.elev === 0 && q.key !== "fridge")) {
      const v = FACE_VEC[it.face], r = itemRect(it), z = [Math.min(r[0], r[0] + v[0] * 2.5), Math.min(r[1], r[1] + v[1] * 2.5), Math.max(r[2], r[2] + v[0] * 2.5), Math.max(r[3], r[3] + v[1] * 2.5)];
      if (rectsOverlap(z, itemRect(fridge))) fail("kitchen", `the fridge blocks the ${it.key} counter`);
    }
    // the range has counter beside it and isn't jammed into a corner
    const rr = itemRect(range);
    const beside = items.filter((q) => q.run === range.run && (q.key === "cabinet" || q.key === "sink") && q.elev === 0 && Math.hypot(q.x - range.x, q.y - range.y) < (q.w + range.w) / 2 + 0.05);
    if (!beside.length) fail("kitchen", "the range needs counter on at least one side");
    for (const q of items.filter((q2) => q2.run && q2.run !== range.run && q2.elev === 0)) {
      const qr = itemRect(q);
      const gapX = Math.max(qr[0] - rr[2], rr[0] - qr[2]), gapY = Math.max(qr[1] - rr[3], rr[1] - qr[3]);
      if (Math.max(gapX, gapY) < 1.2) fail("kitchen", "the range is jammed into the corner of the kitchen");
    }
    const hood = items.find((q) => q.key === "hood");
    if (!hood) fail("kitchen", "no range hood");
    else {
      const alongX = range.face === "front" || range.face === "back";
      const off = alongX ? Math.abs(hood.x - range.x) : Math.abs(hood.y - range.y);
      if (off > 0.01 || hood.w < range.w - 0.01 || hood.face !== range.face) fail("kitchen", `the range hood is ${fmt(off)} ft off the cooktop's center`);
    }
  }

  // ---- 6. camera views for every room button
  const views = roomViews(plan, model, items);
  for (const r of rooms) {
    if (!ROOM_BUTTONS.some((b) => b.type === r.type)) continue;
    const v = views[r.id];
    if (!v) { fail("camera", `${r.name}: no spot inside the doorway that's 2 ft from walls and clear of furniture with a view`); continue; }
    if (v.wallClear < VIEW_WALL_CLEAR_FT - 1e-6 || v.itemClear < VIEW_ITEM_CLEAR_FT - 1e-6) fail("camera", `${r.name}: start view too close to a wall or furniture`);
  }
  return fails;
}

function touchesRoom(d, r) {
  const sides = d.horiz ? [r.y, r.y + r.d] : [r.x, r.x + r.w];
  const span = d.horiz ? [r.x, r.x + r.w] : [r.y, r.y + r.d];
  return sides.some((s) => Math.abs(d.line - d.half - s) < TOL || Math.abs(d.line + d.half - s) < TOL) && d.at > span[0] && d.at < span[1];
}
