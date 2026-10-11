/**
 * Tronçons droits d'une cage (ADR-0010) : longueurs, étendues « au mur », faisabilité et bornes
 * des parties droites des bords et de la ligne de foulée Γ.
 *
 * ## Convention de mesure (amendement d'ADR-0010, sous-lot 1b)
 *
 * `axis.length` d'un tronçon droit est la longueur de sa **partie droite**, hors carrés d'angle
 * E × E des jonctions voisines, mesurée sur le bord d'ancrage (`anchor`, milieu par défaut ;
 * indifférent tant que la largeur est constante). Une volée de longueur L (au mur, carrés
 * d'angle compris) avec k tournants voisins (0, 1 ou 2) devient un tronçon de longueur
 * L − k·E, et inversement (`fromFlights.ts`). Le moteur retrouve l'étendue L = débords +
 * partie droite : à ±90°, chaque débord vaut E.
 *
 * Convention à valider par l'utilisateur (question F11, `docs/QUESTIONS.md`).
 *
 * ## Vocabulaire des erreurs (`CageOrigin`)
 *
 * Une cage issue d'un tracé à volées (`flightsToCage`) rend les erreurs du moteur à volées, à
 * l'identique (parité) : « volée », longueurs « au mur ». Une cage saisie rend les erreurs
 * `layout.cage.*` : « tronçon », longueurs de partie droite, comme la saisie.
 */
import type { Mm } from "../../model/primitives.js";
import type { CageLayoutSpec, Project } from "../../model/project.js";
import { GEOM_EPS } from "../../geom2d/tolerance.js";
import { msg, type Message } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { resolveStraightRun } from "../resolve.js";
import type { SectionFrame } from "./frames.js";
import { walkSetback, wellSetback, type Side, type SupportedWell } from "./junction.js";

/**
 * Origine de la cage calculée, qui fixe le vocabulaire des erreurs : `flights` pour une cage
 * issue de `flightsToCage` (messages du moteur à volées, parité), `cage` pour une cage saisie.
 */
export type CageOrigin = "cage" | "flights";

/** Jonction voisine d'un tronçon, vue de ce tronçon. */
export interface NeighbourJunction {
  /** Côté du jour (sens du tournant). */
  readonly side: Side;
  readonly well: SupportedWell;
}

/** Tronçon et ses jonctions d'entrée (`prev`) et de sortie (`next`). */
export interface SectionContext {
  readonly frame: SectionFrame;
  readonly prev?: NeighbourJunction | undefined;
  readonly next?: NeighbourJunction | undefined;
}

/**
 * Longueurs des parties droites (`axis.length`), `auto` résolu (cage d'un seul tronçon :
 * reculement déduit du giron cible, comme une volée droite). Axes droits seulement (l'appelant a
 * refusé les axes en arc).
 * @throws LayoutError si `auto` est employé avec plusieurs tronçons.
 */
export function resolveStraightLengths(project: Project, spec: CageLayoutSpec): Mm[] {
  return spec.sections.map((section, i) => {
    const axis = section.axis;
    if (axis.kind !== "straight") {
      throw new LayoutError(msg("layout.cage.arcAxisNotYetSupported", { section: i + 1 }));
    }
    if (axis.length !== "auto") return axis.length;
    if (spec.sections.length !== 1) {
      throw new LayoutError(msg("layout.cage.autoLengthSingleSection", { section: i + 1 }));
    }
    return resolveStraightRun(project);
  });
}

/**
 * Étendues « au mur » des tronçons (débords des jonctions à ±90° compris : E de chaque côté
 * tournant) : longueur d'une volée.
 * @throws LayoutError si une étendue n'est pas finie et positive : `layout.invalidLegLength`
 *   (longueur au mur) pour une cage issue de volées, `layout.cage.invalidSectionLength`
 *   (partie droite saisie) pour une cage saisie.
 */
export function sectionExtents(straight: readonly Mm[], width: Mm, origin: CageOrigin): Mm[] {
  const last = straight.length - 1;
  return straight.map((s, i) => {
    const lead = i > 0 ? width : 0;
    const tail = i < last ? width : 0;
    const length = lead + s + tail;
    if (!(Number.isFinite(length) && length > 0)) {
      throw new LayoutError(
        origin === "flights"
          ? msg("layout.invalidLegLength", { flight: i + 1, length: String(s) })
          : msg("layout.cage.invalidSectionLength", { section: i + 1, length: String(s) }),
      );
    }
    return length;
  });
}

/**
 * Faisabilité du tronçon `index` : son étendue doit contenir les carrés d'angle et les retraits
 * des raccords de jour voisins.
 * @throws LayoutError sinon : `layout.legTooShort` pour une cage issue de volées (même message
 *   et mêmes paramètres que le moteur à volées : longueur au mur et minimum requis au mur),
 *   `layout.cage.sectionTooShort` pour une cage saisie (partie droite saisie et minimum de la
 *   partie droite : somme des retraits des raccords de jour voisins).
 */
export function checkSectionLength(
  ctx: SectionContext,
  index: number,
  width: Mm,
  origin: CageOrigin,
): void {
  const before = ctx.prev !== undefined ? width + wellSetback(ctx.prev.well) : 0;
  const after = ctx.next !== undefined ? width + wellSetback(ctx.next.well) : 0;
  const required = before + after;
  if (ctx.frame.length < required - GEOM_EPS) {
    const { frame } = ctx;
    const corners = frame.lead + frame.tail;
    const message: Message =
      origin === "flights"
        ? msg("layout.legTooShort", {
            flight: index + 1,
            length: String(frame.length),
            required: String(required),
          })
        : msg("layout.cage.sectionTooShort", {
            section: index + 1,
            length: String(frame.length - corners),
            required: String(required - corners),
          });
    throw new LayoutError(message);
  }
}

/**
 * Abscisses (le long de u, depuis l'origine du tronçon) de la partie droite du bord `side` : ce
 * bord porte le raccord de jour des jonctions de son côté (retrait E + retrait du raccord) et
 * l'angle vif du mur des autres (jusqu'au coin W).
 */
export function edgeRange(ctx: SectionContext, side: Side, width: Mm): readonly [Mm, Mm] {
  const { frame, prev, next } = ctx;
  const t0 = prev === undefined ? 0 : prev.side === side ? width + wellSetback(prev.well) : 0;
  const t1 =
    next === undefined
      ? frame.length
      : next.side === side
        ? frame.length - width - wellSetback(next.well)
        : frame.length;
  return [t0, t1];
}

/** Abscisses de la partie droite de Γ (retrait E + rayon du raccord de jour en arc). */
export function walkRange(ctx: SectionContext, width: Mm): readonly [Mm, Mm] {
  const { frame, prev, next } = ctx;
  const t0 = prev !== undefined ? width + walkSetback(prev.well) : 0;
  const t1 = next !== undefined ? frame.length - width - walkSetback(next.well) : frame.length;
  return [t0, t1];
}
