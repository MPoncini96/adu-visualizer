"use client";
// Full-screen walk-in tour of a plan's interior. three.js and the furniture kit load only
// when this opens (lib/tourEngine.js is a separate chunk).
import { useEffect, useMemo, useRef, useState } from "react";
import { STYLES } from "../lib/models.js";
import { floorPlanFor } from "../lib/floorplans/index.js";
import { ROOM_BUTTONS, roomLabel } from "../lib/floorplan.js";
import FloorPlanSVG, { planSvgY } from "./FloorPlanSVG.jsx";

export default function InteriorTour({ model, styleId, heading = 180, onStyle, onClose, onAR }) {
  const plan = floorPlanFor(model.id);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const markerRef = useRef(null);
  const joyRef = useRef(null);
  const unlockedAt = useRef(0);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [room, setRoom] = useState(null);
  const [bigMap, setBigMap] = useState(false);
  const [style, setStyle] = useState(styleId);
  const [touch, setTouch] = useState(false);
  const [fps, setFps] = useState(null);
  const debug = typeof window !== "undefined" && new URLSearchParams(location.search).has("tourdebug");

  const buttons = useMemo(() => {
    if (!plan) return [];
    return ROOM_BUTTONS.flatMap((b) => {
      const rooms = plan.rooms.filter((r) => r.type === b.type);
      return rooms.map((r) => ({ id: r.id, label: rooms.length > 1 ? r.name : r.type === "bedroom" && r.name !== "Bedroom" ? r.name : b.label }));
    });
  }, [plan]);

  // boot the engine
  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    const t0 = performance.now();
    const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    setTouch(isTouch);
    import("../lib/tourEngine.js")
      .then(({ createTour }) =>
        createTour({
          canvas: canvasRef.current, plan, model, styleId: style, heading, mobile: isTouch,
          onPose: (p, f) => {
            const m = markerRef.current;
            if (m) {
              m.style.display = "";
              m.setAttribute("transform", `translate(${p.x} ${planSvgY(plan, model, p.y)}) rotate(${(-p.yaw * 180) / Math.PI})`);
            }
            if (debug) setFps(Math.round(f));
          },
          onRoom: (r) => setRoom(r),
        }))
      .then((engine) => {
        if (cancelled) { engine.dispose(); return; }
        engineRef.current = engine;
        window.__tour = { engine, loadMs: Math.round(performance.now() - t0) };
        setStatus("ready");
      })
      .catch((e) => { console.error(e); if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; engineRef.current?.dispose(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id]);

  // exterior style changes rebuild the shell (siding seen through windows and at the door)
  useEffect(() => {
    if (status === "ready" && engineRef.current) engineRef.current.setStyle(style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  // keyboard + pointer lock (desktop)
  useEffect(() => {
    const down = (e) => {
      if (e.target.closest?.("input, textarea")) return;
      // Esc first releases mouse-look (the browser does that); a second Esc leaves the tour
      if (e.code === "Escape" && !document.pointerLockElement && performance.now() - unlockedAt.current > 400) { onClose(); return; }
      const eng = engineRef.current;
      if (!eng) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
        eng.keys.add(e.code);
        setStarted(true);
        e.preventDefault();
      }
    };
    const up = (e) => engineRef.current?.keys.delete(e.code);
    const blur = () => engineRef.current?.keys.clear();
    const lockChange = () => {
      const on = document.pointerLockElement === canvasRef.current;
      if (!on) unlockedAt.current = performance.now();
      setLocked(on);
    };
    const move = (e) => { if (document.pointerLockElement === canvasRef.current) engineRef.current?.look(e.movementX, e.movementY, 0.0022); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("pointerlockchange", lockChange);
    document.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("pointerlockchange", lockChange);
      document.removeEventListener("mousemove", move);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [onClose]);

  function enterLook() {
    setStarted(true);
    if (!touch) canvasRef.current?.requestPointerLock?.()?.catch?.(() => {});
  }

  // drag to look, tap/click the floor to walk there (touch, or mouse when not pointer-locked)
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (locked) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) d.moved = true;
    if (d.moved) engineRef.current?.look(dx, dy, touch ? 0.0045 : 0.003);
    d.x = e.clientX; d.y = e.clientY;
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || performance.now() - d.t > 450) return;
    setStarted(true);
    engineRef.current?.tapAt(e.clientX, e.clientY);
  };

  // left-thumb joystick
  const joyStart = (e) => {
    e.stopPropagation();
    const el = joyRef.current;
    el.setPointerCapture(e.pointerId);
    setStarted(true);
    joyMove(e);
  };
  const joyMove = (e) => {
    if (!joyRef.current?.hasPointerCapture(e.pointerId)) return;
    const r = joyRef.current.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    const eng = engineRef.current;
    if (eng) { eng.joy.x = dx; eng.joy.y = dy; }
    joyRef.current.style.setProperty("--jx", `${dx * R * 0.55}px`);
    joyRef.current.style.setProperty("--jy", `${dy * R * 0.55}px`);
  };
  const joyEnd = () => {
    const eng = engineRef.current;
    if (eng) { eng.joy.x = 0; eng.joy.y = 0; }
    joyRef.current?.style.setProperty("--jx", "0px");
    joyRef.current?.style.setProperty("--jy", "0px");
  };

  if (!plan) return null;
  const styleName = STYLES.find((s) => s.id === style)?.name;

  return (
    <div className={`tour ${touch ? "is-touch" : "is-desktop"} ${locked ? "is-locked" : ""}`} role="dialog" aria-label={`Walk inside ${model.name}`}>
      <canvas
        ref={canvasRef}
        className="tour-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      />

      <div className="tour-top">
        <div className="tour-title">
          <b>{model.name}</b>
          <span>{room ? roomLabel(room) : "Front porch"}</span>
        </div>
        <button className="tour-close" onClick={onClose} aria-label="Leave the tour">×</button>
      </div>

      <div className="tour-rooms" role="group" aria-label="Go to a room">
        {buttons.map((b) => (
          <button key={b.id} className={room?.id === b.id ? "on" : ""} onClick={() => { setStarted(true); engineRef.current?.goToRoom(b.id); }}>{b.label}</button>
        ))}
        <button onClick={() => engineRef.current?.reset()} title="Back to the front door">Entry</button>
      </div>

      <div className={`tour-map ${bigMap ? "big" : ""}`}>
        <FloorPlanSVG ref={markerRef} plan={plan} model={model} labels={bigMap} onPick={(x, y) => { setStarted(true); engineRef.current?.walkTo(x, y); }} />
        <button className="tour-map-toggle" onClick={() => setBigMap((v) => !v)}>{bigMap ? "Smaller" : "Floor plan"}</button>
      </div>

      <div className="tour-side">
        <div className="tour-styles" role="group" aria-label="Exterior style">
          {STYLES.map((s) => (
            <button key={s.id} className={s.id === style ? "on" : ""} onClick={() => { setStyle(s.id); onStyle?.(s.id); }} title={s.name} aria-label={s.name} aria-pressed={s.id === style}>
              <span className="swatch" style={{ background: s.swatch }} />
            </button>
          ))}
        </div>
        {onAR && <button className="tour-ar" onClick={() => onAR(style)}>Walk it in your yard (AR)</button>}
      </div>

      <p className="tour-note">Sample layout · {styleName}. The builder finalizes the design.</p>

      {touch && (
        <div ref={joyRef} className="tour-joy" onPointerDown={joyStart} onPointerMove={joyMove} onPointerUp={joyEnd} onPointerCancel={joyEnd} aria-label="Walk joystick">
          <span />
        </div>
      )}

      {status === "loading" && <div className="tour-msg"><div className="spinner" />Building the {model.name}…</div>}
      {status === "error" && <div className="tour-msg">The walk-in tour couldn't load on this device. <button className="btn btn-light btn-sm" onClick={onClose}>Back</button></div>}
      {status === "ready" && !started && (
        <button className="tour-start" onClick={enterLook}>
          <b>Step inside</b>
          {touch
            ? <span>Left thumb to walk · drag to look · tap the floor to go there</span>
            : <span>Click to look around · W A S D or arrows to walk · Esc to exit</span>}
        </button>
      )}
      {status === "ready" && started && !locked && !touch && (
        <button className="tour-hint" onClick={enterLook}>Click here for mouse-look · or drag to look, click the floor to walk</button>
      )}
      {locked && <div className="tour-cross" aria-hidden="true" />}
      {debug && fps != null && <div className="tour-fps">{fps} fps</div>}
    </div>
  );
}
