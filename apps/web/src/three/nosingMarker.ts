/**
 * Repère 3D du nez sélectionné (QUESTIONS A28, nez d'arrivée qu'aucune pièce de marche ne
 * matérialise) : une barre posée sur la ligne de nez du cœur, de Q (bord intérieur) à R (bord
 * extérieur), à l'altitude du nez, dans le repère du cœur (mm, Z vers le haut). Mise en place
 * d'affichage seulement : la ligne de nez (Q, R, z) est celle du modèle.
 */
import type { NosingLine } from "@blondel/core";

/**
 * Section de la barre (mm) : choix de présentation, sans valeur métier, assez épaisse pour se
 * voir à l'échelle de l'escalier entier.
 */
export const NOSING_MARKER_SECTION_MM = 24;

/** Pose d'une barre de longueur `length` (axe X local) : centre et rotation autour de Z. */
export interface NosingMarkerPose {
  readonly position: readonly [number, number, number];
  readonly rotationZ: number;
  readonly length: number;
}

/** Pose de la barre sur la ligne de nez, ou `null` si la ligne est dégénérée (Q = R). */
export function nosingMarkerPose(
  nosing: Pick<NosingLine, "q" | "r" | "z">,
): NosingMarkerPose | null {
  const dx = nosing.r.x - nosing.q.x;
  const dy = nosing.r.y - nosing.q.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  return {
    position: [
      (nosing.q.x + nosing.r.x) / 2,
      (nosing.q.y + nosing.r.y) / 2,
      nosing.z + NOSING_MARKER_SECTION_MM / 2,
    ],
    rotationZ: Math.atan2(dy, dx),
    length,
  };
}
