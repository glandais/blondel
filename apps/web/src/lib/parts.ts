/**
 * Présentation des pièces du modèle : pièce sélectionnée, nomenclature groupée par repère
 * (groupes de `cutListGroups` de `@blondel/exports` : mêmes lignes que la liste de débit CSV,
 * pièces rattachées par appartenance au groupe, convention C2) et totaux. Chaque ligne porte
 * les cotes de débit du repère (décision F10 (28)) et sa désignation commune (`markName`, à
 * défaut `name`, décision (36)). Aucune grandeur n'est calculée ici hormis les sommes des
 * quantités rendues ; aucun regroupement n'est fait ici.
 */
import type { Location, Model, Part } from "@blondel/core";
import { cutListGroups, type CutListRow, type MassNote } from "@blondel/exports";
import type { Locale } from "@blondel/i18n";
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
  /**
   * Identifiants des pièces de la ligne : membres du groupe de repère des exports
   * (`cutListGroups`). Une pièce à lames (`stock.count`) y figure une fois et compte pour
   * `stock.count` dans `quantity`.
   */
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

/**
 * Nomenclature : lignes de la liste de débit dans la langue `locale` (désignations, matériaux,
 * remarques), complétées des identifiants de pièces (pour la sélection) et des totaux par ligne
 * et généraux.
 */
export function bomSummary(
  parts: readonly Part[],
  locale: Locale,
  massNote?: MassNote,
): BomSummary {
  const opts = massNote !== undefined ? { massNote, locale } : { locale };
  // Rattachement des pièces aux lignes par **appartenance au groupe de repère** que les exports
  // ont formé (`cutListGroups`, convention C2 du lot « attribution des repères ») : l'interface
  // ne regroupe rien elle-même, ni par désignation ni par cotes. Une ligne de nomenclature est
  // donc exactement une ligne de la liste de débit.
  const groups = cutListGroups(parts, opts);
  const rows = groups.map((g) => g.row);
  let count = 0;
  let volume: number | undefined = rows.length > 0 ? 0 : undefined;
  let mass: number | undefined = rows.length > 0 ? 0 : undefined;
  const lines: BomLine[] = groups.map(({ row: r, partIds }) => {
    count += r.quantity;
    const totalVolume = r.unitVolume === undefined ? undefined : r.unitVolume * r.quantity;
    const totalMass = r.unitMass === undefined ? undefined : r.unitMass * r.quantity;
    volume = volume === undefined || totalVolume === undefined ? undefined : volume + totalVolume;
    mass = mass === undefined || totalMass === undefined ? undefined : mass + totalMass;
    return {
      ...r,
      partIds,
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
