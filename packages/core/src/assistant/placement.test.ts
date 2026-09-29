import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { openingPolygon } from "../headroom/headroom.js";
import type { FlightsLayoutSpec } from "../model/project.js";
import {
  arrivalFrame,
  arrivalPlacements,
  convexOverlap,
  discOverlap,
  grossPieces,
  toWorld,
  wallCollision,
} from "./placement.js";

/** Cas d'acceptation n° 1 (examples/acceptance-01-quart-tournant.blondel.json). */
const ACCEPTANCE_SPEC: FlightsLayoutSpec = {
  width: 800,
  legs: [{ length: 1280 }, { length: 3052 }],
  turns: [{ direction: "left", mode: "winders", inner: { kind: "newel", size: 100 } }],
};
const ACCEPTANCE_OPENING = openingPolygon({
  kind: "rect",
  x: -2252,
  y: 380,
  sizeX: 2800,
  sizeY: 900,
})!;

describe("calage sur la trémie", () => {
  it("retrouve le placement du cas d'acceptation n° 1 (arrivée côté x min, au nu du bord)", () => {
    const frame = arrivalFrame(ACCEPTANCE_SPEC, 400, 0, 0);
    const { placements } = arrivalPlacements(frame, ACCEPTANCE_OPENING, [], 0.5);
    const found = placements.find((p) => p.rotation === 0 && p.origin.x === 0 && p.origin.y === 0);
    expect(found?.fit).toMatch(/côté x min/);
  });

  it("largeur hors tout trop grande : aucun placement, écart signalé", () => {
    const frame = arrivalFrame({ width: 800, legs: [{ length: 3000 }], turns: [] }, 400, 60, 60);
    const small = openingPolygon({ kind: "rect", x: 0, y: 0, sizeX: 900, sizeY: 900 })!;
    const res = arrivalPlacements(frame, small, [], 0.5);
    expect(res.placements).toEqual([]);
    expect(res.misfit).toEqual({ needed: 920, available: 900 });
  });

  it("au nu d'un mur perpendiculaire au côté d'arrivée", () => {
    const frame = arrivalFrame({ width: 800, legs: [{ length: 3000 }], turns: [] }, 400, 0, 0);
    const opening = openingPolygon({ kind: "rect", x: 0, y: 0, sizeX: 1200, sizeY: 3000 })!;
    const wall = { id: "M", a: { x: 1300, y: -2000 }, b: { x: 1300, y: 4000 }, thickness: 200 };
    const { placements } = arrivalPlacements(frame, opening, [{ ...wall, loadBearing: true }], 0.5);
    const along = placements.filter((p) => p.fit.includes("mur M"));
    expect(along.length).toBeGreaterThan(0);
    for (const p of along) {
      const pieces = grossPieces({ width: 800, legs: [{ length: 3000 }], turns: [] }, 0, 0).map(
        (poly) => poly.map((q) => toWorld(q, p)),
      );
      // Au nu du parement x = 1 200 : contact sans collision.
      expect(Math.max(...pieces[0]!.map((q) => q.x))).toBeCloseTo(1200, 6);
      expect(wallCollision(pieces, [{ ...wall, loadBearing: true }], 0.5)).toBeNull();
    }
  });

  it("propriété : l'arrivée hors tout est sur un côté de la trémie, montée vers l'extérieur", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 700, max: 1200 }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 900, max: 1600 }),
        fc.integer({ min: 1500, max: 4000 }),
        fc.boolean(),
        fc.constantFrom<"left" | "right">("left", "right"),
        (width, tIn, tOut, sx, sy, turn, direction) => {
          const spec: FlightsLayoutSpec = turn
            ? {
                width,
                legs: [{ length: width + 600 }, { length: width + 1500 }],
                turns: [{ direction, mode: "winders", inner: { kind: "sharp" } }],
              }
            : { width, legs: [{ length: 3000 }], turns: [] };
          const frame = arrivalFrame(spec, width / 2, tIn, tOut);
          const opening = openingPolygon({ kind: "rect", x: -300, y: 200, sizeX: sx, sizeY: sy })!;
          const { placements } = arrivalPlacements(frame, opening, [], 0.5);
          for (const p of placements) {
            for (const q of [frame.grossInner, frame.grossOuter, frame.walkPoint]) {
              expect(pointInPolygon(toWorld(q, p), opening, 1e-6)).toBe("boundary");
            }
            // Un pas en arrière de l'arrivée (dans la montée) est dans la trémie.
            const back = toWorld(V.addScaled(frame.walkPoint, frame.dir, -1), p);
            expect(pointInPolygon(back, opening, 0)).toBe("inside");
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("emprise et collisions", () => {
  it("emprise hors tout : rectangles des volées élargis, carré du poteau", () => {
    const pieces = grossPieces(ACCEPTANCE_SPEC, 45, 45);
    expect(pieces).toHaveLength(3);
    const xs = pieces[0]!.map((p) => p.x);
    expect(Math.min(...xs)).toBe(-45);
    expect(Math.max(...xs)).toBe(845);
  });

  it("contact au nu : pas de collision ; recouvrement : collision", () => {
    const a = [V.vec(0, 0), V.vec(10, 0), V.vec(10, 10), V.vec(0, 10)];
    const b = [V.vec(10, 0), V.vec(20, 0), V.vec(20, 10), V.vec(10, 10)];
    const c = [V.vec(9, 0), V.vec(20, 0), V.vec(20, 10), V.vec(9, 10)];
    expect(convexOverlap(a, b, 0.5)).toBe(false);
    expect(convexOverlap(a, c, 0.5)).toBe(true);
    expect(discOverlap(V.vec(15, 5), 5, a, 0.5)).toBe(false);
    expect(discOverlap(V.vec(14, 5), 5, a, 0.5)).toBe(true);
  });
});
