/**
 * Post-traitement **commun** à toutes les stratégies de balancement (plugins.ts, CHALLENGE G3) :
 * σ (abscisses des collets) ou φ (angles des lignes de nez) → Q, direction, R ; collets en arc
 * et en corde ; contrôles K5 (lignes de nez sans croisement entre C_i et C_e) et K3 (collets
 * monotones vers l'angle).
 *
 * Conventions :
 * - la ligne de nez k passe par P_k (fixe, sur Γ) ; `dir` est unitaire, de l'intérieur (jour)
 *   vers l'extérieur (mur) ;
 * - Q_k est la **première** intersection avec C_i du côté intérieur (la plus proche de P_k),
 *   R_k la première avec C_e du côté extérieur ; à égalité (bords confondus, demi-tournant à
 *   jour nul), on retient la portion de bord parcourue dans le même sens que Γ en P_k ;
 * - solution σ : Q_k = C_i(σ_k) et dir = (P_k − Q_k)/|P_k − Q_k|. Si la droite recoupe le jour
 *   plus près de P_k, Q_k est ramené à cette première intersection (signalé). Avec un jour de
 *   développement distinct du bord réel (poteau, voir `stepping/development.ts`), σ_k est lu
 *   sur ce jour virtuel et Q_k est toujours la première intersection avec le bord réel.
 */
import { cumulativeLengths, curvePointAt, curveTangentAt } from "../geom2d/curve.js";
import { segEnd, segStart } from "../geom2d/segment.js";
import { intersectLineCurve, segmentIntersect, type CurveHit } from "../geom2d/intersect.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { Layout, NosingLine } from "../model/derived.js";
import type { BalancingSolution, BalancingZone } from "../model/plugins.js";
import type { Curve2, Mm, Vec2 } from "../model/primitives.js";

/** Tolérance relative (sur les paramètres de segment) des contrôles de croisement. */
const CROSS_PARAM_EPS = 1e-9;

/**
 * Première intersection d'une droite (origine P, direction unitaire `dir`) avec une courbe, du
 * côté `back` (t < 0) ou `forward` (t > 0). `along` : direction de Γ pour départager des
 * intersections confondues.
 */
export function firstHit(
  origin: Vec2,
  dir: Vec2,
  curve: Curve2,
  side: "back" | "forward",
  along?: Vec2,
): CurveHit | null {
  const all: CurveHit[] = [...intersectLineCurve({ origin, dir }, curve)];
  // Portions de courbe colinéaires à la droite (ignorées par `intersectLineCurve`) : leurs
  // extrémités sont des intersections (ex. nez au bord d'un carré d'angle, jour réduit au coin).
  const cum = cumulativeLengths(curve);
  curve.segments.forEach((seg, i) => {
    for (const [pt, s] of [
      [segStart(seg), cum[i]!],
      [segEnd(seg), cum[i + 1]!],
    ] as const) {
      const w = V.sub(pt, origin);
      if (Math.abs(V.cross(dir, w)) <= GEOM_EPS) all.push({ s, point: pt, t: V.dot(w, dir) });
    }
  });
  const hits = all.filter((h) => (side === "back" ? h.t < 0 : h.t > 0));
  let best: CurveHit | null = null;
  let bestScore = -Infinity;
  for (const h of hits) {
    const score = along ? V.dot(curveTangentAt(curve, h.s), along) : 0;
    if (
      best === null ||
      Math.abs(h.t) < Math.abs(best.t) - 1e-6 ||
      (Math.abs(h.t) <= Math.abs(best.t) + 1e-6 && score > bestScore)
    ) {
      best = h;
      bestScore = score;
    }
  }
  return best;
}

/** Données d'un nez indépendantes de son orientation. */
export interface NosingSeed {
  readonly index: number;
  readonly s: Mm;
  readonly p: Vec2;
  readonly z: Mm;
  /** Tangente unitaire de Γ en P (sens de la montée). */
  readonly tangent: Vec2;
  /** Direction perpendiculaire à Γ, de l'intérieur vers l'extérieur. */
  readonly perpendicular: Vec2;
}

export type NosingSpec =
  { readonly kind: "sigma"; readonly sigma: Mm } | { readonly kind: "dir"; readonly dir: Vec2 };

export type RealizedNosing =
  | { readonly ok: true; readonly nosing: NosingLine; readonly corrected: boolean }
  | { readonly ok: false; readonly reason: string };

/** Construit la ligne de nez d'orientation donnée (σ du collet ou direction). */
export function realizeNosing(
  layout: Layout,
  seed: NosingSeed,
  spec: NosingSpec,
  balanced: boolean,
  development: Curve2 = layout.inner,
): RealizedNosing {
  const { p } = seed;
  let dir: Vec2;
  let q: Vec2;
  let sigmaInner: Mm;
  let corrected = false;
  if (spec.kind === "sigma") {
    const q0 = curvePointAt(development, spec.sigma);
    const v = V.sub(p, q0);
    if (V.norm(v) <= GEOM_EPS) {
      return { ok: false, reason: `nez ${seed.index} : collet confondu avec la ligne de foulée` };
    }
    dir = V.normalize(v);
    q = q0;
    sigmaInner = spec.sigma;
    const hit = firstHit(p, dir, layout.inner, "back", seed.tangent);
    if (development !== layout.inner) {
      // Jour de développement virtuel (poteau) : Q est toujours pris sur le bord réel.
      if (!hit)
        return { ok: false, reason: `nez ${seed.index} : la ligne ne rencontre pas le jour` };
      q = hit.point;
      sigmaInner = hit.s;
    } else if (hit && Math.abs(hit.t) < V.norm(v) - 1e-6) {
      q = hit.point;
      sigmaInner = hit.s;
      corrected = true;
    }
  } else {
    dir = V.normalize(spec.dir);
    const hit = firstHit(p, dir, layout.inner, "back", seed.tangent);
    if (!hit) return { ok: false, reason: `nez ${seed.index} : la ligne ne rencontre pas le jour` };
    q = hit.point;
    sigmaInner = hit.s;
  }
  const out = firstHit(p, dir, layout.outer, "forward", seed.tangent);
  if (!out) return { ok: false, reason: `nez ${seed.index} : la ligne ne rencontre pas le mur` };
  return {
    ok: true,
    corrected,
    nosing: {
      index: seed.index,
      s: seed.s,
      p,
      dir,
      q,
      r: out.point,
      sigmaInner,
      sigmaOuter: out.s,
      z: seed.z,
      balanced,
    },
  };
}

/**
 * Applique la solution d'une stratégie aux nez intérieurs de la zone (from+1 … to−1).
 * Renvoie les nouvelles lignes (dans l'ordre) et les indices dont le collet a été corrigé.
 */
export function applySolution(
  layout: Layout,
  seeds: readonly NosingSeed[],
  zone: BalancingZone,
  solution: BalancingSolution,
  development: Curve2 = layout.inner,
): { ok: true; nosings: NosingLine[]; corrected: number[] } | { ok: false; reason: string } {
  if (solution.kind === "fail") return { ok: false, reason: solution.reason };
  const count = zone.to - zone.from - 1;
  const values = solution.kind === "sigma" ? solution.sigma : solution.phi;
  if (values.length !== count) {
    return {
      ok: false,
      reason: `la stratégie a rendu ${values.length} valeurs pour ${count} nez`,
    };
  }
  const out: NosingLine[] = [];
  const corrected: number[] = [];
  for (let i = 0; i < count; i++) {
    const seed = seeds[zone.from + 1 + i]!;
    const v = values[i]!;
    if (!Number.isFinite(v))
      return { ok: false, reason: `valeur invalide pour le nez ${seed.index}` };
    const spec: NosingSpec =
      solution.kind === "sigma"
        ? { kind: "sigma", sigma: v }
        : { kind: "dir", dir: V.fromAngle(v) };
    const res = realizeNosing(layout, seed, spec, true, development);
    if (!res.ok) return { ok: false, reason: res.reason };
    if (res.corrected) corrected.push(seed.index);
    out.push(res.nosing);
  }
  return { ok: true, nosings: out, corrected };
}

// ------------------------------------------------------------------ collets et contrôles

export interface Collet {
  /** Longueur d'arc sur le jour entre Q_k et Q_{k+1}. */
  readonly arc: Mm;
  /** Corde |Q_{k+1} − Q_k|. */
  readonly chord: Mm;
}

/** Collet de la marche comprise entre les nez k et k + 1. */
export function colletBetween(a: NosingLine, b: NosingLine): Collet {
  return { arc: b.sigmaInner - a.sigmaInner, chord: V.distance(a.q, b.q) };
}

export interface Crossing {
  readonly i: number;
  readonly j: number;
}

/** Deux lignes de nez (segments Q R) se croisent-elles (K5) ? Contact aux collets toléré. */
export function nosingsCross(a: NosingLine, b: NosingLine): boolean {
  if (b.sigmaInner < a.sigmaInner - GEOM_EPS || b.sigmaOuter < a.sigmaOuter - GEOM_EPS) {
    return true;
  }
  const hit = segmentIntersect(a.q, a.r, b.q, b.r);
  if (!hit) return false;
  const interior = (t: number): boolean => t > CROSS_PARAM_EPS && t < 1 - CROSS_PARAM_EPS;
  if (interior(hit.t) || interior(hit.u)) return true;
  // Contact aux extrémités : seul un contact aux collets (Q confondus, collet nul) est toléré.
  return V.distance(hit.point, a.q) > GEOM_EPS || V.distance(hit.point, b.q) > GEOM_EPS;
}

/** Couples de lignes de nez qui se croisent entre C_i et C_e, indices dans [from ; to]. */
export function findCrossings(
  nosings: readonly NosingLine[],
  from = 0,
  to = nosings.length - 1,
): Crossing[] {
  const out: Crossing[] = [];
  const lo = Math.max(0, from);
  const hi = Math.min(nosings.length - 1, to);
  for (let i = lo; i <= hi; i++) {
    for (let j = i + 1; j <= hi; j++) {
      if (nosingsCross(nosings[i]!, nosings[j]!)) out.push({ i, j });
    }
  }
  return out;
}

/**
 * K3 : suite « en vallée » (décroissante puis croissante, au sens large, à `eps` près), minimum
 * pris au premier minimum. Renvoie les positions i (0-based) telles que le pas i → i + 1
 * contredit la monotonie.
 */
export function monotonyBreaks(values: readonly number[], eps = 1e-6): number[] {
  if (values.length < 2) return [];
  let m = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! < values[m]! - eps) m = i;
  const out: number[] = [];
  for (let i = 0; i + 1 < values.length; i++) {
    const broken = i < m ? values[i + 1]! > values[i]! + eps : values[i + 1]! < values[i]! - eps;
    if (broken) out.push(i);
  }
  return out;
}
