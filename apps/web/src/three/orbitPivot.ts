/**
 * Pivot de l'orbite de la vue 3D : recentrage au double clic (transition de la cible des
 * contrôles vers le point visé) et taille du trièdre affiché sur ce pivot. Fonctions pures,
 * choix de présentation uniquement (aucune valeur métier).
 */

type Vec = readonly [number, number, number];

/** Durée de la transition de recentrage (ms, présentation). */
export const PIVOT_TRANSITION_MS = 250;

/**
 * Hauteur du trièdre (longueur d'un axe) en fraction de la hauteur de la vue : taille constante
 * à l'écran quelle que soit la distance de la caméra (présentation).
 */
export const PIVOT_AXES_SCREEN_FRACTION = 0.06;

/** Avancement lissé (accélération puis freinage, cubique) d'une transition, `t` ∈ [0, 1]. */
export function easeInOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/**
 * Cible de la transition de recentrage après `elapsedMs` : de `from` à `to`, atteinte (et
 * `done`) au bout de `PIVOT_TRANSITION_MS`.
 */
export function pivotAt(
  from: Vec,
  to: Vec,
  elapsedMs: number,
): { readonly target: [number, number, number]; readonly done: boolean } {
  const done = !(elapsedMs < PIVOT_TRANSITION_MS);
  if (done) return { target: [to[0], to[1], to[2]], done };
  const k = easeInOut(elapsedMs / PIVOT_TRANSITION_MS);
  return {
    target: [
      from[0] + (to[0] - from[0]) * k,
      from[1] + (to[1] - from[1]) * k,
      from[2] + (to[2] - from[2]) * k,
    ],
    done,
  };
}

/**
 * Longueur d'axe du trièdre (unités de la scène) placé à `distance` d'une caméra perspective de
 * champ vertical `fovDeg`, pour qu'il occupe `PIVOT_AXES_SCREEN_FRACTION` de la hauteur de vue.
 */
export function pivotAxesLength(distance: number, fovDeg: number): number {
  const viewHeight = 2 * Math.max(0, distance) * Math.tan((fovDeg * Math.PI) / 360);
  return viewHeight * PIVOT_AXES_SCREEN_FRACTION;
}
