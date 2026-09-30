/**
 * Bord du jour de longueur nulle (QUESTIONS D3) : signalé dans `Model.errors` **sauf** quand ce
 * côté est un mur (décision de l'utilisateur du 2026-09-30, suite de la vague J) : contre un
 * angle de mur, aucun limon ni garde-corps de jour n'est nécessaire.
 *
 * Le tracé décrit le bord dégénéré (`Layout.zeroLengthInner` : coin intérieur K de chaque
 * tournant du côté du jour, directions des volées entrante et sortante) sans lire les murs ; ce
 * module décide, dans le pipeline, avec les mêmes conventions que les garde-corps :
 *
 * - `guards.flight.inner` imposé : `wall` → aucune erreur, `void` → erreur ;
 * - `auto` (ou projet sans garde-corps) : détection des murs du site comme `guards/sides.ts`
 *   (`wallCover`) : chaque coin K doit être adossé à un mur. Un mur y est adossé s'il longe le
 *   prolongement du bord du jour d'une des deux volées **du côté vide** (parallèle à
 *   `WALL_PARALLEL_DEG` près, du côté vide, nu à au plus `guards.wallTolerance` de la droite du
 *   bord) et s'étend dans le quadrant vide de K (derrière K le long de la volée entrante, au-delà
 *   le long de la volée sortante), son axe arrivant à au plus `wallTolerance` de K. Aucun seuil
 *   nouveau : tolérances de détection des garde-corps.
 */
import * as V from "../geom2d/vec.js";
import { POLY_EPS } from "../guards/polyline.js";
import { WALL_PARALLEL_DEG } from "../guards/sides.js";
import { GuardsSpecSchema } from "../guards/spec.js";
import type { Layout, ZeroLengthInnerCorner } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { Project, Wall } from "../model/project.js";

/** Message de `Model.errors` quand le bord du jour de longueur nulle n'est pas contre un mur. */
export const ZERO_LENGTH_JOUR_ERROR =
  "Bord du jour de longueur nulle (tournant sans partie droite de part et d'autre, jour à angle vif) : les limons et garde-corps de jour n'ont pas d'appui ; allonger une volée ou prévoir un poteau.";

/** Tolérance de détection des murs quand le projet n'a pas de garde-corps (défaut du schéma). */
const DEFAULT_WALL_TOLERANCE: Mm = GuardsSpecSchema.parse({}).wallTolerance;

/**
 * Vrai si le mur longe, du côté vide, la droite (K, d) et s'étend dans le quadrant vide de K :
 * `ahead` = au-delà de K dans le sens d (volée sortante), sinon en deçà (volée entrante).
 */
function wallAlong(
  k: Vec2,
  d: Vec2,
  ahead: boolean,
  wall: Wall,
  tolerance: Mm,
  voidSign: 1 | -1,
): boolean {
  const wl = V.distance(wall.a, wall.b);
  if (wl < POLY_EPS) return false;
  const wd = V.scale(V.sub(wall.b, wall.a), 1 / wl);
  if (Math.abs(V.cross(d, wd)) > Math.sin((WALL_PARALLEL_DEG * Math.PI) / 180)) return false;
  // Distance signée (gauche > 0) de l'axe du mur à la droite du bord, au milieu du mur.
  const signed = V.cross(d, V.sub(V.lerp(wall.a, wall.b, 0.5), k));
  if (signed * voidSign < 0) return false;
  const face = Math.abs(signed) - wall.thickness / 2;
  if (face > tolerance || face < -wall.thickness / 2 - POLY_EPS) return false;
  const t0 = V.dot(V.sub(wall.a, k), d);
  const t1 = V.dot(V.sub(wall.b, k), d);
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  return ahead ? hi > 0 && lo <= tolerance : lo < 0 && hi >= -tolerance;
}

/** Vrai si le coin K du bord dégénéré est adossé à un mur du site. */
function cornerAgainstWall(
  c: ZeroLengthInnerCorner,
  walls: readonly Wall[],
  tolerance: Mm,
  voidSign: 1 | -1,
): boolean {
  return walls.some(
    (w) =>
      wallAlong(c.corner, c.incoming, false, w, tolerance, voidSign) ||
      wallAlong(c.corner, c.outgoing, true, w, tolerance, voidSign),
  );
}

/**
 * Vrai si le bord du jour de longueur nulle du tracé est un mur (imposé par
 * `guards.flight.inner`, ou détecté à chaque coin) ; faux s'il n'y a pas de bord dégénéré.
 */
export function zeroLengthJourAgainstWall(project: Project, layout: Layout): boolean {
  const corners = layout.zeroLengthInner;
  if (corners === undefined) return false;
  const mode = project.guards?.flight.inner ?? "auto";
  if (mode !== "auto") return mode === "wall";
  if (corners.length === 0) return false;
  const tolerance = project.guards?.wallTolerance ?? DEFAULT_WALL_TOLERANCE;
  // Vide à gauche du bord intérieur quand il est à gauche (`guards/sides.ts`, `voidSign`).
  const voidSign: 1 | -1 = layout.innerSide === "left" ? 1 : -1;
  return corners.every((c) => cornerAgainstWall(c, project.site.walls, tolerance, voidSign));
}

/**
 * Erreur du bord du jour de longueur nulle, ou `undefined` (bord non dégénéré, ou contre un mur).
 */
export function zeroLengthJourError(project: Project, layout: Layout): string | undefined {
  if (layout.zeroLengthInner === undefined) return undefined;
  return zeroLengthJourAgainstWall(project, layout) ? undefined : ZERO_LENGTH_JOUR_ERROR;
}
