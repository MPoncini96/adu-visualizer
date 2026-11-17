// Checks the finished 3D walk-in tour of every plan (or the ones named), in headless Chromium:
//   1. seats: each sofa, armchair, dining chair and desk chair faces the way the floor plan says
//      (measured from the 3D geometry: the backrest must be on its back side), and every sofa faces
//      its TV
//   2. outlets and switches: each plate has a wall surface right behind it (no floating plates)
//
//   npm run build && npm run check:tour            (all plans)
//   npm run check:tour -- cherry almond
// Starts the built site on :3200 if nothing answers there (or set CHECK_URL). Exits 1 on any problem.
// lib/planCheck.js checks the floor-plan data; this checks what the tour actually draws.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS } from "../lib/models.js";
import { planToModelFrame, FACE_VEC } from "../lib/floorplan.js";
import { SEATS } from "../lib/kitOrient.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.CHECK_URL || "http://localhost:3200";
const only = process.argv.slice(2);

let server = null;
async function up() { try { return (await fetch(base, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }
if (!(await up())) {
  if (!existsSync(join(root, ".next", "BUILD_ID"))) { console.error(`Nothing at ${base} and no build: run \`npm run build\` first.`); process.exit(1); }
  server = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", new URL(base).port || "3200"], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];
let seatCount = 0, deviceCount = 0;
try {
  for (const m of MODELS) {
    if (only.length && !only.includes(m.id)) continue;
    const fr = planToModelFrame(m), FT = 0.3048;
    const page = await browser.newPage({ viewport: { width: 240, height: 160 } });
    page.setDefaultTimeout(300000);
    await page.goto(`${base}/visualizer?model=${m.id}&tour=1&quality=low&nobake=1`);
    await page.waitForFunction(() => window.__tour?.engine, null, { timeout: 300000 });
    const res = await page.evaluate(([halfW, fFront, SEATS, FACE_VEC]) => {
      const e = window.__tour.engine, sc = e.scene, FT = 0.3048;
      const toPlan = (X, Z) => [X / FT + halfW, fFront - Z / FT];
      let floorY = 0;
      sc.traverse((o) => { if (o.isMesh && o.name === "floor") { o.geometry.computeBoundingBox(); floorY = Math.max(floorY, o.geometry.boundingBox.max.y); } });
      const out = { seats: [], devices: [] };

      // 1. seats: where the backrest really is, from the furniture vertices inside each footprint
      const verts = [];
      sc.traverse((o) => { if (o.isMesh && /^furniture/.test(o.name)) { const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { const [x, y] = toPlan(P.getX(i), P.getZ(i)); verts.push([x, y, P.getY(i)]); } } });
      const items = e.items, placed = e.placed;
      const ctr = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
      const tvs = placed.filter((q) => q.key === "tv" || q.key === "tvStand").map((q) => ctr(q.rect));
      for (const q of placed) {
        if (!SEATS.includes(q.key) || q.model) continue; // real models (tourFurniture) carry their own rotY
        const [x0, y0, x1, y1] = q.rect, c = ctr(q.rect);
        const it = items.filter((i) => i.key === q.key).sort((a, b) => Math.hypot(a.x - c[0], a.y - c[1]) - Math.hypot(b.x - c[0], b.y - c[1]))[0];
        const vs = verts.filter((v) => v[0] >= x0 - 0.02 && v[0] <= x1 + 0.02 && v[1] >= y0 - 0.02 && v[1] <= y1 + 0.02 && v[2] >= floorY + q.z0 * FT - 0.01 && v[2] <= floorY + q.z1 * FT + 0.01);
        const top = floorY + q.z1 * FT, hi = vs.filter((v) => v[2] > top - (q.z1 - q.z0) * FT * 0.25);
        if (!hi.length || !it) { out.seats.push({ key: q.key, c, err: "no geometry found" }); continue; }
        const bx = hi.reduce((s, v) => s + v[0], 0) / hi.length - c[0], by = hi.reduce((s, v) => s + v[1], 0) / hi.length - c[1], bl = Math.hypot(bx, by) || 1;
        const front = [-bx / bl, -by / bl], want = FACE_VEC[it.face];
        const r = { key: q.key, c, face: it.face, matchesPlan: +(front[0] * want[0] + front[1] * want[1]).toFixed(2) };
        if (q.key === "sofa" && tvs.length) {
          const t = tvs.sort((a, b) => Math.hypot(a[0] - c[0], a[1] - c[1]) - Math.hypot(b[0] - c[0], b[1] - c[1]))[0], d = Math.hypot(t[0] - c[0], t[1] - c[1]) || 1;
          r.towardTV = +(front[0] * (t[0] - c[0]) / d + front[1] * (t[1] - c[1]) / d).toFixed(2);
        }
        out.seats.push(r);
      }

      // 2. outlets and switches: cast a short ray from each plate back toward its wall
      const tris = [];
      sc.traverse((o) => {
        if (!o.isMesh || o.name !== "walls") return;
        const P = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : P.count;
        for (let i = 0; i < n; i += 3) { const g = (k) => (idx ? idx.getX(k) : k); tris.push([g(i), g(i + 1), g(i + 2)].map((k) => [P.getX(k), P.getY(k), P.getZ(k)])); }
      });
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const hit = (o, d, maxT) => {
        for (const [A, B, C] of tris) {
          const e1 = sub(B, A), e2 = sub(C, A), h = cross(d, e2), a = dot(e1, h);
          if (Math.abs(a) < 1e-10) continue;
          const f = 1 / a, s = sub(o, A), u = f * dot(s, h); if (u < 0 || u > 1) continue;
          const q = cross(s, e1), v = f * dot(d, q); if (v < 0 || u + v > 1) continue;
          const t = f * dot(e2, q); if (t >= -0.005 && t <= maxT) return true;
        }
        return false;
      };
      for (const dv of e.devices || []) {
        // plan (x, y) -> scene (X, Z): X = (x - halfW)·FT, Z = (fFront - y)·FT; plan "into the room" n -> scene (n0, -n1)
        const o = [(dv.x - halfW) * FT, floorY + (dv.z - 0.15) * FT, (fFront - dv.y) * FT], d = [-dv.n[0], 0, dv.n[1]];
        out.devices.push({ kind: dv.kind, x: +dv.x.toFixed(2), y: +dv.y.toFixed(2), onWall: hit(o, d, 0.12) });
      }
      return out;
    }, [-fr.x(0) / FT, fr.z(0) / FT, SEATS, FACE_VEC]);
    await page.close();
    for (const s of res.seats) {
      seatCount++;
      const at = `${m.id}: ${s.key} at (${s.c.map((v) => v.toFixed(1)).join(", ")}) ft`;
      if (s.err) problems.push(`${at}: ${s.err}`);
      else if (s.matchesPlan < 0.7) problems.push(`${at} faces away from where the plan points it (${s.face}; alignment ${s.matchesPlan})`);
      else if (s.towardTV !== undefined && s.towardTV < 0.7) problems.push(`${at} doesn't face its TV (alignment ${s.towardTV})`);
    }
    const floating = res.devices.filter((d) => !d.onWall);
    deviceCount += res.devices.length;
    for (const d of floating) problems.push(`${m.id}: ${d.kind} at (${d.x}, ${d.y}) ft has no wall behind it`);
    console.log(`${m.id}: ${res.seats.length} seats, ${res.devices.length} outlets/switches${floating.length || res.seats.some((s) => s.err || s.matchesPlan < 0.7 || (s.towardTV ?? 1) < 0.7) ? " — problems" : " — ok"}`);
  }
} finally {
  await browser.close();
  server?.kill();
}
if (problems.length) { console.error(`\n${problems.length} problem(s):\n  ` + problems.join("\n  ")); process.exit(1); }
console.log(`\nAll good: ${seatCount} seats face the right way, ${deviceCount} outlets/switches are on walls.`);
