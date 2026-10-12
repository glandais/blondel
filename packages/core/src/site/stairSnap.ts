/**
 * Accroches de l'escalier dans le site (ADR-0010, plan E, sous-lot 3c) : cibles **géométriques**
 * vers lesquelles l'éditeur 2D aimante le placement ou la longueur d'un tronçon. Fonctions
 * pures, sans calcul du pipeline : elles lisent le `Project` et le `Model` déjà calculé (repère
 * du site) ; autorisées dans l'interface. Les réglages d'ergonomie (pas angulaire, rayon
 * d'accroche en pixels converti en mm) restent côté web et sont passés en paramètres.
 *
 * Cibles (`stairSnapTargets`) :
 *
 * - **Arrivée sur un bord de trémie** (`arrival`) : placement (origine + rotation) qui pose la
 *   ligne d'arrivée (dernier nez, extrémités hors tout de la structure comprises) sur un côté de
 *   la trémie, la montée sortant de la trémie par ce côté, la largeur hors tout contenue dans le
 *   côté et calée à son début, à sa fin, centrée ou au nu d'un mur perpendiculaire
 *   (`arrivalPlacements`, logique du calage de l'assistant, qui l'utilise aussi).
 * - **Flanc contre un mur** (`wallFlank`) : placement qui adosse le bord gauche ou droit d'un
 *   tronçon droit (épaisseur latérale de la structure comprise) à la face d'un mur tournée vers
 *   l'escalier, sans recouvrement (contact au nu, tolérance de l'assistant). La position le long
 *   du mur est libre : la cible garde celle du placement de référence (projection
 *   perpendiculaire au mur, après rotation autour du centre de l'emprise). Cible écartée si
 *   une autre partie de l'emprise hors tout (`stairGrossPieces`, tronçon voisin) passerait
 *   derrière la face du mur.
 *
 * Les placements des cibles sont **directement applicables** par `withPlacement` (sous-lot 3a :
 * origine au mm, rotation au degré) : rotation arrondie au degré (côté de trémie ou mur oblique
 * d'angle non entier : la ligne d'arrivée ou le bord adossé s'incline d'au plus 0,5°, son
 * extrémité la plus avancée posée sur le côté ou la face), origine au mm choisie du côté sûr
 * (extrémités d'arrivée dans la trémie, flanc écarté de la face plutôt que poussé dedans).
 * - **Longueurs par girons entiers** (`sectionLength`) : longueur de partie droite d'un tronçon
 *   droit égale à k girons (giron de la ligne de foulée du modèle), k = 1 … nombre de marches ;
 *   longueur au sens de `setSectionLength` (F11 (a) : hors carrés d'angle des jonctions
 *   voisines). Tracé à volées : la longueur de volée correspondante (au mur) ajoute E par
 *   tournant voisin (`legLength`, F11).
 *
 * `snapPlacement` choisit la cible de placement la plus proche d'un placement candidat dans un
 * rayon (mm du site) : distance = plus grand déplacement d'un coin de la boîte de l'emprise
 * entre le candidat et la cible. `snapSectionLength` fait de même pour une longueur, `snapAngle`
 * arrondit un angle à un pas donné.
 */
import { msg, type Message } from "@blondel/i18n";
import { curveLength, curveTangentAt } from "../geom2d/curve.js";
import { bbox, pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { openingPolygon } from "../headroom/headroom.js";
import type { Layout, Model } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { Project, Wall } from "../model/project.js";
import {
  SITE_FIT_CONTACT_TOL,
  projectLateralThickness,
  stairGrossPieces,
  type LateralThickness,
} from "./fit.js";

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** Placement d'un escalier : origine (repère du site) et rotation (degrés). */
export interface StairPlacement {
  readonly origin: Vec2;
  readonly rotation: number;
}

// ------------------------------------------------------------------ Arrivée sur la trémie

/** Arrivée d'un escalier en repère local (placement nul). */
export interface ArrivalFrame {
  /** Point de la ligne d'arrivée (assistant : point de Γ). */
  readonly walkPoint: Vec2;
  /** Direction de montée à l'arrivée (unitaire). */
  readonly dir: Vec2;
  /** Extrémités hors tout de la ligne d'arrivée (jour − épaisseur, extérieur + épaisseur). */
  readonly grossInner: Vec2;
  readonly grossOuter: Vec2;
}

/** Calage latéral de la largeur hors tout sur le côté de trémie. */
export type ArrivalAlignment = "start" | "end" | "center" | "wall";

/** Placement qui pose l'arrivée sur un côté de trémie, et description du calage. */
export interface ArrivalPlacement extends StairPlacement {
  /** Description du calage (côté, alignement). */
  readonly fit: Message;
  /** Clé de calage (côté, alignement) stable d'un giron à l'autre. */
  readonly key: string;
  /** Indice du côté de trémie (polygone CCW de `openingPolygon`). */
  readonly edge: number;
  readonly alignment: ArrivalAlignment;
  /** Mur au nu duquel la largeur est calée (`alignment` = `wall`). */
  readonly wallId?: string;
}

/** Côté de trémie trop court pour la largeur hors tout (diagnostic). */
export interface PlacementMisfit {
  readonly needed: Mm;
  readonly available: Mm;
}

const snapInt = (v: number): number => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v);

/** Options de `arrivalPlacements`. */
export interface ArrivalPlacementOptions {
  /**
   * Placements directement applicables par `withPlacement` (cotes au mm, angles au degré,
   * sous-lot 3a) : rotation arrondie au degré et origine au mm, du côté de la trémie (la ligne
   * d'arrivée ne passe pas sous la dalle). Absent : placement exact (assistant).
   */
  readonly applicable?: boolean;
}

/** Marge numérique des contraintes d'arrondi de l'origine (mm). */
const INT_EPS = 1e-9;

/**
 * Origine arrondie au mm : point entier le plus proche de `origin` (à au plus `reach` mm par
 * coordonnée) qui satisfait le premier jeu de contraintes satisfiable de `preferences`, essayés
 * dans l'ordre ; sinon l'arrondi au plus proche.
 */
function integerOrigin(
  origin: Vec2,
  preferences: readonly ((c: Vec2) => boolean)[],
  reach = 1,
): Vec2 {
  const corners: Vec2[] = [];
  for (let x = Math.floor(origin.x) - reach + 1; x <= Math.ceil(origin.x) + reach - 1; x++)
    for (let y = Math.floor(origin.y) - reach + 1; y <= Math.ceil(origin.y) + reach - 1; y++)
      corners.push({ x: x + 0, y: y + 0 });
  corners.sort((p, q) => V.distance(p, origin) - V.distance(q, origin));
  for (const ok of preferences) {
    const found = corners.find(ok);
    if (found) return found;
  }
  return { x: Math.round(origin.x) + 0, y: Math.round(origin.y) + 0 };
}

/**
 * Recherche de l'origine entière d'une arrivée applicable (mm par coordonnée) : couvre le
 * glissement d'une extrémité inclinée de largeur · sin 0,5° contre un coin aigu de la trémie.
 */
const ARRIVAL_ORIGIN_REACH = 16;

/** Nom d'un côté de trémie d'après sa normale sortante. */
function edgeName(normal: Vec2, index: number): Message {
  const eps = 1e-9;
  if (Math.abs(normal.x + 1) < eps) return msg("assistant.edge.xMin");
  if (Math.abs(normal.x - 1) < eps) return msg("assistant.edge.xMax");
  if (Math.abs(normal.y + 1) < eps) return msg("assistant.edge.yMin");
  if (Math.abs(normal.y - 1) < eps) return msg("assistant.edge.yMax");
  return msg("assistant.edge.index", { index: index + 1 });
}

/**
 * Placements qui posent l'arrivée sur un côté de la trémie (polygone CCW) avec la largeur hors
 * tout contenue dans ce côté. `misfit` : plus grand côté essayé quand aucun ne convient.
 */
export function arrivalPlacements(
  frame: ArrivalFrame,
  opening: Polygon2,
  walls: readonly Wall[],
  tol: Mm,
  options: ArrivalPlacementOptions = {},
): { readonly placements: ArrivalPlacement[]; readonly misfit: PlacementMisfit | null } {
  const applicable = options.applicable === true;
  const placements: ArrivalPlacement[] = [];
  const seen = new Set<string>();
  let misfit: PlacementMisfit | null = null;
  const m = opening.length;
  for (let i = 0; i < m; i++) {
    const a = opening[i]!;
    const b = opening[(i + 1) % m]!;
    const len = V.distance(a, b);
    if (!(len > tol)) continue;
    const u = V.scale(V.sub(b, a), 1 / len);
    const out = V.perpRight(u);
    let deg = ((V.angleOf(out) - V.angleOf(frame.dir)) * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    const q = Math.round(deg / 90) * 90;
    if (Math.abs(deg - q) < 1e-7) deg = q % 360;
    if (applicable) deg = Math.round(deg) % 360;
    const theta = (deg * Math.PI) / 180;
    const gi = V.rotate(frame.grossInner, theta);
    const go = V.rotate(frame.grossOuter, theta);
    const c1 = V.dot(gi, u);
    const c2 = V.dot(go, u);
    const lo = Math.min(c1, c2);
    const w = Math.abs(c2 - c1);
    if (w > len + tol) {
      if (misfit === null || len > misfit.available) misfit = { needed: w, available: len };
      continue;
    }
    // Rotation arrondie (côté oblique d'angle non entier) : la ligne d'arrivée n'est plus tout à
    // fait parallèle au côté ; son extrémité la plus avancée est posée sur le côté, l'autre
    // reste dans la trémie.
    const on = applicable
      ? -Math.max(V.dot(gi, out), V.dot(go, out))
      : -V.dot(V.rotate(frame.walkPoint, theta), out);
    const name = edgeName(out, i);
    // Au nu d'un mur d'abord : à position égale, le libellé du mur l'emporte (dédoublonnage).
    const targets: {
      lo: number;
      label: Message;
      key: string;
      alignment: ArrivalAlignment;
      wallId?: string;
    }[] = [];
    for (const wall of walls) {
      const wd = V.sub(wall.b, wall.a);
      const wl = V.norm(wd);
      if (!(wl > 0) || Math.abs(V.cross(V.scale(wd, 1 / wl), out)) > 1e-6) continue;
      const c = V.dot(V.sub(wall.a, a), u);
      const half = wall.thickness / 2;
      const label = msg("assistant.align.wall", { wall: wall.id });
      const common = { label, alignment: "wall" as const, wallId: wall.id };
      targets.push({ lo: c + half, key: `wall-${wall.id}+`, ...common });
      targets.push({ lo: c - half - w, key: `wall-${wall.id}-`, ...common });
    }
    targets.push(
      { lo: 0, label: msg("assistant.align.start"), key: "start", alignment: "start" },
      { lo: len - w, label: msg("assistant.align.end"), key: "end", alignment: "end" },
      {
        lo: Math.floor((len - w) / 2),
        label: msg("assistant.align.center"),
        key: "center",
        alignment: "center",
      },
    );
    for (const t of targets) {
      if (t.lo < -tol || t.lo + w > len + tol) continue;
      const ou = t.lo - lo;
      const origin = V.add(a, V.add(V.scale(u, ou), V.scale(out, on)));
      // Applicable : extrémités hors tout dans la trémie (ou sur son bord), sinon au moins pas
      // repoussées vers la dalle.
      const o = applicable
        ? integerOrigin(
            origin,
            [
              (c) =>
                pointInPolygon(V.add(c, gi), opening, INT_EPS) !== "outside" &&
                pointInPolygon(V.add(c, go), opening, INT_EPS) !== "outside",
              (c) => V.dot(V.sub(c, origin), out) <= INT_EPS,
            ],
            ARRIVAL_ORIGIN_REACH,
          )
        : { x: snapInt(origin.x), y: snapInt(origin.y) };
      const id = `${o.x.toFixed(3)}|${o.y.toFixed(3)}|${deg}`;
      if (seen.has(id)) continue;
      seen.add(id);
      placements.push({
        origin: o,
        rotation: deg,
        fit: msg("assistant.fit.arrival", { edge: name, alignment: t.label }),
        key: `${i}:${t.key}`,
        edge: i,
        alignment: t.alignment,
        ...(t.wallId !== undefined ? { wallId: t.wallId } : {}),
      });
    }
  }
  return { placements, misfit };
}

/** Point du repère local placé dans le site. */
export function toWorld(p: Vec2, placement: StairPlacement): Vec2 {
  return V.add(V.rotate(p, placement.rotation * RAD), placement.origin);
}

/** Point du site ramené au repère local d'un placement (inverse de `toWorld`). */
export function toLocal(p: Vec2, placement: StairPlacement): Vec2 {
  return V.rotate(V.sub(p, placement.origin), -placement.rotation * RAD);
}

/** Direction de montée à l'arrivée : normale au dernier nez, du côté où Γ avance (`arrivalZone`). */
function arrivalUp(layout: Layout, dir: Vec2): Vec2 {
  const up = V.perpLeft(dir);
  const length = curveLength(layout.walkline);
  if (!(length > 0)) return up;
  return V.dot(up, curveTangentAt(layout.walkline, length)) < 0 ? V.scale(up, -1) : up;
}

/**
 * Arrivée du modèle en repère local du projet (placement nul) : dernier nez, extrémités hors
 * tout (épaisseurs latérales de la structure), direction de montée. `null` sans nez.
 */
export function modelArrivalFrame(
  project: Project,
  model: Pick<Model, "layout" | "stepping">,
  lateral: LateralThickness = projectLateralThickness(project),
): ArrivalFrame | null {
  const nosings = model.stepping?.nosings ?? [];
  const last = nosings[nosings.length - 1];
  if (!last) return null;
  const placement = project.stair.placement;
  const up = arrivalUp(model.layout, last.dir);
  const gi = V.addScaled(last.q, last.dir, -lateral.inner);
  const go = V.addScaled(last.r, last.dir, lateral.outer);
  const rot = (v: Vec2): Vec2 => V.rotate(v, -placement.rotation * RAD);
  return {
    walkPoint: toLocal(last.q, placement),
    dir: rot(up),
    grossInner: toLocal(gi, placement),
    grossOuter: toLocal(go, placement),
  };
}

// ------------------------------------------------------------------ Cibles

/** Arrivée posée sur un côté de la trémie. */
export interface ArrivalSnapTarget {
  readonly kind: "arrival";
  readonly placement: ArrivalPlacement;
}

/** Bord d'un tronçon droit adossé à la face d'un mur. */
export interface WallFlankSnapTarget {
  readonly kind: "wallFlank";
  readonly wallId: string;
  /** Tronçon (indice de `Layout.sections`) et bord adossé, dans le sens de la montée. */
  readonly section: number;
  readonly side: "left" | "right";
  /** Face du mur (point et normale unitaire tournée vers l'escalier). */
  readonly facePoint: Vec2;
  readonly faceNormal: Vec2;
  /** Placement qui adosse le bord, à la position du placement de référence. */
  readonly placement: StairPlacement;
}

/** Longueur de partie droite d'un tronçon égale à un nombre entier de girons. */
export interface SectionLengthSnapTarget {
  readonly kind: "sectionLength";
  readonly section: number;
  /** Nombre de girons k. */
  readonly goings: number;
  /** k · g (mm), longueur au sens de `setSectionLength` (F11 (a)). */
  readonly length: Mm;
  /** Tracé à volées : longueur de la volée au mur = k · g + E par tournant voisin (F11). */
  readonly legLength?: Mm;
}

export type StairSnapTarget = ArrivalSnapTarget | WallFlankSnapTarget | SectionLengthSnapTarget;
export type PlacementSnapTarget = ArrivalSnapTarget | WallFlankSnapTarget;

/** Cibles d'arrivée sur la trémie (aucune sans trémie ni nez). */
function arrivalTargets(
  project: Project,
  model: Pick<Model, "layout" | "stepping">,
  lateral: LateralThickness,
): ArrivalSnapTarget[] {
  const opening = openingPolygon(project.site.opening);
  if (!opening) return [];
  const frame = modelArrivalFrame(project, model, lateral);
  if (!frame) return [];
  return arrivalPlacements(frame, opening, project.site.walls, SITE_FIT_CONTACT_TOL, {
    applicable: true,
  }).placements.map((placement) => ({ kind: "arrival", placement }));
}

/** Bord gauche ou droit d'un tronçon droit, épaisseur latérale comprise (repère du site). */
interface FlankEdge {
  readonly section: number;
  readonly side: "left" | "right";
  readonly a: Vec2;
  readonly b: Vec2;
  /** Normale unitaire du bord, tournée hors de l'escalier. */
  readonly normal: Vec2;
}

function flankEdges(layout: Layout, lateral: LateralThickness): FlankEdge[] {
  const out: FlankEdge[] = [];
  for (const s of layout.sections ?? []) {
    if (s.kind !== "straight") continue;
    for (const side of ["left", "right"] as const) {
      const a0 = s.start[side];
      const b0 = s.end[side];
      const d = V.sub(b0, a0);
      const len = V.norm(d);
      if (!(len > SITE_FIT_CONTACT_TOL)) continue;
      const u = V.scale(d, 1 / len);
      const normal = side === "left" ? V.perpLeft(u) : V.perpRight(u);
      const t = side === layout.innerSide ? lateral.inner : lateral.outer;
      out.push({
        section: s.index,
        side,
        a: V.addScaled(a0, normal, t),
        b: V.addScaled(b0, normal, t),
        normal,
      });
    }
  }
  return out;
}

/** Coins de la boîte de l'emprise, repère local du placement du projet. */
function localBoxCorners(project: Project, layout: Layout): Vec2[] {
  const pts = layout.footprint;
  if (pts.length === 0) return [V.ZERO];
  const b = bbox(pts.map((p) => toLocal(p, project.stair.placement)));
  return [b.min, { x: b.max.x, y: b.min.y }, b.max, { x: b.min.x, y: b.max.y }];
}

/** Centre de la boîte de l'emprise, repère local. */
function localCenter(project: Project, layout: Layout): Vec2 {
  const c = localBoxCorners(project, layout);
  return V.scale(V.add(c[0]!, c[2]!), 0.5);
}

/**
 * Pivot de rotation de l'escalier dans l'éditeur 2D : centre de la boîte de l'emprise en repère
 * local (indépendant de la rotation), placé dans le site par `placement` (défaut : celui du
 * projet). `layout` : tracé calculé pour le placement de `project` ; un placement plus récent
 * (modèle en retard sur le projet) place ce même centre local.
 */
export function stairPivot(
  project: Project,
  layout: Layout,
  placement: StairPlacement = project.stair.placement,
): Vec2 {
  return toWorld(localCenter(project, layout), placement);
}

/**
 * Placement de rotation `rotation` (degrés) qui laisse le point `pivot` du site immobile :
 * rotation de l'escalier autour de ce point (poignée de rotation, touches R de l'éditeur).
 * Origine non arrondie : `withPlacement` arrondit (mm, degré).
 */
export function rotatePlacementAbout(
  placement: StairPlacement,
  pivot: Vec2,
  rotation: number,
): StairPlacement {
  const local = toLocal(pivot, placement);
  return { rotation, origin: V.sub(pivot, V.rotate(local, rotation * RAD)) };
}

/** Angle (degrés) ramené dans ]−180 ; 180]. */
function wrapDeg(d: number): number {
  let x = ((d % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x;
}

/**
 * Cibles « flanc contre un mur » pour un placement de référence `ref` : chaque bord de tronçon
 * droit, adossé à la face de chaque mur tournée vers l'escalier, si le bord ainsi placé longe
 * le mur sur plus que la tolérance de contact et si toute l'emprise hors tout
 * (`stairGrossPieces`) reste du côté escalier de la face (un tronçon voisin ne traverse pas le
 * mur). Placement applicable par `withPlacement` : rotation au degré, origine au mm, l'emprise
 * écartée de la face plutôt que poussée dedans.
 */
function wallFlankTargets(
  project: Project,
  model: Pick<Model, "layout" | "stepping">,
  lateral: LateralThickness,
  ref: StairPlacement,
): WallFlankSnapTarget[] {
  const layout = model.layout;
  const current = project.stair.placement;
  const edges = flankEdges(layout, lateral).map((e) => ({
    ...e,
    a: toLocal(e.a, current),
    b: toLocal(e.b, current),
    normal: V.rotate(e.normal, -current.rotation * RAD),
  }));
  if (edges.length === 0) return [];
  const gross = stairGrossPieces(layout, model.stepping, lateral).flatMap((g) =>
    g.polygon.map((p) => toLocal(p, current)),
  );
  const center = localCenter(project, layout);
  const centerWorld = toWorld(center, ref);
  const out: WallFlankSnapTarget[] = [];
  for (const wall of project.site.walls) {
    const wd = V.sub(wall.b, wall.a);
    const wl = V.norm(wd);
    if (!(wl > 0)) continue;
    const u = V.scale(wd, 1 / wl);
    const side = V.cross(u, V.sub(centerWorld, wall.a)) >= 0 ? 1 : -1;
    const faceNormal = V.scale(V.perpLeft(u), side);
    const facePoint = V.addScaled(wall.a, faceNormal, wall.thickness / 2);
    const above = (p: Vec2, placement: StairPlacement): number =>
      V.dot(V.sub(toWorld(p, placement), facePoint), faceNormal);
    for (const e of edges) {
      // Rotation (au degré) qui oppose la normale du bord à celle de la face, autour du centre.
      const want = V.angleOf(V.scale(faceNormal, -1));
      const rotation =
        Math.round(
          ref.rotation + wrapDeg((want - V.angleOf(V.rotate(e.normal, ref.rotation * RAD))) * DEG),
        ) + 0;
      const rotated: StairPlacement = {
        origin: V.sub(centerWorld, V.rotate(center, rotation * RAD)),
        rotation,
      };
      // Bord au contact de la face (extrémité la plus proche si la rotation arrondie l'incline).
      const d = Math.min(above(e.a, rotated), above(e.b, rotated));
      const exact = V.addScaled(rotated.origin, faceNormal, -d);
      const placement: StairPlacement = {
        origin: integerOrigin(exact, [(c) => V.dot(V.sub(c, exact), faceNormal) >= -INT_EPS]),
        rotation,
      };
      // Le bord adossé doit longer le mur.
      const a = toWorld(e.a, placement);
      const b = toWorld(e.b, placement);
      const ta = V.dot(V.sub(a, wall.a), u);
      const tb = V.dot(V.sub(b, wall.a), u);
      const overlap = Math.min(Math.max(ta, tb), wl) - Math.max(Math.min(ta, tb), 0);
      if (!(overlap > SITE_FIT_CONTACT_TOL)) continue;
      // Toute l'emprise hors tout du côté escalier de la face.
      if (gross.some((p) => above(p, placement) < -SITE_FIT_CONTACT_TOL)) continue;
      out.push({
        kind: "wallFlank",
        wallId: wall.id,
        section: e.section,
        side: e.side,
        facePoint,
        faceNormal,
        placement,
      });
    }
  }
  return out;
}

/** Cibles « longueur par girons entiers » des tronçons droits. */
function sectionLengthTargets(
  project: Project,
  model: Pick<Model, "layout" | "stepping">,
): SectionLengthSnapTarget[] {
  const spec = project.stair.layout;
  if (spec.kind === "helical") return [];
  const g = model.stepping?.going;
  const treads = model.stepping?.treads.length ?? 0;
  if (!(g !== undefined && g > 0) || treads < 1) return [];
  const out: SectionLengthSnapTarget[] = [];
  const sections =
    spec.kind === "cage"
      ? spec.sections.map((s, i) => ({ i, straight: s.axis.kind === "straight", adjacent: 0 }))
      : spec.legs.map((_, i) => ({
          i,
          straight: true,
          adjacent: (i > 0 ? 1 : 0) + (i < spec.turns.length ? 1 : 0),
        }));
  for (const s of sections) {
    if (!s.straight) continue;
    for (let k = 1; k <= treads; k++) {
      const length = k * g;
      out.push({
        kind: "sectionLength",
        section: s.i,
        goings: k,
        length,
        ...(spec.kind === "cage" ? {} : { legLength: length + s.adjacent * spec.width }),
      });
    }
  }
  return out;
}

/**
 * Cibles d'accroche de l'escalier (voir l'en-tête), calculées pour le placement du projet :
 * arrivées sur la trémie, flancs contre les murs, longueurs par girons entiers.
 */
export function stairSnapTargets(
  project: Project,
  model: Pick<Model, "layout" | "stepping">,
): StairSnapTarget[] {
  const lateral = projectLateralThickness(project);
  return [
    ...arrivalTargets(project, model, lateral),
    ...wallFlankTargets(project, model, lateral, project.stair.placement),
    ...sectionLengthTargets(project, model),
  ];
}

/**
 * Plus grand déplacement (mm) d'un coin de la boîte de l'emprise entre deux placements de
 * l'escalier du modèle.
 */
export function placementDistance(
  project: Project,
  model: Pick<Model, "layout">,
  a: StairPlacement,
  b: StairPlacement,
): Mm {
  let worst = 0;
  for (const p of localBoxCorners(project, model.layout))
    worst = Math.max(worst, V.distance(toWorld(p, a), toWorld(p, b)));
  return worst;
}

/** Résultat d'une accroche de placement. */
export interface PlacementSnap {
  readonly target: PlacementSnapTarget;
  readonly placement: StairPlacement;
  /** Déplacement du candidat à la cible (mm, `placementDistance`). */
  readonly distance: Mm;
}

/**
 * Accroche d'un placement candidat (glisser de l'escalier) : cible d'arrivée ou de flanc la plus
 * proche dans le rayon `radius` (mm du site, fourni par l'appelant), ou `null`. Les flancs sont
 * recalculés pour le candidat (position le long du mur conservée).
 */
export function snapPlacement(
  project: Project,
  model: Pick<Model, "layout" | "stepping">,
  candidate: StairPlacement,
  radius: Mm,
): PlacementSnap | null {
  if (!(radius >= 0)) return null;
  const lateral = projectLateralThickness(project);
  const targets: PlacementSnapTarget[] = [
    ...arrivalTargets(project, model, lateral),
    ...wallFlankTargets(project, model, lateral, candidate),
  ];
  let best: PlacementSnap | null = null;
  for (const target of targets) {
    const distance = placementDistance(project, model, candidate, target.placement);
    if (distance > radius) continue;
    if (best === null || distance < best.distance)
      best = { target, placement: target.placement, distance };
  }
  return best;
}

/**
 * Accroche de la longueur de partie droite du tronçon `section` : cible « par girons entiers »
 * la plus proche de `length` dans le rayon `radius` (mm), ou `null`.
 */
export function snapSectionLength(
  targets: readonly StairSnapTarget[],
  section: number,
  length: Mm,
  radius: Mm,
): SectionLengthSnapTarget | null {
  let best: SectionLengthSnapTarget | null = null;
  for (const t of targets) {
    if (t.kind !== "sectionLength" || t.section !== section) continue;
    const d = Math.abs(t.length - length);
    if (d > radius) continue;
    if (best === null || d < Math.abs(best.length - length)) best = t;
  }
  return best;
}

/**
 * Angle arrondi au multiple le plus proche de `step` (même unité, pas fourni par l'appelant) ;
 * angle inchangé si le pas n'est pas un nombre strictement positif. Idempotent.
 */
export function snapAngle(angle: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(angle)) return angle;
  const k = Math.round(angle / step);
  return k * step + 0;
}
