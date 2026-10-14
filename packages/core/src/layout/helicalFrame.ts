/**
 * Repère d'un tracé hélicoïdal (jalon 5a ; F10 sous-lot P3) : sens de rotation, angle d'un rayon
 * et point sur un rayon, lus sur le résumé dérivé `Layout.helical` (`helicalLayoutOf`,
 * `layout/cage/fromHelical.ts`). Partagés par la structure à fût ou limon central
 * (`structures/helicalCore.ts`) et par le plan coté (`@blondel/exports`, secteurs et numéros).
 * L'ancien moteur hélicoïdal (`layout/helical.ts`, `stepping/helical.ts`) est retiré en P3 :
 * un hélicoïdal est calculé par le moteur de cage d'origine `helical`.
 */
import type { HelicalLayout } from "../model/derived.js";
import type { Mm, Rad, Vec2 } from "../model/primitives.js";
import * as V from "../geom2d/vec.js";

/** Signe du sens de rotation : +1 à gauche (trigonométrique), −1 à droite. */
export function helicalSign(h: Pick<HelicalLayout, "direction">): 1 | -1 {
  return h.direction === "left" ? 1 : -1;
}

/** Angle (repère monde) du rayon situé à la progression `u` (rad, ≥ 0) depuis le nez 0. */
export function helicalAngleAt(h: HelicalLayout, u: Rad): Rad {
  return h.startAngle + helicalSign(h) * u;
}

/** Point à la distance `radius` de l'axe, sur le rayon d'angle `angle`. */
export function helicalPoint(h: Pick<HelicalLayout, "center">, radius: Mm, angle: Rad): Vec2 {
  return V.addScaled(h.center, V.fromAngle(angle), radius);
}
