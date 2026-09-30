/**
 * Garde-corps et mains courantes (jalon 4) — API publique.
 */
export {
  FlightGuardSpecSchema,
  GUARD_MATERIALS,
  GuardInfillSchema,
  GuardPostSpecSchema,
  GuardSectionSchema,
  GuardSideModeSchema,
  GuardsSpecSchema,
  HandrailSpecSchema,
  OpeningGuardSpecSchema,
  type GuardInfill,
  type GuardSection,
  type GuardSideMode,
  type GuardsSpec,
  type GuardsSpecInput,
  type HandrailSpec,
} from "./spec.js";
export { computeGuards, landingRaise } from "./compute.js";
export {
  autoHandrailBothSides,
  HANDRAIL_BOTH_SIDES_RULE,
  smallCoreDiameter,
} from "./handrailSides.js";
export {
  guardChecks,
  JOUR_POSTS_CLASH_RULE,
  jourPostClashes,
  SLAB_CLASH_RULE,
  slabClash,
} from "./checks.js";
export { GuardError } from "./errors.js";
export { isNarrowJourNote, jourWidth, NARROW_JOUR_NOTE_KEYS, narrowJourThreshold } from "./jour.js";
export { WALL_PARALLEL_DEG } from "./sides.js";
export type {
  Foothold,
  GapMeasure,
  GuardPostFootprint,
  GuardRun,
  GuardsAnalysis,
  HandrailRun,
  NarrowJour,
  NewelHandrailTop,
  SideAnalysis,
  SideInterval,
  StairSide,
} from "./types.js";
