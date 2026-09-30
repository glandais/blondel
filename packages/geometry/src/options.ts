import { msg } from "@blondel/i18n";
import { GeometryError } from "./errors.js";

/** Repère de section d'un balayage (voir `meshSweep`). */
export type SweepFrameMode = "upright" | "parallel";

/** Options de maillage. */
export interface MeshOptions {
  /**
   * Angle de lissage (degrés, dans [0, 180]) : au-delà, l'arête entre deux facettes est vive
   * (sommets dupliqués, normales à plat) ; en deçà, les normales sont moyennées (surface courbe).
   * Défauts : 30 pour les balayages et surfaces réglées (mains courantes, limons courbes) ;
   * pour les extrusions, 0 (faces latérales à plat, arêtes vives) sauf pour un contour
   * « rond » (`ROUND_RING_CREASE_DEG` : tous ses angles de virage sous 30°, poteau ou tube
   * rond discrétisé), lissé à 30°.
   */
  readonly creaseAngleDeg?: number;
  /**
   * Nombre maximal de points d'un chemin de balayage ou d'une surface réglée (garde-fou de
   * performance) ; au-delà, `GeometryError`. Défaut : 10 000.
   */
  readonly maxPathPoints?: number;
  /**
   * Repère de section d'un balayage :
   * - `"upright"` (défaut) : l'axe v de la section reste dans le plan vertical contenant la
   *   tangente (section « d'aplomb », sans dévers) ; transport parallèle sur les segments
   *   verticaux, où ce plan n'est pas défini ;
   * - `"parallel"` : transport parallèle pur (rotation minimale) depuis le premier segment ;
   *   sans torsion locale, mais sur une hélice la section tourne progressivement autour de la
   *   tangente (≈ 2π·sin(pente) par tour), jusqu'à se retourner.
   */
  readonly sweepFrame?: SweepFrameMode;
  /**
   * Maillage en repère local (`Mesh.origin` = centre de la boîte englobante, positions
   * relatives à cette origine, soustraite en float64 avant la conversion en float32) : précision
   * du float32 conservée loin de l'origine du monde (export glTF, translation de nœud).
   * Défaut : `false` (positions dans le repère monde).
   */
  readonly localOrigin?: boolean;
}

/** Angle de lissage (degrés) des contours ronds d'une extrusion (voir `creaseAngleDeg`). */
export const ROUND_RING_CREASE_DEG = 30;

export const DEG = Math.PI / 180;

/** Cosinus de l'angle de lissage (moins une marge numérique), après validation. */
export function creaseCos(options: MeshOptions, defaultDeg: number): number {
  const deg = options.creaseAngleDeg ?? defaultDeg;
  if (!Number.isFinite(deg) || deg < 0 || deg > 180) {
    throw new GeometryError(msg("geometry.options.invalidCreaseAngle", { angle: String(deg) }));
  }
  return Math.cos(deg * DEG) - 1e-9;
}

/** Nombre maximal de points de chemin, après validation. */
export function maxPathPoints(options: MeshOptions): number {
  const n = options.maxPathPoints ?? 10_000;
  if (!(n >= 2))
    throw new GeometryError(msg("geometry.options.invalidMaxPathPoints", { value: String(n) }));
  return n;
}
