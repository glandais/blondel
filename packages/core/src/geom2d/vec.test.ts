import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as V from "./vec.js";

const coord = fc.double({ min: -1e4, max: 1e4, noNaN: true });
const vecArb = fc.record({ x: coord, y: coord });
const angle = fc.double({ min: -10, max: 10, noNaN: true });

describe("vec2", () => {
  it("opérations de base", () => {
    const a = V.vec(1, 2);
    const b = V.vec(3, -1);
    expect(V.add(a, b)).toEqual({ x: 4, y: 1 });
    expect(V.sub(a, b)).toEqual({ x: -2, y: 3 });
    expect(V.scale(a, 2)).toEqual({ x: 2, y: 4 });
    expect(V.dot(a, b)).toBe(1);
    expect(V.cross(a, b)).toBe(-7);
    expect(V.norm(V.vec(3, 4))).toBe(5);
    expect(V.normalize(V.vec(0, 5))).toEqual({ x: 0, y: 1 });
    expect(V.perpLeft(V.vec(1, 0))).toEqual({ x: -0, y: 1 });
    expect(V.perpRight(V.vec(1, 0))).toEqual({ x: 0, y: -1 });
    expect(V.lerp(a, b, 0.5)).toEqual({ x: 2, y: 0.5 });
    expect(V.distance(V.vec(0, 0), V.vec(3, 4))).toBe(5);
    const r = V.rotate(V.vec(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
    const rp = V.rotate(V.vec(2, 1), Math.PI, V.vec(1, 1));
    expect(rp.x).toBeCloseTo(0, 12);
    expect(rp.y).toBeCloseTo(1, 12);
    expect(() => V.normalize(V.ZERO)).toThrow();
  });

  it("la rotation conserve la norme et l'angle signé", () => {
    fc.assert(
      fc.property(vecArb, angle, (a, t) => {
        const r = V.rotate(a, t);
        expect(Math.abs(V.norm(r) - V.norm(a))).toBeLessThan(1e-9 * (1 + V.norm(a)));
        if (V.norm(a) > 1e-3) {
          const diff = V.signedAngle(a, r) - t;
          const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
          expect(Math.abs(wrapped)).toBeLessThan(1e-7);
        }
      }),
    );
  });

  it("perpLeft est orthogonal et à gauche", () => {
    fc.assert(
      fc.property(vecArb, (a) => {
        const p = V.perpLeft(a);
        expect(V.dot(a, p)).toBeCloseTo(0, 6);
        expect(V.cross(a, p)).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
