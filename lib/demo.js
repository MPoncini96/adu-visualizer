// Example lot used to open the demo: a typical ~6,500 sq ft single-family lot in Manteca.
// Boundary is from San Joaquin County's public parcel layer. The street address is
// intentionally not shown in the app.
export const DEMO_LOT = {
  label: "Example lot · Manteca",
  source: "county",
  county: "San Joaquin",
  ring: [
    [-121.239834892689, 37.7899329006969],
    [-121.240059761739, 37.7899246244642],
    [-121.240074609737, 37.7901991723049],
    [-121.23984974102, 37.7902074512609],
  ],
  // Approximate spot of the main house (street side); used to suggest where the ADU goes.
  housePoint: null,
};
