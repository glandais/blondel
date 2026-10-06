/**
 * Valeurs ◆ « à valider » d'un projet présentées pour la liste à cocher (ADR-0009 point 9) :
 * mode Fabrication (onglet « À valider »), étape 7 du parcours guidé, dossier PDF.
 *
 * Les éléments, leur ordre, leur valeur effective et leur état de validation viennent de
 * `toValidateStates` (`lib/paramTiers.ts`, seule source) ; ce module n'ajoute que la
 * présentation : libellé (mêmes clés que les sections de paramètres), unité, valeur mise en
 * forme dans une langue donnée, entrée de validation pour le store. Aucun calcul métier.
 *
 * Visserie du profil d'atelier (QUESTIONS A27) : libellés « Visserie · <assemblage> · <champ> »,
 * jeu de perçage, série des diamètres nominaux, entraxe des supports et mur non décrit supposé
 * porteur sous « Visserie » ; nature et classe affichées par
 * leurs libellés du cœur.
 */
import {
  FASTENER_GRADES,
  FASTENER_KINDS,
  fastenerGradeLabel,
  fastenerJointLabel,
  fastenerKindLabel,
  type FastenerGrade,
  type FastenerJointKind,
  type FastenerKind,
  type FastenerSettingField,
  type Model,
  type Project,
  type ValidatedScalar,
  type ValidatedValue,
} from "@blondel/core";
import { materialLabel } from "@blondel/exports";
import { msg, textMessage, type Message, type MessageKey, type Translator } from "@blondel/i18n";
import { toMessage } from "../i18n/text.js";
import { fastenerSettingOf } from "./fasteners.js";
import { GROUP_LABELS, fieldText } from "./paramLabels.js";
import { STRUCTURE_PARAMS_PREFIX, toValidateStates, type ToValidateState } from "./paramTiers.js";
import { SECTION_TITLE_KEYS, type GuidedStep, type SectionId } from "./sectionIds.js";

/** Ligne de la liste des valeurs ◆. */
export interface ToValidateRow {
  /** Clé du dictionnaire des niveaux (`paramKey`), aussi chemin enregistré à la validation. */
  readonly key: string;
  /** Chemin du projet. */
  readonly path: readonly (string | number)[];
  /** Section du parcours libre où la valeur s'édite. */
  readonly section: SectionId;
  /** Étapes guidées où la valeur apparaît. */
  readonly steps: readonly GuidedStep[];
  /** Libellé du paramètre (mêmes clés que le panneau, groupe en préfixe). */
  readonly label: Message;
  /** Valeur effective (défauts compris) ; `undefined` : non calculable. */
  readonly value: ValidatedScalar | undefined;
  /** Unité (symbole) de la valeur. */
  readonly unit?: string;
  /** Plugin de structure, pour les paramètres de plugin. */
  readonly structureKind?: string;
  /** La valeur effective courante est-elle validée ? */
  readonly validated: boolean;
}

/** Ligne du dossier PDF (même forme que `PdfToValidateRow` de `@blondel/exports/pdf`). */
export interface ToValidateDocRow {
  readonly label: Message;
  /** Valeur mise en forme dans la langue du dossier. */
  readonly value: string;
  readonly section: Message;
  readonly validated: boolean;
}

const MM = "mm";
const DEGREE = "°";
const REACH_KEY = "stair.balancing.rotationReach";

/** Libellé, groupe (fieldset) et unité des ◆ de garde-corps (clés de `GuardsSection`). */
interface GuardText {
  readonly label: MessageKey;
  readonly group?: MessageKey;
  readonly unit?: string;
}

const GUARD_TEXTS: Readonly<Record<string, GuardText>> = {
  // Matériau de tout le garde-corps (poteaux, main courante, remplissage) et tolérance de
  // détection des murs : champs de la section elle-même, préfixés « Garde-corps · ».
  "guards.material": { label: "ui.guards.material", group: "ui.params.guards.title" },
  "guards.flight.edgeOffset": {
    label: "ui.guards.flight.edgeOffset",
    group: "ui.guards.flight.legend",
    unit: MM,
  },
  "guards.opening.setback": {
    label: "ui.guards.opening.setback",
    group: "ui.guards.opening.legend",
    unit: MM,
  },
  "guards.infill.spacing": {
    label: "ui.guards.infill.balusterSpacing",
    group: "ui.guards.infill.legend",
    unit: MM,
  },
  "guards.posts.size": { label: "ui.guards.posts.size", group: "ui.guards.posts.legend", unit: MM },
  "guards.posts.maxSpacing": {
    label: "ui.guards.posts.maxSpacing",
    group: "ui.guards.posts.legend",
    unit: MM,
  },
  "guards.posts.cornerAngle": {
    label: "ui.guards.posts.cornerAngle",
    group: "ui.guards.posts.legend",
    unit: DEGREE,
  },
  "guards.wallTolerance": {
    label: "ui.guards.wallTolerance",
    group: "ui.params.guards.title",
    unit: MM,
  },
};

/** Libellés de la rotation M6 (clés de `BalancingSection`). */
const BALANCING_LABELS: Readonly<Record<string, MessageKey>> = {
  [REACH_KEY]: "ui.params.rotation.reach",
  "stair.balancing.rotationSteepness": "ui.params.rotation.steepness",
};

const grouped = (group: Message, label: Message): Message =>
  msg("ui.toValidate.grouped", { group, label });

/** Préfixe des réglages de visserie du profil d'atelier (QUESTIONS A27). */
const FASTENERS_PREFIX = "workshop.fasteners.";

/** Libellés des champs d'un réglage de visserie (mêmes clés que `FastenersFields`). */
export const FASTENER_FIELD_LABELS: Readonly<Record<FastenerSettingField, MessageKey>> = {
  kind: "ui.fasteners.field.kind",
  grade: "ui.fasteners.field.grade",
  diameter: "ui.fasteners.field.diameter",
  length: "ui.fasteners.field.length",
  perPoint: "ui.fasteners.field.perPoint",
};

/** Unités des champs d'un réglage de visserie (nombre sans unité : quantité par point). */
const FASTENER_FIELD_UNITS: Readonly<Partial<Record<FastenerSettingField, string>>> = {
  diameter: MM,
  length: MM,
};

/** Titre du groupe d'un assemblage : « Visserie · Platine sur sol ». */
export function fastenerJointGroup(joint: FastenerJointKind): Message {
  return msg("ui.fasteners.jointGroup", { joint: fastenerJointLabel(joint) });
}

/** Libellé et unité d'une valeur ◆ de visserie (`undefined` : autre chemin). */
function fastenerPresentation(s: ToValidateState): { label: Message; unit?: string } | undefined {
  if (!s.key.startsWith(FASTENERS_PREFIX)) return undefined;
  const fasteners = msg("ui.fasteners.title");
  if (s.key === "workshop.fasteners.holeClearance") {
    return { label: grouped(fasteners, msg("ui.fasteners.holeClearance")), unit: MM };
  }
  if (s.key === "workshop.fasteners.nominalDiameters") {
    return { label: grouped(fasteners, msg("ui.fasteners.nominalDiameters")) };
  }
  if (s.key === "workshop.fasteners.bracketSpacing") {
    return { label: grouped(fasteners, msg("ui.fasteners.bracketSpacing")), unit: MM };
  }
  if (s.key === "workshop.fasteners.unknownWallLoadBearing") {
    return { label: grouped(fasteners, msg("ui.fasteners.unknownWallLoadBearing")) };
  }
  const setting = fastenerSettingOf(s.path);
  if (setting === undefined) return { label: textMessage(s.key) };
  const label = grouped(
    fastenerJointGroup(setting.joint),
    msg(FASTENER_FIELD_LABELS[setting.field]),
  );
  const unit = FASTENER_FIELD_UNITS[setting.field];
  return unit === undefined ? { label } : { label, unit };
}

/** Libellé et unité d'une valeur ◆. */
function presentation(project: Project, s: ToValidateState): { label: Message; unit?: string } {
  if (s.key.startsWith(STRUCTURE_PARAMS_PREFIX)) {
    const p = s.path.slice(3).map(String);
    const text = fieldText(s.structureKind ?? "", p);
    const leaf = text ? toMessage(text.label) : textMessage(p.join("."));
    const groupKey = p.length > 1 ? GROUP_LABELS[p[0]!] : undefined;
    const label = groupKey === undefined ? leaf : grouped(msg(groupKey), leaf);
    return text?.unit ? { label, unit: text.unit } : { label };
  }
  const balancing = BALANCING_LABELS[s.key];
  if (balancing !== undefined) return { label: msg(balancing) };
  const fastener = fastenerPresentation(s);
  if (fastener !== undefined) return fastener;
  if (s.key === "guards.infill.thickness") {
    const glass = project.guards?.infill.kind === "glass";
    const leaf = msg(glass ? "ui.guards.infill.glassThickness" : "ui.guards.infill.panelThickness");
    return { label: grouped(msg("ui.guards.infill.legend"), leaf), unit: MM };
  }
  const g = GUARD_TEXTS[s.key];
  if (g === undefined) return { label: textMessage(s.key) };
  const leaf = msg(g.label);
  const label = g.group === undefined ? leaf : grouped(msg(g.group), leaf);
  return g.unit === undefined ? { label } : { label, unit: g.unit };
}

/**
 * Lignes des valeurs ◆ du projet : mêmes éléments et même ordre que `toValidateItems`, avec
 * libellé, valeur effective, unité et état de validation.
 */
export function toValidateRows(
  project: Project,
  model: Model | null | undefined,
): readonly ToValidateRow[] {
  return toValidateStates(project, model).map((s): ToValidateRow => {
    const { label, unit } = presentation(project, s);
    return {
      key: s.key,
      path: s.path,
      section: s.section,
      steps: s.steps,
      label,
      value: s.value,
      ...(unit === undefined ? {} : { unit }),
      ...(s.structureKind === undefined ? {} : { structureKind: s.structureKind }),
      validated: s.validated,
    };
  });
}

/** Libellé d'un choix de liste (`undefined` : aucun libellé connu). */
function optionLabel(row: ToValidateRow, value: string, t: Translator): string | undefined {
  if (row.key === "guards.material") return materialLabel(t, value);
  const setting = fastenerSettingOf(row.path);
  if (setting?.field === "kind" && (FASTENER_KINDS as readonly string[]).includes(value)) {
    return t.t(fastenerKindLabel(value as FastenerKind));
  }
  if (setting?.field === "grade" && (FASTENER_GRADES as readonly string[]).includes(value)) {
    return t.t(fastenerGradeLabel(value as FastenerGrade));
  }
  if (row.key.startsWith(STRUCTURE_PARAMS_PREFIX)) {
    const text = fieldText(row.structureKind ?? "", row.path.slice(3).map(String));
    const option = text?.options?.[value];
    if (option !== undefined) return t.t(toMessage(option));
    if (value === "auto") return t.t("ui.param.auto");
  }
  return undefined;
}

/**
 * Valeur d'une ligne dans la langue du traducteur : nombre avec son unité (« 30 mm », entiers
 * sans décimale), libellé du choix d'une liste (« Chêne »), oui / non, « – » si non calculable.
 */
export function formatToValidateValue(row: ToValidateRow, t: Translator): string {
  const v = row.value;
  if (v === undefined) return t.t("ui.toValidate.none");
  if (typeof v === "boolean") return t.t(v ? "ui.toValidate.yes" : "ui.toValidate.no");
  if (typeof v === "string") return optionLabel(row, v, t) ?? v;
  const unit = row.key === REACH_KEY ? t.t("ui.params.rotation.goings") : row.unit;
  return t.num(v, {
    digits: Number.isInteger(v) ? 0 : 3,
    trimZeros: true,
    ...(unit === undefined || unit === "" ? {} : { unit }),
  });
}

/** Entrée de validation d'une ligne pour le store (`null` : valeur non calculable). */
export function validationEntry(row: ToValidateRow): ValidatedValue | null {
  if (row.value === undefined) return null;
  return row.structureKind === undefined
    ? { path: row.key, value: row.value }
    : { path: row.key, value: row.value, structureKind: row.structureKind };
}

/** Entrées de validation des lignes restantes (« Tout valider ») ; lignes non calculables exclues. */
export function pendingValidationEntries(rows: readonly ToValidateRow[]): ValidatedValue[] {
  return rows
    .filter((r) => !r.validated)
    .map(validationEntry)
    .filter((e): e is ValidatedValue => e !== null);
}

/** Lignes du dossier PDF : valeurs mises en forme dans la langue du traducteur. */
export function toValidateDocRows(
  project: Project,
  model: Model | null | undefined,
  t: Translator,
): readonly ToValidateDocRow[] {
  return toValidateRows(project, model).map((row) => ({
    label: row.label,
    value: formatToValidateValue(row, t),
    section: msg(SECTION_TITLE_KEYS[row.section]),
    validated: row.validated,
  }));
}
