// Encodes a baked lightmap (PNG from scripts/blender/bake_lightmaps.py) for the web.
//   ktx2: Basis ETC1S with mipmaps (sRGB). The GPU keeps it compressed (ETC2/ASTC/BC1, about 1/6 of
//         the memory of a decoded WebP); three's KTX2Loader transcodes it (public/basis/).
//   webp: smaller download, but the GPU holds it as plain RGBA8 (1024² + mips ≈ 5.6 MB).
// CLI (re-encode existing lightmaps, e.g. public/bake/*.webp -> .ktx2):
//   node scripts/lightmap-encode.mjs ktx2 public/bake/almond.webp [...]
import sharp from "sharp";
import { writeFileSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function encodeLightmap(src, outBase, format = "ktx2") {
  if (format === "webp") {
    await sharp(src).webp({ quality: 90, effort: 6 }).toFile(`${outBase}.webp`);
    return `${basename(outBase)}.webp`;
  }
  const { encodeToKTX2 } = await import("ktx2-encoder");
  const png = await sharp(src).png().toBuffer();
  const ktx = await encodeToKTX2(new Uint8Array(png), {
    imageDecoder: async (b) => {
      const r = await sharp(Buffer.from(b)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: r.info.width, height: r.info.height, data: new Uint8Array(r.data) };
    },
    isUASTC: false, qualityLevel: 255, compressionLevel: 4, generateMipmap: true,
    isSetKTX2SRGBTransferFunc: true, enableDebug: false,
    isYFlip: false, // same row order as the PNG: the app loads lightmaps with flipY = false
  });
  writeFileSync(`${outBase}.ktx2`, ktx);
  return `${basename(outBase)}.ktx2`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [format, ...files] = process.argv.slice(2);
  for (const f of files) {
    const outBase = join(dirname(f), basename(f).replace(/\.[^.]+$/, ""));
    const image = await encodeLightmap(f, outBase, format);
    const metaPath = `${outBase}.json`;
    try {
      const meta = JSON.parse(readFileSync(metaPath));
      meta.image = image;
      writeFileSync(metaPath, JSON.stringify(meta, null, 1) + "\n");
    } catch { /* no metadata next to it */ }
    console.log(f, "->", image);
  }
}
