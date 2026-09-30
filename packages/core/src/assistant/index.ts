/**
 * Assistant d'initialisation (prompt 2 §3, SPEC §2.2, CHALLENGE G8).
 */
export { proposeDesigns, resolveStructureIntent } from "./propose.js";
export { selectDiverse, shapeKey, type SelectionOptions } from "./select.js";
export { ASSISTANT_DEFAULTS, DEFAULT_SCORE_WEIGHTS } from "./defaults.js";
export {
  assistantContexts,
  boundsQuantity,
  enumerationBounds,
  goingRange,
  quantityBounds,
  riserCountRange,
  type BoundedQuantity,
  type EnumerationBounds,
  type GoingRange,
  type QuantityBounds,
  type RuleBound,
} from "./bounds.js";
export {
  REJECTION_LABELS,
  TYPOLOGY_IDS,
  TYPOLOGY_LABELS,
  TURN_POSITION_LABELS,
  type AssistantInput,
  type AssistantLimits,
  type AssistantPreferences,
  type AssistantResult,
  type AssistantStats,
  type DesignCandidate,
  type ModelSummary,
  type RejectionReason,
  type RejectionTally,
  type ScoreBreakdown,
  type ScoreTerm,
  type ScoreWeights,
  type StructureIntent,
  type TypologyId,
} from "./types.js";
