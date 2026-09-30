import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveEnd, curveLength, curvePointAt, curveStart, isContinuous } from "../geom2d/curve.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { LayoutError } from "./errors.js";
import { helicalShapeArb, makeHelicalProject } from "./helical-test-helpers.js";
import { computeLayout } from "./layout.js";

const TOL = 1e-6;

describe("computeLayout — hélicoïdal", () => {
  it("fût de 70 mm, R_e 900, 12 marches par tour, 15 hauteurs : arcs concentriques", () => {
    const p = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      treadsPerTurn: 12,
      floorToFloor: 2700,
      riserCount: 15,
    });
    expect(p.stair.layout.width).toBe(830);
    expect(p.stair.layout.legs).toEqual([]);
    const layout = computeLayout(p);
    const h = layout.helical!;
    expect(h.walklineRadius).toBe(70 + 415);
    expect(h.stepAngle).toBeCloseTo(Math.PI / 6, 12);
    expect(h.totalAngle).toBeCloseTo((14 * Math.PI) / 6, 12);
    expect(curveLength(layout.walkline)).toBeCloseTo(485 * h.totalAngle, 6);
    expect(curveLength(layout.inner)).toBeCloseTo(70 * h.totalAngle, 6);
    expect(curveLength(layout.outer)).toBeCloseTo(900 * h.totalAngle, 6);
    expect(layout.turns).toEqual([]);
    expect(layout.innerSide).toBe("left");
    // Départ sur l'axe +X, montée dans le sens trigonométrique.
    expect(curveStart(layout.walkline).x).toBeCloseTo(485, 9);
    expect(curvePointAt(layout.walkline, 10).y).toBeGreaterThan(0);
    // Plus d'un tour : emprise = disque de R_e, troué du fût de R_i (D3).
    expect(Math.abs(signedArea(layout.footprint))).toBeCloseTo(Math.PI * 900 * 900, -3);
    expect(layout.footprintHoles).toHaveLength(1);
    expect(Math.abs(signedArea(layout.footprintHoles![0]!))).toBeCloseTo(Math.PI * 70 * 70, -2);
    expect(pointInPolygon(layout.helical!.center, layout.footprintHoles![0]!)).toBe("inside");
    // Arcs élémentaires d'au plus 90°.
    for (const c of [layout.inner, layout.outer, layout.walkline]) {
      for (const seg of c.segments) {
        expect(seg.kind).toBe("arc");
        if (seg.kind === "arc")
          expect(Math.abs(seg.sweep)).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
      }
    }
  });

  it("angle total imposé : Δθ = Θ / (n − 1) ; secteur de couronne en dessous d'un tour", () => {
    const p = makeHelicalProject({
      outerRadius: 1000,
      coreRadius: 100,
      direction: "right",
      totalAngle: 270,
      floorToFloor: 2700,
      riserCount: 16,
    });
    const layout = computeLayout(p);
    const h = layout.helical!;
    expect(h.stepAngle).toBeCloseTo((270 * Math.PI) / 180 / 15, 12);
    expect(h.totalAngle).toBeCloseTo((3 * Math.PI) / 2, 12);
    const ring = ((1000 ** 2 - 100 ** 2) * h.totalAngle) / 2;
    expect(Math.abs(signedArea(layout.footprint))).toBeCloseTo(ring, -3);
    // Sens horaire : le premier pas descend en y.
    expect(curvePointAt(layout.walkline, 10).y).toBeLessThan(0);
    expect(layout.innerSide).toBe("right");
  });

  it("palier d'arrivée : secteur à partir du nez d'arrivée", () => {
    const p = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      treadsPerTurn: 12,
      floorToFloor: 2700,
      riserCount: 15,
      landingAngle: 60,
    });
    const h = computeLayout(p).helical!;
    expect(h.landingAngle).toBeCloseTo(Math.PI / 3, 12);
    const area = ((900 ** 2 - 70 ** 2) * (Math.PI / 3)) / 2;
    expect(Math.abs(signedArea(h.landingOutline!))).toBeCloseTo(area, -3);
  });

  it("emprise : marches et palier d'arrivée (relecture : le palier était hors emprise)", () => {
    const base = {
      outerRadius: 1000,
      coreRadius: 100,
      totalAngle: 180,
      floorToFloor: 2700,
      riserCount: 16,
    };
    for (const direction of ["left", "right"] as const) {
      const layout = computeLayout(makeHelicalProject({ ...base, direction, landingAngle: 90 }));
      const h = layout.helical!;
      const ring = ((1000 ** 2 - 100 ** 2) * (Math.PI + Math.PI / 2)) / 2;
      expect(Math.abs(signedArea(layout.footprint))).toBeCloseTo(ring, -3);
      // Moins d'un tour : secteur de couronne, déjà troué, sans `footprintHoles`.
      expect(layout.footprintHoles).toBeUndefined();
      // Milieu du palier (angle Θ + Λ/2 dans le sens de la montée) dans l'emprise.
      const a = h.startAngle + (direction === "left" ? 1 : -1) * (Math.PI + Math.PI / 4);
      const mid = V.addScaled(h.center, V.fromAngle(a), 550);
      expect(pointInPolygon(mid, layout.footprint)).toBe("inside");
      // Côté opposé (avant le départ) : hors emprise.
      const before = V.addScaled(
        h.center,
        V.fromAngle(h.startAngle - (direction === "left" ? 1 : -1) * 0.3),
        550,
      );
      expect(pointInPolygon(before, layout.footprint)).toBe("outside");
    }
    // Marches + palier au-delà d'un tour : disque de R_e.
    const full = computeLayout(
      makeHelicalProject({ ...base, direction: "left", totalAngle: 300, landingAngle: 90 }),
    );
    expect(Math.abs(signedArea(full.footprint))).toBeCloseTo(Math.PI * 1000 ** 2, -3);
    expect(full.footprintHoles).toHaveLength(1);
  });

  it("propriété : Γ, C_i et C_e concentriques, continus, dans le sens de la montée", () => {
    fc.assert(
      fc.property(helicalShapeArb, (shape) => {
        const layout = computeLayout(makeHelicalProject(shape));
        const h = layout.helical!;
        expect(h.walklineRadius - h.innerRadius).toBeCloseTo(layout.walklineOffset, 9);
        for (const [curve, r] of [
          [layout.inner, h.innerRadius],
          [layout.outer, h.outerRadius],
          [layout.walkline, h.walklineRadius],
        ] as const) {
          expect(isContinuous(curve)).toBe(true);
          expect(curveLength(curve)).toBeCloseTo(r * h.totalAngle, 6);
          for (const s of [0, curveLength(curve) / 3, curveLength(curve)]) {
            expect(V.distance(curvePointAt(curve, s), h.center)).toBeCloseTo(r, 6);
          }
          const a0 = V.angleOf(V.sub(curveStart(curve), h.center));
          const a1 = V.angleOf(V.sub(curveEnd(curve), h.center));
          const expected = h.startAngle + (h.direction === "left" ? 1 : -1) * h.totalAngle;
          expect(Math.cos(a0 - h.startAngle)).toBeCloseTo(1, 9);
          expect(Math.cos(a1 - expected)).toBeCloseTo(1, 9);
        }
        expect(h.treadsPerTurn * h.stepAngle).toBeCloseTo(2 * Math.PI, 9);
        expect(V.distance(h.center, shape.origin!)).toBeLessThan(TOL);
      }),
      { numRuns: 60 },
    );
  });

  it("erreurs explicites : angle par marche ≥ 180°, ligne de foulée hors emmarchement", () => {
    const tooWide = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      totalAngle: 400,
      floorToFloor: 600,
      riserCount: 3,
    });
    expect(() => computeLayout(tooWide)).toThrow(LayoutError);
    const outside = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      floorToFloor: 2700,
      walklineFromInner: 900,
    });
    expect(() => computeLayout(outside)).toThrow(/ligne de foulée/);
  });
});
