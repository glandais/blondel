/**
 * Primitives d'arc du moteur de cage (`layout/cage/general.ts`, cage issue d'un hélicoïdal, F10
 * sous-lot P1), de la structure, des préréglages et du découpage : découpage d'un arc en arcs
 * élémentaires d'au plus 90°, points d'un arc à flèche bornée, secteur de couronne et disque.
 * Déplacées depuis l'ancien tracé hélicoïdal (`layout/helical.ts`, retiré en F10 P3) sans
 * changement de calcul ; `arcPoints`, `sectorRing` et `splitArc` sont réexportées par
 * `layout/index.ts`.
 */
import type { CurveSeg, Mm, Polygon2, Rad, Vec2 } from "../model/primitives.js";
import { flattenCurve, makeCurve } from "./curve.js";
import { ensureCCW } from "./polygon.js";
import { arcSeg } from "./segment.js";
import * as V from "./vec.js";

/** Balayage maximal d'un arc élémentaire des bords et de Γ. */
export const MAX_ARC_SWEEP: Rad = Math.PI / 2;
/** Flèche de discrétisation des contours (mm), comme les marches des escaliers à volées. */
export const ARC_CHORD_TOL: Mm = 0.1;

/** Arc découpé en arcs élémentaires d'au plus 90°. */
export function splitArc(center: Vec2, radius: Mm, start: Rad, sweep: Rad): CurveSeg[] {
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_ARC_SWEEP - 1e-12));
  const step = sweep / count;
  return Array.from({ length: count }, (_, i) => arcSeg(center, radius, start + i * step, step));
}

/** Points d'un arc (flèche ≤ 0,1 mm), extrémités comprises. */
export function arcPoints(center: Vec2, radius: Mm, start: Rad, sweep: Rad): Vec2[] {
  if (sweep === 0) return [V.addScaled(center, V.fromAngle(start), radius)];
  return flattenCurve(makeCurve(splitArc(center, radius, start, sweep)), ARC_CHORD_TOL);
}

/** Secteur de couronne (r_in ≤ r ≤ r_out, angles de `start` à `start + sweep`), CCW. */
export function sectorRing(center: Vec2, rIn: Mm, rOut: Mm, start: Rad, sweep: Rad): Polygon2 {
  const outer = arcPoints(center, rOut, start, sweep);
  const inner = arcPoints(center, rIn, start, sweep).reverse();
  return ensureCCW([...outer, ...inner]);
}

/** Disque (polygone inscrit, flèche ≤ 0,1 mm), CCW. */
export function discPolygon(center: Vec2, radius: Mm): Polygon2 {
  const pts = arcPoints(center, radius, 0, 2 * Math.PI);
  pts.pop(); // dernier point = premier
  return ensureCCW(pts);
}
