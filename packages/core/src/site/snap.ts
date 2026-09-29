/**
 * Accroches de la saisie assistée (jalon 7) : extrémités, milieux, intersections (et centres
 * d'arcs) des entités du calque DXF, plus des points fournis (sommets de la trémie en cours,
 * extrémités des murs).
 *
 * Les intersections ne sont pas précalculées (O(n²) sur un plan de masse) : l'index est une
 * grille de boîtes englobantes, et `snapPoint` ne croise que les segments proches du curseur.
 * Fonctions pures, sans DOM.
 */
import { intersectSupports } from "../geom2d/intersect.js";
import type { BBox } from "../geom2d/polygon.js";
import { segClosestPoint, segEnd, segLength, segPointAt, segStart } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import type { CurveSeg, Mm, Vec2 } from "../model/primitives.js";
import { isFullCircle, segmentBounds } from "./underlay.js";

export type SnapKind = "endpoint" | "midpoint" | "intersection" | "center" | "point";

export interface SnapCandidate {
  readonly point: Vec2;
  readonly kind: SnapKind;
}

export interface SnapHit extends SnapCandidate {
  /** Distance du point d'accroche au point visé. */
  readonly distance: Mm;
}

/** Ordre de préférence à distance égale. */
const PRIORITY: Readonly<Record<SnapKind, number>> = {
  point: 0,
  endpoint: 1,
  intersection: 2,
  center: 3,
  midpoint: 4,
};

export interface SnapIndex {
  readonly segments: readonly CurveSeg[];
  readonly boxes: readonly BBox[];
  readonly cell: Mm;
  readonly grid: ReadonlyMap<string, readonly number[]>;
  /** Segments trop étendus pour la grille, toujours examinés. */
  readonly wide: readonly number[];
  readonly points: readonly SnapCandidate[];
}

/** Nombre maximal de cellules couvertes par un segment avant de le classer « étendu ». */
const MAX_CELLS_PER_SEGMENT = 4_096;
/** Segments les plus proches croisés deux à deux pour les intersections, au plus. */
const MAX_INTERSECTION_SEGMENTS = 64;

const key = (i: number, j: number): string => `${i},${j}`;

/**
 * Index d'accroche. `cell` : taille de maille (mm) ; défaut : emprise / √n, au moins 1 mm.
 */
export function buildSnapIndex(
  segments: readonly CurveSeg[],
  points: readonly SnapCandidate[] = [],
  cell?: Mm,
): SnapIndex {
  const boxes = segments.map(segmentBounds);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.min.x);
    minY = Math.min(minY, b.min.y);
    maxX = Math.max(maxX, b.max.x);
    maxY = Math.max(maxY, b.max.y);
  }
  const extent = boxes.length > 0 ? Math.max(maxX - minX, maxY - minY) : 1;
  const size = cell ?? Math.max(1, extent / Math.max(1, Math.sqrt(segments.length)));
  const grid = new Map<string, number[]>();
  const wide: number[] = [];
  boxes.forEach((b, idx) => {
    const i0 = Math.floor(b.min.x / size);
    const i1 = Math.floor(b.max.x / size);
    const j0 = Math.floor(b.min.y / size);
    const j1 = Math.floor(b.max.y / size);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS_PER_SEGMENT) {
      wide.push(idx);
      return;
    }
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        const list = grid.get(k);
        if (list) list.push(idx);
        else grid.set(k, [idx]);
      }
    }
  });
  return { segments, boxes, cell: size, grid, wide, points };
}

/** Segments dont la boîte englobante rencontre le carré de demi-côté `radius` autour de `p`. */
export function segmentsNear(index: SnapIndex, p: Vec2, radius: Mm): number[] {
  const found = new Set<number>(index.wide);
  const s = index.cell;
  const i0 = Math.floor((p.x - radius) / s);
  const i1 = Math.floor((p.x + radius) / s);
  const j0 = Math.floor((p.y - radius) / s);
  const j1 = Math.floor((p.y + radius) / s);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS_PER_SEGMENT) {
    index.segments.forEach((_, i) => found.add(i));
  } else {
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const idx of index.grid.get(key(i, j)) ?? []) found.add(idx);
      }
    }
  }
  const out: number[] = [];
  for (const idx of found) {
    const b = index.boxes[idx]!;
    if (
      b.min.x <= p.x + radius &&
      b.max.x >= p.x - radius &&
      b.min.y <= p.y + radius &&
      b.max.y >= p.y - radius
    ) {
      out.push(idx);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Points d'accroche propres à un segment (extrémités, milieu, centre d'un arc). */
export function segmentSnapPoints(seg: CurveSeg): SnapCandidate[] {
  if (seg.kind === "arc") {
    const out: SnapCandidate[] = [{ point: seg.center, kind: "center" }];
    if (isFullCircle(seg)) return out;
    out.push(
      { point: segStart(seg), kind: "endpoint" },
      { point: segEnd(seg), kind: "endpoint" },
      { point: segPointAt(seg, 0.5), kind: "midpoint" },
    );
    return out;
  }
  return [
    { point: seg.a, kind: "endpoint" },
    { point: seg.b, kind: "endpoint" },
    { point: V.lerp(seg.a, seg.b, 0.5), kind: "midpoint" },
  ];
}

/** Tolérance de débord aux extrémités d'un segment, en longueur (mm). */
const INTERSECTION_END_TOLERANCE_MM = 1e-7;

/**
 * Intersections de deux segments bornés (supports coupés dans les deux segments). La tolérance
 * aux extrémités est une longueur, pas une fraction du paramètre : sur un long arc, 1e-9 de
 * paramètre acceptait un point à 1e-6 mm hors du segment (droite quasi tangente à un bout).
 */
export function segmentIntersections(a: CurveSeg, b: CurveSeg): Vec2[] {
  const ta = INTERSECTION_END_TOLERANCE_MM / segLength(a);
  const tb = INTERSECTION_END_TOLERANCE_MM / segLength(b);
  return intersectSupports(a, b)
    .filter((h) => h.ta >= -ta && h.ta <= 1 + ta && h.tb >= -tb && h.tb <= 1 + tb)
    .map((h) => h.point);
}

export interface SnapOptions {
  /** Types d'accroche actifs (tous par défaut). */
  readonly kinds?: readonly SnapKind[];
}

/**
 * Accroche la plus proche de `p` à moins de `radius` (mm), ou `null`. À distance égale, un
 * point fourni l'emporte sur une extrémité, puis une intersection, un centre, un milieu.
 */
export function snapPoint(
  index: SnapIndex,
  p: Vec2,
  radius: Mm,
  options: SnapOptions = {},
): SnapHit | null {
  const active = new Set<SnapKind>(options.kinds ?? (Object.keys(PRIORITY) as SnapKind[]));
  let best: SnapHit | null = null;
  const consider = (c: SnapCandidate): void => {
    if (!active.has(c.kind)) return;
    const d = V.distance(c.point, p);
    if (d > radius) return;
    if (
      best === null ||
      d < best.distance - 1e-9 ||
      (Math.abs(d - best.distance) <= 1e-9 && PRIORITY[c.kind] < PRIORITY[best.kind])
    ) {
      best = { point: c.point, kind: c.kind, distance: d };
    }
  };
  for (const c of index.points) consider(c);
  const near = segmentsNear(index, p, radius);
  for (const i of near) for (const c of segmentSnapPoints(index.segments[i]!)) consider(c);
  if (active.has("intersection") && near.length > 1) {
    // Seuls les segments qui passent à moins de `radius` peuvent porter une intersection utile.
    const close = near
      .map((i) => ({ i, d: V.distance(segClosestPoint(index.segments[i]!, p).point, p) }))
      .filter((x) => x.d <= radius)
      .sort((x, y) => x.d - y.d || x.i - y.i)
      .slice(0, MAX_INTERSECTION_SEGMENTS)
      .map((x) => x.i);
    for (let a = 0; a < close.length; a++) {
      for (let b = a + 1; b < close.length; b++) {
        const sa = index.segments[close[a]!]!;
        const sb = index.segments[close[b]!]!;
        for (const q of segmentIntersections(sa, sb)) consider({ point: q, kind: "intersection" });
      }
    }
  }
  return best;
}
