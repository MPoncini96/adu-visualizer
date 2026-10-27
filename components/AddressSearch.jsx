"use client";
// Google Places address autocomplete (new Places API web component).
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../lib/googleMaps.js";
import { SERVICE_BOUNDS } from "../lib/serviceArea.js";

export default function AddressSearch({ onSelect }) {
  const hostRef = useRef(null);
  const [mode, setMode] = useState("loading"); // loading | google | off
  const cb = useRef(onSelect);
  cb.current = onSelect;

  useEffect(() => {
    let el;
    loadGoogleMaps()
      .then(async () => {
        const { PlaceAutocompleteElement } = await google.maps.importLibrary("places");
        el = new PlaceAutocompleteElement({
          includedRegionCodes: ["us"],
          locationRestriction: SERVICE_BOUNDS,
          placeholder: "Enter your property address",
        });
        el.setAttribute("placeholder", "Enter your property address");
        const handle = async (place) => {
          await place.fetchFields({ fields: ["location", "formattedAddress"] });
          const loc = place.location;
          cb.current({ lat: loc.lat(), lng: loc.lng(), label: place.formattedAddress });
        };
        el.addEventListener("gmp-select", (e) => handle(e.placePrediction.toPlace()));
        el.addEventListener("gmp-placeselect", (e) => handle(e.place)); // older event name
        hostRef.current.replaceChildren(el);
        setMode("google");
      })
      .catch(() => setMode("off"));
  }, []);

  return (
    <div className="address">
      <div ref={hostRef} className="address-host" />
      {mode === "off" && (
        <input className="input" disabled placeholder="Address search turns on with the Google Maps key" />
      )}
      {mode === "loading" && <input className="input" disabled placeholder="Loading address search…" />}
    </div>
  );
}
