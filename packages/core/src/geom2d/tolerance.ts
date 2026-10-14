/** Tolérance géométrique en mm (ADR-0003). */
export const GEOM_EPS = 1e-6;

/** Tolérance angulaire (radians) pour les tests de colinéarité / tangence. */
export const ANGLE_EPS = 1e-9;

/**
 * Tolérance relative des grandeurs dérivées (volume en m³, masse en kg) pour reconnaître deux
 * valeurs égales au bruit d'arrondi près (regroupement des listes de débit, chantier
 * `stable-tiebreaks`). Le bruit relatif observé sur les exemples est d'au plus 1,2e-13 ; un
 * bruit de 1e-9 mm sur une pièce dont les cotes font au moins 1 mm donne au plus 3e-9 ; le plus
 * petit écart réel observé entre pièces de même repère est de 9,7e-9 en relatif (2e-6 mm sur
 * 203 mm, séparé de toute façon par la cote, comparée à `GEOM_EPS`).
 */
export const REL_EPS = 1e-8;
