/**
 * Liste de débit CSV. En français (défaut) : séparateur « ; », décimale « , », BOM UTF-8, fins
 * de ligne CRLF (ouverture directe dans un tableur réglé en français). En anglais
 * (`locale: "en"`) : séparateur « , », point décimal, BOM et CRLF conservés.
 *
 * Regroupement : les pièces de même repère (`Part.mark`) sont des pièces identiques ; la
 * quantité est leur nombre (deux pièces de même repère mais de débit différent restent sur deux
 * lignes). Pièce composée de plusieurs lames identiques (`Part.stock.count`, lamellé-collé) : la
 * ligne porte le débit d'une lame, la quantité compte les lames, volume et masse unitaires sont
 * ceux d'une lame (part égale de la pièce), de sorte que les totaux restent ceux des pièces. Grandeurs lues dans `Part.quantities` : `volume` (m³) et la masse (kg), clé
 * normalisée `mass_kg` du cœur, à défaut clé historique `mass` (`partMassKg`) ; à défaut de
 * `volume`, volume brut du débit L × l × e (`Part.stock`). Aucune masse n'est inventée : sans
 * masse, la colonne reste vide et le total est « incomplet ».
 *
 * Pièce finie faite de composantes (`Part.componentOf`, couches d'une poutre en couches
 * empilées, QUESTIONS A33 (e)) : seules les composantes sont listées (elles portent le débit, le
 * volume et la masse) ; la pièce finie, sans débit propre, ne l'est pas (aucun double compte).
 * Composantes imbriquées (QUESTIONS A36 (9)) : les planches d'une couche composée sont listées,
 * ni la couche composée ni la poutre (`fabricatedParts`).
 * Débit en placage (`Part.stock.supply = "veneer"`, plis minces achetés à l'épaisseur,
 * QUESTIONS A34 (e)) : désignation suivie de « (placage) » (sans nouvelle colonne) et champ
 * `supply` de la ligne pour l'interface et le PDF.
 *
 * Remarque de masse (QUESTIONS A6, appliqué par défaut) : une masse calculée avec une masse
 * volumique non validée porte la mention « masse volumique à valider » (colonne « Remarque
 * masse ») ; par défaut toutes les essences de bois (masses volumiques du profil d'atelier à
 * valider), sauf celles que le profil d'atelier du projet renseigne (`massNoteFor`). Réglable
 * par l'option `massNote`.
 *
 * Arrondi d'affichage : volumes au cm³ (6 décimales du m³), masses à 0,01 kg ; une grandeur
 * non nulle n'est jamais affichée nulle ; les totaux somment les valeurs de ligne affichées.
 */
import {
  fabricatedParts,
  isWoodMaterial,
  type MaterialId,
  type Model,
  type Part,
  type PartCategory,
  type WorkshopProfileInput,
} from "@blondel/core";
import type { Locale, MessageKey } from "@blondel/i18n";
import { formatIn } from "../format.js";
import {
  compareMarks,
  materialLabel,
  translatorOf,
  tr,
  trOpt,
  type LocaleOption,
  type Translator,
} from "../i18n.js";

export const QUANTITY_VOLUME = "volume";
/** Clé historique de la masse (kg), lue à défaut de `mass_kg`. */
export const QUANTITY_MASS = "mass";
/** Clé normalisée de la masse (kg) remplie par le cœur (`structures/quantities.ts`). */
export const QUANTITY_MASS_KG = "mass_kg";

/** Masse d'une pièce (kg) : `mass_kg`, à défaut `mass` ; `undefined` si absente ou non finie. */
export function partMassKg(part: Pick<Part, "quantities">): number | undefined {
  const v = part.quantities[QUANTITY_MASS_KG] ?? part.quantities[QUANTITY_MASS];
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

/**
 * Mention portée par une masse calculée avec une masse volumique non validée, dans la langue du
 * traducteur (défaut : français).
 */
export function massDensityNote(t: Translator = translatorOf()): string {
  return t.t("csv.massDensityNote");
}

/**
 * Remarque attachée à la masse d'une pièce selon son matériau (`undefined` : aucune). `t` :
 * langue de la remarque, transmise par `cutListRows` / `cutSheet` (défaut : français) ; une
 * remarque personnalisée peut l'ignorer.
 */
export type MassNote = (material: MaterialId, t?: Translator) => string | undefined;

/** Remarque par défaut : bois (masses volumiques du profil d'atelier par défaut à valider). */
export const defaultMassNote: MassNote = (material, t) =>
  isWoodMaterial(material) ? massDensityNote(t) : undefined;

/**
 * Remarque de masse pour un projet : les essences dont le profil d'atelier du projet renseigne
 * la masse volumique (valeur de l'atelier) n'ont pas de mention ; les autres essences de bois
 * gardent « masse volumique à valider ».
 */
export function massNoteFor(workshop?: WorkshopProfileInput): MassNote {
  const own = workshop?.wood?.densities ?? {};
  return (material, t) =>
    isWoodMaterial(material) && own[material] === undefined ? massDensityNote(t) : undefined;
}

export const CSV_BOM = "﻿";

const CATEGORY_ORDER: readonly PartCategory[] = [
  "stringer",
  "carriage",
  "support",
  "tread",
  "riser",
  "landing",
  "post",
  "handrail",
  "baluster",
  "infill",
  "fixing",
];

/** Clés des en-têtes de colonnes de la liste de débit, dans l'ordre des colonnes. */
const CUT_LIST_HEADER_KEYS: readonly MessageKey[] = [
  "csv.header.mark",
  "csv.header.name",
  "csv.header.material",
  "csv.header.section",
  "csv.header.length",
  "csv.header.width",
  "csv.header.thickness",
  "csv.header.quantity",
  "csv.header.unitVolume",
  "csv.header.totalVolume",
  "csv.header.unitMass",
  "csv.header.totalMass",
  "csv.header.massNote",
];

/** En-têtes de colonnes de la liste de débit dans la langue du traducteur (défaut : français). */
export function cutListHeader(t: Translator = translatorOf()): readonly string[] {
  return CUT_LIST_HEADER_KEYS.map((k) => t.t(k));
}

/** Séparateur de champs du CSV. */
export type CsvSeparator = ";" | ",";

/**
 * Séparateur de champs du CSV selon la langue : « ; » en français (la virgule y est la
 * décimale), « , » en anglais (point décimal). Type fermé : `fields.map(csvField)` (indice passé
 * en séparateur) ne compile pas.
 */
export function csvSeparator(locale: Locale = "fr"): CsvSeparator {
  return locale === "en" ? "," : ";";
}

/**
 * Champ CSV : guillemets si nécessaire (séparateur `separator`, défaut « ; », guillemet, saut de
 * ligne, espaces de bord).
 */
export function csvField(value: string, separator: CsvSeparator = csvSeparator()): string {
  const special =
    value.includes(separator) ||
    value.includes('"') ||
    /[\r\n]/.test(value) ||
    /^\s|\s$/.test(value);
  return special ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Neutralise une formule de tableur (injection CSV) : un texte commençant par `=`, `+`, `-`,
 * `@`, une tabulation ou un retour chariot est préfixé d'une apostrophe, que les tableurs
 * lisent comme « texte littéral ». Réservé aux champs **texte** (repère, désignation,
 * matériau, section) : les colonnes numériques, produites par `formatIn`, restent intactes.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Champ CSV texte : neutralisé puis mis entre guillemets si nécessaire. */
export function csvTextField(value: string, separator: CsvSeparator = csvSeparator()): string {
  return csvField(neutralizeFormula(value), separator);
}

const dec = (t: Translator, v: number | undefined, decimals: number): string =>
  v === undefined || !Number.isFinite(v) ? "" : formatIn(t, v, { decimals, thousands: "" });

/**
 * Décimales des volumes (m³) : 6, soit le cm³. À 4 décimales (100 cm³), une cornière de
 * 80 mm affichait 0 m³.
 */
export const VOLUME_DECIMALS = 6;
/** Décimales des masses (kg). */
export const MASS_DECIMALS = 2;

/**
 * Valeur arrondie telle qu'affichée ; une grandeur strictement positive n'est jamais affichée
 * nulle (arrondie au plus petit pas affichable).
 */
function displayed(v: number, decimals: number): number {
  const r = Number(v.toFixed(decimals));
  return v > 0 && r === 0 ? 10 ** -decimals : r;
}

export interface CutListRow {
  readonly mark: string;
  readonly name: string;
  readonly category: PartCategory;
  readonly material: string;
  readonly section: string;
  readonly length?: number;
  readonly width?: number;
  readonly thickness?: number;
  readonly quantity: number;
  readonly unitVolume?: number;
  readonly unitMass?: number;
  /** Remarque sur la masse (ex. « masse volumique à valider ») ; absente sans masse. */
  readonly massNote?: string;
  /**
   * Approvisionnement particulier du débit, traduit (« placage » : `Part.stock.supply =
   * "veneer"`) ; absent : débit ordinaire. La désignation `name` le mentionne déjà.
   */
  readonly supply?: string;
}

/**
 * Pièces du débit : toutes, sauf une pièce finie dont des composantes (`Part.componentOf`) sont
 * dans le lot (elle n'a pas de débit propre : ses composantes le portent).
 */
export function cutParts(parts: readonly Part[]): readonly Part[] {
  return fabricatedParts(parts);
}

/** Approvisionnement traduit du débit d'une pièce (`undefined` : débit ordinaire). */
export function supplyLabel(t: Translator, part: Pick<Part, "stock">): string | undefined {
  return part.stock?.supply === "veneer" ? t.t("export.cutlist.supply.veneer") : undefined;
}

/** Désignation d'une ligne de débit : nom de la pièce, suivi de « (placage) » s'il y a lieu. */
export function cutName(t: Translator, part: Pick<Part, "name" | "stock">): string {
  const name = tr(t, part.name);
  return part.stock?.supply === "veneer" ? t.t("export.cutlist.veneer", { name }) : name;
}

export interface CutListRowsOptions extends LocaleOption {
  /** Remarque de masse par matériau (défaut : `defaultMassNote`). */
  readonly massNote?: MassNote;
}

/** Lignes de débit regroupées par repère, triées par catégorie puis repère. */
export function cutListRows(
  parts: readonly Part[],
  options: CutListRowsOptions = {},
): CutListRow[] {
  const t = translatorOf(options);
  const noteOf = options.massNote ?? defaultMassNote;
  // Même repère = pièces identiques. Deux pièces de même repère mais de caractéristiques de
  // débit différentes (erreur amont) ne sont jamais fusionnées en silence : une ligne chacune,
  // le repère en double reste visible.
  const groups = new Map<string, { part: Part; count: number }>();
  for (const p of cutParts(parts)) {
    const key = JSON.stringify([
      p.mark,
      p.category,
      p.material,
      trOpt(t, p.section) ?? null,
      p.stock
        ? [
            p.stock.length,
            p.stock.width,
            p.stock.thickness,
            p.stock.count ?? 1,
            p.stock.supply ?? null,
          ]
        : null,
      p.quantities[QUANTITY_VOLUME] ?? null,
      partMassKg(p) ?? null,
    ]);
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { part: p, count: 1 });
  }
  const rows: CutListRow[] = [];
  for (const { part, count } of groups.values()) {
    const s = part.stock;
    // Lames identiques d'une pièce composée (lamellé-collé) : une ligne de débit par lame.
    const pieces = s?.count !== undefined && s.count > 1 ? s.count : 1;
    const partVolume =
      part.quantities[QUANTITY_VOLUME] ??
      (s ? (s.length * s.width * s.thickness * pieces) / 1e9 : undefined);
    const volume = partVolume !== undefined ? partVolume / pieces : undefined;
    const partMass = partMassKg(part);
    const mass = partMass !== undefined ? partMass / pieces : undefined;
    const note = mass !== undefined ? noteOf(part.material, t) : undefined;
    const supply = supplyLabel(t, part);
    rows.push({
      mark: part.mark,
      name: cutName(t, part),
      category: part.category,
      material: materialLabel(t, part.material),
      section: trOpt(t, part.section) ?? "",
      ...(s ? { length: s.length, width: s.width, thickness: s.thickness } : {}),
      quantity: count * pieces,
      ...(volume !== undefined ? { unitVolume: volume } : {}),
      ...(mass !== undefined ? { unitMass: mass } : {}),
      ...(note !== undefined && note !== "" ? { massNote: note } : {}),
      ...(supply !== undefined ? { supply } : {}),
    });
  }
  const rank = (c: PartCategory): number => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  return rows.sort(
    (a, b) => rank(a.category) - rank(b.category) || compareMarks(t, a.mark, b.mark),
  );
}

export interface CutListCsvOptions extends LocaleOption {
  /** Ajoute le BOM UTF-8 (défaut : vrai, nécessaire à Excel pour les accents). */
  readonly bom?: boolean;
  /** Ajoute une ligne de total (défaut : vrai). */
  readonly totals?: boolean;
  /** Remarque de masse par matériau (défaut : `defaultMassNote`, bois à valider). */
  readonly massNote?: MassNote;
}

/** Liste de débit du modèle, texte CSV. */
export function exportCutListCsv(
  model: Pick<Model, "parts">,
  options: CutListCsvOptions = {},
): string {
  const t = translatorOf(options);
  const rows = cutListRows(model.parts, {
    locale: t.locale,
    ...(options.massNote !== undefined ? { massNote: options.massNote } : {}),
  });
  const lines: string[][] = [[...cutListHeader(t)]];
  const notes = new Set<string>();
  let qty = 0;
  let vol = 0;
  let mass = 0;
  let volKnown = rows.length > 0;
  let massKnown = rows.length > 0;
  // Totaux de colonne : somme des valeurs de ligne telles qu'affichées, pour que le total
  // corresponde à la somme des lignes lue par l'utilisateur.
  for (const r of rows) {
    const uv = r.unitVolume !== undefined ? displayed(r.unitVolume, VOLUME_DECIMALS) : undefined;
    const um = r.unitMass !== undefined ? displayed(r.unitMass, MASS_DECIMALS) : undefined;
    const tv =
      r.unitVolume !== undefined
        ? displayed(r.unitVolume * r.quantity, VOLUME_DECIMALS)
        : undefined;
    const tm =
      r.unitMass !== undefined ? displayed(r.unitMass * r.quantity, MASS_DECIMALS) : undefined;
    qty += r.quantity;
    if (tv === undefined) volKnown = false;
    else vol += tv;
    if (tm === undefined) massKnown = false;
    else mass += tm;
    lines.push([
      neutralizeFormula(r.mark),
      neutralizeFormula(r.name),
      neutralizeFormula(r.material),
      neutralizeFormula(r.section),
      dec(t, r.length, 1),
      dec(t, r.width, 1),
      dec(t, r.thickness, 1),
      String(r.quantity),
      dec(t, uv, VOLUME_DECIMALS),
      dec(t, tv, VOLUME_DECIMALS),
      dec(t, um, MASS_DECIMALS),
      dec(t, tm, MASS_DECIMALS),
      neutralizeFormula(r.massNote ?? ""),
    ]);
    if (r.massNote !== undefined) notes.add(r.massNote);
  }
  if (options.totals !== false) {
    const incomplete = t.t("csv.incomplete");
    // Total partiel signalé plutôt qu'une somme fausse quand une valeur manque.
    lines.push([
      t.t("csv.total"),
      "",
      "",
      "",
      "",
      "",
      "",
      String(qty),
      "",
      volKnown ? dec(t, vol, VOLUME_DECIMALS) : rows.length > 0 ? incomplete : "",
      "",
      massKnown ? dec(t, mass, MASS_DECIMALS) : rows.length > 0 ? incomplete : "",
      // Remarques présentes dans les lignes : le total en dépend aussi.
      neutralizeFormula([...notes].join(t.t("csv.noteSeparator"))),
    ]);
  }
  const sep = csvSeparator(t.locale);
  const body = lines.map((l) => l.map((f) => csvField(f, sep)).join(sep)).join("\r\n") + "\r\n";
  return (options.bom === false ? "" : CSV_BOM) + body;
}
