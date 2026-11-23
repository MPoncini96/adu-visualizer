# HDRIs (all CC0, Poly Haven)

All of these come from [Poly Haven](https://polyhaven.com) and are released under
[CC0 1.0](https://polyhaven.com/license) (public domain, no attribution required; credited here anyway).

| File | What it's for | Source |
|---|---|---|
| `noon_grass_1k.hdr` (1.6 MB) | Daytime exterior light: reflections on the outside of the house, the light probe's sky, and the sky for the Blender bake (`npm run bake`) | "Noon Grass" by Greg Zaal, https://polyhaven.com/a/noon_grass (1k HDR) |
| `noon_grass_bg.jpg` (0.5 MB) | The view out the windows (2k, tone-mapped to LDR so it's sharper and lighter than the HDR) | same panorama |
| `studio_small_09_1k.hdr` (1.6 MB) | Neutral indoor fill when a plan has no current bake (`fill=studio`) | "Studio Small 09" by Sergej Majboroda, https://polyhaven.com/a/studio_small_09 (1k HDR) |
| `noon_grass_256.hdr` (0.1 MB) | The 256 px sky used before Nov 2026; only loaded for `?light=legacy` before/after comparisons | same panorama |

Downloaded Nov 14, 2026 from `dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/` (MD5 `64f0c7e8…` and `d5d7eb9d…`).
The HDRs load only when the walk-in tour opens. See `docs/lighting.md`.
