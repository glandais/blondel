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
  PRESET_HEADROOM_MIN,
  PRESET_IDS,
  PRESET_LABELS,
  createProject,
  deepMerge,
  type DeepPartial,
  type PresetId,
  type PresetOptions,
} from "./presets.js";
