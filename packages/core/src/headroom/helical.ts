/**
 * Échappée d'un hélicoïdal sous lui-même : **règle dérivée** pour filtrer les paramètres
 * (préréglage, assistant) sans construire le modèle, et trémie circulaire.
 *
 * ## Règle dérivée (A §1.7 : échappée verticale au-dessus de la ligne de pente, CHALLENGE G4)
 *
 * Hypothèses : hauteurs régulières h (pas de correction de première marche), marches d'épaisseur
 * e_m (sous-face à z_k − e_m), débord de nez d, lignes de nez rayonnantes d'angle Δθ, N = 2π / Δθ
 * marches par tour, ligne de foulée au rayon r_w, aucune dalle au-dessus de l'escalier (trémie
 * qui dégage toute l'emprise).
 *
 * Au-dessus d'un point de Γ, le plafond est la sous-face de la marche située un tour plus haut
 * qui le couvre ; la marche j couvre en plan l'angle [jΔθ ; (j + 1)Δθ + δ], δ = asin(d / r_w)
 * (débord sous le nez supérieur). Le plafond est constant par morceau et la ligne de pente monte
 * de h par Δθ : le minimum est atteint juste avant la fin de chaque morceau et vaut
 *
 *     e_marches = (N − 1 − δ / Δθ) · h − e_m
 *
 * dès que l'escalier se recouvre, c'est-à-dire (n − 1)·Δθ + δ > 2π. La forme simplifiée de la
 * consigne du jalon, n_tour·h − e_marche ≥ e_min, mesure l'échappée au-dessus du **dessus de
 * marche** (et sans débord) ; au-dessus de la ligne de pente, elle perd une hauteur de marche
 * (point en suspens au ledger).
 *
 * Palier d'arrivée (secteur d'angle Λ au niveau H, même épaisseur) : il est plat, donc plus
 * pénalisant au bout de son secteur : e_palier = (N − Λ / Δθ) · h − e_m, s'il recouvre la
 * montée ((n − 1)·Δθ + Λ > 2π et Λ > δ).
 *
 * Le calcul exact de `computeHeadroom` (auto-recouvrement) retrouve ces valeurs à 1e-6 près
 * (test par propriétés).
 */
import type { Opening } from "../model/project.js";
import type { Mm, Rad, Vec2 } from "../model/primitives.js";

export interface HelicalHeadroomInput {
  /** Nombre de hauteurs n. */
  readonly riserCount: number;
  /** Hauteur de marche h (régulière). */
  readonly rise: Mm;
  /** Angle par marche Δθ (rad). */
  readonly stepAngle: Rad;
  /** Rayon de la ligne de foulée r_w. */
  readonly walklineRadius: Mm;
  /** Épaisseur des marches (et du palier) e_m. */
  readonly treadThickness: Mm;
  /** Débord de nez d (0 : aucun). */
  readonly nosing: Mm;
  /** Angle du palier d'arrivée Λ (rad, 0 : aucun palier). */
  readonly landingAngle?: Rad;
}

export interface HelicalHeadroomBound {
  /** Échappée minimale sous les marches du tour supérieur ; `null` si l'escalier ne se recouvre pas. */
  readonly treads: Mm | null;
  /** Échappée minimale sous le palier d'arrivée ; `null` s'il ne recouvre pas la montée. */
  readonly landing: Mm | null;
  /** Minimum des deux ; `null` : aucun auto-recouvrement. */
  readonly min: Mm | null;
}

/** Échappée minimale d'un hélicoïdal sous lui-même (règle dérivée, voir l'en-tête). */
export function helicalHeadroomBound(input: HelicalHeadroomInput): HelicalHeadroomBound {
  const { riserCount: n, rise: h, stepAngle: step, treadThickness: e } = input;
  const turns = (2 * Math.PI) / step;
  const total = (n - 1) * step;
  const delta = input.nosing > 0 ? Math.asin(Math.min(1, input.nosing / input.walklineRadius)) : 0;
  const treads = total + delta > 2 * Math.PI ? (turns - 1 - delta / step) * h - e : null;
  const lambda = input.landingAngle ?? 0;
  const landing =
    lambda > delta && total + lambda > 2 * Math.PI ? (turns - lambda / step) * h - e : null;
  const values = [treads, landing].filter((v): v is Mm => v !== null);
  return { treads, landing, min: values.length > 0 ? Math.min(...values) : null };
}

/**
 * Trémie circulaire de centre `center` et de rayon `radius`, représentée par le polygone
 * **inscrit** (`kind: "polygon"`) dont la flèche ne dépasse pas `sagitta` mm : la trémie
 * modélisée est un peu plus petite que le cercle, ce qui place l'échappée du côté de la sécurité.
 * Coordonnées arrondies au 0,01 mm. Le cercle exact est déclaré dans `circle` (dette D3) pour
 * les consommateurs qui savent le tracer (`openingCircle`).
 */
export function circularOpening(center: Vec2, radius: Mm, sagitta: Mm = 0.5): Opening {
  const maxStep = radius <= sagitta ? Math.PI / 2 : 2 * Math.acos(1 - sagitta / radius);
  const count = Math.max(8, Math.ceil((2 * Math.PI) / maxStep));
  const round = (v: number): number => Math.round(v * 100) / 100;
  const points = Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return { x: round(center.x + radius * Math.cos(a)), y: round(center.y + radius * Math.sin(a)) };
  });
  return { kind: "polygon", points, circle: { center: { x: center.x, y: center.y }, radius } };
}

/**
 * Cercle exact d'une trémie circulaire, s'il est déclaré **et** cohérent avec ses points : tous
 * sur le cercle au 0,01 mm d'arrondi près et côtés égaux (polygone inscrit régulier de
 * `circularOpening`). Un polygone modifié ensuite (point déplacé ou supprimé) n'est plus un
 * cercle : `undefined`.
 */
export function openingCircle(
  opening: Opening | undefined,
): { readonly center: Vec2; readonly radius: Mm } | undefined {
  if (opening?.kind !== "polygon" || !opening.circle) return undefined;
  const { center, radius } = opening.circle;
  const pts = opening.points;
  const ok = pts.every((p) => {
    const d = Math.hypot(p.x - center.x, p.y - center.y);
    return Math.abs(d - radius) <= 0.01;
  });
  // Polygone **régulier** (côtés égaux à l'arrondi près) : un point supprimé laisse tous les
  // autres sur le cercle, mais la trémie modélisée n'est plus le polygone inscrit du cercle.
  const sides = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const regular = Math.max(...sides) - Math.min(...sides) <= 0.03;
  return ok && regular ? opening.circle : undefined;
}
