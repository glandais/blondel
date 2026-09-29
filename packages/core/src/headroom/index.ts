/**
 * Échappée (CHALLENGE G4) : ligne de pente, échappée exacte sur Γ et sur la largeur des marches.
 */
export { slopeExceedsFrom, slopeProfileOf, slopeZ, type SlopeProfile } from "./profile.js";
export {
  ceilingOf,
  computeHeadroom,
  coveredIntervals,
  headroomOnWalkline,
  headroomOnWidth,
  openingPolygon,
  type HeadroomAnalysis,
  type HeadroomOnWalkline,
} from "./headroom.js";
export { requiredOpening, type RequiredOpening } from "./required.js";
export { selfCoveredHeadroom, type SelfCoverInput } from "./selfcover.js";
export {
  circularOpening,
  helicalHeadroomBound,
  type HelicalHeadroomBound,
  type HelicalHeadroomInput,
} from "./helical.js";
