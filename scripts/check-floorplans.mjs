// Checks every floor plan in lib/floorplans against the layout rules in lib/planCheck.js.
// Runs before every build (npm run build) and exits with an error if any rule fails.
//   node scripts/check-floorplans.mjs            all plans
//   node scripts/check-floorplans.mjs cherry     one plan
import { readFileSync, readdirSync } from "node:fs";
import { MODELS } from "../lib/models.js";
import { checkPlan } from "../lib/planCheck.js";
import { bakeKey } from "../lib/lightmap.js";
import { existsSync } from "node:fs";

const only = process.argv.slice(2);
const dir = new URL("../lib/floorplans/", import.meta.url);
let total = 0;
for (const m of MODELS) {
  if (only.length && !only.includes(m.id)) continue;
  const file = readdirSync(dir).find((f) => f === `${m.id}.json`);
  if (!file) { console.log(`✗ ${m.name}: no floor plan file`); total++; continue; }
  const plan = JSON.parse(readFileSync(new URL(file, dir)));
  const fails = checkPlan(plan, m);
  total += fails.length;
  if (!fails.length) console.log(`✓ ${m.name}`);
  else {
    console.log(`✗ ${m.name}: ${fails.length} problem${fails.length > 1 ? "s" : ""}`);
    for (const f of fails) console.log(`    [${f.rule}] ${f.msg}`);
  }
}
if (total) { console.log(`\n${total} layout problem${total > 1 ? "s" : ""}. Fix lib/floorplans/*.json before building.`); process.exit(1); }
console.log("\nAll floor plans pass the layout rules.");

// Baked lighting is optional (the tour falls back to live light), so this only reports.
const stale = [];
for (const m of MODELS) {
  if (only.length && !only.includes(m.id)) continue;
  const plan = JSON.parse(readFileSync(new URL(`${m.id}.json`, dir)));
  const f = new URL(`../public/bake/${m.id}.json`, import.meta.url);
  if (!existsSync(f)) stale.push(`${m.id} (not baked)`);
  else if (JSON.parse(readFileSync(f)).key !== bakeKey(plan, m)) stale.push(`${m.id} (plan changed since the bake)`);
}
if (stale.length) console.log(`Note: baked lighting missing or out of date for ${stale.join(", ")}. Run: node scripts/bake-lighting.mjs ${stale.map((x) => x.split(" ")[0]).join(" ")}`);
