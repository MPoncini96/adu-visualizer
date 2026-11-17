// Checks that the furniture kit's seats face +Z once the tour has turned them (lib/kitOrient.js):
// each seat's backrest (its tallest quarter) must sit on its -Z side. Run by `npm run check:plans`
// and every build. Catches a re-exported kit that faces a different way, which would turn every
// sofa and chair in every plan around.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { readFileSync } from "node:fs";
import { orientKitGeometry, SEATS } from "../lib/kitOrient.js";

const buf = readFileSync(new URL("../public/models/furniture-kit.glb", import.meta.url));
const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), "", res, rej));
const problems = [];
const found = new Set();
gltf.scene.traverse((o) => {
  if (!o.isMesh || !SEATS.includes(o.name)) return;
  found.add(o.name);
  o.updateMatrix();
  const geo = o.geometry.clone().applyMatrix4(o.matrix);
  orientKitGeometry(geo);
  const p = geo.attributes.position, bb = geo.boundingBox, h = bb.max.y - bb.min.y, depth = bb.max.z - bb.min.z;
  let sz = 0, n = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > bb.max.y - h * 0.25) { sz += p.getZ(i); n++; }
  const back = (sz / n - (bb.min.z + bb.max.z) / 2) / depth; // < 0: backrest behind, front +Z
  if (!(back < -0.05)) problems.push(`${o.name}: backrest at ${back > 0 ? "+" : ""}${back.toFixed(2)} of its depth (should be behind, < -0.05), so it would face backwards in the tour`);
});
for (const s of SEATS) if (!found.has(s)) problems.push(`${s}: not in furniture-kit.glb`);
if (problems.length) {
  console.error("Furniture kit orientation problems:\n  " + problems.join("\n  ") + "\nFix KIT_YAW in lib/kitOrient.js (or the kit export).");
  process.exit(1);
}
console.log(`Furniture kit: ${SEATS.length} seat models face +Z in the tour.`);
