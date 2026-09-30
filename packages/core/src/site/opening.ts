/**
 * Trémie polygonale saisie (jalon 7) : validation (polygone simple, aire non nulle) et forme
 * canonique enregistrée (sommets arrondis, doublons retirés, sens trigonométrique).
 */
import { MessageError, msg, type Message } from "@blondel/i18n";
import { segmentIntersect } from "../geom2d/intersect.js";
import { ensureCCW, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { Opening } from "../model/project.js";

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

/**
 * Vrai si deux segments parallèles sont portés par la même droite et se recouvrent ou se
 * touchent (cas que `segmentIntersect`, qui ignore les parallèles, ne voit pas).
 */
function collinearOverlap(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const u = V.sub(a2, a1);
  const L = V.norm(u);
  if (!(L > 0)) return false;
  const tol = 1e-6 * Math.max(1, L);
  const off = (p: Vec2): number => Math.abs(V.cross(u, V.sub(p, a1))) / L;
  if (off(b1) > tol || off(b2) > tol) return false;
  const t1 = V.dot(V.sub(b1, a1), u) / L;
  const t2 = V.dot(V.sub(b2, a1), u) / L;
  return Math.max(t1, t2) >= -tol && Math.min(t1, t2) <= L + tol;
}

/** Vrai si deux côtés non adjacents du polygone se coupent ou se touchent. */
export function isSelfIntersecting(poly: Polygon2): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Côtés adjacents : ils partagent un sommet, seul un recouvrement serait anormal.
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        const shared = j === i + 1 ? a2 : a1;
        const other = j === i + 1 ? poly[(j + 1) % n]! : poly[j]!;
        const own = j === i + 1 ? a1 : a2;
        // Repli sur lui-même : l'autre extrémité est dans le prolongement du côté, en arrière.
        const u = V.sub(own, shared);
        const w = V.sub(other, shared);
        if (Math.abs(V.cross(u, w)) <= 1e-9 * V.norm(u) * V.norm(w) && V.dot(u, w) > 0) {
          return true;
        }
        continue;
      }
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % n]!;
      if (segmentIntersect(a1, a2, b1, b2) || collinearOverlap(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Défauts d'un contour de trémie saisi ; `[]` s'il est acceptable. */
export function validateOpeningPolygon(points: readonly Vec2[]): Message[] {
  const issues: Message[] = [];
  if (points.length < 3) {
    issues.push(msg("site.opening.tooFewPoints", { count: String(points.length) }));
    return issues;
  }
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    issues.push(msg("site.opening.notNumeric"));
    return issues;
  }
  if (!(Math.abs(signedArea(points)) > 1)) issues.push(msg("site.opening.zeroArea"));
  else if (isSelfIntersecting(points)) issues.push(msg("site.opening.selfIntersecting"));
  return issues;
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
