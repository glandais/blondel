/**
 * Emprise hors tout d'un hélicoïdal (`stairGrossPieces`, `site/fit.ts`) : l'arc extérieur de
 * chaque marche est couvert par des sous-arcs de 2° au plus. Quand l'angle par marche est un
 * multiple de ce pas (10°, 30°…), le bruit d'arrondi de l'angle mesuré entre deux nez ne doit
 * pas ajouter un sous-arc à certaines marches seulement (départage corrigé par la bascule de
 * l'hélicoïdal, F10 sous-lot P2 : `ceil(… − 1e-9)`, même tolérance que `splitArc`).
 */
import { describe, expect, it } from "vitest";
import { makeHelicalProject } from "../layout/helical-test-helpers.js";
import { buildModel } from "../pipeline/build.js";
import { stairGrossPieces } from "./fit.js";

describe("emprise hors tout de l'hélicoïdal : sous-arcs par marche", () => {
  it.each([
    [36, 5],
    [12, 15],
    [18, 10],
  ])("%i marches par tour : %i sous-arcs, toutes marches égales", (treadsPerTurn, arcs) => {
    const project = makeHelicalProject({
      outerRadius: 1000,
      coreRadius: 100,
      direction: "left",
      floorToFloor: 2800,
      riserCount: 16,
      treadsPerTurn,
    });
    const model = buildModel(project, { memo: false });
    expect(model.errors).toEqual([]);
    const pieces = stairGrossPieces(model.layout, model.stepping, { inner: 0, outer: 0 });
    expect(pieces.length).toBe(model.stepping.treads.length);
    // Sous-arcs extérieurs : sommets circonscrits, hors du cercle extérieur ; même nombre pour
    // toutes les marches (marches régulières).
    const h = model.layout.helical!;
    const outside = pieces.map(
      (piece) =>
        piece.polygon.filter(
          (p) => Math.hypot(p.x - h.center.x, p.y - h.center.y) > h.outerRadius + 1e-6,
        ).length,
    );
    expect(new Set(outside)).toEqual(new Set([arcs]));
  });
});
