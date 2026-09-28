/**
 * Conversion des maillages de `@blondel/geometry` en `THREE.BufferGeometry`, et maillage de la
 * dalle haute (site) pour l'aperçu. Les tableaux typés sont partagés (pas de copie) : ils sont
 * immuables côté `@blondel/geometry` (cache).
 */
import { bbox, ensureCCW, type Polygon2, type Project, type Vec2 } from "@blondel/core";
import { meshExtrusion, type Mesh } from "@blondel/geometry";
import { BufferAttribute, BufferGeometry } from "three";
import { openingPolygon } from "../lib/opening.js";

export function toBufferGeometry(mesh: Mesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Marge d'affichage de la dalle autour de l'escalier et de la trémie (mm, présentation). */
export const SLAB_DISPLAY_MARGIN = 600;

/**
 * Dalle haute (sous-face à H − épaisseur, dessus à H) percée de la trémie, étendue à
 * l'emprise de l'escalier et de la trémie plus une marge d'affichage. `undefined` sans
 * trémie (pas de plancher haut modélisé).
 */
export function upperSlabMesh(project: Project, footprint: readonly Vec2[]): Mesh | undefined {
  const { opening, floorToFloor, upperSlabThickness } = project.site;
  if (!opening) return undefined;
  const hole = openingPolygon(opening);
  const b = bbox([...footprint, ...hole]);
  const m = SLAB_DISPLAY_MARGIN;
  const outer: Polygon2 = [
    { x: b.min.x - m, y: b.min.y - m },
    { x: b.max.x + m, y: b.min.y - m },
    { x: b.max.x + m, y: b.max.y + m },
    { x: b.min.x - m, y: b.max.y + m },
  ];
  const holeCW = [...ensureCCW(hole)].reverse();
  return meshExtrusion(
    {
      origin: { x: 0, y: 0, z: floorToFloor - upperSlabThickness },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 },
    },
    { outer, holes: [holeCW] },
    upperSlabThickness,
  );
}
