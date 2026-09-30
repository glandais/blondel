import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { helicalShapeArb, makeHelicalProject } from "../layout/helical-test-helpers.js";
import { computeLayout } from "../layout/layout.js";
import type { Opening } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { computeStepping } from "../stepping/stepping.js";
import {
  ceilingOf,
  computeHeadroom,
  coveredIntervals,
  headroomOnWalkline,
  openingPolygon,
} from "./headroom.js";
import { circularOpening, helicalHeadroomBound, openingCircle } from "./helical.js";
import { slopeProfileOf } from "./profile.js";

const E_MIN = 1900;

function analyse(shape: Parameters<typeof makeHelicalProject>[0]) {
  const project = makeHelicalProject(shape);
  const layout = computeLayout(project);
  const stepping = computeStepping(project, layout);
  const h = layout.helical!;
  const bound = helicalHeadroomBound({
    riserCount: stepping.riserCount,
    rise: stepping.rise,
    stepAngle: h.stepAngle,
    walklineRadius: h.walklineRadius,
    treadThickness: project.stair.treads.thickness,
    nosing: project.stair.treads.nosing,
    landingAngle: h.landingAngle,
  });
  return {
    project,
    layout,
    stepping,
    bound,
    headroom: computeHeadroom(project.site, layout, stepping),
  };
}

const shapeWithLanding = fc
  .tuple(helicalShapeArb, fc.constantFrom(0, 10, 30, 45, 90, 120))
  .map(([s, landingAngle]) => ({ ...s, landingAngle, opening: undefined }));

describe("échappée d'un hélicoïdal sous lui-même (CHALLENGE G4)", () => {
  it("propriété : le calcul exact sur Γ retrouve la règle dérivée (sans dalle au-dessus)", () => {
    fc.assert(
      fc.property(shapeWithLanding, (shape) => {
        const { bound, headroom } = analyse(shape);
        expect(headroom).not.toBeNull();
        if (bound.min === null) expect(headroom!.walkline).toBeUndefined();
        else expect(headroom!.walkline!.min).toBeCloseTo(bound.min, 5);
      }),
      { numRuns: 80 },
    );
  });

  it("propriété : échappée sur la largeur (N − 1)·h − e, avec ou sans débord de nez", () => {
    // Relecture : sans débord, la ligne de nez est portée par le bord arrière de la marche du
    // tour supérieur ; le plafond était manqué (échappée sur la largeur absente).
    fc.assert(
      fc.property(
        helicalShapeArb.map((s) => ({ ...s, opening: undefined })),
        fc.constantFrom(0, 10),
        (shape, nosing) => {
          const { headroom, stepping, layout } = analyse({ ...shape, nosing });
          const N = shape.treadsPerTurn!;
          const e = shape.treadThickness!;
          expect(layout.helical!.treadsPerTurn).toBeCloseTo(N, 9);
          if (stepping.riserCount - 1 >= N) {
            expect(headroom!.width!.min).toBeCloseTo((N - 1) * stepping.rise - e, 6);
          } else {
            expect(headroom!.width).toBeUndefined();
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("propriété : avec une trémie, minimum des plafonds (dalle hors trémie, marches du tour supérieur)", () => {
    const openings: Opening[] = [
      { kind: "rect", x: -300, y: -2000, sizeX: 4000, sizeY: 4000 },
      { kind: "rect", x: 0, y: 0, sizeX: 2000, sizeY: 2000 },
      circularOpening({ x: 0, y: 0 }, 600),
    ];
    fc.assert(
      fc.property(
        helicalShapeArb.map((s) => ({ ...s, origin: { x: 0, y: 0 }, rotation: 0 })),
        fc.constantFrom(...openings),
        (shape, opening) => {
          const { project, layout, stepping, bound, headroom } = analyse({ ...shape, opening });
          const poly = openingPolygon(opening)!;
          const slabOnly = headroomOnWalkline(
            layout.walkline,
            slopeProfileOf(stepping),
            ceilingOf(project.site),
            coveredIntervals(layout.walkline, poly),
          );
          const values = [bound.min, slabOnly?.min ?? null].filter((v): v is number => v !== null);
          if (values.length === 0) expect(headroom!.walkline).toBeUndefined();
          else expect(headroom!.walkline!.min).toBeCloseTo(Math.min(...values), 5);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("propriété : ECHAPPEE_MIN_DTU conforme dès que n_tour est assez grand, violation détectée sinon", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 20 }),
        fc.integer({ min: 0, max: 60 }),
        (N, landing) => {
          const shape = {
            outerRadius: 900,
            coreRadius: 70,
            direction: "left" as const,
            treadsPerTurn: N,
            floorToFloor: 2700,
            riserCount: 15,
            landingAngle: landing,
          };
          const { bound } = analyse(shape);
          const model = buildModel(makeHelicalProject(shape));
          const result = model.compliance.results.find((r) => r.ruleId === "ECHAPPEE_MIN_DTU")!;
          const violated = bound.min !== null && bound.min < E_MIN;
          expect(result.status).toBe(violated ? "violation" : "ok");
          if (bound.min !== null) expect(model.headroom!.min).toBeCloseTo(bound.min, 5);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("n_tour = 12, h = 180, e = 40 : (N − 1 − δ/Δθ)·h − e sur Γ et (N − 1)·h − e sur la largeur", () => {
    const { headroom, bound, layout } = analyse({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      treadsPerTurn: 12,
      floorToFloor: 2700,
      riserCount: 15,
    });
    const delta = Math.asin(10 / layout.helical!.walklineRadius);
    const expected = (11 - delta / (Math.PI / 6)) * 180 - 40;
    expect(bound.treads).toBeCloseTo(expected, 9);
    expect(headroom!.walkline!.min).toBeCloseTo(expected, 6);
    expect(headroom!.width!.min).toBeCloseTo(11 * 180 - 40, 6);
    // Forme simplifiée de la consigne (au-dessus du dessus de marche, sans débord).
    expect(12 * 180 - 40 - expected).toBeGreaterThan(180);
  });

  it("collision (4 marches par tour, marches épaisses) : échappée très faible, jamais ignorée", () => {
    const { headroom } = analyse({
      outerRadius: 900,
      coreRadius: 70,
      direction: "right",
      treadsPerTurn: 4,
      floorToFloor: 1200,
      riserCount: 12,
      treadThickness: 60,
    });
    // (4 − 1 − δ/Δθ)·100 − 60 ≈ 239 mm.
    expect(headroom!.walkline!.min).toBeLessThan(300);
    expect(headroom!.walkline!.min).toBeGreaterThan(0);
  });

  it("collision réelle (3 marches par tour, h = 20, e = 60) : échappée négative rapportée", () => {
    const { headroom, bound } = analyse({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      treadsPerTurn: 3,
      floorToFloor: 600,
      riserCount: 30,
      treadThickness: 60,
      nosing: 0,
    });
    // (3 − 1)·20 − 60 = −20 : la sous-face du tour supérieur passe sous la ligne de pente.
    expect(bound.treads).toBeCloseTo(-20, 9);
    expect(headroom!.walkline!.min).toBeCloseTo(-20, 6);
    expect(headroom!.width!.min).toBeCloseTo(-20, 6);
  });

  it("circularOpening : polygone inscrit, flèche ≤ 0,5 mm", () => {
    const o = circularOpening({ x: 100, y: -50 }, 1000);
    expect(o.kind).toBe("polygon");
    if (o.kind !== "polygon") return;
    for (const p of o.points) expect(V.distance(p, { x: 100, y: -50 })).toBeCloseTo(1000, 1);
    const step = (2 * Math.PI) / o.points.length;
    expect(1000 * (1 - Math.cos(step / 2))).toBeLessThanOrEqual(0.5);
  });

  it("trémie circulaire : cercle exact déclaré (D3), relu du schéma, ignoré s'il ne correspond plus aux points", async () => {
    const { OpeningSchema } = await import("../model/project.js");
    const o = circularOpening({ x: 100, y: -50 }, 1000);
    expect(o.kind === "polygon" && o.circle).toEqual({ center: { x: 100, y: -50 }, radius: 1000 });
    const parsed = OpeningSchema.parse(JSON.parse(JSON.stringify(o)));
    expect(openingCircle(parsed)).toEqual({ center: { x: 100, y: -50 }, radius: 1000 });
    // Rétrocompatible : polygone sans cercle, rectangle.
    expect(
      OpeningSchema.safeParse({ kind: "polygon", points: o.kind === "polygon" ? o.points : [] })
        .success,
    ).toBe(true);
    expect(openingCircle({ kind: "rect", x: 0, y: 0, sizeX: 10, sizeY: 10 })).toBeUndefined();
    expect(openingCircle(undefined)).toBeUndefined();
    // Point édité : ce n'est plus un cercle.
    if (o.kind !== "polygon") return;
    const edited = {
      ...o,
      points: o.points.map((p, i) => (i === 0 ? { x: p.x + 50, y: p.y } : p)),
    };
    expect(openingCircle(edited)).toBeUndefined();
    // [review] Point supprimé : les autres restent sur le cercle, mais ce n'est plus lui.
    expect(openingCircle({ ...o, points: o.points.slice(1) })).toBeUndefined();
  });
});
