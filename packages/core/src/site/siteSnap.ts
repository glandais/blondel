/**
 * Accroches des gestes sur le site (ADR-0010, plan F §D, sous-lot 5a) : candidats propres au
 * projet (sommets de trémie, extrémités et coins des murs, côtés et nus), index du calque et du
 * site **sans l'élément glissé**, directions d'équerre, accroche d'une extrémité de mur et d'une
 * translation (mur ou trémie) ; pose d'une baie sur un mur (`wallBayPoint`, `bayCarrier`, sous-lot
 * 5b). Projections pures, sans DOM : l'interface ne fait que les appeler.
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

/**
 * Élément glissé, exclu des accroches : la trémie, ou le mur `id` ; contour de pièce et
 * obstacles (sous-lot 5b) ne portent aucune accroche, rien n'est alors retiré.
 */
export type SiteSnapExclude =
  | { readonly kind: "opening" }
  | { readonly kind: "wall"; readonly id: string }
  | { readonly kind: "room" }
  | { readonly kind: "obstacle"; readonly id: string };

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
      : exclude.kind === "wall"
        ? { ...project, site: { ...site, walls: site.walls.filter((w) => w.id !== exclude.id) } }
        : project;
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

// ------------------------------------------------------------------ Baies sur un mur (sous-lot 5b)

/** Projeté de `p` sur le segment `a`–`b` (extrémités comprises). */
function closestOnAxis(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const L2 = ux * ux + uy * uy;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * ux + (p.y - a.y) * uy) / L2)) : 0;
  return { x: a.x + ux * t, y: a.y + uy * t };
}

/** Point d'une baie (porte, fenêtre) posé sur un mur : projeté sur l'axe du mur `wallId`. */
export interface WallBayPoint {
  readonly wallId: string;
  readonly point: Vec2;
}

/**
 * Pose d'une extrémité de baie sur un mur (outil Obstacle, porte ou fenêtre) : projeté de `point`
 * sur l'axe du mur le plus proche dont le pointeur touche l'épaisseur à `tolerance` près (mm) ;
 * avec `wallId`, sur l'axe de ce mur, sans limite de distance (second point d'une baie, qui
 * reste sur le mur du premier). `null` : aucun mur sous le pointeur (ou mur `wallId` absent).
 */
export function wallBayPoint(
  walls: readonly Wall[],
  point: Vec2,
  tolerance: Mm,
  wallId?: string,
): WallBayPoint | null {
  let best: { wallId: string; point: Vec2; d: number } | null = null;
  for (const w of walls) {
    if (wallId !== undefined && w.id !== wallId) continue;
    const q = closestOnAxis(w.a, w.b, point);
    const d = Math.hypot(point.x - q.x, point.y - q.y);
    if (wallId === undefined && d > w.thickness / 2 + tolerance) continue;
    if (best === null || d < best.d) best = { wallId: w.id, point: q, d };
  }
  return best ? { wallId: best.wallId, point: best.point } : null;
}

/**
 * Écart (mm) toléré entre une extrémité de baie et l'axe du mur qui la porte, au-delà de la
 * demi-épaisseur : arrondi des extrémités au mm entier (ADR-0003), tolérance géométrique et non
 * valeur métier.
 */
const BAY_ON_WALL_TOL = 1;

/**
 * Mur qui porte la baie `a`–`b` : parmi les murs dont l'axe passe à moins d'une demi-épaisseur
 * (plus l'arrondi au mm) des deux extrémités et dont le segment contient au moins l'une d'elles
 * (au même arrondi près), celui qui dépasse le moins de son segment (zéro : il contient la baie) ;
 * à égalité, le premier. Ainsi, sur deux murs alignés (mur coupé par `splitWall`), la baie est
 * portée par le tronçon qui la contient, et une baie posée loin sur le prolongement d'un mur reste
 * libre. `undefined` : baie libre.
 */
export function bayCarrier(walls: readonly Wall[], a: Vec2, b: Vec2): Wall | undefined {
  let best: { wall: Wall; overshoot: number } | null = null;
  for (const w of walls) {
    const ux = w.b.x - w.a.x;
    const uy = w.b.y - w.a.y;
    const L = Math.hypot(ux, uy);
    if (!(L > 0)) continue;
    const off = (p: Vec2): number => Math.abs((ux * (p.y - w.a.y) - uy * (p.x - w.a.x)) / L);
    const half = w.thickness / 2 + BAY_ON_WALL_TOL;
    if (off(a) > half || off(b) > half) continue;
    // Dépassement (mm) d'une extrémité hors du segment, le long de l'axe.
    const out = (p: Vec2): number => {
      const t = ((p.x - w.a.x) * ux + (p.y - w.a.y) * uy) / L;
      return Math.max(0, -t, t - L);
    };
    const oa = out(a);
    const ob = out(b);
    if (Math.min(oa, ob) > BAY_ON_WALL_TOL) continue;
    const overshoot = Math.max(0, Math.max(oa, ob) - BAY_ON_WALL_TOL);
    if (best === null || overshoot < best.overshoot) best = { wall: w, overshoot };
  }
  return best?.wall;
}

/** Projeté de `point` sur l'axe du mur `w` (segment, extrémités comprises). */
export function onWallAxis(w: Wall, point: Vec2): Vec2 {
  return closestOnAxis(w.a, w.b, point);
}
