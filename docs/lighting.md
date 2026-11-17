# Walk-in tour lighting

How light works in the walk-in tour (`lib/tourEngine.js`), how to tune it, and how to re-bake.

## The pieces

| Light | What it does | Where |
|---|---|---|
| **Sky HDRI** (Poly Haven "Noon Grass", CC0, 1k HDR) | Reflections and light on the outside of the house; sky for the bake | `public/hdri/noon_grass_1k.hdr` |
| **Window view** (same panorama, 2k LDR JPEG) | `scene.background`, seen through the windows | `public/hdri/noon_grass_bg.jpg` |
| **Baked lightmap** (Blender Cycles) | Sky light through the windows, the sun's bounce light, and furniture contact shadows on the walls, trim, floors, tile and ceilings. Irradiance only: the surfaces keep their own textures | `public/bake/<plan>.ktx2` (or `.webp`) + `.json` |
| **Light probe** | One bounce of the lit room rendered into an environment map at load (128 px): fill and reflections on furniture, fixtures and other movable things. Without a bake it's captured while the studio HDRI lights the room (`probe+studio`) | made in the browser |
| **Studio HDRI** (Poly Haven "Studio Small 09", CC0) | Neutral indoor fill when a plan has no current bake: lights the room for the probe capture (only downloaded then) | `public/hdri/studio_small_09_1k.hdr` |
| **Sun** (one directional light, shadow map drawn once) | Sun patches through the windows. Stays live because it turns with the house's heading on the lot, so it can't be baked; the bake clamps the sun out of the HDRI so it isn't counted twice | `createTour` |
| **Hemisphere** | Sky/ground fill outdoors only (0.3, keeps the porch soffit from going black); off indoors, where the bake/probe replace it | `createTour` |
| **N8AO** (desktop only) | Screen-space ambient occlusion | `createTour` |

Renderer: ACES Filmic tone mapping, sRGB output, physically based light units (three r183 has no legacy
mode). Exposure adapts: 0.85 outdoors, 2.6 inside a baked plan, 1.0 inside an unbaked one.

Phones (`quality=low`, the default on touch devices): no N8AO, no live mirrors, 2048 shadow map, pixel ratio ≤ 1.5.

## Tuning: `?light=debug`

Open any tour with `?light=debug` (e.g. `/walk?model=cherry&light=debug`, then "Walk inside") for a panel with:

- **Show before / Show after**: reloads with `?light=legacy` (the Oct 2026 lighting: 256 px sky HDR,
  hemisphere light on indoors) or the current lighting
- tone mapping (ACES / AgX / Neutral), indoor fill (auto / probe / probe+studio / studio / none), baked lightmap on/off
- sliders for exposure (outdoors, inside baked, inside live), lightmap intensity, probe and studio
  fill, sun and hemisphere
- **Copy URL with these values**: the same settings as query parameters (`exp`, `expin`, `explive`,
  `lm`, `envb`, `env`, `studio`, `sun`, `hemi`, `hemiin`, `hemilive`, `tone`, `fill`). Put good values into
  the `LV` defaults in `createTour` (`lib/tourEngine.js`)

Other test parameters: `quality=low|high`, `nobake`, `tourdebug` (fps readout).

## Re-baking (when a plan changes)

The tour only uses a bake whose key matches the plan JSON, footprint and lightmap layout
(`lib/lightmap.js` `bakeKey`/`layoutKey`). A stale bake is harmless (the tour falls back to live light
and the studio fill) and `npm run check:plans` (run by every build) lists it:

```
Note: baked lighting missing or out of date for cherry (plan changed since the bake). Run: npm run bake -- cherry
```

Re-bake after changing a floor plan, a footprint in `lib/models.js`, wall/trim/floor geometry in the
tour engine, or the HDRI.

### Requirements (your PC, not Vercel)

The bake runs locally; Vercel only serves the results in `public/bake/`. Commit them.

- **Blender 4.2 or newer** (tested with Blender 5.3 via the `bpy` module). Either:
  - the Blender app: set `BLENDER` to its path, e.g. in PowerShell
    `$env:BLENDER = "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"`
    (or have `blender` on the PATH), or
  - the Python module: `pip install bpy` (needs the exact Python version that bpy release is built
    for, e.g. Python 3.13 for bpy 5.3; check pypi.org/project/bpy)
- Playwright's Chromium: `npx playwright install chromium`
- `npm install` (brings `ktx2-encoder` and `sharp`)

### Commands

```
npm run build                    # once: the bake exports geometry from the built site
npm run bake                     # all 10 plans
npm run bake -- cherry almond    # just these
```

`npm run bake` starts the site on :3200 if nothing answers there (or point `BAKE_URL` at one that's
running). Options: `BAKE_SAMPLES` (default 256), `BAKE_FORMAT=ktx2|webp` (default ktx2), `BAKE_HDRI`.
Time: two passes (sky, then sun bounce) at 256 samples each. In the 2-CPU cloud workspace Cherry took
about 30 minutes; a desktop CPU with more cores is several times faster.

For each plan it:

1. opens `/visualizer?model=<plan>&tour=1&nobake=1` in headless Chromium and exports the static
   geometry as a glb (`exportBakeScene`): `bake_walls/trim/floor/tile/ceiling` carry the lightmap UV
   (second UV map, a packed atlas computed in `lib/lightmap.js`, so the app and Blender always agree);
   `occ_*` meshes (furniture, exterior, fence, ground) only block and bounce light; `portal_glass`
   is the window glass
2. runs `scripts/blender/bake_lightmaps.py`:
   ```
   blender -b --python scripts/blender/bake_lightmaps.py -- --in plan.glb --out plan_baked.glb \
       --hdri public/hdri/noon_grass_1k.hdr --size 1024 [--samples 256 --rects rects.json --denoise oidn]
   ```
   It sets the world to the HDRI with the sun clamped out, turns each window pane into a Cycles light
   portal (cleaner sky light through windows), adds a lightmap UV with Smart UV Project to any
   `bake_` mesh that doesn't already have one, and bakes DIFFUSE (no color, so the app's textures
   stay separate) in two passes:
   - **sky**: direct + indirect light from the HDRI (sun clamped out)
   - **sun bounce** (`--sun-dir`, from the tour's sun at the default heading): a sun lamp carrying the
     energy the clamp removed, INDIRECT only. The direct sun stays live in the tour; without this
     pass the rooms come out sky-blue, because nothing else supplies the warm light off sunlit floors

   Then it denoises with OpenImageDenoise (strips under 24 px, like trim and casings, get a small
   blur instead, since OIDN can't separate noise from detail there), re-pads each atlas patch, and
   writes the lightmap PNG (sRGB-encoded, scale in `<png>.json`) and a glb with UV2 and the lightmap
   as emissive, for checking in any glTF viewer (not used by the app; left in your temp folder)
3. encodes the lightmap to KTX2 (Basis ETC1S with mipmaps; `BAKE_FORMAT=webp` for WebP) and writes `public/bake/<plan>.json`

Re-encode a lightmap without baking: `npm run bake:encode -- ktx2 public/bake/almond.webp` (better to
re-bake: the October bakes are noisy, and ETC1S compresses noise badly).

### The flipY fix (Nov 2026)

The lightmap's top row is uv1 v = 0 (Blender's glTF import flips V, so its bake comes out that way),
so the tour must load lightmaps with `flipY = false`. Until Nov 2026 it used `flipY = true`, which put
each patch's light on a different surface; the old, heavily blurred bakes made that look like soft
shading. The fix applies to the nine October bakes too, but they're worth re-baking for the new
denoising and sun bounce.

## File sizes and GPU memory (per plan)

| | Download | GPU memory |
|---|---|---|
| Lightmap, WebP (Oct bake, noisy) | ~110 KB | ~5.6 MB (RGBA8 + mips) |
| Lightmap, KTX2 ETC1S (new default; Cherry) | 150 KB, plus the Basis transcoder once (516 KB wasm + 60 KB JS, ≈260 KB gzipped) | ~0.7 MB (stays compressed) |
| Lightmap, WebP (new bake, `BAKE_FORMAT=webp`) | 60 KB | ~5.6 MB |
| Furniture kit glb, meshopt | 431 → 141 KB | same |
| Procedural material textures, phones | — | ~66 MB → ~24 MB (512 px copies on phones; desktop unchanged) |
| Sky HDR for lighting | desktop 1.6 MB (1k); phones keep the 90 KB 256 px one (`?sky1k` forces 1k) | PMREM cube either way |
| Studio HDR (only loaded when a plan has no current bake) | 1.6 MB | PMREM cube |

KTX2 vs WebP looked the same on screen in the Cherry tests (casings, cabinets). KTX2 costs ~90 KB more
per plan plus the transcoder (fetched only when a .ktx2 is used, then cached) and saves ~5 MB of GPU
memory per plan, which matters more on phones. The app loads either format per plan, so the nine
plans still on their October WebP bakes keep working until they're re-baked.

The exterior models (`public/models/<plan>-<style>.glb`, ~120 KB) stay uncompressed on purpose: the
visualizer's Google Maps 3D view and Android Scene Viewer (AR) load them directly and may not read
Draco/meshopt.

## Before / after (Cherry, Nov 14 2026)

`docs/lighting/cherry-*-before-after.jpg`: the same views, October lighting on the left, the new
lighting on the right (desktop quality, headless Chromium with software GL). `npm run shots -- <dir> cherry`
re-takes them against a running site (`SHOT_PHONE=1` for a phone viewport, a third argument like
`light=legacy` adds query parameters). Per-view stats are in `docs/lighting/stats-*.json`:

| | Draw calls | Triangles | Material textures on GPU |
|---|---|---|---|
| Desktop, before | (not counted) | — | ~67 MB |
| Desktop, after | 42–100 | 52k–128k | ~68 MB (KTX2 lightmap; same procedural textures) |
| Phone (390×844), after | 28–57 | 49k–78k | ~24 MB |

Frame rates from the headless runs mean nothing (software GL), and this hasn't been checked on a
real phone yet: open `/walk?model=cherry&light=debug` on a phone, walk inside, and read the fps line.

## Licenses

All HDRIs are CC0 from Poly Haven; see `public/hdri/README.md`.
