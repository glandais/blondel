/**
 * Échappée (CHALLENGE G4, décision Q4 : mesure **verticale** au-dessus de la ligne de pente).
 *
 * Plafond (MVP) : sous-face de la dalle haute, z_p = H − `upperSlabThickness`, partout **hors**
 * de la trémie (le bord de la trémie appartient à la trémie). Les trémies sont dans le repère du
 * site, comme le tracé (placement de l'escalier déjà appliqué par `computeLayout`). Poutres,
 * obstacles et auto-recouvrement (hélicoïdal, U superposé) : jalon 5.
 *
 * 1. **Échappée réglementaire, exacte sur Γ** : e(s) = z_p − z(s) aux points de Γ sous la dalle.
 *    z(s) est croissante (ligne de pente par les nez, `profile.ts`) et le plafond est constant :
 *    sur chaque intervalle de Γ sous la dalle, le minimum est atteint à sa borne haute, qui est
 *    soit un point où Γ entre dans la trémie (intersection analytique de Γ, droites et arcs,
 *    avec les côtés de la trémie), soit l'arrivée. Aucun échantillonnage.
 * 2. **Échappée sur la largeur des marches** : e_k = z_p − z_k sur chaque segment de nez
 *    Q_k R_k dont une partie est sous la dalle ; minimum sur k. Donnée pour avertissement
 *    (objectif du pivot K8) ; ce n'est pas la grandeur réglementaire.
 */
import { cumulativeLengths, curveLength, curvePointAt } from "../geom2d/curve.js";
import { intersectLineCurve, segmentIntersect } from "../geom2d/intersect.js";
import { ensureCCW, pointInPolygon } from "../geom2d/polygon.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { HeadroomOnWidth, Layout, NosingLine, Stepping } from "../model/derived.js";
import type { Curve2, Mm, Polygon2, Vec2, Vec3 } from "../model/primitives.js";
import type { Opening, Site } from "../model/project.js";
import { slopeProfileOf, slopeZ, type SlopeProfile } from "./profile.js";

/** Échappée réglementaire sur la ligne de foulée. */
export interface HeadroomOnWalkline {
  readonly min: Mm;
  /** Point de la ligne de pente (x, y sur Γ, z = altitude de la ligne de pente). */
  readonly at: Vec3;
  /** Abscisse du point critique sur Γ. */
  readonly s: Mm;
}

export interface HeadroomAnalysis {
  /** Altitude de la sous-face de la dalle haute (plafond hors trémie). */
  readonly ceiling: Mm;
  /** Contour de la trémie (CCW, repère du site). */
  readonly opening: Polygon2;
  /** Intervalles d'abscisse de Γ situés sous la dalle (hors trémie). */
  readonly covered: readonly { readonly s0: Mm; readonly s1: Mm }[];
  /** Échappée sur Γ ; absente si aucun point de Γ n'est sous la dalle. */
  readonly walkline?: HeadroomOnWalkline;
  /** Échappée sur la largeur des marches ; absente si aucun nez n'est sous la dalle. */
  readonly width?: HeadroomOnWidth;
}

/** Contour CCW de la trémie, ou `null` sans trémie. */
export function openingPolygon(opening: Opening | undefined): Polygon2 | null {
  if (!opening) return null;
  if (opening.kind === "rect") {
    const { x, y, sizeX, sizeY } = opening;
    return [
      { x, y },
      { x: x + sizeX, y },
      { x: x + sizeX, y: y + sizeY },
      { x, y: y + sizeY },
    ];
  }
  return ensureCCW(opening.points.map((p) => ({ x: p.x, y: p.y })));
}

/** Altitude du plafond (sous-face de la dalle haute). */
export function ceilingOf(site: Site): Mm {
  return site.floorToFloor - site.upperSlabThickness;
}

const isUnderSlab = (p: Vec2, opening: Polygon2): boolean =>
  pointInPolygon(p, opening) === "outside";

/**
 * Intervalles de la courbe situés **hors** du polygone (sous la dalle), bornes comprises aux
 * points d'entrée et de sortie. Les coupures sont les intersections analytiques de la courbe
 * avec les côtés du polygone et les jonctions de la courbe ; chaque morceau est classé par son
 * milieu (un point du bord compte dans la trémie).
 */
export function coveredIntervals(
  curve: Curve2,
  opening: Polygon2,
): { readonly s0: Mm; readonly s1: Mm }[] {
  const L = curveLength(curve);
  if (!(L > 0)) return [];
  const cuts: Mm[] = [0, L, ...cumulativeLengths(curve)];
  const m = opening.length;
  for (let i = 0; i < m; i++) {
    const a = opening[i]!;
    const b = opening[(i + 1) % m]!;
    const dir = V.sub(b, a);
    const len = V.norm(dir);
    if (!(len > GEOM_EPS)) continue;
    const tol = GEOM_EPS / len;
    for (const hit of intersectLineCurve({ origin: a, dir }, curve)) {
      if (hit.t >= -tol && hit.t <= 1 + tol) cuts.push(hit.s);
    }
  }
  const sorted = cuts.filter((s) => s >= 0 && s <= L).sort((x, y) => x - y);
  const out: { s0: Mm; s1: Mm }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const s0 = sorted[i]!;
    const s1 = sorted[i + 1]!;
    if (!(s1 - s0 > GEOM_EPS)) continue;
    if (!isUnderSlab(curvePointAt(curve, (s0 + s1) / 2), opening)) continue;
    const last = out[out.length - 1];
    if (last && s0 - last.s1 <= GEOM_EPS) last.s1 = s1;
    else out.push({ s0, s1 });
  }
  return out;
}

/** Échappée exacte sur Γ (minimum aux bornes hautes des intervalles sous la dalle). */
export function headroomOnWalkline(
  walkline: Curve2,
  profile: SlopeProfile,
  ceiling: Mm,
  covered: readonly { readonly s0: Mm; readonly s1: Mm }[],
): HeadroomOnWalkline | undefined {
  let best: HeadroomOnWalkline | undefined;
  for (const { s1 } of covered) {
    // Borne haute exclue de l'intervalle (point de la trémie) : limite à gauche de z.
    const z = slopeZ(profile, s1, "left");
    const min = ceiling - z;
    if (best === undefined || min < best.min) {
      const p = curvePointAt(walkline, s1);
      best = { min, at: { x: p.x, y: p.y, z }, s: s1 };
    }
  }
  return best;
}

/** Échappée sur la largeur des marches : segments de nez Q_k R_k sous la dalle. */
export function headroomOnWidth(
  nosings: readonly NosingLine[],
  ceiling: Mm,
  opening: Polygon2,
): HeadroomOnWidth | undefined {
  let best: HeadroomOnWidth | undefined;
  const m = opening.length;
  for (const nosing of nosings) {
    const { q, r } = nosing;
    const length = V.distance(q, r);
    if (!(length > GEOM_EPS)) continue;
    const cuts: number[] = [0, 1];
    for (let i = 0; i < m; i++) {
      const hit = segmentIntersect(q, r, opening[i]!, opening[(i + 1) % m]!);
      if (hit) cuts.push(hit.t);
    }
    cuts.sort((x, y) => x - y);
    let at: Vec2 | undefined;
    for (let i = 0; i + 1 < cuts.length && at === undefined; i++) {
      const u0 = cuts[i]!;
      const u1 = cuts[i + 1]!;
      if (!((u1 - u0) * length > GEOM_EPS)) continue;
      if (!isUnderSlab(V.lerp(q, r, (u0 + u1) / 2), opening)) continue;
      // Point le plus proche de la trémie : le bord de dalle s'il existe.
      const u = u1 < 1 ? u1 : u0 > 0 ? u0 : (u0 + u1) / 2;
      at = V.lerp(q, r, u);
    }
    if (at === undefined) continue;
    const min = ceiling - nosing.z;
    if (best === undefined || min < best.min) {
      best = { min, at: { x: at.x, y: at.y, z: nosing.z }, nosing: nosing.index };
    }
  }
  return best;
}

/**
 * Échappée d'un escalier : `null` sans trémie (escalier extérieur ou sans plancher au-dessus).
 * Le découpage doit être complet (nez et marches).
 */
export function computeHeadroom(
  site: Site,
  layout: Layout,
  stepping: Stepping,
): HeadroomAnalysis | null {
  const opening = openingPolygon(site.opening);
  if (!opening) return null;
  const ceiling = ceilingOf(site);
  const profile = slopeProfileOf(stepping);
  const covered = coveredIntervals(layout.walkline, opening);
  const walkline = headroomOnWalkline(layout.walkline, profile, ceiling, covered);
  const width = headroomOnWidth(stepping.nosings, ceiling, opening);
  return {
    ceiling,
    opening,
    covered,
    ...(walkline ? { walkline } : {}),
    ...(width ? { width } : {}),
  };
}
