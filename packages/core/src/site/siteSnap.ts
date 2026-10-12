/**
 * Accroches des gestes sur le site (ADR-0010, plan F §D, sous-lot 5a) : candidats propres au
 * projet (sommets de trémie, extrémités et coins des murs, côtés et nus), index du calque et du
 * site **sans l'élément glissé**, directions d'équerre, accroche d'une extrémité de mur et d'une
 * translation (mur ou trémie). Projections pures, sans DOM : l'interface ne fait que les appeler.
 */
import { openingPolygon } from "../headroom/headroom.js";
import type { CurveSeg, Mm, Vec2 } from "../model/primitives.js";
import type { Project, Wall } from "../model/project.js";
import {
  buildSnapIndex,
  snapPoint,
  snapRightAngle,
  type SnapCandidate,
  type SnapHit,
  type SnapIndex,
} from "./snap.js";
import { underlaySegments } from "./underlay.js";

/**
 * Contour d'un mur (rectangle autour de son axe) : nu gauche de `a` à `b`, puis nu droit de `b`
 * à `a` (gauche : côté gauche de l'axe parcouru de `a` vers `b`).
 */
export function wallOutline(w: Wall): Vec2[] {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * (w.thickness / 2);
  const ny = (dx / L) * (w.thickness / 2);
  return [
    { x: w.a.x + nx, y: w.a.y + ny },
    { x: w.b.x + nx, y: w.b.y + ny },
    { x: w.b.x - nx, y: w.b.y - ny },
    { x: w.a.x - nx, y: w.a.y - ny },
  ];
}

/** Points d'accroche propres au projet : sommets de trémie, extrémités des murs, tracé en cours. */
export function projectSnapPoints(project: Project, draft: readonly Vec2[] = []): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const opening = openingPolygon(project.site.opening);
  if (opening) for (const p of opening) out.push({ point: p, kind: "point" });
  for (const w of project.site.walls) {
    out.push({ point: w.a, kind: "point" }, { point: w.b, kind: "point" });
    for (const p of wallOutline(w)) out.push({ point: p, kind: "endpoint" });
  }
  for (const p of draft) out.push({ point: p, kind: "point" });
  return out;
}

/** Segments d'accroche propres au projet : côtés de la trémie et nus des murs. */
export function projectSnapSegments(project: Project): CurveSeg[] {
  const segs: CurveSeg[] = [];
  const ring = (pts: readonly Vec2[]) => {
    for (let i = 0; i < pts.length; i++) {
      segs.push({ kind: "line", a: pts[i]!, b: pts[(i + 1) % pts.length]! });
    }
  };
  const opening = openingPolygon(project.site.opening);
  if (opening) ring(opening);
  for (const w of project.site.walls) ring(wallOutline(w));
  return segs;
}

/** Élément glissé, exclu des accroches : la trémie, ou le mur `id`. */
export type SiteSnapExclude =
  { readonly kind: "opening" } | { readonly kind: "wall"; readonly id: string };

/**
 * Accroches d'un geste sur le site : index du calque DXF et du site sans l'élément glissé,
 * directions d'équerre (axe x du site, directions des autres murs).
 */
export interface SiteSnapContext {
  readonly index: SnapIndex;
  readonly directions: readonly Vec2[];
}

/** Contexte d'accroche d'un geste (construit une fois par geste). */
export function siteSnapContext(project: Project, exclude: SiteSnapExclude): SiteSnapContext {
  const site = project.site;
  const others: Project =
    exclude.kind === "opening"
      ? { ...project, site: withoutOpening(site) }
      : { ...project, site: { ...site, walls: site.walls.filter((w) => w.id !== exclude.id) } };
  const dxf = site.underlay?.dxf;
  const index = buildSnapIndex(
    [...(dxf ? underlaySegments(dxf) : []), ...projectSnapSegments(others)],
    projectSnapPoints(others),
  );
  const directions: Vec2[] = [{ x: 1, y: 0 }];
  for (const w of others.site.walls) directions.push({ x: w.b.x - w.a.x, y: w.b.y - w.a.y });
  return { index, directions };
}

function withoutOpening(site: Project["site"]): Project["site"] {
  const { opening: _o, ...rest } = site;
  return rest;
}

/** Accroche d'une extrémité de mur : sur un point d'accroche, ou à l'équerre de l'autre bout. */
export type WallEndSnap =
  | { readonly kind: "point"; readonly hit: SnapHit; readonly point: Vec2 }
  | { readonly kind: "square"; readonly point: Vec2 };

/**
 * Extrémité de mur visée en `point`, l'autre extrémité en `fixed` : accroche d'un point du
 * contexte (`snapPoint`) en priorité, sinon équerre de `fixed` sur une direction du contexte ou
 * sa perpendiculaire (`snapRightAngle`) ; `null` sans accroche dans `radius` (mm).
 */
export function snapWallEnd(
  ctx: SiteSnapContext,
  fixed: Vec2,
  point: Vec2,
  radius: Mm,
): WallEndSnap | null {
  const hit = snapPoint(ctx.index, point, radius);
  if (hit) return { kind: "point", hit, point: hit.point };
  const square = snapRightAngle(fixed, point, ctx.directions, radius);
  return square ? { kind: "square", point: square.point } : null;
}

/** Translation accrochée : vecteur retenu et accroche (absente : vecteur demandé). */
export interface TranslationSnap {
  readonly delta: Vec2;
  readonly hit: SnapHit | null;
}

/**
 * Translation `delta` de l'élément aux sommets `vertices` (mur : ses extrémités ; trémie : ses
 * sommets) : parmi les sommets translatés qui tombent à moins de `radius` d'une accroche, le plus
 * proche fixe le vecteur (il est amené exactement sur l'accroche).
 */
export function snapTranslation(
  ctx: SiteSnapContext,
  vertices: readonly Vec2[],
  delta: Vec2,
  radius: Mm,
): TranslationSnap {
  let best: { delta: Vec2; hit: SnapHit } | null = null;
  for (const v of vertices) {
    const hit = snapPoint(ctx.index, { x: v.x + delta.x, y: v.y + delta.y }, radius);
    if (hit && (best === null || hit.distance < best.hit.distance)) {
      best = { delta: { x: hit.point.x - v.x, y: hit.point.y - v.y }, hit };
    }
  }
  return best ?? { delta, hit: null };
}
