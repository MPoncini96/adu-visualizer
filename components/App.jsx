"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MODELS, STYLES, FILTERS, modelSrc, footprintFt, doorFt, findModel, heightLabel } from "../lib/models.js";
import { DEMO_LOT } from "../lib/demo.js";
import {
  FT, makeProjector, ringCentroid, closedOpen, areaM2, centroidXY, placeXY, checkFit, insidePolygon,
  suggestPlacement, nudgeInside, findStreetEdge, rearDirection, alignedHeadings, pointInPolygon,
} from "../lib/geo.js";
import { inServiceArea, milesFromHwy99, MAX_MILES } from "../lib/serviceArea.js";
import { GOOGLE_KEY } from "../lib/googleMaps.js";
import PlanEditor from "./PlanEditor.jsx";
import AddressSearch from "./AddressSearch.jsx";
import QuoteModal from "./QuoteModal.jsx";

const MapEditor = dynamic(() => import("./MapEditor.jsx"), { ssr: false });
const View3D = dynamic(() => import("./View3D.jsx"), { ssr: false });
const ARModal = dynamic(() => import("./ARModal.jsx"), { ssr: false });

const MANTECA = { lat: 37.7974, lng: -121.2161 };
const HOUSE_GAP_FT = 6; // soft warning below this; 6-10 ft is the usual rule of thumb
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const fmtFt = (m) => `${(m / FT).toFixed(1)} ft`;

export default function App() {
  const [modelId, setModelId] = useState("cherry");
  const [styleId, setStyleId] = useState("cottage");
  const [filter, setFilter] = useState("all");
  const [place, setPlace] = useState(null);
  const [lot, setLot] = useState(null);
  const [site, setSite] = useState({ structures: [], neighbors: [], loaded: false });
  const [origin, setOrigin] = useState(MANTECA);
  const [adu, setAdu] = useState(null);
  const [phase, setPhase] = useState("start"); // start | ready | loading | out | trace
  const [traceTarget, setTraceTarget] = useState("lot"); // lot | structure
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [trace, setTrace] = useState([]); // [{lat,lng}]
  const [view, setView] = useState(GOOGLE_KEY ? "map" : "plan");
  const [mapsFailed, setMapsFailed] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [showAR, setShowAR] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const lastValid = useRef(null);
  const userMoved = useRef(false);

  const model = MODELS.find((m) => m.id === modelId);
  const isConversion = !!model.conversion;
  const shape = useMemo(() => shapeOf(model), [model]);
  const projector = useMemo(() => makeProjector(origin), [origin]);
  const lotXY = useMemo(() => (lot ? closedOpen(lot.ring).map(([lng, lat]) => projector.toXY(lat, lng)) : null), [lot, projector]);
  const traceXY = useMemo(() => trace.map((p) => projector.toXY(p.lat, p.lng)), [trace, projector]);

  // Existing structures on this lot (centroid inside the lot), largest building labeled "House"
  const structures = useMemo(() => {
    if (!lotXY) return [];
    const list = site.structures
      .map((s) => ({ ...s, xy: closedOpen(s.ring).map(([lng, lat]) => projector.toXY(lat, lng)) }))
      .filter((s) => s.xy.length >= 3 && (s.kind === "traced" || pointInPolygon(centroidXY(s.xy), lotXY)))
      .map((s) => ({ ...s, area: areaM2(s.xy) }));
    const buildings = list.filter((s) => s.kind !== "pool").sort((a, b) => b.area - a.area);
    return list.map((s) => ({
      ...s,
      label: s.kind === "pool" ? "Pool" : s === buildings[0] ? "House" : s.kind === "traced" ? "Structure" : "Building",
    }));
  }, [site.structures, lotXY, projector]);
  const structuresXY = useMemo(() => structures.map((s) => s.xy), [structures]);
  const house = structures.find((s) => s.label === "House");

  const streetEdge = useMemo(() => {
    if (!lotXY) return null;
    const neighborsXY = site.neighbors.map((r) => closedOpen(r).map(([lng, lat]) => projector.toXY(lat, lng)));
    const hint = place?.lat ? projector.toXY(place.lat, place.lng) : house ? centroidXY(house.xy) : null;
    return findStreetEdge(lotXY, neighborsXY, hint);
  }, [lotXY, site.neighbors, house, place, projector]);
  const rear = useMemo(() => {
    if (!lotXY) return null;
    const r = rearDirection(lotXY, streetEdge);
    if (r) return r;
    if (house) {
      const c = centroidXY(lotXY), h = centroidXY(house.xy);
      const v = [c[0] - h[0], c[1] - h[1]], l = Math.hypot(...v);
      if (l > 0.5) return [v[0] / l, v[1] / l];
    }
    return null;
  }, [lotXY, streetEdge, house]);

  // Fetch buildings + neighboring parcels for a lot
  const loadSite = useCallback(async (ring) => {
    setSite({ structures: [], neighbors: [], loaded: false });
    try {
      const res = await fetch("/api/parcel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ring }) });
      const data = await res.json();
      setSite({ structures: data.structures || [], neighbors: data.neighbors || [], loaded: true });
    } catch {
      setSite({ structures: [], neighbors: [], loaded: true });
    }
  }, []);

  // Deep links (?model=..&style=..&ar=1) and the demo lot's site data
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const m = findModel(q.get("model"));
    if (m) setModelId(m.id);
    if (STYLES.some((s) => s.id === q.get("style"))) setStyleId(q.get("style"));
    if (q.get("ar") === "1") setShowAR(true);
    const fail = () => { setMapsFailed(true); setView("plan"); };
    window.addEventListener("gmaps-auth-failure", fail);
    return () => window.removeEventListener("gmaps-auth-failure", fail);
  }, [loadSite]);

  const autoPlace = useCallback((shp = shape) => {
    if (!lotXY) return;
    const s = suggestPlacement(lotXY, shp.pts, { rear, structuresXY });
    const next = { x: s.x, y: s.y, heading: s.heading };
    setAdu(next);
    if (insidePolygon(placeXY(shp.pts, next.x, next.y, next.heading), lotXY)) lastValid.current = next;
    if (s.noFit) setNotice("This plan doesn't fit inside this lot. Try a smaller plan.");
  }, [lotXY, rear, structuresXY, shape]);

  // Place automatically when a lot loads, and again once its buildings arrive (unless moved by hand)
  useEffect(() => {
    if (!lotXY || phase !== "ready") return;
    if (!adu || (!userMoved.current && site.loaded)) autoPlace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotXY, site.loaded, phase]);

  const aduXY = useMemo(() => (adu && !isConversion ? placeXY(shape.pts, adu.x, adu.y, adu.heading) : null), [adu, shape, isConversion]);
  const doorXY = useMemo(() => (adu && !isConversion ? placeXY(shape.door, adu.x, adu.y, adu.heading) : null), [adu, shape, isConversion]);
  const fit = useMemo(() => (lotXY && aduXY ? checkFit(lotXY, aduXY, structuresXY) : null), [lotXY, aduXY, structuresXY]);

  let status = "ok";
  if (fit) {
    if (!fit.inside || fit.overlapIdx >= 0) status = "bad";
    else if (fit.nearestIdx >= 0 && fit.nearestM < HOUSE_GAP_FT * FT) status = "tight";
  }
  const lotSqft = lotXY ? areaM2(lotXY) / (FT * FT) : null;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // --- moving the ADU: the lot line is a hard boundary
  const fitsLot = (a, shp = shape) => lotXY && insidePolygon(placeXY(shp.pts, a.x, a.y, a.heading), lotXY);
  function moveAdu({ x, y, live, src }) {
    if (!adu) return;
    const next = { ...adu, x, y };
    userMoved.current = true;
    if (fitsLot(next)) {
      lastValid.current = next;
      setAdu(next);
    } else if (src === "map" && live) {
      setAdu(next); // show it red while dragging; snaps back on release
    } else if (!live && lastValid.current) {
      setAdu({ ...lastValid.current });
      setNotice("The ADU can't cross the property line.");
    }
  }

  async function selectAddress({ lat, lng, label }) {
    setShow3D(false);
    setMessage("");
    setTrace([]);
    userMoved.current = false;
    if (!inServiceArea(lat, lng)) {
      setPlace({ label });
      setPhase("out");
      setMessage(`That address is about ${Math.round(milesFromHwy99(lat, lng))} miles from Highway 99. We currently build within ${MAX_MILES} miles of 99, from Lodi to Fresno.`);
      return;
    }
    setPhase("loading");
    setPlace({ label, lat, lng });
    setAdu(null);
    lastValid.current = null;
    try {
      const res = await fetch(`/api/parcel?lat=${lat}&lng=${lng}`);
      const data = await res.json();
      if (data.parcel) {
        setSite({ structures: data.structures || [], neighbors: data.neighbors || [], loaded: true });
        setOrigin(ringCentroid(data.parcel.ring));
        setLot({ ring: data.parcel.ring, source: "county", county: data.parcel.county });
        setPhase("ready");
        return;
      }
    } catch {}
    setOrigin({ lat, lng });
    setLot(null);
    setSite({ structures: [], neighbors: [], loaded: false });
    setTraceTarget("lot");
    setPhase("trace");
  }

  // Example property for demos: 531 Chablis Way, Manteca
  function loadExample() {
    setShow3D(false);
    setMessage("");
    setTrace([]);
    userMoved.current = false;
    setAdu(null);
    lastValid.current = null;
    setPlace({ label: DEMO_LOT.label });
    setOrigin(ringCentroid(DEMO_LOT.ring));
    setLot({ ring: DEMO_LOT.ring, source: "county", county: DEMO_LOT.county });
    loadSite(DEMO_LOT.ring);
    setPhase("ready");
  }

  function onMapClick({ x, y, lat, lng }) {
    if (phase === "trace") {
      if (lat != null) setTrace((t) => [...t, { lat, lng }]);
      return;
    }
    if (!lotXY || !adu || isConversion) return;
    userMoved.current = true;
    const next = { ...adu, x, y };
    if (fitsLot(next)) { lastValid.current = next; setAdu(next); return; }
    const n = nudgeInside(lotXY, shape.pts, x, y, adu.heading);
    if (n) { lastValid.current = n; setAdu(n); } else setNotice("There isn't room for it there.");
  }

  function startStructureTrace() {
    setTrace([]);
    setTraceTarget("structure");
    setPhase("trace");
  }

  function finishTrace() {
    if (trace.length < 3) return;
    const ring = trace.map((p) => [p.lng, p.lat]);
    setTrace([]);
    if (traceTarget === "structure") {
      setSite((s) => ({ ...s, structures: [...s.structures, { ring, kind: "traced", source: "Traced" }], loaded: true }));
      setPhase("ready");
      return;
    }
    userMoved.current = false;
    setAdu(null);
    setOrigin(ringCentroid(ring));
    setLot({ ring, source: "traced" });
    loadSite(ring);
    setPhase("ready");
  }

  function cancelTrace() {
    setTrace([]);
    setPhase(lot ? "ready" : "trace");
  }

  function setHeading(h) {
    if (!adu) return;
    userMoved.current = true;
    const next = { ...adu, heading: Math.round(((((h % 360) + 360) % 360)) * 10) / 10 };
    if (fitsLot(next)) { lastValid.current = next; setAdu(next); return; }
    const n = nudgeInside(lotXY, shape.pts, next.x, next.y, next.heading);
    if (n) { lastValid.current = n; setAdu(n); setNotice("Moved it in a little so it stays inside the lot."); }
    else setNotice("Not enough room to turn it here.");
  }
  const rotate = (delta) => adu && setHeading(adu.heading + delta);
  function squareToLot() {
    if (!lotXY || !adu) return;
    setHeading(alignedHeadings(lotXY, adu.heading)[0]);
  }

  // Switching plans keeps the spot if the new plan still fits there; otherwise re-place it.
  function chooseModel(m) {
    setModelId(m.id);
    if (!lotXY || m.conversion) return;
    const shp = shapeOf(m);
    const here = adu && placeXY(shp.pts, adu.x, adu.y, adu.heading);
    const ok = userMoved.current && here && insidePolygon(here, lotXY) && checkFit(lotXY, here, structuresXY).overlapIdx < 0;
    if (ok) lastValid.current = adu;
    else { userMoved.current = false; autoPlace(shp); }
  }

  const aduLatLng = adu ? projector.toLatLng(adu.x, adu.y) : origin;
  const src = modelSrc(modelId, styleId);
  const styleName = STYLES.find((s) => s.id === styleId).name;
  const canAct = phase === "ready" && adu && lot && !isConversion;
  const outlineLL = useMemo(() => (aduXY ? aduXY.map(([x, y]) => projector.toLatLng(x, y)) : null), [aduXY, projector]);
  const nearest = fit && fit.nearestIdx >= 0 ? structures[fit.nearestIdx] : null;
  const overlapping = fit && fit.overlapIdx >= 0 ? structures[fit.overlapIdx] : null;
  const structuresLL = useMemo(() => structures.map((s) => ({ ring: s.ring, label: s.label })), [structures]);

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
            {place ? <><span className="pin">●</span> {place.label}</> : (
              <>Start with your address. <button className="link-btn inline" onClick={loadExample}>Or try an example property</button></>
            )}
          </div>
          {phase === "loading" && <p className="note">Finding the property lines…</p>}
          {phase === "out" && <p className="note warn">{message}</p>}
          {phase === "trace" && (
            <div className="note">
              {traceTarget === "lot" ? (
                <><b>Trace your lot.</b> We couldn't pull the property lines for this address automatically. Tap each corner of the lot on the map, then press Done.</>
              ) : (
                <><b>Outline a building or pool.</b> Tap each corner on the map, then press Done.</>
              )}
              <div className="trace-actions">
                <button className="btn btn-light btn-sm" onClick={() => setTrace((t) => t.slice(0, -1))} disabled={!trace.length}>Undo</button>
                {traceTarget === "structure" && <button className="btn btn-light btn-sm" onClick={cancelTrace}>Cancel</button>}
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
                  <div className="model-meta">{heightLabel(m)}</div>
                </div>
                <div className="model-dims">{m.shape === "L" ? `${m.widthFt}′×${m.depthFt}′ L` : `${m.widthFt}′×${m.depthFt}′`}</div>
              </button>
            ))}
          </div>
          <p className="size-note">Sizes are exterior dimensions; living area is roughly 10% less. Covered porches are extra.</p>
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
          {isConversion ? (
            <div className="fit fit-info">
              <div className="fit-title">Converts your existing garage</div>
              <div className="fit-body">
                {model.name} turns a two-car garage (about {model.widthFt}′×{model.depthFt}′) into a one-bedroom unit, so there's nothing new to place in the yard and no setback check. We confirm the garage's size and condition on the site visit.
              </div>
            </div>
          ) : (
            <>
              <p className="hint">Drag the box on the map, or tap a spot on the lot. The white edge is the front door. It can't cross the property line.</p>
              <div className="rotate-row">
                <button className="btn btn-light btn-sm" onClick={() => rotate(-15)} disabled={!canAct} aria-label="Rotate left 15 degrees">⟲ 15°</button>
                <button className="btn btn-light btn-sm" onClick={() => rotate(15)} disabled={!canAct} aria-label="Rotate right 15 degrees">⟳ 15°</button>
                <button className="btn btn-light btn-sm" onClick={() => rotate(90)} disabled={!canAct}>Turn 90°</button>
                <button className="btn btn-light btn-sm" onClick={squareToLot} disabled={!canAct}>Square to lot</button>
              </div>
              {canAct && fit && (
                <div className={`fit fit-${status}`}>
                  <div className="fit-title">
                    {!fit.inside ? "Outside the lot"
                      : overlapping ? `Overlaps the ${overlapping.label.toLowerCase()}`
                      : status === "tight" ? `Close to the ${nearest.label.toLowerCase()}`
                      : "Fits"}
                  </div>
                  <div className="fit-body">
                    {!fit.inside ? "It can't cross the property line. Let go and it will snap back inside."
                      : overlapping ? `It's sitting on top of the existing ${overlapping.label.toLowerCase()}. Drag it to open yard.`
                      : status === "tight" ? `${fmtFt(fit.nearestM)} from the ${nearest.label.toLowerCase()}. Most cities want about 6–10 ft between an ADU and the main house.`
                      : nearest ? `${fmtFt(fit.nearestM)} from the ${nearest.label.toLowerCase()} · ${fmtFt(fit.lotClearM)} to the closest property line.`
                      : `${fmtFt(fit.lotClearM)} to the closest property line.`}
                  </div>
                  <div className="fit-body small-print">
                    {structures.length
                      ? "Building outlines come from public records and don't include pools, sheds or patios. Make sure it doesn't overlap those."
                      : site.loaded ? "We couldn't find building outlines for this lot. Make sure it doesn't overlap your house, pool, or garage." : "Loading building outlines…"}
                  </div>
                  <div className="stats">
                    <div><b>{lotSqft ? Math.round(lotSqft).toLocaleString() : "–"}</b><span>lot sq ft</span></div>
                    <div><b>{model.sqft.toLocaleString()}</b><span>ADU sq ft</span></div>
                    <div><b>{compass(adu.heading)}</b><span>door faces</span></div>
                  </div>
                </div>
              )}
              {canAct && (
                <button className="link-btn" onClick={startStructureTrace}>
                  {structures.length ? "Missing a shed or pool? Outline it" : "Outline your house, garage or pool"}
                </button>
              )}
            </>
          )}
          {notice && <p className="note warn" role="status">{notice}</p>}
        </section>

        <section className="step actions">
          <div className="step-label"><span>4</span> See it and get a quote</div>
          <div className="action-grid">
            <button className="btn btn-dark" disabled={!canAct || !GOOGLE_KEY || mapsFailed} onClick={() => setShow3D(true)} title={isConversion ? "Garage conversions use your existing garage" : undefined}>View in 3D</button>
            <button className="btn btn-dark" onClick={() => setShowAR(true)}>See it in your yard</button>
          </div>
          <button className="btn btn-primary btn-block" onClick={() => setShowQuote(true)}>Request a quote</button>
        </section>

        <footer className="fine">
          Building outlines from FEMA's USA Structures data; property lines from {lot?.source === "traced" ? "your tracing" : `${lot?.county || "county"} County public records`}. For planning only. Your city's setback, separation and size rules apply; we confirm them before you build.
        </footer>
      </aside>

      <main className="stage">
        {GOOGLE_KEY && !mapsFailed && (
          <MapEditor
            visible={view === "map"}
            projector={projector}
            origin={origin}
            lotRing={lot?.ring}
            structures={structuresLL}
            adu={adu}
            aduXY={aduXY}
            doorXY={doorXY}
            status={status}
            tracing={phase === "trace"}
            tracePts={trace}
            onAduMove={(m) => moveAdu({ ...m, src: "map" })}
            onMapClick={onMapClick}
            onError={() => { setMapsFailed(true); setView("plan"); }}
          />
        )}
        {(view === "plan" || !GOOGLE_KEY || mapsFailed) && (
          <PlanEditor
            projector={projector}
            lotXY={lotXY}
            structures={structures}
            streetEdge={streetEdge}
            adu={adu}
            aduXY={aduXY}
            doorXY={doorXY}
            status={status}
            tracing={phase === "trace"}
            traceXY={traceXY}
            onAduMove={(m) => moveAdu({ ...m, src: "plan" })}
            onMapClick={onMapClick}
          />
        )}

        {!lot && phase !== "trace" && (
          <div className="start-card">
            <h2>Start with your address</h2>
            <p>Type your property address in the search box. We'll pull up your lot lines and existing buildings, then you can try plans in your back yard.</p>
            <button className="btn btn-light" onClick={loadExample}>Try an example property</button>
          </div>
        )}
        {GOOGLE_KEY && !mapsFailed && lot && (
          <div className="view-toggle" role="group" aria-label="Map view">
            <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Satellite</button>
            <button className={view === "plan" ? "on" : ""} onClick={() => setView("plan")}>Site plan</button>
          </div>
        )}
        {(!GOOGLE_KEY || mapsFailed) && (
          <div className="stage-note">{mapsFailed ? "Satellite map unavailable: check the Google Maps key. Showing the site plan." : "Site plan view. Satellite imagery and 3D turn on once the Google Maps key is added."}</div>
        )}

        {show3D && adu && aduXY && (
          <View3D
            position={aduLatLng}
            heading={adu.heading}
            src={src}
            outline={outlineLL}
            lotRing={lot?.ring}
            heightM={model.heightFt * FT}
            overlap={overlapping?.label || null}
            onClose={() => setShow3D(false)}
          />
        )}
      </main>

      {showAR && <ARModal model={model} style={styleId} src={src} onClose={() => setShowAR(false)} />}
      {showQuote && (
        <QuoteModal
          onClose={() => setShowQuote(false)}
          summary={{
            model: `${model.name} (${model.kind}, ${model.sqft} sq ft)`,
            style: styleName,
            address: place?.label || "Not entered",
            placement: isConversion ? "Converts existing garage" : adu ? `Door faces ${compass(adu.heading)}` : "",
            clearance: isConversion ? "n/a (garage conversion)" : fit?.inside ? `${fmtFt(fit.lotClearM)} to property line${nearest ? `, ${fmtFt(fit.nearestM)} to ${nearest.label.toLowerCase()}` : ""}` : "not placed",
            lat: aduLatLng?.lat,
            lng: aduLatLng?.lng,
          }}
        />
      )}
    </div>
  );
}

// Footprint in meters (for placement/fit) plus the front-door segment.
function shapeOf(m) {
  const pts = footprintFt(m).map(([x, f]) => [x * FT, f * FT]);
  const d = doorFt(m);
  const door = [[(d.x - d.w / 2) * FT, d.f * FT], [(d.x + d.w / 2) * FT, d.f * FT]];
  return { pts, door };
}

function FootprintIcon({ model }) {
  const s = 30 / 46;
  const pts = footprintFt(model).map(([x, f]) => `${17 + x * s},${17 - f * s}`).join(" ");
  return (
    <svg className="fp" viewBox="0 0 34 34" width="34" height="34" aria-hidden="true">
      <polygon points={pts} strokeLinejoin="round" />
    </svg>
  );
}
