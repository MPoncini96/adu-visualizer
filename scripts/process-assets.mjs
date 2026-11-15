// Turns the raw downloads in assets-src/ into the small files the tour loads:
//   furniture  -> public/furniture/<key>.glb   (Draco geometry, WebP textures, simplified for phones)
//   textures   -> public/textures/<set>/{color,normal,rough}.webp
// plus public/furniture/manifest.json, public/textures/manifest.json and CREDITS.md files.
// What goes where is listed in scripts/asset-picks.json. Run: node scripts/process-assets.mjs
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, weld, prune, simplify, textureCompress, draco, resample, flatten, join } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join as pj, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = pj(here, "..");
const src = pj(rootDir, "assets-src");
const picks = JSON.parse(readFileSync(process.env.PICKS || pj(here, "asset-picks.json")));
const only = process.argv.slice(2);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.encoder": await draco3d.createEncoderModule(),
  "draco3d.decoder": await draco3d.createDecoderModule(),
});

const kb = (f) => (statSync(f).size / 1024).toFixed(0) + " KB";
const findFile = (dir, re) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).find((f) => re.test(f)) : null);

// ---------------------------------------------------------------- furniture
const furnOut = pj(rootDir, "public", "furniture");
mkdirSync(furnOut, { recursive: true });
const manifestPath = pj(furnOut, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath)) : {};
const credits = [];
for (const [key, p] of Object.entries(picks.furniture || {})) {
  if (only.length && !only.includes(key)) continue;
  const dir = p.polyhaven ? pj(src, "polyhaven", "models", p.polyhaven) : pj(src, p.dir || "");
  const file = p.file ? (p.file.startsWith("/") ? p.file : pj(rootDir, p.file)) : (() => { const f = findFile(dir, /\.(gltf|glb)$/i); return f && pj(dir, f); })();
  if (!file || !existsSync(file)) { console.log(`- ${key}: source not downloaded yet (${p.polyhaven || p.file})`); continue; }
  const doc = await io.read(file);
  // plain metal/rough materials only: sheen, transmission and the like cost a lot on phones
  for (const m of doc.getRoot().listMaterials()) {
    // velvet that gets its color from sheen: carry the sheen color into the base color
    const sh = m.getExtension("KHR_materials_sheen");
    if (sh) {
      const b = m.getBaseColorFactor(), c = sh.getSheenColorFactor();
      if (!m.getBaseColorTexture() && Math.max(b[0], b[1], b[2]) < 0.2) m.setBaseColorFactor([Math.max(b[0], c[0] * 0.55), Math.max(b[1], c[1] * 0.55), Math.max(b[2], c[2] * 0.55), b[3]]);
      m.setRoughnessFactor(Math.max(m.getRoughnessFactor(), 0.85));
    }
    for (const ext of ["KHR_materials_sheen", "KHR_materials_transmission", "KHR_materials_diffuse_transmission", "KHR_materials_volume", "KHR_materials_clearcoat", "KHR_materials_specular", "KHR_materials_iridescence", "KHR_materials_anisotropy"]) m.setExtension(ext, null);
  }
  for (const ext of doc.getRoot().listExtensionsUsed()) if (/sheen|transmission|volume|clearcoat|specular|iridescence|anisotropy|variants/i.test(ext.extensionName)) ext.dispose();
  // optional: use another of the model's own materials (e.g. a lighter fabric variant)
  for (const [from, to] of Object.entries(p.swapMaterials || {})) {
    const mats = doc.getRoot().listMaterials();
    const A = mats.find((m) => m.getName() === from), B = mats.find((m) => m.getName() === to);
    if (!A || !B) { console.log(`  ${key}: no material ${!A ? from : to}`); continue; }
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) if (prim.getMaterial() === A) prim.setMaterial(B);
  }
  // one mesh per material, welded and simplified to a phone-friendly size, textures to WebP
  await doc.transform(
    dedup(), flatten(), join(), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: p.ratio ?? 0.5, error: p.error ?? 0.0008 }),
    resample(), prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", quality: 82, resize: [p.tex ?? 1024, p.tex ?? 1024] }),
    draco({ method: "edgebreaker", quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  const out = pj(furnOut, `${key}.glb`);
  await io.write(out, doc);
  manifest[key] = { src: `${key}.glb`, fit: p.fit || "contain", rotY: p.rotY || 0, ...(p.stretch != null ? { stretch: p.stretch } : {}), ...(p.uniformHeight ? { uniformHeight: true } : {}) };
  credits.push(`- **${key}**: ${p.credit || p.polyhaven}${p.license ? ` (${p.license})` : " (Poly Haven, CC0)"}`);
  console.log(`✓ ${key}: ${kb(out)}`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
if (credits.length) writeFileSync(pj(furnOut, "CREDITS.md"), `# Furniture models\n\nProcessed by scripts/process-assets.mjs (simplified, Draco, WebP).\n\n${credits.join("\n")}\n`);

// ---------------------------------------------------------------- texture sets
const texOut = pj(rootDir, "public", "textures");
mkdirSync(texOut, { recursive: true });
const texManifestPath = pj(texOut, "manifest.json");
const texManifest = existsSync(texManifestPath) ? JSON.parse(readFileSync(texManifestPath)) : {};
const texCredits = [];
for (const [set, p] of Object.entries(picks.textures || {})) {
  if (only.length && !only.includes(set)) continue;
  const dir = p.polyhaven ? pj(src, "polyhaven", "textures", p.polyhaven) : pj(src, "ambientcg", p.ambientcg || "");
  const pick = (res) => { const f = findFile(dir, res); return f ? pj(dir, f) : null; };
  const maps = {
    color: pick(/(Diffuse|_Color|diff)[^/]*\.(jpg|png)$/i),
    normal: pick(/(nor_gl|NormalGL)[^/]*\.(jpg|png)$/i),
    rough: pick(/(Rough|Roughness)[^/]*\.(jpg|png)$/i),
  };
  if (!maps.color) { console.log(`- ${set}: texture not downloaded yet (${p.polyhaven || p.ambientcg})`); continue; }
  const outDir = pj(texOut, set);
  mkdirSync(outDir, { recursive: true });
  const entry = { dir: set, size: p.size };
  for (const [k, f] of Object.entries(maps)) {
    if (!f) continue;
    const name = `${k}.webp`;
    let img = sharp(f).resize(p.res ?? 1024, p.res ?? 1024, { fit: "fill" });
    if (k === "color" && p.tint) img = img.modulate(p.tint);
    await img.webp({ quality: k === "color" ? 84 : 90 }).toFile(pj(outDir, name));
    entry[k] = name;
  }
  texManifest[set] = entry;
  texCredits.push(`- **${set}**: ${p.polyhaven ? `Poly Haven "${p.polyhaven}"` : `ambientCG "${p.ambientcg}"`} (CC0)`);
  console.log(`✓ texture ${set}`);
}
writeFileSync(texManifestPath, JSON.stringify(texManifest, null, 1) + "\n");
if (texCredits.length) writeFileSync(pj(texOut, "CREDITS.md"), `# Textures\n\n${texCredits.join("\n")}\n`);
