// Small geometry helpers. Everything is done in a local flat frame (meters, x = east,
// y = north) around an origin point; at lot scale the error is negligible.

export const FT = 0.3048;
const R = 6378137;

export function makeProjector(origin) {
  const lat0 = (origin.lat * Math.PI) / 180;
  const kx = (Math.PI / 180) * R * Math.cos(lat0);
  const ky = (Math.PI / 180) * R;
  return {
    toXY: (lat, lng) => [(lng - origin.lng) * kx, (lat - origin.lat) * ky],
    toLatLng: (x, y) => ({ lat: origin.lat + y / ky, lng: origin.lng + x / kx }),
  };
}

// Lot ring as [[lng, lat], ...] -> centroid {lat, lng}
export function ringCentroid(ring) {
  const pts = closedOpen(ring);
  let lat = 0, lng = 0;
  for (const [x, y] of pts) { lng += x; lat += y; }
  return { lat: lat / pts.length, lng: lng / pts.length };
}

export function closedOpen(ring) {
  const r = ring.slice();
  if (r.length > 1) {
    const a = r[0], b = r[r.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) r.pop();
  }
  return r;
}

export function areaM2(xy) {
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// Place a footprint (points [x right, f forward] in meters) at (cx, cy) on the map frame.
// heading = compass direction (deg) the front door faces.
export function placeXY(ptsM, cx, cy, heading) {
  const t = (heading * Math.PI) / 180;
  const f = [Math.sin(t), Math.cos(t)];   // forward (front)
  const r = [Math.cos(t), -Math.sin(t)];  // right
  return ptsM.map(([a, b]) => [cx + r[0] * a + f[0] * b, cy + r[1] * a + f[1] * b]);
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
function segmentsCross(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Does the ADU sit fully inside the lot, and how close does it get to a property line?
export function checkFit(lotXY, aduXY) {
  const cornersInside = aduXY.every((p) => pointInPolygon(p, lotXY));
  let crosses = false;
  for (let i = 0; i < aduXY.length && !crosses; i++) {
    const a = aduXY[i], b = aduXY[(i + 1) % aduXY.length];
    for (let j = 0; j < lotXY.length; j++) {
      if (segmentsCross(a, b, lotXY[j], lotXY[(j + 1) % lotXY.length])) { crosses = true; break; }
    }
  }
  const inside = cornersInside && !crosses;
  let clearance = Infinity;
  for (const p of aduXY) {
    for (let j = 0; j < lotXY.length; j++) clearance = Math.min(clearance, segDist(p, lotXY[j], lotXY[(j + 1) % lotXY.length]));
  }
  for (const p of lotXY) {
    if (!pointInPolygon(p, aduXY)) {
      for (let i = 0; i < aduXY.length; i++) clearance = Math.min(clearance, segDist(p, aduXY[i], aduXY[(i + 1) % aduXY.length]));
    }
  }
  return { inside, clearanceM: inside ? clearance : 0 };
}

// Suggest a starting spot: away from the street-side point (where the house usually is),
// facing back toward the house. Falls back to the lot centroid.
export function suggestPlacement(lotXY, footprintM, housePointXY, minClearM) {
  const cx = lotXY.reduce((s, p) => s + p[0], 0) / lotXY.length;
  const cy = lotXY.reduce((s, p) => s + p[1], 0) / lotXY.length;
  let dir = [0, -1];
  if (housePointXY) {
    const v = [cx - housePointXY[0], cy - housePointXY[1]];
    const l = Math.hypot(...v);
    if (l > 0.5) dir = [v[0] / l, v[1] / l];
  }
  const facing = ((Math.atan2(-dir[0], -dir[1]) * 180) / Math.PI + 360) % 360; // face the house
  // Square the ADU to the lot: use the longest lot edge as the reference angle.
  let edge = 0, longest = 0;
  for (let i = 0; i < lotXY.length; i++) {
    const a = lotXY[i], b = lotXY[(i + 1) % lotXY.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longest) { longest = len; edge = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI; }
  }
  const angDiff = (p, q) => Math.abs(((p - q + 540) % 360) - 180);
  const options = [0, 90, 180, 270].map((k) => (((edge + k) % 360) + 360) % 360)
    .sort((p, q) => angDiff(p, facing) - angDiff(q, facing));
  const preferred = options[0];

  let best = { x: cx, y: cy, heading: preferred, score: -Infinity };
  for (const clear of [Math.max(minClearM, 6 * FT), minClearM]) {
    for (const h of options.slice(0, 3)) {
      for (let s = 0; s <= 60; s += 0.5) {
        const x = cx + dir[0] * s, y = cy + dir[1] * s;
        const fit = checkFit(lotXY, placeXY(footprintM, x, y, h));
        if (!fit.inside) break;
        if (fit.clearanceM >= clear) {
          // go as far back as possible; strongly prefer the door facing the house
          const score = s - angDiff(h, preferred) / 10;
          if (score > best.score) best = { x, y, heading: Math.round(h * 10) / 10, score };
        }
      }
    }
    if (best.score > -Infinity) break;
  }
  return best;
}
