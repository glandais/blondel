/**
 * Courbes planes composées (`Curve2`) paramétrées par abscisse curviligne s ∈ [0, L].
 *
 * Convention aux jonctions : un s situé exactement sur une jonction est rattaché au segment
 * **suivant** (sauf s = L, rattaché au dernier segment de longueur non nulle). Les segments de
 * longueur nulle (pivots) sont ignorés par la localisation.
 */
import type { Curve2, CurveSeg, Mm, Rad, Vec2 } from "../model/primitives.js";
import { MessageError, msg } from "@blondel/i18n";
import {
  arcSeg,
  lineSeg,
  segEnd,
  segLength,
  segPointAt,
  segReverse,
  segStart,
  segSub,
  segTangentAt,
} from "./segment.js";
import { ANGLE_EPS, GEOM_EPS } from "./tolerance.js";
import * as V from "./vec.js";

// ------------------------------------------------------------------ construction et continuité

export interface ContinuityGap {
  /** Indice du segment dont la fin ne rejoint pas le début du suivant. */
  readonly index: number;
  readonly gap: Mm;
}

/** Liste des discontinuités de position entre segments consécutifs (vide si continue). */
export function continuityGaps(curve: Curve2, tol: Mm = GEOM_EPS): ContinuityGap[] {
  const gaps: ContinuityGap[] = [];
  const segs = curve.segments;
  for (let i = 0; i + 1 < segs.length; i++) {
    const gap = V.distance(segEnd(segs[i]!), segStart(segs[i + 1]!));
    if (gap > tol) gaps.push({ index: i, gap });
  }
  return gaps;
}

export function isContinuous(curve: Curve2, tol: Mm = GEOM_EPS): boolean {
  return continuityGaps(curve, tol).length === 0;
}

/** Construit une courbe en vérifiant la continuité (lève une erreur sinon). */
export function makeCurve(segments: readonly CurveSeg[], tol: Mm = GEOM_EPS): Curve2 {
  if (segments.length === 0) throw new MessageError(msg("error.geom2d.makeCurve.emptyCurve"));
  const curve: Curve2 = { segments: [...segments] };
  const gaps = continuityGaps(curve, tol);
  if (gaps.length > 0) {
    const g = gaps[0]!;
    throw new MessageError(
      msg("error.geom2d.makeCurve.gap", { gap: String(g.gap), index: String(g.index) }),
    );
  }
  return curve;
}

export interface PolylineOptions {
  /**
   * Rayon de raccord en arc aux sommets intérieurs : un nombre (tous les sommets) ou un tableau
   * de longueur `points.length − 2`. 0 = angle vif (aucun arc).
   */
  readonly radius?: Mm | readonly Mm[];
}

/**
 * Courbe à partir d'une polyligne, avec raccords circulaires tangents optionnels aux sommets.
 * Les points consécutifs confondus sont fusionnés. Lève une erreur si un raccord ne tient pas
 * dans les segments adjacents ou si la polyligne fait demi-tour (angle de 180°).
 */
export function fromPolyline(points: readonly Vec2[], options: PolylineOptions = {}): Curve2 {
  const pts: Vec2[] = [];
  const radii: Mm[] = [];
  const rOpt = options.radius ?? 0;
  if (typeof rOpt !== "number" && rOpt.length !== Math.max(0, points.length - 2)) {
    throw new MessageError(
      msg("error.geom2d.fromPolyline.radiusCount", {
        given: String(rOpt.length),
        vertices: String(Math.max(0, points.length - 2)),
      }),
    );
  }
  points.forEach((p, i) => {
    const last = pts[pts.length - 1];
    if (last !== undefined && V.equals(last, p)) return;
    pts.push(p);
    const r =
      typeof rOpt === "number" ? rOpt : i >= 1 && i <= points.length - 2 ? (rOpt[i - 1] ?? 0) : 0;
    if (!(r >= 0))
      throw new MessageError(msg("error.geom2d.fromPolyline.invalidRadius", { radius: String(r) }));
    radii.push(r);
  });
  if (pts.length < 2) throw new MessageError(msg("error.geom2d.fromPolyline.tooFewPoints"));

  // Raccords : pour chaque sommet intérieur, points tangents P1 (entrée) et P2 (sortie).
  interface Fillet {
    readonly p1: Vec2;
    readonly p2: Vec2;
    readonly arc: CurveSeg | null;
  }
  const fillets: (Fillet | null)[] = pts.map(() => null);
  const tangentLen: Mm[] = pts.map(() => 0);
  for (let i = 1; i + 1 < pts.length; i++) {
    const v = pts[i]!;
    const t1 = V.normalize(V.sub(v, pts[i - 1]!));
    const t2 = V.normalize(V.sub(pts[i + 1]!, v));
    const phi = V.signedAngle(t1, t2);
    if (Math.abs(Math.abs(phi) - Math.PI) < ANGLE_EPS) {
      throw new MessageError(msg("error.geom2d.fromPolyline.uTurn", { index: String(i) }));
    }
    const r = radii[i]!;
    if (r * Math.abs(phi) <= GEOM_EPS || Math.abs(phi) < ANGLE_EPS) {
      // Raccord de longueur négligeable : angle vif.
      fillets[i] = { p1: v, p2: v, arc: null };
      continue;
    }
    const tl = r * Math.tan(Math.abs(phi) / 2);
    tangentLen[i] = tl;
    const p1 = V.addScaled(v, t1, -tl);
    const p2 = V.addScaled(v, t2, tl);
    const n = phi > 0 ? V.perpLeft(t1) : V.perpRight(t1);
    const center = V.addScaled(p1, n, r);
    const start = V.angleOf(V.scale(n, -1));
    fillets[i] = { p1, p2, arc: arcSeg(center, r, start, phi) };
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = V.distance(pts[i]!, pts[i + 1]!);
    if (tangentLen[i]! + tangentLen[i + 1]! > len + GEOM_EPS) {
      throw new MessageError(
        msg("error.geom2d.fromPolyline.filletsTooLarge", { index: String(i), length: String(len) }),
      );
    }
  }

  const segs: CurveSeg[] = [];
  let cursor = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const f = fillets[i];
    const target = f ? f.p1 : pts[i]!;
    if (!V.equals(cursor, target)) segs.push(lineSeg(cursor, target));
    if (f?.arc) segs.push(f.arc);
    cursor = f ? f.p2 : pts[i]!;
  }
  return { segments: segs };
}

// ------------------------------------------------------------------ longueurs et localisation

const cumCache = new WeakMap<Curve2, readonly Mm[]>();

/** Abscisses cumulées des débuts de segments, plus L en dernière position (mémoïsé). */
export function cumulativeLengths(curve: Curve2): readonly Mm[] {
  let cum = cumCache.get(curve);
  if (!cum) {
    const acc: Mm[] = [0];
    let s = 0;
    for (const seg of curve.segments) {
      s += segLength(seg);
      acc.push(s);
    }
    cum = acc;
    cumCache.set(curve, cum);
  }
  return cum;
}

export function curveLength(curve: Curve2): Mm {
  const cum = cumulativeLengths(curve);
  return cum[cum.length - 1]!;
}

export interface CurveLocation {
  /** Indice du segment. */
  readonly index: number;
  /** Fraction dans le segment. */
  readonly t: number;
  /** Abscisse curviligne (bornée à [0, L]). */
  readonly s: Mm;
}

/** Localise l'abscisse s (bornée à [0, L]) sur un segment. */
export function locate(curve: Curve2, s: Mm): CurveLocation {
  const segs = curve.segments;
  if (segs.length === 0) throw new MessageError(msg("error.geom2d.locate.emptyCurve"));
  const cum = cumulativeLengths(curve);
  const L = cum[cum.length - 1]!;
  if (Number.isNaN(s)) throw new MessageError(msg("error.geom2d.locate.nanAbscissa"));
  const sc = Math.min(L, Math.max(0, s));
  // Recherche dichotomique du dernier début de segment ≤ sc.
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= sc) lo = mid;
    else hi = mid - 1;
  }
  let i = lo;
  // Ignorer les segments de longueur nulle (vers l'avant, puis vers l'arrière en fin de courbe).
  while (i < segs.length - 1 && cum[i + 1]! - cum[i]! <= 0) i++;
  if (cum[i + 1]! - cum[i]! <= 0 || sc >= cum[i + 1]!) {
    // s = L : dernier segment de longueur non nulle.
    let j = segs.length - 1;
    while (j > 0 && cum[j + 1]! - cum[j]! <= 0) j--;
    const len = cum[j + 1]! - cum[j]!;
    if (sc >= cum[j + 1]! || len <= 0) return { index: j, t: len <= 0 ? 0 : 1, s: sc };
    i = j;
  }
  const len = cum[i + 1]! - cum[i]!;
  return { index: i, t: (sc - cum[i]!) / len, s: sc };
}

/** Indice du segment portant l'abscisse s. */
export function segmentAt(curve: Curve2, s: Mm): number {
  return locate(curve, s).index;
}

export function curvePointAt(curve: Curve2, s: Mm): Vec2 {
  const loc = locate(curve, s);
  return segPointAt(curve.segments[loc.index]!, loc.t);
}

/** Tangente unitaire en s (à droite de s aux jonctions anguleuses). */
export function curveTangentAt(curve: Curve2, s: Mm): Vec2 {
  const loc = locate(curve, s);
  return segTangentAt(curve.segments[loc.index]!, loc.t);
}

/** Normale unitaire à gauche de la tangente en s. */
export function curveNormalAt(curve: Curve2, s: Mm): Vec2 {
  return V.perpLeft(curveTangentAt(curve, s));
}

export function curveStart(curve: Curve2): Vec2 {
  return segStart(curve.segments[0]!);
}

export function curveEnd(curve: Curve2): Vec2 {
  return segEnd(curve.segments[curve.segments.length - 1]!);
}

// ------------------------------------------------------------------ transformations

export function reverseCurve(curve: Curve2): Curve2 {
  return { segments: [...curve.segments].reverse().map(segReverse) };
}

/**
 * Sous-courbe entre les abscisses s0 et s1 (bornées à [0, L]). Si s0 > s1, la sous-courbe
 * est parcourue en sens inverse. Si s0 = s1, renvoie une ligne de longueur nulle au point.
 */
export function subCurve(curve: Curve2, s0: Mm, s1: Mm): Curve2 {
  if (s0 > s1) return reverseCurve(subCurve(curve, s1, s0));
  const a = locate(curve, s0);
  const b = locate(curve, s1);
  if (b.s - a.s <= 0) {
    const p = curvePointAt(curve, s0);
    return { segments: [lineSeg(p, p)] };
  }
  // Fin de sous-courbe sur une jonction : terminer à t = 1 du segment précédent.
  let bi = b.index;
  let bt = b.t;
  if (bt === 0 && bi > a.index) {
    bi -= 1;
    while (bi > a.index && segLength(curve.segments[bi]!) <= 0) bi--;
    bt = 1;
  }
  const segs: CurveSeg[] = [];
  for (let i = a.index; i <= bi; i++) {
    const seg = curve.segments[i]!;
    const t0 = i === a.index ? a.t : 0;
    const t1 = i === bi ? bt : 1;
    if (t1 > t0 || (seg.kind === "arc" && seg.radius === 0 && i !== a.index && i !== bi)) {
      segs.push(t0 === 0 && t1 === 1 ? seg : segSub(seg, t0, t1));
    }
  }
  return { segments: segs };
}

export function translateCurve(curve: Curve2, d: Vec2): Curve2 {
  return {
    segments: curve.segments.map((seg) =>
      seg.kind === "line"
        ? lineSeg(V.add(seg.a, d), V.add(seg.b, d))
        : arcSeg(V.add(seg.center, d), seg.radius, seg.startAngle, seg.sweep),
    ),
  };
}

/** Rotation rigide d'angle `angle` autour de `pivot`. */
export function rotateCurve(curve: Curve2, angle: Rad, pivot: Vec2 = V.ZERO): Curve2 {
  return {
    segments: curve.segments.map((seg) =>
      seg.kind === "line"
        ? lineSeg(V.rotate(seg.a, angle, pivot), V.rotate(seg.b, angle, pivot))
        : arcSeg(V.rotate(seg.center, angle, pivot), seg.radius, seg.startAngle + angle, seg.sweep),
    ),
  };
}

/** Concatène des courbes (continuité vérifiée à `tol`). */
export function concatCurves(curves: readonly Curve2[], tol: Mm = GEOM_EPS): Curve2 {
  return makeCurve(
    curves.flatMap((c) => c.segments),
    tol,
  );
}

// ------------------------------------------------------------------ échantillonnage

export interface CurveSample {
  readonly s: Mm;
  readonly p: Vec2;
}

/**
 * Échantillonne la courbe tous les `step` mm, en incluant toujours les deux extrémités et les
 * jonctions entre segments (pour que la polyligne passe exactement par les angles vifs).
 */
export function sampleCurve(curve: Curve2, step: Mm): CurveSample[] {
  if (!(step > 0))
    throw new MessageError(msg("error.geom2d.sampleCurve.invalidStep", { step: String(step) }));
  const cum = cumulativeLengths(curve);
  const L = cum[cum.length - 1]!;
  // Jonctions et extrémités d'abord : un pas régulier tombant à moins de GEOM_EPS d'une
  // jonction est absorbé par celle-ci (et non l'inverse), pour que s = 0 et s = L soient exacts.
  const junctions: Mm[] = [];
  for (const c of cum) {
    const last = junctions[junctions.length - 1];
    if (last === undefined || c - last > GEOM_EPS) junctions.push(c);
    else if (c === L) junctions[junctions.length - 1] = L;
  }
  const ss: Mm[] = [...junctions];
  const n = Math.floor(L / step);
  let j = 0;
  for (let k = 1; k <= n; k++) {
    const s = k * step;
    while (j < junctions.length && junctions[j]! < s - GEOM_EPS) j++;
    if (j < junctions.length && Math.abs(junctions[j]! - s) <= GEOM_EPS) continue;
    if (s < L) ss.push(s);
  }
  ss.sort((a, b) => a - b);
  const out: CurveSample[] = ss.map((s) => ({ s, p: curvePointAt(curve, s) }));
  // Jonctions : le point du segment suivant peut différer du point de fin (courbe non continue) ;
  // on garde celui du suivant, conforme à la convention de localisation.
  return out;
}

/**
 * Polyligne approchant la courbe avec une flèche (écart corde / arc) ≤ `chordTol` mm.
 * Les segments droits sont exacts. Les doublons consécutifs sont supprimés.
 */
export function flattenCurve(curve: Curve2, chordTol: Mm = 0.1): Vec2[] {
  if (!(chordTol > 0))
    throw new MessageError(
      msg("error.geom2d.flattenCurve.invalidTolerance", { tolerance: String(chordTol) }),
    );
  const out: Vec2[] = [];
  const push = (p: Vec2): void => {
    const last = out[out.length - 1];
    if (last === undefined || !V.equals(last, p)) out.push(p);
  };
  for (const seg of curve.segments) {
    push(segStart(seg));
    if (seg.kind === "arc" && seg.radius > 0 && seg.sweep !== 0) {
      const maxStep =
        seg.radius <= chordTol ? Math.PI / 2 : 2 * Math.acos(1 - chordTol / seg.radius);
      const n = Math.max(1, Math.ceil(Math.abs(seg.sweep) / Math.min(maxStep, Math.PI / 2)));
      for (let k = 1; k < n; k++) push(segPointAt(seg, k / n));
    }
    push(segEnd(seg));
  }
  return out;
}
