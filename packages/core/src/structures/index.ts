/**
 * Plugins de structure (`StructureKind`) : registre, plugins bois du jalon 3a et métal des
 * jalons 3b, 3c et 5b.
 *
 * Plugins intégrés, enregistrés au chargement : `wood-housed` (limons à la française, poteaux
 * d'angle), `wood-cut` (crémaillères, escalier droit), `steel-flat` (limons acier en plat
 * découpé laser, supports, marches bois ou en tôle pliée Z / U), `steel-profile` (limons en
 * profilés du commerce UPN / IPN / IPE / HEA, jalon 3c) et `steel-curved` (limon de jour
 * débillardé soudé, tôle roulée par tronçons, jalon 5b).
 */
import { registerStructure, getStructure } from "./registry.js";
import { WOOD_CUT } from "./woodCut.js";
import { STEEL_FLAT } from "./steelFlat.js";
import { STEEL_PROFILE } from "./steelProfile.js";
import { STEEL_CURVED } from "./steelCurved.js";
import { WOOD_HOUSED } from "./woodHoused.js";
import { registerHelicalCore } from "./helicalCore.js";

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
export {
  STEEL_FLAT,
  SteelFlatParamsSchema,
  buildSteelFlat,
  steelStringerFaces,
  type FoldedTreadDetail,
  type SteelFlatParams,
  type SteelFlatResult,
  type SteelStringer,
} from "./steelFlat.js";
export {
  developFoldedTread,
  flatLength,
  insetPlate,
  sectionPolygon,
  uSection,
  zSection,
  type BendLineInfo,
  type FlangeCheck,
  type FoldedProfile,
  type FoldedSection,
  type FoldedTreadInput,
  type FoldedTreadResult,
  type PlanLine,
  type SectionBend,
  type SectionStep,
  type USectionInput,
  type ZSectionInput,
} from "./folded.js";
export {
  boltCenters,
  effectiveFixing,
  supportDepth,
  supportInterval,
  supportPart,
  supportSection,
  supportSectionArea,
  type SupportFace,
  type SupportFixing,
  type SupportKind,
  type SupportPlacement,
  type SupportSpec,
} from "./supports.js";
export {
  IDENTICAL_TOLERANCE,
  QUANTITY_BENDS,
  QUANTITY_BEND_LENGTH_MM,
  QUANTITY_BUTT_WELD_MM,
  QUANTITY_CUTS,
  QUANTITY_HOLES,
  QUANTITY_LASER_CUT_MM,
  QUANTITY_TREATED_SURFACE_M2,
  QUANTITY_WELD_MM,
  STEEL_RULES,
  deduceExecutionClass,
  groupIdenticalFlats,
  holePolygon,
  plateMeasures,
  steelMaterial,
  steelQuantities,
  type ExecutionClassInput,
  type SteelFinish,
  type SteelMeasures,
} from "./steelCommon.js";

export {
  PROFILE_RULES,
  STEEL_PROFILE,
  SteelProfileParamsSchema,
  buildSteelProfile,
  lightestSection,
  type ProfileStringer,
  type SteelProfileParams,
  type SteelProfileResult,
} from "./steelProfile.js";
export {
  CURVED_RULES,
  QUANTITY_ROLLED_LENGTH_MM,
  STEEL_CURVED,
  SteelCurvedParamsSchema,
  buildSteelCurved,
  type CurvedArcZone,
  type CurvedJoint,
  type CurvedSegment,
  type CurvedStringerResult,
  type CurvedSupport,
  type SteelCurvedParams,
  type SteelCurvedResult,
} from "./steelCurved.js";
export {
  arcFiberLength,
  fiberDevelopment,
  jourNormal,
  naissances,
  nosingProfile,
  slopeBreakAt,
  type FiberDevelopment,
  type FiberPiece,
  type JourSide,
  type Naissance,
  type NosingProfile,
  type ProfileZone,
  type SlopeBreak,
} from "./steelCurvedGeometry.js";
export {
  cuttingPlan,
  type BarLayout,
  type CutPiece,
  type CuttingPlan,
} from "./steelProfileCutting.js";

if (!getStructure(WOOD_HOUSED.kind)) registerStructure(WOOD_HOUSED);
if (!getStructure(WOOD_CUT.kind)) registerStructure(WOOD_CUT);
if (!getStructure(STEEL_FLAT.kind)) registerStructure(STEEL_FLAT);
if (!getStructure(STEEL_PROFILE.kind)) registerStructure(STEEL_PROFILE);
if (!getStructure(STEEL_CURVED.kind)) registerStructure(STEEL_CURVED);
// Jalon 5a (hélicoïdal à fût central) : plugin défini et exporté par `helicalCore.ts`.
registerHelicalCore();
