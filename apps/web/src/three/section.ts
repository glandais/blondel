/**
 * Plan de coupe de la vue 3D (jalon 6) : plan orthogonal à un axe du cœur (X, Y ou Z = hauteur),
 * placé à une fraction de la boîte englobante de l'escalier ; la partie conservée est celle
 * d'abscisse inférieure au plan (ou supérieure, `flip`).
 *
 * Un seul plan de découpe est **toujours** attaché aux matériaux des pièces : désactivé, il est
 * rejeté très loin (`NO_SECTION`). Le nombre de plans faisant partie du programme de shaders,
 * activer ou déplacer la coupe ne recompile rien (pas de tâche longue).
 *
 * Conventions three.js : un fragment est découpé quand sa distance signée au plan
 * (n·p + constant) est négative. Scène : mètres, Y vers le haut ; cœur : mm, Z vers le haut
 * (p_scène = (x, z, −y) / 1 000).
 */
import type { Vec3 } from "@blondel/core";

export type SectionAxis = "x" | "y" | "z";

export interface SectionPlane {
  /** Normale unitaire, repère de la scène three.js. */
  readonly normal: readonly [number, number, number];
  /** Constante du plan (m). */
  readonly constant: number;
}

/** Plan désactivé : tout est conservé. */
export const NO_SECTION: SectionPlane = { normal: [0, -1, 0], constant: 1e6 };

const MM = 0.001;

/** Passage d'un vecteur du cœur (x, y, z) au repère de la scène (x, z, −y). */
export function toSceneVector(v: Vec3): [number, number, number] {
  return [v.x, v.z, -v.y];
}

/**
 * Plan de coupe à la fraction `t` ∈ [0, 1] de la boîte `box` (mm, repère du cœur) selon `axis`.
 */
export function sectionPlane(
  axis: SectionAxis,
  t: number,
  box: { readonly min: Vec3; readonly max: Vec3 },
  flip = false,
): SectionPlane {
  const f = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
  const c = box.min[axis] + f * (box.max[axis] - box.min[axis]);
  // Cœur : n = −e_axis, constante c → conserve {p : p_axis ≤ c}.
  const s = flip ? 1 : -1;
  const n: Vec3 = {
    x: axis === "x" ? s : 0,
    y: axis === "y" ? s : 0,
    z: axis === "z" ? s : 0,
  };
  const normal = toSceneVector(n);
  return { normal: [normal[0] + 0, normal[1] + 0, normal[2] + 0], constant: -s * c * MM };
}

/** Distance signée (m) d'un point du cœur (mm) au plan : ≥ 0 = conservé. */
export function signedDistance(plane: SectionPlane, p: Vec3): number {
  const [x, y, z] = toSceneVector(p);
  return (plane.normal[0] * x + plane.normal[1] * y + plane.normal[2] * z) * MM + plane.constant;
}

/**
 * Un point **de la scène** (m, repère monde three.js, par exemple `ThreeEvent.point`) est-il
 * découpé par le plan ? Le lancer de rayons de three.js ignore les plans de coupe : sans ce
 * filtre, un clic (sélection, mesure) atteindrait la partie invisible d'une pièce coupée.
 */
export function isClippedInScene(
  plane: SectionPlane,
  p: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  return plane.normal[0] * p.x + plane.normal[1] * p.y + plane.normal[2] * p.z + plane.constant < 0;
}
