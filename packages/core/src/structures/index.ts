/**
 * Plugins de structure (`StructureKind`) : registre, plugins bois du jalon 3a et métal des
 * jalons 3b, 3c et 5b.
 *
 * Plugins intégrés, enregistrés au chargement : `wood-housed` (limons à la française, poteaux
 * d'angle), `wood-cut` (crémaillères, escalier droit), `steel-flat` (limons acier en plat
 * découpé laser, supports, marches bois ou en tôle pliée Z / U), `steel-profile` (limons en
 * profilés du commerce UPN / IPN / IPE / HEA, jalon 3c), `steel-curved` (limon de jour
 * débillardé soudé, tôle roulée par tronçons, jalon 5b), `steel-central` (limon central
 * métal : tube ou caisson, droit, débillardé ou hélicoïdal, consoles ou supports pliés,
 * QUESTIONS A29) et `wood-central` (limon central bois : crémaillère centrale massive ou en
 * lamellé-collé, cintrée sur moule sur les tournants et l'hélicoïdal, A29 vague 2).
 */
import { registerStructure, getStructure } from "./registry.js";
import { WOOD_CUT } from "./woodCut.js";
import { STEEL_FLAT } from "./steelFlat.js";
import { STEEL_PROFILE } from "./steelProfile.js";
import { STEEL_CURVED } from "./steelCurved.js";
import { STEEL_CENTRAL } from "./steelCentral.js";
import { WOOD_CENTRAL } from "./woodCentral.js";
import { WOOD_HOUSED } from "./woodHoused.js";
import { registerHelicalCore } from "./helicalCore.js";

export {
  StructureError,
  getStructure,
  listStructures,
  newelRequiredStructures,
  registerStructure,
  structureAcceptsLayout,
  structureLateralThickness,
  structureLayouts,
  structureRequiresNewel,
  structureUnsupportedOptions,
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
  requiredCentralResidual,
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
  ensureMass,
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
  profileFlangeWidth,
  profileNewel,
  profileNewelFits,
  type ProfileNewel,
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
  CENTRAL_RULES,
  CENTRAL_SECTION_KINDS,
  CENTRAL_SUPPORT_KINDS,
  STEEL_CENTRAL,
  SteelCentralParamsSchema,
  buildSteelCentral,
  resolveDiaphragmMinSpacing,
  centralUnsupportedOptions,
  effectiveCentralFixing,
  type CentralSectionKind,
  type CentralSupport,
  type CentralSupportKind,
  type SteelCentralParams,
  type SteelCentralResult,
} from "./steelCentral.js";
export {
  WOOD_CENTRAL,
  WOOD_CENTRAL_RULES,
  WOOD_CENTRAL_SECTION_KINDS,
  WOOD_CENTRAL_STRENGTH_CLASSES,
  WoodCentralParamsSchema,
  buildWoodCentral,
  woodCentralCurvedLayout,
  woodCentralUnsupportedOptions,
  type WoodCentralParams,
  type WoodCentralSectionKind,
} from "./woodCentral.js";
export {
  WOOD_CENTRAL_ANCHOR_KINDS,
  WOOD_CENTRAL_CURVED_METHODS,
  resolveAnchorKind,
  resolveCurvedMethod,
  type WoodCentralAnchorKind,
  type WoodCentralCurvedMethod,
} from "./woodCentralParams.js";
export {
  WOOD_CENTRAL_SHOE_FOOT_ID,
  WOOD_CENTRAL_SHOE_HEAD_ID,
  type ShoeBeamHole,
} from "./woodCentralShoes.js";
export {
  WOOD_CENTRAL_PLATE_FOOT_ID,
  WOOD_CENTRAL_PLATE_FOOT_MARK,
  WOOD_CENTRAL_PLATE_FOOT_WEB_ID,
  WOOD_CENTRAL_PLATE_FOOT_WEB_MARK,
  WOOD_CENTRAL_PLATE_HEAD_ID,
  WOOD_CENTRAL_PLATE_HEAD_MARK,
  WOOD_CENTRAL_PLATE_HEAD_WEB_ID,
  WOOD_CENTRAL_PLATE_HEAD_WEB_MARK,
  buildWoodCentralEmbeddedPlates,
  resolvePlateWidth,
  type BeamKerf,
  type WoodCentralPlatesResult,
} from "./woodCentralPlates.js";
export {
  WOOD_CENTRAL_LAYER_ID_PREFIX,
  buildStackedLayers,
  resolveDressingAllowance,
  resolveLayerThickness,
  woodCentralLayerId,
  woodCentralLayerMark,
  type StackedBeamShape,
  type StackedLayer,
  type StackedLayersInput,
  type StackedLayersResult,
} from "./woodCentralLayers.js";
export {
  ec5Spacing,
  woodCentralBoltSpacing,
  type Ec5Spacing,
  type WoodCentralBoltSpacing,
  type WoodFastenerType,
} from "./woodSpacing.js";
export {
  WOOD_CENTRAL_BEAM_ID,
  WOOD_CENTRAL_BEAM_RULES,
  buildWoodCentralBeam,
  type WoodCentralBolt,
  type WoodCentralBeamInput,
  type WoodCentralBeamResult,
  type WoodCentralFcba,
  type WoodCentralLamination,
  type WoodCentralSeat,
} from "./woodCentralBeam.js";
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
if (!getStructure(STEEL_CENTRAL.kind)) registerStructure(STEEL_CENTRAL);
if (!getStructure(WOOD_CENTRAL.kind)) registerStructure(WOOD_CENTRAL);
// Jalon 5a (hélicoïdal à fût central) : plugin défini et exporté par `helicalCore.ts`.
registerHelicalCore();
export { newelTopWithHandrail } from "./newel.js";
