// Loads the Google Maps JavaScript API once. The key is a public, browser key:
// protect it with HTTP-referrer and API restrictions in Google Cloud.
let promise;

export const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
// "beta" avoids Google's "alpha channel, development only" banner. Override with NEXT_PUBLIC_GOOGLE_MAPS_VERSION.
export const GOOGLE_VERSION = process.env.NEXT_PUBLIC_GOOGLE_MAPS_VERSION || "beta";
export const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";

export function loadGoogleMaps() {
  if (!GOOGLE_KEY) return Promise.reject(new Error("no-key"));
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) return resolve(window.google.maps);
    window.__gmapsReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => {
      window.dispatchEvent(new CustomEvent("gmaps-auth-failure"));
    };
    const s = document.createElement("script");
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}` +
      `&v=${GOOGLE_VERSION}&loading=async&callback=__gmapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(s);
  });
  return promise;
}
