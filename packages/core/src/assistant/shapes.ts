/**
 * Typologies à volées de l'assistant : volées et tournants d'un candidat à partir de la
 * typologie, de la position du tournant (girons droits avant le premier tournant), de E, n et g.
 *
 * Conventions des préréglages (`project/presets.ts`) : volées mesurées sur le bord extérieur,
 * ligne de foulée à d_f du jour, arc de Γ de rayon d_f dans un tournant balancé (jour vif ou
 * poteau), volée centrale = 2E + jour. Les longueurs sont des mm entiers ; la dernière volée
 * est arrondie **par excès** pour que le giron réel ne tombe pas sous le giron visé (le cas
 * d'acceptation n° 1 a montré qu'un arrondi au plus près pouvait passer sous G_MIN_LOGEMENT).
 */
import { resolveWalklineOffset } from "../layout/resolve.js";
import type { FlightsLayoutSpec, InnerCorner, Project } from "../model/project.js";
import type { Mm } from "../model/primitives.js";
import { ASSISTANT_DEFAULTS } from "./defaults.js";
import type { TypologyId } from "./types.js";

export type FlightsTypology = Exclude<TypologyId, "helical">;

export interface FlightsShape {
  readonly typology: FlightsTypology;
  readonly direction: "left" | "right" | null;
  /** Girons droits sur Γ avant le premier tournant (position du tournant). */
  readonly firstGoings: number;
}

interface TypologyGeometry {
  readonly turns: number;
  readonly mode: "winders" | "landing";
  /** Jour de la volée centrale (mm). */
  readonly middleWell: Mm;
}

export function typologyGeometry(t: FlightsTypology): TypologyGeometry {
  switch (t) {
    case "straight":
      return { turns: 0, mode: "winders", middleWell: 0 };
    case "quarter":
      return { turns: 1, mode: "winders", middleWell: 0 };
    case "two-quarters":
      return { turns: 2, mode: "winders", middleWell: ASSISTANT_DEFAULTS.uMiddleWell };
    case "half-turn":
      return { turns: 2, mode: "winders", middleWell: ASSISTANT_DEFAULTS.halfTurnMiddleWell };
    case "quarter-landing":
      return { turns: 1, mode: "landing", middleWell: 0 };
  }
}

/**
 * Distance d_f de la ligne de foulée au jour pour l'emmarchement `width`, par la **même**
 * fonction que le tracé (`resolveWalklineOffset` : règles LF_POSITION_DTU_* lues dans
 * rules.yaml, ou distance saisie dans le gabarit) — pas de seuil recopié ici.
 * @throws LayoutError si d_f n'est pas strictement dans l'emmarchement.
 */
export function walklineOffsetFor(template: Project, width: Mm): Mm {
  return resolveWalklineOffset({
    ...template,
    stair: { ...template.stair, layout: { ...template.stair.layout, width } },
  });
}

/**
 * Longueurs des volées (bord extérieur, mm entiers) ; `null` si la position du tournant est
 * impossible (partie droite négative, volée sans giron).
 */
export function flightLegs(
  shape: FlightsShape,
  width: Mm,
  riserCount: number,
  going: Mm,
  walklineOffset: Mm,
): number[] | null {
  const geo = typologyGeometry(shape.typology);
  const total = (riserCount - 1) * going;
  const a = shape.firstGoings;
  if (geo.turns === 0) return a === 0 ? [Math.ceil(total - 1e-9)] : null;
  if (geo.mode === "landing") {
    const b = riserCount - 2 - a;
    if (a < 1 || b < 1) return null;
    return [Math.round(a * going + width), Math.ceil(b * going + width - 1e-9)];
  }
  const df = walklineOffset;
  const quarterArc = (Math.PI / 2) * df;
  const first = a * going;
  const last = total - first - geo.turns * quarterArc - (geo.turns - 1) * geo.middleWell;
  if (a < 0 || last < -1e-9) return null;
  const legs = [Math.round(first + width)];
  for (let i = 1; i < geo.turns; i++) legs.push(Math.round(geo.middleWell + 2 * width));
  legs.push(Math.ceil(Math.max(0, last) + width - 1e-9));
  return legs;
}

/** Plus grande position de tournant à essayer (girons avant le premier tournant). */
export function maxFirstGoings(shape: FlightsShape, riserCount: number): number {
  const geo = typologyGeometry(shape.typology);
  if (geo.turns === 0) return 0;
  return geo.mode === "landing" ? riserCount - 3 : riserCount - 1;
}

/**
 * Position du tournant : milieu de la partie tournante rapporté au reculement ; `bas` avant le
 * tiers, `haut` après les deux tiers, `médian` entre les deux **[convention Blondel]**.
 */
export function turnPosition(
  shape: FlightsShape,
  width: Mm,
  riserCount: number,
  going: Mm,
  walklineOffset: Mm,
): "bas" | "médian" | "haut" | null {
  const geo = typologyGeometry(shape.typology);
  if (geo.turns === 0) return null;
  const total = (riserCount - 1) * going;
  const turning =
    geo.mode === "landing"
      ? going
      : geo.turns * (Math.PI / 2) * walklineOffset + (geo.turns - 1) * geo.middleWell;
  const f = (shape.firstGoings * going + turning / 2) / total;
  return f < 1 / 3 ? "bas" : f > 2 / 3 ? "haut" : "médian";
}

/** Tracé à volées du candidat. */
export function flightsLayoutSpec(
  shape: FlightsShape,
  width: Mm,
  legs: readonly number[],
  inner: InnerCorner,
): FlightsLayoutSpec {
  const geo = typologyGeometry(shape.typology);
  const direction = shape.direction ?? "left";
  return {
    width,
    legs: legs.map((length) => ({ length })),
    turns: Array.from({ length: geo.turns }, () => ({ direction, mode: geo.mode, inner })),
  };
}

/**
 * Projet du candidat à partir du gabarit (site, conformité, marches, structure déjà validés) :
 * seuls le tracé, le nombre de hauteurs et le placement changent. Objet de même forme qu'un
 * projet validé (aucune analyse zod : appelé des milliers de fois).
 */
export function withLayout(
  template: Project,
  layout: Project["stair"]["layout"],
  riserCount: number,
  placement: Project["stair"]["placement"],
): Project {
  return {
    ...template,
    stair: {
      ...template.stair,
      layout,
      placement,
      stepping: { ...template.stair.stepping, riserCount },
    },
  };
}
