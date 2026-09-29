/**
 * Bord de mesure de la ligne de foulée d'un **escalier droit** (décision A16 de l'utilisateur,
 * 2026-09-29).
 *
 * Sur un escalier droit, aucun jour ne désigne le « bord intérieur » d'où mesurer d_f (DTU 36.3 :
 * 600 mm « de la rampe côté intérieur » si E > 1 200 mm, ou distance saisie). Le bord est :
 *
 * - celui que l'utilisateur a choisi (`stair.walkline.side`, formulaire du tracé) ;
 * - sinon (automatique) le côté de la **main courante principale** : le côté vide s'il y a un
 *   garde-corps (un seul côté vide), sinon le côté mur (deux murs : celui de la main courante
 *   murale, `handrail.wallSides`) ; à défaut (deux côtés vides, mains courantes des deux côtés),
 *   le bord gauche, convention antérieure.
 *
 * Nature d'un côté : `guards.flight.inner` / `outer` quand ils sont imposés (`void` / `wall` ; le
 * bord gauche d'un escalier droit est son bord `inner`, `Layout.innerSide = "left"`), sinon
 * détection des murs du site comme les garde-corps (`wallCover`, `guards.wallTolerance`) : le
 * côté est « mur » si les murs le longent sur toute sa longueur (à 1 mm près), « vide » dès
 * qu'une portion reste sans mur (elle porte un garde-corps).
 *
 * `Layout.innerSide` reste `left` quel que soit le bord de mesure : les côtés `inner` / `outer`
 * des garde-corps et des structures ne changent pas de sens ; seule la position de Γ change.
 */
import * as V from "../geom2d/vec.js";
import { wallCover } from "../guards/sides.js";
import { GuardsSpecSchema, type GuardSideMode } from "../guards/spec.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { Project, WalklineSide } from "../model/project.js";
import { resolveLegLengths } from "./resolve.js";

/** Nature d'un côté d'escalier droit pour le choix du bord de mesure. */
export type StraightSideKind = "void" | "wall";

/** Tolérance (mm) de raccord des couvertures de murs, comme `sideIntervals`. */
const COVER_EPS = 1;

/** Tolérance de détection des murs quand le projet n'a pas de garde-corps (défaut du schéma). */
const DEFAULT_WALL_TOLERANCE: Mm = GuardsSpecSchema.parse({}).wallTolerance;

/** Longueur du bord `[p, q]` couverte par les murs du site (union des couvertures). */
function coveredLength(p: Vec2, q: Vec2, project: Project, sideSign: 1 | -1): Mm {
  const tolerance = project.guards?.wallTolerance ?? DEFAULT_WALL_TOLERANCE;
  const covers = project.site.walls
    .map((w) => wallCover(p, q, w, tolerance, sideSign))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let from = Number.NEGATIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const c of covers) {
    if (c.from <= to + COVER_EPS) to = Math.max(to, c.to);
    else {
      if (to > from) total += to - from;
      from = c.from;
      to = c.to;
    }
  }
  if (to > from) total += to - from;
  return total;
}

/**
 * Nature des bords gauche et droit d'un escalier droit de longueur `length` (bord extérieur,
 * mm), en repère monde.
 */
export function straightSideKinds(
  project: Project,
  length: Mm,
): Readonly<Record<WalklineSide, StraightSideKind>> {
  const width = project.stair.layout.width;
  const { origin, rotation } = project.stair.placement;
  const angle = (rotation * Math.PI) / 180;
  const w = (x: Mm, y: Mm): Vec2 => V.add(V.rotate(V.vec(x, y), angle), origin);
  const flight = project.guards?.flight;
  const kindOf = (side: WalklineSide): StraightSideKind => {
    const mode: GuardSideMode = (side === "left" ? flight?.inner : flight?.outer) ?? "auto";
    if (mode !== "auto") return mode;
    const x = side === "left" ? 0 : width;
    // Vide à gauche du bord gauche (+1) et à droite du bord droit (−1), dans le sens de montée.
    const covered = coveredLength(w(x, 0), w(x, length), project, side === "left" ? 1 : -1);
    return covered > 0 && covered >= length - COVER_EPS ? "wall" : "void";
  };
  return { left: kindOf("left"), right: kindOf("right") };
}

/**
 * Bord de mesure automatique d'un escalier droit (voir l'en-tête du module) : côté vide s'il
 * est seul à l'être, sinon côté de la main courante murale entre deux murs, sinon gauche.
 */
export function autoWalklineSide(project: Project, length: Mm): WalklineSide {
  const kinds = straightSideKinds(project, length);
  if (kinds.left !== kinds.right) return kinds.left === "void" ? "left" : "right";
  if (kinds.left === "wall") {
    // Deux murs : main courante murale ; `auto` la pose du côté extérieur (droit) quand il
    // longe un mur (`guards/compute.ts`), `inner` / `outer` imposés sont respectés.
    const wallSides = project.guards?.handrail.wallSides ?? "auto";
    if (wallSides === "inner") return "left";
    if (wallSides === "outer" || wallSides === "auto") return "right";
  }
  return "left";
}

/**
 * Bord de mesure de la ligne de foulée d'un escalier droit : choix de l'utilisateur, sinon
 * `autoWalklineSide`.
 */
export function resolveWalklineSide(project: Project, length: Mm): WalklineSide {
  return project.stair.walkline.side ?? autoWalklineSide(project, length);
}

/**
 * Clé de mémoïsation de l'étape « tracé » (`pipeline/build.ts`) : le bord automatique d'un
 * escalier droit lit les murs du site et les garde-corps, absents des autres clés de l'étape.
 * Rend le bord automatique (valeur primitive, comparée par valeur) d'un escalier droit sans
 * choix explicite, `undefined` sinon (tournants, hélicoïdal, choix explicite, tracé invalide :
 * `computeLayout` rendra alors l'erreur).
 */
export function autoWalklineSideKey(project: Project): WalklineSide | undefined {
  const spec = project.stair.layout;
  if (spec.kind === "helical" || spec.turns.length > 0 || spec.legs.length !== 1) return undefined;
  if (project.stair.walkline.side !== undefined) return undefined;
  try {
    return autoWalklineSide(project, resolveLegLengths(project)[0]!);
  } catch {
    return undefined;
  }
}
