// Walking, path-finding and per-room camera views, in plan feet. Pure (no three.js), so the tour,
// the plan checker and tests all use exactly the same rules.
import { wallBoxes, doorways, furnitureItems, itemRect, collidersFor, yardRect, entryPose, floorRects, MAIN_ITEM, PRIVATE_ROOMS, FACE_VEC } from "./floorplan.js";

export const BODY_RADIUS_FT = 0.9;
export const EYE_FT = 5.25; // 5'3"
export const VIEW_WALL_CLEAR_FT = 2; // a room view never starts closer than this to a wall
export const VIEW_ITEM_CLEAR_FT = 1; // ...or this close to furniture

const distToRect = (x, y, b) => Math.hypot(x - Math.max(b[0], Math.min(x, b[2])), y - Math.max(b[1], Math.min(y, b[3])));

function circleRectPush(x, y, r, b) {
  const cx = Math.max(b[0], Math.min(x, b[2])), cy = Math.max(b[1], Math.min(y, b[3]));
  const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; return [dx * k, dy * k]; }
  const opts = [[b[0] - r - x, 0], [b[2] + r - x, 0], [0, b[1] - r - y], [0, b[3] + r - y]];
  return opts.sort((a, b2) => Math.hypot(...a) - Math.hypot(...b2))[0];
}

// Occupancy grid + collision for a body of `radius` feet. `margin` keeps planned paths a little
// further from obstacles than the body itself, so glides never scrape a door frame.
export function makeNav(colliders, yard, { radius = BODY_RADIUS_FT, margin = 0.1, cell = 0.5 } = {}) {
  function resolve(x, y) {
    for (let it = 0; it < 6; it++) {
      let moved = false;
      for (const b of colliders) {
        const p = circleRectPush(x, y, radius, b);
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
  const gx0 = yard.x0, gy0 = yard.y0;
  const nx = Math.ceil((yard.x1 - yard.x0) / cell), ny = Math.ceil((yard.y1 - yard.y0) / cell);
  const blocked = new Uint8Array(nx * ny);
  const R = radius + margin;
  for (const b of colliders) {
    const i0 = Math.max(0, Math.floor((b[0] - R - gx0) / cell)), i1 = Math.min(nx - 1, Math.ceil((b[2] + R - gx0) / cell));
    const j0 = Math.max(0, Math.floor((b[1] - R - gy0) / cell)), j1 = Math.min(ny - 1, Math.ceil((b[3] + R - gy0) / cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const px = gx0 + (i + 0.5) * cell, py = gy0 + (j + 0.5) * cell;
      if (distToRect(px, py, b) < R) blocked[j * nx + i] = 1;
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
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.5)));
    for (let s = 0; s <= n; s++) {
      const k = idx(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n);
      if (k < 0 || blocked[k]) return false;
    }
    return true;
  }
  // Dijkstra from `from` over the grid
  function field(from) {
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
    return { start, dist, came };
  }
  function trace(f, from, gk, to) {
    const cells = [];
    for (let k = gk; k !== -1 && k !== f.start; k = f.came[k]) cells.push(center(k));
    cells.reverse();
    if (to) cells[cells.length - 1] = to;
    const pts = [from];
    let anchor = from;
    for (let i = 0; i < cells.length; i++) {
      const next = cells[i + 1];
      if (!next || !lineFree(anchor, next)) { pts.push(cells[i]); anchor = cells[i]; }
    }
    return pts;
  }
  // Path to the reachable spot nearest `to`, or (with `rect`) the reachable spot in rect nearest its middle
  function path(from, to, rect = null) {
    const f = field(from);
    if (!f) return null;
    const tx = rect ? (rect[0] + rect[2]) / 2 : to[0], ty = rect ? (rect[1] + rect[3]) / 2 : to[1];
    let gk = -1, best = Infinity;
    for (let k = 0; k < nx * ny; k++) {
      if (f.dist[k] === Infinity) continue;
      const [cx, cy] = center(k);
      if (rect && (cx < rect[0] + 0.2 || cx > rect[2] - 0.2 || cy < rect[1] + 0.2 || cy > rect[3] - 0.2)) continue;
      const dd = (cx - tx) ** 2 + (cy - ty) ** 2;
      if (dd < best) { best = dd; gk = k; }
    }
    if (gk < 0 || gk === f.start) return null;
    if (!rect && best > 16) return null;
    const exact = !rect && idx(to[0], to[1]) === gk && !blocked[idx(to[0], to[1])];
    return trace(f, from, gk, exact ? to : null);
  }
  // Path to an exact point (must be reachable)
  function pathTo(from, to) {
    const f = field(from);
    const gk = idx(to[0], to[1]);
    if (!f || gk < 0 || f.dist[gk] === Infinity) return null;
    if (gk === f.start) return [from, to];
    return trace(f, from, gk, to);
  }
  return { move, resolve, path, pathTo, field, nearestFree, lineFree, idx, center, grid: { blocked, nx, ny, cell, gx0, gy0 } };
}

// Nav for the tour body (0.9 ft radius) in a plan
export function navFor(plan, model, items = furnitureItems(plan)) {
  return makeNav(collidersFor(plan, model, items), yardRect(plan, model));
}

// ---------------------------------------------------------------- room views
// For every room: stand just inside the doorway you'd walk in through (from the front door),
// at eye height, at least 2 ft from any wall and clear of furniture, looking at the room's main
// piece (bed, sofa, vanity, range, table) or its middle.
export function roomViews(plan, model, items = furnitureItems(plan), nav = navFor(plan, model, items)) {
  const walls = wallBoxes(plan, model).filter((b) => b.z0 < 3).map((b) => [b.x0, b.y0, b.x1, b.y1]);
  const furn = items.filter((i) => !i.walkable && !i.elev).map(itemRect);
  // open door leaves block the view like a wall would
  const leaves = doorways(plan, model).filter((d) => d.kind === "swing").map((d) => d.leaf);
  const blockers = [...walls, ...leaves];
  const near = furn;
  const entry = entryPose(plan, model);
  const f = nav.field([entry.x, entry.y]);
  const out = {};
  for (const r of plan.rooms) {
    const rect = [r.x, r.y, r.x + r.w, r.y + r.d];
    const keys = MAIN_ITEM[r.type] || [];
    const mains = items.filter((i) => keys.includes(i.key) && inRect(i.x, i.y, rect, 0.01));
    const main = mains.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))[0] || null;
    const target = main ? [main.x, main.y] : [r.x + r.w / 2, r.y + r.d / 2];
    const targetZ = main ? Math.min(3, main.h) : 2.5; // top of the bed, sofa seat-back, counter
    // where the walk from the front door first enters the room
    const p = nav.path([entry.x, entry.y], [0, 0], rect);
    let pin = null;
    if (p) {
      outer: for (let i = 1; i < p.length; i++) {
        const [ax, ay] = p[i - 1], [bx, by] = p[i];
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
        for (let s = 0; s <= n; s++) {
          const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
          if (inRect(x, y, rect, -0.2)) { pin = [x, y]; break outer; }
        }
      }
    }
    // candidate spots: reachable, 2 ft from walls, 1 ft from furniture, a comfortable distance from the
    // target and in front of the main item (you see the bed's foot, the sofa's seat, the vanity's face).
    // Private rooms: inside the room. Open-plan areas: inside, or at their open edge looking in.
    const step = 0.25, grow = PRIVATE_ROOMS.has(r.type) ? 0 : 2.5;
    const floors = floorRects(plan, model);
    const ideal = Math.max(4.5, Math.min(8, Math.max(r.w, r.d) * 0.7));
    const fv = main ? FACE_VEC[main.face] : null;
    const cands = [];
    for (let x = r.x + 0.25 - grow; x <= r.x + r.w - 0.25 + grow; x += step) {
      for (let y = r.y + 0.25 - grow; y <= r.y + r.d - 0.25 + grow; y += step) {
        if (!floors.some((q) => x > q.x0 && x < q.x1 && y > q.y0 && y < q.y1)) continue;
        const k = nav.idx(x, y);
        if (!f || k < 0 || f.dist[k] === Infinity) continue;
        const wc = Math.min(...walls.map((b) => distToRect(x, y, b)));
        if (leaves.some((b) => distToRect(x, y, b) < 1.5)) continue; // an open leaf right beside you fills half the view
        const fc = near.length ? Math.min(...near.map((b) => distToRect(x, y, b))) : 99;
        if (wc < VIEW_WALL_CLEAR_FT || fc < VIEW_ITEM_CLEAR_FT) continue;
        const td = Math.hypot(target[0] - x, target[1] - y);
        if (td < 2) continue;
        if (!segmentClear([x, y], target, blockers)) continue;
        // an open door leaf close by and inside the view would fill half the screen
        const ang = Math.atan2(target[1] - y, target[0] - x);
        if (leaves.some((b) => {
          const dl = distToRect(x, y, b);
          if (dl > 3.5) return false;
          const cx = Math.max(b[0], Math.min(b[2], x + Math.cos(ang) * dl)), cy = Math.max(b[1], Math.min(b[3], y + Math.sin(ang) * dl));
          const corners = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]], [cx, cy], [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]];
          return corners.some(([px, py]) => Math.abs(wrapA(Math.atan2(py - y, px - x) - ang)) < 0.8);
        })) continue;
        const front = fv ? (fv[0] * (x - target[0]) + fv[1] * (y - target[1])) / td : 1;
        cands.push({ x, y, wc, fc, td, front, outside: !inRect(x, y, rect) });
      }
    }
    let best = null, bestScore = Infinity;
    for (const minTd of [4, 3, 2]) {
      for (const c of cands) {
        if (c.td < minTd) continue;
        const score = (pin ? Math.hypot(c.x - pin[0], c.y - pin[1]) : 0) + 0.5 * Math.abs(c.td - ideal) + (c.front < 0.2 ? 8 : (1 - c.front) * 2) + (c.outside ? 4 : 0);
        if (score < bestScore) { bestScore = score; best = [c.x, c.y, c.wc, c.fc, c.td, c.front]; }
      }
      if (best) break;
    }
    if (!best) { out[r.id] = null; continue; }
    let [x, y, wallClear, itemClear, dist, front] = best;
    // nowhere to stand in front of the main piece (you'd see its side): look across the room instead
    if (main && front < 0.3) {
      const c = [r.x + r.w / 2, r.y + r.d / 2];
      if (Math.hypot(c[0] - x, c[1] - y) > 2 && segmentClear([x, y], c, blockers)) { target[0] = c[0]; target[1] = c[1]; dist = Math.hypot(c[0] - x, c[1] - y); }
    }
    const yaw = Math.atan2(-(target[0] - x), target[1] - y);
    const pitch = Math.max(dist < 3.5 ? -0.5 : -0.38, Math.min(-0.05, -0.55 * Math.atan2(EYE_FT - targetZ, dist))); // the item in the lower half, the room above it
    out[r.id] = { x, y, yaw, pitch, target, main: main?.key || null, wallClear, itemClear, dist };
  }
  return out;
}
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const inRect = (x, y, r, m = 0) => x >= r[0] - m && x <= r[2] + m && y >= r[1] - m && y <= r[3] + m;
// 2D segment vs wall rectangles (sampled)
export function segmentClear(a, b, rects) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1);
  for (let s = 1; s < n; s++) {
    const x = a[0] + ((b[0] - a[0]) * s) / n, y = a[1] + ((b[1] - a[1]) * s) / n;
    if (rects.some((q) => x > q[0] && x < q[2] && y > q[1] && y < q[3])) return false;
  }
  return true;
}
