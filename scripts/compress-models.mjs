// Compresses tour-only models with meshopt (EXT_meshopt_compression). Safe to re-run: files that are
// already compressed are skipped.   node scripts/compress-models.mjs [files...]
// Only for models the walk-in tour loads (three.js has the decoder). The exterior models
// (public/models/<plan>-<style>.glb) stay uncompressed: Google Maps 3D (the visualizer's 3D view)
// and Android Scene Viewer (AR) load those directly.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, weld, dedup, prune } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["public/models/furniture-kit.glb"];
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
for (const f of files) {
  const before = readFileSync(f);
  const doc = await io.readBinary(new Uint8Array(before));
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "EXT_meshopt_compression")) { console.log(`${f}: already compressed`); continue; }
  await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const after = await io.writeBinary(doc);
  writeFileSync(f, after);
  console.log(`${f}: ${(before.length / 1024).toFixed(0)} KB -> ${(after.length / 1024).toFixed(0)} KB`);
}
