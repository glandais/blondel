/**
 * Contour de la trémie en plan (repère du site), pour l'affichage.
 */
import type { Opening, Polygon2 } from "@blondel/core";

export function openingPolygon(opening: Opening): Polygon2 {
  if (opening.kind === "rect") {
    const { x, y, sizeX, sizeY } = opening;
    return [
      { x, y },
      { x: x + sizeX, y },
      { x: x + sizeX, y: y + sizeY },
      { x, y: y + sizeY },
    ];
  }
  return opening.points;
}
