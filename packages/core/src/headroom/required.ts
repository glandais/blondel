/**
 * Zone de l'escalier qui doit être sous la trémie pour que l'échappée sur Γ atteigne un
 * minimum (utilisé par les préréglages pour dimensionner la trémie).
 *
 * Avec un plafond à z_p, l'échappée e(s) = z_p − z(s) est insuffisante dès que
 * z(s) > z_p − e_min, c'est-à-dire pour s > s* (`slopeExceedsFrom`). La zone est la partie de
 * l'escalier comprise entre la section perpendiculaire à Γ en s* et l'arrivée ; elle est bornée
 * par cette section et par les bords C_i et C_e au-delà (arcs discrétisés à 0,1 mm de flèche).
 * Pour une volée droite, on retrouve L = (e_min + ep)·g/h mesurée depuis l'arrivée (A §1.7).
 */
import { firstHit } from "../balancing/postprocess.js";
import {
  curveLength,
  curvePointAt,
  curveTangentAt,
  flattenCurve,
  subCurve,
} from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import type { Layout } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import { slopeExceedsFrom, type SlopeProfile } from "./profile.js";

/** Flèche de discrétisation des arcs des bords (mm). */
const CHORD_TOL: Mm = 0.1;

export interface RequiredOpening {
  /** Abscisse s* sur Γ à partir de laquelle l'échappée est insuffisante sans trémie. */
  readonly sStart: Mm;
  /** Points du contour de la zone (section en s*, puis bords jusqu'à l'arrivée). */
  readonly points: readonly Vec2[];
}

/**
 * Zone à couvrir par la trémie pour que z_p − z(s) ≥ e_min sur Γ, avec `zMax = z_p − e_min`.
 * `null` si la ligne de pente reste partout sous `zMax`.
 * @throws Error si la section perpendiculaire en s* ne rencontre pas les bords (tracé invalide).
 */
export function requiredOpening(
  layout: Layout,
  profile: SlopeProfile,
  zMax: Mm,
): RequiredOpening | null {
  const sStart = slopeExceedsFrom(profile, zMax);
  if (sStart === null) return null;
  const p = curvePointAt(layout.walkline, sStart);
  const tangent = curveTangentAt(layout.walkline, sStart);
  const outward = layout.innerSide === "left" ? V.perpRight(tangent) : V.perpLeft(tangent);
  const q = firstHit(p, outward, layout.inner, "back", tangent);
  const r = firstHit(p, outward, layout.outer, "forward", tangent);
  if (!q || !r) {
    throw new Error(`Section de l'escalier introuvable en s = ${sStart.toFixed(1)} mm.`);
  }
  const inner = flattenCurve(subCurve(layout.inner, q.s, curveLength(layout.inner)), CHORD_TOL);
  const outer = flattenCurve(subCurve(layout.outer, r.s, curveLength(layout.outer)), CHORD_TOL);
  return { sStart, points: [q.point, r.point, ...inner, ...outer] };
}
