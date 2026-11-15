// 2D floor plan drawn from the same data as the 3D tour (lib/floorplanSvg.js), used for the
// plan cards and the tour's mini-map. The "you are here" marker is positioned imperatively.
import { forwardRef, useMemo } from "react";
import { floorPlanSvg, floorPlanFrame } from "../lib/floorplanSvg.js";

const FloorPlanSVG = forwardRef(function FloorPlanSVG({ plan, model, labels = true, furniture = true, onPick, className }, markerRef) {
  const svg = useMemo(() => floorPlanSvg(plan, model, { labels, furniture }), [plan, model, labels, furniture]);
  const pick = (evt) => {
    if (!onPick) return;
    const el = evt.currentTarget;
    const pt = el.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(el.getScreenCTM().inverse());
    onPick(p.x, svg.Y(p.y));
  };
  return (
    <svg className={className} viewBox={svg.viewBox} preserveAspectRatio="xMidYMid meet" onClick={pick} role="img" aria-label={`${model.name} floor plan`}>
      <g dangerouslySetInnerHTML={{ __html: svg.body }} />
      <g ref={markerRef} style={{ display: "none" }} pointerEvents="none">
        <path d="M0,0 L-2.6,-4.6 A5.3,5.3 0 0 1 2.6,-4.6 Z" fill="rgba(196,104,58,0.28)" />
        <circle r={0.85} fill="#c4683a" stroke="#fff" strokeWidth={0.3} />
      </g>
    </svg>
  );
});

export default FloorPlanSVG;

// SVG y for a plan y (for positioning the marker from outside)
const frames = new Map();
export function planSvgY(plan, model, y) {
  if (!frames.has(plan)) frames.set(plan, floorPlanFrame(plan, model));
  return frames.get(plan).Y(y);
}
