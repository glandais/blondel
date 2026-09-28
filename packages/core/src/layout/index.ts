/**
 * Étape « Tracé » du pipeline : bords, ligne de foulée, tournants, emprise.
 */
export { computeLayout, type LayoutOptions } from "./layout.js";
export { LayoutError } from "./errors.js";
export {
  AUTO_GOING_MODULE,
  RISER_COUNT_MAX,
  RISER_COUNT_MIN,
  resolveLegLengths,
  resolveRiserCount,
  resolveStraightRun,
  resolveTargetGoing,
  resolveWalklineOffset,
} from "./resolve.js";
