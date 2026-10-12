/**
 * Contrôleurs des poignées de l'éditeur de plan (ADR-0010, plan F, sous-lot 4b) : traduction
 * d'un glisser ou d'une touche en modification du `Project`. Fonctions pures, **sans calcul
 * métier** : chaque pas appelle un mutateur du cœur (`layout/cageEdit.ts` : `withPlacement`,
 * `dragSectionEnd`, `dragWidth`, `dragJunctionAngle`, `dragWellRadius`, `setSectionLength`…) et
 * les accroches de `site/stairSnap.ts` (`snapPlacement`, `snapSectionLength`, `snapAngle`) ;
 * les pas et rayons d'accroche sont des constantes d'ergonomie (`planErgonomics.ts`).
 *
 * Contrat d'un geste (`beginDrag` → `dragStep`…) : **chaque pas part du projet du début du
 * geste** et du `Model` calculé pour lui (repères des mutateurs), jamais du résultat du pas
 * précédent : un passage d'une jonction par 0° ne perd pas son mode ni son raccord du jour, et
 * le pointeur ramené au départ rend le projet de départ (même objet). Le point visé est la
 * position de la poignée au début du geste décalée du déplacement du pointeur (pas de saut quand
 * on prend une poignée à côté de son centre). Un refus `{ error }` d'un mutateur est rendu tel
 * quel : l'interface garde le dernier état valide et annonce le message.
 *
 * Accroches (désactivées par Maj, `free`) : placement de l'escalier sur les cibles de
 * `snapPlacement` (arrivée sur la trémie, flanc contre un mur), rotation et angle de jonction au
 * pas `ANGLE_SNAP_DEG` (multiples du pas, ou valeur de départ décalée d'un multiple du pas : un
 * angle quelconque ne saute pas au premier pixel, `snapAngleFrom`), longueur d'un tronçon droit
 * par girons entiers (`snapSectionLength`).
 */
import {
  dragJunctionAngle,
  dragWallFace,
  moveBayEnd,
  moveOpeningVertex,
  moveRoomVertex,
  moveZoneVertex,
  postAngleAt,
  resizePostToCorner,
  setCircularPostRadiusAt,
  translateObstacle,
  updateObstacle,
  type Obstacle,
  type ObstacleDraft,
  moveWallEnd,
  openingVertices,
  setWallThicknessKeepingFace,
  siteSnapContext,
  snapPoint,
  snapTranslation,
  snapWallEnd,
  translateOpening,
  translateWall,
  type SiteSnapContext,
  type SiteSnapExclude,
  type SnapKind,
  dragSectionEnd,
  dragWellRadius,
  dragWidth,
  flightsToCageLayout,
  junctionAngleAt,
  rotatePlacementAbout,
  sectionEndLength,
  setJunctionAngle,
  setSectionAxis,
  setSectionLength,
  setSectionWidth,
  setWellJoint,
  snapAngle,
  snapPlacement,
  snapSectionLength,
  stairPivot,
  stairSnapTargets,
  withPlacement,
  type CageLayoutSpec,
  type EditResult,
  type Model,
  type Opening,
  type PlacementSnapTarget,
  type Project,
  type StairPlacement,
  type StairSnapTarget,
  type Vec2,
  editError,
} from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
import {
  ANGLE_SNAP_DEG,
  KEY_STEP_DEG,
  KEY_STEP_DEG_LARGE,
  KEY_STEP_MM,
  KEY_STEP_MM_LARGE,
  OPENING_VERTEX_EDIT_MAX,
} from "./planErgonomics.js";
import type { PlanSelection } from "../store/planEditor.js";

/** Poignée de l'éditeur de plan. Indices à partir de 0. */
export type PlanHandle =
  | { readonly kind: "move" }
  | { readonly kind: "rotate" }
  | { readonly kind: "sectionEnd"; readonly section: number }
  | {
      readonly kind: "width";
      readonly section: number;
      readonly end: "start" | "end";
      readonly edge: "left" | "right";
    }
  | { readonly kind: "junctionAngle"; readonly junction: number }
  | { readonly kind: "wellRadius"; readonly junction: number }
  | SiteHandle;

/**
 * Poignées du site (sous-lot 5a) : extrémité d'un mur (`moveWallEnd`), mur entier
 * (`translateWall`), nu d'un mur (épaisseur, nu opposé conservé : `dragWallFace`), trémie entière
 * (`translateOpening`), sommet de la trémie (`moveOpeningVertex`, ordre de `openingVertices`).
 * Sous-lot 5b : sommet du contour de pièce (`moveRoomVertex`), obstacle entier
 * (`translateObstacle` ; une baie glisse le long de son mur), coin d'un poteau (`resizePostToCorner`),
 * rotation d'un poteau (`postAngleAt`, accroche de 15°), rayon d'un poteau rond
 * (`setCircularPostRadiusAt`), extrémité d'une porte ou d'une fenêtre le long de son mur
 * (`moveBayEnd`), sommet d'une zone interdite (`moveZoneVertex`).
 */
export type SiteHandle =
  | { readonly kind: "wallEnd"; readonly id: string; readonly end: "a" | "b" }
  | { readonly kind: "wallMove"; readonly id: string }
  | { readonly kind: "wallFace"; readonly id: string; readonly side: "left" | "right" }
  | { readonly kind: "openingMove" }
  | { readonly kind: "openingVertex"; readonly index: number }
  | { readonly kind: "roomVertex"; readonly index: number }
  | { readonly kind: "obstacleMove"; readonly id: string }
  | { readonly kind: "postSize"; readonly id: string }
  | { readonly kind: "postRotate"; readonly id: string }
  | { readonly kind: "postRadius"; readonly id: string }
  | { readonly kind: "bayEnd"; readonly id: string; readonly end: "a" | "b" }
  | { readonly kind: "zoneVertex"; readonly id: string; readonly index: number };

const SITE_HANDLE_KINDS: ReadonlySet<PlanHandle["kind"]> = new Set([
  "wallEnd",
  "wallMove",
  "wallFace",
  "openingMove",
  "openingVertex",
  "roomVertex",
  "obstacleMove",
  "postSize",
  "postRotate",
  "postRadius",
  "bayEnd",
  "zoneVertex",
]);

/** Poignée du site (positions lues dans le projet courant, pas dans le `Model`). */
export function isSiteHandle(h: PlanHandle): h is SiteHandle {
  return SITE_HANDLE_KINDS.has(h.kind);
}

/**
 * Poignée qui suit les flèches quand un élément du site est sélectionné (et non une poignée) :
 * mur → mur entier, extrémité → extrémité, trémie → trémie entière, sommet → sommet, sommet du
 * contour de pièce → ce sommet, obstacle → obstacle entier (le contour de pièce entier n'a pas
 * de déplacement : aucune).
 */
export function siteSelectionHandle(sel: PlanSelection | null): SiteHandle | null {
  switch (sel?.kind) {
    case "wall":
      return { kind: "wallMove", id: sel.id };
    case "wallEnd":
      return { kind: "wallEnd", id: sel.id, end: sel.end };
    case "opening":
      return { kind: "openingMove" };
    case "openingVertex":
      return { kind: "openingVertex", index: sel.index };
    case "roomVertex":
      return { kind: "roomVertex", index: sel.index };
    case "obstacle":
      return { kind: "obstacleMove", id: sel.id };
    default:
      return null;
  }
}

/** Élément du plan désigné par une poignée du site (clic sans glisser : sélection). */
export function siteHandleSelection(h: PlanHandle): PlanSelection | null {
  switch (h.kind) {
    case "wallEnd":
      return { kind: "wallEnd", id: h.id, end: h.end };
    case "openingVertex":
      return { kind: "openingVertex", index: h.index };
    case "roomVertex":
      return { kind: "roomVertex", index: h.index };
    default:
      return null;
  }
}

/** Modèle lu par les contrôleurs (repères du tracé, girons des accroches). */
export type DragModel = Pick<Model, "layout" | "stepping">;

/** Clé stable d'une poignée (`data-plan-handle`, clé de groupe de l'historique). */
export function handleKey(h: PlanHandle): string {
  switch (h.kind) {
    case "move":
    case "rotate":
      return h.kind;
    case "sectionEnd":
      return `sectionEnd:${h.section}`;
    case "width":
      return `width:${h.section}:${h.end}:${h.edge}`;
    case "junctionAngle":
    case "wellRadius":
      return `${h.kind}:${h.junction}`;
    case "wallEnd":
      return `wallEnd:${h.end}:${h.id}`;
    case "wallMove":
      return `wallMove:${h.id}`;
    case "wallFace":
      return `wallFace:${h.side}:${h.id}`;
    case "openingMove":
      return "openingMove";
    case "openingVertex":
      return `openingVertex:${h.index}`;
    case "roomVertex":
      return `roomVertex:${h.index}`;
    case "obstacleMove":
    case "postSize":
    case "postRotate":
    case "postRadius":
      return `${h.kind}:${h.id}`;
    case "bayEnd":
      return `bayEnd:${h.end}:${h.id}`;
    case "zoneVertex":
      return `zoneVertex:${h.index}:${h.id}`;
  }
}

/** Les poignées d'angle (degrés) ; les autres sont en mm (position, longueur, largeur, rayon). */
function isAngleHandle(h: PlanHandle, project: Project): boolean {
  if (h.kind === "rotate" || h.kind === "junctionAngle" || h.kind === "postRotate") return true;
  if (h.kind === "sectionEnd")
    return editableCage(project)?.sections[h.section]?.axis.kind === "arc";
  return false;
}

/**
 * Cage lue (sans calcul) pour les valeurs des curseurs : celle du projet, ou la cage équivalente
 * d'un tracé à volées (`flightsToCageLayout`, conversion du cœur) ; `null` pour un hélicoïdal ou
 * un tracé à volées qui ne s'écrit pas en cage.
 */
export function editableCage(project: Project): CageLayoutSpec | null {
  const spec = project.stair.layout;
  if (spec.kind === "cage") return spec;
  if (spec.kind === "helical") return null;
  return flightsToCageLayout(spec);
}

/** Valeur d'une poignée pour son curseur ARIA (`role="slider"`). */
export interface HandleValue {
  readonly unit: "mm" | "deg" | "position" | "size";
  /** Valeur courante ; `null` : non numérique (longueur `auto`). */
  readonly now: number | null;
  readonly min: number;
  readonly max: number;
  /** Position de l'escalier (poignée de déplacement). */
  readonly position?: Vec2;
  /** Côtés x, y d'un poteau rectangulaire (poignée de coin, `unit` « size »). */
  readonly size?: Vec2;
}

/** Obstacle `id` du site, ou `undefined`. */
function obstacleOf(project: Project, id: string): Obstacle | undefined {
  return (project.site.obstacles ?? []).find((o) => o.id === id);
}

/** Point repère d'un obstacle (valeur de sa poignée de déplacement) : centre, extrémité a, sommet 1. */
function obstacleAnchor(o: Obstacle): Vec2 {
  switch (o.kind) {
    case "post":
    case "circularPost":
      return o.center;
    case "door":
    case "window":
      return o.a;
    case "zone":
      return o.points[0]!;
  }
}

/** Sommets d'un obstacle accrochés pendant sa translation (centre d'un poteau, sommets d'une zone). */
function obstacleSnapVertices(o: Obstacle): readonly Vec2[] {
  switch (o.kind) {
    case "post":
    case "circularPost":
      return [o.center];
    case "zone":
      return o.points;
    default:
      return [];
  }
}

/** Obstacle sans identifiant (brouillon de `updateObstacle`), une cote remplacée. */
function obstacleWith(o: Obstacle, patch: Partial<ObstacleDraft>): ObstacleDraft {
  const { id: _id, ...draft } = o;
  return { ...draft, ...patch } as ObstacleDraft;
}

/** Élément exclu des accroches pendant le geste d'une poignée du site. */
function snapExclude(h: SiteHandle): SiteSnapExclude {
  switch (h.kind) {
    case "openingMove":
    case "openingVertex":
      return { kind: "opening" };
    case "wallEnd":
    case "wallMove":
    case "wallFace":
      return { kind: "wall", id: h.id };
    case "roomVertex":
      return { kind: "room" };
    default:
      return { kind: "obstacle", id: h.id };
  }
}

/**
 * Valeur courante d'une poignée, lue dans le `Project` (jamais recalculée) ; `null` si la poignée
 * ne vise rien (indice hors tracé, tracé non éditable). `maxMm` : borne d'affichage des curseurs.
 */
export function handleValue(project: Project, h: PlanHandle, maxMm: number): HandleValue | null {
  const placement = project.stair.placement;
  switch (h.kind) {
    case "move":
      return {
        unit: "position",
        now: placement.origin.x,
        min: -maxMm,
        max: maxMm,
        position: placement.origin,
      };
    case "rotate":
      return { unit: "deg", now: wrapDeg(placement.rotation), min: -180, max: 180 };
  }
  if (isSiteHandle(h)) return siteHandleValue(project, h, maxMm);
  const cage = editableCage(project);
  if (!cage) return null;
  switch (h.kind) {
    case "sectionEnd": {
      const axis = cage.sections[h.section]?.axis;
      if (!axis) return null;
      if (axis.kind === "arc") return { unit: "deg", now: axis.sweep, min: -359, max: 359 };
      return { unit: "mm", now: axis.length === "auto" ? null : axis.length, min: 0, max: maxMm };
    }
    case "width": {
      const s = cage.sections[h.section];
      if (!s) return null;
      const now = h.end === "end" ? (s.widthEnd ?? s.width) : s.width;
      return { unit: "mm", now, min: 1, max: maxMm };
    }
    case "junctionAngle": {
      const jn = cage.junctions[h.junction];
      return jn ? { unit: "deg", now: jn.angle, min: -179, max: 179 } : null;
    }
    case "wellRadius": {
      const well = cage.junctions[h.junction]?.well;
      return well?.kind === "arc" ? { unit: "mm", now: well.radius, min: 1, max: maxMm } : null;
    }
  }
}

/** Valeur d'une poignée du site, lue dans le site du projet. */
function siteHandleValue(project: Project, h: SiteHandle, maxMm: number): HandleValue | null {
  const position = (p: Vec2 | undefined): HandleValue | null =>
    p ? { unit: "position", now: p.x, min: -maxMm, max: maxMm, position: p } : null;
  const wallOf = (id: string) => project.site.walls.find((w) => w.id === id);
  const opening = project.site.opening;
  switch (h.kind) {
    case "wallEnd":
      return position(wallOf(h.id)?.[h.end]);
    case "wallMove":
      return position(wallOf(h.id)?.a);
    case "wallFace": {
      const w = wallOf(h.id);
      return w ? { unit: "mm", now: w.thickness, min: 1, max: maxMm } : null;
    }
    case "openingMove":
      return position(opening ? openingVertices(opening)[0] : undefined);
    case "openingVertex":
      return position(opening ? openingVertices(opening)[h.index] : undefined);
    case "roomVertex":
      return position(project.site.room?.points[h.index]);
  }
  const o = obstacleOf(project, h.id);
  if (!o) return null;
  switch (h.kind) {
    case "obstacleMove":
      return position(obstacleAnchor(o));
    case "postSize":
      return o.kind === "post"
        ? { unit: "size", now: o.sizeX, min: 1, max: maxMm, size: { x: o.sizeX, y: o.sizeY } }
        : null;
    case "postRotate":
      return o.kind === "post"
        ? { unit: "deg", now: wrapDeg(o.rotation ?? 0), min: -180, max: 180 }
        : null;
    case "postRadius":
      return o.kind === "circularPost" ? { unit: "mm", now: o.radius, min: 1, max: maxMm } : null;
    case "bayEnd":
      return o.kind === "door" || o.kind === "window" ? position(o[h.end]) : null;
    case "zoneVertex":
      return o.kind === "zone" ? position(o.points[h.index]) : null;
  }
}

/** Angle (degrés) ramené dans ]−180 ; 180] (affichage). */
function wrapDeg(d: number): number {
  let x = ((d % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x + 0;
}

// ------------------------------------------------------------------ Glisser

/** Geste en cours : projet et modèle du début, prise de la poignée. */
export interface DragGesture {
  readonly handle: PlanHandle;
  /** Clé de groupe de l'historique (`plan-drag:<poignée>:<n>`). */
  readonly key: string;
  readonly project: Project;
  readonly model: DragModel;
  /** Pointeur au début du geste (repère du site). */
  readonly grab: Vec2;
  /** Position de la poignée au début du geste (repère du site). */
  readonly anchor: Vec2;
  /** Pivot de la rotation (centre de l'emprise), poignée de rotation. */
  readonly pivot?: Vec2;
  /** Cibles d'accroche des longueurs (poignée de fin d'un tronçon droit). */
  readonly targets: readonly StairSnapTarget[];
  /**
   * Accroches d'une poignée du site : index du calque de fond et du site **sans l'élément
   * glissé** (`site/snap.ts`), directions d'équerre (axes du site, autres murs).
   */
  readonly site?: SiteSnapContext;
}

/**
 * Début d'un geste sur la poignée `handle` : `project` (projet courant) et `model` (son modèle
 * calculé), `grab` (pointeur), `anchor` (poignée), `seq` (numéro du geste, clé d'historique
 * unique).
 */
export function beginDrag(
  handle: PlanHandle,
  project: Project,
  model: DragModel,
  grab: Vec2,
  anchor: Vec2,
  seq: number,
): DragGesture {
  const pivot = handle.kind === "rotate" ? stairPivot(project, model.layout) : undefined;
  const targets =
    handle.kind === "sectionEnd"
      ? stairSnapTargets(project, model).filter(
          (t) => t.kind === "sectionLength" && t.section === handle.section,
        )
      : [];
  const site = isSiteHandle(handle) ? siteSnapContext(project, snapExclude(handle)) : undefined;
  return {
    handle,
    key: `plan-drag:${handleKey(handle)}:${seq}`,
    project,
    model,
    grab,
    anchor,
    ...(pivot ? { pivot } : {}),
    targets,
    ...(site ? { site } : {}),
  };
}

/** Options d'un pas : rayon d'accroche (mm du site) et accroches désactivées (Maj). */
export interface DragStepOptions {
  readonly snapRadius: number;
  readonly free: boolean;
}

/** Accroche retenue par un pas (repère visuel, annonce). */
export type DragSnap =
  | {
      readonly kind: "placement";
      readonly target: PlacementSnapTarget;
      readonly placement: StairPlacement;
    }
  | { readonly kind: "length"; readonly goings: number; readonly length: number }
  | { readonly kind: "angle"; readonly angle: number }
  | { readonly kind: "point"; readonly snap: SnapKind; readonly at: Vec2 }
  | { readonly kind: "square"; readonly at: Vec2 };

/** Résultat d'un pas : projet (le projet du début s'il est sans effet) et accroche, ou refus. */
export type DragStepResult =
  | {
      readonly project: Project;
      readonly snap: DragSnap | null;
      readonly error?: undefined;
      /** Élément à sélectionner à la fin du geste (sommet de trémie réindexé). */
      readonly selection?: PlanSelection;
    }
  | {
      readonly project?: undefined;
      readonly snap?: undefined;
      readonly error: Message;
    };

const RAD = Math.PI / 180;

/**
 * Accroche angulaire d'un geste : la plus proche de `raw` entre le multiple de `step` (angle
 * « rond ») et la valeur de départ `start` décalée d'un multiple de `step` (au degré). Un angle
 * de départ quelconque (escalier accroché à une trémie oblique, jonction à 47°) reste donc
 * inchangé tant que le pointeur reste près du départ ; à égalité, le multiple l'emporte.
 */
export function snapAngleFrom(raw: number, start: number, step: number): number {
  const absolute = snapAngle(raw, step);
  const offset = snapAngle(raw - start, step);
  const relative = offset === 0 ? start : Math.round(start + offset);
  return Math.abs(relative - raw) < Math.abs(absolute - raw) ? relative : absolute;
}

function done(r: EditResult, snap: DragSnap | null = null): DragStepResult {
  return r.error ? { error: r.error } : { project: r.project, snap };
}

/** Pas d'un geste : pointeur `pointer` (repère du site). */
export function dragStep(g: DragGesture, pointer: Vec2, opts: DragStepOptions): DragStepResult {
  const dx = pointer.x - g.grab.x;
  const dy = pointer.y - g.grab.y;
  const point = { x: g.anchor.x + dx, y: g.anchor.y + dy };
  const p = g.project;
  const layout = g.model.layout;
  const h = g.handle;
  switch (h.kind) {
    case "move": {
      const start = p.stair.placement;
      const candidate: StairPlacement = {
        origin: { x: start.origin.x + dx, y: start.origin.y + dy },
        rotation: start.rotation,
      };
      const hit = opts.free ? null : snapPlacement(p, g.model, candidate, opts.snapRadius);
      const placement = hit?.placement ?? candidate;
      return done(
        withPlacement(p, placement),
        hit ? { kind: "placement", target: hit.target, placement: hit.placement } : null,
      );
    }
    case "rotate": {
      const pivot = g.pivot ?? stairPivot(p, layout);
      const a0 = Math.atan2(g.grab.y - pivot.y, g.grab.x - pivot.x);
      const a1 = Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x);
      if (!Number.isFinite(a0) || !Number.isFinite(a1)) return { project: p, snap: null };
      // Écart ramené dans ]−180°, 180°] : pas de saut de 360° en passant derrière le pivot.
      const raw = p.stair.placement.rotation + wrapDeg((a1 - a0) / RAD);
      // Rotation au degré (comme `withPlacement`) avant de placer l'origine : le pivot reste
      // immobile à l'arrondi de l'origine près.
      const start = p.stair.placement.rotation;
      const rotation = opts.free ? snapAngle(raw, 1) : snapAngleFrom(raw, start, ANGLE_SNAP_DEG);
      return done(
        withPlacement(p, rotatePlacementAbout(p.stair.placement, pivot, rotation)),
        opts.free ? null : { kind: "angle", angle: wrapDeg(rotation) },
      );
    }
    case "sectionEnd": {
      if (!opts.free && g.targets.length > 0) {
        const raw = sectionEndLength(p, layout, h.section, point);
        const hit = raw.error
          ? null
          : snapSectionLength(g.targets, h.section, raw.length, opts.snapRadius);
        if (hit) {
          return done(setSectionLength(p, h.section, hit.length), {
            kind: "length",
            goings: hit.goings,
            length: hit.length,
          });
        }
      }
      return done(dragSectionEnd(p, layout, h.section, point));
    }
    case "width":
      return done(dragWidth(p, layout, h.section, h.end, h.edge, point));
    case "junctionAngle": {
      if (opts.free) return done(dragJunctionAngle(p, layout, h.junction, point));
      const raw = junctionAngleAt(layout, h.junction, point);
      if (raw === null) return { project: p, snap: null };
      if (raw === undefined) return done(dragJunctionAngle(p, layout, h.junction, point));
      const start = editableCage(p)?.junctions[h.junction]?.angle ?? raw;
      const angle = Math.min(179, Math.max(-179, snapAngleFrom(raw, start, ANGLE_SNAP_DEG)));
      return done(setJunctionAngle(p, h.junction, angle), { kind: "angle", angle });
    }
    case "wellRadius":
      return done(dragWellRadius(p, layout, h.junction, point));
    default:
      return siteStep(g, h, point, { x: dx, y: dy }, opts);
  }
}

/**
 * Pas d'une poignée du site. Accroches (sauf Maj) : point visé sur une accroche du calque ou du
 * site (`snapPoint` : extrémité, milieu, intersection, sommet), sinon, pour une extrémité de mur,
 * à l'équerre de l'extrémité fixe (`snapRightAngle`) ; un mur ou une trémie translatés
 * s'accrochent par le sommet déplacé le plus proche d'une accroche.
 */
function siteStep(
  g: DragGesture,
  h: SiteHandle,
  point: Vec2,
  delta: Vec2,
  opts: DragStepOptions,
): DragStepResult {
  const p = g.project;
  const snaps = opts.free ? undefined : g.site;
  const pointSnap = (q: Vec2): DragSnap | null => {
    const hit = snaps ? snapPoint(snaps.index, q, opts.snapRadius) : null;
    return hit ? { kind: "point", snap: hit.kind, at: hit.point } : null;
  };
  /** Translation accrochée (cœur : sommet translaté le plus proche d'une accroche). */
  const snappedDelta = (vertices: readonly Vec2[]): { d: Vec2; snap: DragSnap | null } => {
    if (!snaps) return { d: delta, snap: null };
    const t = snapTranslation(snaps, vertices, delta, opts.snapRadius);
    return {
      d: t.delta,
      snap: t.hit ? { kind: "point", snap: t.hit.kind, at: t.hit.point } : null,
    };
  };
  switch (h.kind) {
    case "wallEnd": {
      const wall = p.site.walls.find((w) => w.id === h.id);
      const hit =
        snaps && wall
          ? snapWallEnd(snaps, wall[h.end === "a" ? "b" : "a"], point, opts.snapRadius)
          : null;
      const snap: DragSnap | null =
        hit?.kind === "point"
          ? { kind: "point", snap: hit.hit.kind, at: hit.point }
          : hit
            ? { kind: "square", at: hit.point }
            : null;
      return done(moveWallEnd(p, h.id, h.end, hit?.point ?? point), snap);
    }
    case "wallMove": {
      const wall = p.site.walls.find((w) => w.id === h.id);
      const t = snappedDelta(wall ? [wall.a, wall.b] : []);
      return done(translateWall(p, h.id, t.d), t.snap);
    }
    case "wallFace":
      return done(dragWallFace(p, h.id, h.side, point));
    case "openingMove": {
      const opening = p.site.opening;
      const t = snappedDelta(opening ? openingVertices(opening) : []);
      return done(translateOpening(p, t.d), t.snap);
    }
    case "openingVertex": {
      const snap = pointSnap(point);
      const r = moveOpeningVertex(p, h.index, snap?.kind === "point" ? snap.at : point);
      if (r.error) return { error: r.error };
      return r.index === h.index
        ? { project: r.project, snap }
        : { project: r.project, snap, selection: { kind: "openingVertex", index: r.index } };
    }
    case "roomVertex": {
      const snap = pointSnap(point);
      return done(moveRoomVertex(p, h.index, snap?.kind === "point" ? snap.at : point), snap);
    }
    case "obstacleMove": {
      const o = obstacleOf(p, h.id);
      // Une baie glisse le long de son mur (projection du cœur), sans accroche.
      if (o?.kind === "door" || o?.kind === "window")
        return done(translateObstacle(p, h.id, delta));
      const t = snappedDelta(o ? obstacleSnapVertices(o) : []);
      return done(translateObstacle(p, h.id, t.d), t.snap);
    }
    case "postSize":
      return done(resizePostToCorner(p, h.id, point));
    case "postRotate": {
      const o = obstacleOf(p, h.id);
      const raw = postAngleAt(p, h.id, point);
      if (o?.kind !== "post" || raw === null) return { project: p, snap: null };
      const rotation = opts.free
        ? snapAngle(raw, 1)
        : snapAngleFrom(raw, wrapDeg(o.rotation ?? 0), ANGLE_SNAP_DEG);
      return done(
        updateObstacle(p, h.id, obstacleWith(o, { rotation })),
        opts.free ? null : { kind: "angle", angle: wrapDeg(rotation) },
      );
    }
    case "postRadius":
      return done(setCircularPostRadiusAt(p, h.id, point));
    case "bayEnd":
      return done(moveBayEnd(p, h.id, h.end, point));
    case "zoneVertex": {
      const snap = pointSnap(point);
      return done(moveZoneVertex(p, h.id, h.index, snap?.kind === "point" ? snap.at : point), snap);
    }
  }
}

/**
 * Trémie éditée sommet par sommet depuis la trémie entière (poignées et champs par sommet) :
 * ni trémie ronde (`circle` : le déplacement d'un sommet la rend polygonale), ni contour dense
 * (au-delà de `OPENING_VERTEX_EDIT_MAX` sommets). Sinon, la trémie se déplace en bloc et un
 * sommet s'édite une fois sélectionné sur le plan.
 */
export function openingVerticesEditable(opening: Opening, count: number): boolean {
  return !(opening.kind === "polygon" && opening.circle) && count <= OPENING_VERTEX_EDIT_MAX;
}

// ------------------------------------------------------------------ Clavier

/**
 * Pas du clavier sur la poignée `h` : `direction` +1 (flèche haut ou droite : valeur augmentée)
 * ou −1, `large` (Maj : 100 mm ou 15°, sinon 10 mm ou 1°). Déplacement : `axis` donne l'axe du
 * site (flèches gauche / droite : x, haut / bas : y). Rotation autour du centre de l'emprise
 * (`model`, calculé pour `layoutProject`, éventuellement en retard sur `project`). Le projet
 * courant est modifié (pas de geste) ; refus typé comme les mutateurs.
 */
export function nudgeHandle(
  project: Project,
  model: DragModel,
  layoutProject: Project,
  h: PlanHandle,
  direction: 1 | -1,
  large: boolean,
  axis: "x" | "y" = "x",
): SiteNudgeResult {
  const angle = isAngleHandle(h, project);
  const step =
    direction *
    (angle ? (large ? KEY_STEP_DEG_LARGE : KEY_STEP_DEG) : large ? KEY_STEP_MM_LARGE : KEY_STEP_MM);
  const placement = project.stair.placement;
  switch (h.kind) {
    case "move":
      return withPlacement(project, {
        origin: {
          x: placement.origin.x + (axis === "x" ? step : 0),
          y: placement.origin.y + (axis === "y" ? step : 0),
        },
      });
    case "rotate":
      return rotateStairBy(project, model, layoutProject, step);
  }
  if (isSiteHandle(h)) return nudgeSite(project, h, step, axis);
  const cage = editableCage(project);
  const current = cage ? handleValue(project, h, Number.POSITIVE_INFINITY) : null;
  if (!cage || !current || current.now === null) {
    // Longueur `auto`, tracé hélicoïdal ou poignée hors tracé : rien à régler au clavier.
    return editError(msg("ui.plan.editor.handle.noValue"));
  }
  const value = current.now + step;
  switch (h.kind) {
    case "sectionEnd": {
      const axisSpec = cage.sections[h.section]!.axis;
      if (axisSpec.kind === "arc") {
        // Balayage : le pas agrandit ou réduit l'arc dans son sens (degrés signés).
        const sign = axisSpec.sweep < 0 ? -1 : 1;
        const magnitude = Math.min(359, Math.max(1, Math.abs(axisSpec.sweep) + step));
        return setSectionAxis(project, h.section, { ...axisSpec, sweep: sign * magnitude });
      }
      return setSectionLength(project, h.section, Math.max(0, value));
    }
    case "width": {
      const setsEnd =
        project.stair.layout.kind === "cage" &&
        h.end === "end" &&
        cage.sections[h.section]!.axis.kind === "straight";
      const w = Math.max(1, value);
      return setSectionWidth(project, h.section, setsEnd ? { widthEnd: w } : { width: w });
    }
    case "junctionAngle":
      return setJunctionAngle(project, h.junction, Math.min(179, Math.max(-179, value)));
    case "wellRadius":
      return setWellJoint(project, h.junction, { kind: "arc", radius: Math.max(1, value) });
  }
}

/**
 * Résultat d'un pas du clavier : `selection`, élément à sélectionner ensuite quand la forme
 * canonique a réindexé le sommet de trémie déplacé (contour retourné), absent sinon.
 */
export type SiteNudgeResult = EditResult<{ readonly selection?: PlanSelection }>;

/**
 * Pas du clavier sur une poignée du site (`step` signé en mm, `axis` : axe du site pour une
 * position) : déplacement d'une extrémité, d'un mur, de la trémie ou d'un sommet ; épaisseur
 * d'un nu (nu opposé conservé ; flèche haut ou droite : plus épais).
 */
export function nudgeSite(
  project: Project,
  h: SiteHandle,
  step: number,
  axis: "x" | "y",
): SiteNudgeResult {
  const d: Vec2 = { x: axis === "x" ? step : 0, y: axis === "y" ? step : 0 };
  const shift = (q: Vec2): Vec2 => ({ x: q.x + d.x, y: q.y + d.y });
  switch (h.kind) {
    case "wallEnd": {
      const wall = project.site.walls.find((w) => w.id === h.id);
      if (!wall) return editError(msg("site.edit.unknownWall", { id: h.id }));
      return moveWallEnd(project, h.id, h.end, shift(wall[h.end]));
    }
    case "wallMove":
      return translateWall(project, h.id, d);
    case "wallFace": {
      const wall = project.site.walls.find((w) => w.id === h.id);
      if (!wall) return editError(msg("site.edit.unknownWall", { id: h.id }));
      return setWallThicknessKeepingFace(
        project,
        h.id,
        wall.thickness + step,
        h.side === "left" ? "right" : "left",
      );
    }
    case "openingMove":
      return translateOpening(project, d);
    case "openingVertex": {
      const opening = project.site.opening;
      const v = opening ? openingVertices(opening)[h.index] : undefined;
      if (!v) return editError(msg("site.edit.noOpening"));
      const r = moveOpeningVertex(project, h.index, shift(v));
      if (r.error) return r;
      return r.index === h.index
        ? { project: r.project }
        : { project: r.project, selection: { kind: "openingVertex", index: r.index } };
    }
    case "roomVertex": {
      const v = project.site.room?.points[h.index];
      if (!v) return editError(msg("site.edit.noRoom"));
      return moveRoomVertex(project, h.index, shift(v));
    }
    case "obstacleMove":
      return translateObstacle(project, h.id, d);
  }
  const o = obstacleOf(project, h.id);
  if (!o) return editError(msg("site.edit.unknownObstacle", { id: h.id }));
  switch (h.kind) {
    case "postSize":
      // Flèches gauche / droite : côté x ; haut / bas : côté y.
      if (o.kind !== "post") break;
      return updateObstacle(
        project,
        h.id,
        obstacleWith(o, axis === "x" ? { sizeX: o.sizeX + step } : { sizeY: o.sizeY + step }),
      );
    case "postRotate":
      if (o.kind !== "post") break;
      return updateObstacle(project, h.id, obstacleWith(o, { rotation: (o.rotation ?? 0) + step }));
    case "postRadius":
      if (o.kind !== "circularPost") break;
      return updateObstacle(project, h.id, obstacleWith(o, { radius: o.radius + step }));
    case "bayEnd":
      if (o.kind !== "door" && o.kind !== "window") break;
      return moveBayEnd(project, h.id, h.end, shift(o[h.end]));
    case "zoneVertex": {
      const v = o.kind === "zone" ? o.points[h.index] : undefined;
      if (!v) break;
      return moveZoneVertex(project, h.id, h.index, shift(v));
    }
  }
  return editError(msg("site.edit.obstacleKind", { id: h.id }));
}

/**
 * Rotation de l'escalier de `delta` degrés (sens trigonométrique, vu de dessus) autour du centre
 * de son emprise (touches R / Maj+R, flèches de la poignée de rotation).
 */
export function rotateStairBy(
  project: Project,
  model: DragModel,
  layoutProject: Project,
  delta: number,
): EditResult {
  const placement = project.stair.placement;
  const pivot = stairPivot(layoutProject, model.layout, placement);
  return withPlacement(project, rotatePlacementAbout(placement, pivot, placement.rotation + delta));
}
