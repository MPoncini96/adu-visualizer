"use client";
// Google satellite map with the lot outline and a draggable ADU footprint.
import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "../lib/googleMaps.js";
import { aduCornersXY } from "../lib/geo.js";

const FIT_COLORS = { ok: "#2fbf71", tight: "#f2a93b", bad: "#e5484d" };

export default function MapEditor({ projector, origin, lotRing, adu, dims, status, tracing, tracePts, onAduMove, onMapClick, onError }) {
  const divRef = useRef(null);
  const g = useRef({}); // google objects
  const dragging = useRef(false);
  const cb = useRef({});
  cb.current = { onAduMove, onMapClick, projector };

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

        const centerOfPath = () => {
          const path = aduPoly.getPath().getArray();
          const lat = path.reduce((s, p) => s + p.lat(), 0) / path.length;
          const lng = path.reduce((s, p) => s + p.lng(), 0) / path.length;
          return cb.current.projector.toXY(lat, lng);
        };
        aduPoly.addListener("dragstart", () => (dragging.current = true));
        aduPoly.addListener("drag", () => {
          const [x, y] = centerOfPath();
          cb.current.onAduMove({ x, y, live: true });
        });
        aduPoly.addListener("dragend", () => {
          dragging.current = false;
          const [x, y] = centerOfPath();
          cb.current.onAduMove({ x, y });
        });
        map.addListener("click", (e) => {
          const [x, y] = cb.current.projector.toXY(e.latLng.lat(), e.latLng.lng());
          cb.current.onMapClick({ x, y, lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        g.current = { map, lot, aduPoly, door, trace };
        divRef.current.dispatchEvent(new Event("gmaps-ready"));
      })
      .catch((e) => onError?.(e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep overlays in sync with state
  useEffect(() => {
    const sync = () => {
      const { map, lot, aduPoly, door, trace } = g.current;
      if (!map) return;
      lot.setPath((lotRing || []).map(([lng, lat]) => ({ lat, lng })));
      trace.setPath((tracePts || []).map(({ lat, lng }) => ({ lat, lng })));
      if (adu && dims && projector) {
        const c = aduCornersXY(adu.x, adu.y, dims.w, dims.d, adu.heading);
        const ll = c.map(([x, y]) => projector.toLatLng(x, y));
        if (!dragging.current) aduPoly.setPath(ll);
        aduPoly.setOptions({ fillColor: FIT_COLORS[status] || FIT_COLORS.ok, visible: !tracing });
        // door marker: middle third of the front edge
        const [fl, fr] = c;
        const a = [fl[0] + (fr[0] - fl[0]) / 3, fl[1] + (fr[1] - fl[1]) / 3];
        const b = [fl[0] + (2 * (fr[0] - fl[0])) / 3, fl[1] + (2 * (fr[1] - fl[1])) / 3];
        door.setPath([projector.toLatLng(...a), projector.toLatLng(...b)]);
        door.setVisible(!tracing);
      }
    };
    sync();
    const el = divRef.current;
    el?.addEventListener("gmaps-ready", sync);
    return () => el?.removeEventListener("gmaps-ready", sync);
  }, [lotRing, adu, dims, status, projector, tracing, tracePts]);

  // Re-center when the location changes
  useEffect(() => {
    const { map } = g.current;
    if (map && origin) { map.panTo(origin); map.setZoom(20); }
    const el = divRef.current;
    const onReady = () => { g.current.map?.setCenter(origin); };
    el?.addEventListener("gmaps-ready", onReady);
    return () => el?.removeEventListener("gmaps-ready", onReady);
  }, [origin?.lat, origin?.lng]);

  return <div ref={divRef} className="map-canvas" aria-label="Satellite map of the lot" />;
}
