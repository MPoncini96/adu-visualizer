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
      if (parcel) return Response.json({ parcel });
    } catch {
      // fall through to the next county / trace mode
    }
  }
  return Response.json({ parcel: null });
}
