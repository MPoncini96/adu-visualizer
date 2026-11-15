"use client";
// Floor plan thumbnail by plan id, for server-rendered pages.
import { MODELS } from "../lib/models.js";
import { floorPlanFor } from "../lib/floorplans/index.js";
import FloorPlanSVG from "./FloorPlanSVG.jsx";

export default function PlanThumb({ id }) {
  const m = MODELS.find((x) => x.id === id);
  return <FloorPlanSVG plan={floorPlanFor(id)} model={m} labels furniture={false} />;
}
