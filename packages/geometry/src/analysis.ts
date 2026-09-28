/**
 * Analyses de maillage : boîte englobante, volume signé, vérification de variété.
 */
import type { Vec3 } from "@blondel/core";
import type { Mesh } from "./mesh.js";

export interface Bbox3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Boîte englobante alignée sur les axes ; `null` pour un maillage sans sommet. */
export function bbox(mesh: Mesh): Bbox3 | null {
  const p = mesh.positions;
  if (p.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < p.length; k += 3) {
    const x = p[k]!, y = p[k + 1]!, z = p[k + 2]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

/** Union de boîtes englobantes (`null` ignorés). */
export function unionBbox(boxes: readonly (Bbox3 | null)[]): Bbox3 | null {
  let r: Bbox3 | null = null;
  for (const b of boxes) {
    if (!b) continue;
    r = r
      ? {
          min: { x: Math.min(r.min.x, b.min.x), y: Math.min(r.min.y, b.min.y), z: Math.min(r.min.z, b.min.z) },
          max: { x: Math.max(r.max.x, b.max.x), y: Math.max(r.max.y, b.max.y), z: Math.max(r.max.z, b.max.z) },
        }
      : b;
  }
  return r;
}

/**
 * Volume signé (mm³) d'un maillage fermé, par le théorème de la divergence
 * (somme des tétraèdres origine–triangle). Positif si les triangles sont orientés vers
 * l'extérieur. Calcul en float64 relativement au premier sommet pour limiter l'erreur.
 */
export function signedVolume(mesh: Mesh): number {
  const p = mesh.positions;
  const idx = mesh.indices;
  if (idx.length === 0) return 0;
  const ox = p[0]!, oy = p[1]!, oz = p[2]!;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t]!, b = 3 * idx[t + 1]!, c = 3 * idx[t + 2]!;
    const ax = p[a]! - ox, ay = p[a + 1]! - oy, az = p[a + 2]! - oz;
    const bx = p[b]! - ox, by = p[b + 1]! - oy, bz = p[b + 2]! - oz;
    const cx = p[c]! - ox, cy = p[c + 1]! - oy, cz = p[c + 2]! - oz;
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Aire totale (mm²) des triangles. */
export function surfaceArea(mesh: Mesh): number {
  const p = mesh.positions;
  const idx = mesh.indices;
  let s = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t]!, b = 3 * idx[t + 1]!, c = 3 * idx[t + 2]!;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return s / 2;
}

export interface ManifoldReport {
  /** Fermé, orienté de façon cohérente, sans arête non-variété ni triangle dégénéré. */
  readonly ok: boolean;
  /** Nombre de sommets distincts après soudure. */
  readonly weldedVertices: number;
  /** Arêtes utilisées par un seul triangle (bord : maillage non fermé). */
  readonly boundaryEdges: number;
  /** Arêtes partagées par plus de 2 triangles. */
  readonly nonManifoldEdges: number;
  /** Arêtes partagées par 2 triangles parcourues dans le même sens (orientation incohérente). */
  readonly misorientedEdges: number;
  /** Triangles dont deux sommets se confondent après soudure. */
  readonly degenerateTriangles: number;
}

/**
 * Vérifie qu'un maillage est une variété fermée orientée : après soudure des positions
 * (arrondi à `weldTolerance` mm), chaque arête est partagée par exactement 2 triangles qui la
 * parcourent en sens opposés.
 *
 * Soudure par arrondi sur une grille de pas `weldTolerance` : deux sommets très proches mais de
 * part et d'autre d'une frontière de la grille ne sont pas soudés (faux bord signalé). Les
 * constructeurs du package calculent les sommets partagés par la même expression, donc à
 * l'identique : sans conséquence pour eux.
 */
export function checkManifold(mesh: Mesh, weldTolerance = 1e-3): ManifoldReport {
  if (!(weldTolerance > 0) || !Number.isFinite(weldTolerance)) {
    throw new RangeError(`tolérance de soudure invalide : ${weldTolerance}`);
  }
  const p = mesh.positions;
  const nv = p.length / 3;
  const weld = new Uint32Array(nv);
  const keys = new Map<string, number>();
  const inv = 1 / weldTolerance;
  for (let v = 0; v < nv; v++) {
    const key = `${Math.round(p[3 * v]! * inv)},${Math.round(p[3 * v + 1]! * inv)},${Math.round(p[3 * v + 2]! * inv)}`;
    let id = keys.get(key);
    if (id === undefined) {
      id = keys.size;
      keys.set(key, id);
    }
    weld[v] = id;
  }
  const n = keys.size;
  // Arête non orientée (min, max) → solde des sens (+1 si min→max, −1 sinon) et compte.
  const count = new Map<number, number>();
  const balance = new Map<number, number>();
  let degenerate = 0;
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]!]!, b = weld[idx[t + 1]!]!, c = weld[idx[t + 2]!]!;
    if (a === b || b === c || c === a) {
      degenerate++;
      continue;
    }
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const key = u < v ? u * n + v : v * n + u;
      count.set(key, (count.get(key) ?? 0) + 1);
      balance.set(key, (balance.get(key) ?? 0) + (u < v ? 1 : -1));
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  let misoriented = 0;
  for (const [key, c] of count) {
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
    else if (balance.get(key) !== 0) misoriented++;
  }
  return {
    ok: boundary === 0 && nonManifold === 0 && misoriented === 0 && degenerate === 0,
    weldedVertices: n,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    misorientedEdges: misoriented,
    degenerateTriangles: degenerate,
  };
}
