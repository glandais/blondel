/**
 * Utilitaires de projet : lecture (migrations + validation), sérialisation stable, préréglages
 * de base et de démonstration.
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
  DEMO_PRESET_DESCRIPTIONS,
  DEMO_PRESET_IDS,
  DEMO_PRESET_LABELS,
  createDemoProject,
  isDemoPresetId,
  type DemoPresetId,
} from "./presetDemo.js";
export {
  HELICAL_DEFAULT_CORE_RADIUS,
  HELICAL_DEFAULT_OUTER_RADIUS,
  HELICAL_MAX_LANDING_ANGLE,
  HelicalSweepError,
  createHelicalProject,
  createHelicalProjectWithFallback,
  type HelicalPresetResult,
} from "./presetHelical.js";
export { defaultOpening } from "./defaultOpening.js";
export { DEFAULT_NEWEL_SIZE, suggestFixes, type FixSuggestion } from "./fixes.js";
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
export {
  matchingFlightsPreset,
  realignBlocker,
  realignFlightsAndOpening,
  type RealignOptions,
  type RealignResult,
} from "./realign.js";
export { ruleOverrideOf, withoutRuleOverride, withRuleOverride } from "./overrides.js";
