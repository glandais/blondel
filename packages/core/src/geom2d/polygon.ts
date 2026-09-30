/**
 * Polygones plans (`Polygon2` : sommets sans répétition du premier) et bandes entre courbes.
 */
import type { Curve2, Mm, Polygon2, Shape2, Vec2 } from "../model/primitives.js";
import { MessageError, msg } from "@blondel/i18n";
import { flattenCurve, subCurve } from "./curve.js";
import { intersectLineCurve, intersectLines, type CurveHit, type Line2 } from "./intersect.js";
import { GEOM_EPS } from "./tolerance.js";
import * as V from "./vec.js";

/** Aire signée (formule du lacet) : > 0 pour un polygone CCW. */
export function signedArea(poly: Polygon2): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export type Orientation = "ccw" | "cw" | "degenerate";

export function orientation(poly: Polygon2, tol: number = GEOM_EPS): Orientation {
  const a = signedArea(poly);
  return a > tol ? "ccw" : a < -tol ? "cw" : "degenerate";
}

/** Renvoie le polygone orienté CCW (inversé si nécessaire). */
export function ensureCCW(poly: Polygon2): Polygon2 {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function perimeter(poly: Polygon2): Mm {
  let l = 0;
  for (let i = 0; i < poly.length; i++) l += V.distance(poly[i]!, poly[(i + 1) % poly.length]!);
  return l;
}

/** Aire d'une forme à trous (valeur absolue du contour moins celles des trous). */
export function shapeArea(shape: Shape2): number {
  return (
    Math.abs(signedArea(shape.outer)) - shape.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0)
  );
}

export type PointLocation = "inside" | "outside" | "boundary";

/** Position d'un point par rapport à un polygone simple (nombre d'enroulement ; bord à `tol`). */
export function pointInPolygon(p: Vec2, poly: Polygon2, tol: Mm = GEOM_EPS): PointLocation {
  const n = poly.length;
  let wn = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    // Bord : distance au segment [a, b].
    const ab = V.sub(b, a);
    const l2 = V.normSq(ab);
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / l2));
    if (V.distance(p, V.addScaled(a, ab, t)) <= tol) return "boundary";
    if (a.y <= p.y) {
      if (b.y > p.y && V.cross(ab, V.sub(p, a)) > 0) wn++;
    } else if (b.y <= p.y && V.cross(ab, V.sub(p, a)) < 0) {
      wn--;
    }
  }
  return wn !== 0 ? "inside" : "outside";
}

export interface BBox {
  readonly min: Vec2;
  readonly max: Vec2;
}

/** Boîte englobante d'un ensemble de points (lève une erreur si vide). */
export function bbox(points: readonly Vec2[]): BBox {
  if (points.length === 0) throw new MessageError(msg("error.geom2d.bbox.noPoints"));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/**
 * Polygone strictement convexe (sommets alignés tolérés) **et simple** : tous les virages ont
 * le même signe et le virage total vaut ±2π (un polygone étoilé comme le pentagramme, dont
 * tous les virages ont le même signe mais qui fait deux tours, est rejeté).
 */
export function isConvex(poly: Polygon2): boolean {
  // Points consécutifs confondus fusionnés (y compris dernier/premier).
  const pts: Vec2[] = [];
  for (const p of poly) {
    const last = pts[pts.length - 1];
    if (last === undefined || !V.equals(last, p)) pts.push(p);
  }
  while (pts.length > 1 && V.equals(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  const n = pts.length;
  if (n < 3) return false;
  let sign = 0;
  let totalTurn = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = pts[(i + 2) % n]!;
    const u = V.sub(b, a);
    const w = V.sub(c, b);
    totalTurn += V.signedAngle(u, w);
    const cr = V.cross(u, w);
    if (Math.abs(cr) <= GEOM_EPS) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0 && Math.abs(Math.abs(totalTurn) - 2 * Math.PI) < 1e-6;
}

/**
 * Décalage simple d'un polygone convexe : chaque arête est translatée de d vers l'extérieur
 * (d < 0 : vers l'intérieur) et les sommets sont les intersections des arêtes décalées
 * (angles vifs, pas d'arrondi). Le résultat est CCW. Lève une erreur si le polygone n'est pas
 * convexe ou si un décalage intérieur fait disparaître une arête.
 */
export function offsetConvexPolygon(poly: Polygon2, d: Mm): Polygon2 {
  if (!isConvex(poly)) throw new MessageError(msg("error.geom2d.offsetConvexPolygon.notConvex"));
  const p = ensureCCW(poly);
  const n = p.length;
  const lines: Line2[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % n]!;
    const dir = V.sub(b, a);
    if (V.norm(dir) <= GEOM_EPS) continue;
    const out = V.scale(V.perpRight(V.normalize(dir)), d);
    lines.push({ origin: V.add(a, out), dir });
  }
  const m = lines.length;
  const res: Vec2[] = [];
  for (let i = 0; i < m; i++) {
    const prev = lines[(i - 1 + m) % m]!;
    const cur = lines[i]!;
    const hit = intersectLines(prev, cur);
    if (hit) res.push(hit.point);
    else res.push(cur.origin); // arêtes colinéaires consécutives
  }
  // Une arête dont le sens s'inverse a « traversé » le polygone : décalage intérieur trop grand.
  const flipped = lines.some((l, i) => V.dot(V.sub(res[(i + 1) % m]!, res[i]!), l.dir) <= 0);
  if (flipped || orientation(res) !== "ccw" || !isConvex(res)) {
    throw new MessageError(msg("error.geom2d.offsetConvexPolygon.insetTooLarge"));
  }
  return res;
}

// ------------------------------------------------------------------ bandes entre deux courbes

/**
 * Polygone de la bande entre deux courbes de même sens (a puis b parcourue à l'envers),
 * orienté CCW. Arcs approchés à `chordTol` mm près.
 */
export function bandPolygon(a: Curve2, b: Curve2, chordTol: Mm = 0.1): Polygon2 {
  const pa = flattenCurve(a, chordTol);
  const pb = flattenCurve(b, chordTol).reverse();
  const pts: Vec2[] = [...pa];
  for (const p of pb) {
    const last = pts[pts.length - 1];
    if (last === undefined || !V.equals(last, p)) pts.push(p);
  }
  if (pts.length > 1 && V.equals(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  return ensureCCW(pts);
}

export interface BandCut {
  /** Contour CCW de la portion de bande. */
  readonly polygon: Polygon2;
  /** Abscisses de coupe sur a et b (coupe 0 puis coupe 1). */
  readonly sA: readonly [Mm, Mm];
  readonly sB: readonly [Mm, Mm];
  /** Portions de a et b entre les coupes (sens de la coupe 0 vers la coupe 1). */
  readonly curveA: Curve2;
  readonly curveB: Curve2;
}

/** Intersection d'une droite de coupe avec une courbe la plus proche de l'origine de la droite. */
function nearestHit(line: Line2, curve: Curve2): CurveHit | null {
  const hits = intersectLineCurve(line, curve);
  let best: CurveHit | null = null;
  for (const h of hits) if (best === null || Math.abs(h.t) < Math.abs(best.t)) best = h;
  return best;
}

/**
 * Découpe de la bande entre deux courbes a et b par deux droites de coupe (typiquement les
 * lignes de nez k et k+1, origine sur la ligne de foulée). Pour chaque courbe, on retient
 * l'intersection la plus proche de l'origine de la droite. Renvoie null si une coupe ne
 * rencontre pas l'une des courbes.
 */
export function cutBand(
  a: Curve2,
  b: Curve2,
  cut0: Line2,
  cut1: Line2,
  chordTol: Mm = 0.1,
): BandCut | null {
  const a0 = nearestHit(cut0, a);
  const a1 = nearestHit(cut1, a);
  const b0 = nearestHit(cut0, b);
  const b1 = nearestHit(cut1, b);
  if (!a0 || !a1 || !b0 || !b1) return null;
  const curveA = subCurve(a, a0.s, a1.s);
  const curveB = subCurve(b, b0.s, b1.s);
  return {
    polygon: bandPolygon(curveA, curveB, chordTol),
    sA: [a0.s, a1.s],
    sB: [b0.s, b1.s],
    curveA,
    curveB,
  };
}
