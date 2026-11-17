// Screenshots of the walk-in tour for comparing lighting changes (same rooms, same views).
//   1. start the site:   npm run build && npx next start -p 3200
//   2. node scripts/lighting-shots.mjs <out-dir> [plan] [extra query, e.g. "light=legacy"]
// Writes <out-dir>/<plan>-<room>.png for every room plus the front yard, and stats.json with
// draw calls, triangles, textures and GPU texture memory per view (Chromium, software GL).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outDir = "shots", planId = "cherry", extra = ""] = process.argv.slice(2);
const base = process.env.SHOT_URL || "http://localhost:3200";
const phone = process.env.SHOT_PHONE === "1";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage(phone
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/visualizer?model=${planId}&tour=1${extra ? "&" + extra : ""}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__tour?.engine, null, { timeout: 240000 });
const loadMs = await page.evaluate(() => window.__tour.loadMs);
// only the 3D view in the pictures (no overlays); ?light=debug keeps its panel
await page.addStyleTag({ content: "body *{visibility:hidden !important} canvas, canvas ~ div[style*='z-index:60'], canvas ~ div[style*='z-index:60'] *{visibility:visible !important}" });
const only = (process.env.SHOT_ROOMS || "").split(",").filter(Boolean);

async function settle() {
  // let exposure adaptation and the light probe finish (software GL is slow: wait on frames, not time)
  await page.evaluate(() => new Promise((res) => { let n = 0; const f = () => (++n > 32 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
}
async function stats() {
  return page.evaluate(async () => {
    const e = window.__tour.engine, r = e.renderer;
    // count every pass of one frame (the AO composer renders several times per frame)
    r.info.autoReset = false; r.info.reset();
    const N = 6; // average over a few frames (the tour renders once per animation frame)
    await new Promise((res) => { let n = 0; const f = () => (++n >= N ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    r.info.autoReset = true;
    const info = { calls: Math.round(r.info.render.calls / N), triangles: Math.round(r.info.render.triangles / N), textures: r.info.memory.textures, geometries: r.info.memory.geometries, fps: Math.round(e.fps) };
    // estimate GPU memory of every texture the scene uses
    const seen = new Set(); let bytes = 0;
    const add = (t) => {
      if (!t || seen.has(t)) return; seen.add(t);
      const img = t.image; const w = img?.width || img?.[0]?.width || 0, h = img?.height || img?.[0]?.height || 0;
      const compressed = t.isCompressedTexture;
      const bpp = compressed ? 1 : t.type === 1016 ? 8 : 4; // ETC/ASTC ~1 B/px, half float 8, RGBA8 4
      bytes += w * h * bpp * (t.generateMipmaps || compressed ? 1.33 : 1) * (t.isCubeTexture ? 6 : 1);
    };
    e.scene.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) for (const k of ["map", "lightMap", "normalMap", "roughnessMap", "aoMap", "envMap"]) add(m[k]); });
    info.textureMB = +(bytes / 1048576).toFixed(1);
    return info;
  });
}

const out = { plan: planId, extra, phone, loadMs, views: {} };
await settle();
await page.screenshot({ path: join(outDir, `${planId}-yard.png`) });
out.views.yard = await stats();
const rooms = (await page.evaluate(() => Object.keys(window.__tour.engine.views))).filter((r) => !only.length || only.includes(r));
for (const id of rooms) {
  await page.evaluate((id) => { window.__tourFast = 20; window.__tour.engine.goToRoom(id); }, id);
  await page.waitForFunction(() => !window.__tour.engine.walking);
  await settle();
  await page.screenshot({ path: join(outDir, `${planId}-${id}.png`) });
  out.views[id] = await stats();
}
out.errors = errors;
writeFileSync(join(outDir, "stats.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
