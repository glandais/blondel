/**
 * Tableau FCBA des crémaillères bois (C §1.4, règle CREMAILLERE_REGLE_MOYENS de rules.yaml).
 *
 * Lu dans les champs structurés de la règle (aucune valeur en dur) : `tables.C30` / `tables.D40`
 * (lignes `{ epaisseur, distance }`), `parametres.hauteur_etage` et `parametres.pente` (domaine
 * de l'exemple publié). La description de la règle reprend les mêmes valeurs (test de
 * cohérence de rules.yaml).
 *
 * Domaine publié (FCBA) : crémaillères **par paire**, non fixées au mur, escalier **droit**,
 * hauteur d'étage **2,70 m**, pente **38°**.
 */
import { MessageError, msg } from "@blondel/i18n";
import { numberCell, ruleParam, ruleTable, getRule, type RuleDef } from "../rules/table.js";

export const CREMAILLERE_RULE_ID = "CREMAILLERE_REGLE_MOYENS";

export type StrengthClass = "C30" | "D40";

export interface FcbaTable {
  /** Couples (épaisseur mm, distance mini fond d'entaille / sous-face mm) par classe. */
  readonly rows: Readonly<
    Record<StrengthClass, readonly { thickness: number; residual: number }[]>
  >;
  /** Hauteur d'étage (mm) et pente (degrés) de l'exemple publié. */
  readonly floorToFloor: number;
  readonly pitchDeg: number;
}

/** Tableau lu dans les champs structurés de la règle ; lève une erreur s'ils manquent. */
export function parseFcbaTable(rule: RuleDef): FcbaTable {
  const rows = {} as Record<StrengthClass, { thickness: number; residual: number }[]>;
  for (const cls of ["C30", "D40"] as const) {
    const pairs = ruleTable(rule, cls).map((r) => ({
      thickness: numberCell(r, "epaisseur"),
      residual: numberCell(r, "distance"),
    }));
    if (pairs.length === 0)
      throw new MessageError(msg("structure.woodCut.fcba.tableEmpty", { cls }));
    rows[cls] = [...pairs].sort((a, b) => a.thickness - b.thickness);
  }
  return {
    rows,
    floorToFloor: ruleParam(rule, "hauteur_etage"),
    pitchDeg: ruleParam(rule, "pente"),
  };
}

let cached: FcbaTable | null = null;

/** Tableau FCBA lu dans rules.yaml. */
export function fcbaTable(): FcbaTable {
  cached ??= parseFcbaTable(getRule(CREMAILLERE_RULE_ID));
  return cached;
}

/**
 * Distance mini fond d'entaille / sous-face exigée pour une épaisseur, **du côté de la
 * sécurité** : valeur de la plus grande épaisseur tabulée ≤ e (la distance exigée décroît avec
 * l'épaisseur ; aucune interpolation). `null` sous la plus petite épaisseur tabulée.
 */
export function requiredResidual(
  table: FcbaTable,
  cls: StrengthClass,
  thickness: number,
): number | null {
  let best: number | null = null;
  for (const r of table.rows[cls]) if (r.thickness <= thickness + 1e-9) best = r.residual;
  return best;
}
