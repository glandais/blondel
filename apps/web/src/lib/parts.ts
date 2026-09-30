/**
 * Présentation des pièces du modèle : pièce sélectionnée, nomenclature groupée par repère
 * (lignes de `cutListRows` de `@blondel/exports`, mêmes regroupements que la liste de débit
 * CSV) et totaux. Aucune grandeur n'est calculée ici hormis les sommes des quantités rendues.
 */
import type { Location, Model, Part } from "@blondel/core";
import { cutListRows, type CutListRow, type MassNote } from "@blondel/exports";
import { treadPartId } from "./compliance.js";

/** Pièce désignée par la sélection (pièce, ou pièce de la marche : `Part.treadNumber`). */
export function selectedPart(
  model: Pick<Model, "parts">,
  loc: Location | undefined | null,
): Part | undefined {
  if (!loc) return undefined;
  const id =
    loc.kind === "part"
      ? loc.partId
      : loc.kind === "tread"
        ? treadPartId(model.parts, loc.number)
        : undefined;
  return id === undefined ? undefined : model.parts.find((p) => p.id === id);
}

export interface BomLine extends CutListRow {
  /** Identifiants des pièces regroupées sur la ligne (même repère, même débit). */
  readonly partIds: readonly string[];
  /** Volume total de la ligne (m³), si connu. */
  readonly totalVolume?: number;
  readonly totalMass?: number;
}

export interface BomSummary {
  readonly lines: readonly BomLine[];
  /** Nombre total de pièces. */
  readonly count: number;
  /** Volume total (m³) ; `undefined` si une ligne n'a pas de volume. */
  readonly volume?: number;
  /** Masse totale (kg) ; `undefined` si une ligne n'a pas de masse (jamais inventée). */
  readonly mass?: number;
  /** Nombre de pièces à développé à plat. */
  readonly withFlat: number;
  /** Remarques de masse présentes dans les lignes (ex. « masse volumique à valider »). */
  readonly massNotes: readonly string[];
}

/** Clé d'une ligne de débit, quantité exclue. */
function rowKey(row: CutListRow | undefined): string {
  if (!row) return "";
  const { quantity: _quantity, ...rest } = row;
  return JSON.stringify(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Nomenclature : lignes de la liste de débit, complétées des identifiants de pièces (pour la
 * sélection) et des totaux par ligne et généraux.
 */
export function bomSummary(parts: readonly Part[], massNote?: MassNote): BomSummary {
  const opts = massNote !== undefined ? { massNote } : {};
  const rows = cutListRows(parts, opts);
  // Rattachement des pièces aux lignes par **ligne de débit identique** (repère, désignation,
  // matériau, section, débit, volume, masse : la ligne que `cutListRows` produit pour la pièce
  // seule), et non par repère seul : deux pièces de même repère mais de débits différents
  // (repère en double, erreur amont) sont sur deux lignes distinctes.
  const pool = new Map<string, Part[]>();
  for (const p of parts) {
    const key = rowKey(cutListRows([p], opts)[0]);
    const list = pool.get(key);
    if (list) list.push(p);
    else pool.set(key, [p]);
  }
  let count = 0;
  let volume: number | undefined = rows.length > 0 ? 0 : undefined;
  let mass: number | undefined = rows.length > 0 ? 0 : undefined;
  const lines: BomLine[] = rows.map((r) => {
    const same = pool.get(rowKey(r)) ?? [];
    const taken = same.splice(0, r.quantity);
    count += r.quantity;
    const totalVolume = r.unitVolume === undefined ? undefined : r.unitVolume * r.quantity;
    const totalMass = r.unitMass === undefined ? undefined : r.unitMass * r.quantity;
    volume = volume === undefined || totalVolume === undefined ? undefined : volume + totalVolume;
    mass = mass === undefined || totalMass === undefined ? undefined : mass + totalMass;
    return {
      ...r,
      partIds: taken.map((p) => p.id),
      ...(totalVolume === undefined ? {} : { totalVolume }),
      ...(totalMass === undefined ? {} : { totalMass }),
    };
  });
  return {
    lines,
    count,
    ...(volume === undefined ? {} : { volume }),
    ...(mass === undefined ? {} : { mass }),
    withFlat: parts.filter((p) => p.flat !== undefined).length,
    massNotes: [...new Set(rows.flatMap((r) => (r.massNote === undefined ? [] : [r.massNote])))],
  };
}
