/**
 * Contrôle d'un contour polygonal saisi (trémie, contour de pièce, zone interdite) : au moins
 * 3 sommets, coordonnées numériques, aire non nulle, côtés qui ne se recoupent pas. Sans texte :
 * chaque appelant traduit le défaut dans ses propres clés (`site.opening.*`, `site.room.*`,
 * `site.obstacle.zone.*`). N'importe le modèle que pour ses types (le schéma du projet l'utilise).
 */
import { segmentIntersect } from "../geom2d/intersect.js";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";

/** Défaut de forme d'un contour à coordonnées finies. */
export type PolygonShapeDefect =
  | { readonly kind: "tooFewPoints"; readonly count: number }
  | { readonly kind: "zeroArea" }
  | { readonly kind: "selfIntersecting" };

/** Premier défaut d'un contour saisi (trémie) ; `null` s'il est acceptable. */
export type PolygonDefect = PolygonShapeDefect | { readonly kind: "notNumeric" };

/**
 * Premier défaut d'un contour enregistré tel quel (contour de pièce, zone interdite) : les
 * coordonnées y sont déjà finies (`Vec2Schema`), mais un sommet peut répéter le précédent.
 */
export type StoredPolygonDefect =
  | PolygonShapeDefect
  | { readonly kind: "duplicateVertex"; readonly index: number; readonly other: number };

/**
 * Vrai si deux segments parallèles sont portés par la même droite et se recouvrent ou se
 * touchent (cas que `segmentIntersect`, qui ignore les parallèles, ne voit pas).
 */
function collinearOverlap(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const u = V.sub(a2, a1);
  const L = V.norm(u);
  if (!(L > 0)) return false;
  const tol = 1e-6 * Math.max(1, L);
  const off = (p: Vec2): number => Math.abs(V.cross(u, V.sub(p, a1))) / L;
  if (off(b1) > tol || off(b2) > tol) return false;
  const t1 = V.dot(V.sub(b1, a1), u) / L;
  const t2 = V.dot(V.sub(b2, a1), u) / L;
  return Math.max(t1, t2) >= -tol && Math.min(t1, t2) <= L + tol;
}

/** Vrai si deux côtés non adjacents du polygone se coupent ou se touchent. */
export function isSelfIntersecting(poly: Polygon2): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Côtés adjacents : ils partagent un sommet, seul un recouvrement serait anormal.
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        const shared = j === i + 1 ? a2 : a1;
        const other = j === i + 1 ? poly[(j + 1) % n]! : poly[j]!;
        const own = j === i + 1 ? a1 : a2;
        // Repli sur lui-même : l'autre extrémité est dans le prolongement du côté, en arrière.
        const u = V.sub(own, shared);
        const w = V.sub(other, shared);
        if (Math.abs(V.cross(u, w)) <= 1e-9 * V.norm(u) * V.norm(w) && V.dot(u, w) > 0) {
          return true;
        }
        continue;
      }
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % n]!;
      if (segmentIntersect(a1, a2, b1, b2) || collinearOverlap(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Défaut de forme, dans l'ordre : aire nulle (≤ 1 mm²), recoupement (coordonnées finies). */
function shapeDefect(points: readonly Vec2[]): PolygonShapeDefect | null {
  if (!(Math.abs(signedArea(points)) > 1)) return { kind: "zeroArea" };
  if (isSelfIntersecting(points)) return { kind: "selfIntersecting" };
  return null;
}

/**
 * Premier défaut d'un contour, dans l'ordre : nombre de sommets, coordonnées non finies, aire
 * nulle (≤ 1 mm²), recoupement. Les sommets sont lus tels quels (pas de normalisation) : la
 * trémie les normalise avant (`normalizeOpeningPoints`), doublons compris.
 */
export function polygonDefect(points: readonly Vec2[]): PolygonDefect | null {
  if (points.length < 3) return { kind: "tooFewPoints", count: points.length };
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { kind: "notNumeric" };
  }
  return shapeDefect(points);
}

/**
 * Premier défaut d'un contour enregistré tel quel (contour de pièce, zone interdite), dans
 * l'ordre : nombre de sommets, sommet confondu avec son voisin (`index` et `other` à partir
 * de 1 ; un premier sommet répété en fin de liste pour fermer le contour est refusé),
 * aire nulle, recoupement. Ces contours ne sont pas normalisés : un doublon serait sinon
 * signalé comme un recoupement. Coordonnées supposées finies (garanties par `Vec2Schema`).
 */
export function storedPolygonDefect(points: readonly Vec2[]): StoredPolygonDefect | null {
  const n = points.length;
  if (n < 3) return { kind: "tooFewPoints", count: n };
  const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
  for (let i = 1; i < n; i++) {
    if (same(points[i - 1]!, points[i]!))
      return { kind: "duplicateVertex", index: i + 1, other: i };
  }
  if (same(points[n - 1]!, points[0]!)) return { kind: "duplicateVertex", index: n, other: 1 };
  return shapeDefect(points);
}
