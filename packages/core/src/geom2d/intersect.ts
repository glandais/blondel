/**
 * Intersections et projections : droites, segments, cercles, courbes composées.
 */
import type { Curve2, CurveSeg, Mm, Vec2 } from "../model/primitives.js";
import { cumulativeLengths } from "./curve.js";
import { segClosestPoint, segLength, segParamOfPoint, segPointAt } from "./segment.js";
import { ANGLE_EPS, GEOM_EPS } from "./tolerance.js";
import * as V from "./vec.js";

/** Droite infinie : point + direction (non nécessairement unitaire, non nulle). */
export interface Line2 {
  readonly origin: Vec2;
  readonly dir: Vec2;
}

export interface LineLineHit {
  /** Paramètres sur chaque droite : point = origin + t·dir. */
  readonly t1: number;
  readonly t2: number;
  readonly point: Vec2;
}

/** Intersection de deux droites infinies ; null si parallèles (ou confondues). */
export function intersectLines(l1: Line2, l2: Line2): LineLineHit | null {
  const den = V.cross(l1.dir, l2.dir);
  const scaleRef = V.norm(l1.dir) * V.norm(l2.dir);
  if (Math.abs(den) <= ANGLE_EPS * scaleRef) return null;
  const w = V.sub(l2.origin, l1.origin);
  const t1 = V.cross(w, l2.dir) / den;
  const t2 = V.cross(w, l1.dir) / den;
  return { t1, t2, point: V.addScaled(l1.origin, l1.dir, t1) };
}

export interface SegSegHit {
  readonly point: Vec2;
  /** Fraction sur [a1, a2]. */
  readonly t: number;
  /** Fraction sur [b1, b2]. */
  readonly u: number;
}

/**
 * Intersection de deux segments bornés [a1, a2] et [b1, b2] (extrémités incluses, à GEOM_EPS
 * près). Segments parallèles ou colinéaires : null (le recouvrement n'est pas un point).
 */
export function segmentIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): SegSegHit | null {
  const hit = intersectLines(
    { origin: a1, dir: V.sub(a2, a1) },
    { origin: b1, dir: V.sub(b2, b1) },
  );
  if (!hit) return null;
  const la = V.distance(a1, a2);
  const lb = V.distance(b1, b2);
  const ta = la > 0 ? GEOM_EPS / la : 0;
  const tb = lb > 0 ? GEOM_EPS / lb : 0;
  if (hit.t1 < -ta || hit.t1 > 1 + ta || hit.t2 < -tb || hit.t2 > 1 + tb) return null;
  return {
    point: hit.point,
    t: Math.min(1, Math.max(0, hit.t1)),
    u: Math.min(1, Math.max(0, hit.t2)),
  };
}

/** Paramètres t (point = origin + t·dir) des intersections droite / cercle, croissants. */
export function intersectLineCircle(line: Line2, center: Vec2, radius: Mm): number[] {
  const d2 = V.normSq(line.dir);
  if (d2 === 0) return [];
  const w = V.sub(line.origin, center);
  // |w + t d|² = r²  →  d² t² + 2 (w·d) t + (w² − r²) = 0
  const b = V.dot(w, line.dir) / d2;
  const c = (V.normSq(w) - radius * radius) / d2;
  const disc = b * b - c;
  // Tangence : tolérance relative à l'échelle (distance du centre à la droite ≈ r).
  const distToLine = Math.abs(V.cross(line.dir, w)) / Math.sqrt(d2);
  if (disc < 0) {
    if (Math.abs(distToLine - radius) <= GEOM_EPS) return [-b];
    return [];
  }
  const sq = Math.sqrt(disc);
  if (sq * Math.sqrt(d2) <= GEOM_EPS) return [-b];
  return [-b - sq, -b + sq];
}

/** Points d'intersection de deux cercles (0, 1 ou 2). Cercles concentriques : aucun. */
export function intersectCircles(c1: Vec2, r1: Mm, c2: Vec2, r2: Mm): Vec2[] {
  const d = V.distance(c1, c2);
  if (d <= GEOM_EPS) return [];
  if (d > r1 + r2 + GEOM_EPS || d < Math.abs(r1 - r2) - GEOM_EPS) return [];
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const u = V.scale(V.sub(c2, c1), 1 / d);
  const m = V.addScaled(c1, u, a);
  if (h2 <= 0) return [m];
  const h = Math.sqrt(h2);
  if (h <= GEOM_EPS) return [m];
  const n = V.perpLeft(u);
  return [V.addScaled(m, n, h), V.addScaled(m, n, -h)];
}

export interface SupportHit {
  /** Fractions sur les segments (hors [0, 1] = sur le prolongement). */
  readonly ta: number;
  readonly tb: number;
  readonly point: Vec2;
}

/** Support d'un segment : droite pour une ligne, cercle pour un arc. */
function lineOf(seg: CurveSeg & { kind: "line" }): Line2 {
  return { origin: seg.a, dir: V.sub(seg.b, seg.a) };
}

/**
 * Intersections des **supports** (droite / cercle entiers) de deux segments, avec les fractions
 * correspondantes sur chaque segment (voir `segParamOfPoint` pour les arcs). Segments de longueur
 * nulle : aucun résultat.
 */
export function intersectSupports(a: CurveSeg, b: CurveSeg): SupportHit[] {
  if (segLength(a) <= 0 || segLength(b) <= 0) return [];
  let pts: Vec2[];
  if (a.kind === "line" && b.kind === "line") {
    const hit = intersectLines(lineOf(a), lineOf(b));
    return hit ? [{ ta: hit.t1, tb: hit.t2, point: hit.point }] : [];
  } else if (a.kind === "line" && b.kind === "arc") {
    const la = lineOf(a);
    pts = intersectLineCircle(la, b.center, b.radius).map((t) => V.addScaled(la.origin, la.dir, t));
  } else if (a.kind === "arc" && b.kind === "line") {
    const lb = lineOf(b);
    pts = intersectLineCircle(lb, a.center, a.radius).map((t) => V.addScaled(lb.origin, lb.dir, t));
  } else if (a.kind === "arc" && b.kind === "arc") {
    pts = intersectCircles(a.center, a.radius, b.center, b.radius);
  } else {
    pts = [];
  }
  return pts.map((point) => ({
    ta: segParamOfPoint(a, point),
    tb: segParamOfPoint(b, point),
    point,
  }));
}

// ------------------------------------------------------------------ droite ∩ courbe

export interface CurveHit {
  /** Abscisse curviligne sur la courbe. */
  readonly s: Mm;
  readonly point: Vec2;
  /** Paramètre sur la droite : point = origin + t·dir. */
  readonly t: number;
}

/**
 * Intersections d'une droite infinie avec une courbe, triées par abscisse s croissante.
 * Les doublons aux jonctions sont fusionnés. Les portions de courbe colinéaires à la droite
 * ne produisent pas d'intersection (recouvrement non ponctuel).
 */
export function intersectLineCurve(line: Line2, curve: Curve2): CurveHit[] {
  const cum = cumulativeLengths(curve);
  const hits: CurveHit[] = [];
  const d2 = V.normSq(line.dir);
  if (d2 === 0) throw new Error("intersectLineCurve : direction nulle");
  const tOnLine = (p: Vec2): number => V.dot(V.sub(p, line.origin), line.dir) / d2;
  curve.segments.forEach((seg, i) => {
    const len = segLength(seg);
    if (len <= 0) return;
    const tol = GEOM_EPS / len;
    let cands: { f: number; p: Vec2 }[];
    if (seg.kind === "line") {
      const hit = intersectLines(line, lineOf(seg));
      cands = hit ? [{ f: hit.t2, p: hit.point }] : [];
    } else {
      cands = intersectLineCircle(line, seg.center, seg.radius).map((t) => {
        const p = V.addScaled(line.origin, line.dir, t);
        return { f: segParamOfPoint(seg, p), p };
      });
    }
    for (const c of cands) {
      if (c.f < -tol || c.f > 1 + tol) continue;
      const f = Math.min(1, Math.max(0, c.f));
      const point = seg.kind === "line" ? c.p : segPointAt(seg, f);
      hits.push({ s: cum[i]! + f * len, point, t: tOnLine(point) });
    }
  });
  hits.sort((a, b) => a.s - b.s);
  const out: CurveHit[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && Math.abs(h.s - last.s) <= 10 * GEOM_EPS) continue;
    out.push(h);
  }
  return out;
}

// ------------------------------------------------------------------ projection

export interface CurveProjection {
  readonly s: Mm;
  readonly point: Vec2;
  readonly distance: Mm;
  readonly index: number;
}

/** Point de la courbe le plus proche de p (premier en abscisse en cas d'égalité). */
export function projectOnCurve(p: Vec2, curve: Curve2): CurveProjection {
  const cum = cumulativeLengths(curve);
  let best: CurveProjection | null = null;
  for (let i = 0; i < curve.segments.length; i++) {
    const seg = curve.segments[i]!;
    const { t, point } = segClosestPoint(seg, p);
    const dist = V.distance(p, point);
    if (best === null || dist < best.distance - GEOM_EPS * 1e-3) {
      best = { s: cum[i]! + t * segLength(seg), point, distance: dist, index: i };
    }
  }
  if (best === null) throw new Error("projectOnCurve : courbe vide");
  return best;
}

/** Distance d'un point à une courbe. */
export function distanceToCurve(p: Vec2, curve: Curve2): Mm {
  return projectOnCurve(p, curve).distance;
}
