"use client";
// A button that scrolls to the lead form and pre-fills it (project type and/or plan).
import { prefillLead } from "./LeadForm.jsx";

export default function LeadButton({ projectType, plan, className = "btn btn-primary", children }) {
  return (
    <button type="button" className={className} onClick={() => prefillLead({ projectType, plan })}>
      {children}
    </button>
  );
}
