# Walk-in tour checks

Three layers, from cheapest to most thorough:

| Command | When it runs | What it checks |
|---|---|---|
| `npm run check:plans` | every `npm run build` (the build fails on a problem) | **Floor-plan data** (`lib/planCheck.js`): furniture against walls, sofas facing the TV (5–14 ft), no overlaps, door landings, 36" paths, kitchen triangle, labels… plus **the furniture kit's facing** (`scripts/check-kit.mjs`): the sofa, armchair, chair and desk-chair models must have their backrests behind them once the tour turns them (`lib/kitOrient.js`) |
| `npm run check:tour` | by hand after changing plans, furniture or the tour engine (needs a build; ~2 min for all 10 plans) | **What the tour actually draws**, in headless Chromium: every seat faces the way the plan says (measured from the 3D geometry: the backrest has to be on its back side) and every sofa faces its TV; every outlet and light switch has a wall surface right behind it |
| `npm run shots -- <dir> <plan>` | by hand | Screenshots of each room + draw calls / texture memory (see `docs/lighting.md`) |

`npm run check:tour -- cherry almond` checks just those plans. It starts the built site on :3200 if
nothing is running there.

## Fixed Nov 16, 2026

- **Sofas and chairs facing backwards (all plans).** The furniture kit was modelled facing −Z, but the
  tour's rotation rule assumes a piece's front is +Z, so every kit sofa, dining chair and desk chair
  sat with its back to the TV/table. The October "same facing" check compared the engine's assumption
  with itself, so it passed. Now the kit is turned 180° on load (`lib/kitOrient.js`), and both checks
  above measure the actual geometry.
- **Floating outlets.** Outlets were spaced along each room's rectangle, including edges that open
  into another room with no wall (living into kitchen/dining). Now outlets and switches are placed
  only where a full-height wall is behind them (`onRealWalls` in `lib/tourEngine.js`).

Result: 33 seats and 160 outlets/switches across the 10 plans, all passing.
