/**
 * Opérations vectorielles planes (fonctions pures sur `Vec2`).
 *
 * Exportées sous l'espace de noms `vec2` depuis `geom2d/index.ts` pour éviter les collisions
 * de noms courts (`add`, `scale`…) dans l'API publique du cœur.
 */
import type { Rad, Vec2 } from "../model/primitives.js";
import { MessageError, msg } from "@blondel/i18n";
import { GEOM_EPS } from "./tolerance.js";

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export const ZERO: Vec2 = { x: 0, y: 0 };

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

/** a + k·b (fréquent : point + distance × direction). */
export function addScaled(a: Vec2, b: Vec2, k: number): Vec2 {
  return { x: a.x + b.x * k, y: a.y + b.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Produit vectoriel (composante z) : > 0 si b est à gauche de a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function norm(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function normSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

/** Vecteur unitaire de même direction ; lève une erreur pour un vecteur (quasi) nul. */
export function normalize(a: Vec2): Vec2 {
  const n = norm(a);
  if (n < GEOM_EPS * GEOM_EPS) {
    throw new MessageError(msg("error.geom2d.normalize.zeroVector"));
  }
  return { x: a.x / n, y: a.y / n };
}

/** Rotation d'angle `angle` (radians, sens trigonométrique) autour de `pivot` (origine par défaut). */
export function rotate(a: Vec2, angle: Rad, pivot: Vec2 = ZERO): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = a.x - pivot.x;
  const dy = a.y - pivot.y;
  return { x: pivot.x + c * dx - s * dy, y: pivot.y + s * dx + c * dy };
}

/** Rotation de +90° (normale à gauche d'une direction). */
export function perpLeft(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

/** Rotation de −90° (normale à droite d'une direction). */
export function perpRight(a: Vec2): Vec2 {
  return { x: a.y, y: -a.x };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function equals(a: Vec2, b: Vec2, tol: number = GEOM_EPS): boolean {
  return distance(a, b) <= tol;
}

/** Angle polaire du vecteur, dans ]−π, π]. */
export function angleOf(a: Vec2): Rad {
  return Math.atan2(a.y, a.x);
}

/** Vecteur unitaire d'angle polaire donné. */
export function fromAngle(angle: Rad): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Angle signé de a vers b, dans ]−π, π] (positif = rotation CCW). */
export function signedAngle(a: Vec2, b: Vec2): Rad {
  return Math.atan2(cross(a, b), dot(a, b));
}
