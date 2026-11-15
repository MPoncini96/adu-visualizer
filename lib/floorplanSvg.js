// The 2D floor plan as SVG markup, drawn from exactly the same resolved data as the 3D tour
// (furnitureItems, wallBoxes, doorways), so the two always agree. Used by components/FloorPlanSVG.jsx
// and by the screenshot/report scripts. The front of the house is at the bottom of the drawing.
import { outline, wallBoxes, exteriorOpenings, doorways, furnitureItems, itemRect, roomDims, FACE_VEC } from "./floorplan.js";

const ROOM_FILL = { living: "#f4efe4", sleep: "#efeee8", kitchen: "#efe9dc", dining: "#f2ece0", bedroom: "#ebeef0", bath: "#e6eef1", laundry: "#ecebe7", closet: "#ecebe7", hall: "#f4efe4" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const n = (v) => Math.round(v * 1000) / 1000;

export function floorPlanFrame(plan, model) {
  const o = outline(plan, model);
  const xs = o.verts.map((v) => v[0]), ys = o.verts.map((v) => v[1]);
  const pad = 1.2;
  const box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - (pad + 2.5), y1: Math.max(...ys) + pad };
  return { o, box, Y: (y) => box.y1 + box.y0 - y, viewBox: `${n(box.x0)} ${n(box.y0)} ${n(box.x1 - box.x0)} ${n(box.y1 - box.y0)}` };
}

export function floorPlanSvg(plan, model, { labels = true, furniture = true, items = furnitureItems(plan) } = {}) {
  const { o, box, Y, viewBox } = floorPlanFrame(plan, model);
  const out = [];
  const rect = (r, attrs) => out.push(`<rect x="${n(r[0])}" y="${n(Y(r[3]))}" width="${n(r[2] - r[0])}" height="${n(r[3] - r[1])}" ${attrs}/>`);
  out.push(`<polygon points="${o.verts.map(([x, y]) => `${n(x)},${n(Y(y))}`).join(" ")}" fill="#faf8f2"/>`);
  for (const r of plan.rooms) rect([r.x, r.y, r.x + r.w, r.y + r.d], `fill="${ROOM_FILL[r.type] || "#f4efe4"}"`);
  if (furniture) {
    // floor pieces solid; things on the wall above the floor (wall cabinets, hood, mirror) dashed
    const floorFirst = [...items].sort((a, b) => (a.walkable ? -1 : 0) - (b.walkable ? -1 : 0) || a.elev - b.elev);
    for (const it of floorFirst) {
      const r = itemRect(it);
      if (it.key === "tv") {
        // the screen: a dark bar along the front edge of its stand
        const v = FACE_VEC[it.face];
        const cx = it.x + v[0] * 0.2, cy = it.y + v[1] * 0.2;
        const along = it.face === "front" || it.face === "back";
        const bar = along ? [cx - it.w / 2, cy - 0.12, cx + it.w / 2, cy + 0.12] : [cx - 0.12, cy - it.w / 2, cx + 0.12, cy + it.w / 2];
        rect(bar, `fill="#3b4038" data-item="tv"`);
        continue;
      }
      if (it.elev > 0) { rect(r, `fill="none" stroke="#8f8878" stroke-width="0.07" stroke-dasharray="0.25 0.18" data-item="${it.key}"`); continue; }
      const fill = it.key === "rug" ? "#e9dcc7" : "#ffffff";
      rect(r, `rx="${it.key === "rug" ? 0.3 : 0.12}" fill="${fill}" stroke="#b3ab9a" stroke-width="0.08" data-item="${it.key}"`);
      // a small tick on each piece's front edge shows which way it faces
      if (!it.walkable && it.key !== "diningTable" && it.key !== "coffeeTable") {
        const v = FACE_VEC[it.face], hw = (it.face === "front" || it.face === "back" ? it.w : it.d) / 2, hd = (it.face === "front" || it.face === "back" ? it.d : it.w) / 2;
        const fx = it.x + v[0] * (it.face === "left" || it.face === "right" ? hd : 0), fy = it.y + v[1] * (it.face === "front" || it.face === "back" ? hd : 0);
        const len = Math.min(0.9, (it.face === "front" || it.face === "back" ? it.w : it.w) * 0.35);
        const [x1, y1, x2, y2] = it.face === "front" || it.face === "back" ? [fx - len / 2, fy, fx + len / 2, fy] : [fx, fy - len / 2, fx, fy + len / 2];
        void hw;
        out.push(`<line x1="${n(x1)}" y1="${n(Y(y1))}" x2="${n(x2)}" y2="${n(Y(y2))}" stroke="#8f8878" stroke-width="0.12"/>`);
      }
    }
  }
  for (const b of wallBoxes(plan, model)) if (b.z0 < 1 && b.z1 > 4) rect([b.x0, b.y0, b.x1, b.y1], `fill="#3b4038"`);
  const edges = Object.fromEntries(o.edges.map((e) => [e.name, e]));
  for (const w of exteriorOpenings(plan)) {
    if (w.kind === "door") continue;
    const e = edges[w.wall];
    if (!e) continue;
    const t = plan.extWall, fill = w.kind === "patio" ? "#bcd8e6" : "#cfe5ef";
    const r = e.horiz ? [w.at - w.w / 2, e.n[1] < 0 ? e.line : e.line - t, w.at + w.w / 2, e.n[1] < 0 ? e.line + t : e.line] : [e.n[0] < 0 ? e.line : e.line - t, w.at - w.w / 2, e.n[0] < 0 ? e.line + t : e.line, w.at + w.w / 2];
    rect(r, `fill="${fill}" stroke="#3b4038" stroke-width="0.06"`);
  }
  for (const d of doorways(plan, model)) {
    if (d.kind === "swing") {
      // the leaf drawn open at 90° (where the 3D tour shows it) and its swing arc
      const [hx, hy] = d.hingePt, end = d.arc[d.arc.length - 1], start = d.arc[1];
      out.push(`<path d="M${n(start[0])},${n(Y(start[1]))} A${n(d.L)},${n(d.L)} 0 0 ${arcSweep(d)} ${n(end[0])},${n(Y(end[1]))}" fill="none" stroke="#8a8474" stroke-width="0.07" stroke-dasharray="0.2 0.12"/>`);
      rect(d.leaf, `fill="#8a8474"`);
      void hx; void hy;
    } else if (d.kind === "slider") {
      const a0 = d.at - d.w / 2, a1 = d.at + d.w / 2, m = d.at;
      for (const [s0, s1, off] of [[a0, m + 0.2, -0.07], [m - 0.2, a1, 0.07]]) {
        const r = d.horiz ? [s0, d.line + off - 0.04, s1, d.line + off + 0.04] : [d.line + off - 0.04, s0, d.line + off + 0.04, s1];
        rect(r, `fill="#8a8474"`);
      }
    }
  }
  if (labels) {
    for (const r of plan.rooms) {
      const small = r.type === "closet" || r.type === "hall" || r.type === "laundry" || r.w < 4.5 || r.d < 4;
      const fs = small ? Math.min(0.8, r.w / 5, r.d / 2.6) : Math.min(1.25, r.w / 6);
      const cx = r.x + r.w / 2, cy = Y(r.y + r.d / 2);
      out.push(`<g pointer-events="none"><text x="${n(cx)}" y="${n(cy - fs * 0.25)}" font-size="${n(fs)}" text-anchor="middle" fill="#2c3a30" font-weight="700">${esc(r.name)}</text>` +
        `<text x="${n(cx)}" y="${n(cy + fs * 0.95)}" font-size="${n(fs * 0.85)}" text-anchor="middle" fill="#5d6a5f">${esc(roomDims(r))}</text></g>`);
    }
    out.push(`<text x="${n(plan.frontDoor.at)}" y="${n(Y(-1.9))}" font-size="0.95" text-anchor="middle" fill="#7a8477" letter-spacing="0.1">ENTRY</text>`);
  }
  return { viewBox, body: out.join(""), Y, box };
}

// SVG arc sweep flag for a door's quarter circle (the drawing flips y)
function arcSweep(d) {
  const [x0, y0] = d.arc[1], [x1, y1] = d.arc[d.arc.length - 1], [hx, hy] = d.hingePt;
  const cross = (x0 - hx) * (y1 - hy) - (y0 - hy) * (x1 - hx);
  return cross > 0 ? 0 : 1;
}
