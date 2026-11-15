// Bakes the lighting of every floor plan (or the ones named) into public/bake/.
//   1. start the site:   npm run build && npx next start -p 3200
//   2. in another shell: node scripts/bake-lighting.mjs [cherry almond ...]
// Needs Playwright's Chromium (npx playwright install chromium) and the Blender Python module
// (pip install bpy, Blender 5.x). Takes a few minutes per plan on a laptop CPU.
// Each plan gets <id>.json (atlas size, light intensity, and the plan's bake key) and <id>.webp.
// The tour only uses a bake whose key matches the current plan, so a stale bake is harmless:
// the tour falls back to live lighting and `npm run check:plans` lists it.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS } from "../lib/models.js";
import { bakeKey, layoutKey } from "../lib/lightmap.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "bake");
const base = process.env.BAKE_URL || "http://localhost:3200";
const samples = process.env.BAKE_SAMPLES || "256";
const python = process.env.PYTHON || "python3";
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const tmp = join(tmpdir(), "adu-bake");
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const m of MODELS) {
  if (only.length && !only.includes(m.id)) continue;
  const plan = JSON.parse(readFileSync(join(here, "..", "lib", "floorplans", `${m.id}.json`)));
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.setDefaultTimeout(180000);
  await page.goto(`${base}/visualizer?model=${m.id}&tour=1&nobake=1&quality=low`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__tour?.engine, null, { timeout: 180000 });
  const res = await page.evaluate(async () => {
    const { glb, atlas } = await window.__tour.engine.exportBake();
    let bin = ""; const u = new Uint8Array(glb);
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { b64: btoa(bin), atlas };
  });
  await page.close();
  const glbPath = join(tmp, `${m.id}.glb`);
  writeFileSync(glbPath, Buffer.from(res.b64, "base64"));
  const outBase = join(tmp, m.id);
  console.log(`${m.id}: exported (${(res.b64.length * 0.75 / 1e6).toFixed(1)} MB), atlas ${res.atlas.size}px at ${res.atlas.density.toFixed(1)} texels/m; baking...`);
  writeFileSync(`${outBase}.rects.json`, JSON.stringify(res.atlas.rects));
  execFileSync(python, [join(here, "bake", "bake.py"), "--", glbPath, outBase, String(res.atlas.size), samples, `${outBase}.rects.json`], { stdio: ["ignore", "inherit", "inherit"] });
  const scale = JSON.parse(readFileSync(`${outBase}.scale.json`));
  execFileSync(python, ["-c", `from PIL import Image; Image.open(${JSON.stringify(outBase + ".png")}).save(${JSON.stringify(join(out, m.id + ".webp"))}, quality=90, method=6)`]);
  writeFileSync(join(out, `${m.id}.json`), JSON.stringify({ key: bakeKey(plan, m), layout: layoutKey(res.atlas.rects), image: `${m.id}.webp`, size: res.atlas.size, intensity: +scale.intensity.toFixed(4), samples: +samples, baked: new Date().toISOString().slice(0, 10) }, null, 1) + "\n");
  console.log(`${m.id}: done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
