/**
 * Liste de visserie CSV (QUESTIONS A27, décision du 2026-10-06), fichier distinct de la liste de
 * débit : une ligne par repère de visserie (`fastenerLines` du cœur : éléments identiques réunis,
 * quantités additionnées), avec repère, désignation, nature, diamètre, longueur, classe ou
 * matière, quantité, assemblages d'origine et repères des pièces assemblées, puis une ligne de
 * total (quantité).
 *
 * Mêmes conventions que la liste de débit (`cutlist.ts`) : BOM UTF-8, fins de ligne CRLF,
 * séparateur « ; » et virgule décimale en français, « , » et point décimal en anglais, champs
 * texte neutralisés (injection de formule).
 *
 * Modèle sans visserie (`Model.fasteners` absent ou vide) : **en-tête seul**, sans ligne de
 * total (fichier valide et vide) ; l'interface ne propose alors pas l'export (motif affiché).
 *
 * Les lignes traduites (`fastenerScheduleRows`) servent aussi au dossier PDF et à l'interface
 * (nomenclature, mode Fabrication) : aucun regroupement n'est refait ailleurs.
 */
import {
  fastenerGradeLabel,
  fastenerJointLabel,
  fastenerKindLabel,
  fastenerLines,
} from "@blondel/core";
import type { Model } from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import { formatIn } from "../format.js";
import { translatorOf, tr, type LocaleOption, type Translator } from "../i18n.js";
import { CSV_BOM, csvField, csvSeparator, neutralizeFormula } from "./cutlist.js";

/** Modèle lu par la liste de visserie. */
export type FastenersModel = Pick<Model, "parts" | "fasteners">;

/** Le modèle a-t-il de la visserie (au moins un élément) ? */
export function hasFasteners(model: Pick<Model, "fasteners">): boolean {
  return (model.fasteners?.length ?? 0) > 0;
}

/** Ligne de la liste de visserie, textes dans la langue du traducteur. */
export interface FastenerScheduleRow {
  /** Repère de visserie (non traduit, ex. « VS1 »). */
  readonly mark: string;
  /** Désignation complète. */
  readonly name: string;
  /** Nature (« Boulon », « Cheville mécanique »). */
  readonly kind: string;
  /** Classe ou matière (« classe 8.8 », « acier zingué »). */
  readonly grade: string;
  /** Diamètre nominal (mm). */
  readonly diameter: number;
  /** Longueur (mm). */
  readonly length: number;
  /** Quantité totale du repère. */
  readonly quantity: number;
  /** Assemblages d'origine distincts (libellés). */
  readonly joints: readonly string[];
  /** Repères distincts des pièces assemblées, dans l'ordre du modèle. */
  readonly partMarks: readonly string[];
  /** Identifiants des pièces assemblées (`Model.parts`). */
  readonly partIds: readonly string[];
}

/**
 * Lignes de la liste de visserie (ordre de `fastenerLines`), textes dans la langue de
 * `options.locale`. Liste vide sans visserie.
 */
export function fastenerScheduleRows(
  model: FastenersModel,
  options: LocaleOption = {},
): FastenerScheduleRow[] {
  const t = translatorOf(options);
  const fasteners = model.fasteners ?? [];
  if (fasteners.length === 0) return [];
  const markOf = new Map(model.parts.map((p) => [p.id, p.mark]));
  return fastenerLines(fasteners).map((l) => {
    const marks: string[] = [];
    for (const id of l.partIds) {
      const m = markOf.get(id);
      if (m !== undefined && !marks.includes(m)) marks.push(m);
    }
    return {
      mark: l.mark,
      name: tr(t, l.name),
      kind: tr(t, fastenerKindLabel(l.kind)),
      grade: tr(t, fastenerGradeLabel(l.grade)),
      diameter: l.diameter,
      length: l.length,
      quantity: l.quantity,
      joints: l.joints.map((j) => tr(t, fastenerJointLabel(j))),
      partMarks: marks,
      partIds: l.partIds,
    };
  });
}

/** Clés des en-têtes de colonnes de la liste de visserie, dans l'ordre des colonnes. */
const FASTENERS_HEADER_KEYS: readonly MessageKey[] = [
  "csv.header.mark",
  "csv.header.name",
  "csv.fasteners.header.kind",
  "csv.fasteners.header.diameter",
  "csv.fasteners.header.length",
  "csv.fasteners.header.grade",
  "csv.header.quantity",
  "csv.fasteners.header.joints",
  "csv.fasteners.header.parts",
];

/** En-têtes de colonnes de la liste de visserie dans la langue du traducteur (défaut : français). */
export function fastenersCsvHeader(t: Translator = translatorOf()): readonly string[] {
  return FASTENERS_HEADER_KEYS.map((k) => t.t(k));
}

/** Cote (mm) d'une colonne numérique : une décimale au plus, sans séparateur de milliers. */
export function fastenerMm(t: Translator, v: number): string {
  return Number.isFinite(v) ? formatIn(t, v, { decimals: 1, thousands: "", trimZeros: true }) : "";
}

/** Séparateur des listes dans une cellule (assemblages, repères des pièces). */
export function fastenerListSeparator(t: Translator): string {
  return t.t("csv.noteSeparator");
}

export interface FastenersCsvOptions extends LocaleOption {
  /** Ajoute le BOM UTF-8 (défaut : vrai, nécessaire à Excel pour les accents). */
  readonly bom?: boolean;
  /** Ajoute une ligne de total des quantités (défaut : vrai ; jamais sans visserie). */
  readonly totals?: boolean;
}

/** Liste de visserie du modèle, texte CSV (en-tête seul sans visserie). */
export function exportFastenersCsv(
  model: FastenersModel,
  options: FastenersCsvOptions = {},
): string {
  const t = translatorOf(options);
  const rows = fastenerScheduleRows(model, { locale: t.locale });
  const list = fastenerListSeparator(t);
  const lines: string[][] = [[...fastenersCsvHeader(t)]];
  let qty = 0;
  for (const r of rows) {
    qty += r.quantity;
    lines.push([
      neutralizeFormula(r.mark),
      neutralizeFormula(r.name),
      neutralizeFormula(r.kind),
      fastenerMm(t, r.diameter),
      fastenerMm(t, r.length),
      neutralizeFormula(r.grade),
      String(r.quantity),
      neutralizeFormula(r.joints.join(list)),
      neutralizeFormula(r.partMarks.join(list)),
    ]);
  }
  if (options.totals !== false && rows.length > 0) {
    lines.push([t.t("csv.total"), "", "", "", "", "", String(qty), "", ""]);
  }
  const sep = csvSeparator(t.locale);
  const body = lines.map((l) => l.map((f) => csvField(f, sep)).join(sep)).join("\r\n") + "\r\n";
  return (options.bom === false ? "" : CSV_BOM) + body;
}
