"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MODELS, STYLES, FILTERS, modelSrc, footprintFt, doorFt } from "../lib/models.js";
import { DEMO_LOT } from "../lib/demo.js";
import { FT, makeProjector, ringCentroid, closedOpen, areaM2, placeXY, checkFit, suggestPlacement } from "../lib/geo.js";
import { inServiceArea, milesFromHwy99, MAX_MILES } from "../lib/serviceArea.js";
import { GOOGLE_KEY } from "../lib/googleMaps.js";
import PlanEditor from "./PlanEditor.jsx";
import AddressSearch from "./AddressSearch.jsx";
import QuoteModal from "./QuoteModal.jsx";

const MapEditor = dynamic(() => import("./MapEditor.jsx"), { ssr: false });
const View3D = dynamic(() => import("./View3D.jsx"), { ssr: false });
const ARModal = dynamic(() => import("./ARModal.jsx"), { ssr: false });

const MIN_SETBACK_FT = 4;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export default function App() {
  const [modelId, setModelId] = useState("ripon");
  const [styleId, setStyleId] = useState("cottage");
  const [filter, setFilter] = useState("all");
  const [place, setPlace] = useState({ label: DEMO_LOT.label, isDemo: true });
  const [lot, setLot] = useState({ ring: DEMO_LOT.ring, source: "county", county: DEMO_LOT.county });
  const [origin, setOrigin] = useState(() => ringCentroid(DEMO_LOT.ring));
  const [adu, setAdu] = useState(null);
  const [phase, setPhase] = useState("ready"); // ready | loading | out | trace
  const [message, setMessage] = useState("");
  const [trace, setTrace] = useState([]); // [{lat,lng}]
  const [view, setView] = useState(GOOGLE_KEY ? "map" : "plan");
  const [mapsFailed, setMapsFailed] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [showAR, setShowAR] = useState(false);
  const [showQuote, setShowQuote] = useState(false);

  const model = MODELS.find((m) => m.id === modelId);
  const shape = useMemo(() => shapeOf(model), [model]);
  const projector = useMemo(() => makeProjector(origin), [origin]);
  const lotXY = useMemo(() => (lot ? closedOpen(lot.ring).map(([lng, lat]) => projector.toXY(lat, lng)) : null), [lot, projector]);
  const traceXY = useMemo(() => trace.map((p) => projector.toXY(p.lat, p.lng)), [trace, projector]);

  // Deep link from the AR QR code: ?model=..&style=..&ar=1
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (MODELS.some((m) => m.id === q.get("model"))) setModelId(q.get("model"));
    if (STYLES.some((s) => s.id === q.get("style"))) setStyleId(q.get("style"));
    if (q.get("ar") === "1") setShowAR(true);
    const fail = () => { setMapsFailed(true); setView("plan"); };
    window.addEventListener("gmaps-auth-failure", fail);
    return () => window.removeEventListener("gmaps-auth-failure", fail);
  }, []);

  // Place the ADU whenever a new lot arrives
  const placeOnLot = useCallback((xy, shp, housePointXY) => {
    const s = suggestPlacement(xy, shp.pts, housePointXY, MIN_SETBACK_FT * FT + 0.3);
    setAdu({ x: s.x, y: s.y, heading: s.heading });
  }, []);

  useEffect(() => {
    if (lotXY && !adu) {
      // Demo lot: house sits toward the street on the south end (Wawona St), so the ADU goes in back.
      placeOnLot(lotXY, shape, place.isDemo ? [0, -30] : null);
    }
  }, [lotXY, adu, shape, place.isDemo, placeOnLot]);

  const aduXY = useMemo(() => (adu ? placeXY(shape.pts, adu.x, adu.y, adu.heading) : null), [adu, shape]);
  const doorXY = useMemo(() => (adu ? placeXY(shape.door, adu.x, adu.y, adu.heading) : null), [adu, shape]);
  const fit = useMemo(() => (lotXY && aduXY ? checkFit(lotXY, aduXY) : null), [lotXY, aduXY]);
  const clearanceFt = fit ? fit.clearanceM / FT : 0;
  const status = !fit ? "ok" : !fit.inside || clearanceFt < MIN_SETBACK_FT ? "bad" : clearanceFt < 6 ? "tight" : "ok";
  const lotSqft = lotXY ? areaM2(lotXY) / (FT * FT) : null;

  async function selectAddress({ lat, lng, label }) {
    setShow3D(false);
    setMessage("");
    setTrace([]);
    if (!inServiceArea(lat, lng)) {
      setPlace({ label });
      setPhase("out");
      setMessage(`That address is about ${Math.round(milesFromHwy99(lat, lng))} miles from Highway 99. We currently build within ${MAX_MILES} miles of 99, from Lodi to Fresno.`);
      return;
    }
    setPhase("loading");
    setPlace({ label, lat, lng });
    try {
      const res = await fetch(`/api/parcel?lat=${lat}&lng=${lng}`);
      const data = await res.json();
      if (data.parcel) {
        const ring = data.parcel.ring;
        const o = ringCentroid(ring);
        const proj = makeProjector(o);
        const xy = closedOpen(ring).map(([x, y]) => proj.toXY(y, x));
        setOrigin(o);
        setLot({ ring, source: "county", county: data.parcel.county });
        placeOnLot(xy, shape, proj.toXY(lat, lng));
        setPhase("ready");
      } else {
        setOrigin({ lat, lng });
        setLot(null);
        setAdu(null);
        setPhase("trace");
      }
    } catch {
      setOrigin({ lat, lng });
      setLot(null);
      setAdu(null);
      setPhase("trace");
    }
  }

  function onMapClick({ x, y, lat, lng }) {
    if (phase === "trace") {
      if (lat != null) setTrace((t) => [...t, { lat, lng }]);
      return;
    }
    if (lotXY && adu) setAdu((a) => ({ ...a, x, y }));
  }

  function finishTrace() {
    if (trace.length < 3) return;
    const ring = trace.map((p) => [p.lng, p.lat]);
    const o = ringCentroid(ring);
    const proj = makeProjector(o);
    const xy = ring.map(([x, y]) => proj.toXY(y, x));
    setOrigin(o);
    setLot({ ring, source: "traced" });
    placeOnLot(xy, shape, place.lat ? proj.toXY(place.lat, place.lng) : null);
    setTrace([]);
    setPhase("ready");
  }

  // Switching plans keeps the spot if the new plan still fits there; otherwise re-place it.
  function chooseModel(m) {
    setModelId(m.id);
    if (!lotXY || !adu) return;
    const d = shapeOf(m);
    const f = checkFit(lotXY, placeXY(d.pts, adu.x, adu.y, adu.heading));
    if (!f.inside || f.clearanceM < MIN_SETBACK_FT * FT) {
      placeOnLot(lotXY, d, place.isDemo ? [0, -30] : place.lat ? projector.toXY(place.lat, place.lng) : null);
    }
  }

  function rotate(delta) {
    setAdu((a) => a && { ...a, heading: (((a.heading + delta) % 360) + 360) % 360 });
  }

  function squareToLot() {
    if (!lotXY || !adu) return;
    let best = null;
    for (let i = 0; i < lotXY.length; i++) {
      const a = lotXY[i], b = lotXY[(i + 1) % lotXY.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!best || len > best.len) best = { len, ang: (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI };
    }
    const options = [0, 90, 180, 270].map((k) => (((best.ang + k) % 360) + 360) % 360);
    const diff = (h) => Math.abs(((h - adu.heading + 540) % 360) - 180);
    const h = options.sort((p, q) => diff(p) - diff(q))[0];
    setAdu({ ...adu, heading: Math.round(h * 10) / 10 });
  }

  const aduLatLng = adu ? projector.toLatLng(adu.x, adu.y) : origin;
  const src = modelSrc(modelId, styleId);
  const styleName = STYLES.find((s) => s.id === styleId).name;
  const canAct = phase === "ready" && adu && lot;

  return (
    <div className="app">
      <aside className="panel">
        <header className="brand">
          <div className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30"><path d="M4 16 16 6l12 10v11H4z" fill="#2f6b4f" /><path d="M11 27v-7h10v7" fill="#f6f3ec" /><path d="M2 16.5 16 5l14 11.5" stroke="#c4683a" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
          </div>
          <div>
            <div className="brand-name">Valley ADU Studio</div>
            <div className="brand-tag">Lodi to Fresno · along Highway 99</div>
          </div>
        </header>

        <h1>See an ADU on your lot</h1>
        <p className="lede">Pick a plan, drag it into your backyard, and check that it fits, before anyone comes out.</p>

        <section className="step">
          <div className="step-label"><span>1</span> Your property</div>
          <AddressSearch onSelect={selectAddress} />
          <div className="place-line">
            <span className="pin">●</span> {place.label}
            {place.isDemo && <span className="chip">Demo</span>}
          </div>
          {phase === "loading" && <p className="note">Finding the property lines…</p>}
          {phase === "out" && <p className="note warn">{message}</p>}
          {phase === "trace" && (
            <div className="note">
              <b>Trace your lot.</b> We couldn't pull the property lines for this address automatically. Tap each corner of the lot on the map, then press Done.
              <div className="trace-actions">
                <button className="btn btn-light btn-sm" onClick={() => setTrace((t) => t.slice(0, -1))} disabled={!trace.length}>Undo</button>
                <button className="btn btn-primary btn-sm" onClick={finishTrace} disabled={trace.length < 3}>Done ({trace.length} corners)</button>
              </div>
            </div>
          )}
        </section>

        <section className="step">
          <div className="step-label"><span>2</span> Choose a plan</div>
          <div className="chips" role="group" aria-label="Filter plans">
            {FILTERS.map((f) => (
              <button key={f.id} className={`chip-btn ${f.id === filter ? "on" : ""}`} onClick={() => setFilter(f.id)} aria-pressed={f.id === filter}>{f.name}</button>
            ))}
          </div>
          <div className="models">
            {MODELS.filter(FILTERS.find((f) => f.id === filter).test).map((m) => (
              <button key={m.id} className={`model-card ${m.id === modelId ? "active" : ""}`} onClick={() => chooseModel(m)} aria-pressed={m.id === modelId}>
                <FootprintIcon model={m} />
                <div className="model-text">
                  <div className="model-name">{m.name}</div>
                  <div className="model-meta">{m.kind} · {m.sqft.toLocaleString()} sq ft</div>
                </div>
                <div className="model-dims">{m.widthFt}′×{m.depthFt}′</div>
              </button>
            ))}
          </div>
          <p className="model-blurb">{model.blurb}</p>
          <div className="styles" role="group" aria-label="Exterior style">
            {STYLES.map((s) => (
              <button key={s.id} className={`style-btn ${s.id === styleId ? "on" : ""}`} onClick={() => setStyleId(s.id)} aria-pressed={s.id === styleId}>
                <span className="swatch" style={{ background: s.swatch }} />{s.name}
              </button>
            ))}
          </div>
        </section>

        <section className="step">
          <div className="step-label"><span>3</span> Place it</div>
          <p className="hint">Drag the {statusWord(status)} box on the map, or tap a spot on the lot. The white edge is the front door.</p>
          <div className="rotate-row">
            <button className="btn btn-light btn-sm" onClick={() => rotate(-15)} disabled={!canAct} aria-label="Rotate left 15 degrees">⟲ 15°</button>
            <button className="btn btn-light btn-sm" onClick={() => rotate(15)} disabled={!canAct} aria-label="Rotate right 15 degrees">⟳ 15°</button>
            <button className="btn btn-light btn-sm" onClick={() => rotate(90)} disabled={!canAct}>Turn 90°</button>
            <button className="btn btn-light btn-sm" onClick={squareToLot} disabled={!canAct}>Square to lot</button>
          </div>
          {canAct && fit && (
            <div className={`fit fit-${status}`}>
              <div className="fit-title">
                {status === "bad" ? (fit.inside ? "Too close to the property line" : "Outside the lot") : status === "tight" ? "Fits, but it's snug" : "Fits"}
              </div>
              <div className="fit-body">
                {fit.inside
                  ? `${clearanceFt.toFixed(1)} ft to the closest property line (${MIN_SETBACK_FT} ft minimum).`
                  : "Drag the ADU fully inside the yellow lot line."}
              </div>
              <div className="stats">
                <div><b>{lotSqft ? Math.round(lotSqft).toLocaleString() : "–"}</b><span>lot sq ft</span></div>
                <div><b>{model.sqft.toLocaleString()}</b><span>ADU sq ft</span></div>
                <div><b>{compass(adu.heading)}</b><span>door faces</span></div>
              </div>
            </div>
          )}
        </section>

        <section className="step actions">
          <div className="step-label"><span>4</span> See it and get a quote</div>
          <div className="action-grid">
            <button className="btn btn-dark" disabled={!canAct || !GOOGLE_KEY || mapsFailed} onClick={() => setShow3D(true)}>View in 3D</button>
            <button className="btn btn-dark" onClick={() => setShowAR(true)}>See it in your yard</button>
          </div>
          <button className="btn btn-primary btn-block" onClick={() => setShowQuote(true)}>Request a quote</button>
        </section>

        <footer className="fine">
          Setback check uses California's 4-ft side and rear minimum for ADUs. Your city may have extra rules; we confirm them before you build. Property lines from {lot?.source === "traced" ? "your tracing" : `${lot?.county || "county"} County public records`}, for planning only.
        </footer>
      </aside>

      <main className="stage">
        {view === "map" && GOOGLE_KEY && !mapsFailed ? (
          <MapEditor
            projector={projector}
            origin={origin}
            lotRing={lot?.ring}
            adu={adu}
            aduXY={aduXY}
            doorXY={doorXY}
            status={status}
            tracing={phase === "trace"}
            tracePts={trace}
            onAduMove={({ x, y }) => setAdu((a) => a && { ...a, x, y })}
            onMapClick={onMapClick}
            onError={() => { setMapsFailed(true); setView("plan"); }}
          />
        ) : (
          <PlanEditor
            projector={projector}
            lotXY={lotXY}
            adu={adu}
            aduXY={aduXY}
            doorXY={doorXY}
            status={status}
            tracing={phase === "trace"}
            traceXY={traceXY}
            onAduMove={({ x, y }) => setAdu((a) => a && { ...a, x, y })}
            onMapClick={onMapClick}
          />
        )}

        {GOOGLE_KEY && !mapsFailed && (
          <div className="view-toggle" role="group" aria-label="Map view">
            <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Satellite</button>
            <button className={view === "plan" ? "on" : ""} onClick={() => setView("plan")}>Site plan</button>
          </div>
        )}
        {(!GOOGLE_KEY || mapsFailed) && (
          <div className="stage-note">{mapsFailed ? "Satellite map unavailable: check the Google Maps key. Showing the site plan." : "Site plan view. Satellite imagery and 3D turn on once the Google Maps key is added."}</div>
        )}

        {show3D && adu && (
          <View3D position={aduLatLng} heading={adu.heading} src={src} onClose={() => setShow3D(false)} />
        )}
      </main>

      {showAR && <ARModal model={model} style={styleId} src={src} onClose={() => setShowAR(false)} />}
      {showQuote && (
        <QuoteModal
          onClose={() => setShowQuote(false)}
          summary={{
            model: `${model.name} (${model.kind}, ${model.sqft} sq ft)`,
            style: styleName,
            address: place.isDemo ? "Demo lot (Manteca)" : place.label,
            placement: adu ? `Door faces ${compass(adu.heading)}` : "",
            clearance: fit?.inside ? `${clearanceFt.toFixed(1)} ft` : "not placed inside lot",
            lat: aduLatLng?.lat,
            lng: aduLatLng?.lng,
          }}
        />
      )}
    </div>
  );
}

function statusWord(s) {
  return s === "bad" ? "red" : s === "tight" ? "orange" : "green";
}

// Footprint in meters (for placement/fit) plus the front-door segment.
function shapeOf(m) {
  const pts = footprintFt(m).map(([x, f]) => [x * FT, f * FT]);
  const d = doorFt(m);
  const door = [[(d.x - d.w / 2) * FT, d.f * FT], [(d.x + d.w / 2) * FT, d.f * FT]];
  return { pts, door };
}

function FootprintIcon({ model }) {
  const s = 30 / 42;
  const pts = footprintFt(model).map(([x, f]) => `${17 + x * s},${17 - f * s}`).join(" ");
  return (
    <svg className="fp" viewBox="0 0 34 34" width="34" height="34" aria-hidden="true">
      <polygon points={pts} strokeLinejoin="round" />
    </svg>
  );
}
