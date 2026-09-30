/**
 * Liste de débit CSV (usage français) : séparateur « ; », décimale « , », BOM UTF-8, fins de
 * ligne CRLF (ouverture directe dans un tableur réglé en français).
 *
 * Regroupement : les pièces de même repère (`Part.mark`) sont des pièces identiques ; la
 * quantité est leur nombre (deux pièces de même repère mais de débit différent restent sur deux
 * lignes). Grandeurs lues dans `Part.quantities` : `volume` (m³) et la masse (kg), clé
 * normalisée `mass_kg` du cœur, à défaut clé historique `mass` (`partMassKg`) ; à défaut de
 * `volume`, volume brut du débit L × l × e (`Part.stock`). Aucune masse n'est inventée : sans
 * masse, la colonne reste vide et le total est « incomplet ».
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
  isWoodMaterial,
  type MaterialId,
  type Model,
  type Part,
  type PartCategory,
  type WorkshopProfileInput,
} from "@blondel/core";
import { formatFr } from "../format.js";
import { tr, trOpt } from "../i18n.js";

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

/** Mention portée par une masse calculée avec une masse volumique non validée. */
export const MASS_DENSITY_NOTE = "masse volumique à valider";

/** Remarque attachée à la masse d'une pièce selon son matériau (`undefined` : aucune). */
export type MassNote = (material: MaterialId) => string | undefined;

/** Remarque par défaut : bois (masses volumiques du profil d'atelier par défaut à valider). */
export const defaultMassNote: MassNote = (material) =>
  isWoodMaterial(material) ? MASS_DENSITY_NOTE : undefined;

/**
 * Remarque de masse pour un projet : les essences dont le profil d'atelier du projet renseigne
 * la masse volumique (valeur de l'atelier) n'ont pas de mention ; les autres essences de bois
 * gardent « masse volumique à valider ».
 */
export function massNoteFor(workshop?: WorkshopProfileInput): MassNote {
  const own = workshop?.wood?.densities ?? {};
  return (material) =>
    isWoodMaterial(material) && own[material] === undefined ? MASS_DENSITY_NOTE : undefined;
}

export const CSV_BOM = "﻿";

export const MATERIAL_LABELS: Readonly<Record<Part["material"], string>> = {
  "wood-oak": "Chêne",
  "wood-beech": "Hêtre",
  "wood-ash": "Frêne",
  "wood-pine": "Pin",
  "wood-glulam": "Lamellé-collé",
  "steel-raw": "Acier brut",
  "steel-painted": "Acier peint",
  "steel-galvanized": "Acier galvanisé",
  "stainless-brushed": "Inox brossé",
  glass: "Verre",
  concrete: "Béton",
};

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

export const CUT_LIST_HEADER = [
  "Repère",
  "Désignation",
  "Matériau",
  "Section",
  "Longueur (mm)",
  "Largeur (mm)",
  "Épaisseur (mm)",
  "Quantité",
  "Volume unitaire (m³)",
  "Volume total (m³)",
  "Masse unitaire (kg)",
  "Masse totale (kg)",
  "Remarque masse",
] as const;

/** Champ CSV : guillemets si nécessaire (séparateur, guillemet, saut de ligne, espaces de bord). */
export function csvField(value: string): string {
  return /[;"\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Neutralise une formule de tableur (injection CSV) : un texte commençant par `=`, `+`, `-`,
 * `@`, une tabulation ou un retour chariot est préfixé d'une apostrophe, que les tableurs
 * lisent comme « texte littéral ». Réservé aux champs **texte** (repère, désignation,
 * matériau, section) : les colonnes numériques, produites par `formatFr`, restent intactes.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Champ CSV texte : neutralisé puis mis entre guillemets si nécessaire. */
export function csvTextField(value: string): string {
  return csvField(neutralizeFormula(value));
}

const dec = (v: number | undefined, decimals: number): string =>
  v === undefined || !Number.isFinite(v) ? "" : formatFr(v, { decimals, thousands: "" });

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

/** Comparaison « naturelle » des repères (M2 < M10). */
function compareMarks(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
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
}

export interface CutListRowsOptions {
  /** Remarque de masse par matériau (défaut : `defaultMassNote`). */
  readonly massNote?: MassNote;
}

/** Lignes de débit regroupées par repère, triées par catégorie puis repère. */
export function cutListRows(
  parts: readonly Part[],
  options: CutListRowsOptions = {},
): CutListRow[] {
  const noteOf = options.massNote ?? defaultMassNote;
  // Même repère = pièces identiques. Deux pièces de même repère mais de caractéristiques de
  // débit différentes (erreur amont) ne sont jamais fusionnées en silence : une ligne chacune,
  // le repère en double reste visible.
  const groups = new Map<string, { part: Part; count: number }>();
  for (const p of parts) {
    const key = JSON.stringify([
      p.mark,
      p.category,
      p.material,
      trOpt(p.section) ?? null,
      p.stock ? [p.stock.length, p.stock.width, p.stock.thickness] : null,
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
    const volume =
      part.quantities[QUANTITY_VOLUME] ??
      (s ? (s.length * s.width * s.thickness) / 1e9 : undefined);
    const mass = partMassKg(part);
    const note = mass !== undefined ? noteOf(part.material) : undefined;
    rows.push({
      mark: part.mark,
      name: tr(part.name),
      category: part.category,
      material: MATERIAL_LABELS[part.material] ?? part.material,
      section: trOpt(part.section) ?? "",
      ...(s ? { length: s.length, width: s.width, thickness: s.thickness } : {}),
      quantity: count,
      ...(volume !== undefined ? { unitVolume: volume } : {}),
      ...(mass !== undefined ? { unitMass: mass } : {}),
      ...(note !== undefined && note !== "" ? { massNote: note } : {}),
    });
  }
  const rank = (c: PartCategory): number => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  return rows.sort((a, b) => rank(a.category) - rank(b.category) || compareMarks(a.mark, b.mark));
}

export interface CutListCsvOptions {
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
  const rows = cutListRows(
    model.parts,
    options.massNote !== undefined ? { massNote: options.massNote } : {},
  );
  const lines: string[][] = [[...CUT_LIST_HEADER]];
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
      dec(r.length, 1),
      dec(r.width, 1),
      dec(r.thickness, 1),
      String(r.quantity),
      dec(uv, VOLUME_DECIMALS),
      dec(tv, VOLUME_DECIMALS),
      dec(um, MASS_DECIMALS),
      dec(tm, MASS_DECIMALS),
      neutralizeFormula(r.massNote ?? ""),
    ]);
    if (r.massNote !== undefined) notes.add(r.massNote);
  }
  if (options.totals !== false) {
    // Total partiel signalé plutôt qu'une somme fausse quand une valeur manque.
    lines.push([
      "Total",
      "",
      "",
      "",
      "",
      "",
      "",
      String(qty),
      "",
      volKnown ? dec(vol, VOLUME_DECIMALS) : rows.length > 0 ? "incomplet" : "",
      "",
      massKnown ? dec(mass, MASS_DECIMALS) : rows.length > 0 ? "incomplet" : "",
      // Remarques présentes dans les lignes : le total en dépend aussi.
      neutralizeFormula([...notes].join(" ; ")),
    ]);
  }
  const body = lines.map((l) => l.map(csvField).join(";")).join("\r\n") + "\r\n";
  return (options.bom === false ? "" : CSV_BOM) + body;
}
