/**
 * Collisions planes : recouvrement de polygones convexes (théorème de l'axe séparateur), d'un
 * disque et d'un polygone convexe, rectangle d'un mur et premier mur heurté par une emprise.
 * Un contact au nu (recouvrement ≤ `tol`) n'est jamais une collision.
 */
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { Wall } from "../model/project.js";
import { pointInPolygon } from "./polygon.js";
import * as V from "./vec.js";

/** Rectangle d'un mur (axe `a`–`b`, épaisseur totale). */
export function wallPolygon(wall: Wall): Polygon2 {
  const d = V.sub(wall.b, wall.a);
  const l = V.norm(d);
  const nrm = l > 0 ? V.scale(V.perpLeft(d), wall.thickness / 2 / l) : V.vec(wall.thickness / 2, 0);
  return [V.add(wall.a, nrm), V.add(wall.b, nrm), V.sub(wall.b, nrm), V.sub(wall.a, nrm)];
}

function project1(poly: Polygon2, axis: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = V.dot(p, axis);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/**
 * Deux polygones **convexes** se recouvrent-ils de plus de `tol` (théorème de l'axe
 * séparateur) ? Un contact au nu (recouvrement ≤ tol) n'est pas une collision.
 */
export function convexOverlap(a: Polygon2, b: Polygon2, tol: Mm): boolean {
  for (const poly of [a, b]) {
    const m = poly.length;
    for (let i = 0; i < m; i++) {
      const e = V.sub(poly[(i + 1) % m]!, poly[i]!);
      const l = V.norm(e);
      if (!(l > 0)) continue;
      const axis = V.scale(V.perpLeft(e), 1 / l);
      const [a0, a1] = project1(a, axis);
      const [b0, b1] = project1(b, axis);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
    }
  }
  return true;
}

/** Un disque recouvre-t-il un polygone convexe de plus de `tol` ? */
export function discOverlap(center: Vec2, radius: Mm, poly: Polygon2, tol: Mm): boolean {
  if (pointInPolygon(center, poly, 0) === "inside") return true;
  const m = poly.length;
  for (let i = 0; i < m; i++) {
    const a = poly[i]!;
    const ab = V.sub(poly[(i + 1) % m]!, a);
    const l2 = V.normSq(ab);
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, V.dot(V.sub(center, a), ab) / l2));
    if (V.distance(center, V.addScaled(a, ab, t)) < radius - tol) return true;
  }
  return false;
}

/** Premier mur heurté par l'emprise hors tout (pièces en repère du site), ou `null`. */
export function wallCollision(
  pieces: readonly Polygon2[],
  walls: readonly Wall[],
  tol: Mm,
): Wall | null {
  for (const wall of walls) {
    const wp = wallPolygon(wall);
    if (pieces.some((p) => convexOverlap(p, wp, tol))) return wall;
  }
  return null;
}

/** Enveloppe convexe (chaîne monotone d'Andrew), CCW, sans sommet aligné ; vide sous 3 points. */
export function convexHull(points: readonly Vec2[]): Polygon2 {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return [];
  const half = (list: readonly Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (
        out.length >= 2 &&
        V.cross(
          V.sub(out[out.length - 1]!, out[out.length - 2]!),
          V.sub(p, out[out.length - 2]!),
        ) <= 0
      )
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  return hull.length >= 3 ? hull : [];
}

/**
 * Triangulation d'un polygone simple par oreilles (sommets alignés ou confondus tolérés) :
 * triangles CCW. Un polygone dégénéré rend les triangles trouvés avant le blocage.
 */
export function triangulateSimple(poly: Polygon2): Polygon2[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) area += V.cross(poly[i]!, poly[(i + 1) % poly.length]!);
  const pts = area < 0 ? [...poly].reverse() : [...poly];
  const out: Polygon2[] = [];
  const inTri = (p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean =>
    V.cross(V.sub(b, a), V.sub(p, a)) >= 0 &&
    V.cross(V.sub(c, b), V.sub(p, b)) >= 0 &&
    V.cross(V.sub(a, c), V.sub(p, c)) >= 0;
  let guard = 0;
  while (pts.length > 3 && guard++ < 10_000) {
    const n = pts.length;
    let clipped = false;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % n]!;
      const turn = V.cross(V.sub(b, a), V.sub(c, b));
      if (turn < 0) continue;
      if (turn === 0) {
        // Sommet aligné : retiré sans triangle.
        pts.splice(i, 1);
        clipped = true;
        break;
      }
      if (pts.some((p) => p !== a && p !== b && p !== c && inTri(p, a, b, c))) continue;
      out.push([a, b, c]);
      pts.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return out;
  }
  if (pts.length === 3) out.push([pts[0]!, pts[1]!, pts[2]!]);
  return out;
}

/**
 * Un polygone convexe recouvre-t-il un polygone simple quelconque de plus de `tol` ? Le second
 * est triangulé (`triangulateSimple`), chaque triangle testé par l'axe séparateur.
 */
export function convexSimpleOverlap(convex: Polygon2, simple: Polygon2, tol: Mm): boolean {
  return triangulateSimple(simple).some((t) => convexOverlap(convex, t, tol));
}
