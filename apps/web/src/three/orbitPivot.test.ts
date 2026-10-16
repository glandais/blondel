import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PIVOT_AXES_SCREEN_FRACTION,
  PIVOT_TRANSITION_MS,
  easeInOut,
  pivotAt,
  pivotAxesLength,
} from "./orbitPivot.js";

const coord = fc.double({ min: -100, max: 100, noNaN: true });
const vec = fc.tuple(coord, coord, coord);

describe("pivot de l'orbite", () => {
  it("lissage : 0 → 0, 1 → 1, ½ → ½, monotone et borné hors de [0, 1]", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(easeInOut(lo)).toBeLessThanOrEqual(easeInOut(hi) + 1e-12);
        },
      ),
    );
  });

  it("transition : part de la cible, finit exactement sur le point visé", () => {
    fc.assert(
      fc.property(vec, vec, (from, to) => {
        const start = pivotAt(from, to, 0);
        expect(start.done).toBe(false);
        start.target.forEach((v, i) => expect(v).toBeCloseTo(from[i]!, 9));
        const end = pivotAt(from, to, PIVOT_TRANSITION_MS);
        expect(end.done).toBe(true);
        expect(end.target).toEqual([...to]);
        expect(pivotAt(from, to, 10 * PIVOT_TRANSITION_MS).target).toEqual([...to]);
      }),
    );
  });

  it("trièdre : taille proportionnelle à la distance, fraction fixe de la hauteur de vue", () => {
    expect(pivotAxesLength(0, 40)).toBe(0);
    // Champ de 90° : hauteur de vue = 2 × distance.
    expect(pivotAxesLength(5, 90)).toBeCloseTo(10 * PIVOT_AXES_SCREEN_FRACTION, 12);
    expect(pivotAxesLength(8, 40)).toBeCloseTo(2 * pivotAxesLength(4, 40), 12);
  });
});
