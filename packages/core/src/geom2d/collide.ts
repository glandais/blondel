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
