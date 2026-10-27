"use client";
// Google Photorealistic 3D view with the chosen ADU on the lot.
// Only mounted when the visitor clicks "View in 3D", so 3D tile usage stays low.
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../lib/googleMaps.js";

// Model orientation on the 3D map. glTF models are Y-up; Google's 3D map is Z-up.
// Override for tuning with ?o3d=heading,tilt,roll in the page URL.
function orientationOffsets() {
  const raw = typeof window !== "undefined" ? new URLSearchParams(location.search).get("o3d") : null;
  const [h = 0, t = 270, r = 0] = raw ? raw.split(",").map(Number) : [];
  return { h, t, r };
}

const HIGHLIGHT = "#ff7a1a";

// Newer Maps JS versions renamed coordinates -> path; set whichever the element has.
function setCoords(el, coords, polygon = false) {
  if ("path" in el) el.path = coords;
  else if (polygon) el.outerCoordinates = coords;
  else el.coordinates = coords;
}

export default function View3D({ position, heading, src, outline, heightM, overlap, onClose }) {
  const hostRef = useRef(null);
  const els = useRef({});
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("solid"); // solid | model
  const [hasModel, setHasModel] = useState(false);

  useEffect(() => {
    let map;
    let cancelled = false;
    loadGoogleMaps()
      .then(async () => {
        // The 3D camera works in meters above sea level, so aim it at the actual ground height
        let groundElev = 15;
        try {
          const r = await fetch(`/api/elevation?lat=${position.lat}&lng=${position.lng}`, { signal: AbortSignal.timeout(3500) });
          const j = await r.json();
          if (Number.isFinite(j.elevation)) groundElev = j.elevation;
        } catch {}
        const lib = await google.maps.importLibrary("maps3d");
        const { Map3DElement, Model3DElement, Polygon3DElement, Polyline3DElement } = lib;
        if (cancelled) return;
        const o = orientationOffsets();
        // Frame the ADU: ~45 degree tilt, far enough back to see the yard, looking at the front door
        map = new Map3DElement({
          center: { lat: position.lat, lng: position.lng, altitude: groundElev + heightM / 2 },
          range: 110,
          tilt: 45,
          heading: (heading + 180 + 20) % 360,
          mode: "HYBRID",
        });

        const ring = outline.map((p) => ({ lat: p.lat, lng: p.lng }));
        const closed = [...ring, ring[0]];

        const model = Model3DElement && new Model3DElement({
          src: new URL(src, location.origin).href,
          position: { lat: position.lat, lng: position.lng, altitude: 0 },
          altitudeMode: "CLAMP_TO_GROUND",
          orientation: { heading: (heading + o.h) % 360, tilt: o.t, roll: o.r },
          scale: 1,
        });

        // Solid massing box in a bright color; draws through buildings/trees that cover it
        const solid = new Polygon3DElement({
          altitudeMode: "RELATIVE_TO_GROUND",
          fillColor: "rgba(255, 122, 26, 0.75)",
          strokeColor: "#ffffff",
          strokeWidth: 3,
          extruded: true,
          drawsOccludedSegments: true,
        });
        setCoords(solid, ring.map((p) => ({ ...p, altitude: heightM })), true);

        // Outlines at the ground and at roof height, also drawn when hidden behind the 3D mesh
        const mkLine = (alt) => {
          const l = new Polyline3DElement({
            altitudeMode: "RELATIVE_TO_GROUND",
            strokeColor: HIGHLIGHT,
            strokeWidth: 6,
            outerColor: "#ffffff",
            outerWidth: 0.4,
            drawsOccludedSegments: true,
          });
          setCoords(l, closed.map((p) => ({ ...p, altitude: alt })));
          return l;
        };
        const ground = mkLine(0.3);
        const top = mkLine(heightM);

        map.append(solid, ground, top);
        setHasModel(!!model);
        els.current = { map, solid, model, ground, top };
        applyMode(els.current, "solid");
        hostRef.current.append(map);
      })
      .catch((e) => setError(e.message === "no-key" ? "The 3D view turns on once the Google Maps key is added." : "3D view couldn't load here."));
    return () => { cancelled = true; map?.remove(); };
  }, [position.lat, position.lng, heading, src, outline, heightM]);

  useEffect(() => { applyMode(els.current, mode); }, [mode]);

  return (
    <div className="view3d">
      <div ref={hostRef} className="view3d-host" />
      {error && <div className="view3d-msg">{error}</div>}
      {overlap && <div className="view3d-warn">Heads up: the ADU overlaps the existing {overlap.toLowerCase()}.</div>}
      <div className="view3d-toggle" role="group" aria-label="3D display">
        <button className={mode === "solid" ? "on" : ""} onClick={() => setMode("solid")}>Highlight</button>
        {hasModel && <button className={mode === "model" ? "on" : ""} onClick={() => setMode("model")}>House model</button>}
      </div>
      <div className="view3d-bar">
        <span>Orange outline = your ADU. Drag to orbit, scroll to zoom. In rural areas without 3D imagery the ground will look flat.</span>
        <button className="btn btn-light" onClick={onClose}>Back to plan</button>
      </div>
    </div>
  );
}

// Swap which ADU representation is attached to the 3D map (outlines always stay).
function applyMode(e, mode) {
  if (!e.map) return;
  const set = (el, on) => {
    if (on && !el.isConnected) e.map.append(el);
    if (!on && el.isConnected) el.remove();
  };
  set(e.solid, mode === "solid" || !e.model);
  if (e.model) set(e.model, mode === "model");
}
