/**
 * Primitives sur un segment de courbe (`LineSeg` | `ArcSeg`).
 *
 * Paramétrage local : fraction `t ∈ [0, 1]` (0 = début, 1 = fin). Les fonctions acceptent
 * `t` hors de [0, 1] pour prolonger le segment (droite support, cercle support) — utile
 * aux raccords de décalage. Pour un arc, `θ(t) = startAngle + t·sweep`.
 */
import type { ArcSeg, CurveSeg, LineSeg, Mm, Rad, Vec2 } from "../model/primitives.js";
import { MessageError, msg } from "@blondel/i18n";
import { GEOM_EPS } from "./tolerance.js";
import * as V from "./vec.js";

export function lineSeg(a: Vec2, b: Vec2): LineSeg {
  return { kind: "line", a, b };
}

export function arcSeg(center: Vec2, radius: Mm, startAngle: Rad, sweep: Rad): ArcSeg {
  if (!(radius >= 0)) {
    throw new MessageError(msg("error.geom2d.arcSeg.invalidRadius", { radius: String(radius) }));
  }
  return { kind: "arc", center, radius, startAngle, sweep };
}

/** Point d'un arc à l'angle polaire θ. */
export function arcPointAtAngle(arc: ArcSeg, theta: Rad): Vec2 {
  return {
    x: arc.center.x + arc.radius * Math.cos(theta),
    y: arc.center.y + arc.radius * Math.sin(theta),
  };
}

export function segLength(seg: CurveSeg): Mm {
  return seg.kind === "line" ? V.distance(seg.a, seg.b) : seg.radius * Math.abs(seg.sweep);
}

export function segPointAt(seg: CurveSeg, t: number): Vec2 {
  if (seg.kind === "line") return V.lerp(seg.a, seg.b, t);
  return arcPointAtAngle(seg, seg.startAngle + t * seg.sweep);
}

export function segStart(seg: CurveSeg): Vec2 {
  return seg.kind === "line" ? seg.a : arcPointAtAngle(seg, seg.startAngle);
}

export function segEnd(seg: CurveSeg): Vec2 {
  return seg.kind === "line" ? seg.b : arcPointAtAngle(seg, seg.startAngle + seg.sweep);
}

/**
 * Tangente unitaire au paramètre t. Définie même pour un arc de rayon nul (pivot) à balayage
 * non nul. Vaut le vecteur nul pour un segment dégénéré sans direction (ligne de longueur nulle,
 * arc de balayage nul).
 */
export function segTangentAt(seg: CurveSeg, t: number): Vec2 {
  if (seg.kind === "line") {
    const d = V.sub(seg.b, seg.a);
    const n = V.norm(d);
    return n < GEOM_EPS * GEOM_EPS ? V.ZERO : V.scale(d, 1 / n);
  }
  if (seg.sweep === 0) return V.ZERO;
  const theta = seg.startAngle + t * seg.sweep;
  const sg = Math.sign(seg.sweep);
  return { x: -sg * Math.sin(theta), y: sg * Math.cos(theta) };
}

/** Sous-segment entre les fractions t0 et t1 (t0 > t1 inverse le sens). */
export function segSub(seg: CurveSeg, t0: number, t1: number): CurveSeg {
  if (seg.kind === "line") {
    return lineSeg(V.lerp(seg.a, seg.b, t0), V.lerp(seg.a, seg.b, t1));
  }
  return arcSeg(seg.center, seg.radius, seg.startAngle + t0 * seg.sweep, (t1 - t0) * seg.sweep);
}

export function segReverse(seg: CurveSeg): CurveSeg {
  return segSub(seg, 1, 0);
}

/**
 * Fraction t (éventuellement hors [0, 1]) du point de la droite/du cercle support le plus
 * proche de p. Pour un arc, l'angle est ramené dans l'intervalle de longueur 2π centré sur
 * l'arc (le prolongement le plus proche de l'arc). Rayon ou balayage nul : 0.
 */
export function segParamOfPoint(seg: CurveSeg, p: Vec2): number {
  if (seg.kind === "line") {
    const d = V.sub(seg.b, seg.a);
    const l2 = V.normSq(d);
    return l2 === 0 ? 0 : V.dot(V.sub(p, seg.a), d) / l2;
  }
  if (seg.sweep === 0) return 0;
  const theta = Math.atan2(p.y - seg.center.y, p.x - seg.center.x);
  const abs = Math.abs(seg.sweep);
  const sg = Math.sign(seg.sweep);
  // Écart angulaire orienté dans le sens du balayage, ramené dans [mid − π, mid + π[.
  const mid = abs / 2;
  let delta = sg * (theta - seg.startAngle);
  delta = mid + wrapPi(delta - mid);
  return delta / abs;
}

/** Ramène un angle dans [−π, π[. */
export function wrapPi(a: Rad): Rad {
  const twoPi = 2 * Math.PI;
  let r = (a + Math.PI) % twoPi;
  if (r < 0) r += twoPi;
  return r - Math.PI;
}

/** Point du segment (borné) le plus proche de p, avec sa fraction t ∈ [0, 1]. */
export function segClosestPoint(seg: CurveSeg, p: Vec2): { t: number; point: Vec2 } {
  if (seg.kind === "line") {
    const t = Math.min(1, Math.max(0, segParamOfPoint(seg, p)));
    return { t, point: segPointAt(seg, t) };
  }
  if (seg.radius === 0 || seg.sweep === 0) return { t: 0, point: segStart(seg) };
  const t = segParamOfPoint(seg, p);
  if (t >= 0 && t <= 1) return { t, point: segPointAt(seg, t) };
  const s = segStart(seg);
  const e = segEnd(seg);
  return V.distance(p, s) <= V.distance(p, e) ? { t: 0, point: s } : { t: 1, point: e };
}
