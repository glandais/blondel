/**
 * Présentation des paramètres des plugins de structure : libellés, unités, aides, libellés des
 * choix et regroupement par sous-objet (poteau, supports, platines, tôle pliée,
 * prédimensionnement). Présentation seulement : les valeurs par défaut, bornes et la validation
 * restent celles du plugin (`paramsSchema`). Un paramètre absent de ce dictionnaire garde le
 * libellé dérivé de sa clé (formulaire générique).
 *
 * Les textes sont des clés de `@blondel/i18n` (ADR-0007) : `presentFields` et `groupLabel`
 * reçoivent le traducteur de la langue d'affichage.
 *
 * La section d'un profilé (`steel-profile.section`) devient une liste déroulante alimentée par
 * le catalogue du cœur (`sectionsOf(family)`).
 */
import {
  LOAD_CATEGORIES,
  SECTION_FAMILIES,
  WOOD_CLASSES,
  WOOD_CLASS_SETTINGS,
  sectionsOf,
  type SectionFamily,
  type UnsupportedParamOption,
} from "@blondel/core";
import { MATERIAL_KEYS } from "@blondel/exports";
import { msg, textMessage, type MessageKey, type Translator } from "@blondel/i18n";
import type { Text } from "../i18n/text.js";
import type { ParamField, ParamPath } from "./structureForm.js";

/** Présentation d'un paramètre : textes à traduire (clés ou messages) et unité (symbole). */
export interface FieldText {
  readonly label: Text;
  readonly unit?: string;
  readonly hint?: Text;
  readonly options?: Readonly<Record<string, Text>>;
}

/** Groupes (premier segment d'un chemin imbriqué). */
export const GROUP_LABELS: Readonly<Record<string, MessageKey>> = {
  newel: "ui.param.group.newel",
  supports: "ui.param.group.supports",
  plates: "ui.param.group.plates",
  folded: "ui.param.group.folded",
  precheck: "ui.param.group.precheck",
  grainAngle: "ui.param.group.grainAngle",
  curved: "ui.param.group.curved",
  column: "ui.param.group.column",
  treads: "ui.param.group.treads",
  innerStringer: "ui.param.group.innerStringer",
  outerStringer: "ui.param.group.outerStringer",
  handrail: "ui.param.group.handrail",
  // Limon central (`steel-central`) : tracé, section et poutre.
  trace: "ui.param.group.trace",
  section: "ui.param.group.section",
  beam: "ui.param.group.beam",
  // Limon central bois (`wood-central`) : entaille arrière, boulons et tire-fonds des marches,
  // ancrages (sabot en U ou platine à âme noyée, QUESTIONS A33 (f)).
  notch: "ui.param.group.notch",
  bolts: "ui.param.group.bolts",
  lagScrews: "ui.param.group.lagScrews",
  anchors: "ui.param.group.anchorsFootHead",
};

const MM = "mm";
const TO_VALIDATE: MessageKey = "ui.param.toValidate";

/** Choix affichés tels quels (nuances, familles, classes : désignations normalisées). */
const raw = (values: readonly string[]): Readonly<Record<string, Text>> =>
  Object.fromEntries(values.map((v) => [v, textMessage(v)]));

const JOINTS: Readonly<Record<string, MessageKey>> = {
  welded: "ui.param.joint.welded",
  bolted: "ui.param.joint.bolted",
  tenon: "ui.param.joint.tenon",
  butt: "ui.param.joint.butt",
};

/** Paramètres communs aux plugins (chemin joint par des points). */
const COMMON: Readonly<Record<string, FieldText>> = {
  grade: {
    label: "ui.param.grade.label",
    hint: "ui.param.grade.hint",
    options: raw(["S235", "S355"]),
  },
  finish: {
    label: "ui.param.finish.label",
    options: {
      raw: "ui.param.finish.option.raw",
      painted: "ui.param.finish.option.painted",
      galvanized: "ui.param.finish.option.galvanized",
    },
  },
  material: { label: "ui.param.material.label", options: MATERIAL_KEYS },
  thickness: { label: "ui.param.thickness.label", unit: MM },
  // Libellés unifiés (spécification de contenu § 4) : la référence (ligne des nez) en aide.
  upperOffset: {
    label: "ui.param.upperOffset.label",
    unit: MM,
    hint: "ui.param.upperOffset.hint",
  },
  lowerOffset: {
    label: "ui.param.lowerOffset.label",
    unit: MM,
    hint: "ui.param.lowerOffset.hint",
  },
  startExtension: { label: "ui.param.startExtension.label", unit: MM },
  endExtension: { label: "ui.param.endExtension.label", unit: MM },
  splice: {
    label: "ui.param.splice.label",
    options: { welded: "ui.param.splice.option.welded", bolted: "ui.param.splice.option.bolted" },
  },
  housingDepth: { label: "ui.param.housingDepth.label", unit: MM },
  noseRadius: { label: "ui.param.noseRadius.label", unit: MM },
  // « Matériau des marches » : même libellé pour le matériau des marches de tous les plugins.
  treadKind: {
    label: "ui.label.treadMaterial",
    options: {
      wood: "ui.param.treadKind.option.wood",
      "folded-steel": "ui.param.treadKind.option.foldedSteel",
    },
  },
  family: { label: "ui.param.family.label", options: raw(SECTION_FAMILIES) },
  section: { label: "ui.param.section.label", hint: "ui.param.section.hint" },
  miterTolerance: { label: "ui.param.miterTolerance.label", unit: MM, hint: TO_VALIDATE },
  // Poteau
  "newel.section": {
    label: "ui.param.newel.section.label",
    options: {
      tube: "ui.param.newel.section.option.tube",
      flat: "ui.param.newel.section.option.flat",
    },
  },
  "newel.size": { label: "ui.param.newel.size.label", unit: MM, hint: "ui.param.newel.size.hint" },
  "newel.clearance": { label: "ui.param.newel.clearance.label", unit: MM, hint: TO_VALIDATE },
  "newel.tubeThickness": {
    label: "ui.param.newel.tubeThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "newel.joint": { label: "ui.param.newel.joint.label", options: JOINTS },
  "newel.bolts": { label: "ui.param.newel.bolts.label", hint: TO_VALIDATE },
  "newel.foot": {
    label: "ui.param.newel.foot.label",
    options: {
      floor: "ui.param.newel.foot.option.floor",
      hanging: "ui.param.newel.foot.option.hanging",
    },
  },
  "newel.bottomExtension": { label: "ui.param.newel.bottomExtension.label", unit: MM },
  "newel.topExtension": { label: "ui.param.newel.topExtension.label", unit: MM },
  "newel.tenonLength": { label: "ui.param.newel.tenonLength.label", unit: MM },
  "newel.tenonThickness": { label: "ui.param.newel.tenonThickness.label", unit: MM },
  "newel.tenonShoulder": { label: "ui.param.newel.tenonShoulder.label", unit: MM },
  // Supports de marche
  "supports.kind": {
    label: "ui.param.supports.kind.label",
    options: {
      angle: "ui.param.supports.kind.option.angle",
      plate: "ui.param.supports.kind.option.plate",
    },
  },
  "supports.fixing": {
    label: "ui.param.supports.fixing.label",
    options: {
      welded: "ui.param.supports.fixing.option.welded",
      bolted: "ui.param.supports.fixing.option.bolted",
    },
  },
  "supports.angleLeg": { label: "ui.param.supports.angleLeg.label", unit: MM, hint: TO_VALIDATE },
  "supports.angleThickness": {
    label: "ui.param.supports.angleThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.plateWidth": { label: "ui.param.supports.plateWidth.label", unit: MM },
  "supports.plateThickness": { label: "ui.param.supports.plateThickness.label", unit: MM },
  "supports.bolts": { label: "ui.param.supports.bolts.label" },
  "supports.holeDiameter": { label: "ui.param.holeDiameter.label", unit: MM },
  "supports.slotLength": { label: "ui.param.supports.slotLength.label", unit: MM },
  "supports.holeEdgeDistance": { label: "ui.param.holeEdgeDistance.label", unit: MM },
  "supports.treadScrews": { label: "ui.param.supports.treadScrews.label" },
  // Marche en tôle pliée sur son support : vissée ou soudée (QUESTIONS A31, vissée par défaut,
  // à valider), perçage des vis (M8 : 9 mm, à valider) ; `treadFixing.ts` du cœur.
  "supports.treadFixing": {
    label: "ui.param.supports.treadFixing.label",
    hint: TO_VALIDATE,
    options: {
      screwed: "ui.param.supports.treadFixing.option.screwed",
      welded: "ui.param.supports.treadFixing.option.welded",
    },
  },
  "supports.treadHoleDiameter": {
    label: "ui.param.supports.treadHoleDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.endMargin": { label: "ui.param.supports.endMargin.label", unit: MM },
  "supports.edgeMargin": { label: "ui.param.supports.edgeMargin.label", unit: MM },
  "supports.minLength": { label: "ui.param.supports.minLength.label", unit: MM },
  "supports.minBearing": {
    label: "ui.param.supports.minBearing.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Platines
  "plates.foot": { label: "ui.param.plates.foot.label" },
  "plates.head": { label: "ui.param.plates.head.label" },
  "plates.thickness": { label: "ui.param.plates.thickness.label", unit: MM },
  "plates.width": { label: "ui.param.plates.width.label", unit: MM },
  "plates.length": { label: "ui.param.plates.length.label", unit: MM },
  "plates.margin": { label: "ui.param.plates.margin.label", unit: MM },
  "plates.holeDiameter": { label: "ui.param.holeDiameter.label", unit: MM },
  "plates.holeEdgeDistance": { label: "ui.param.holeEdgeDistance.label", unit: MM },
  // Tôle pliée
  "folded.profile": { label: "ui.param.folded.profile.label", options: raw(["Z", "U"]) },
  "folded.thickness": { label: "ui.param.folded.thickness.label", unit: MM, hint: TO_VALIDATE },
  "folded.noseHeight": { label: "ui.param.folded.noseHeight.label", unit: MM },
  "folded.rearHeight": { label: "ui.param.folded.rearHeight.label", unit: MM },
  "folded.returnLength": { label: "ui.param.folded.returnLength.label", unit: MM },
  "folded.clearance": { label: "ui.param.folded.clearance.label", unit: MM },
  "folded.arrivalRiser.topOffset": {
    label: "ui.param.folded.arrivalRiser.topOffset.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "folded.arrivalRiser.fixings": {
    label: "ui.param.folded.arrivalRiser.fixings.label",
    hint: TO_VALIDATE,
  },
  "folded.arrivalRiser.holeDiameter": {
    label: "ui.param.folded.arrivalRiser.holeDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "folded.arrivalRiser.holeEdgeDistance": {
    label: "ui.param.folded.arrivalRiser.holeEdgeDistance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Prédimensionnement
  "precheck.loadSet": {
    label: "ui.param.precheck.loadSet.label",
    options: {
      AN: "ui.param.precheck.loadSet.option.AN",
      EN16481: "ui.param.precheck.loadSet.option.EN16481",
    },
  },
  "precheck.category": {
    label: "ui.param.precheck.category.label",
    options: {
      auto: "ui.param.precheck.category.option.auto",
      ...Object.fromEntries(
        LOAD_CATEGORIES.map((c) => [
          c,
          msg("ui.param.precheck.category.option.category", { category: c }),
        ]),
      ),
    },
  },
  "precheck.extraPermanent": { label: "ui.param.precheck.extraPermanent.label", unit: "kN/m²" },
  "precheck.pointLoadShare": {
    label: "ui.param.precheck.pointLoadShare.label",
    hint: "ui.param.precheck.pointLoadShare.hint",
  },
  "precheck.gammaG": { label: "ui.param.precheck.gammaG.label", hint: TO_VALIDATE },
  "precheck.gammaQ": { label: "ui.param.precheck.gammaQ.label", hint: TO_VALIDATE },
  "precheck.gammaM0": { label: "ui.param.precheck.gammaM0.label", hint: TO_VALIDATE },
  "precheck.gammaMWood": { label: "ui.param.precheck.gammaMWood.label", hint: TO_VALIDATE },
  "precheck.kmod": { label: "ui.param.precheck.kmod.label", hint: TO_VALIDATE },
  // Lamellé-collé (QUESTIONS A33 (a)) : γ_M propre aux classes GL ; classe `auto` (GL24h pour
  // l'essence lamellé-collé, D30 pour une essence feuillue, massive ou lamellée-collée, A36 (1),
  // C24 sinon) ; classes massives de l'EN 338, D30 comprise (A36 (2)).
  "precheck.gammaMGlulam": { label: "ui.param.precheck.gammaMGlulam.label", hint: TO_VALIDATE },
  "precheck.woodClass": {
    label: "ui.param.precheck.woodClass.label",
    hint: TO_VALIDATE,
    options: {
      ...raw(WOOD_CLASS_SETTINGS.filter((c) => c !== "auto")),
      auto: "ui.param.precheck.woodClass.option.autoSpecies",
    },
  },
};

/** Limon hélicoïdal intérieur ou extérieur (mêmes textes). */
function helicalStringer(group: "innerStringer" | "outerStringer"): Record<string, FieldText> {
  return {
    [`${group}.height`]: {
      label: "ui.param.helicalCore.stringer.height.label",
      unit: MM,
      hint: "ui.param.helicalCore.stringer.height.hint",
    },
    [`${group}.thickness`]: {
      label: "ui.param.helicalCore.stringer.thickness.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    [`${group}.topAboveNosing`]: {
      label: "ui.param.helicalCore.stringer.topAboveNosing.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
  };
}

/** Mêmes textes que le limon débillardé (`steel-curved.curved.*`), sens identique. */
function wreathedBeam(): Record<string, FieldText> {
  return {
    "beam.jointOffset": {
      label: "ui.param.steelCurved.curved.jointOffset.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "beam.jointSupportMargin": {
      label: "ui.param.steelCurved.curved.jointSupportMargin.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "beam.minSegmentLength": {
      label: "ui.param.steelCurved.curved.minSegmentLength.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "beam.sampleStep": {
      label: "ui.param.steelCurved.curved.sampleStep.label",
      unit: MM,
      hint: "ui.param.steelCurved.curved.sampleStep.hint",
    },
    "beam.rollLineSpacing": {
      label: "ui.param.steelCurved.curved.rollLineSpacing.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
  };
}

/**
 * Limon central métal (`steel-central`, QUESTIONS A29) : ◆ d'après les commentaires de
 * `steelCentralParams.ts` du cœur (toute valeur sans source, ou de confiance faible, est « à
 * valider ») ; sans ◆ : choix (section, type et fixation des supports, aboutage), valeurs
 * calculées (`auto`), pas d'échantillonnage sourcé (B §5.2) et marge aux ailes reprise de
 * `steel-flat`.
 */
const STEEL_CENTRAL: Readonly<Record<string, FieldText>> = {
  "trace.lateralOffset": {
    label: "ui.param.steelCentral.trace.lateralOffset.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.kind": {
    label: "ui.param.steelCentral.section.kind.label",
    options: {
      tube: "ui.param.steelCentral.section.kind.option.tube",
      box: "ui.param.steelCentral.section.kind.option.box",
    },
  },
  "section.height": {
    label: "ui.param.steelCentral.section.height.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.width": {
    label: "ui.param.steelCentral.section.width.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.wallThickness": {
    label: "ui.param.steelCentral.section.wallThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.webThickness": {
    label: "ui.param.steelCentral.section.webThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.flangeThickness": {
    label: "ui.param.steelCentral.section.flangeThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.diaphragmThickness": {
    label: "ui.param.steelCentral.section.diaphragmThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.diaphragmSpacing": {
    label: "ui.param.steelCentral.section.diaphragmSpacing.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Borne basse de l'entraxe des entretoises (QUESTIONS A32 (a)) ; `auto` : hauteur de la section.
  "section.diaphragmMinSpacing": {
    label: "ui.param.steelCentral.section.diaphragmMinSpacing.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.ventDiameter": {
    label: "ui.param.steelCentral.section.ventDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "beam.topOffset": {
    label: "ui.param.steelCentral.beam.topOffset.label",
    unit: MM,
    hint: "ui.param.steelCentral.beam.topOffset.hint",
  },
  "beam.startExtension": { label: "ui.param.startExtension.label", unit: MM, hint: TO_VALIDATE },
  "beam.endExtension": { label: "ui.param.endExtension.label", unit: MM, hint: TO_VALIDATE },
  "beam.splice": {
    label: "ui.param.splice.label",
    options: { welded: "ui.param.splice.option.welded", bolted: "ui.param.splice.option.bolted" },
  },
  ...wreathedBeam(),
  "supports.kind": {
    label: "ui.param.supports.kind.label",
    options: {
      console: "ui.param.steelCentral.supports.kind.option.console",
      "folded-u": "ui.param.steelCentral.supports.kind.option.foldedU",
      "folded-z": "ui.param.steelCentral.supports.kind.option.foldedZ",
      "folded-triangle": "ui.param.steelCentral.supports.kind.option.foldedTriangle",
    },
  },
  "supports.consoleThickness": {
    label: "ui.param.steelCentral.supports.consoleThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.foldedThickness": {
    label: "ui.param.steelCentral.supports.foldedThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.length": {
    label: "ui.param.steelCentral.supports.length.label",
    unit: MM,
    hint: "ui.param.steelCentral.supports.length.hint",
  },
  "supports.endClearance": {
    label: "ui.param.steelCentral.supports.endClearance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.bearingWidth": {
    label: "ui.param.steelCentral.supports.bearingWidth.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.bearingThickness": {
    label: "ui.param.steelCentral.supports.bearingThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.tipHeight": {
    label: "ui.param.steelCentral.supports.tipHeight.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.minHeight": {
    label: "ui.param.steelCentral.supports.minHeight.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.bolts": { label: "ui.param.supports.bolts.label", hint: TO_VALIDATE },
  "supports.holeDiameter": { label: "ui.param.holeDiameter.label", unit: MM, hint: TO_VALIDATE },
  "supports.holeEdgeDistance": {
    label: "ui.param.holeEdgeDistance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "supports.treadScrews": { label: "ui.param.supports.treadScrews.label", hint: TO_VALIDATE },
  "supports.landingSpacing": {
    label: "ui.param.steelCentral.supports.landingSpacing.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  cantileverJustification: {
    label: "ui.param.steelCentral.cantileverJustification.label",
    hint: "ui.param.steelCentral.cantileverJustification.hint",
  },
};

/**
 * Limon central bois (`wood-central`, QUESTIONS A29 vague 2) : ◆ d'après les commentaires de
 * `woodCentralParams.ts` du cœur — toute valeur sans source est « à valider » (décalage de l'axe,
 * largeur 2 × 44, reste de repli, seuil des plis minces, boulons des marches, tôle, nuance,
 * finition, dimensions, chevilles, boulons et perçages des sabots) ; sans ◆ : choix (section,
 * classe, essence, présence des sabots, décision A29 n° 5), valeurs calculées (`auto` : reste
 * sous entaille, épaisseur des lamelles, entaille arrière) et justifications.
 */
const WOOD_CENTRAL: Readonly<Record<string, FieldText>> = {
  strengthClass: {
    label: "ui.param.woodCut.strengthClass.label",
    options: {
      auto: "ui.param.woodCut.strengthClass.option.auto",
      unknown: "ui.param.woodCut.strengthClass.option.unknown",
      ...raw(["C30", "D40"]),
    },
  },
  "trace.lateralOffset": {
    label: "ui.param.steelCentral.trace.lateralOffset.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Sur un tournant ou un hélicoïdal, l'aide du choix « Bois massif » grisé est la raison du
  // cœur (`unsupportedOptions`, lue par `presentFields`).
  "section.kind": {
    label: "ui.param.woodCentral.section.kind.label",
    options: {
      glulam: "ui.param.woodCentral.section.kind.option.glulam",
      solid: "ui.param.woodCentral.section.kind.option.solid",
    },
  },
  "section.width": {
    label: "ui.param.woodCentral.section.width.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.residual": {
    label: "ui.param.woodCut.residual.label",
    unit: MM,
    hint: "ui.param.woodCentral.section.residual.hint",
  },
  "section.residualFallback": {
    label: "ui.param.woodCut.residualFallback.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.lamellaThickness": {
    label: "ui.param.woodCentral.section.lamellaThickness.label",
    unit: MM,
    hint: "ui.param.woodCentral.section.lamellaThickness.hint",
  },
  "section.thinPlyMax": {
    label: "ui.param.woodCentral.section.thinPlyMax.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Filière sur une trace courbe (QUESTIONS A33 (e)) : moule ou couches empilées ; seuil de
  // largeur et couches ◆ (aucune source sur les couches, C §1.11).
  "section.curvedMethod": {
    label: "ui.param.woodCentral.section.curvedMethod.label",
    hint: "ui.param.woodCentral.section.curvedMethod.hint",
    options: {
      auto: "ui.param.woodCentral.section.curvedMethod.option.auto",
      mould: "ui.param.woodCentral.section.curvedMethod.option.mould",
      stacked: "ui.param.woodCentral.section.curvedMethod.option.stacked",
    },
  },
  "section.mouldMaxWidth": {
    label: "ui.param.woodCentral.section.mouldMaxWidth.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.layerThickness": {
    label: "ui.param.woodCentral.section.layerThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.dressingAllowance": {
    label: "ui.param.woodCentral.section.dressingAllowance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Couches composées de plusieurs planches (QUESTIONS A35 (h)) : pente de fil maximale ◆.
  "section.maxGrainSlope": {
    label: "ui.param.woodCentral.section.maxGrainSlope.label",
    unit: "%",
    hint: TO_VALIDATE,
  },
  // Aboutage à entures des planches d'une couche composée (QUESTIONS A36 (6)) ◆.
  "section.jointOffset": {
    label: "ui.param.woodCentral.section.jointOffset.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "section.fingerLength": {
    label: "ui.param.woodCentral.section.fingerLength.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "notch.rearDepth": {
    label: "ui.param.woodCentral.notch.rearDepth.label",
    unit: MM,
    hint: "ui.param.woodCentral.notch.rearDepth.hint",
  },
  "bolts.perTread": { label: "ui.param.woodCentral.bolts.perTread.label", hint: TO_VALIDATE },
  "bolts.holeDiameter": { label: "ui.param.holeDiameter.label", unit: MM, hint: TO_VALIDATE },
  "bolts.edgeDistance": {
    label: "ui.param.woodCentral.bolts.edgeDistance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Entraxe et pinces : défauts de l'EC5 en fonction du diamètre (QUESTIONS A34 (b)), à valider.
  "bolts.minSpacing": {
    label: "ui.param.woodCentral.bolts.minSpacing.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "bolts.protrusion": {
    label: "ui.param.woodCentral.bolts.protrusion.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "bolts.lengthStep": {
    label: "ui.param.woodCentral.bolts.lengthStep.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Tire-fonds des marches basses (QUESTIONS A34 (a), C §1.11 [78]) : tout ◆.
  "lagScrews.pilotDiameter": {
    label: "ui.param.woodCentral.lagScrews.pilotDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "lagScrews.minAnchorage": {
    label: "ui.param.woodCentral.lagScrews.minAnchorage.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "lagScrews.tipCover": {
    label: "ui.param.woodCentral.lagScrews.tipCover.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "lagScrews.maxLength": {
    label: "ui.param.woodCentral.lagScrews.maxLength.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Entraxe et pince avant des tire-fonds : règles latérales et axiales de l'EC5 (A35 (l)) ◆.
  "lagScrews.minSpacing": {
    label: "ui.param.woodCentral.lagScrews.minSpacing.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "lagScrews.endDistance": {
    label: "ui.param.woodCentral.lagScrews.endDistance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Pince axiale a1,CG mesurée le long du fil (QUESTIONS A36 (4)) ◆.
  "lagScrews.threadEndDistance": {
    label: "ui.param.woodCentral.lagScrews.threadEndDistance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Ancrages : présence, type (sabot en U ou platine à âme noyée, QUESTIONS A33 (f), A34 (c)).
  "anchors.foot": { label: "ui.param.woodCentral.anchors.footAnchor.label" },
  "anchors.head": { label: "ui.param.woodCentral.anchors.headAnchor.label" },
  "anchors.kind": {
    label: "ui.param.woodCentral.anchors.kind.label",
    options: {
      auto: "ui.param.woodCentral.anchors.kind.option.auto",
      shoe: "ui.param.woodCentral.anchors.kind.option.shoe",
      embeddedPlate: "ui.param.woodCentral.anchors.kind.option.embeddedPlate",
    },
  },
  "anchors.grade": {
    label: "ui.param.woodCentral.anchors.gradeAny.label",
    hint: TO_VALIDATE,
    options: raw(["S235", "S355"]),
  },
  "anchors.finish": {
    label: "ui.param.finish.label",
    hint: TO_VALIDATE,
    options: {
      raw: "ui.param.finish.option.raw",
      painted: "ui.param.finish.option.painted",
      galvanized: "ui.param.finish.option.galvanized",
    },
  },
  "anchors.thickness": {
    label: "ui.param.woodCentral.anchors.thickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.cheekDepth": {
    label: "ui.param.woodCentral.anchors.cheekDepth.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.length": {
    label: "ui.param.woodCentral.anchors.lengthAny.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.anchors": {
    label: "ui.param.woodCentral.anchors.anchorsPerAnchor.label",
    hint: TO_VALIDATE,
  },
  "anchors.anchorHoleDiameter": {
    label: "ui.param.woodCentral.anchors.anchorHoleDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.bolts": { label: "ui.param.woodCentral.anchors.bolts.label", hint: TO_VALIDATE },
  "anchors.boltHoleDiameter": {
    label: "ui.param.woodCentral.anchors.boltHoleDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.holeEdgeDistance": {
    label: "ui.param.holeEdgeDistance.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Boulons du sabot de pied regroupés (QUESTIONS A36 (10)) ◆.
  "anchors.footBoltZone": {
    label: "ui.param.woodCentral.anchors.footBoltZone.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Platine à âme noyée (C §1.11 [80], dimensions à valider).
  "anchors.plate.thickness": {
    label: "ui.param.woodCentral.anchors.plate.thickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.plate.width": {
    label: "ui.param.woodCentral.anchors.plate.width.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.plate.webThickness": {
    label: "ui.param.woodCentral.anchors.plate.webThickness.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.plate.webDepth": {
    label: "ui.param.woodCentral.anchors.plate.webDepth.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.plate.webLength": {
    label: "ui.param.woodCentral.anchors.plate.webLength.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.plate.pins": {
    label: "ui.param.woodCentral.anchors.plate.pins.label",
    hint: TO_VALIDATE,
  },
  "anchors.plate.pinDiameter": {
    label: "ui.param.woodCentral.anchors.plate.pinDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  "anchors.plate.pinHoleDiameter": {
    label: "ui.param.woodCentral.anchors.plate.pinHoleDiameter.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Âme de pied prolongée (QUESTIONS A35 (a)) ◆.
  "anchors.plate.footWebLength": {
    label: "ui.param.woodCentral.anchors.plate.footWebLength.label",
    unit: MM,
    hint: TO_VALIDATE,
  },
  // Réduction selon l'angle du fil (Hankinson, couches empilées, A35 (j)) ◆.
  "grainAngle.strengthRatio": {
    label: "ui.param.woodCentral.grainAngle.strengthRatio.label",
    hint: TO_VALIDATE,
  },
  "grainAngle.strengthExponent": {
    label: "ui.param.woodCentral.grainAngle.strengthExponent.label",
    hint: TO_VALIDATE,
  },
  "grainAngle.modulusRatio": {
    label: "ui.param.woodCentral.grainAngle.modulusRatio.label",
    hint: TO_VALIDATE,
  },
  "grainAngle.modulusExponent": {
    label: "ui.param.woodCentral.grainAngle.modulusExponent.label",
    hint: TO_VALIDATE,
  },
  cantileverJustification: {
    label: "ui.param.steelCentral.cantileverJustification.label",
    hint: "ui.param.steelCentral.cantileverJustification.hint",
  },
  laminationJustification: {
    label: "ui.param.woodCentral.laminationJustification.label",
    hint: "ui.param.woodCentral.laminationJustification.hint",
  },
};

/** Variantes propres à un plugin. */
const BY_KIND: Readonly<Record<string, Readonly<Record<string, FieldText>>>> = {
  "wood-cut": {
    thickness: { label: "ui.param.woodCut.thickness.label", unit: MM },
    residual: { label: "ui.param.woodCut.residual.label", unit: MM },
    residualFallback: {
      label: "ui.param.woodCut.residualFallback.label",
      unit: MM,
      hint: "ui.param.woodCut.residualFallback.hint",
    },
    strengthClass: {
      label: "ui.param.woodCut.strengthClass.label",
      options: {
        auto: "ui.param.woodCut.strengthClass.option.auto",
        unknown: "ui.param.woodCut.strengthClass.option.unknown",
        ...raw(["C30", "D40"]),
      },
    },
    inset: { label: "ui.param.woodCut.inset.label", unit: MM },
  },
  "steel-flat": {
    thickness: { label: "ui.param.steelFlat.thickness.label", unit: MM, hint: TO_VALIDATE },
  },
  "steel-curved": {
    thickness: { label: "ui.param.steelCurved.thickness.label", unit: MM, hint: TO_VALIDATE },
    "curved.jointOffset": {
      label: "ui.param.steelCurved.curved.jointOffset.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.jointSupportMargin": {
      label: "ui.param.steelCurved.curved.jointSupportMargin.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.minSegmentLength": {
      label: "ui.param.steelCurved.curved.minSegmentLength.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.sampleStep": {
      label: "ui.param.steelCurved.curved.sampleStep.label",
      unit: MM,
      hint: "ui.param.steelCurved.curved.sampleStep.hint",
    },
    "curved.rollLineSpacing": {
      label: "ui.param.steelCurved.curved.rollLineSpacing.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.minPerpendicularWidth": {
      label: "ui.param.steelCurved.curved.minPerpendicularWidth.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "curved.maxSlopeBreak": {
      label: "ui.param.steelCurved.curved.maxSlopeBreak.label",
      unit: "°",
      hint: "ui.param.steelCurved.curved.maxSlopeBreak.hint",
    },
  },
  "steel-central": STEEL_CENTRAL,
  "wood-central": WOOD_CENTRAL,
  "helical-core": {
    "column.material": {
      label: "ui.param.helicalCore.column.material.label",
      options: {
        steel: "ui.param.helicalCore.column.material.option.steel",
        wood: "ui.param.helicalCore.column.material.option.wood",
      },
    },
    "column.wallThickness": {
      label: "ui.param.helicalCore.column.wallThickness.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "column.wood": { label: "ui.param.helicalCore.column.wood.label", options: MATERIAL_KEYS },
    "column.topExtension": {
      label: "ui.param.helicalCore.column.topExtension.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    "treads.material": {
      label: "ui.label.treadMaterial",
      options: {
        wood: "ui.param.helicalCore.treads.material.option.wood",
        steel: "ui.param.helicalCore.treads.material.option.steel",
      },
    },
    "treads.plateThickness": {
      label: "ui.param.helicalCore.treads.plateThickness.label",
      unit: MM,
      hint: TO_VALIDATE,
    },
    ...helicalStringer("innerStringer"),
    "outerStringer.enabled": { label: "ui.param.helicalCore.outerStringer.enabled.label" },
    ...helicalStringer("outerStringer"),
    "handrail.enabled": { label: "ui.param.helicalCore.handrail.enabled.label" },
    "handrail.material": {
      label: "ui.param.helicalCore.handrail.material.label",
      options: {
        steel: "ui.param.helicalCore.handrail.material.option.steel",
        wood: "ui.param.helicalCore.handrail.material.option.wood",
      },
    },
    "handrail.height": {
      label: "ui.param.helicalCore.handrail.height.label",
      unit: MM,
      hint: "ui.param.helicalCore.handrail.height.hint",
    },
    "handrail.diameter": {
      label: "ui.param.helicalCore.handrail.diameter.label",
      unit: MM,
      hint: "ui.param.helicalCore.stringer.height.hint",
    },
    "handrail.radiusOffset": {
      label: "ui.param.helicalCore.handrail.radiusOffset.label",
      unit: MM,
      hint: "ui.param.helicalCore.handrail.radiusOffset.hint",
    },
    cantileverJustification: {
      label: "ui.param.helicalCore.cantileverJustification.label",
      hint: "ui.param.helicalCore.cantileverJustification.hint",
    },
  },
};

/** Texte d'un paramètre (`undefined` : libellé dérivé de la clé). */
export function fieldText(kind: string, path: ParamPath): FieldText | undefined {
  const key = path.join(".");
  return BY_KIND[kind]?.[key] ?? COMMON[key];
}

export type PresentedField = ParamField & {
  readonly unit: string;
  readonly hint?: string;
  /** L'aide est « valeur par défaut à valider » (valeur ◆) : retirée une fois validée. */
  readonly toValidateHint?: true;
  /** Groupe (fieldset) du champ, `undefined` : paramètres principaux. */
  readonly group?: string;
  /** Libellés des choix d'une liste. */
  readonly optionLabels?: Readonly<Record<string, string>>;
  /**
   * Choix non pris en charge par le plugin sur le tracé du projet (option grisée), avec leur
   * raison traduite (`capabilities.unsupportedOptions`, lue par `unsupportedOptionsOf`).
   */
  readonly disabledOptions?: Readonly<Record<string, string>>;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Sections du catalogue proposées pour une famille (plus légère d'abord). */
export function catalogSectionOptions(family: unknown): string[] {
  const fam = (SECTION_FAMILIES as readonly string[]).includes(String(family))
    ? (family as SectionFamily)
    : "UPN";
  return ["auto", ...sectionsOf(fam).map((s) => s.name)];
}

/** Même chemin de paramètre ? */
const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Choix grisés d'une liste : raison traduite par valeur, et libellé « … — indisponible : … ».
 * `undefined` si aucun choix du champ n'est concerné.
 */
function disabledChoices(
  f: ParamField,
  labels: Readonly<Record<string, string>> | undefined,
  unsupported: readonly UnsupportedParamOption[],
  t: Translator,
): { disabled: Record<string, string>; labels: Record<string, string> } | undefined {
  if (f.kind !== "enum") return undefined;
  const mine = unsupported.filter((u) => samePath(u.path, f.path) && f.options.includes(u.value));
  if (mine.length === 0) return undefined;
  const disabled: Record<string, string> = {};
  const out: Record<string, string> = { ...labels };
  for (const u of mine) {
    const reason = t.t(u.reason);
    disabled[u.value] = reason;
    out[u.value] = t.t("ui.param.optionUnsupported", {
      label: labels?.[u.value] ?? u.value,
      reason,
    });
  }
  return { disabled, labels: out };
}

/**
 * Champs présentés dans la langue du traducteur : libellés, unités, groupes ; `section` d'un
 * profilé en liste du catalogue de la famille choisie ; choix non pris en charge sur le tracé
 * (`unsupported`, déclarés par le plugin, `unsupportedOptionsOf`) grisés avec leur raison.
 */
export function presentFields(
  kind: string,
  fields: readonly ParamField[],
  params: unknown,
  t: Translator,
  unsupported: readonly UnsupportedParamOption[] = [],
): PresentedField[] {
  return fields.map((f): PresentedField => {
    const presented = presentField(kind, f, params, t);
    const d = disabledChoices(f, presented.optionLabels, unsupported, t);
    return d === undefined
      ? presented
      : { ...presented, optionLabels: d.labels, disabledOptions: d.disabled };
  });
}

/** Présentation d'un champ, sans les choix grisés. */
function presentField(kind: string, f: ParamField, params: unknown, t: Translator): PresentedField {
  const text = fieldText(kind, f.path);
  const group = f.path.length > 1 ? f.path[0] : undefined;
  const base = {
    ...f,
    unit: text?.unit ?? "",
    ...(text ? { label: t.t(text.label) } : group ? { label: stripGroup(f.label) } : {}),
    ...(text?.hint ? { hint: t.t(text.hint) } : {}),
    ...(text?.hint === TO_VALIDATE ? { toValidateHint: true as const } : {}),
    ...(group ? { group } : {}),
    ...(text?.options
      ? {
          optionLabels: Object.fromEntries(
            Object.entries(text.options).map(([k, v]) => [k, t.t(v)]),
          ),
        }
      : {}),
  };
  if (kind === "steel-profile" && f.path.length === 1 && f.path[0] === "section") {
    const family = isPlainObject(params) ? params["family"] : undefined;
    const current = isPlainObject(params) ? params["section"] : undefined;
    const options = catalogSectionOptions(family);
    const labels: Record<string, string> = { auto: t.t("ui.param.auto") };
    // Section d'une autre famille (projet importé) : le plugin l'utilise telle quelle, la
    // liste doit donc la montrer (sinon elle afficherait « Automatique »).
    if (typeof current === "string" && !options.includes(current)) {
      options.push(current);
      labels[current] = t.t("ui.param.otherFamily", { section: current });
    }
    return {
      ...base,
      kind: "enum",
      options,
      optionLabels: labels,
    } as PresentedField;
  }
  return base as PresentedField;
}

/** Libellé dérivé sans le préfixe de groupe (« Newel › joint » → « Joint »). */
function stripGroup(label: string): string {
  const i = label.lastIndexOf("›");
  const rest = i >= 0 ? label.slice(i + 1).trim() : label;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Libellé d'un groupe de paramètres dans la langue du traducteur. */
export function groupLabel(group: string, t: Translator): string {
  const key = GROUP_LABELS[group];
  return key === undefined ? group : t.t(key);
}

/**
 * Paramètres après modification d'un champ : un changement de famille de profilé remet la
 * section en `auto` si la section choisie n'appartient pas à la nouvelle famille (le plugin
 * retiendrait sinon une section d'une autre famille).
 */
export function afterParamChange(
  kind: string,
  path: ParamPath,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (kind !== "steel-profile" || path.length !== 1 || path[0] !== "family") return params;
  const section = params["section"];
  if (section === undefined || section === "auto") return params;
  return catalogSectionOptions(params["family"]).includes(String(section))
    ? params
    : { ...params, section: "auto" };
}
