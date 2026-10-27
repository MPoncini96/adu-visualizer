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

export function centroidXY(xy) {
  return [xy.reduce((s, p) => s + p[0], 0) / xy.length, xy.reduce((s, p) => s + p[1], 0) / xy.length];
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
function edgesCross(P, Q) {
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    for (let j = 0; j < Q.length; j++) if (segmentsCross(a, b, Q[j], Q[(j + 1) % Q.length])) return true;
  }
  return false;
}

// Is polygon A entirely inside polygon B?
export function insidePolygon(A, B) {
  return A.every((p) => pointInPolygon(p, B)) && !edgesCross(A, B);
}

export function polygonsOverlap(A, B) {
  return A.some((p) => pointInPolygon(p, B)) || B.some((p) => pointInPolygon(p, A)) || edgesCross(A, B);
}

// Shortest distance between two polygons' outlines (0 if they overlap)
export function polygonDistance(A, B) {
  if (polygonsOverlap(A, B)) return 0;
  let d = Infinity;
  for (const p of A) for (let j = 0; j < B.length; j++) d = Math.min(d, segDist(p, B[j], B[(j + 1) % B.length]));
  for (const p of B) for (let i = 0; i < A.length; i++) d = Math.min(d, segDist(p, A[i], A[(i + 1) % A.length]));
  return d;
}

// Distance from the ADU to the closest lot line (assumes it's inside)
export function lotClearance(lotXY, aduXY) {
  let d = Infinity;
  for (const p of aduXY) for (let j = 0; j < lotXY.length; j++) d = Math.min(d, segDist(p, lotXY[j], lotXY[(j + 1) % lotXY.length]));
  for (const p of lotXY) for (let i = 0; i < aduXY.length; i++) d = Math.min(d, segDist(p, aduXY[i], aduXY[(i + 1) % aduXY.length]));
  return d;
}

// Full fit check: lot line is a hard boundary; structures give warnings.
export function checkFit(lotXY, aduXY, structuresXY = []) {
  const inside = insidePolygon(aduXY, lotXY);
  const lotClearM = inside ? lotClearance(lotXY, aduXY) : 0;
  let overlapIdx = -1, nearestM = Infinity, nearestIdx = -1;
  structuresXY.forEach((s, i) => {
    const d = polygonDistance(aduXY, s);
    if (d === 0 && overlapIdx < 0) overlapIdx = i;
    if (d < nearestM) { nearestM = d; nearestIdx = i; }
  });
  return { inside, lotClearM, overlapIdx, nearestM, nearestIdx };
}

// Which lot edge faces the street? Lot lines with no neighboring parcel just across them face
// the street (or open land). Among those, prefer the one nearest the address point unless
// another is much longer. Falls back to the edge nearest the hint. Returns { index } or null.
export function findStreetEdge(lotXY, neighborsXY = [], hintXY = null) {
  if (!lotXY?.length) return null;
  const c = centroidXY(lotXY);
  const open = [];
  if (neighborsXY.length) {
    for (let i = 0; i < lotXY.length; i++) {
      const a = lotXY[i], b = lotXY[(i + 1) % lotXY.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 3) continue;
      let n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if ((mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];
      const probe = [mid[0] + n[0] * 2.5, mid[1] + n[1] * 2.5];
      const neighbor = neighborsXY.some((nb) => pointInPolygon(probe, nb) && !pointInPolygon(c, nb));
      if (!neighbor) open.push({ index: i, len, d: hintXY ? segDist(hintXY, a, b) : 0 });
    }
  }
  if (open.length) {
    open.sort((p, q) => (p.d - q.d) || (q.len - p.len));
    const best = open.reduce((acc, e) => (e.len > acc.len * 1.6 ? e : acc), open[0]);
    return { index: best.index };
  }
  if (hintXY) {
    let best = null;
    for (let i = 0; i < lotXY.length; i++) {
      const d = segDist(hintXY, lotXY[i], lotXY[(i + 1) % lotXY.length]);
      if (!best || d < best.d) best = { index: i, d };
    }
    return { index: best.index };
  }
  return null;
}

// Unit vector pointing from the street edge into the lot (toward the back yard)
export function rearDirection(lotXY, streetEdge) {
  if (!streetEdge) return null;
  const a = lotXY[streetEdge.index], b = lotXY[(streetEdge.index + 1) % lotXY.length];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  let n = [-dy / l, dx / l];
  const c = centroidXY(lotXY), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if ((c[0] - mid[0]) * n[0] + (c[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return n;
}

const angDiff = (p, q) => Math.abs(((p - q + 540) % 360) - 180);

// Lot-aligned headings (deg), ordered by closeness to `facing`
export function alignedHeadings(lotXY, facing = 0) {
  let edge = 0, longest = 0;
  for (let i = 0; i < lotXY.length; i++) {
    const a = lotXY[i], b = lotXY[(i + 1) % lotXY.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longest) { longest = len; edge = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI; }
  }
  return [0, 90, 180, 270]
    .map((k) => Math.round(((((edge + k) % 360) + 360) % 360) * 10) / 10)
    .sort((p, q) => angDiff(p, facing) - angDiff(q, facing));
}

// Default spot: the most open part of the back yard. Scores every candidate position by
// distance from existing buildings, distance from the lot lines, and how far back it sits.
export function suggestPlacement(lotXY, footprintM, { rear = null, structuresXY = [] } = {}) {
  const c = centroidXY(lotXY);
  const back = rear || [0, 1];
  const facing = ((Math.atan2(-back[0], -back[1]) * 180) / Math.PI + 360) % 360; // door faces the house/street
  const headings = alignedHeadings(lotXY, facing).slice(0, 2);
  const xs = lotXY.map((p) => p[0]), ys = lotXY.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const step = Math.max(0.5, span / 70);
  const depth = Math.max(...lotXY.map((p) => (p[0] - c[0]) * back[0] + (p[1] - c[1]) * back[1]));

  let best = null;
  for (const h of headings) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
        if (!pointInPolygon([x, y], lotXY)) continue;
        const poly = placeXY(footprintM, x, y, h);
        if (!insidePolygon(poly, lotXY)) continue;
        let near = 6;
        let overlaps = false;
        for (const s of structuresXY) {
          const d = polygonDistance(poly, s);
          if (d === 0) { overlaps = true; break; }
          near = Math.min(near, d);
        }
        if (overlaps) continue;
        const clear = lotClearance(lotXY, poly);
        const rearness = depth > 0 ? ((x - c[0]) * back[0] + (y - c[1]) * back[1]) / depth : 0;
        const score = 3 * Math.min(near, 3.05) + 1.5 * Math.min(clear, 1.5) + 2 * rearness - angDiff(h, facing) / 90;
        if (!best || score > best.score) best = { x, y, heading: h, score };
      }
    }
  }
  if (best) return best;
  return { x: c[0], y: c[1], heading: headings[0], score: -Infinity, noFit: true };
}

// Slide a placement toward the lot center until it fits inside (used after rotating).
export function nudgeInside(lotXY, footprintM, x, y, heading) {
  const c = centroidXY(lotXY);
  const dx = c[0] - x, dy = c[1] - y, l = Math.hypot(dx, dy) || 1;
  for (let s = 0; s <= l + 0.01; s += 0.25) {
    const nx = x + (dx / l) * s, ny = y + (dy / l) * s;
    if (insidePolygon(placeXY(footprintM, nx, ny, heading), lotXY)) return { x: nx, y: ny, heading };
  }
  return null;
}
