import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isContinuous } from "../geom2d/curve.js";
import { signedArea } from "../geom2d/polygon.js";
import { computeLayout } from "./layout.js";
import { newelProtrusion, newelReach, newelSetback } from "./newel.js";
import { makeProject } from "./test-helpers.js";

describe("poteau décalé vers le jour (décision A13)", () => {
  it("s = a/2 + δ, p = a/2 − δ, portée √(s² + p²) ; centré : a/2 et a·√2/2", () => {
    const n = { kind: "newel" as const, size: 130, offset: 45 };
    expect(newelSetback(n)).toBe(110);
    expect(newelProtrusion(n)).toBe(20);
    expect(newelReach(n)).toBeCloseTo(Math.hypot(110, 20), 12);
    const c = { kind: "newel" as const, size: 100 };
    expect(newelSetback(c)).toBe(50);
    expect(newelProtrusion(c)).toBe(50);
    expect(newelReach(c)).toBeCloseTo(50 * Math.SQRT2, 12);
  });

  it("propriété : C_i continu, emprise diminuée de 2·p·a − p² (débord du poteau côté marches)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 700, max: 1200 }),
        fc.integer({ min: 0, max: 1200 }),
        fc.integer({ min: 0, max: 1200 }),
        fc.integer({ min: 30, max: 90 }).map((k) => 2 * k),
        fc.double({ min: 0, max: 0.95, noNaN: true }),
        fc.constantFrom("left" as const, "right" as const),
        (E, x1, x2, size, frac, direction) => {
          const offset = Math.floor((size / 2) * frac);
          const inner = { kind: "newel" as const, size, offset };
          const legs = [E + 200 + x1, E + 200 + x2];
          const layout = computeLayout(makeProject({ width: E, legs, inner, direction }));
          expect(isContinuous(layout.inner)).toBe(true);
          const p = newelProtrusion(inner);
          const expected = E * (legs[0]! + legs[1]!) - E * E - (2 * p * size - p * p);
          expect(Math.abs(Math.abs(signedArea(layout.footprint)) - expected)).toBeLessThan(1e-3);
        },
      ),
      { numRuns: 60 },
    );
  });
});
