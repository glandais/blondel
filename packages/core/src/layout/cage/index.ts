/**
 * Moteur de tracé d'une cage (tracé libre, ADR-0010) : repères, jonctions, tronçons, conversion
 * depuis et vers un tracé à volées.
 */
export { computeCageLayout, needsGeneralEngine, type CageLayoutOptions } from "./cage.js";
export { computeGeneralCageLayout, generalCagePieces } from "./general.js";
export type { CageOrigin } from "./section.js";
export {
  cageToFlights,
  checkFlightsTopology,
  flightsToCage,
  type FlightsShape,
} from "./fromFlights.js";
export {
  isExactAngle,
  junctionSweep,
  rotateBasis,
  START_BASIS,
  tanHalf,
  type Basis,
  type SectionFrame,
} from "./frames.js";
export { WALL_SHARP_WARNING_ANGLE } from "./junction.js";
export { cagePieces, type CagePiece } from "./overlap.js";
