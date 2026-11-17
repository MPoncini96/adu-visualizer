// Lighting debug panel for the walk-in tour: open any tour with ?light=debug.
// Sliders change the levels live; "Copy URL" gives a link with the current values as query
// parameters (the same ones createTour reads), so a good setting can be pasted into the defaults
// in lib/tourEngine.js. "Before" reloads with ?light=legacy (the Oct 2026 lighting).
const SLIDERS = [
  ["exp", "Exposure outdoors", 0.2, 3, 0.01],
  ["expIn", "Exposure inside (baked)", 0.5, 6, 0.05],
  ["expLive", "Exposure inside (live)", 0.3, 4, 0.05],
  ["lm", "Lightmap intensity ×", 0, 3, 0.05],
  ["envBaked", "Probe fill (baked)", 0, 3, 0.05],
  ["env", "Probe fill (live)", 0, 3, 0.05],
  ["studio", "Studio HDRI (probe+studio / studio)", 0, 3, 0.05],
  ["sun", "Sun", 0, 8, 0.1],
  ["hemi", "Hemisphere outdoors", 0, 1.5, 0.01],
  ["hemiIn", "Hemisphere inside (baked)", 0, 1, 0.01],
  ["hemiLive", "Hemisphere inside (live)", 0, 1.5, 0.01],
];
const PARAM = { exp: "exp", expIn: "expin", expLive: "explive", lm: "lm", envBaked: "envb", env: "env", studio: "studio", sun: "sun", hemi: "hemi", hemiIn: "hemiin", hemiLive: "hemilive" };

export function mountLightDebug(canvas, L) {
  const host = canvas.parentElement || document.body;
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;top:8px;right:8px;z-index:60;width:250px;max-height:calc(100% - 16px);overflow:auto;background:rgba(20,22,24,.86);color:#eee;font:12px/1.3 system-ui,sans-serif;padding:8px 10px;border-radius:8px;";
  for (const ev of ["pointerdown", "pointermove", "touchstart", "touchmove", "mousedown", "wheel", "keydown"]) box.addEventListener(ev, (e) => e.stopPropagation());
  const row = (html) => { const d = document.createElement("div"); d.style.margin = "4px 0"; d.innerHTML = html; box.appendChild(d); return d; };
  const go = (light) => { const u = new URL(location.href); u.searchParams.set("light", light); location.href = u.toString(); };

  const head = row(`<b>Lighting</b> <span style="opacity:.7">${L.legacy ? "BEFORE (Oct)" : "after"}</span>
    <button data-b style="float:right">${L.legacy ? "Show after" : "Show before"}</button>`);
  head.querySelector("[data-b]").onclick = () => go(L.legacy ? "debug" : "legacy");
  const stat = row("");

  const sel = (label, key, opts, onChange) => {
    const d = row(`${label} <select style="float:right">${opts.map((o) => `<option${o === L.LV[key] ? " selected" : ""}>${o}</option>`).join("")}</select>`);
    d.querySelector("select").onchange = (e) => { L.LV[key] = e.target.value; onChange?.(); L.apply(); };
  };
  if (!L.legacy) {
    sel("Tone mapping", "tone", ["aces", "agx", "neutral"]);
    sel("Indoor fill", "fill", ["auto", "probe", "probe+studio", "studio", "none"]);
  }
  const bk = row(`<label><input type="checkbox" ${L.bakeOn ? "checked" : ""} ${L.baked ? "" : "disabled"}> Baked lightmap${L.baked ? "" : " (none for this plan)"}</label>`);
  bk.querySelector("input").onchange = (e) => L.setBake(e.target.checked);

  for (const [key, label, min, max, step] of SLIDERS) {
    const d = row(`<div>${label} <span style="float:right" data-v>${L.LV[key]}</span></div><input type="range" min="${min}" max="${max}" step="${step}" value="${L.LV[key]}" style="width:100%">`);
    const v = d.querySelector("[data-v]");
    d.querySelector("input").oninput = (e) => { L.LV[key] = +e.target.value; v.textContent = e.target.value; L.apply(); };
  }
  const cp = row(`<button style="width:100%">Copy URL with these values</button>`);
  cp.querySelector("button").onclick = async () => {
    const u = new URL(location.href);
    for (const [k, p] of Object.entries(PARAM)) u.searchParams.set(p, String(L.LV[k]));
    if (!L.legacy) { u.searchParams.set("tone", L.LV.tone); u.searchParams.set("fill", L.LV.fill); }
    try { await navigator.clipboard.writeText(u.toString()); cp.querySelector("button").textContent = "Copied"; } catch { console.log(u.toString()); }
  };

  const timer = setInterval(() => {
    stat.textContent = `${Math.round(L.fps)} fps · ${L.calls} draws · exposure ${L.exposure.toFixed(2)} · fill ${L.fill}`;
  }, 500);
  host.appendChild(box);
  return { remove() { clearInterval(timer); box.remove(); } };
}
