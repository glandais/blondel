/**
 * Côtés de l'escalier pour les garde-corps : bord simplifié, portions vides / murs, profil de
 * la ligne des nez le long du bord.
 *
 * - **Bord intérieur** : C_i (jour) mis en polyligne ; le contour d'un poteau d'angle (`newel`)
 *   est remplacé par le coin intérieur K (la ligne de garde-corps s'arrête sur le poteau, qui en
 *   tient lieu). **Bord extérieur** : C_e.
 * - **Hélicoïdal à fût central** : le bord intérieur longe le fût (pas de vide) : aucune portion,
 *   donc ni garde-corps ni main courante murale de ce côté (`isColumnSide`). À jour central, le
 *   bord intérieur est traité comme un jour.
 * - **Côté vide** : à gauche du bord intérieur si `Layout.innerSide = "left"`, à droite sinon ;
 *   l'inverse pour le bord extérieur.
 * - **Murs** (convention : `a`–`b` = axe, nus à ± épaisseur / 2) : une portion de bord est côté
 *   mur si un mur lui est parallèle (écart angulaire ≤ `WALL_PARALLEL_DEG`), du côté vide, et si
 *   son nu est à au plus `wallTolerance` du bord. Les portions restantes sont vides.
 * - **Profil de référence** (hauteurs « à la verticale du nez ») : les nez k (Q_k côté jour,
 *   R_k côté mur) sont projetés sur le bord (abscisse u_k, rendue croissante) ; la ligne des nez
 *   z(u) est affine entre nez successifs, horizontale sur un palier jusqu'à un giron (mesuré sur
 *   le bord) avant le nez suivant.
 */
import { flattenCurve } from "../geom2d/curve.js";
import { newelReach, newelSetback } from "../layout/newel.js";
import * as V from "../geom2d/vec.js";
import type { Layout, Stepping } from "../model/derived.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import type { Project, Wall } from "../model/project.js";
import { cumulative, dedupe, interp, project as projectOn, POLY_EPS } from "./polyline.js";
import type { GuardSideMode, GuardsSpec } from "./spec.js";
import type { SideAnalysis, SideInterval, StairSide } from "./types.js";

/**
 * Écart angulaire maximal (degrés) entre un mur et un bord pour qu'il le « longe ». Tolérance
 * géométrique de détection (pas une règle métier) ; à valider avec les relevés réels.
 */
export const WALL_PARALLEL_DEG = 5;

/** Bord d'un côté, prêt pour les garde-corps. */
export interface SideEdge {
  readonly side: StairSide;
  readonly points: readonly Vec2[];
  readonly cum: readonly number[];
  /** +1 : vide à gauche du sens de montée ; −1 : à droite. */
  readonly voidSign: 1 | -1;
  /** Abscisse u_k de chaque nez sur le bord (croissante). */
  readonly nosingU: readonly Mm[];
  /**
   * Nez qui partagent leur abscisse avec un autre (lignes de nez aboutissant sur un poteau
   * d'angle, ou projection rabattue) : ils ne sont pas sous une travée de garde-corps et sont
   * exclus des hauteurs « à la verticale du nez ».
   */
  readonly atPost: readonly boolean[];
  /** Profil de la ligne des nez : sommets (u, z). */
  readonly profileU: readonly Mm[];
  readonly profileZ: readonly Mm[];
  /** Sommets du bord qui sont des poteaux d'angle du tracé (côté du carré, indice du tournant). */
  readonly newels: readonly { readonly u: Mm; readonly size: Mm; readonly turn: number }[];
}

/** Bord simplifié et profil d'un côté. */
export function sideEdge(
  side: StairSide,
  layout: Layout,
  stepping: Stepping,
  project: Project,
): SideEdge {
  const curve = side === "inner" ? layout.inner : layout.outer;
  let pts = dedupe(flattenCurve(curve, 0.5));
  const newelCorners: { k: Vec2; size: number; reach: number; turn: number }[] = [];
  if (side === "inner") {
    project.stair.layout.turns.forEach((t, i) => {
      const zone = layout.turns[i];
      if (t.inner.kind === "newel" && zone)
        newelCorners.push({
          k: zone.innerCorner,
          // Poteau décalé vers le jour : côté équivalent d'un poteau centré qui le couvre
          // côté vide (2 × débord côté jour), pour l'emprise vue par les garde-corps.
          size: 2 * newelSetback(t.inner),
          reach: newelReach(t.inner),
          turn: i,
        });
    });
    for (const { k, reach } of newelCorners) {
      const r = reach + 1e-6;
      const out: Vec2[] = [];
      let replaced = false;
      for (const p of pts) {
        if (V.distance(p, k) <= r) {
          if (!replaced) out.push(k);
          replaced = true;
        } else out.push(p);
      }
      pts = dedupe(out);
    }
  }
  const cum = cumulative(pts);
  const innerLeft = layout.innerSide === "left";
  const voidSign: 1 | -1 = (side === "inner") === innerLeft ? 1 : -1;

  const nosingU: number[] = [];
  let last = 0;
  for (const n of stepping.nosings) {
    const u = Math.max(last, projectOn(pts, cum, side === "inner" ? n.q : n.r).s);
    nosingU.push(u);
    last = u;
  }
  const profileU: number[] = [];
  const profileZ: number[] = [];
  const nos = stepping.nosings;
  const landing = new Set(stepping.treads.filter((t) => t.kind === "landing").map((t) => t.number));
  for (let k = 0; k < nos.length; k++) {
    profileU.push(nosingU[k]!);
    profileZ.push(nos[k]!.z);
    // Marche k + 1 entre les nez k et k + 1 : palier → horizontale puis montée sur un giron.
    if (k + 1 < nos.length && landing.has(k + 1)) {
      const next = nosingU[k + 1]!;
      const going = k + 2 < nos.length ? nosingU[k + 2]! - next : 0;
      const flatEnd = Math.max(nosingU[k]!, next - going);
      if (flatEnd > nosingU[k]! + POLY_EPS && flatEnd < next - POLY_EPS) {
        profileU.push(flatEnd);
        profileZ.push(nos[k]!.z);
      }
    }
  }
  const atPost = nosingU.map(
    (u, k) =>
      (k > 0 && Math.abs(u - nosingU[k - 1]!) < 1e-3) ||
      (k + 1 < nosingU.length && Math.abs(u - nosingU[k + 1]!) < 1e-3),
  );
  const newels = newelCorners
    .map(({ k, size, turn }) => {
      const pr = projectOn(pts, cum, k);
      return pr.distance < 1e-3 ? { u: pr.s, size, turn } : null;
    })
    .filter((x): x is { u: number; size: number; turn: number } => x !== null);
  return { side, points: pts, cum, voidSign, nosingU, atPost, profileU, profileZ, newels };
}

/**
 * Niveau de la ligne des nez au point d'abscisse u du bord. Là où plusieurs nez ont la même
 * abscisse (poteau d'angle), `before` rend le plus bas (fin de la travée qui arrive au poteau),
 * `after` le plus haut (début de la travée qui en repart).
 */
export function refAt(edge: SideEdge, u: Mm, limit: "before" | "after" = "after"): Mm {
  const us = edge.profileU;
  const same: number[] = [];
  for (let i = 0; i < us.length; i++) if (Math.abs(us[i]! - u) < 1e-6) same.push(i);
  if (same.length > 0)
    return edge.profileZ[limit === "before" ? same[0]! : same[same.length - 1]!]!;
  return interp(us, edge.profileZ, u);
}

/** Couverture d'un segment [p, q] par un mur : intervalle de paramètre (mm) ou null. */
export function wallCover(
  p: Vec2,
  q: Vec2,
  wall: Wall,
  tolerance: Mm,
  /** +1 / −1 : côté où le mur doit se trouver (gauche / droite du segment) ; 0 : indifférent. */
  sideSign: -1 | 0 | 1,
): { from: Mm; to: Mm; faceDistance: Mm } | null {
  const len = V.distance(p, q);
  const wl = V.distance(wall.a, wall.b);
  if (len < POLY_EPS || wl < POLY_EPS) return null;
  const d = V.scale(V.sub(q, p), 1 / len);
  const wd = V.scale(V.sub(wall.b, wall.a), 1 / wl);
  if (Math.abs(V.cross(d, wd)) > Math.sin((WALL_PARALLEL_DEG * Math.PI) / 180)) return null;
  // Distance (signée, gauche > 0) de l'axe du mur à la droite du segment, au milieu du mur.
  const mid = V.lerp(wall.a, wall.b, 0.5);
  const signed = V.cross(d, V.sub(mid, p));
  if (sideSign !== 0 && signed * sideSign < 0) return null;
  const face = Math.abs(signed) - wall.thickness / 2;
  if (face > tolerance || face < -wall.thickness / 2 - POLY_EPS) return null;
  const t0 = V.dot(V.sub(wall.a, p), d);
  const t1 = V.dot(V.sub(wall.b, p), d);
  const from = Math.max(0, Math.min(t0, t1));
  const to = Math.min(len, Math.max(t0, t1));
  if (to - from < 1) return null;
  return { from, to, faceDistance: Math.max(0, face) };
}

interface Cover {
  from: Mm;
  to: Mm;
  wallId: string;
  face: Mm;
}

/** Portions vides / murs d'un bord. */
export function sideIntervals(
  edge: SideEdge,
  mode: GuardSideMode,
  walls: readonly Wall[],
  spec: GuardsSpec,
): SideInterval[] {
  const total = edge.cum[edge.cum.length - 1] ?? 0;
  if (total <= 0) return [];
  if (mode === "void") return [{ from: 0, to: total, kind: "void" }];
  if (mode === "wall") return [{ from: 0, to: total, kind: "wall", wallFaceDistance: 0 }];
  const covers: Cover[] = [];
  for (let i = 0; i + 1 < edge.points.length; i++) {
    const p = edge.points[i]!;
    const q = edge.points[i + 1]!;
    for (const w of walls) {
      const c = wallCover(p, q, w, spec.wallTolerance, edge.voidSign);
      if (c)
        covers.push({
          from: edge.cum[i]! + c.from,
          to: edge.cum[i]! + c.to,
          wallId: w.id,
          face: c.faceDistance,
        });
    }
  }
  covers.sort((x, y) => x.from - y.from);
  // Union des couvertures (tolérance 1 mm : segments consécutifs d'un même mur).
  const merged: Cover[] = [];
  for (const c of covers) {
    const lastC = merged[merged.length - 1];
    if (lastC && c.from <= lastC.to + 1) {
      lastC.to = Math.max(lastC.to, c.to);
      lastC.face = Math.min(lastC.face, c.face);
    } else merged.push({ ...c });
  }
  const out: SideInterval[] = [];
  let cursor = 0;
  for (const c of merged) {
    if (c.from > cursor + 1) out.push({ from: cursor, to: c.from, kind: "void" });
    out.push({ from: c.from, to: c.to, kind: "wall", wallId: c.wallId, wallFaceDistance: c.face });
    cursor = c.to;
  }
  if (cursor < total - 1) out.push({ from: cursor, to: total, kind: "void" });
  else if (out.length > 0) {
    const l = out[out.length - 1]!;
    out[out.length - 1] = { ...l, to: total };
  }
  return out;
}

/**
 * Hauteur de chute maximale sur les portions vides (nez situés sur une portion vide) ;
 * `include` : filtre facultatif sur le point du bord au droit du nez (emprise d'un jour étroit).
 */
export function sideFall(
  edge: SideEdge,
  intervals: readonly SideInterval[],
  stepping: Stepping,
  lowerFloor: Mm,
  include?: (p: Vec2) => boolean,
): { maxFall: Mm; at?: Vec3 } {
  let maxFall = 0;
  let at: Vec3 | undefined;
  stepping.nosings.forEach((n, k) => {
    const u = edge.nosingU[k]!;
    const inVoid = intervals.some(
      (iv) => iv.kind === "void" && u >= iv.from - 1e-6 && u <= iv.to + 1e-6,
    );
    if (!inVoid) return;
    const p = edge.side === "inner" ? n.q : n.r;
    if (include && !include(p)) return;
    const fall = n.z - lowerFloor;
    if (fall > maxFall) {
      maxFall = fall;
      at = { x: p.x, y: p.y, z: n.z };
    }
  });
  return at ? { maxFall, at } : { maxFall };
}

/** Vrai pour le côté intérieur d'un hélicoïdal à fût central (bord = fût, sans vide). */
export function isColumnSide(side: StairSide, layout: Layout): boolean {
  return side === "inner" && layout.helical?.core === "column";
}

/**
 * Analyse d'un côté (bord, portions, chute). Côté fût d'un hélicoïdal (`isColumnSide`) : aucune
 * portion (ni vide ni mur).
 */
export function analyzeSide(
  side: StairSide,
  layout: Layout,
  stepping: Stepping,
  project: Project,
  spec: GuardsSpec,
): { edge: SideEdge; analysis: SideAnalysis } {
  const edge = sideEdge(side, layout, stepping, project);
  const mode = side === "inner" ? spec.flight.inner : spec.flight.outer;
  // Hélicoïdal à fût central : le côté intérieur longe le fût, qui porte les marches ; il n'y a
  // ni vide (pas de chute, pas de garde-corps) ni mur (pas de main courante murale).
  const intervals = isColumnSide(side, layout)
    ? []
    : sideIntervals(edge, mode, project.site.walls, spec);
  const fall = sideFall(edge, intervals, stepping, 0);
  return {
    edge,
    analysis: {
      side,
      length: edge.cum[edge.cum.length - 1] ?? 0,
      intervals,
      maxFall: fall.maxFall,
      ...(fall.at ? { maxFallAt: fall.at } : {}),
    },
  };
}
