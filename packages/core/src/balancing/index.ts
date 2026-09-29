/**
 * Stratégies de balancement (M0, M1, M2, M3, M6) et post-traitement commun.
 */
export { M0_STRATEGY } from "./m0.js";
export { M1_STRATEGY, vProfileCollets } from "./m1.js";
export {
  HERSE_DEFAULT_ANGLE,
  M2_STRATEGY,
  herseAlphaBound,
  herseAlphaMax,
  herseCollets,
  herseMap,
} from "./m2.js";
export { M3_STRATEGY, zoneProfile } from "./m3.js";
export {
  M6_STRATEGY,
  ROTATION_DEFAULT_REACH,
  ROTATION_DEFAULT_STEEPNESS,
  rotationWeight,
} from "./m6.js";
export {
  buildProfile,
  evalProfile,
  invertProfile,
  isStrictlyIncreasing,
  maxSlope,
  sampledSlopeExtrema,
  slopeExtrema,
  type DevelopmentProfile,
  type EndCondition,
  type M3Variant,
  type ProfileSpec,
} from "./profile.js";
export {
  applySolution,
  colletBetween,
  cornerMonotonyBreaks,
  cornerPositions,
  findCrossings,
  firstHit,
  monotonyBreaks,
  nosingsCross,
  realizeNosing,
  type CollarEdge,
  type Collet,
  type Crossing,
  type NosingSeed,
  type NosingSpec,
  type RealizedNosing,
} from "./postprocess.js";
export { BALANCING_STRATEGIES, getBalancingStrategy, type BalancingMethodId } from "./registry.js";
