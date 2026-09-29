/**
 * Liste de débit CSV (usage français) : séparateur « ; », décimale « , », BOM UTF-8, fins de
 * ligne CRLF (ouverture directe dans un tableur réglé en français).
 *
 * Regroupement : les pièces de même repère (`Part.mark`) sont des pièces identiques ; la
 * quantité est leur nombre (deux pièces de même repère mais de débit différent restent sur deux
 * lignes). Grandeurs lues dans `Part.quantities` : `volume` (m³) et `mass`
 * (kg) ; à défaut de `volume`, volume brut du débit L × l × e (`Part.stock`). Aucune masse
 * n'est inventée : sans `mass`, la colonne reste vide.
 */
import type { Model, Part, PartCategory } from "@blondel/core";
import { formatFr } from "../format.js";

export const QUANTITY_VOLUME = "volume";
export const QUANTITY_MASS = "mass";

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
}

/** Lignes de débit regroupées par repère, triées par catégorie puis repère. */
export function cutListRows(parts: readonly Part[]): CutListRow[] {
  // Même repère = pièces identiques. Deux pièces de même repère mais de caractéristiques de
  // débit différentes (erreur amont) ne sont jamais fusionnées en silence : une ligne chacune,
  // le repère en double reste visible.
  const groups = new Map<string, { part: Part; count: number }>();
  for (const p of parts) {
    const key = JSON.stringify([
      p.mark,
      p.category,
      p.material,
      p.section ?? null,
      p.stock ? [p.stock.length, p.stock.width, p.stock.thickness] : null,
      p.quantities[QUANTITY_VOLUME] ?? null,
      p.quantities[QUANTITY_MASS] ?? null,
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
    const mass = part.quantities[QUANTITY_MASS];
    rows.push({
      mark: part.mark,
      name: part.name,
      category: part.category,
      material: MATERIAL_LABELS[part.material] ?? part.material,
      section: part.section ?? "",
      ...(s ? { length: s.length, width: s.width, thickness: s.thickness } : {}),
      quantity: count,
      ...(volume !== undefined ? { unitVolume: volume } : {}),
      ...(mass !== undefined ? { unitMass: mass } : {}),
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
}

/** Liste de débit du modèle, texte CSV. */
export function exportCutListCsv(
  model: Pick<Model, "parts">,
  options: CutListCsvOptions = {},
): string {
  const rows = cutListRows(model.parts);
  const lines: string[][] = [[...CUT_LIST_HEADER]];
  let qty = 0;
  let vol = 0;
  let mass = 0;
  let volKnown = rows.length > 0;
  let massKnown = rows.length > 0;
  for (const r of rows) {
    const tv = r.unitVolume !== undefined ? r.unitVolume * r.quantity : undefined;
    const tm = r.unitMass !== undefined ? r.unitMass * r.quantity : undefined;
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
      dec(r.unitVolume, 4),
      dec(tv, 4),
      dec(r.unitMass, 2),
      dec(tm, 2),
    ]);
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
      volKnown ? dec(vol, 4) : rows.length > 0 ? "incomplet" : "",
      "",
      massKnown ? dec(mass, 2) : rows.length > 0 ? "incomplet" : "",
    ]);
  }
  const body = lines.map((l) => l.map(csvField).join(";")).join("\r\n") + "\r\n";
  return (options.bom === false ? "" : CSV_BOM) + body;
}
