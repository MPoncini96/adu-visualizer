// Ground elevation (meters above sea level) from the USGS Elevation Point Query Service.
// The 3D map needs it to aim the camera at ground level. Falls back to a Valley-floor estimate.

// Rough Valley-floor elevation by latitude along Highway 99 (Lodi ~15 m ... Fresno ~95 m)
export function valleyFloorEstimate(lat) {
  const pts = [[38.13, 15], [37.95, 4], [37.80, 10], [37.64, 27], [37.49, 31], [37.30, 52], [36.96, 82], [36.75, 94]];
  if (lat >= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, ea] = pts[i], [b, eb] = pts[i + 1];
    if (lat <= a && lat >= b) return ea + ((a - lat) / (a - b)) * (eb - ea);
  }
  return pts[pts.length - 1][1];
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ error: "lat and lng are required" }, { status: 400 });
  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&units=Meters&includeDate=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), next: { revalidate: 604800 } });
    const data = await res.json();
    const v = Number(data?.value);
    if (Number.isFinite(v) && v > -100) return Response.json({ elevation: v, source: "USGS" });
  } catch {}
  return Response.json({ elevation: valleyFloorEstimate(lat), source: "estimate" });
}
