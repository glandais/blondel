/**
 * Prédimensionnement indicatif (CHALLENGE P5, jalon 3c) : poutre inclinée sur deux appuis,
 * charges de l'annexe nationale, flèche, contrainte, fréquence propre. **Ne remplace pas une
 * note de calcul.**
 */
export {
  GRAVITY,
  PRECHECK_LIMITS,
  analyzeInclinedBeam,
  passesPrecheck,
  type BeamSection,
  type InclinedBeamInput,
  type InclinedBeamResult,
} from "./beam.js";
export {
  PRECHECK_LABEL,
  PRECHECK_RULES,
  PRECHECK_RULE_IDS,
  precheckResults,
  type PrecheckedBeam,
} from "./checks.js";
export {
  AN_STAIR_LOADS,
  EN16481_DEFAULT_LOADS,
  resolveCategory,
  stairLoads,
  type StairLoads,
} from "./loads.js";
export {
  DEFAULT_PRECHECK_SETTINGS,
  LOAD_CATEGORIES,
  PRECHECK_PROVENANCE,
  PrecheckSettingsSchema,
  GLULAM_SPECIES_WOOD_CLASS,
  GLULAM_WOOD_CLASSES,
  STEEL_E,
  WOOD_CLASSES,
  WOOD_CLASS_PROPERTIES,
  WOOD_CLASS_SETTINGS,
  resolveWoodClass,
  steelMaterialOf,
  steelYield,
  woodMaterialOf,
  type BeamMaterial,
  type LoadCategory,
  type PrecheckProvenance,
  type PrecheckSettings,
  type WoodClass,
  type WoodClassOptions,
  type WoodClassSetting,
} from "./settings.js";
export { grainAngle, hankinsonFactor } from "./grain.js";
export {
  activeContexts,
  gradeInLabel,
  permanentAreaLoad,
  precheckModel,
  precheckStringers,
  structurePrecheckSettings,
  type StringerPrecheck,
} from "./stringers.js";
