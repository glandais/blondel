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
  sectionsOf,
  type SectionFamily,
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
  curved: "ui.param.group.curved",
  column: "ui.param.group.column",
  treads: "ui.param.group.treads",
  innerStringer: "ui.param.group.innerStringer",
  outerStringer: "ui.param.group.outerStringer",
  handrail: "ui.param.group.handrail",
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
  upperOffset: { label: "ui.param.upperOffset.label", unit: MM },
  lowerOffset: { label: "ui.param.lowerOffset.label", unit: MM },
  startExtension: { label: "ui.param.startExtension.label", unit: MM },
  endExtension: { label: "ui.param.endExtension.label", unit: MM },
  splice: {
    label: "ui.param.splice.label",
    options: { welded: "ui.param.splice.option.welded", bolted: "ui.param.splice.option.bolted" },
  },
  housingDepth: { label: "ui.param.housingDepth.label", unit: MM },
  noseRadius: { label: "ui.param.noseRadius.label", unit: MM },
  treadKind: {
    label: "ui.param.treadKind.label",
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
  "precheck.woodClass": {
    label: "ui.param.precheck.woodClass.label",
    hint: TO_VALIDATE,
    options: raw(WOOD_CLASSES),
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
      label: "ui.param.helicalCore.treads.material.label",
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
  /** Groupe (fieldset) du champ, `undefined` : paramètres principaux. */
  readonly group?: string;
  /** Libellés des choix d'une liste. */
  readonly optionLabels?: Readonly<Record<string, string>>;
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

/**
 * Champs présentés dans la langue du traducteur : libellés, unités, groupes ; `section` d'un
 * profilé en liste du catalogue de la famille choisie.
 */
export function presentFields(
  kind: string,
  fields: readonly ParamField[],
  params: unknown,
  t: Translator,
): PresentedField[] {
  return fields.map((f): PresentedField => {
    const text = fieldText(kind, f.path);
    const group = f.path.length > 1 ? f.path[0] : undefined;
    const base = {
      ...f,
      unit: text?.unit ?? "",
      ...(text ? { label: t.t(text.label) } : group ? { label: stripGroup(f.label) } : {}),
      ...(text?.hint ? { hint: t.t(text.hint) } : {}),
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
  });
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
