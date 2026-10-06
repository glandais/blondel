/**
 * Classes de largeur de la fenêtre (ADR-0009 point 3, repli simple des petits écrans) :
 *
 * - `wide` (≥ 1 100 px) : mise en page de la maquette, inspecteur en colonne ;
 * - `medium` (760 à 1 099 px) : l'inspecteur du parcours libre passe en tiroir, ouvert par la
 *   sélection ou le badge « Contrôle », fermé par Échap ;
 * - `narrow` (< 760 px) : le parcours guidé est imposé, la barre d'étapes défile horizontalement
 *   et la vue passe au-dessus du formulaire.
 *
 * Fonctions pures (sans DOM) ; l'abonnement aux requêtes média est dans
 * `components/useViewport.ts`.
 */

/** En dessous : inspecteur en tiroir. */
export const DRAWER_BREAKPOINT = 1100;
/** En dessous : parcours guidé imposé. */
export const GUIDED_ONLY_BREAKPOINT = 760;

export type ViewportClass = "wide" | "medium" | "narrow";

/** Classe d'une largeur de fenêtre (px CSS). */
export function viewportClass(width: number): ViewportClass {
  if (width >= DRAWER_BREAKPOINT) return "wide";
  if (width >= GUIDED_ONLY_BREAKPOINT) return "medium";
  return "narrow";
}

/** Requête média de chaque seuil (largeur minimale). */
export const DRAWER_QUERY = `(min-width: ${DRAWER_BREAKPOINT}px)`;
export const GUIDED_ONLY_QUERY = `(min-width: ${GUIDED_ONLY_BREAKPOINT}px)`;

/** Classe d'après le résultat des deux requêtes média (`DRAWER_QUERY`, `GUIDED_ONLY_QUERY`). */
export function viewportClassOf(atLeastDrawer: boolean, atLeastGuidedOnly: boolean): ViewportClass {
  if (atLeastDrawer) return "wide";
  return atLeastGuidedOnly ? "medium" : "narrow";
}
