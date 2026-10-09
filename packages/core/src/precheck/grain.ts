/**
 * Réduction de la résistance et du module selon l'angle du fil (QUESTIONS A35 (j), décision de
 * l'utilisateur du 2026-10-09) : formule de type Hankinson du *Wood Handbook* (FPL-GTR-190,
 * chap. 5, éq. 5-2, d'après Bodig et Jayne 1982 ; C §1.11 [81], confiance moyenne) :
 *
 *   N = P·Q / (P·sinⁿθ + Q·cosⁿθ), soit N / P = r / (sinⁿθ + r·cosⁿθ) avec r = Q / P,
 *
 * P propriété parallèle au fil, Q perpendiculaire, n constante empirique. [81] donne, pour la
 * résistance en flexion (MOR), n = 1,5 à 2 et Q/P = 0,04 à 0,10 ; pour le module d'élasticité,
 * n = 2 et Q/P = 0,04 à 0,12 (bois sans défaut, valeurs non normatives). Les valeurs retenues
 * sont des paramètres du plugin (`grainAngle.*` de `wood-central`), **à valider**.
 *
 * Angle entre le fil et l'axe d'une poutre en couches empilées (fil horizontal, [CALCUL] C §1.11,
 * **à valider**) : la poutre monte de α (pente = tan α) et le fil d'une planche s'écarte en plan
 * de β de la tangente à la trace ; dans le repère de la poutre, cos θ = cos α · cos β.
 *
 * Fonctions pures, sans seuil caché.
 */

/**
 * Rapport N / P de la formule de Hankinson pour un angle `theta` (rad) entre le fil et
 * l'effort : `ratio` / (sinⁿθ + `ratio`·cosⁿθ), `ratio` = Q / P dans ]0 ; 1], `exponent` = n > 0.
 * Vaut 1 à θ = 0 et `ratio` à θ = π/2 ; NaN pour des entrées non finies. Le résultat est borné
 * à [`ratio` ; 1] : la forme empirique en sort à peine près de 0 pour n > 2 et près de π/2
 * pour n < 2 (dénominateur sⁿθ + r·cⁿθ un peu au-dessus de 1 ou de r), alors que la propriété
 * reste entre ses valeurs perpendiculaire et parallèle ; ainsi bornée, elle décroît sur
 * [0 ; π/2] pour tout n > 0.
 */
export function hankinsonFactor(ratio: number, exponent: number, theta: number): number {
  const s = Math.abs(Math.sin(theta));
  const c = Math.abs(Math.cos(theta));
  const k = ratio / (s ** exponent + ratio * c ** exponent);
  return Number.isFinite(k) ? Math.min(1, Math.max(ratio, k)) : Number.NaN;
}

/**
 * Angle (rad, dans [0 ; π/2]) entre le fil horizontal d'une planche et l'axe de la poutre :
 * acos(cos(atan(`slope`)) · cos(`deviation`)), `slope` = pente de la poutre (tan α),
 * `deviation` = écart en plan β du fil et de la trace (rad).
 */
export function grainAngle(slope: number, deviation: number): number {
  const c = Math.cos(Math.atan(Math.abs(slope))) * Math.abs(Math.cos(deviation));
  return Math.acos(Math.min(1, Math.max(0, c)));
}
