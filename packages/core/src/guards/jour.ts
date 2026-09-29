/**
 * Largeur du jour (vide central d'un U ou d'un demi-tournant) : entre deux tournants
 * consécutifs de même sens, la première et la troisième volée se font face ; le jour est la
 * distance entre les deux coins intérieurs (longueur du bord intérieur de la volée centrale),
 * diminuée des demi-côtés des poteaux d'angle qui y débordent. Sert à décider si un garde-corps
 * de jour peut être construit : sous la sphère T1 (`GC_GABARIT_T1_2024.max`, 110 mm), deux
 * garde-corps décalés vers le vide s'y croiseraient.
 */
import * as V from "../geom2d/vec.js";
import type { Layout } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { Turn } from "../model/project.js";
import { newelSetback } from "../layout/newel.js";
import { findRule } from "../rules/table.js";

/**
 * Début du message d'erreur de modèle d'un garde-corps de jour non généré (jour trop étroit) :
 * repère stable pour `suggestFixes` (correction « côté jour → mur »).
 */
export const NARROW_JOUR_ERROR_PREFIX = "Garde-corps de volée côté jour non généré";

/**
 * Seuil (mm) sous lequel le jour est jugé trop étroit pour un garde-corps de jour : diamètre de
 * la sphère T1 lu dans rules.yaml (`GC_GABARIT_T1_2024.max`) ; `null` si la règle est absente.
 */
export function narrowJourThreshold(): Mm | null {
  return findRule("GC_GABARIT_T1_2024")?.max ?? null;
}

/**
 * Débord d'un jour de tournant dans le vide central : demi-côté d'un poteau (plus son décalage
 * vers le jour), 0 sinon.
 */
function protrusion(turn: Turn | undefined): Mm {
  return turn?.inner.kind === "newel" ? newelSetback(turn.inner) : 0;
}

/**
 * Largeur minimale du jour (mm) entre tournants consécutifs de même sens ; `Infinity` sans
 * tel couple (droit, quart tournant, tournants de sens opposés). `turns` : tournants du projet
 * (`stair.layout.turns`), dans l'ordre de `layout.turns`.
 */
export function jourWidth(layout: Layout, turns: readonly Turn[]): Mm {
  let best = Infinity;
  for (let j = 0; j + 1 < layout.turns.length; j++) {
    const a = layout.turns[j]!;
    const b = layout.turns[j + 1]!;
    if (a.direction !== b.direction) continue;
    const w =
      V.distance(a.innerCorner, b.innerCorner) -
      protrusion(turns[a.index]) -
      protrusion(turns[b.index]);
    if (w < best) best = w;
  }
  return best;
}
