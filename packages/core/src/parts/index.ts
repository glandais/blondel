/**
 * Pièces de base (marches, contremarches, paliers), en attendant les plugins de structure.
 */
export {
  DEFAULT_WOOD_MATERIAL,
  QUANTITY_SURFACE,
  QUANTITY_VOLUME,
  buildBasicParts,
  type BasicParts,
} from "./basic.js";
export { fabricatedParts } from "./components.js";
export { checkSolids, isSelfIntersection, solidProblem } from "./solidChecks.js";
