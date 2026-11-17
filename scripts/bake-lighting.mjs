// Bakes the lighting of every floor plan (or the ones named) into public/bake/. See docs/lighting.md.
//   npm run build            (once; the bake opens the built site)
//   npm run bake             (all plans)    or    npm run bake -- cherry almond
//
// For each plan: opens the tour in headless Chromium, exports the static geometry with its lightmap
// UVs (lib/tourEngine.js exportBakeScene), bakes it with Blender Cycles
// (scripts/blender/bake_lightmaps.py), then writes public/bake/<plan>.ktx2 (or .webp) + <plan>.json.
// The tour only uses a bake whose key matches the current plan and atlas layout, so a stale bake is
// harmless: the tour falls back to live lighting and `npm run check:plans` lists it.
//
// Environment:
//   BLENDER=<path to blender(.exe)>  run the Blender app (4.2+ / 5.x) in the background. Without it,
//                                    `blender` on the PATH is used, else Python with the bpy module.
//   PYTHON=python3                   Python with `pip install bpy` (used when no Blender app is found)
//   BAKE_SAMPLES=256  BAKE_FORMAT=ktx2|webp (default ktx2, see docs/lighting.md)  BAKE_HDRI=public/hdri/noon_grass_1k.hdr
//   BAKE_URL=http://localhost:3200   a running site; if nothing answers, `next start` is started for you
import { chromium } from "playwright";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS } from "../lib/models.js";
import { bakeKey, layoutKey } from "../lib/lightmap.js";
import { encodeLightmap } from "./lightmap-encode.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "public", "bake");
const base = process.env.BAKE_URL || "http://localhost:3200";
const samples = process.env.BAKE_SAMPLES || "256";
const format = process.env.BAKE_FORMAT || "ktx2";
const hdri = process.env.BAKE_HDRI || join(root, "public", "hdri", "noon_grass_1k.hdr");
const script = join(here, "blender", "bake_lightmaps.py");
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const work = join(tmpdir(), "adu-bake");
mkdirSync(work, { recursive: true });

// how to run Blender: the app in background mode, or Python with the bpy module
function blenderCommand() {
  const tryRun = (cmd, a) => { try { return spawnSync(cmd, a, { stdio: "ignore", timeout: 60000 }).status === 0; } catch { return false; } };
  if (process.env.BLENDER) return { cmd: process.env.BLENDER, pre: ["-b", "--factory-startup", "--python", script, "--"] };
  if (tryRun("blender", ["-b", "--version"])) return { cmd: "blender", pre: ["-b", "--factory-startup", "--python", script, "--"] };
  const py = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  if (tryRun(py, ["-c", "import bpy"])) return { cmd: py, pre: [script, "--"] };
  console.error("No Blender found: install Blender 4.2+ and set BLENDER=<path to blender>, or `pip install bpy` (needs the Python version bpy is built for).");
  process.exit(1);
}

// a running site to export from (start one if needed)
let server = null;
async function up() { try { return (await fetch(base, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }
if (!(await up())) {
  if (!existsSync(join(root, ".next", "BUILD_ID"))) { console.error(`Nothing at ${base} and no build: run \`npm run build\` first.`); process.exit(1); }
  const port = new URL(base).port || "3200";
  console.log(`starting the site on :${port}...`);
  server = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", port], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await up())) { server.kill(); console.error("the site didn't start"); process.exit(1); }
}

const blender = blenderCommand();
console.log(`Blender: ${blender.cmd}${blender.pre[0] === "-b" ? "" : " (bpy module)"}; ${samples} samples; HDRI ${hdri}; output ${format}`);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const report = [];
try {
  for (const m of MODELS) {
    if (only.length && !only.includes(m.id)) continue;
    const plan = JSON.parse(readFileSync(join(root, "lib", "floorplans", `${m.id}.json`)));
    const t0 = Date.now();
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.setDefaultTimeout(300000);
    await page.goto(`${base}/visualizer?model=${m.id}&tour=1&nobake=1&quality=low`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__tour?.engine, null, { timeout: 300000 });
    const res = await page.evaluate(async () => {
      const { glb, atlas, sunDir } = await window.__tour.engine.exportBake();
      let bin = ""; const u = new Uint8Array(glb);
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return { b64: btoa(bin), atlas, sunDir };
    });
    await page.close();
    const glbIn = join(work, `${m.id}.glb`);
    writeFileSync(glbIn, Buffer.from(res.b64, "base64"));
    writeFileSync(join(work, `${m.id}.rects.json`), JSON.stringify(res.atlas.rects));
    console.log(`${m.id}: exported (${(statSync(glbIn).size / 1e6).toFixed(1)} MB), atlas ${res.atlas.size}px at ${res.atlas.density.toFixed(1)} texels/m; baking...`);
    const glbOut = join(work, `${m.id}_baked.glb`), png = join(work, `${m.id}.png`);
    execFileSync(blender.cmd, [...blender.pre, "--in", glbIn, "--out", glbOut, "--hdri", hdri, "--size", String(res.atlas.size),
      "--samples", samples, "--rects", join(work, `${m.id}.rects.json`), "--lightmap", png, `--sun-dir=${res.sunDir.map((v) => v.toFixed(5)).join(",")}`], { stdio: ["ignore", "inherit", "inherit"] });
    const meta = JSON.parse(readFileSync(`${png}.json`));
    const image = await encodeLightmap(png, join(out, m.id), format);
    for (const ext of ["ktx2", "webp"]) if (!image.endsWith(ext) && existsSync(join(out, `${m.id}.${ext}`))) rmSync(join(out, `${m.id}.${ext}`));
    writeFileSync(join(out, `${m.id}.json`), JSON.stringify({
      key: bakeKey(plan, m), layout: layoutKey(res.atlas.rects), image, size: res.atlas.size, intensity: +meta.intensity.toFixed(4),
      samples: +samples, denoise: meta.denoise, portals: meta.portals, baked: new Date().toLocaleDateString("en-CA"),
    }, null, 1) + "\n");
    const kb = (statSync(join(out, image)).size / 1024).toFixed(0);
    report.push(`${m.id}: ${image} ${kb} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    console.log(`${m.id}: done (${report.at(-1)}); baked glb for inspection: ${glbOut}`);
  }
} finally {
  await browser.close();
  server?.kill();
}
console.log(report.join("\n"));
