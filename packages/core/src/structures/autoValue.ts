/**
 * Valeur retenue commune d'un paramètre `auto` résolu par limon (`StructureOutput.autoValues`).
 * L'interface propose d'imposer la valeur retenue d'un clic : une valeur unique n'est exposée que
 * si tous les limons ont retenu la même (à `AUTO_VALUE_TOLERANCE` près), sinon l'imposer
 * changerait la géométrie des limons qui en avaient une autre.
 */
import type { Mm } from "../model/primitives.js";

/** Écart toléré entre les valeurs des limons pour les tenir pour égales (mm, bruit numérique). */
export const AUTO_VALUE_TOLERANCE: Mm = 1e-6;

/**
 * Valeur commune des valeurs finies données ; `undefined` si aucune ou si elles diffèrent.
 */
export function commonAutoValue(values: readonly number[]): number | undefined {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return undefined;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  return hi - lo <= AUTO_VALUE_TOLERANCE ? finite[0] : undefined;
}
