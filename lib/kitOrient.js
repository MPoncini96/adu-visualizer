// Which way the furniture kit's models face, in one place for the tour and the checks.
// The kit (public/models/furniture-kit.glb) was modelled facing -Z: a sofa's seat, a chair's seat
// and a bed's foot point -Z, backrests and headboards are at +Z. The tour's rotation rule
// (FACE_ANGLE in lib/floorplan.js) assumes a piece's front is +Z, so every kit model is turned
// 180° when it loads. scripts/check-kit.mjs (run by every build) measures the backrests to keep
// this honest; until Nov 2026 the turn was missing and every sofa and chair sat backwards.
export const KIT_YAW = Math.PI;

// turn one kit geometry (centred on its own origin) so its front is +Z
export function orientKitGeometry(geo) {
  geo.rotateY(KIT_YAW);
  geo.computeBoundingBox();
  return geo;
}

// Seats whose backrest tells their facing; used by the checks.
export const SEATS = ["sofa", "armchair", "chair", "deskChair"];
