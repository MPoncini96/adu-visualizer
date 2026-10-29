// 2D floor plan drawn from the same JSON as the 3D tour (used as the tour's mini-map).
// Plan coords are feet with y going back into the house; the SVG draws the front at the bottom.
import { forwardRef, useMemo } from "react";
import { outline, wallBoxes, exteriorOpenings, interiorDoors, furnitureItems, itemRect, roomDims } from "../lib/floorplan.js";

const ROOM_FILL = { living: "#f4efe4", kitchen: "#efe9dc", dining: "#f2ece0", bedroom: "#ebeef0", bath: "#e6eef1", laundry: "#ecebe7", closet: "#ecebe7", hall: "#f4efe4" };

const FloorPlanSVG = forwardRef(function FloorPlanSVG({ plan, model, labels = true, furniture = true, onPick, className, children }, markerRef) {
  const g = useMemo(() => {
    const o = outline(plan, model);
    const xs = o.verts.map((v) => v[0]), ys = o.verts.map((v) => v[1]);
    const pad = 1.2;
    const box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - (pad + 2.5), y1: Math.max(...ys) + pad };
    return {
      o, box,
      walls: wallBoxes(plan, model).filter((b) => b.z0 < 1 && b.z1 > 4),
      windows: exteriorOpenings(plan),
      doors: interiorDoors(plan),
      items: furniture ? furnitureItems(plan).filter((i) => !i.elev || i.key === "tv") : [],
    };
  }, [plan, model, furniture]);
  const { box, o } = g;
  // flip y so the front of the house is at the bottom of the drawing
  const Y = (y) => box.y1 + box.y0 - y;
  const edgeByName = Object.fromEntries(o.edges.map((e) => [e.name, e]));

  const pick = (evt) => {
    if (!onPick) return;
    const svg = evt.currentTarget.ownerSVGElement || evt.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    onPick(p.x, Y(p.y));
  };

  return (
    <svg className={className} viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`} preserveAspectRatio="xMidYMid meet" onClick={pick} role="img" aria-label={`${model.name} floor plan`}>
      <polygon points={o.verts.map(([x, y]) => `${x},${Y(y)}`).join(" ")} fill="#faf8f2" />
      {plan.rooms.map((r) => (
        <rect key={r.id} x={r.x} y={Y(r.y + r.d)} width={r.w} height={r.d} fill={ROOM_FILL[r.type] || "#f4efe4"} />
      ))}
      {g.items.map((it, i) => {
        const [x0, y0, x1, y1] = itemRect(it);
        return <rect key={i} x={x0} y={Y(y1)} width={x1 - x0} height={y1 - y0} rx={it.key === "rug" ? 0.3 : 0.15} fill={it.key === "rug" ? "#e9dcc7" : "#ffffff"} stroke="#b9b2a3" strokeWidth={0.08} />;
      })}
      {g.walls.map((b, i) => (
        <rect key={i} x={b.x0} y={Y(b.y1)} width={b.x1 - b.x0} height={b.y1 - b.y0} fill="#3b4038" />
      ))}
      {g.windows.map((w, i) => {
        const e = edgeByName[w.wall];
        if (!e) return null;
        const t = plan.extWall;
        if (w.kind === "door") return null;
        const fill = w.kind === "patio" ? "#bcd8e6" : "#cfe5ef";
        return e.horiz
          ? <rect key={i} x={w.at - w.w / 2} y={Y(e.n[1] < 0 ? e.line + t : e.line)} width={w.w} height={t} fill={fill} stroke="#3b4038" strokeWidth={0.06} />
          : <rect key={i} x={e.n[0] < 0 ? e.line : e.line - t} y={Y(w.at + w.w / 2)} width={t} height={w.w} fill={fill} stroke="#3b4038" strokeWidth={0.06} />;
      })}
      {/* front door: swing arc */}
      {(() => {
        const fd = plan.frontDoor, t = plan.extWall;
        const x0 = fd.at - fd.w / 2;
        return <path d={`M${x0},${Y(t)} L${x0},${Y(t + fd.w)} A${fd.w},${fd.w} 0 0 1 ${x0 + fd.w},${Y(t)}`} fill="none" stroke="#8a8474" strokeWidth={0.1} />;
      })()}
      {g.doors.filter((d) => d.leaf).map((d, i) => {
        const a0 = d.at - d.w / 2;
        return d.horiz
          ? <path key={i} d={`M${a0},${Y(d.line)} L${a0},${Y(d.line + d.w)} A${d.w},${d.w} 0 0 1 ${a0 + d.w},${Y(d.line)}`} fill="none" stroke="#8a8474" strokeWidth={0.08} />
          : <path key={i} d={`M${d.line},${Y(a0)} L${d.line + d.w},${Y(a0)} A${d.w},${d.w} 0 0 1 ${d.line},${Y(a0 + d.w)}`} fill="none" stroke="#8a8474" strokeWidth={0.08} />;
      })}
      {labels && plan.rooms.filter((r) => r.type !== "closet" && r.type !== "hall").map((r) => (
        <g key={r.id} pointerEvents="none">
          <text x={r.x + r.w / 2} y={Y(r.y + r.d / 2) - 0.3} fontSize={Math.min(1.25, r.w / 6)} textAnchor="middle" fill="#2c3a30" fontWeight="700">{r.name}</text>
          <text x={r.x + r.w / 2} y={Y(r.y + r.d / 2) + 1.1} fontSize={Math.min(1.05, r.w / 7)} textAnchor="middle" fill="#5d6a5f">{roomDims(r)}</text>
        </g>
      ))}
      <text x={plan.frontDoor.at} y={Y(-1.9)} fontSize={0.95} textAnchor="middle" fill="#7a8477" letterSpacing={0.1}>ENTRY</text>
      {/* "you are here": positioned imperatively through the forwarded ref (cheap per-frame updates) */}
      <g ref={markerRef} style={{ display: "none" }} pointerEvents="none">
        <path d="M0,0 L-2.6,-4.6 A5.3,5.3 0 0 1 2.6,-4.6 Z" fill="rgba(196,104,58,0.28)" />
        <circle r={0.85} fill="#c4683a" stroke="#fff" strokeWidth={0.3} />
      </g>
      {children}
    </svg>
  );
});

export default FloorPlanSVG;

// SVG y for a plan y (for positioning the marker from outside)
export function planSvgY(plan, model, y) {
  const o = outline(plan, model);
  const ys = o.verts.map((v) => v[1]);
  const pad = 1.2;
  return Math.max(...ys) + pad + Math.min(...ys) - (pad + 2.5) - y;
}
