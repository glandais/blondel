/**
 * @blondel/geometry — maillages d'aperçu des pièces décrites analytiquement par le cœur
 * (ADR-0001). Aucune dépendance au DOM ni à three.js : tableaux typés uniquement.
 */
export type { Mesh } from "./mesh.js";
export { emptyMesh, flipMesh, mergeMeshes, triangleCount, vertexCount } from "./mesh.js";
export type { Bbox3, ManifoldReport } from "./analysis.js";
export { bbox, checkManifold, signedVolume, surfaceArea, unionBbox } from "./analysis.js";
export { GeometryError } from "./errors.js";
export type { MeshOptions, SweepFrameMode } from "./options.js";
export { cleanRing, polygonArea, prepareShape, shapeArea } from "./polygon.js";
export type { PreparedShape } from "./polygon.js";
export { meshExtrusion } from "./extrude.js";
export { meshRuled } from "./ruled.js";
export type { SweepFrame } from "./sweep.js";
export {
  meshSweep,
  parallelTransportFrames,
  polylineLength,
  sweepFrames,
  uprightFrames,
} from "./sweep.js";
export type { PartMesh } from "./solid.js";
export { meshPart, meshParts, meshSolid } from "./solid.js";
