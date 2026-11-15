// The "Try an example property" lot. It is fictional: a typical 60 × 130 ft Valley lot with a
// house, back patio, pool and shed, drawn in feet and shown on the site plan only (no satellite
// imagery, so no real home is shown). The open lawn is the back-left corner, where the default
// placement lands. Coordinates: x = feet right of the lot's center line, y = feet back from the street.
import { makeProjector } from "./geo.js";

const FT = 0.3048;
const ORIGIN = { lat: 37.7974, lng: -121.2161 }; // only anchors the drawing; never shown

const LOT_FT = [[-30, 0], [30, 0], [30, 130], [-30, 130]];
const FEATURES_FT = [
  { kind: "house", label: "House", pts: [[-22, 20], [22, 20], [22, 62], [-22, 62]] },
  { kind: "patio", label: "Patio", pts: [[-14, 62], [10, 62], [10, 74], [-14, 74]] },
  { kind: "pool", label: "Pool", pts: [[4, 82], [24, 82], [24, 98], [4, 98]] },
  { kind: "shed", label: "Shed", pts: [[18, 116], [27, 116], [27, 126], [18, 126]] },
];

const proj = makeProjector(ORIGIN);
const toRing = (pts) => {
  const r = pts.map(([x, y]) => { const p = proj.toLatLng(x * FT, y * FT); return [p.lng, p.lat]; });
  return [...r, r[0]];
};
const street = proj.toLatLng(0, -2 * FT);

export const DEMO_LOT = {
  label: "Example lot (fictional) · 60 × 130 ft",
  fictional: true,
  source: "example",
  county: null,
  ring: toRing(LOT_FT),
  structures: FEATURES_FT.map((f) => ({ ring: toRing(f.pts), kind: f.kind, label: f.label, source: "Example" })),
  street: { lat: street.lat, lng: street.lng }, // the front lot line is nearest this point
};
