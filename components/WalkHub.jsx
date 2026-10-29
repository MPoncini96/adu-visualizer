"use client";
// "Walk inside" page: choose a plan and exterior style, then open the walk-in tour.
// Deep links: /walk?model=almond&style=sage opens that tour directly.
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MODELS, STYLES, FILTERS, modelSrc, findModel, heightLabel } from "../lib/models.js";
import { floorPlanFor } from "../lib/floorplans/index.js";
import FloorPlanSVG from "./FloorPlanSVG.jsx";

const InteriorTour = dynamic(() => import("./InteriorTour.jsx"), { ssr: false });
const ARModal = dynamic(() => import("./ARModal.jsx"), { ssr: false });

export default function WalkHub() {
  const [styleId, setStyleId] = useState("cottage");
  const [filter, setFilter] = useState("all");
  const [touring, setTouring] = useState(null); // model id
  const [ar, setAr] = useState(null); // model id
  const [arWalk, setArWalk] = useState(true);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (STYLES.some((s) => s.id === q.get("style"))) setStyleId(q.get("style"));
    const m = findModel(q.get("model"));
    // ?ar=1 comes from the AR dialog's QR code (scanned on a phone)
    if (m && q.get("ar") === "1") { setArWalk(q.get("walk") === "1"); setAr(m.id); }
    else if (m) setTouring(m.id);
  }, []);

  // keep the URL shareable while a tour is open
  function open(id) {
    setTouring(id);
    const u = new URL(location.href);
    u.searchParams.set("model", id);
    u.searchParams.set("style", styleId);
    history.replaceState(null, "", u);
  }
  function close() {
    setTouring(null);
    history.replaceState(null, "", location.pathname);
  }

  const model = touring && MODELS.find((m) => m.id === touring);
  const arModel = ar && MODELS.find((m) => m.id === ar);

  return (
    <main className="walk-page">
      <div className="page-head">
        <h1>Walk inside a plan</h1>
        <p className="lede">Pick a plan to step through the front door and walk every room in 3D. Layouts and furniture are samples; the builder finalizes the design.</p>
      </div>

      <div className="walk-controls">
        <div className="chips" role="group" aria-label="Filter plans">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip-btn ${f.id === filter ? "on" : ""}`} onClick={() => setFilter(f.id)} aria-pressed={f.id === filter}>{f.name}</button>
          ))}
        </div>
        <div className="styles walk-styles" role="group" aria-label="Exterior style">
          {STYLES.map((s) => (
            <button key={s.id} className={`style-btn ${s.id === styleId ? "on" : ""}`} onClick={() => setStyleId(s.id)} aria-pressed={s.id === styleId}>
              <span className="swatch" style={{ background: s.swatch }} />{s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="walk-grid">
        {MODELS.filter(FILTERS.find((f) => f.id === filter).test).map((m) => (
          <article key={m.id} className="plan-tile">
            <button className="plan-tile-fp as-btn" onClick={() => open(m.id)} aria-label={`Walk inside ${m.name}`}>
              <FloorPlanSVG plan={floorPlanFor(m.id)} model={m} labels furniture />
            </button>
            <div className="plan-tile-body">
              <h3>{m.name}</h3>
              <p className="muted">{m.kind} · {m.sqft.toLocaleString()} sq ft · {m.shape === "L" ? `${m.widthFt}′×${m.depthFt}′ L` : `${m.widthFt}′×${m.depthFt}′`}</p>
              <p className="muted small">{heightLabel(m)}</p>
              <div className="plan-tile-actions">
                <button className="btn btn-dark btn-sm" onClick={() => open(m.id)}>Walk inside</button>
                <Link href={`/visualizer?model=${m.id}&style=${styleId}`} className="btn btn-light btn-sm">{m.conversion ? "Check my garage" : "Place on my lot"}</Link>
              </div>
            </div>
          </article>
        ))}
      </div>

      {model && (
        <InteriorTour
          key={model.id}
          model={model}
          styleId={styleId}
          onStyle={setStyleId}
          onClose={close}
          onAR={() => { const id = model.id; close(); setArWalk(true); setAr(id); }}
        />
      )}
      {arModel && (
        <ARModal model={arModel} style={styleId} src={modelSrc(arModel.id, styleId)} walkIn={arWalk} onMode={setArWalk} onClose={() => setAr(null)} />
      )}
    </main>
  );
}
