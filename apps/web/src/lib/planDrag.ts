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
} from "./planErgonomics.js";

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
  | { readonly kind: "wellRadius"; readonly junction: number };

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
  }
}

/** Les poignées d'angle (degrés) ; les autres sont en mm (position, longueur, largeur, rayon). */
function isAngleHandle(h: PlanHandle, project: Project): boolean {
  if (h.kind === "rotate" || h.kind === "junctionAngle") return true;
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
  readonly unit: "mm" | "deg" | "position";
  /** Valeur courante ; `null` : non numérique (longueur `auto`). */
  readonly now: number | null;
  readonly min: number;
  readonly max: number;
  /** Position de l'escalier (poignée de déplacement). */
  readonly position?: Vec2;
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
  return {
    handle,
    key: `plan-drag:${handleKey(handle)}:${seq}`,
    project,
    model,
    grab,
    anchor,
    ...(pivot ? { pivot } : {}),
    targets,
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
  | { readonly kind: "angle"; readonly angle: number };

/** Résultat d'un pas : projet (le projet du début s'il est sans effet) et accroche, ou refus. */
export type DragStepResult =
  | { readonly project: Project; readonly snap: DragSnap | null; readonly error?: undefined }
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
  }
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
): EditResult {
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
