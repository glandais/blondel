/**
 * Utilitaires de projet : lecture (migrations + validation), sérialisation stable, préréglages.
 */
export { ProjectParseError, formatPath, type ProjectIssue } from "./errors.js";
export {
  PROJECT_MIGRATIONS,
  migrateProjectJson,
  type JsonObject,
  type Migration,
} from "./migrations.js";
export { parseProject, parseProjectText, type ParseProjectOptions } from "./parse.js";
export { serializeProject, stableStringify } from "./serialize.js";
export {
  ALL_PRESET_IDS,
  HELICAL_PRESET_IDS,
  OPPOSITE_TURNS_PRESET_IDS,
  PRESET_HEADROOM_MIN,
  PRESET_IDS,
  PRESET_LABELS,
  PRESET_OPENING_CLEARANCE,
  createProject,
  deepMerge,
  growAlongStairEdges,
  type DeepPartial,
  type FlightsPresetId,
  type PresetId,
  type PresetOptions,
} from "./presets.js";
export {
  HELICAL_DEFAULT_CORE_RADIUS,
  HELICAL_DEFAULT_OUTER_RADIUS,
  HELICAL_MAX_LANDING_ANGLE,
  createHelicalProject,
} from "./presetHelical.js";
export {
  DEFAULT_NEWEL_SIZE,
  NEWEL_REQUIRED_STRUCTURES,
  suggestFixes,
  type FixSuggestion,
} from "./fixes.js";
export {
  DEFAULT_NEWEL,
  expectedNewel,
  newelLabel,
  newelMatches,
  newelSatisfies,
  withNewels,
  type NewelInner,
} from "./newel.js";
export {
  PROFILE_NEWEL_ITERATIONS,
  applyStructureChoice,
  resolveProfileNewel,
  type ResolvedProfileNewel,
  type StructureChoiceResult,
} from "./structureChoice.js";
