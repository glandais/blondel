/**
 * Modifications pures du site issues de la saisie assistée (jalon 7) : trémie polygonale, murs,
 * calque de fond. Chaque fonction rend un nouveau projet (copie sur écriture), sans valider le
 * schéma complet (le store de l'interface le fait). Mutateurs de l'éditeur 2D (ADR-0010, plan D,
 * sous-lot 3a) en fin de fichier : contrat `EditResult` (`model/edit.ts`), refus typé au lieu
 * d'une exception, arrondi au mm, partage structurel.
 */
import { isMessage, msg, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import { editError, roundMm, shareStructure, type EditResult } from "../model/edit.js";
import { MessageRangeError, zodIssueMessage } from "../project/errors.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import {
  SiteSchema,
  roomDefectMessage,
  type Obstacle,
  type Opening,
  type Project,
  type Site,
  type Wall,
} from "../model/project.js";
import { polygonOpening, validateOpeningPolygon } from "./opening.js";
import { storedPolygonDefect } from "./simplePolygon.js";
import type { DxfUnderlay, ImageUnderlay, Underlay } from "./schema.js";

/** Remplace la trémie par le polygone saisi (forme canonique, voir `polygonOpening`). */
export function withOpeningPolygon(project: Project, points: readonly Vec2[]): Project {
  return { ...project, site: { ...project.site, opening: polygonOpening(points) } };
}

/** Identifiant de mur libre (`wall-1`, `wall-2`…). */
export function nextWallId(walls: readonly Wall[]): string {
  const used = new Set(walls.map((w) => w.id));
  let i = walls.length + 1;
  while (used.has(`wall-${i}`)) i++;
  return `wall-${i}`;
}

/** Identifiant d'obstacle libre (`obstacle-1`, `obstacle-2`…), comme `nextWallId`. */
export function nextObstacleId(site: Pick<Site, "obstacles">): string {
  const obstacles = site.obstacles ?? [];
  const used = new Set(obstacles.map((o) => o.id));
  let i = obstacles.length + 1;
  while (used.has(`obstacle-${i}`)) i++;
  return `obstacle-${i}`;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Ligne tracée d'un mur : son **axe** (convention de `WallSchema`), ou l'un de ses **nus**, le
 * corps du mur étant alors à gauche ou à droite de la ligne parcourue de `a` vers `b`. Un plan
 * DXF montre les nus des murs : tracer un nu accroché au plan évite de décaler le mur d'une
 * demi-épaisseur.
 */
export type WallTraceReference = "axis" | "left" | "right";

/**
 * Ajoute un mur tracé de `a` à `b` ; `thickness` en mm entiers ; `reference` : ligne tracée
 * (axe par défaut, voir `WallTraceReference`), l'axe enregistré en est déduit.
 * Lève une `RangeError` si le tracé est de longueur nulle ou l'épaisseur invalide.
 */
export function withWall(
  project: Project,
  a: Vec2,
  b: Vec2,
  thickness: Mm,
  loadBearing = false,
  reference: WallTraceReference = "axis",
): Project {
  const L = V.distance(a, b);
  if (!(L >= 1)) throw new MessageRangeError(msg("site.wall.zeroLength"));
  if (!(Number.isInteger(thickness) && thickness > 0)) {
    throw new MessageRangeError(msg("site.wall.invalidThickness"));
  }
  // Axe = ligne tracée décalée d'une demi-épaisseur vers le corps du mur.
  const shift =
    reference === "axis"
      ? { x: 0, y: 0 }
      : V.scale(
          V.perpLeft(V.scale(V.sub(b, a), 1 / L)),
          (reference === "left" ? 1 : -1) * (thickness / 2),
        );
  const wall: Wall = {
    id: nextWallId(project.site.walls),
    a: { x: r1(a.x + shift.x), y: r1(a.y + shift.y) },
    b: { x: r1(b.x + shift.x), y: r1(b.y + shift.y) },
    thickness,
    loadBearing,
  };
  return { ...project, site: { ...project.site, walls: [...project.site.walls, wall] } };
}

/** Retire un mur par identifiant. */
export function withoutWall(project: Project, id: string): Project {
  return {
    ...project,
    site: { ...project.site, walls: project.site.walls.filter((w) => w.id !== id) },
  };
}

/** Calque de fond après modification ; un calque vide est retiré du projet. */
function setUnderlay(project: Project, underlay: Underlay): Project {
  const { underlay: _old, ...site } = project.site;
  const empty = underlay.dxf === undefined && underlay.image === undefined;
  return { ...project, site: empty ? site : { ...site, underlay } };
}

function cleaned(u: Underlay): Underlay {
  return Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) as Underlay;
}

/** Remplace (ou retire, `undefined`) le calque DXF. */
export function withDxfUnderlay(project: Project, dxf: DxfUnderlay | undefined): Project {
  return setUnderlay(project, cleaned({ ...project.site.underlay, dxf }));
}

/** Remplace (ou retire, `undefined`) l'image de fond. */
export function withImageUnderlay(project: Project, image: ImageUnderlay | undefined): Project {
  return setUnderlay(project, cleaned({ ...project.site.underlay, image }));
}

/** Règle l'opacité d'affichage du calque (sans effet s'il n'y a pas de calque). */
export function withUnderlayOpacity(project: Project, opacity: number): Project {
  const u = project.site.underlay;
  if (!u) return project;
  return setUnderlay(project, { ...u, opacity: Math.min(1, Math.max(0, opacity)) });
}

// ------------------------------------------------------------------ Mutateurs purs (sous-lot 3a)
//
// Contrat `EditResult` (`model/edit.ts`) : projet modifié, ou le même objet si l'opération est
// sans effet, ou refus typé (`Message`) si elle produirait un site invalide (mur dégénéré,
// épaisseur non positive, contour non simple au sens de `storedPolygonDefect`, obstacle refusé
// par le schéma). Coordonnées et cotes **saisies** arrondies au mm entier (ADR-0003) : un
// sommet déplacé est arrondi, une translation l'est par son vecteur (les autres sommets gardent
// leurs coordonnées) ; angles d'obstacle au degré entier. Sous-objets inchangés partagés.

/** Point arrondi au mm (sans −0). */
function roundPoint(p: Vec2): Vec2 {
  return { x: roundMm(p.x), y: roundMm(p.y) };
}

/** Somme sans bruit de flottant (sommets au dixième de mm de la trémie, voir `opening.ts`). */
const clean = (v: number): number => Number(v.toFixed(6)) + 0;

function translated(p: Vec2, d: Vec2): Vec2 {
  return { x: clean(p.x + d.x), y: clean(p.y + d.y) };
}

/** Projet au site `site`, partagé avec l'ancien (même projet si rien ne change). */
function withSite(project: Project, site: Site): EditResult {
  const shared = shareStructure(project.site, site);
  return { project: shared === project.site ? project : { ...project, site: shared } };
}

function findWall(project: Project, id: string): Wall | undefined {
  return project.site.walls.find((w) => w.id === id);
}

function replaceWall(project: Project, wall: Wall): EditResult {
  if (!(V.distance(wall.a, wall.b) >= 1)) return editError(msg("site.wall.zeroLength"));
  return withSite(project, {
    ...project.site,
    walls: project.site.walls.map((w) => (w.id === wall.id ? wall : w)),
  });
}

const unknownWall = (id: string) => editError(msg("site.edit.unknownWall", { id }));

/** Déplace l'extrémité `end` de l'axe du mur `id` au point `point` (arrondi au mm). */
export function moveWallEnd(project: Project, id: string, end: "a" | "b", point: Vec2): EditResult {
  const wall = findWall(project, id);
  if (!wall) return unknownWall(id);
  return replaceWall(project, { ...wall, [end]: roundPoint(point) });
}

/** Translate le mur `id` du vecteur `delta` (arrondi au mm). */
export function translateWall(project: Project, id: string, delta: Vec2): EditResult {
  const wall = findWall(project, id);
  if (!wall) return unknownWall(id);
  const d = roundPoint(delta);
  return replaceWall(project, { ...wall, a: translated(wall.a, d), b: translated(wall.b, d) });
}

/** Épaisseur du mur `id` (mm, arrondie ; strictement positive). */
export function setWallThickness(project: Project, id: string, thickness: Mm): EditResult {
  const wall = findWall(project, id);
  if (!wall) return unknownWall(id);
  const t = roundMm(thickness);
  if (!(t > 0)) return editError(msg("site.wall.invalidThickness"));
  return replaceWall(project, { ...wall, thickness: t });
}

/** Mur porteur ou non. */
export function setWallLoadBearing(project: Project, id: string, loadBearing: boolean): EditResult {
  const wall = findWall(project, id);
  if (!wall) return unknownWall(id);
  return replaceWall(project, { ...wall, loadBearing });
}

/**
 * Coupe le mur `id` au projeté de `point` sur son axe (arrondi au mm) : le mur garde son
 * identifiant de `a` au point de coupe, un nouveau mur (`id` rendu, `nextWallId`, même épaisseur
 * et même caractère porteur) va du point de coupe à `b`, inséré juste après. Refusé si l'un des
 * deux morceaux mesurerait moins de 1 mm.
 */
export function splitWall(project: Project, id: string, point: Vec2): EditResult<{ id: string }> {
  const wall = findWall(project, id);
  if (!wall) return unknownWall(id);
  const u = V.sub(wall.b, wall.a);
  const L2 = V.normSq(u);
  const t = L2 > 0 ? V.dot(V.sub(point, wall.a), u) / L2 : 0;
  const cut = roundPoint(V.addScaled(wall.a, u, Math.min(1, Math.max(0, t))));
  if (!(V.distance(wall.a, cut) >= 1 && V.distance(cut, wall.b) >= 1)) {
    return editError(msg("site.edit.wallSplitOutside", { id }));
  }
  const newId = nextWallId(project.site.walls);
  const walls = project.site.walls.flatMap((w) =>
    w.id === id
      ? [
          { ...w, b: cut },
          { ...w, id: newId, a: cut },
        ]
      : [w],
  );
  const r = withSite(project, { ...project.site, walls });
  return r.error ? r : { project: r.project, id: newId };
}

/** Retire le mur `id` (contrat `EditResult` de `withoutWall` : mur inconnu refusé). */
export function removeWall(project: Project, id: string): EditResult {
  if (!findWall(project, id)) return unknownWall(id);
  return withSite(project, {
    ...project.site,
    walls: project.site.walls.filter((w) => w.id !== id),
  });
}

/** Nu d'un mur : côté gauche ou droit de son axe parcouru de `a` vers `b`. */
export type WallSide = "left" | "right";

/** Normale unitaire du nu `side` (vers l'extérieur du mur) ; `null` pour un axe dégénéré. */
function faceNormal(wall: Wall, side: WallSide): Vec2 | null {
  const u = V.sub(wall.b, wall.a);
  const L = V.norm(u);
  if (!(L > 0)) return null;
  const left = V.perpLeft(V.scale(u, 1 / L));
  return side === "left" ? left : V.scale(left, -1);
}

/**
 * Épaisseur du mur `id` (mm, arrondie ; strictement positive) en **conservant le nu `keep`** :
 * l'axe se décale d'une demi-variation vers le nu opposé. Ce décalage est arrondi au mm comme
 * une translation (`translateWall`) : l'axe reste en mm entiers (ADR-0003, plan F §D), le nu
 * conservé peut donc bouger d'au plus √2/2 mm (0,5 mm sur un mur parallèle à un axe).
 */
export function setWallThicknessKeepingFace(
  project: Project,
  id: string,
  thickness: Mm,
  keep: WallSide,
): EditResult {
  const wall = findWall(project, id);
  if (!wall) return unknownWall(id);
  const t = roundMm(thickness);
  if (!(t > 0)) return editError(msg("site.wall.invalidThickness"));
  if (t === wall.thickness) return { project };
  const n = faceNormal(wall, keep === "left" ? "right" : "left");
  if (!n) return editError(msg("site.wall.zeroLength"));
  const d = roundPoint(V.scale(n, (t - wall.thickness) / 2));
  return replaceWall(project, {
    ...wall,
    a: translated(wall.a, d),
    b: translated(wall.b, d),
    thickness: t,
  });
}

/**
 * Glisser du nu `side` du mur `id` jusqu'à `point` (poignée d'épaisseur) : nouvelle épaisseur =
 * distance de `point` au nu opposé, mesurée selon la normale (arrondie au mm), nu opposé
 * conservé (`setWallThicknessKeepingFace`, à l'arrondi de l'axe au mm près). Refusé si le point
 * passe au-delà du nu opposé.
 */
export function dragWallFace(
  project: Project,
  id: string,
  side: WallSide,
  point: Vec2,
): EditResult {
  const wall = findWall(project, id);
  if (!wall) return unknownWall(id);
  const n = faceNormal(wall, side);
  if (!n) return editError(msg("site.wall.zeroLength"));
  // Nu opposé : axe décalé d'une demi-épaisseur à l'opposé de `n`.
  const opposite = V.addScaled(wall.a, n, -wall.thickness / 2);
  const thickness = V.dot(V.sub(point, opposite), n);
  return setWallThicknessKeepingFace(project, id, thickness, side === "left" ? "right" : "left");
}

// --- Trémie

/** Sommets d'une trémie, dans l'ordre enregistré (rectangle : coin min puis sens trigonométrique). */
export function openingVertices(opening: Opening): Vec2[] {
  if (opening.kind === "polygon") return [...opening.points];
  const { x, y, sizeX, sizeY } = opening;
  return [
    { x, y },
    { x: x + sizeX, y },
    { x: x + sizeX, y: y + sizeY },
    { x, y: y + sizeY },
  ];
}

function openingDefectMessage(points: readonly Vec2[]): Message | null {
  const stored = storedPolygonDefect(points);
  if (stored?.kind === "duplicateVertex") {
    return msg("site.opening.duplicateVertex", { index: stored.index, other: stored.other });
  }
  return validateOpeningPolygon(points)[0] ?? null;
}

const vertexIndexError = (index: number, count: number) =>
  editError(msg("site.edit.vertexIndex", { index: index + 1, count }));

/**
 * Déplace le sommet `index` (à partir de 0, ordre de `openingVertices`) de la trémie au point
 * `point` (arrondi au mm) ; une trémie rectangulaire devient polygonale (forme canonique de
 * `polygonOpening`, cercle oublié). Refusé si le contour devient invalide (sommet confondu avec
 * un voisin, aire nulle, recoupement).
 *
 * `index` du résultat : indice du sommet déplacé dans la trémie obtenue. La forme canonique
 * remet le contour en sens trigonométrique : un déplacement qui retourne le contour (sommet
 * tiré au-delà du côté opposé) inverse l'ordre des sommets, et l'interface poursuit le glisser
 * avec cet indice.
 */
export function moveOpeningVertex(
  project: Project,
  index: number,
  point: Vec2,
): EditResult<{ index: number }> {
  const opening = project.site.opening;
  if (!opening) return editError(msg("site.edit.noOpening"));
  const points = openingVertices(opening);
  if (!(Number.isInteger(index) && index >= 0 && index < points.length)) {
    return vertexIndexError(index, points.length);
  }
  const p = roundPoint(point);
  if (p.x === points[index]!.x && p.y === points[index]!.y) return { project, index };
  points[index] = p;
  const defect = openingDefectMessage(points);
  if (defect) return editError(defect);
  const moved = polygonOpening(points);
  // Sommets distincts (contrôlé ci-dessus) et au mm entier : le sommet déplacé se retrouve.
  const at = moved.points.findIndex((q) => q.x === p.x && q.y === p.y);
  const r = withSite(project, { ...project.site, opening: moved });
  return r.error ? r : { project: r.project, index: at >= 0 ? at : index };
}

/** Translate la trémie du vecteur `delta` (arrondi au mm), cercle d'une trémie ronde compris. */
export function translateOpening(project: Project, delta: Vec2): EditResult {
  const opening = project.site.opening;
  if (!opening) return editError(msg("site.edit.noOpening"));
  const d = roundPoint(delta);
  if (d.x === 0 && d.y === 0) return { project };
  const moved: Opening =
    opening.kind === "rect"
      ? { ...opening, x: opening.x + d.x, y: opening.y + d.y }
      : {
          ...opening,
          points: opening.points.map((p) => translated(p, d)),
          ...(opening.circle
            ? { circle: { ...opening.circle, center: translated(opening.circle.center, d) } }
            : {}),
        };
  return withSite(project, { ...project.site, opening: moved });
}

/**
 * Côté de la trémie le plus proche de `point` (indice `i` : du sommet `i` au suivant, ordre de
 * `openingVertices`) ; `null` sans trémie. Double-clic sur un côté : insertion d'un sommet.
 */
export function openingEdgeNear(project: Project, point: Vec2): number | null {
  const opening = project.site.opening;
  if (!opening) return null;
  const pts = openingVertices(opening);
  let best: number | null = null;
  let bestD = Infinity;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const d = V.distance(point, closestOnSegment(a, b, point));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function closestOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const u = V.sub(b, a);
  const L2 = V.normSq(u);
  const t = L2 > 0 ? Math.min(1, Math.max(0, V.dot(V.sub(p, a), u) / L2)) : 0;
  return V.addScaled(a, u, t);
}

/** Trémie polygonale canonique aux sommets `points`, ou refus (contour invalide). */
function withOpeningPoints(
  project: Project,
  points: readonly Vec2[],
  at: Vec2,
  fallback: number,
): EditResult<{ index: number }> {
  const defect = openingDefectMessage(points);
  if (defect) return editError(defect);
  const next = polygonOpening(points);
  const found = next.points.findIndex((q) => q.x === at.x && q.y === at.y);
  const r = withSite(project, { ...project.site, opening: next });
  return r.error ? r : { project: r.project, index: found >= 0 ? found : fallback };
}

/**
 * Insère un sommet sur le côté `edge` de la trémie (du sommet `edge` au suivant, ordre de
 * `openingVertices`) : au projeté de `point` sur ce côté (arrondi au mm), ou en son milieu sans
 * `point`. Il devient le sommet `edge + 1` (`index` du résultat : son indice dans la trémie
 * obtenue, forme canonique). Une trémie rectangulaire devient polygonale ; refusé si le sommet
 * se confond avec une extrémité du côté.
 */
export function insertOpeningVertex(
  project: Project,
  edge: number,
  point?: Vec2,
): EditResult<{ index: number }> {
  const opening = project.site.opening;
  if (!opening) return editError(msg("site.edit.noOpening"));
  const points = openingVertices(opening);
  if (!(Number.isInteger(edge) && edge >= 0 && edge < points.length)) {
    return vertexIndexError(edge, points.length);
  }
  const a = points[edge]!;
  const b = points[(edge + 1) % points.length]!;
  const p = roundPoint(point ? closestOnSegment(a, b, point) : V.lerp(a, b, 0.5));
  points.splice(edge + 1, 0, p);
  return withOpeningPoints(project, points, p, edge + 1);
}

/**
 * Retire le sommet `index` de la trémie (ordre de `openingVertices`) ; refusé sous 3 sommets
 * ou si le contour devient invalide. Une trémie rectangulaire devient un triangle polygonal.
 */
export function removeOpeningVertex(project: Project, index: number): EditResult {
  const opening = project.site.opening;
  if (!opening) return editError(msg("site.edit.noOpening"));
  const points = openingVertices(opening);
  if (!(Number.isInteger(index) && index >= 0 && index < points.length)) {
    return vertexIndexError(index, points.length);
  }
  points.splice(index, 1);
  const defect = openingDefectMessage(points);
  if (defect) return editError(defect);
  return withSite(project, { ...project.site, opening: polygonOpening(points) });
}

// --- Contour de pièce

function withRoomPoints(project: Project, points: readonly Vec2[]): EditResult {
  const defect = storedPolygonDefect(points);
  if (defect) return editError(roomDefectMessage(defect));
  return withSite(project, { ...project.site, room: { points: [...points] } });
}

/**
 * Remplace le contour de pièce par `points` (arrondis au mm, ordre saisi conservé), ou le
 * retire (`undefined`). Refusé si le contour est invalide (`storedPolygonDefect`).
 */
export function withRoom(project: Project, points: readonly Vec2[] | undefined): EditResult {
  if (points === undefined) {
    if (project.site.room === undefined) return { project };
    const { room: _room, ...site } = project.site;
    return { project: { ...project, site } };
  }
  return withRoomPoints(project, points.map(roundPoint));
}

function roomPoints(project: Project): Vec2[] | { error: Message } {
  const room = project.site.room;
  return room ? [...room.points] : editError(msg("site.edit.noRoom"));
}

/** Déplace le sommet `index` du contour de pièce au point `point` (arrondi au mm). */
export function moveRoomVertex(project: Project, index: number, point: Vec2): EditResult {
  const points = roomPoints(project);
  if (!Array.isArray(points)) return points;
  if (!(Number.isInteger(index) && index >= 0 && index < points.length)) {
    return vertexIndexError(index, points.length);
  }
  points[index] = roundPoint(point);
  return withRoomPoints(project, points);
}

/**
 * Insère un sommet `point` (arrondi au mm) sur le côté `edge` du contour de pièce (du sommet
 * `edge` au suivant) : il devient le sommet `edge + 1`.
 */
export function insertRoomVertex(project: Project, edge: number, point: Vec2): EditResult {
  const points = roomPoints(project);
  if (!Array.isArray(points)) return points;
  if (!(Number.isInteger(edge) && edge >= 0 && edge < points.length)) {
    return vertexIndexError(edge, points.length);
  }
  points.splice(edge + 1, 0, roundPoint(point));
  return withRoomPoints(project, points);
}

/** Retire le sommet `index` du contour de pièce (refusé sous 3 sommets). */
export function removeRoomVertex(project: Project, index: number): EditResult {
  const points = roomPoints(project);
  if (!Array.isArray(points)) return points;
  if (!(Number.isInteger(index) && index >= 0 && index < points.length)) {
    return vertexIndexError(index, points.length);
  }
  points.splice(index, 1);
  return withRoomPoints(project, points);
}

// --- Obstacles

/** Obstacle sans identifiant (attribué par `withObstacle`). */
export type ObstacleDraft = Obstacle extends infer O
  ? O extends Obstacle
    ? Omit<O, "id">
    : never
  : never;

/** Obstacle arrondi : coordonnées et cotes au mm entier, rotation d'un poteau au degré entier. */
function roundObstacle(o: Obstacle): Obstacle {
  switch (o.kind) {
    case "post":
      return {
        ...o,
        center: roundPoint(o.center),
        sizeX: roundMm(o.sizeX),
        sizeY: roundMm(o.sizeY),
        rotation: roundMm(o.rotation ?? 0),
      };
    case "circularPost":
      return { ...o, center: roundPoint(o.center), radius: roundMm(o.radius) };
    case "door":
      return { ...o, a: roundPoint(o.a), b: roundPoint(o.b) };
    case "window":
      return {
        ...o,
        a: roundPoint(o.a),
        b: roundPoint(o.b),
        sill: roundMm(o.sill),
        head: roundMm(o.head),
      };
    case "zone":
      return { ...o, points: o.points.map(roundPoint) };
  }
}

/** Obstacles contrôlés par le schéma du site ; premier défaut sinon. */
function withObstacles(project: Project, obstacles: readonly Obstacle[]): EditResult {
  if (obstacles.length === 0) {
    if (project.site.obstacles === undefined) return { project };
    const { obstacles: _o, ...site } = project.site;
    return { project: { ...project, site } };
  }
  const checked = SiteSchema.shape.obstacles.safeParse(obstacles);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    const own = (issue as { params?: { message?: unknown } }).params?.message;
    return editError(isMessage(own) ? own : zodIssueMessage(issue));
  }
  return withSite(project, { ...project.site, obstacles: [...obstacles] });
}

/** Ajoute un obstacle (arrondi), d'identifiant `nextObstacleId` rendu dans `id`. */
export function withObstacle(project: Project, draft: ObstacleDraft): EditResult<{ id: string }> {
  const id = nextObstacleId(project.site);
  const obstacle = roundObstacle({ ...draft, id } as Obstacle);
  const r = withObstacles(project, [...(project.site.obstacles ?? []), obstacle]);
  return r.error ? r : { project: r.project, id };
}

/** Remplace l'obstacle `id` par `draft` (arrondi ; même identifiant, nature libre). */
export function updateObstacle(project: Project, id: string, draft: ObstacleDraft): EditResult {
  const obstacles = project.site.obstacles ?? [];
  if (!obstacles.some((o) => o.id === id)) {
    return editError(msg("site.edit.unknownObstacle", { id }));
  }
  const obstacle = roundObstacle({ ...draft, id } as Obstacle);
  return withObstacles(
    project,
    obstacles.map((o) => (o.id === id ? obstacle : o)),
  );
}

/** Retire l'obstacle `id` ; le dernier retiré, le champ `obstacles` disparaît du site. */
export function withoutObstacle(project: Project, id: string): EditResult {
  const obstacles = project.site.obstacles ?? [];
  if (!obstacles.some((o) => o.id === id)) {
    return editError(msg("site.edit.unknownObstacle", { id }));
  }
  return withObstacles(
    project,
    obstacles.filter((o) => o.id !== id),
  );
}
