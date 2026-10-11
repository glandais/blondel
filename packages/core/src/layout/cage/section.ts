/**
 * Tronçons droits d'une cage (ADR-0010) : longueurs, étendues « au mur », faisabilité et bornes
 * des parties droites des bords et de la ligne de foulée Γ.
 *
 * ## Convention de mesure (amendement d'ADR-0010, sous-lot 1b)
 *
 * `axis.length` d'un tronçon droit est la longueur de sa **partie droite**, hors zones des
 * jonctions voisines (carrés d'angle E × E à ±90°, « cerf-volant » à un angle quelconque,
 * rectangle d'un palier droit), mesurée sur le bord d'ancrage (`anchor`, milieu par défaut).
 * Les lignes d'arrivée et de départ d'une jonction tournante sont perpendiculaires au tronçon
 * et passent par le coin du jour K : à largeur constante, la partie droite a la même longueur
 * sur les deux bords et sur l'axe, d'où l'indifférence de l'ancrage (sous-lot 2a). Une volée
 * de longueur L (au mur, carrés d'angle compris) avec k tournants voisins (0, 1 ou 2) devient
 * un tronçon de longueur L − k·E, et inversement (`fromFlights.ts`). Le moteur retrouve
 * l'étendue = débords + partie droite (`frames.ts`, `junctionOverhang`) : E·tan(|θ|/2) par
 * jonction tournante (E à ±90°), profondeur du palier pour un palier droit.
 *
 * Convention décidée par l'utilisateur le 2026-10-11 (question F11, `docs/QUESTIONS.md`).
 *
 * ## Vocabulaire des erreurs (`CageOrigin`)
 *
 * Une cage issue d'un tracé à volées (`flightsToCage`) rend les erreurs du moteur à volées, à
 * l'identique (parité) : « volée », longueurs « au mur ». Une cage saisie rend les erreurs
 * `layout.cage.*` : « tronçon », longueurs de partie droite, comme la saisie.
 */
import type { Mm } from "../../model/primitives.js";
import { CAGE_MAX_SECTIONS, type CageLayoutSpec, type Project } from "../../model/project.js";
import { GEOM_EPS } from "../../geom2d/tolerance.js";
import { msg, type Message } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { resolveStraightRun } from "../resolve.js";
import type { SectionFrame } from "./frames.js";
import {
  walkSetback,
  wallSetback,
  wellSetbackIn,
  wellSetbackOut,
  type JunctionGeom,
  type Side,
  type TurnJunction,
} from "./junction.js";

/**
 * Origine de la cage calculée, qui fixe le vocabulaire des erreurs : `flights` pour une cage
 * issue de `flightsToCage` (messages du moteur à volées, parité), `cage` pour une cage saisie.
 */
export type CageOrigin = "cage" | "flights";

/** Tronçon et ses jonctions d'entrée (`prev`) et de sortie (`next`). */
export interface SectionContext {
  readonly frame: SectionFrame;
  readonly prev?: JunctionGeom | undefined;
  readonly next?: JunctionGeom | undefined;
}

const turnOf = (j: JunctionGeom | undefined): TurnJunction | undefined =>
  j?.kind === "turn" ? j : undefined;

/** Valeur en mm pour un message : entière telle quelle, sinon au dixième. */
export function mmText(v: Mm): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Nombre de tronçons et de jonctions. La borne de calcul `CAGE_MAX_SECTIONS` (F8) ne vaut que
 * pour une cage saisie : un tracé à volées n'a pas de borne du nombre de volées
 * (`FlightsLayoutSpecSchema`) et doit rester calculé à l'identique ; une cage issue de volées
 * doit seulement avoir au moins un tronçon.
 * @throws LayoutError (`layout.cage.sectionCount`, `layout.cage.junctionCountMismatch`) sinon.
 */
export function checkSectionCount(spec: CageLayoutSpec, origin: CageOrigin): void {
  const n = spec.sections.length;
  if (n < 1 || (origin === "cage" && n > CAGE_MAX_SECTIONS)) {
    throw new LayoutError(msg("layout.cage.sectionCount", { count: n, max: CAGE_MAX_SECTIONS }));
  }
  if (spec.junctions.length !== n - 1) {
    throw new LayoutError(
      msg("layout.cage.junctionCountMismatch", { sections: n, junctions: spec.junctions.length }),
    );
  }
}

/**
 * Longueurs des tronçons sur le bord d'ancrage : partie droite (`axis.length`) d'un axe droit,
 * `auto` résolu (cage d'un seul tronçon : reculement déduit du giron cible, comme une volée
 * droite) ; longueur d'arc R·|balayage| d'un axe en arc (moteur général, `general.ts`).
 * @throws LayoutError si `auto` est employé avec plusieurs tronçons.
 */
export function resolveStraightLengths(project: Project, spec: CageLayoutSpec): Mm[] {
  return spec.sections.map((section, i) => {
    const axis = section.axis;
    if (axis.kind === "arc") return (axis.radius * Math.abs(axis.sweep) * Math.PI) / 180;
    if (axis.length !== "auto") return axis.length;
    if (spec.sections.length !== 1) {
      throw new LayoutError(msg("layout.cage.autoLengthSingleSection", { section: i + 1 }));
    }
    return resolveStraightRun(project);
  });
}

/**
 * Contrôle des étendues « au mur » des tronçons (`frames.ts` : `lead` + partie droite +
 * `tail`), qui doivent être finies et positives.
 * @throws LayoutError sinon : `layout.invalidLegLength` (longueur au mur) pour une cage issue
 *   de volées, `layout.cage.invalidSectionLength` (partie droite saisie) pour une cage saisie.
 */
export function checkSectionExtents(frames: readonly SectionFrame[], origin: CageOrigin): void {
  frames.forEach((frame, i) => {
    if (!(Number.isFinite(frame.length) && frame.length > 0)) {
      const s = frame.straight;
      throw new LayoutError(
        origin === "flights"
          ? msg("layout.invalidLegLength", { flight: i + 1, length: String(s) })
          : msg("layout.cage.invalidSectionLength", { section: i + 1, length: String(s) }),
      );
    }
  });
}

/**
 * Faisabilité du tronçon `index` : sa partie droite doit contenir les retraits des raccords de
 * jour voisins (de part et d'autre, quel que soit leur côté, comme le moteur à volées), et
 * chaque bord doit contenir ses retraits (raccords de jour de son côté, congés côté mur).
 * @throws LayoutError sinon : `layout.legTooShort` pour une cage issue de volées (même message
 *   et mêmes paramètres que le moteur à volées : longueur au mur et minimum requis au mur),
 *   `layout.cage.sectionTooShort` pour une cage saisie (partie droite saisie et minimum de la
 *   partie droite : somme des retraits des raccords de jour voisins) ;
 *   `layout.cage.wallArcDoesNotFit` si un congé côté mur ne tient pas sur son bord.
 */
export function checkSectionLength(
  ctx: SectionContext,
  index: number,
  width: Mm,
  origin: CageOrigin,
): void {
  const { frame } = ctx;
  const prev = turnOf(ctx.prev);
  const next = turnOf(ctx.next);
  if (origin === "flights") {
    // Tracé à volées : tournants à ±90° seulement (`lead` = `tail` = E), contrôle d'origine.
    const before = prev !== undefined ? width + wellSetbackIn(prev) : 0;
    const after = next !== undefined ? width + wellSetbackIn(next) : 0;
    const required = before + after;
    if (frame.length < required - GEOM_EPS) {
      throw new LayoutError(
        msg("layout.legTooShort", {
          flight: index + 1,
          length: String(frame.length),
          required: String(required),
        }),
      );
    }
    return;
  }
  const required =
    (prev !== undefined ? wellSetbackOut(prev) : 0) +
    (next !== undefined ? wellSetbackIn(next) : 0);
  if (frame.straight < required - GEOM_EPS) {
    throw new LayoutError(
      msg("layout.cage.sectionTooShort", {
        section: index + 1,
        length: mmText(frame.straight),
        required: mmText(required),
      }),
    );
  }
  for (const side of ["left", "right"] as const) {
    const wallArc =
      (prev !== undefined && prev.side !== side && prev.wall.kind === "arc") ||
      (next !== undefined && next.side !== side && next.wall.kind === "arc");
    if (!wallArc) continue;
    const [t0, t1] = edgeRange(ctx, side);
    if (t1 < t0 - GEOM_EPS) {
      const junction =
        next !== undefined && next.side !== side && next.wall.kind === "arc" ? index + 1 : index;
      throw new LayoutError(
        msg("layout.cage.wallArcDoesNotFit", {
          junction,
          section: index + 1,
          required: mmText(t0 + (frame.length - t1)),
          available: mmText(frame.length),
        }),
      );
    }
  }
}

/**
 * Abscisses (le long de u, depuis l'origine du tronçon) de la partie droite du bord `side` : ce
 * bord porte le raccord de jour des jonctions tournantes de son côté (débord + retrait du
 * raccord) et le raccord côté mur des autres (jusqu'au coin W, ou au point de tangence du
 * congé) ; il traverse un palier droit.
 */
export function edgeRange(ctx: SectionContext, side: Side): readonly [Mm, Mm] {
  const { frame } = ctx;
  const prev = turnOf(ctx.prev);
  const next = turnOf(ctx.next);
  const t0 =
    prev === undefined
      ? 0
      : prev.side === side
        ? frame.lead + wellSetbackOut(prev)
        : prev.wall.kind === "arc"
          ? wallSetback(prev)
          : 0;
  const t1 =
    next === undefined
      ? frame.length
      : next.side === side
        ? frame.length - frame.tail - wellSetbackIn(next)
        : next.wall.kind === "arc"
          ? frame.length - wallSetback(next)
          : frame.length;
  return [t0, t1];
}

/**
 * Abscisses de la partie droite de Γ (débord + tangence d'un raccord de jour en arc ; un palier
 * droit voisin arrête Γ droite à la fin de la partie droite, le palier étant sa zone).
 */
export function walkRange(ctx: SectionContext): readonly [Mm, Mm] {
  const { frame, prev, next } = ctx;
  const t0 = prev?.kind === "turn" ? frame.lead + walkSetback(prev) : 0;
  const t1 =
    next === undefined
      ? frame.length
      : next.kind === "turn"
        ? frame.length - frame.tail - walkSetback(next)
        : frame.length - frame.tail;
  return [t0, t1];
}
