// The five placeholder ADU plans. Dimensions are exterior footprint in feet.
// Swap these for the builder's real plans later; everything else reads from here.

export const MODELS = [
  {
    id: "studio",
    name: "The Lathrop",
    kind: "Studio",
    beds: 0,
    baths: 1,
    sqft: 400,
    widthFt: 20,
    depthFt: 20,
    blurb: "Open studio with kitchenette. Great home office, guest suite or rental.",
  },
  {
    id: "one-bed",
    name: "The Ripon",
    kind: "1 bed / 1 bath",
    beds: 1,
    baths: 1,
    sqft: 600,
    widthFt: 20,
    depthFt: 30,
    blurb: "Separate bedroom and full kitchen. The most popular rental size.",
  },
  {
    id: "two-bed",
    name: "The Manteca",
    kind: "2 bed / 1 bath",
    beds: 2,
    baths: 1,
    sqft: 800,
    widthFt: 25,
    depthFt: 32,
    blurb: "Room for a small family or aging parents. Fits most Valley lots.",
  },
  {
    id: "two-bed-two-bath",
    name: "The Delta",
    kind: "2 bed / 2 bath",
    beds: 2,
    baths: 2,
    sqft: 1120,
    widthFt: 28,
    depthFt: 40,
    blurb: "Full-size second home for larger lots and farm parcels.",
  },
  {
    id: "garage",
    name: "The Conversion",
    kind: "Garage conversion / attached",
    beds: 1,
    baths: 1,
    sqft: 450,
    widthFt: 18,
    depthFt: 25,
    blurb: "Turn an existing garage or attached space into a 1-bed unit.",
  },
];

export const STYLES = [
  { id: "modern", name: "Modern" },
  { id: "farmhouse", name: "Farmhouse" },
];

export function modelSrc(modelId, styleId) {
  return `/models/${modelId}-${styleId}.glb`;
}
