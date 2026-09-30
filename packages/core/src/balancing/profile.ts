/**
 * Courbe de développement du limon intérieur pour M3 (B §3.5, CHALLENGE G3).
 *
 * Sur le développé (σ abscisse le long du jour, z altitude), la zone [a, b] est décrite par
 * F(σ) = z_a + Δ·f(t), avec t = (σ − σ_a)/Δ ∈ [0 ; 1], Δ = σ_b − σ_a, f(0) = 0 et f(1) = S où
 * S = (z_b − z_a)/Δ est la pente moyenne. La dérivée f'(t) est directement la pente dF/dσ.
 *
 * Conditions aux extrémités ([ANALYSE], CHALLENGE G3 point 2) :
 * - `tangent` : une partie droite continue ; F' = m (pente h/g de la partie droite) ; en
 *   quintique, aussi F'' = 0 (raccord C2 avec la droite du développé) ;
 * - `free` (départ, arrivée, palier) : aucun raccord imposé ; on retient la courbe qui minimise
 *   l'énergie de la variante, ce qui donne les conditions « naturelles » :
 *   - cubique (minimise ∫F''²) : F'' = 0 à l'extrémité libre (spline naturelle) ;
 *   - quintique (minimise ∫F'''²) : F''' = F'''' = 0 à l'extrémité libre.
 *   Deux extrémités libres : droite de pente S (seule solution d'énergie nulle retenue).
 *
 * Avec deux extrémités `tangent`, on retrouve exactement les formules de B §3.5 :
 * cubique f = m(t − 2t² + t³) + S(3t² − 2t³) + m(t³ − t²), quintique
 * f = m·t + (S − m)(10t³ − 15t⁴ + 6t⁵).
 */
import { MessageError, msg } from "@blondel/i18n";

export type EndCondition = "tangent" | "free";
export type M3Variant = "cubic" | "quintic";

export interface ProfileSpec {
  readonly variant: M3Variant;
  readonly ends: readonly [EndCondition, EndCondition];
  /** Pente moyenne S = (z_b − z_a)/Δ. */
  readonly meanSlope: number;
  /** Pentes des parties droites (utilisées seulement aux extrémités `tangent`). */
  readonly startSlope: number;
  readonly endSlope: number;
}

export interface DevelopmentProfile {
  readonly spec: ProfileSpec;
  /** Coefficients de f(t) = Σ c_i·t^i. */
  readonly coeffs: readonly number[];
}

/** Nombre d'échantillons pour les extrema de f' (cas non symétriques). */
const SLOPE_SAMPLES = 400;
/** Itérations de dichotomie pour l'inversion (précision 2⁻⁶⁰ sur t). */
const BISECTION_ITERATIONS = 60;

/** Dérivée d'ordre d du monôme t^i évaluée en t. */
function monomialDerivative(i: number, d: number, t: number): number {
  if (d > i) return 0;
  let k = 1;
  for (let j = 0; j < d; j++) k *= i - j;
  return k * t ** (i - d);
}

/**
 * Valeur de la dérivée d'ordre d de f en t. Boucle écrite à la main (chemin chaud du choix de
 * zone : dichotomies d'inversion et extrema de f') ; mêmes opérations, dans le même ordre, que
 * `c · monomialDerivative(i, d, t)` : résultats identiques au bit près.
 */
export function evalProfile(profile: DevelopmentProfile, t: number, d = 0): number {
  const coeffs = profile.coeffs;
  let v = 0;
  for (let i = d; i < coeffs.length; i++) {
    const c = coeffs[i]!;
    if (c === 0) continue;
    let k = 1;
    for (let j = 0; j < d; j++) k *= i - j;
    const e = i - d;
    // t⁰ = 1 et t¹ = t exactement ; puissance générale au-delà.
    v += c * (k * (e === 0 ? 1 : e === 1 ? t : t ** e));
  }
  return v;
}

/** Résout A·x = b par élimination de Gauss avec pivot partiel (petits systèmes). */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12)
      throw new MessageError(msg("balancing.error.singularSystem"));
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Construit la courbe f de la variante et des conditions aux extrémités données. */
export function buildProfile(spec: ProfileSpec): DevelopmentProfile {
  const { variant, ends, meanSlope: S } = spec;
  if (ends[0] === "free" && ends[1] === "free") {
    return { spec, coeffs: [0, S] };
  }
  const degree = variant === "cubic" ? 3 : 5;
  const rows: number[][] = [];
  const rhs: number[] = [];
  const cond = (t: number, d: number, value: number): void => {
    rows.push(Array.from({ length: degree + 1 }, (_, i) => monomialDerivative(i, d, t)));
    rhs.push(value);
  };
  cond(0, 0, 0);
  cond(1, 0, S);
  const end = (t: number, kind: EndCondition, slope: number): void => {
    if (kind === "tangent") {
      cond(t, 1, slope);
      if (variant === "quintic") cond(t, 2, 0);
    } else if (variant === "cubic") {
      cond(t, 2, 0);
    } else {
      cond(t, 3, 0);
      cond(t, 4, 0);
    }
  };
  end(0, ends[0], spec.startSlope);
  end(1, ends[1], spec.endSlope);
  return { spec, coeffs: solveLinear(rows, rhs) };
}

/** Pente maximale de F sur la zone : analytique dans le cas symétrique (B §3.5), sinon exacte (`slopeExtrema`). */
export function maxSlope(profile: DevelopmentProfile): number {
  const { variant, ends, meanSlope: S, startSlope, endSlope } = profile.spec;
  if (ends[0] === "tangent" && ends[1] === "tangent" && startSlope === endSlope) {
    const m = startSlope;
    const mid = variant === "cubic" ? (3 * S - m) / 2 : m + 1.875 * (S - m);
    return Math.max(m, mid);
  }
  return slopeExtrema(profile).max;
}

/** Extrema de f' échantillonnés sur [0 ; 1] (extrémités comprises). */
export function sampledSlopeExtrema(
  profile: DevelopmentProfile,
  samples = SLOPE_SAMPLES,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const v = evalProfile(profile, i / samples, 1);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Extrema de f' sur [0 ; 1] : valeurs aux extrémités et aux zéros de f'' (extrema intérieurs de
 * f'), localisés par changement de signe sur une grille puis affinés par dichotomie. Un zéro
 * double de f'' (sans changement de signe) n'est pas un extremum de f'. Contrairement au seul
 * échantillonnage, un creux de f' entre deux points de grille n'est pas manqué (seuls deux
 * zéros de f'' dans une même maille de 1/400 échapperaient, la variation de f' y étant alors
 * négligeable).
 */
export function slopeExtrema(
  profile: DevelopmentProfile,
  samples = SLOPE_SAMPLES,
): { min: number; max: number } {
  const f2 = (t: number): number => evalProfile(profile, t, 2);
  const values = [evalProfile(profile, 0, 1), evalProfile(profile, 1, 1)];
  let t0 = 0;
  let v0 = f2(0);
  for (let i = 1; i <= samples; i++) {
    const t1 = i / samples;
    const v1 = f2(t1);
    if (v0 === 0) values.push(evalProfile(profile, t0, 1));
    else if (v0 * v1 < 0) {
      let lo = t0;
      let hi = t1;
      for (let it = 0; it < BISECTION_ITERATIONS; it++) {
        const mid = (lo + hi) / 2;
        if (f2(mid) * v0 > 0) lo = mid;
        else hi = mid;
      }
      values.push(evalProfile(profile, (lo + hi) / 2, 1));
    }
    t0 = t1;
    v0 = v1;
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Vrai si f est strictement croissante (f' > 0 sur [0 ; 1], extrema exacts). */
export function isStrictlyIncreasing(profile: DevelopmentProfile): boolean {
  return slopeExtrema(profile).min > 0;
}

/**
 * Inverse f par dichotomie : t ∈ [0 ; 1] tel que f(t) = y. Suppose f strictement croissante ;
 * y est borné à [f(0) ; f(1)].
 */
export function invertProfile(profile: DevelopmentProfile, y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (evalProfile(profile, mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ spline prolongée

/** Condition à une extrémité de spline : pente imposée ou conditions naturelles. */
export type SplineEnd =
  { readonly kind: "tangent"; readonly slope: number } | { readonly kind: "free" };

export interface SplineSpec {
  readonly variant: M3Variant;
  /** Nœuds (t, f) en coordonnées réduites de la zone, t strictement croissants. */
  readonly knots: readonly { readonly t: number; readonly f: number }[];
  readonly start: SplineEnd;
  readonly end: SplineEnd;
}

export interface SplineProfile {
  readonly spec: SplineSpec;
  /** Coefficients du morceau i, polynôme en u = t − t_i (u ∈ [0 ; t_{i+1} − t_i]). */
  readonly pieces: readonly (readonly number[])[];
}

/**
 * Spline de la variante (cubique : minimise ∫f''², raccords C2 ; quintique : minimise ∫f'''²,
 * raccords C4) passant par les nœuds, avec les conditions données aux deux extrémités
 * (`tangent` : f' imposée, et f'' = 0 en quintique ; `free` : conditions naturelles f'' = 0 en
 * cubique, f''' = f'''' = 0 en quintique). Avec deux nœuds, identique à `buildProfile` (deux
 * extrémités libres : droite).
 */
export function buildSpline(spec: SplineSpec): SplineProfile {
  const { variant, knots } = spec;
  const p = knots.length - 1;
  if (p < 1) throw new MessageError(msg("balancing.error.splineTooFewKnots"));
  const degree = variant === "cubic" ? 3 : 5;
  if (p === 1 && spec.start.kind === "free" && spec.end.kind === "free") {
    // Deux nœuds libres : droite (seule courbe d'énergie nulle retenue, comme `buildProfile`).
    const k0 = knots[0]!;
    const k1 = knots[1]!;
    const slope = (k1.f - k0.f) / (k1.t - k0.t);
    const coeffs = new Array<number>(degree + 1).fill(0);
    coeffs[0] = k0.f;
    coeffs[1] = slope;
    return { spec, pieces: [coeffs] };
  }
  const w = degree + 1;
  const size = p * w;
  const rows: number[][] = [];
  const rhs: number[] = [];
  const row = (): number[] => new Array<number>(size).fill(0);
  // Terme de la dérivée d'ordre d du morceau i en u.
  const put = (r: number[], piece: number, d: number, u: number, factor = 1): void => {
    for (let i = 0; i < w; i++) r[piece * w + i]! += factor * monomialDerivative(i, d, u);
  };
  for (let i = 0; i < p; i++) {
    const h = knots[i + 1]!.t - knots[i]!.t;
    const r0 = row();
    put(r0, i, 0, 0);
    rows.push(r0);
    rhs.push(knots[i]!.f);
    const r1 = row();
    put(r1, i, 0, h);
    rows.push(r1);
    rhs.push(knots[i + 1]!.f);
    if (i + 1 < p) {
      for (let d = 1; d < degree; d++) {
        const r = row();
        put(r, i, d, h);
        put(r, i + 1, d, 0, -1);
        rows.push(r);
        rhs.push(0);
      }
    }
  }
  const end = (piece: number, u: number, cond: SplineEnd): void => {
    const add = (d: number, value: number): void => {
      const r = row();
      put(r, piece, d, u);
      rows.push(r);
      rhs.push(value);
    };
    if (cond.kind === "tangent") {
      add(1, cond.slope);
      if (variant === "quintic") add(2, 0);
    } else if (variant === "cubic") {
      add(2, 0);
    } else {
      add(3, 0);
      add(4, 0);
    }
  };
  end(0, 0, spec.start);
  end(p - 1, knots[p]!.t - knots[p - 1]!.t, spec.end);
  const x = solveLinear(rows, rhs);
  const pieces: number[][] = [];
  for (let i = 0; i < p; i++) pieces.push(x.slice(i * w, (i + 1) * w));
  return { spec, pieces };
}

/** Morceau i de la spline ramené à s ∈ [0 ; 1] (même signe de dérivée), pour ses extrema. */
export function splinePieceProfile(spline: SplineProfile, i: number): DevelopmentProfile {
  const h = spline.spec.knots[i + 1]!.t - spline.spec.knots[i]!.t;
  const coeffs = spline.pieces[i]!.map((c, k) => c * h ** k);
  return {
    spec: {
      variant: spline.spec.variant,
      ends: ["free", "free"],
      meanSlope: 0,
      startSlope: 0,
      endSlope: 0,
    },
    coeffs,
  };
}

/** Vrai si chaque morceau de la spline est strictement croissant. */
export function isSplineStrictlyIncreasing(spline: SplineProfile): boolean {
  return spline.pieces.every((_, i) => isStrictlyIncreasing(splinePieceProfile(spline, i)));
}

/** Valeur (ou dérivée d'ordre d, en t) de la spline ; prolongée par ses morceaux extrêmes. */
export function evalSpline(spline: SplineProfile, t: number, d = 0): number {
  const knots = spline.spec.knots;
  let i = 0;
  while (i + 2 < knots.length && t > knots[i + 1]!.t) i++;
  const u = t - knots[i]!.t;
  const coeffs = spline.pieces[i]!;
  let v = 0;
  for (let k = d; k < coeffs.length; k++) v += coeffs[k]! * monomialDerivative(k, d, u);
  return v;
}
