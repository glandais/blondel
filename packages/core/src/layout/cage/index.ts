/**
 * Moteur de tracé d'une cage (tracé libre, ADR-0010) : repères, jonctions, tronçons, conversion
 * depuis et vers un tracé à volées.
 */
export { computeCageLayout, type CageLayoutOptions } from "./cage.js";
export type { CageOrigin } from "./section.js";
export {
  cageToFlights,
  checkFlightsTopology,
  flightsToCage,
  type FlightsShape,
} from "./fromFlights.js";
export { isExactAngle, rotateBasis, START_BASIS, type Basis, type SectionFrame } from "./frames.js";
