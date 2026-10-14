/**
 * Contrôles de spécification d'une cage issue d'un hélicoïdal (origine `helical`, F10, sous-lot
 * P2) : ceux de l'ancien tracé hélicoïdal (retiré en P3), dans le même ordre et avec les mêmes
 * messages, portés dans le moteur de cage (`computeCageLayout`, appelés avant tout autre
 * contrôle) pour que la parité des erreurs ne dépende plus de la conversion `helicalToCage`.
 *
 * 1. domaine de n (`layout.riserCountOutOfRange`, `resolveRiserCount`) ;
 * 2. R_e > r_i (`layout.helical.outerRadiusBelowColumn|Well`) : r_i = rayon de l'axe en arc
 *    (mesuré sur le bord d'ancrage, côté de l'axe), R_e = r_i + E (exact en mm entiers) ;
 * 3. ligne de foulée dans l'emmarchement (`layout.walklineOutsideWidth`, `resolveWalklineOffset`
 *    sur la largeur E de la cage) ;
 * 4. angle par marche Δθ = |balayage| / (n − 1) dans ]0 ; 180°[
 *    (`layout.helical.invalidStepAngle`, angle en degrés au dixième).
 *
 * Le débord de nez (`stepping.helical.nosingReaches*`) reste à l'étage découpage
 * (`stepping/stepping.ts`, `checkHelicalNosing`), comme dans l'hélicoïdal.
 */
import type { CageLayoutSpec, Project } from "../../model/project.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { resolveRiserCount, resolveWalklineOffset } from "../resolve.js";

const DEG = Math.PI / 180;

/**
 * Contrôles de l'hélicoïdal d'origine (voir l'en-tête). Sans effet si la cage n'a pas la forme
 * rendue par `helicalToCage` (un tronçon à axe en arc) : les contrôles de cage s'appliquent.
 * @throws LayoutError au premier contrôle en échec.
 */
export function checkHelicalOrigin(
  project: Project,
  spec: CageLayoutSpec,
  core: "column" | "well" = "column",
): void {
  const n = resolveRiserCount(project);
  const section = spec.sections[0];
  if (spec.sections.length !== 1 || section?.axis.kind !== "arc") return;
  const rIn = section.axis.radius;
  const rOut = rIn + section.width;
  if (!(rOut > rIn)) {
    throw new LayoutError(
      msg(
        core === "column"
          ? "layout.helical.outerRadiusBelowColumn"
          : "layout.helical.outerRadiusBelowWell",
        { outer: String(rOut), inner: String(rIn) },
      ),
    );
  }
  resolveWalklineOffset(project);
  const step = (Math.abs(section.axis.sweep) * DEG) / (n - 1);
  if (!(step > 0 && step < Math.PI)) {
    throw new LayoutError(
      msg("layout.helical.invalidStepAngle", { angle: (step / DEG).toFixed(1) }),
    );
  }
}
