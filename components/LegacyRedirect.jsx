"use client";
import { useEffect } from "react";

// The planner used to live at "/". Old links and printed QR codes carry these query keys,
// so send those visitors on to /visualizer with the same query string.
const KEYS = ["model", "ar", "tour", "style"];

export default function LegacyRedirect() {
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (KEYS.some((k) => q.has(k))) location.replace(`/visualizer${location.search}`);
  }, []);
  return null;
}
