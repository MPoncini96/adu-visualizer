// Service area: within MAX_MILES of Highway 99 between Lodi and Fresno.
// The line is a simplified trace of 99 through the Valley towns (good to ~1 mile).

export const MAX_MILES = 40;

export const HWY99 = [
  [38.165, -121.276], // north of Lodi
  [38.130, -121.272], // Lodi
  [38.020, -121.282], // north Stockton
  [37.955, -121.268], // Stockton
  [37.885, -121.245], // French Camp
  [37.800, -121.212], // Manteca
  [37.737, -121.125], // Ripon
  [37.690, -121.060], // Salida
  [37.640, -120.995], // Modesto
  [37.555, -120.935], // Keyes
  [37.495, -120.856], // Turlock
  [37.405, -120.715], // Delhi / Livingston
  [37.350, -120.610], // Atwater
  [37.300, -120.480], // Merced
  [37.200, -120.330], // Le Grand turnoff
  [37.120, -120.260], // Chowchilla
  [36.960, -120.060], // Madera
  [36.860, -119.880], // Herndon
  [36.745, -119.795], // Fresno
  [36.690, -119.740], // south Fresno
];

export const SERVICE_BOUNDS = { south: 36.1, north: 38.75, west: -122.35, east: -118.95 };

const MI = 1609.344;

function project(lat0) {
  const k = Math.PI / 180, R = 6378137;
  return (lat, lng) => [lng * k * R * Math.cos(lat0 * k), lat * k * R];
}

export function milesFromHwy99(lat, lng) {
  const P = project(lat);
  const p = P(lat, lng);
  let best = Infinity;
  for (let i = 0; i < HWY99.length - 1; i++) {
    const a = P(...HWY99[i]), b = P(...HWY99[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best / MI;
}

export function inServiceArea(lat, lng) {
  return milesFromHwy99(lat, lng) <= MAX_MILES;
}
