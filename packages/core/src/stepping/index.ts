/**
 * Étape « Découpage » du pipeline : hauteurs, nez, balancement, marches.
 */
export { computeStepping, isDebillardeStructure, resolveM3Variant } from "./stepping.js";
export { SteppingError } from "./errors.js";
export { computeRises, type RiseSchedule } from "./rises.js";
export { placeNosings, type WalkPositions } from "./positions.js";
export { WINDERS_PER_SIDE_MAX } from "./zones.js";
export { outlineBetween, surfaceBetween } from "./treads.js";
