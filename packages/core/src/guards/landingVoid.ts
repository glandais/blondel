/**
 * Vide de la trémie au niveau haut quand le palier d'arrivée d'un hélicoïdal affleure le nez de
 * dalle (trémie circulaire des préréglages, « sortie vers la dalle ») : le palier est au niveau
 * du sol haut et prolonge le plancher sur son arc extérieur, commun aux deux contours. Le
 * garde-corps de trémie ne doit donc pas longer cet arc (il fermerait la sortie) mais contourner
 * le palier : son bord radial de fin (au-dessus des premières marches) et, sur un jour central,
 * son arc intérieur.
 *
 * Vide = trémie − palier : la portion commune (sommets confondus, dans le même sens) est
 * remplacée par le reste du contour du palier, parcouru en sens horaire.
 */
import * as V from "../geom2d/vec.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";

/**
 * Écart (mm) sous lequel un sommet de la trémie est confondu avec un sommet du palier : la
 * trémie d'un préréglage reprend exactement les sommets du palier ; une trémie resaisie est
 * arrondie au dixième de mm (`OPENING_POINT_PRECISION`).
 */
export const LANDING_VERTEX_TOLERANCE: Mm = 0.5;

/**
 * Contour du vide (CCW) : `opening` (CCW) privé de `landing` (CCW) quand ils partagent au moins
 * un côté ; sinon `opening` inchangé (palier séparé du nez de dalle, liaison non modélisée).
 */
export function openingMinusLanding(
  opening: readonly Vec2[],
  landing: Polygon2 | undefined,
  tolerance: Mm = LANDING_VERTEX_TOLERANCE,
): Vec2[] {
  const n = opening.length;
  const m = landing?.length ?? 0;
  if (!landing || n < 3 || m < 3) return [...opening];
  const match = opening.map((p) => landing.findIndex((q) => V.distance(p, q) <= tolerance));
  // Plus longue suite de sommets consécutifs de la trémie confondus avec des sommets
  // consécutifs du palier (même sens).
  let best: { i0: number; a: number; len: number } | null = null;
  for (let i0 = 0; i0 < n; i0++) {
    const a = match[i0]!;
    if (a < 0) continue;
    // Début de suite seulement : le sommet précédent ne la prolonge pas.
    const prev = match[(i0 + n - 1) % n]!;
    if (prev >= 0 && (prev + 1) % m === a) continue;
    let len = 1;
    while (len < Math.min(n, m) && match[(i0 + len) % n] === (a + len) % m) len++;
    if (!best || len > best.len) best = { i0, a, len };
  }
  if (!best || best.len < 2 || best.len >= m || best.len >= n) return [...opening];
  const { i0, a, len } = best;
  const i1 = (i0 + len - 1) % n;
  const b = (a + len - 1) % m;
  const out: Vec2[] = [];
  // Trémie hors portion commune, de sa fin (O[i1] = L[b]) à son début (O[i0] = L[a]).
  for (let k = 0; k <= n - len + 1; k++) out.push(opening[(i1 + k) % n]!);
  // Palier en sens horaire, de L[a − 1] à L[b + 1].
  for (let k = 1; k <= m - len; k++) out.push(landing[(a - k + m) % m]!);
  return out;
}
