/**
 * Site et import de plan (jalon 7) : calque de fond (schéma, géométrie, image calibrée),
 * accroches de saisie, trémie polygonale, relevé 4 côtés + 2 diagonales, modifications du site,
 * adéquation de l'escalier au site (`fit.ts`, `Model.siteFit`).
 * Le lecteur DXF est un point d'entrée séparé : `@blondel/core/dxf` (`site/dxf.ts`).
 */
export * from "./schema.js";
export * from "./underlay.js";
export * from "./snap.js";
export * from "./opening.js";
export {
  polygonDefect,
  storedPolygonDefect,
  type PolygonDefect,
  type PolygonShapeDefect,
  type StoredPolygonDefect,
} from "./simplePolygon.js";
export * from "./survey.js";
export * from "./edit.js";
export * from "./fit.js";
