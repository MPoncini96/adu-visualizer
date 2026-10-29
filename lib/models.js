// The placeholder ADU plans (Valley orchard names). Dimensions are EXTERIOR wall-to-wall
// footprints of the living space in feet; covered porches are extra and sit outside that box.
// Swap these for the builder's real plans later; everything else reads from here.
//
// Plan coordinates: x = feet to the right, f = feet forward (toward the front door),
// centered on the bounding box of the whole footprint (living space + porch).

// Roof constants shared with the 3D model builder (feet)
export const ROOF = { eaveFt: 9.5, pitch: 0.5, thicknessFt: 0.46 };

const rect = (W, D, extra = {}) => ({ shape: "rect", W, D, ...extra });
// L: main body W x D, plus a wing (ww wide, wd deep) projecting forward on the right side.
const ell = (W, D, ww, wd) => ({ shape: "L", W, D, ww, wd });

export const MODELS = [
  { id: "pocket", name: "The Pocket", kind: "Micro studio", beds: 0, baths: 1, ...rect(12, 20), blurb: "A compact backyard studio. Office, guest room or a starter rental on a tight lot." },
  { id: "apricot", name: "The Apricot", kind: "Studio", beds: 0, baths: 1, ...rect(16, 22), blurb: "Open studio with a kitchenette and full bath. Fits behind most garages." },
  { id: "cherry", name: "The Cherry", kind: "1 bed / 1 bath", beds: 1, baths: 1, ...rect(20, 24), blurb: "A true one-bedroom in under 500 sq ft. The best value per square foot." },
  { id: "peach", name: "The Peach", kind: "1 bed / 1 bath", beds: 1, baths: 1, ...rect(22, 28), blurb: "Roomier one-bedroom with space for a dining table. The most popular rental size." },
  { id: "plum", name: "The Plum", kind: "1 bed / 1 bath · L-shape", beds: 1, baths: 1, ...ell(24, 20, 12, 10), blurb: "L-shaped one-bedroom with a covered entry tucked into the corner." },
  { id: "walnut", name: "The Walnut", kind: "2 bed / 1 bath", beds: 2, baths: 1, ...rect(24, 32), blurb: "Room for a small family or aging parents. Fits most Valley lots." },
  { id: "olive", name: "The Olive", kind: "2 bed / 1 bath · L-shape", beds: 2, baths: 1, ...ell(30, 22, 14, 12), blurb: "Two bedrooms in an L that wraps a private patio. Great on wide, shallow yards." },
  { id: "almond", name: "The Almond", kind: "2 bed / 2 bath", beds: 2, baths: 2, ...rect(25, 40), blurb: "A full two-bed, two-bath home at 1,000 sq ft, the size state law guarantees for a detached ADU." },
  { id: "pistachio", name: "The Pistachio", kind: "2 bed / 2 bath · L-shape", beds: 2, baths: 2, ...ell(34, 26, 16, 14), blurb: "Our largest plan. Split bedrooms, two baths and a covered porch. Check your city's size cap." },
  { id: "fig", name: "The Fig", kind: "Garage conversion", beds: 1, baths: 1, ...rect(20, 22, { conversion: true }), blurb: "Turns your existing two-car garage into a one-bedroom unit. No new footprint in the yard." },
].map((m) => ({ ...m, sqft: sqftOf(m), widthFt: m.W, depthFt: m.shape === "L" ? m.D + m.wd : m.D, heightFt: heightOf(m) }));

// Old IDs (used in earlier links) -> current IDs
export const MODEL_ALIASES = {
  lathrop: "apricot", ripon: "cherry", manteca: "walnut", delta: "almond", conversion: "fig",
  escalon: "peach", lodi: "plum", oakdale: "olive", kingsburg: "pistachio",
  studio: "apricot", "one-bed": "cherry", "two-bed": "walnut", "two-bed-two-bath": "almond", garage: "fig",
};
export function findModel(id) {
  const key = MODEL_ALIASES[id] || id;
  return MODELS.find((m) => m.id === key);
}

function sqftOf(m) {
  return m.shape === "L" ? m.W * m.D + m.ww * m.wd : m.W * m.D;
}

function heightOf(m) {
  const span = m.shape === "L" ? m.D : m.W;
  return ROOF.eaveFt + (span / 2) * ROOF.pitch + ROOF.thicknessFt;
}
export const heightLabel = (m) => `1 story · ~${Math.round(m.heightFt)} ft`;

// Full plan geometry in feet: outline (living space + porch, CCW), body (living space only),
// porch rectangle (or null) and the front door position.
export function geometryFt(m) {
  if (m.shape !== "L") {
    const { W, D } = m;
    const doorX = m.conversion ? 0 : W >= 16 ? -W * 0.18 : 0;
    const pd = m.conversion ? 0 : Math.min(5, D * 0.16);
    const half = Math.min(4.25, W / 2 - 0.6);
    const px0 = Math.max(-W / 2 + 0.3, doorX - half), px1 = Math.min(W / 2 - 0.3, doorX + half);
    const s = -pd / 2; // shift so the bbox (body + porch) is centered
    const body = [[-W / 2, -D / 2 + s], [W / 2, -D / 2 + s], [W / 2, D / 2 + s], [-W / 2, D / 2 + s]];
    const outline = pd
      ? [[-W / 2, -D / 2 + s], [W / 2, -D / 2 + s], [W / 2, D / 2 + s], [px1, D / 2 + s], [px1, D / 2 + pd + s], [px0, D / 2 + pd + s], [px0, D / 2 + s], [-W / 2, D / 2 + s]]
      : body;
    return {
      outline, body,
      porch: pd ? { x0: px0, x1: px1, f0: D / 2 + s, f1: D / 2 + pd + s, type: "gable" } : null,
      door: { x: doorX, f: D / 2 + s, w: 3 },
    };
  }
  const { W, D, ww, wd } = m;
  const s = -wd / 2;
  const wingX0 = W / 2 - ww;
  const body = [
    [-W / 2, -D / 2 + s], [W / 2, -D / 2 + s], [W / 2, D / 2 + wd + s],
    [wingX0, D / 2 + wd + s], [wingX0, D / 2 + s], [-W / 2, D / 2 + s],
  ];
  const doorX = (-W / 2 + wingX0) / 2;
  const depth = Math.min(5.5, wd - 0.7);
  const px0 = Math.max(-W / 2 + 0.7, doorX - 5.2);
  const outline = [
    [-W / 2, -D / 2 + s], [W / 2, -D / 2 + s], [W / 2, D / 2 + wd + s], [wingX0, D / 2 + wd + s],
    [wingX0, D / 2 + depth + s], [px0, D / 2 + depth + s], [px0, D / 2 + s], [-W / 2, D / 2 + s],
  ];
  return {
    outline, body,
    porch: { x0: px0, x1: wingX0, f0: D / 2 + s, f1: D / 2 + depth + s, type: "shed" },
    door: { x: doorX, f: D / 2 + s, w: 3 },
    main: { f0: -D / 2 + s, f1: D / 2 + s }, wingX0,
  };
}

export const footprintFt = (m) => geometryFt(m).outline;
export const doorFt = (m) => geometryFt(m).door;

export const STYLES = [
  { id: "cottage", name: "Cottage Gray", swatch: "#6b7380" },
  { id: "sage", name: "Sage Batten", swatch: "#8c9a6b" },
  { id: "craftsman", name: "Tan Craftsman", swatch: "#c2b28f" },
];

export const FILTERS = [
  { id: "all", name: "All", test: () => true },
  { id: "small", name: "Under 500 sq ft", test: (m) => m.sqft < 500 },
  { id: "one", name: "1 bed", test: (m) => m.beds === 1 },
  { id: "two", name: "2 bed", test: (m) => m.beds === 2 },
  { id: "ell", name: "L-shaped", test: (m) => m.shape === "L" },
];

export function modelSrc(modelId, styleId) {
  return `/models/${modelId}-${styleId}.glb`;
}
