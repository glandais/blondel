/**
 * DXF de tous les développés d'un modèle : un fichier par repère (les pièces de même repère
 * et de même développé sont identiques : un seul fichier, quantité dans le calque INFO).
 *
 * Pas d'archive ici : la liste `{ filename, content }` est téléchargée telle quelle ou
 * regroupée par l'interface avec `createZip` (archive ZIP « stockée », sans compression ni
 * dépendance, voir `../zip.ts`).
 */
import type { Model, Part } from "@blondel/core";
import { exportPartDxf, type PartDxfOptions } from "./part.js";

export interface PartDxfFile {
  /** Nom de fichier sûr (`<repère>.dxf`), unique sans tenir compte de la casse. */
  readonly filename: string;
  readonly content: string;
  readonly mark: string;
  /** Pièces couvertes par ce fichier (même repère, même développé). */
  readonly partIds: readonly string[];
  readonly quantity: number;
}

export type PartsDxfOptions = Omit<PartDxfOptions, "quantity">;

/** Noms de périphériques réservés par Windows (même suivis d'une extension). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Nom de fichier portable : lettres, chiffres, `-` et `_` seulement ; accents retirés ; les
 * noms réservés par Windows (`CON`, `NUL`, `COM1`…, fréquents comme repères courts) suffixés.
 */
export function safeFileStem(text: string): string {
  const s = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (s === "") return "piece";
  return WINDOWS_RESERVED.test(s) ? `${s}_` : s;
}

/**
 * Un DXF par développé (repère), dans l'ordre des pièces du modèle. Les pièces sans
 * développé sont ignorées. Deux pièces de même repère mais de développés différents (erreur
 * amont de nomenclature) donnent deux fichiers distincts, jamais une fusion silencieuse.
 */
export function exportPartsDxf(
  model: Pick<Model, "parts">,
  options: PartsDxfOptions = {},
): PartDxfFile[] {
  const groups = new Map<string, { part: Part; ids: string[] }>();
  for (const part of model.parts) {
    if (part.flat === undefined) continue;
    const key = JSON.stringify([part.mark, part.material, part.flat]);
    const g = groups.get(key);
    if (g) g.ids.push(part.id);
    else groups.set(key, { part, ids: [part.id] });
  }
  const used = new Set<string>();
  const out: PartDxfFile[] = [];
  for (const { part, ids } of groups.values()) {
    const stem = safeFileStem(part.mark);
    let name = stem;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}-${i}`;
    used.add(name.toLowerCase());
    out.push({
      filename: `${name}.dxf`,
      content: exportPartDxf(part, { ...options, quantity: ids.length }),
      mark: part.mark,
      partIds: ids,
      quantity: ids.length,
    });
  }
  return out;
}
