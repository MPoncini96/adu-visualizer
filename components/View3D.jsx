"use client";
// Google Photorealistic 3D view with the chosen ADU model placed on the lot.
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

export default function View3D({ position, heading, src, onClose }) {
  const hostRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let map;
    let cancelled = false;
    loadGoogleMaps()
      .then(async () => {
        const { Map3DElement, Model3DElement } = await google.maps.importLibrary("maps3d");
        if (cancelled) return;
        const o = orientationOffsets();
        map = new Map3DElement({
          center: { lat: position.lat, lng: position.lng, altitude: 0 },
          range: 75,
          tilt: 60,
          heading: (heading + 180 + 25) % 360, // look at the front door, slightly off-axis
          mode: "HYBRID",
        });
        const model = new Model3DElement({
          src: new URL(src, location.origin).href,
          position: { lat: position.lat, lng: position.lng, altitude: 0 },
          altitudeMode: "CLAMP_TO_GROUND",
          orientation: { heading: (heading + o.h) % 360, tilt: o.t, roll: o.r },
          scale: 1,
        });
        map.append(model);
        hostRef.current.append(map);
      })
      .catch((e) => setError(e.message === "no-key" ? "The 3D view turns on once the Google Maps key is added." : "3D view couldn't load here."));
    return () => { cancelled = true; map?.remove(); };
  }, [position.lat, position.lng, heading, src]);

  return (
    <div className="view3d">
      <div ref={hostRef} className="view3d-host" />
      {error && <div className="view3d-msg">{error}</div>}
      <div className="view3d-bar">
        <span>Drag to orbit · scroll to zoom. In rural areas without 3D imagery the ground will look flat.</span>
        <button className="btn btn-light" onClick={onClose}>Back to plan</button>
      </div>
    </div>
  );
}
