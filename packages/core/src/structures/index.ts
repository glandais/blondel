/**
 * Plugins de structure (`StructureKind`) : registre et plugins bois du jalon 3a.
 *
 * Plugins intégrés, enregistrés au chargement : `wood-housed` (limons à la française, poteaux
 * d'angle) et `wood-cut` (crémaillères, escalier droit).
 */
import { registerStructure, getStructure } from "./registry.js";
import { WOOD_CUT } from "./woodCut.js";
import { WOOD_HOUSED } from "./woodHoused.js";

export {
  StructureError,
  getStructure,
  listStructures,
  registerStructure,
  unregisterStructure,
} from "./registry.js";
export {
  EN16481_MIN_HOUSING_DEPTH,
  WOOD_HOUSED,
  WoodHousedParamsSchema,
  buildWoodHoused,
  stockOf,
  stringerFaces,
  type HousedResult,
  type HousedStringer,
  type ResolvedHousedParams,
  type StringerFace,
  type WoodHousedParams,
} from "./woodHoused.js";
export {
  WOOD_CUT,
  WoodCutParamsSchema,
  buildWoodCut,
  type CarriageDetail,
  type CutResult,
  type WoodCutParams,
} from "./woodCut.js";
export {
  CREMAILLERE_RULE_ID,
  fcbaTable,
  parseFcbaTable,
  requiredResidual,
  type FcbaTable,
  type StrengthClass,
} from "./fcba.js";
export {
  QUANTITY_LENGTH_MM,
  QUANTITY_MASS_KG,
  QUANTITY_STOCK_VOLUME_M3,
  QUANTITY_SURFACE_M2,
  QUANTITY_VOLUME_M3,
  normalizeWoodQuantities,
  woodQuantities,
  type WoodMeasures,
} from "./quantities.js";
export { FAB_RULES, pluginRuleDef, toRuleResult, type PluginRuleSpec } from "./checks.js";
export {
  developStringer,
  housingPolygons,
  housingsInside,
  minCheek,
  minWoodBetween,
  toFlatPattern,
  type Housing,
  type HousingSpec,
  type StringerDevelopment,
  type StringerDevelopmentInput,
} from "./development.js";
export { extendIntoFaces, pocketInterval } from "./housing.js";
export { minAreaRect, isSimplePolygon, type OrientedBox } from "./geom.js";

if (!getStructure(WOOD_HOUSED.kind)) registerStructure(WOOD_HOUSED);
if (!getStructure(WOOD_CUT.kind)) registerStructure(WOOD_CUT);
