import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import {
  PiecewiseLinear,
  clipConvex,
  clipHalfPlane,
  isSimplePolygon,
  minAreaRect,
  polygonDistance,
  removeCollinear,
} from "./geom.js";

const square = [V.vec(0, 0), V.vec(10, 0), V.vec(10, 10), V.vec(0, 10)];

describe("outils géométriques des structures", () => {
  it("découpe par un demi-plan", () => {
    const half = clipHalfPlane(square, V.vec(0, 4), V.vec(0, 1));
    expect(Math.abs(signedArea(half))).toBeCloseTo(60, 9);
    expect(clipHalfPlane(square, V.vec(0, 20), V.vec(0, 1))).toEqual([]);
  });

  it("intersection avec un convexe", () => {
    const tri = [V.vec(5, -5), V.vec(15, 5), V.vec(5, 15)];
    const r = clipConvex(square, tri);
    expect(Math.abs(signedArea(r))).toBeCloseTo(50, 9);
  });

  it("polygone simple ou croisé", () => {
    expect(isSimplePolygon(square)).toBe(true);
    expect(isSimplePolygon([V.vec(0, 0), V.vec(10, 10), V.vec(10, 0), V.vec(0, 10)])).toBe(false);
  });

  it("distance entre polygones", () => {
    const b = square.map((p) => V.add(p, V.vec(13, 4)));
    expect(polygonDistance(square, b)).toBeCloseTo(3, 12);
    expect(
      polygonDistance(
        square,
        square.map((p) => V.add(p, V.vec(5, 5))),
      ),
    ).toBe(0);
  });

  it("retire les sommets alignés", () => {
    expect(
      removeCollinear([V.vec(0, 0), V.vec(5, 0), V.vec(10, 0), V.vec(10, 10), V.vec(0, 10)]),
    ).toHaveLength(4);
  });

  it("propriété : rectangle orienté minimal d'un rectangle tourné = ses dimensions", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 5000, noNaN: true }),
        fc.double({ min: 10, max: 500, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        (L, W, angle) => {
          const pts = [V.vec(0, 0), V.vec(L, 0), V.vec(L, W), V.vec(0, W)].map((p) =>
            V.rotate(p, angle),
          );
          const box = minAreaRect(pts);
          expect(box.length).toBeCloseTo(Math.max(L, W), 6);
          expect(box.width).toBeCloseTo(Math.min(L, W), 6);
        },
      ),
    );
  });

  it("fonction affine par morceaux prolongée", () => {
    const f = new PiecewiseLinear([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]);
    expect(f.at(5)).toBe(5);
    expect(f.at(-10)).toBe(-10);
    expect(f.at(30)).toBe(10);
    expect(f.knotsBetween(0, 20)).toEqual([10]);
  });
});
