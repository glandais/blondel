import { GeometryError } from "./errors.js";

/** Repère de section d'un balayage (voir `meshSweep`). */
export type SweepFrameMode = "upright" | "parallel";

/** Options de maillage. */
export interface MeshOptions {
  /**
   * Angle de lissage (degrés, dans [0, 180]) : au-delà, l'arête entre deux facettes est vive
   * (sommets dupliqués, normales à plat) ; en deçà, les normales sont moyennées (surface courbe).
   * Défauts : 0 pour les extrusions (faces latérales à plat, arêtes vives), 30 pour les
   * balayages et surfaces réglées (mains courantes, limons courbes).
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
}

export const DEG = Math.PI / 180;

/** Cosinus de l'angle de lissage (moins une marge numérique), après validation. */
export function creaseCos(options: MeshOptions, defaultDeg: number): number {
  const deg = options.creaseAngleDeg ?? defaultDeg;
  if (!Number.isFinite(deg) || deg < 0 || deg > 180) {
    throw new GeometryError(`angle de lissage invalide : ${deg} (attendu dans [0, 180] degrés)`);
  }
  return Math.cos(deg * DEG) - 1e-9;
}

/** Nombre maximal de points de chemin, après validation. */
export function maxPathPoints(options: MeshOptions): number {
  const n = options.maxPathPoints ?? 10_000;
  if (!(n >= 2)) throw new GeometryError(`maxPathPoints invalide : ${n}`);
  return n;
}
