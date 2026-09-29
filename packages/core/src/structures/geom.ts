/**
 * Outils géométriques plans propres aux structures : découpe de polygones par demi-plans,
 * distances entre polygones, simplicité, rectangle englobant orienté minimal, polyligne
 * fonctionnelle (ligne des nez développée).
 */
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";

/** Tolérance de coïncidence des sommets (mm). */
export const STRUCT_EPS = 1e-6;

/**
 * Découpe d'un polygone par le demi-plan { p : (p − origin)·normal ≥ 0 } (Sutherland–Hodgman).
 * Le résultat peut contenir des arêtes dégénérées si le polygone est non convexe ; il sert au
 * calcul d'étendues et d'aires, et aux contours monotones des développés.
 */
export function clipHalfPlane(poly: Polygon2, origin: Vec2, normal: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  if (n === 0) return out;
  const side = (p: Vec2): number => V.dot(V.sub(p, origin), normal);
  for (let i = 0; i < n; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % n]!;
    const sc = side(cur);
    const sn = side(nxt);
    if (sc >= 0) out.push(cur);
    if ((sc >= 0 && sn < 0) || (sc < 0 && sn >= 0)) {
      const t = sc / (sc - sn);
      out.push(V.lerp(cur, nxt, t));
    }
  }
  return dedupe(out);
}

/** Intersection d'un polygone avec un polygone **convexe** orienté CCW. */
export function clipConvex(poly: Polygon2, convexCCW: Polygon2): Vec2[] {
  let out: Vec2[] = [...poly];
  const n = convexCCW.length;
  for (let i = 0; i < n && out.length > 0; i++) {
    const a = convexCCW[i]!;
    const b = convexCCW[(i + 1) % n]!;
    out = clipHalfPlane(out, a, V.perpLeft(V.sub(b, a)));
  }
  return out;
}

/** Retire les sommets consécutifs confondus (et la fermeture explicite). */
export function dedupe(pts: readonly Vec2[], tol: Mm = STRUCT_EPS): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last === undefined || !V.equals(last, p, tol)) out.push(p);
  }
  while (out.length > 1 && V.equals(out[0]!, out[out.length - 1]!, tol)) out.pop();
  return out;
}

/** Retire les sommets alignés avec leurs voisins (après `dedupe`). */
export function removeCollinear(pts: readonly Vec2[], tol: Mm = 1e-9): Vec2[] {
  let cur = dedupe(pts);
  let changed = true;
  while (changed && cur.length > 3) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const a = cur[(i - 1 + cur.length) % cur.length]!;
      const b = cur[i]!;
      const c = cur[(i + 1) % cur.length]!;
      const ab = V.sub(b, a);
      const bc = V.sub(c, b);
      const scale = Math.max(V.norm(ab), V.norm(bc), 1);
      if (Math.abs(V.cross(ab, bc)) <= tol * scale && V.dot(ab, bc) >= 0) {
        cur = [...cur.slice(0, i), ...cur.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  return cur;
}

/**
 * Retire les « pointes » d'aire nulle : sommet b dont les voisins a et c sont alignés avec lui
 * **et** de part et d'autre du même côté (aller-retour a → b → c le long d'une même droite,
 * ex. contour de marche qui longe une fente entre deux poteaux jointifs).
 */
export function removeSpikes(pts: readonly Vec2[], tol: Mm = 1e-9): Vec2[] {
  let cur = dedupe(pts);
  let changed = true;
  while (changed && cur.length > 3) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const a = cur[(i - 1 + cur.length) % cur.length]!;
      const b = cur[i]!;
      const c = cur[(i + 1) % cur.length]!;
      const ab = V.sub(b, a);
      const bc = V.sub(c, b);
      const scale = Math.max(V.norm(ab), V.norm(bc), 1);
      if (Math.abs(V.cross(ab, bc)) <= tol * scale && V.dot(ab, bc) < 0) {
        cur = dedupe([...cur.slice(0, i), ...cur.slice(i + 1)]);
        changed = true;
        break;
      }
    }
  }
  return cur;
}

/** Distance d'un point à un segment. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): Mm {
  const ab = V.sub(b, a);
  const len2 = V.dot(ab, ab);
  if (len2 === 0) return V.distance(p, a);
  const t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / len2));
  return V.distance(p, V.addScaled(a, ab, t));
}

/** Vrai si les segments [a, b] et [c, d] se coupent (extrémités comprises). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 1e-9): boolean {
  const o1 = V.cross(V.sub(b, a), V.sub(c, a));
  const o2 = V.cross(V.sub(b, a), V.sub(d, a));
  const o3 = V.cross(V.sub(d, c), V.sub(a, c));
  const o4 = V.cross(V.sub(d, c), V.sub(b, c));
  const s = (x: number): number => (Math.abs(x) <= tol ? 0 : Math.sign(x));
  const [s1, s2, s3, s4] = [s(o1), s(o2), s(o3), s(o4)];
  if (s1 * s2 < 0 && s3 * s4 < 0) return true;
  const onSeg = (p: Vec2, q: Vec2, r: Vec2): boolean =>
    Math.min(p.x, q.x) - tol <= r.x &&
    r.x <= Math.max(p.x, q.x) + tol &&
    Math.min(p.y, q.y) - tol <= r.y &&
    r.y <= Math.max(p.y, q.y) + tol;
  if (s1 === 0 && onSeg(a, b, c)) return true;
  if (s2 === 0 && onSeg(a, b, d)) return true;
  if (s3 === 0 && onSeg(c, d, a)) return true;
  if (s4 === 0 && onSeg(c, d, b)) return true;
  return false;
}

/** Distance entre deux segments (0 s'ils se coupent). */
export function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Mm {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

/** Distance minimale entre les contours de deux polygones (0 s'ils se touchent ou se coupent). */
export function polygonDistance(p: Polygon2, q: Polygon2): Mm {
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    for (let j = 0; j < q.length; j++) {
      best = Math.min(best, segmentDistance(a, b, q[j]!, q[(j + 1) % q.length]!));
      if (best === 0) return 0;
    }
  }
  return best;
}

/** Polygone simple : aucune paire d'arêtes non adjacentes ne se coupe. */
export function isSimplePolygon(poly: Polygon2): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(a, b, poly[j]!, poly[(j + 1) % n]!, 1e-9)) return false;
    }
  }
  return true;
}

/** Enveloppe convexe (chaîne monotone), CCW. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const p = [...points].sort((u, v) => u.x - v.x || u.y - v.y);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => V.cross(V.sub(a, o), V.sub(b, o));
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0)
      upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface OrientedBox {
  /** Grande dimension (mm). */
  readonly length: Mm;
  /** Petite dimension (mm). */
  readonly width: Mm;
  /** Direction unitaire de la grande dimension. */
  readonly axis: Vec2;
  /** Coins CCW. */
  readonly corners: readonly Vec2[];
}

/**
 * Rectangle englobant orienté d'aire minimale (un côté porté par une arête de l'enveloppe
 * convexe) ; départage à aire égale par la plus petite largeur.
 */
export function minAreaRect(points: readonly Vec2[]): OrientedBox {
  const hull = convexHull(points);
  if (hull.length === 0) return { length: 0, width: 0, axis: V.vec(1, 0), corners: [] };
  let best: OrientedBox | null = null;
  let bestArea = Infinity;
  const edges = hull.length >= 2 ? hull.length : 1;
  for (let i = 0; i < edges; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const d = V.sub(b, a);
    const axis = V.norm(d) > 0 ? V.normalize(d) : V.vec(1, 0);
    const perp = V.perpLeft(axis);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of hull) {
      const u = V.dot(p, axis);
      const v = V.dot(p, perp);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const du = u1 - u0;
    const dv = v1 - v0;
    const area = du * dv;
    if (
      area < bestArea - 1e-6 ||
      (Math.abs(area - bestArea) <= 1e-6 && best && Math.min(du, dv) < best.width)
    ) {
      bestArea = area;
      const at = (u: number, v: number): Vec2 => V.add(V.scale(axis, u), V.scale(perp, v));
      const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
      best =
        du >= dv
          ? { length: du, width: dv, axis, corners }
          : { length: dv, width: du, axis: perp, corners };
    }
  }
  return best!;
}

/** Aire absolue d'un polygone. */
export function area(poly: Polygon2): number {
  return Math.abs(signedArea(poly));
}

/**
 * Fonction affine par morceaux y(x) définie par des nœuds d'abscisses croissantes ;
 * prolongée linéairement au-delà des extrémités (pente du premier / dernier morceau).
 */
export class PiecewiseLinear {
  readonly xs: readonly number[];
  readonly ys: readonly number[];

  constructor(knots: readonly { x: number; y: number }[]) {
    const sorted = [...knots].sort((a, b) => a.x - b.x);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const k of sorted) {
      if (!Number.isFinite(k.x) || !Number.isFinite(k.y)) continue;
      const last = xs.length - 1;
      if (last >= 0 && k.x - xs[last]! <= STRUCT_EPS) {
        // Abscisses confondues : on garde la plus haute (nez de marches superposés).
        ys[last] = Math.max(ys[last]!, k.y);
        continue;
      }
      xs.push(k.x);
      ys.push(k.y);
    }
    if (xs.length === 0) throw new Error("PiecewiseLinear : aucun nœud");
    this.xs = xs;
    this.ys = ys;
  }

  at(x: number): number {
    const { xs, ys } = this;
    const n = xs.length;
    if (n === 1) return ys[0]!;
    let i: number;
    if (x <= xs[0]!) i = 0;
    else if (x >= xs[n - 1]!) i = n - 2;
    else {
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid]! <= x) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    return ys[i]! + ((ys[i + 1]! - ys[i]!) * (x - x0)) / (x1 - x0);
  }

  /** Nœuds strictement compris dans ]a ; b[. */
  knotsBetween(a: number, b: number): number[] {
    return this.xs.filter((x) => x > a + STRUCT_EPS && x < b - STRUCT_EPS);
  }
}
