/** Briques de regroupement au bruit près (chantier `stable-tiebreaks`, S2). */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { groupNear, nearlyEqualDeep, nearlyEqualRelative } from "./grouping.js";

describe("groupNear", () => {
  it("clé exacte puis composantes connexes ; ordre de première apparition", () => {
    const items = [
      { k: "a", x: 0 },
      { k: "b", x: 0 },
      { k: "a", x: 10 },
      { k: "a", x: 1e-9 },
      { k: "b", x: 5 },
    ];
    const groups = groupNear(
      items,
      (i) => i.k,
      (p, q) => Math.abs(p.x - q.x) <= 1e-6,
    );
    expect(groups).toEqual([[items[0], items[3]], [items[1]], [items[2]], [items[4]]]);
  });

  it("propriété : la partition ne dépend pas de l'ordre d'entrée", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ k: fc.constantFrom("a", "b", "c"), x: fc.integer({ min: 0, max: 20 }) }),
          {
            maxLength: 30,
          },
        ),
        fc.array(fc.nat(), { minLength: 1, maxLength: 30 }),
        (raw, keys) => {
          const items = raw.map((r, id) => ({ ...r, id }));
          const shuffled = items
            .map((it, i) => ({ it, s: keys[i % keys.length]! * 64 + i }))
            .sort((a, b) => a.s - b.s)
            .map((e) => e.it);
          const near = (p: { x: number }, q: { x: number }): boolean => Math.abs(p.x - q.x) <= 1;
          const canon = (gs: { id: number }[][]): string =>
            JSON.stringify(gs.map((g) => g.map((i) => i.id).sort((a, b) => a - b)).sort());
          expect(canon(groupNear(shuffled, (i) => i.k, near))).toBe(
            canon(groupNear(items, (i) => i.k, near)),
          );
          // Représentant = premier élément du groupe dans l'ordre d'entrée.
          for (const g of groupNear(items, (i) => i.k, near)) {
            expect(g.map((i) => i.id)).toEqual([...g.map((i) => i.id)].sort((a, b) => a - b));
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("nearlyEqualDeep", () => {
  it("nombres à eps près, reste exact ; clé indéfinie = clé absente", () => {
    expect(nearlyEqualDeep({ a: [1, 2], b: "x" }, { a: [1 + 1e-9, 2], b: "x" }, 1e-6)).toBe(true);
    expect(nearlyEqualDeep({ a: [1, 2] }, { a: [1 + 1e-5, 2] }, 1e-6)).toBe(false);
    expect(nearlyEqualDeep({ a: [1, 2] }, { a: [1, 2, 3] }, 1e-6)).toBe(false);
    expect(nearlyEqualDeep({ a: 1, b: "x" }, { a: 1, b: "y" }, 1e-6)).toBe(false);
    expect(nearlyEqualDeep({ a: 1, u: undefined }, { a: 1 }, 1e-6)).toBe(true);
    expect(nearlyEqualDeep({ a: 1, u: 2 }, { a: 1 }, 1e-6)).toBe(false);
    expect(nearlyEqualDeep({ a: true }, { a: false }, 1e-6)).toBe(false);
    expect(nearlyEqualDeep([1], { 0: 1 }, 1e-6)).toBe(false);
    expect(nearlyEqualDeep(NaN, NaN, 1e-6)).toBe(true);
    expect(nearlyEqualDeep(Infinity, 1e308, 1e-6)).toBe(false);
  });
});

describe("nearlyEqualRelative", () => {
  it("écart relatif ; absence égale seulement à l'absence", () => {
    expect(nearlyEqualRelative(1, 1 + 1e-12, 1e-8)).toBe(true);
    expect(nearlyEqualRelative(1, 1 + 1e-6, 1e-8)).toBe(false);
    expect(nearlyEqualRelative(0, 0, 1e-8)).toBe(true);
    expect(nearlyEqualRelative(undefined, undefined, 1e-8)).toBe(true);
    expect(nearlyEqualRelative(undefined, 0, 1e-8)).toBe(false);
  });
});
