// Looks up the parcel boundary at a point from the county's public GIS service.
// Only the boundary, APN and lot size are returned - never owner or mailing info.
import { inServiceArea } from "../../../lib/serviceArea.js";

const COUNTIES = [
  {
    name: "San Joaquin",
    url: "https://services2.arcgis.com/GQhSReJEO6f7tsvy/arcgis/rest/services/Parcels/FeatureServer/0/query",
    fields: "APN,LANDSIZE_SQFT",
    bbox: [37.45, 38.35, -121.6, -120.9], // south, north, west, east
  },
  {
    name: "Fresno",
    url: "https://gisprod10.co.fresno.ca.us/server/rest/services/FC_PARCEL_SELECT/MapServer/0/query",
    fields: "APN",
    bbox: [35.9, 37.6, -120.95, -118.3],
  },
  // Stanislaus, Merced and Madera: no public parcel service wired up yet ->
  // the app asks the visitor to trace their lot on the map instead.
];

async function queryCounty(c, lat, lng) {
  const params = new URLSearchParams({
    f: "geojson",
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: c.fields,
    returnGeometry: "true",
    outSR: "4326",
  });
  const res = await fetch(`${c.url}?${params}`, { signal: AbortSignal.timeout(8000), next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const data = await res.json();
  const f = data?.features?.[0];
  if (!f?.geometry) return null;
  const g = f.geometry;
  let ring = null;
  if (g.type === "Polygon") ring = g.coordinates[0];
  if (g.type === "MultiPolygon") {
    // take the largest piece
    ring = g.coordinates.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  }
  if (!ring) return null;
  return {
    county: c.name,
    apn: f.properties?.APN ?? null,
    lotSqft: f.properties?.LANDSIZE_SQFT ?? null,
    ring,
  };
}

// Building footprints: FEMA "USA Structures" (public domain, nationwide)
const FEMA = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query";

function bboxOf(ring, padDeg) {
  const lats = ring.map((p) => p[1]), lngs = ring.map((p) => p[0]);
  return [Math.min(...lngs) - padDeg, Math.min(...lats) - padDeg, Math.max(...lngs) + padDeg, Math.max(...lats) + padDeg];
}

async function femaStructures(ring) {
  const [w, s, e, n] = bboxOf(ring, 0.0001);
  const params = new URLSearchParams({
    f: "geojson", geometry: `${w},${s},${e},${n}`, geometryType: "esriGeometryEnvelope", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "OCC_CLS,SQFEET", returnGeometry: "true", outSR: "4326",
  });
  const res = await fetch(`${FEMA}?${params}`, { signal: AbortSignal.timeout(7000), next: { revalidate: 86400 } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || [])
    .filter((f) => f.geometry?.type === "Polygon")
    .map((f) => ({ ring: f.geometry.coordinates[0], kind: "building", source: "FEMA USA Structures", sqft: f.properties?.SQFEET ?? null }));
}

// Neighboring parcels from the same county layer. A lot line with no neighbor across it
// faces the street (or open land), which tells us where the front of the lot is.
async function neighborParcels(c, ring) {
  if (!c) return [];
  const [w, s, e, n] = bboxOf(ring, 0.00025);
  const params = new URLSearchParams({
    f: "geojson", geometry: `${w},${s},${e},${n}`, geometryType: "esriGeometryEnvelope", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "APN", returnGeometry: "true", outSR: "4326",
  });
  const res = await fetch(`${c.url}?${params}`, { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features || []).filter((f) => f.geometry?.type === "Polygon").map((f) => f.geometry.coordinates[0]);
}

function countyFor(lng, lat) {
  return COUNTIES.find((c) => { const [s, n, w, e] = c.bbox; return lat >= s && lat <= n && lng >= w && lng <= e; });
}

async function siteContext(ring) {
  const c0 = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
  const [fema, nb] = await Promise.allSettled([femaStructures(ring), neighborParcels(countyFor(c0[0], c0[1]), ring)]);
  return {
    structures: fema.status === "fulfilled" ? fema.value : [],
    neighbors: nb.status === "fulfilled" ? nb.value : [],
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat and lng are required" }, { status: 400 });
  }
  if (!inServiceArea(lat, lng)) return Response.json({ parcel: null, outOfArea: true });

  for (const c of COUNTIES) {
    const [s, n, w, e] = c.bbox;
    if (lat < s || lat > n || lng < w || lng > e) continue;
    try {
      const parcel = await queryCounty(c, lat, lng);
      if (parcel) {
        const site = await siteContext(parcel.ring);
        return Response.json({ parcel, ...site });
      }
    } catch {
      // fall through to the next county / trace mode
    }
  }
  return Response.json({ parcel: null });
}

// Site context for a lot the visitor traced (or the demo lot): POST { ring }
export async function POST(req) {
  try {
    const { ring } = await req.json();
    if (!Array.isArray(ring) || ring.length < 3) return Response.json({ error: "ring required" }, { status: 400 });
    return Response.json(await siteContext(ring.slice(0, 200)));
  } catch {
    return Response.json({ structures: [], neighbors: [] });
  }
}
