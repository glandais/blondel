/**
 * Pipeline complet (ADR-0002) : `buildModel(project) → Model`.
 */
export {
  EMPTY_LAYOUT,
  buildModel,
  clearModelCache,
  mergeStructureChecks,
  modelCacheStats,
  type BuildModelOptions,
} from "./build.js";
