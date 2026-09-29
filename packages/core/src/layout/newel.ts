/**
 * Emprise d'un poteau d'angle (`inner.kind = "newel"`) autour du coin intérieur K, dans la base
 * (n, u) du tournant (n : normale jour → mur de la volée entrante, u : sens de montée de la
 * volée entrante). Le poteau occupe [−s ; p] × [−s ; p] : il déborde de p côté marches (les
 * marches le contournent) et de s côté jour, avec s = a/2 + δ et p = a/2 − δ (a : côté,
 * δ : décalage vers le jour, 0 pour un poteau centré).
 */
import type { Mm } from "../model/primitives.js";

/** Poteau d'angle du contrat `InnerCornerSchema`. */
export interface NewelCorner {
  readonly kind: "newel";
  readonly size: Mm;
  readonly offset?: Mm | undefined;
}

/** Décalage du poteau vers le jour (0 s'il est centré sur K). */
export function newelOffset(newel: NewelCorner): Mm {
  return newel.offset ?? 0;
}

/**
 * Débord côté jour s = a/2 + δ : retrait de la partie droite de C_i (et de la face du limon de
 * jour) de part et d'autre de K, et largeur disponible pour recevoir un limon dont la face
 * côté marches passe par K.
 */
export function newelSetback(newel: NewelCorner): Mm {
  return newel.size / 2 + newelOffset(newel);
}

/** Débord côté marches p = a/2 − δ (décrochement de C_i autour du poteau). */
export function newelProtrusion(newel: NewelCorner): Mm {
  return newel.size / 2 - newelOffset(newel);
}

/** Distance de K au sommet le plus éloigné du contour du poteau côté marches, √(s² + p²). */
export function newelReach(newel: NewelCorner): Mm {
  return Math.hypot(newelSetback(newel), newelProtrusion(newel));
}
