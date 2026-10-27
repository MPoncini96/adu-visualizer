"use client";
import { useState } from "react";

export default function QuoteModal({ summary, onClose }) {
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...summary, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setState("done");
    } catch (err) {
      setError(err.message);
      setState("error");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Request a quote">
        <div className="modal-head">
          <div>
            <h2>Request a quote</h2>
            <p className="muted">{summary.model} · {summary.style}{summary.address ? ` · ${summary.address}` : ""}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {state === "done" ? (
          <div className="done">
            <div className="done-check">✓</div>
            <h3>Thanks, we got it.</h3>
            <p>A member of the team will reach out within one business day to talk through your lot and next steps.</p>
            <button className="btn btn-primary" onClick={onClose}>Back to my design</button>
          </div>
        ) : (
          <form onSubmit={submit} className="quote-form">
            <label>Name<input name="name" required autoComplete="name" /></label>
            <div className="row2">
              <label>Phone<input name="phone" type="tel" autoComplete="tel" /></label>
              <label>Email<input name="email" type="email" autoComplete="email" /></label>
            </div>
            <label>Anything we should know? <span className="muted">(optional)</span>
              <textarea name="notes" rows={3} placeholder="Timeline, budget, who will live there…" />
            </label>
            <input name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
            {error && <p className="form-error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send my design"}
            </button>
            <p className="muted small">Your design, placement and contact details go to the builder only.</p>
          </form>
        )}
      </div>
    </div>
  );
}
