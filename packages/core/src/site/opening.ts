/**
 * Trémie polygonale saisie (jalon 7) : validation (polygone simple, aire non nulle) et forme
 * canonique enregistrée (sommets arrondis, doublons retirés, sens trigonométrique).
 */
import { MessageError, msg, type Message } from "@blondel/i18n";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { Opening } from "../model/project.js";
import { polygonDefect } from "./simplePolygon.js";

/** Réexporté ici pour les appelants existants (contrôle commun : `simplePolygon.ts`). */
export { isSelfIntersecting } from "./simplePolygon.js";

/** Pas d'arrondi des sommets enregistrés (mm) : dixième de mm, sous la précision de pose. */
export const OPENING_POINT_PRECISION: Mm = 0.1;

const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

/**
 * Sommets arrondis, doublons consécutifs (et point de fermeture répété) retirés, sommets
 * alignés conservés, sens trigonométrique.
 */
export function normalizeOpeningPoints(
  points: readonly Vec2[],
  precision: Mm = OPENING_POINT_PRECISION,
): Vec2[] {
  const rounded = points.map((p) => ({
    x: Number(roundTo(p.x, precision).toFixed(6)),
    y: Number(roundTo(p.y, precision).toFixed(6)),
  }));
  const out: Vec2[] = [];
  for (const p of rounded) {
    const last = out[out.length - 1];
    if (!last || V.distance(last, p) > 0) out.push(p);
  }
  while (out.length > 1 && V.distance(out[0]!, out[out.length - 1]!) === 0) out.pop();
  if (out.length < 3) return out;
  return [...ensureCCW(out)];
}

/** Défauts d'un contour de trémie saisi ; `[]` s'il est acceptable. */
export function validateOpeningPolygon(points: readonly Vec2[]): Message[] {
  const defect = polygonDefect(points);
  if (defect === null) return [];
  switch (defect.kind) {
    case "tooFewPoints":
      return [msg("site.opening.tooFewPoints", { count: String(defect.count) })];
    case "notNumeric":
      return [msg("site.opening.notNumeric")];
    case "zeroArea":
      return [msg("site.opening.zeroArea")];
    case "selfIntersecting":
      return [msg("site.opening.selfIntersecting")];
  }
}

/** Erreur de saisie d'une trémie polygonale ; message : défauts séparés par « ; ». */
export class OpeningInputError extends MessageError {
  override name = "OpeningInputError";
  constructor(readonly issues: readonly Message[]) {
    super(
      issues.reduceRight<Message | null>(
        (rest, issue) =>
          rest === null ? issue : msg("site.opening.issueList", { first: issue, rest }),
        null,
      ) ?? msg("site.opening.invalid"),
    );
  }
}

/** Trémie polygonale canonique ; lève `OpeningInputError` si le contour est invalide. */
export function polygonOpening(points: readonly Vec2[]): Opening & { kind: "polygon" } {
  const pts = normalizeOpeningPoints(points);
  const issues = validateOpeningPolygon(pts);
  if (issues.length > 0) throw new OpeningInputError(issues);
  return { kind: "polygon", points: pts };
}
