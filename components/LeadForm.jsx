"use client";
// The home page's lead form. Other parts of the page can pre-fill it with
// prefillLead({ projectType, plan }) (scrolls here and focuses the name field).
import { useEffect, useRef, useState } from "react";
import { PROJECT_TYPES, TIMELINES } from "../lib/site.js";

const EVENT = "lead:prefill";

export function prefillLead(detail = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  const el = document.getElementById("get-started");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function LeadForm({ source = "home" }) {
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const [error, setError] = useState("");
  const [projectType, setProjectType] = useState("");
  const [plan, setPlan] = useState("");
  const nameRef = useRef(null);

  useEffect(() => {
    const onPrefill = (e) => {
      if (e.detail?.projectType) setProjectType(e.detail.projectType);
      if (e.detail?.plan) { setPlan(e.detail.plan); setProjectType((t) => t || "backyard"); }
      setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 450);
    };
    window.addEventListener(EVENT, onPrefill);
    return () => window.removeEventListener(EVENT, onPrefill);
  }, []);

  async function submit(e) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    if (!form.phone && !form.email) {
      setError("Please add a phone number or an email so we can reach you.");
      setState("error");
      return;
    }
    setState("sending");
    setError("");
    const type = PROJECT_TYPES.find((t) => t.id === form.projectType);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, projectType: type?.label || "", model: plan, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setState("done");
      // Conversion hook for analytics / ad tags added later (Google Ads, GA4, Meta).
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "generate_lead", lead_source: source, project_type: form.projectType || "" });
    } catch (err) {
      setError(err.message);
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="lead-card lead-done" role="status">
        <div className="done-check">✓</div>
        <h2>Thanks, we got it.</h2>
        <p>We'll reach out within one business day to set up your free consultation.</p>
        <p className="muted small">While you wait, you can walk through our plans or try one on your lot.</p>
        <div className="lead-done-links">
          <a href="/walk" className="btn btn-light">Walk inside a plan</a>
          <a href="/visualizer" className="btn btn-dark">Try one on my lot</a>
        </div>
      </div>
    );
  }

  return (
    <form className="lead-card quote-form" onSubmit={submit} aria-labelledby="lead-title">
      <div>
        <h2 id="lead-title">Get your free ADU consultation</h2>
        <p className="muted">Find out what your lot allows and what it would cost. No obligation.</p>
      </div>
      {plan && (
        <p className="lead-plan">Asking about <b>{plan}</b> <button type="button" className="link-btn" onClick={() => setPlan("")}>clear</button></p>
      )}
      <label>Your name<input ref={nameRef} name="name" required autoComplete="name" /></label>
      <div className="row2">
        <label>Phone<input name="phone" type="tel" autoComplete="tel" inputMode="tel" /></label>
        <label>Email<input name="email" type="email" autoComplete="email" /></label>
      </div>
      <label>Property address or city<input name="address" autoComplete="street-address" placeholder="e.g. 123 Main St, Manteca" /></label>
      <label>What are you thinking about?
        <select name="projectType" value={projectType} onChange={(e) => setProjectType(e.target.value)}>
          <option value="">Choose one</option>
          {PROJECT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label>When would you like to start?
        <select name="timeline" defaultValue="">
          <option value="">Choose one</option>
          {TIMELINES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary btn-block btn-lg" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Get my free consultation"}
      </button>
      <p className="muted small">We'll reach out within one business day. Your details go to our team only, never sold.</p>
    </form>
  );
}
