"use client";
// Site-plan view (no map imagery). Used when no Google key is configured, and as a
// clean "plan" toggle. Same behaviour as the map: drag the ADU, click to place or trace.
import { useMemo, useRef, useState } from "react";
import { aduCornersXY, FT } from "../lib/geo.js";

const FIT_COLORS = { ok: "#2fbf71", tight: "#f2a93b", bad: "#e5484d" };

export default function PlanEditor({ lotXY, adu, dims, status, tracing, traceXY, onAduMove, onMapClick, projector }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const box = useMemo(() => {
    const pts = [...(lotXY || []), ...(traceXY || [])];
    if (adu && dims) pts.push(...aduCornersXY(adu.x, adu.y, dims.w, dims.d, adu.heading));
    if (!pts.length) pts.push([-20, -20], [20, 20]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 8;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const size = Math.max(maxX - minX, maxY - minY, 30);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { x: cx - size / 2, y: -(cy + size / 2), size };
    // Only reframe when the lot changes, not while dragging
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotXY, traceXY?.length]);

  const toLocal = (evt) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, -p.y];
  };

  const corners = adu && dims ? aduCornersXY(adu.x, adu.y, dims.w, dims.d, adu.heading) : null;
  const pts = (arr) => arr.map(([x, y]) => `${x},${-y}`).join(" ");
  const grid = [];
  const step = 5;
  for (let v = Math.floor(box.x / step) * step; v < box.x + box.size; v += step)
    grid.push(<line key={"v" + v} x1={v} x2={v} y1={box.y} y2={box.y + box.size} />);
  for (let v = Math.floor(box.y / step) * step; v < box.y + box.size; v += step)
    grid.push(<line key={"h" + v} y1={v} y2={v} x1={box.x} x2={box.x + box.size} />);

  return (
    <svg
      ref={svgRef}
      className="plan-canvas"
      viewBox={`${box.x} ${box.y} ${box.size} ${box.size}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={(e) => {
        if (!drag) return;
        const [x, y] = toLocal(e);
        onAduMove({ x: x - drag.dx, y: y - drag.dy, live: true });
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        const [x, y] = toLocal(e);
        onAduMove({ x: x - drag.dx, y: y - drag.dy });
        setDrag(null);
      }}
      onClick={(e) => {
        if (drag || e.target.dataset.adu) return;
        const [x, y] = toLocal(e);
        const ll = projector?.toLatLng(x, y) || {};
        onMapClick({ x, y, ...ll });
      }}
      role="img"
      aria-label="Site plan of the lot with the ADU footprint"
    >
      <rect x={box.x} y={box.y} width={box.size} height={box.size} fill="#eef0e6" />
      <g stroke="#d7dbc9" strokeWidth={0.08}>{grid}</g>
      {lotXY?.length > 2 && <polygon points={pts(lotXY)} fill="#fbf6df" stroke="#c99a12" strokeWidth={0.35} />}
      {traceXY?.length > 0 && (
        <>
          <polyline points={pts(traceXY)} fill="none" stroke="#c99a12" strokeWidth={0.35} strokeDasharray="1 0.6" />
          {traceXY.map(([x, y], i) => <circle key={i} cx={x} cy={-y} r={0.6} fill="#c99a12" />)}
        </>
      )}
      {corners && !tracing && (
        <g>
          <polygon
            data-adu="1"
            points={pts(corners)}
            fill={FIT_COLORS[status] || FIT_COLORS.ok}
            fillOpacity={0.75}
            stroke="#fff"
            strokeWidth={0.25}
            style={{ cursor: "move", touchAction: "none" }}
            onPointerDown={(e) => {
              e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId);
              const [x, y] = toLocal(e);
              setDrag({ dx: x - adu.x, dy: y - adu.y });
            }}
          />
          {(() => {
            const [fl, fr] = corners;
            const a = [fl[0] + (fr[0] - fl[0]) / 3, fl[1] + (fr[1] - fl[1]) / 3];
            const b = [fl[0] + (2 * (fr[0] - fl[0])) / 3, fl[1] + (2 * (fr[1] - fl[1])) / 3];
            return <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} stroke="#fff" strokeWidth={0.6} pointerEvents="none" />;
          })()}
        </g>
      )}
      {/* scale bar: 20 ft */}
      <g transform={`translate(${box.x + box.size - 3 - 20 * FT}, ${box.y + 9})`} pointerEvents="none">
        <line x1={0} x2={20 * FT} y1={0} y2={0} stroke="#3a4a3f" strokeWidth={0.3} />
        <text x={0} y={-0.8} fontSize={1.4} fill="#3a4a3f">20 ft</text>
      </g>
      {/* north arrow */}
      <g transform={`translate(${box.x + box.size - 3}, ${box.y + 4})`} pointerEvents="none">
        <path d="M0,-2.2 L1,0.8 L0,0.2 L-1,0.8 Z" fill="#3a4a3f" />
        <text x={-0.6} y={2.4} fontSize={1.4} fill="#3a4a3f">N</text>
      </g>
    </svg>
  );
}
