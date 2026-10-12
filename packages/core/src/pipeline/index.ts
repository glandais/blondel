/**
 * Pipeline complet (ADR-0002) : `buildModel(project) → Model`.
 */
export {
  EMPTY_LAYOUT,
  buildModel,
  buildPlanPreview,
  clearModelCache,
  mergeStructureChecks,
  modelCacheStats,
  type BuildModelOptions,
  type PlanPreview,
} from "./build.js";
