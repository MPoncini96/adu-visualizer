"use client";
// Google satellite map with the lot outline and a draggable ADU footprint.
import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "../lib/googleMaps.js";

const FIT_COLORS = { ok: "#2fbf71", tight: "#f2a93b", bad: "#e5484d" };

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
        g.current = { map, lot, aduPoly, door, trace, Polygon, buildings: [] };
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
      // existing buildings / pools
      g.current.buildings.forEach((b) => b.setMap(null));
      g.current.buildings = structures.map((st) => new g.current.Polygon({
        map, clickable: false, zIndex: 2,
        paths: st.ring.map(([lng, lat]) => ({ lat, lng })),
        strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 1.5,
        fillColor: st.label === "Pool" ? "#5ab0ff" : "#ffffff", fillOpacity: 0.18,
      }));
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
  }, [lotRing, structures, aduXY, doorXY, status, projector, tracing, tracePts]);

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
    if (map && origin) { map.panTo(origin); map.setZoom(20); }
    const el = divRef.current;
    const onReady = () => { g.current.map?.setCenter(origin); };
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
