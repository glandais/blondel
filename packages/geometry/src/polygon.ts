/**
 * Préparation et triangulation de profils plans (`Shape2`).
 */
import earcut from "earcut";
import type { Polygon2, Shape2 } from "@blondel/core";
import { GeometryError } from "./errors.js";

/** Tolérance de longueur (mm) pour la fusion de points consécutifs (ADR-0003). */
export const EPS = 1e-6;

/** Anneau plan nettoyé : coordonnées à plat [x0, y0, x1, y1, …], sans point de fermeture. */
export type Ring = Float64Array;

/** Aire signée (positive si CCW) d'un anneau à plat. */
export function ringArea(r: Ring): number {
  const n = r.length / 2;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++)
    s += r[2 * j]! * r[2 * i + 1]! - r[2 * i]! * r[2 * j + 1]!;
  return s / 2;
}

/** Aire signée d'un polygone (positive si CCW). */
export function polygonArea(poly: Polygon2): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    s += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  return s / 2;
}

/** Aire d'un profil avec trous (valeur absolue du contour moins celles des trous). */
export function shapeArea(shape: Shape2): number {
  let a = Math.abs(polygonArea(shape.outer));
  for (const h of shape.holes) a -= Math.abs(polygonArea(h));
  return a;
}

/**
 * Nettoie un polygone : retire le point de fermeture éventuel, les points confondus
 * (distance ≤ EPS) et les points alignés (qui feraient diverger la triangulation earcut, qui
 * les supprime elle-même, et les faces latérales : arêtes en T). Retourne `null` si moins de
 * 3 points subsistent.
 */
export function cleanRing(poly: Polygon2): Ring | null {
  let pts: number[] = [];
  for (const p of poly) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw new GeometryError("coordonnée non finie dans un profil");
    pts.push(p.x, p.y);
  }
  let changed = true;
  while (changed && pts.length >= 6) {
    changed = false;
    const n = pts.length / 2;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const px = pts[2 * ((i + n - 1) % n)]!,
        py = pts[2 * ((i + n - 1) % n) + 1]!;
      const cx = pts[2 * i]!,
        cy = pts[2 * i + 1]!;
      const nx = pts[2 * ((i + 1) % n)]!,
        ny = pts[2 * ((i + 1) % n) + 1]!;
      const ax = cx - px,
        ay = cy - py,
        bx = nx - cx,
        by = ny - cy;
      const la = Math.hypot(ax, ay),
        lb = Math.hypot(bx, by);
      // Point confondu avec le précédent, ou aligné (produit vectoriel relatif ~ 0 ; pointe à
      // demi-tour comprise, d'aire nulle).
      const dup = la <= EPS;
      const collinear = !dup && lb > EPS && Math.abs(ax * by - ay * bx) <= 1e-12 * la * lb;
      if (dup || collinear) {
        changed = true;
        // On retire ce point et on recommence (retraits un par un : robuste aux cascades).
        for (let k = i + 1; k < n; k++) out.push(pts[2 * k]!, pts[2 * k + 1]!);
        break;
      }
      out.push(cx, cy);
    }
    pts = out;
  }
  if (pts.length < 6) return null;
  const r = Float64Array.from(pts);
  return Math.abs(ringArea(r)) > EPS * EPS ? r : null;
}

function reversed(r: Ring): Ring {
  const n = r.length / 2;
  const out = new Float64Array(r.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = r[2 * (n - 1 - i)]!;
    out[2 * i + 1] = r[2 * (n - 1 - i) + 1]!;
  }
  return out;
}

export interface PreparedShape {
  /** Contour CCW puis trous CW, nettoyés. */
  readonly rings: readonly Ring[];
  /** Coordonnées concaténées des anneaux (à plat) et début de chaque anneau (en points). */
  readonly coords: Float64Array;
  readonly ringStart: readonly number[];
  /** Triangles (indices dans `coords`), tous orientés CCW. */
  readonly triangles: readonly number[];
  /** Aire nette du profil (mm²). */
  readonly area: number;
}

/**
 * Nettoie, oriente (contour CCW, trous CW, quel que soit le sens fourni) et triangule un profil.
 * Lève `GeometryError` si le contour est dégénéré ou si la triangulation ne couvre pas l'aire
 * (profil auto-intersectant, trou hors du contour…).
 */
export function prepareShape(shape: Shape2): PreparedShape {
  let outer = cleanRing(shape.outer);
  if (!outer) throw new GeometryError("contour de profil dégénéré (moins de 3 points distincts)");
  if (ringArea(outer) < 0) outer = reversed(outer);
  const rings: Ring[] = [outer];
  let area = ringArea(outer);
  for (const h of shape.holes) {
    let r = cleanRing(h);
    if (!r) continue; // trou dégénéré : sans effet sur le solide
    if (ringArea(r) > 0) r = reversed(r);
    area += ringArea(r);
    rings.push(r);
  }
  let total = 0;
  const ringStart: number[] = [];
  for (const r of rings) {
    ringStart.push(total / 2);
    total += r.length;
  }
  const coords = new Float64Array(total);
  rings.forEach((r, k) => coords.set(r, 2 * ringStart[k]!));
  const tris = repairTJunctions(coords, rings, ringStart, earcut(coords, ringStart.slice(1), 2));
  let triArea = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!,
      b = tris[t + 1]!,
      c = tris[t + 2]!;
    const ax = coords[2 * a]!,
      ay = coords[2 * a + 1]!;
    const s =
      (coords[2 * b]! - ax) * (coords[2 * c + 1]! - ay) -
      (coords[2 * c]! - ax) * (coords[2 * b + 1]! - ay);
    if (s < 0) {
      tris[t + 1] = c;
      tris[t + 2] = b;
    }
    triArea += Math.abs(s) / 2;
  }
  if (area <= 0 || Math.abs(triArea - area) > 1e-9 * Math.max(1, area)) {
    throw new GeometryError(
      "profil invalide : triangulation incohérente (auto-intersection ou trou hors contour ?)",
    );
  }
  return { rings, coords, ringStart, triangles: tris, area };
}

/**
 * earcut supprime les points alignés du polygone fusionné après pontage des trous (trous
 * alignés, par ex. mortaises en ligne) : une arête de bord peut alors manquer, remplacée par
 * une arête plus longue passant par le point supprimé (jonction en T, maillage non fermé) ;
 * il produit aussi des triangles d'aire nulle entre points alignés. On retire ces derniers,
 * puis on découpe les triangles dont une arête contient un sommet en son intérieur. Sans effet (et quasi gratuit)
 * quand toutes les arêtes de bord sont présentes.
 */
function repairTJunctions(
  coords: Float64Array,
  rings: readonly Ring[],
  ringStart: readonly number[],
  raw: number[],
): number[] {
  const nPts = coords.length / 2;
  // 1. Retrait des triangles d'aire (quasi) nulle : earcut en produit entre points alignés.
  const tris: number[] = [];
  let dropped = false;
  for (let t = 0; t < raw.length; t += 3) {
    const a = raw[t]!,
      b = raw[t + 1]!,
      c = raw[t + 2]!;
    const ax = coords[2 * a]!,
      ay = coords[2 * a + 1]!;
    const ux = coords[2 * b]! - ax,
      uy = coords[2 * b + 1]! - ay,
      vx = coords[2 * c]! - ax,
      vy = coords[2 * c + 1]! - ay;
    const wx = vx - ux,
      wy = vy - uy;
    const l2 = Math.max(ux * ux + uy * uy, vx * vx + vy * vy, wx * wx + wy * wy);
    if (Math.abs(ux * vy - uy * vx) <= 1e-10 * l2) dropped = true;
    else tris.push(a, b, c);
  }
  // 2. Topologie : chaque arête d'anneau doit être portée par exactement 1 triangle, toute
  // autre arête par exactement 2 (sinon arête manquante, jonction en T intérieure, sommet
  // supprimé par earcut…).
  const missing = dropped || !isClosedTriangulation(tris, rings, ringStart, nPts);
  if (!missing) return tris;
  const queue: [number, number, number][] = [];
  for (let t = 0; t < tris.length; t += 3) queue.push([tris[t]!, tris[t + 1]!, tris[t + 2]!]);
  const out: number[] = [];
  // Point p strictement intérieur au segment [x, y] (à tolérance relative près) ?
  const onSegment = (p: number, x: number, y: number): boolean => {
    const ex = coords[2 * y]! - coords[2 * x]!,
      ey = coords[2 * y + 1]! - coords[2 * x + 1]!;
    const px = coords[2 * p]! - coords[2 * x]!,
      py = coords[2 * p + 1]! - coords[2 * x + 1]!;
    const l2 = ex * ex + ey * ey;
    const t = (px * ex + py * ey) / l2;
    if (t <= 1e-9 || t >= 1 - 1e-9) return false;
    return Math.abs(px * ey - py * ex) <= 1e-9 * l2;
  };
  while (queue.length > 0) {
    const tri = queue.pop()!;
    let split = false;
    for (let e = 0; e < 3 && !split; e++) {
      const x = tri[e]!,
        y = tri[(e + 1) % 3]!,
        z = tri[(e + 2) % 3]!;
      for (let p = 0; p < nPts; p++) {
        if (p === x || p === y || p === z) continue;
        if (onSegment(p, x, y)) {
          queue.push([x, p, z], [p, y, z]);
          split = true;
          break;
        }
      }
    }
    if (!split) out.push(tri[0], tri[1], tri[2]);
  }
  if (!isClosedTriangulation(out, rings, ringStart, nPts)) {
    throw new GeometryError(
      "profil invalide : triangulation non réparable (trous qui se touchent ou se chevauchent ?)",
    );
  }
  return out;
}

/**
 * Vrai si la triangulation recouvre le profil sans trou ni jonction en T : chaque arête
 * d'anneau est utilisée par exactement un triangle, toute autre arête par exactement deux.
 */
function isClosedTriangulation(
  tris: readonly number[],
  rings: readonly Ring[],
  ringStart: readonly number[],
  nPts: number,
): boolean {
  const count = new Map<number, number>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const u = tris[t + e]!,
        v = tris[t + ((e + 1) % 3)]!;
      const key = u < v ? u * nPts + v : v * nPts + u;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  let ringEdges = 0;
  for (let k = 0; k < rings.length; k++) {
    const n = rings[k]!.length / 2,
      s0 = ringStart[k]!;
    for (let i = 0; i < n; i++) {
      const u = s0 + i,
        v = s0 + ((i + 1) % n);
      const key = u < v ? u * nPts + v : v * nPts + u;
      if (count.get(key) !== 1) return false;
      ringEdges++;
    }
  }
  let interior = 0;
  for (const c of count.values()) {
    if (c === 2) interior++;
    else if (c !== 1) return false;
  }
  // Toute arête simple doit être une arête d'anneau.
  return count.size - interior === ringEdges;
}

/**
 * Pour chaque sommet d'un anneau fermé, indique si l'angle entre les arêtes adjacentes
 * dépasse l'angle de lissage (arête vive : sommets dupliqués, normales à plat).
 * `creaseCos` : cosinus de l'angle de lissage (voir `creaseCos` d'options.ts).
 */
export function sharpCorners(r: Ring, creaseCos: number): boolean[] {
  const n = r.length / 2;
  const c = creaseCos;
  const out: boolean[] = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n,
      q = (i + 1) % n;
    const ax = r[2 * i]! - r[2 * p]!,
      ay = r[2 * i + 1]! - r[2 * p + 1]!;
    const bx = r[2 * q]! - r[2 * i]!,
      by = r[2 * q + 1]! - r[2 * i + 1]!;
    const dot = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
    out[i] = dot < c;
  }
  return out;
}
