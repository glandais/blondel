/**
 * Aide des tests qui calculent l'échappée hors de `buildModel` (non exportée par le paquet) :
 * la même étape que le pipeline (`pipeline/build.ts`, étape d'échappée), sous-faces de toute
 * cage qui se recouvre comprises, hélicoïdal compris (`cageHeadroomCeilings`, décision F10
 * (10a)). Appeler `computeHeadroom` sans ses sous-faces ferait disparaître l'auto-recouvrement
 * sans bruit.
 */
import type { Layout, Stepping } from "../model/derived.js";
import { isCageLayout, type Project } from "../model/project.js";
import { cageHeadroomCeilings } from "./cage.js";
import { computeHeadroom, type HeadroomAnalysis } from "./headroom.js";

/**
 * Échappée d'un projet, comme l'étape d'échappée du pipeline.
 * @throws Error si un contour de marche d'une cage saisie n'est pas fiable (le pipeline rend
 *   alors l'erreur `headroom.error.cageTreadOutline`).
 */
export function headroomStage(
  project: Project,
  layout: Layout,
  stepping: Stepping,
): HeadroomAnalysis | null {
  const { layout: spec } = project.stair;
  const { thickness, nosing } = project.stair.treads;
  const ceilings = cageHeadroomCeilings(
    isCageLayout(spec) ? spec : undefined,
    layout,
    stepping,
    thickness,
    nosing,
  );
  if (ceilings.kind === "defect") throw new Error(`contour de marche ${ceilings.tread}`);
  return computeHeadroom(project.site, layout, stepping, ceilings.soffits);
}
