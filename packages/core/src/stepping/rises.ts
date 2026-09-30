/**
 * Hauteurs de marche (SPEC §2.3, A §1.3).
 *
 * n = `riserCount`, ou arrondi(H / targetRise) (`resolveRiserCount`, partagé avec le tracé).
 * Hauteur nominale h = H / n ; première hauteur h₁ = h + `firstRiseOffset` (compensation de
 * revêtement) ; les n − 1 autres valent (H − h₁)/(n − 1). Altitudes des nez (liste générale) :
 * z_k = h₁ + k·(H − h₁)/(n − 1) pour k = 0 … n − 2 et z_{n−1} = H exactement ; le nez k reçoit
 * la hauteur k (0-based).
 */
import { resolveRiserCount } from "../layout/resolve.js";
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { msg } from "@blondel/i18n";
import { SteppingError } from "./errors.js";

export interface RiseSchedule {
  readonly riserCount: number;
  /** Hauteur nominale H / n. */
  readonly rise: Mm;
  readonly rises: readonly Mm[];
  /** Altitude (sol fini) du nez k, k = 0 … n − 1. */
  readonly z: readonly Mm[];
}

/**
 * @throws LayoutError si n sort du domaine ; SteppingError si une hauteur n'est pas positive.
 */
export function computeRises(project: Project): RiseSchedule {
  const n = resolveRiserCount(project);
  const H = project.site.floorToFloor;
  const rise = H / n;
  const first = rise + project.stair.stepping.firstRiseOffset;
  const other = (H - first) / (n - 1);
  if (!(first > 0) || !(other > 0)) {
    throw new SteppingError(
      msg("stepping.impossibleRises", { first: first.toFixed(1), other: other.toFixed(1) }),
    );
  }
  const rises: Mm[] = [first];
  const z: Mm[] = [first];
  for (let k = 1; k < n; k++) {
    rises.push(other);
    z.push(k === n - 1 ? H : first + k * other);
  }
  return { riserCount: n, rise, rises, z };
}
