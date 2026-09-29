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
/** Marge (mm) du rejet rapide par boîtes englobantes dans `nosingsCross`. */
const BOX_MARGIN: Mm = 1;

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
  // Départage par la tangente calculé seulement en cas d'égalité des distances (chemin chaud :
  // une seule intersection du bon côté dans la plupart des cas) ; même choix qu'un calcul
  // systématique du score.
  const scoreOf = (h: CurveHit): number => (along ? V.dot(curveTangentAt(curve, h.s), along) : 0);
  let best: CurveHit | null = null;
  let bestScore: number | undefined;
  for (const h of hits) {
    if (best === null || Math.abs(h.t) < Math.abs(best.t) - 1e-6) {
      best = h;
      bestScore = undefined;
    } else if (Math.abs(h.t) <= Math.abs(best.t) + 1e-6) {
      bestScore ??= scoreOf(best);
      const score = scoreOf(h);
      if (score > bestScore) {
        best = h;
        bestScore = score;
      }
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
  // Rejet rapide : boîtes englobantes disjointes (marge de 1 mm, très au-delà de la tolérance
  // GEOM_EPS de `segmentIntersect`) → pas d'intersection, même résultat.
  if (
    Math.min(a.q.x, a.r.x) > Math.max(b.q.x, b.r.x) + BOX_MARGIN ||
    Math.min(b.q.x, b.r.x) > Math.max(a.q.x, a.r.x) + BOX_MARGIN ||
    Math.min(a.q.y, a.r.y) > Math.max(b.q.y, b.r.y) + BOX_MARGIN ||
    Math.min(b.q.y, b.r.y) > Math.max(a.q.y, a.r.y) + BOX_MARGIN
  ) {
    return false;
  }
  const hit = segmentIntersect(a.q, a.r, b.q, b.r);
  if (!hit) return false;
  const interior = (t: number): boolean => t > CROSS_PARAM_EPS && t < 1 - CROSS_PARAM_EPS;
  if (interior(hit.t) || interior(hit.u)) return true;
  // Contact aux extrémités : seul un contact aux collets (Q confondus, collet nul) est toléré.
  return V.distance(hit.point, a.q) > GEOM_EPS || V.distance(hit.point, b.q) > GEOM_EPS;
}

/**
 * Résultats de `nosingsCross` déjà calculés, par couple d'objets (les lignes de nez sont
 * immuables : le résultat ne dépend que des deux objets). Le choix automatique de zone teste
 * les mêmes couples de nez hors zone pour chaque candidat (ADR-0006).
 */
const crossCache = new WeakMap<NosingLine, WeakMap<NosingLine, boolean>>();

/** `nosingsCross` mémoïsé par couple d'objets (même résultat). */
export function nosingsCrossCached(a: NosingLine, b: NosingLine): boolean {
  let row = crossCache.get(a);
  if (!row) {
    row = new WeakMap();
    crossCache.set(a, row);
  }
  let v = row.get(b);
  if (v === undefined) {
    v = nosingsCross(a, b);
    row.set(b, v);
  }
  return v;
}

/** Vrai si aucun couple de lignes de nez ne se croise (K5) ; arrêt au premier croisement. */
export function noCrossing(nosings: readonly NosingLine[]): boolean {
  for (let i = 0; i < nosings.length; i++) {
    for (let j = i + 1; j < nosings.length; j++) {
      if (nosingsCrossCached(nosings[i]!, nosings[j]!)) return false;
    }
  }
  return true;
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

/**
 * K3 **par angle** : une zone unique de 180° (demi-tournant, U serré) contourne deux angles du
 * jour et ses collets forment une vallée autour de **chaque** angle, séparées par une crête.
 * `corners` : positions (indices dans `values`) des marches au droit de chaque angle. La suite
 * est découpée en tronçons [crête_{j−1} ; crête_j], chaque crête étant prise entre deux angles
 * consécutifs (crête_j ∈ [c_j ; c_{j+1}]) ; chaque tronçon doit être « en vallée »
 * (`monotonyBreaks`). Les crêtes retenues minimisent le nombre de ruptures (à égalité : la plus
 * haute, puis la première), ce qui rend le contrôle insensible au repérage à une marche près de
 * l'angle. Avec au plus un angle : `monotonyBreaks` sur toute la suite. Renvoie les positions i
 * (0-based, croissantes, sans doublon) telles que le pas i → i + 1 contredit la monotonie.
 */
export function cornerMonotonyBreaks(
  values: readonly number[],
  corners: readonly number[],
  eps = 1e-6,
): number[] {
  const last = values.length - 1;
  const cs = [...new Set(corners.filter((c) => Number.isInteger(c) && c >= 0 && c <= last))].sort(
    (a, b) => a - b,
  );
  if (values.length < 2 || cs.length < 2) return monotonyBreaks(values, eps);
  const breaksOf = (from: number, to: number): number[] =>
    monotonyBreaks(values.slice(from, to + 1), eps).map((i) => from + i);
  // Programmation dynamique sur les crêtes : best[p] = (ruptures, coupes) jusqu'à la crête p.
  type State = { readonly cost: number; readonly cuts: readonly number[] };
  let states = new Map<number, State>([[0, { cost: 0, cuts: [0] }]]);
  for (let j = 0; j + 1 < cs.length; j++) {
    const next = new Map<number, State>();
    for (let p = cs[j]!; p <= cs[j + 1]!; p++) {
      let best: State | null = null;
      for (const [q, st] of states) {
        if (q > p) continue;
        const cost = st.cost + breaksOf(q, p).length;
        if (best === null || cost < best.cost) best = { cost, cuts: [...st.cuts, p] };
      }
      if (best) next.set(p, best);
    }
    states = next;
  }
  let chosen: State | null = null;
  let chosenCost = Infinity;
  for (const [q, st] of states) {
    const cost = st.cost + breaksOf(q, last).length;
    const peak = values[q]!;
    const prevPeak = chosen ? values[chosen.cuts[chosen.cuts.length - 1]!]! : -Infinity;
    if (cost < chosenCost || (cost === chosenCost && peak > prevPeak + eps)) {
      chosen = st;
      chosenCost = cost;
    }
  }
  const cuts = [...chosen!.cuts, last];
  const out = new Set<number>();
  for (let j = 0; j + 1 < cuts.length; j++) {
    for (const i of breaksOf(cuts[j]!, cuts[j + 1]!)) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Positions des angles d'un tronçon de marches pour `cornerMonotonyBreaks` : `nosingS` =
 * abscisses sur Γ des nez qui bornent les marches (m + 1 nez pour m marches), `cornerS` =
 * abscisses sur Γ des milieux des tournants. L'angle j est au droit de la marche i telle que
 * s_i ≤ cornerS_j < s_{i+1} ; les angles hors du tronçon sont ignorés.
 */
export function cornerPositions(nosingS: readonly Mm[], cornerS: readonly Mm[]): number[] {
  const out: number[] = [];
  const m = nosingS.length - 1;
  for (const c of cornerS) {
    if (m < 1 || !(c >= nosingS[0]!) || !(c <= nosingS[m]!)) continue;
    let i = 0;
    while (i + 1 < m && nosingS[i + 1]! <= c) i++;
    out.push(i);
  }
  return out;
}
