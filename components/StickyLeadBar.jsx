"use client";
// Phone-only bar pinned to the bottom of the home page; hides while the lead form is on screen.
import { useEffect, useState } from "react";
import { prefillLead } from "./LeadForm.jsx";
import { SITE } from "../lib/site.js";

export default function StickyLeadBar() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const form = document.getElementById("get-started");
    const end = document.getElementById("final-cta");
    if (!form) return;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.isIntersecting));
      setHidden([...seen.values()].some(Boolean));
    }, { threshold: 0.15 });
    io.observe(form);
    if (end) io.observe(end);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`sticky-lead ${hidden ? "is-hidden" : ""}`} aria-hidden={hidden}>
      {SITE.phone && <a href={`tel:${SITE.phone.replace(/[^\d+]/g, "")}`} className="btn btn-light" tabIndex={hidden ? -1 : 0}>Call</a>}
      <button type="button" className="btn btn-primary" tabIndex={hidden ? -1 : 0} onClick={() => prefillLead()}>Get a free ADU consultation</button>
    </div>
  );
}
