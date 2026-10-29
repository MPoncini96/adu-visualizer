"use client";
// 3D model preview + "see it in your yard" AR (Android Scene Viewer / WebXR, iOS Quick Look).
// "Walk-in" mode swaps in the furnished interior (built on the fly from the floor plan, 1:1 scale)
// so visitors can stand in their yard and walk into the rooms.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { STYLES } from "../lib/models.js";
import { floorPlanFor } from "../lib/floorplans/index.js";

export default function ARModal({ model, style, src, walkIn = false, onMode, onClose }) {
  const [ready, setReady] = useState(false);
  const [qr, setQr] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [walkSrc, setWalkSrc] = useState(null);
  const [walkErr, setWalkErr] = useState(false);
  const plan = floorPlanFor(model.id);
  const showWalk = walkIn && !!plan;

  useEffect(() => {
    import("@google/model-viewer").then(() => setReady(true));
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("model", model.id);
    url.searchParams.set("style", style);
    url.searchParams.set("ar", "1");
    if (showWalk) url.searchParams.set("walk", "1");
    QRCode.toDataURL(url.href, { margin: 1, width: 180, color: { dark: "#1d2a22", light: "#ffffff" } }).then(setQr);
  }, [model.id, style, showWalk]);

  // build the walk-in GLB (cut-away house + furnished rooms) when that mode is on
  useEffect(() => {
    if (!showWalk) return;
    let url = null, cancelled = false;
    setWalkSrc(null);
    setWalkErr(false);
    import("../lib/tourEngine.js")
      .then(({ exportWalkInGLB }) => exportWalkInGLB({ plan, model, styleId: style }))
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setWalkSrc(url);
      })
      .catch((e) => { console.error(e); if (!cancelled) setWalkErr(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [showWalk, model, plan, style]);

  const viewSrc = showWalk ? walkSrc : src;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="3D model and AR">
        <div className="modal-head">
          <div>
            <h2>{model.name}</h2>
            <p className="muted">{model.kind} · {model.sqft.toLocaleString()} sq ft · {STYLES.find((s) => s.id === style)?.name}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {plan && onMode && (
          <div className="seg ar-mode" role="group" aria-label="What to show">
            <button className={!showWalk ? "on" : ""} onClick={() => onMode(false)}>Outside</button>
            <button className={showWalk ? "on" : ""} onClick={() => onMode(true)}>Walk-in (furnished)</button>
          </div>
        )}
        <div className="ar-body">
          <div className="mv-wrap">
            {ready && viewSrc && (
              <model-viewer
                key={viewSrc}
                src={viewSrc}
                alt={`${model.name} ADU 3D model`}
                camera-controls
                auto-rotate={showWalk ? undefined : ""}
                shadow-intensity="1"
                exposure="1.05"
                environment-image="neutral"
                camera-orbit={showWalk ? "30deg 55deg auto" : "35deg 70deg auto"}
                ar
                ar-modes="webxr scene-viewer quick-look"
                ar-placement="floor"
                ar-scale="fixed"
                style={{ width: "100%", height: "100%", background: "linear-gradient(#eef2ea, #dfe5d8)" }}
              >
                <button slot="ar-button" className="btn btn-primary ar-btn">{showWalk ? "Walk into it in your yard" : "See it in your yard"}</button>
              </model-viewer>
            )}
            {showWalk && !walkSrc && <div className="mv-msg">{walkErr ? "Couldn't build the walk-in model on this device." : "Furnishing the rooms…"}</div>}
          </div>
          <aside className="ar-side">
            {isMobile ? (
              <p>Tap <b>{showWalk ? "Walk into it in your yard" : "See it in your yard"}</b>, point your phone at the ground, and the ADU appears at full size. {showWalk ? "Walk through the front door to see the rooms." : "Walk around it."}</p>
            ) : (
              <>
                <p>Full-size AR works on a phone. Scan this to open {model.name}{showWalk ? " (walk-in)" : ""} on your phone, then stand in your yard.</p>
                {qr && <img src={qr} alt="QR code to open the AR view on a phone" width={180} height={180} />}
              </>
            )}
            <p className="muted small">{showWalk ? "Sample layout and furniture. The builder finalizes the design." : "Placeholder design for the demo. Final plans, finishes and sizes come from the builder."}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
