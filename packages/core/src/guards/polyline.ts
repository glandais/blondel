/**
 * Outils de polyligne plane pour les lignes de garde-corps : abscisses, points, sous-polylignes,
 * projection et décalage à onglet (les bords simplifiés des escaliers à 90° n'ont que des
 * virages modérés).
 */
import { segmentIntersect } from "../geom2d/intersect.js";
import * as V from "../geom2d/vec.js";
import type { Mm, Vec2 } from "../model/primitives.js";

export const POLY_EPS = 1e-6;

/** Abscisses cumulées des sommets. */
export function cumulative(pts: readonly Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + V.distance(pts[i - 1]!, pts[i]!));
  return out;
}

/** Retire les sommets confondus consécutifs. */
export function dedupe(pts: readonly Vec2[], tol = POLY_EPS): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || V.distance(last, p) > tol) out.push(p);
  }
  return out;
}

/** Indice du segment contenant l'abscisse s (bornée). */
function segmentIndex(cum: readonly number[], s: Mm): number {
  const n = cum.length - 1;
  if (n <= 0) return 0;
  for (let i = 0; i < n; i++) if (s <= cum[i + 1]! + POLY_EPS) return i;
  return n - 1;
}

/** Point à l'abscisse s (bornée aux extrémités). */
export function pointAt(pts: readonly Vec2[], cum: readonly number[], s: Mm): Vec2 {
  if (pts.length === 1) return pts[0]!;
  const i = segmentIndex(cum, s);
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const len = cum[i + 1]! - cum[i]!;
  const t = len > 0 ? Math.min(1, Math.max(0, (s - cum[i]!) / len)) : 0;
  return V.lerp(a, b, t);
}

/** Tangente unitaire à l'abscisse s. */
export function tangentAt(pts: readonly Vec2[], cum: readonly number[], s: Mm): Vec2 {
  const i = segmentIndex(cum, s);
  return V.normalize(V.sub(pts[i + 1]!, pts[i]!));
}

/** Projection d'un point : abscisse et distance du point le plus proche. */
export function project(
  pts: readonly Vec2[],
  cum: readonly number[],
  p: Vec2,
): { s: Mm; distance: Mm; point: Vec2 } {
  let best = { s: 0, distance: Infinity, point: pts[0]! };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const d = V.sub(pts[i + 1]!, a);
    const len2 = V.dot(d, d);
    const t = len2 > 0 ? Math.min(1, Math.max(0, V.dot(V.sub(p, a), d) / len2)) : 0;
    const q = V.addScaled(a, d, t);
    const dist = V.distance(p, q);
    if (dist < best.distance - POLY_EPS) {
      best = { s: cum[i]! + t * Math.sqrt(len2), distance: dist, point: q };
    }
  }
  return best;
}

/**
 * Sous-polyligne entre les abscisses a < b, avec les sommets d'origine intérieurs et des
 * sommets supplémentaires aux abscisses `extra` (dans ]a ; b[). Rend les points et leurs
 * abscisses d'origine.
 */
export function slice(
  pts: readonly Vec2[],
  cum: readonly number[],
  a: Mm,
  b: Mm,
  extra: readonly Mm[] = [],
): { points: Vec2[]; s: number[] } {
  const stations = new Set<number>([a, b]);
  for (let i = 0; i < cum.length; i++) if (cum[i]! > a && cum[i]! < b) stations.add(cum[i]!);
  for (const e of extra) if (e > a && e < b) stations.add(e);
  const sorted = [...stations].sort((x, y) => x - y);
  const s: number[] = [];
  for (const v of sorted) if (s.length === 0 || v - s[s.length - 1]! > 1e-3) s.push(v);
  if (s.length === 1) s.push(b);
  // Les sommets d'origine sont gardés à leur position exacte (évite les coins arrondis).
  return { points: s.map((v) => pointAt(pts, cum, v)), s };
}

/**
 * Décalage à onglet d'une polyligne de `d` (d > 0 : à gauche du sens de parcours). Sommets
 * alignés : décalage normal ; onglet borné à 4 d (virages très aigus).
 */
export function offset(pts: readonly Vec2[], d: Mm): Vec2[] {
  const n = pts.length;
  if (n < 2 || d === 0) return pts.slice();
  const dirs: Vec2[] = [];
  for (let i = 0; i + 1 < n; i++) dirs.push(V.normalize(V.sub(pts[i + 1]!, pts[i]!)));
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = dirs[Math.max(0, i - 1)]!;
    const next = dirs[Math.min(dirs.length - 1, i)]!;
    const nPrev = V.perpLeft(prev);
    const nNext = V.perpLeft(next);
    const bis = V.add(nPrev, nNext);
    const bl = V.norm(bis);
    if (bl < 1e-9) {
      out.push(V.addScaled(pts[i]!, nNext, d));
      continue;
    }
    const u = V.scale(bis, 1 / bl);
    const cos = V.dot(u, nNext);
    const k = Math.min(4, 1 / Math.max(cos, 0.25));
    out.push(V.addScaled(pts[i]!, u, d * k));
  }
  return out;
}

/**
 * Décalage à onglet (`offset`) **sans rebroussement** : du côté concave d'un angle dont les
 * segments voisins (arc facetté) sont plus courts que le décalage, les sommets décalés dépassent
 * l'angle puis reviennent, et le balayage de la main courante y fait un onglet démesuré. Les
 * segments décalés de sens opposé à leur segment d'origine sont retirés et leurs voisins
 * valides raccordés à l'intersection de leurs droites (coupe du sommet concave). Extrémités
 * conservées ; polyligne inchangée si tout est inversé.
 */
export function offsetTrimmed(pts: readonly Vec2[], d: Mm): Vec2[] {
  let src = pts.slice();
  let off = offset(src, d);
  for (let guard = 0; guard < pts.length; guard++) {
    const m = src.length - 1;
    const inverted = (k: number): boolean =>
      V.dot(V.sub(off[k + 1]!, off[k]!), V.sub(src[k + 1]!, src[k]!)) <= 0;
    let k0 = -1;
    for (let k = 1; k < m - 1; k++) {
      if (inverted(k)) {
        k0 = k;
        break;
      }
    }
    if (k0 < 0) return off;
    let k1 = k0;
    while (k1 + 1 < m - 1 && inverted(k1 + 1)) k1++;
    // Voisins valides : segments k0 − 1 et k1 + 1 ; leurs droites se coupent au sommet
    // concave décalé.
    const a1 = off[k0 - 1]!;
    const a2 = off[k0]!;
    const b1 = off[k1 + 1]!;
    const b2 = off[k1 + 2]!;
    const da = V.sub(a2, a1);
    const db = V.sub(b2, b1);
    const den = V.cross(da, db);
    const joint =
      Math.abs(den) > 1e-12
        ? V.addScaled(a1, da, V.cross(V.sub(b1, a1), db) / den)
        : V.lerp(a2, b1, 0.5);
    // Sommets d'origine k0 … k1 + 1 fusionnés en un seul (le sommet de la coupe) ; on recommence
    // (la coupe peut en révéler une autre).
    src = [...src.slice(0, k0), src[k0]!, ...src.slice(k1 + 2)];
    off = [...off.slice(0, k0), joint, ...off.slice(k1 + 2)];
  }
  return off;
}

/**
 * Décalage d'une polyligne dont certains sommets intérieurs sont de simples **stations**
 * alignées (abscisses de nez, sommets du profil) : seuls les vrais sommets (déviation non
 * nulle) reçoivent un onglet ; chaque station est reportée sur le segment décalé de son
 * segment d'origine, **bornée aux onglets**. Du côté concave d'un angle, les stations situées à
 * moins de `d` (environ) de l'angle retombent ainsi sur l'onglet au lieu de produire un
 * rebroussement ; les points confondus sont fusionnés.
 *
 * Rend les points décalés, et pour chaque point d'entrée l'indice du point de sortie qui le
 * représente (`group`) et s'il s'agit d'un vrai sommet (`corner`). `null` : un segment
 * d'origine disparaît entièrement (décalage plus grand que ce que permet l'angle, p. ex. jour
 * plus étroit que deux décalages).
 */
export function offsetStations(
  pts: readonly Vec2[],
  d: Mm,
): { points: Vec2[]; group: number[]; corner: boolean[] } | null {
  const n = pts.length;
  const corner = pts.map((_, i) => i === 0 || i === n - 1 || turnAngleDeg(pts, i) > 1e-4);
  if (n < 2 || d === 0) return { points: pts.slice(), group: pts.map((_, i) => i), corner };
  const cornerIdx: number[] = [];
  corner.forEach((c, i) => {
    if (c) cornerIdx.push(i);
  });
  const skeleton = cornerIdx.map((i) => pts[i]!);
  const off = offset(skeleton, d);
  const raw: Vec2[] = new Array<Vec2>(n);
  for (let k = 0; k + 1 < cornerIdx.length; k++) {
    const i0 = cornerIdx[k]!;
    const i1 = cornerIdx[k + 1]!;
    const pa = pts[i0]!;
    const len = V.distance(pa, pts[i1]!);
    const dir = V.normalize(V.sub(pts[i1]!, pa));
    const oa = off[k]!;
    const ob = off[k + 1]!;
    const along = V.dot(V.sub(ob, oa), dir);
    const first = k === 0;
    const lastSeg = k + 2 === cornerIdx.length;
    if (along < -POLY_EPS && len > POLY_EPS) {
      // Segment décalé renversé (plus court que le retrait de l'onglet). Extrémité libre : le
      // segment est absorbé par l'onglet voisin (le chemin s'arrête à l'onglet) ; segment
      // intérieur : décalage impossible.
      if (!first && !lastSeg) return null;
      const keep = first ? ob : oa;
      for (let j = i0; j <= i1; j++) raw[j] = keep;
      continue;
    }
    raw[i0] = oa;
    raw[i1] = ob;
    const shift = V.dot(V.sub(V.addScaled(pa, V.perpLeft(dir), d), oa), dir);
    for (let j = i0 + 1; j < i1; j++) {
      const t = V.dot(V.sub(pts[j]!, pa), dir) + shift;
      raw[j] = along > POLY_EPS ? V.lerp(oa, ob, Math.min(1, Math.max(0, t / along))) : oa;
    }
  }
  const points: Vec2[] = [];
  const group: number[] = [];
  for (let j = 0; j < n; j++) {
    const p = raw[j]!;
    const last = points[points.length - 1];
    if (last && V.distance(last, p) < 1e-3) group.push(points.length - 1);
    else {
      points.push(p);
      group.push(points.length - 1);
    }
  }
  return { points, group, corner };
}

/** Déviation (degrés, valeur absolue) de la polyligne au sommet intérieur i. */
export function turnAngleDeg(pts: readonly Vec2[], i: number): number {
  if (i <= 0 || i >= pts.length - 1) return 0;
  const a = V.normalize(V.sub(pts[i]!, pts[i - 1]!));
  const b = V.normalize(V.sub(pts[i + 1]!, pts[i]!));
  return Math.abs((V.signedAngle(a, b) * 180) / Math.PI);
}

/** Interpolation linéaire par morceaux y(x) sur des abscisses croissantes (bornée). */
export function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  for (let i = 0; i + 1 < n; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (x <= x1) {
      const t = x1 > x0 ? (x - x0) / (x1 - x0) : 1;
      return ys[i]! + t * (ys[i + 1]! - ys[i]!);
    }
  }
  return ys[n - 1]!;
}
