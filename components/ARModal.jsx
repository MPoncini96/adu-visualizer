"use client";
// 3D model preview + "see it in your yard" AR (Android Scene Viewer / WebXR, iOS Quick Look).
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { STYLES } from "../lib/models.js";

export default function ARModal({ model, style, src, onClose }) {
  const [ready, setReady] = useState(false);
  const [qr, setQr] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    import("@google/model-viewer").then(() => setReady(true));
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("model", model.id);
    url.searchParams.set("style", style);
    url.searchParams.set("ar", "1");
    QRCode.toDataURL(url.href, { margin: 1, width: 180, color: { dark: "#1d2a22", light: "#ffffff" } }).then(setQr);
  }, [model.id, style]);

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
        <div className="ar-body">
          <div className="mv-wrap">
            {ready && (
              <model-viewer
                src={src}
                alt={`${model.name} ADU 3D model`}
                camera-controls
                auto-rotate
                shadow-intensity="1"
                exposure="1.05"
                environment-image="neutral"
                camera-orbit="35deg 70deg auto"
                ar
                ar-modes="webxr scene-viewer quick-look"
                ar-placement="floor"
                ar-scale="fixed"
                style={{ width: "100%", height: "100%", background: "linear-gradient(#eef2ea, #dfe5d8)" }}
              >
                <button slot="ar-button" className="btn btn-primary ar-btn">See it in your yard</button>
              </model-viewer>
            )}
          </div>
          <aside className="ar-side">
            {isMobile ? (
              <p>Tap <b>See it in your yard</b>, point your phone at the ground, and the ADU appears at full size. Walk around it.</p>
            ) : (
              <>
                <p>Full-size AR works on a phone. Scan this to open {model.name} on your phone, then stand in your yard.</p>
                {qr && <img src={qr} alt="QR code to open the AR view on a phone" width={180} height={180} />}
              </>
            )}
            <p className="muted small">Placeholder design for the demo. Final plans, finishes and sizes come from the builder.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
