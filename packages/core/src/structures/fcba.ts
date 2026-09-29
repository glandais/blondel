/**
 * Tableau FCBA des crémaillères bois (C §1.4, règle CREMAILLERE_REGLE_MOYENS de rules.yaml).
 *
 * rules.yaml ne porte le tableau que dans la **description** de la règle (« C30 : 33→179,
 * 44→163, 70→141 ; D40 : 35→177, 44→162, 70→139 ; crémaillère centrale : épaisseurs x2 ») :
 * il est extrait de ce texte (aucune valeur en dur) ; un test vérifie l'extrait.
 *
 * Domaine publié (FCBA) : crémaillères **par paire**, non fixées au mur, escalier **droit**,
 * hauteur d'étage **2,70 m**, pente **38°**. Ces conditions sont lues dans la description.
 */
import { getRule } from "../rules/table.js";

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

/** Extrait le tableau de la description de la règle ; lève une erreur si le format change. */
export function parseFcbaTable(description: string): FcbaTable {
  const rows = {} as Record<StrengthClass, { thickness: number; residual: number }[]>;
  for (const cls of ["C30", "D40"] as const) {
    const m = new RegExp(`${cls}\\s*:\\s*([^;]+)`).exec(description);
    if (!m) throw new Error(`Tableau FCBA : classe ${cls} introuvable dans rules.yaml.`);
    const pairs = [...m[1]!.matchAll(/(\d+)\s*→\s*(\d+)/g)].map((p) => ({
      thickness: Number(p[1]),
      residual: Number(p[2]),
    }));
    if (pairs.length === 0) throw new Error(`Tableau FCBA : aucune valeur pour ${cls}.`);
    rows[cls] = pairs.sort((a, b) => a.thickness - b.thickness);
  }
  const h = /(\d+),(\d+)\s*m/.exec(description);
  const pitch = /(\d+)\s*°/.exec(description);
  if (!h || !pitch) throw new Error("Tableau FCBA : hauteur d'étage ou pente introuvable.");
  return {
    rows,
    floorToFloor: Math.round(Number(`${h[1]}.${h[2]}`) * 1000),
    pitchDeg: Number(pitch[1]),
  };
}

let cached: FcbaTable | null = null;

/** Tableau FCBA lu dans rules.yaml. */
export function fcbaTable(): FcbaTable {
  cached ??= parseFcbaTable(getRule(CREMAILLERE_RULE_ID).description);
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
