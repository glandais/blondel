/**
 * Modifications pures du site issues de la saisie assistée (jalon 7) : trémie polygonale, murs,
 * calque de fond. Chaque fonction rend un nouveau projet (copie sur écriture), sans valider le
 * schéma complet (le store de l'interface le fait).
 */
import * as V from "../geom2d/vec.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { Project, Wall } from "../model/project.js";
import { polygonOpening } from "./opening.js";
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
  if (!(L >= 1)) throw new RangeError("mur : axe de longueur nulle");
  if (!(Number.isInteger(thickness) && thickness > 0)) {
    throw new RangeError("mur : épaisseur en mm entiers positifs attendue");
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
