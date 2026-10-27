// The placeholder ADU plans. Dimensions are exterior footprint in feet.
// Swap these for the builder's real plans later; everything else reads from here.
//
// Footprint coordinates: x = feet to the right, f = feet forward (toward the front door),
// centered on the footprint's bounding box.

const rect = (W, D) => ({ shape: "rect", W, D });
// L: main body W x D, plus a wing (ww wide, wd deep) projecting forward on the right side.
const ell = (W, D, ww, wd) => ({ shape: "L", W, D, ww, wd });

export const MODELS = [
  { id: "pocket", name: "The Pocket", kind: "Micro studio", beds: 0, baths: 1, ...rect(12, 20), blurb: "A compact backyard studio. Office, guest room or a starter rental on a tight lot." },
  { id: "lathrop", name: "The Lathrop", kind: "Studio", beds: 0, baths: 1, ...rect(16, 22), blurb: "Open studio with a kitchenette and full bath. Fits behind most garages." },
  { id: "ripon", name: "The Ripon", kind: "1 bed / 1 bath", beds: 1, baths: 1, ...rect(20, 24), blurb: "A true one-bedroom in under 500 sq ft. The best value per square foot." },
  { id: "escalon", name: "The Escalon", kind: "1 bed / 1 bath", beds: 1, baths: 1, ...rect(22, 28), blurb: "Roomier one-bedroom with space for a dining table. The most popular rental size." },
  { id: "lodi", name: "The Lodi", kind: "1 bed / 1 bath · L-shape", beds: 1, baths: 1, ...ell(24, 20, 12, 10), blurb: "L-shaped one-bedroom with a covered entry tucked into the corner." },
  { id: "manteca", name: "The Manteca", kind: "2 bed / 1 bath", beds: 2, baths: 1, ...rect(24, 32), blurb: "Room for a small family or aging parents. Fits most Valley lots." },
  { id: "oakdale", name: "The Oakdale", kind: "2 bed / 1 bath · L-shape", beds: 2, baths: 1, ...ell(30, 22, 14, 12), blurb: "Two bedrooms in an L that wraps a private patio. Great on wide, shallow yards." },
  { id: "delta", name: "The Delta", kind: "2 bed / 2 bath", beds: 2, baths: 2, ...rect(28, 40), blurb: "Full-size second home for larger lots and farm parcels." },
  { id: "kingsburg", name: "The Kingsburg", kind: "2 bed / 2 bath · L-shape", beds: 2, baths: 2, ...ell(34, 26, 16, 14), blurb: "Our largest plan. Split bedrooms, two baths and a covered porch." },
  { id: "conversion", name: "The Conversion", kind: "Garage conversion", beds: 1, baths: 1, ...rect(20, 22), blurb: "Turn an existing two-car garage into a one-bedroom unit." },
].map((m) => ({ ...m, sqft: sqftOf(m), ...bboxOf(m) }));

function sqftOf(m) {
  return m.shape === "L" ? m.W * m.D + m.ww * m.wd : m.W * m.D;
}
function bboxOf(m) {
  return { widthFt: m.W, depthFt: m.shape === "L" ? m.D + m.wd : m.D };
}

// Outline polygon (feet), counter-clockwise, centered on the bounding box.
export function footprintFt(m) {
  if (m.shape !== "L") {
    const w = m.W / 2, d = m.D / 2;
    return [[-w, -d], [w, -d], [w, d], [-w, d]];
  }
  const { W, D, ww, wd } = m;
  const s = -wd / 2; // shift forward so the bbox is centered
  return [
    [-W / 2, -D / 2 + s],
    [W / 2, -D / 2 + s],
    [W / 2, D / 2 + wd + s],
    [W / 2 - ww, D / 2 + wd + s],
    [W / 2 - ww, D / 2 + s],
    [-W / 2, D / 2 + s],
  ];
}

// Front door position on the outline (feet): {x, f, w}
export function doorFt(m) {
  if (m.shape === "L") {
    const s = -m.wd / 2;
    return { x: (-m.W / 2 + (m.W / 2 - m.ww)) / 2, f: m.D / 2 + s, w: 3 };
  }
  return { x: m.W >= 16 ? -m.W * 0.18 : 0, f: m.D / 2, w: 3 };
}

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
