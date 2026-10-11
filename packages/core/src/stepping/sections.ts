/**
 * Direction des lignes de nez sur les tronçons d'une cage saisie (sous-lot 2c, ADR-0010, plan
 * C.1).
 *
 * Les nez initiaux sont perpendiculaires à Γ (`stepping.ts`) et leurs extrémités Q et R sont
 * toujours les premières intersections de la ligne de nez avec les bords **réels** C_i et C_e
 * (`balancing/postprocess.ts`, `realizeNosing`) : bords inclinés d'un trapèze, arcs
 * concentriques d'un axe en arc, raccords de jonction. Sur un axe en arc, Γ est concentrique :
 * la perpendiculaire à Γ est le rayon, les nez rayonnent vers le centre de l'arc, à abscisses
 * égales sur Γ.
 *
 * Deux cas d'une cage saisie demandent une autre direction que la perpendiculaire à Γ [choix
 * Blondel, à valider, question F13] :
 * - **bords d'un palier droit** (jonction d'angle 0) : Γ peut y être anguleuse (F12 (2)) ; le
 *   nez du bord du palier suit la ligne transversale du tronçon voisin (ligne d'arrivée du
 *   tronçon entrant, ligne de départ du sortant), comme le nez du bord d'un palier d'angle suit
 *   le bord du carré d'angle ;
 * - **tronçon droit où Γ est oblique** (largeur variable, décision F12 (1) et (2)) : les nez
 *   restent perpendiculaires à l'axe du tronçon (parallèles à ses lignes de départ et
 *   d'arrivée), comme dans la transition d'un escalier en S ou en Z (`WalklineTransition`),
 *   et non à l'oblique de Γ ; le nez de départ est sur la ligne de départ, le nez d'arrivée sur
 *   la ligne d'arrivée. Aux limites d'une jonction tournante, la direction du tournant prévaut.
 *
 * Une cage dont Γ est parallèle à l'axe de chaque tronçon droit (largeur constante, toute cage
 * issue de volées) n'est pas concernée : découpage identique à celui des volées.
 */
import { curveTangentAt } from "../geom2d/curve.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { Layout, LayoutSection, LayoutSectionLine } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";

/**
 * Écart (sinus de l'angle) entre Γ et l'axe d'un tronçon droit au-delà duquel Γ est jugée
 * oblique : tolérance numérique (bruit d'arrondi d'un tracé à largeur constante), pas une
 * valeur métier.
 */
export const OBLIQUE_WALKLINE_SIN = 1e-9;

/** Direction de montée (unitaire) d'une ligne transversale gauche → droite. */
export function lineAxis(line: LayoutSectionLine): Vec2 {
  return V.normalize(V.perpLeft(V.sub(line.right, line.left)));
}

/**
 * Tangente de référence du nez d'abscisse `s` sur Γ d'une cage saisie (les nez sont
 * perpendiculaires à cette direction), ou `undefined` : perpendiculaire à Γ (cas courant).
 * Voir l'en-tête du module.
 */
export function cageNosingTangent(layout: Layout, s: Mm): Vec2 | undefined {
  const sections = layout.sections;
  if (!sections || sections.length === 0) return undefined;
  // Bords d'un palier droit : ligne transversale du tronçon voisin.
  for (const t of layout.turns) {
    if (t.mode !== "landing" || t.angle !== 0) continue;
    const before = sections[t.index];
    const after = sections[t.index + 1];
    if (before && before.kind === "straight" && Math.abs(s - t.sStart) <= GEOM_EPS) {
      return lineAxis(before.end);
    }
    if (after && after.kind === "straight" && Math.abs(s - t.sEnd) <= GEOM_EPS) {
      return lineAxis(after.start);
    }
  }
  const total = sections[sections.length - 1]!.sEnd;
  for (const sec of sections) {
    if (sec.kind !== "straight" || !inStraightPart(sec, s, total)) continue;
    const u = lineAxis(sec.start);
    const tangent = curveTangentAt(layout.walkline, s);
    if (Math.abs(V.cross(tangent, u)) > OBLIQUE_WALKLINE_SIN) return u;
    return undefined;
  }
  return undefined;
}

/**
 * `s` est-il dans la partie droite du tronçon ? Intervalle ouvert aux limites d'une jonction
 * (la zone du tournant décide), fermé au départ (s = 0) et à l'arrivée (s = |Γ|).
 */
function inStraightPart(sec: LayoutSection, s: Mm, total: Mm): boolean {
  const lo = sec.sStart <= GEOM_EPS ? sec.sStart - GEOM_EPS : sec.sStart + GEOM_EPS;
  const hi = Math.abs(sec.sEnd - total) <= GEOM_EPS ? sec.sEnd + GEOM_EPS : sec.sEnd - GEOM_EPS;
  return s >= lo && s <= hi;
}
