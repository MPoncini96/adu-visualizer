"use client";
// Google satellite map with the lot outline and a draggable ADU footprint.
import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "../lib/googleMaps.js";

const FIT_COLORS = { ok: "#2fbf71", tight: "#f2a93b", bad: "#e5484d" };

// A big rectangle around the lot with the lot cut out as a hole (holes need opposite winding).
function maskPaths(ring) {
  const pts = ring.map(([lng, lat]) => ({ lat, lng }));
  const c = pts.reduce((a, p) => ({ lat: a.lat + p.lat / pts.length, lng: a.lng + p.lng / pts.length }), { lat: 0, lng: 0 });
  const d = 1.5;
  const outer = [
    { lat: c.lat + d, lng: c.lng - d }, { lat: c.lat + d, lng: c.lng + d },
    { lat: c.lat - d, lng: c.lng + d }, { lat: c.lat - d, lng: c.lng - d },
  ]; // clockwise
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.lng * b.lat - b.lng * a.lat;
  }
  const hole = area < 0 ? pts.slice().reverse() : pts; // counter-clockwise
  return [outer, hole];
}

export default function MapEditor({ visible = true, projector, origin, lotRing, structures = [], adu, aduXY, doorXY, status, tracing, tracePts, onAduMove, onMapClick, onError }) {
  const divRef = useRef(null);
  const g = useRef({}); // google objects
  const dragging = useRef(false);
  const cb = useRef({});
  cb.current = { onAduMove, onMapClick, projector, adu };
  const dragStart = useRef(null);

  // Create the map once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async () => {
        if (cancelled) return;
        const { Map, Polygon, Polyline } = await google.maps.importLibrary("maps");
        const map = new Map(divRef.current, {
          center: origin,
          zoom: 20,
          mapTypeId: "satellite",
          tilt: 0,
          heading: 0,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        const lot = new Polygon({ map, clickable: false, strokeColor: "#ffd84d", strokeWeight: 3, fillColor: "#ffd84d", fillOpacity: 0.06, zIndex: 1 });
        const aduPoly = new Polygon({ map, draggable: true, strokeColor: "#ffffff", strokeWeight: 2, fillOpacity: 0.55, zIndex: 3, cursor: "move" });
        const door = new Polyline({ map, clickable: false, strokeColor: "#ffffff", strokeWeight: 7, zIndex: 4 });
        const trace = new Polyline({ map, clickable: false, strokeColor: "#ffd84d", strokeWeight: 3, zIndex: 2, icons: [] });

        // Average of the path's vertices; we move the ADU by how much this average moves.
        const avgOfPath = () => {
          const path = aduPoly.getPath().getArray();
          const lat = path.reduce((s, p) => s + p.lat(), 0) / path.length;
          const lng = path.reduce((s, p) => s + p.lng(), 0) / path.length;
          return cb.current.projector.toXY(lat, lng);
        };
        const centerOfPath = () => {
          const [ax, ay] = avgOfPath();
          const st = dragStart.current;
          return st ? [st.cx + ax - st.ax, st.cy + ay - st.ay] : [ax, ay];
        };
        aduPoly.addListener("dragstart", () => {
          dragging.current = true;
          const [ax, ay] = avgOfPath();
          dragStart.current = { ax, ay, cx: cb.current.adu.x, cy: cb.current.adu.y };
        });
        aduPoly.addListener("drag", () => {
          const [x, y] = centerOfPath();
          cb.current.onAduMove({ x, y, live: true });
        });
        aduPoly.addListener("dragend", () => {
          dragging.current = false;
          const [x, y] = centerOfPath();
          dragStart.current = null;
          cb.current.onAduMove({ x, y });
        });
        map.addListener("click", (e) => {
          const [x, y] = cb.current.projector.toXY(e.latLng.lat(), e.latLng.lng());
          cb.current.onMapClick({ x, y, lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        // Everything outside the lot is covered so only the property shows
        const mask = new Polygon({ map, clickable: false, strokeWeight: 0, fillColor: "#e6e9df", fillOpacity: 1, zIndex: 0 });
        g.current = { map, lot, aduPoly, door, trace, mask };
        divRef.current.dispatchEvent(new Event("gmaps-ready"));
      })
      .catch((e) => onError?.(e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep overlays in sync with state
  useEffect(() => {
    const sync = () => {
      const { map, lot, aduPoly, door, trace, mask } = g.current;
      if (!map) return;
      lot.setPath((lotRing || []).map(([lng, lat]) => ({ lat, lng })));
      mask.setPaths(lotRing?.length > 2 ? maskPaths(lotRing) : []);
      trace.setPath((tracePts || []).map(({ lat, lng }) => ({ lat, lng })));
      if (!aduXY) { aduPoly.setVisible(false); door.setVisible(false); }
      if (aduXY && projector) {
        if (!dragging.current) aduPoly.setPath(aduXY.map(([x, y]) => projector.toLatLng(x, y)));
        aduPoly.setOptions({ fillColor: FIT_COLORS[status] || FIT_COLORS.ok, visible: !tracing, draggable: !tracing });
        door.setPath(doorXY.map(([x, y]) => projector.toLatLng(x, y)));
        door.setVisible(!tracing && !dragging.current);
      }
    };
    sync();
    const el = divRef.current;
    el?.addEventListener("gmaps-ready", sync);
    return () => el?.removeEventListener("gmaps-ready", sync);
  }, [lotRing, aduXY, doorXY, status, projector, tracing, tracePts]);

  // Zoom to fit the lot whenever a new one loads
  useEffect(() => {
    const fit = () => {
      const { map } = g.current;
      if (!map || !lotRing?.length) return;
      const b = new google.maps.LatLngBounds();
      lotRing.forEach(([lng, lat]) => b.extend({ lat, lng }));
      map.fitBounds(b, 40);
    };
    fit();
    const el = divRef.current;
    el?.addEventListener("gmaps-ready", fit);
    return () => el?.removeEventListener("gmaps-ready", fit);
  }, [lotRing]);

  // The map stays mounted while the site plan is shown (unmounting it lost the imagery).
  // When it becomes visible again, nudge it to redraw its tiles.
  useEffect(() => {
    const { map } = g.current;
    if (!visible || !map) return;
    const c = map.getCenter();
    requestAnimationFrame(() => {
      google.maps.event.trigger(map, "resize");
      if (c) map.setCenter(c);
    });
  }, [visible]);

  // Re-center when the location changes
  useEffect(() => {
    const { map } = g.current;
    // With a lot loaded, the fit-to-lot effect handles framing; this is for tracing a new lot
    if (map && origin && !lotRing?.length) { map.panTo(origin); map.setZoom(20); }
    const el = divRef.current;
    const onReady = () => { if (!lotRing?.length) g.current.map?.setCenter(origin); };
    el?.addEventListener("gmaps-ready", onReady);
    return () => el?.removeEventListener("gmaps-ready", onReady);
  }, [origin?.lat, origin?.lng]);

  return (
    <div
      ref={divRef}
      className="map-canvas"
      aria-label="Satellite map of the lot"
      aria-hidden={!visible}
      style={visible ? undefined : { visibility: "hidden", pointerEvents: "none" }}
    />
  );
}
