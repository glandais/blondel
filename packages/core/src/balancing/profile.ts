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

/** Valeur de la dérivée d'ordre d de f en t. */
export function evalProfile(profile: DevelopmentProfile, t: number, d = 0): number {
  let v = 0;
  profile.coeffs.forEach((c, i) => {
    if (c !== 0) v += c * monomialDerivative(i, d, t);
  });
  return v;
}

/** Résout A·x = b par élimination de Gauss avec pivot partiel (petits systèmes). */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) throw new Error("profil M3 : système singulier");
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
