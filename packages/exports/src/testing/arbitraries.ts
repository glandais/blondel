/**
 * Générateurs fast-check contraints (docs/CHALLENGE.md A7) : H ∈ [2 200 ; 3 500],
 * E ∈ [700 ; 1 200], h cible ∈ [150 ; 190], g ∈ [220 ; 300]. Réservé aux tests.
 */
import fc from "fast-check";
import type { Model } from "@blondel/core";
import { layoutModel, layoutProject, quarterTurnModel, straightModel } from "./fixtures.js";

export const straightArb: fc.Arbitrary<Model> = fc
  .record({
    H: fc.integer({ min: 2200, max: 3500 }),
    E: fc.integer({ min: 700, max: 1200 }),
    h: fc.integer({ min: 150, max: 190 }),
    g: fc.integer({ min: 220, max: 300 }),
  })
  .map(({ H, E, h, g }) =>
    straightModel({
      floorToFloor: H,
      width: E,
      going: g,
      riserCount: Math.max(2, Math.round(H / h)),
    }),
  );

export const quarterArb: fc.Arbitrary<Model> = fc
  .record({
    E: fc.integer({ min: 700, max: 1000 }),
    L1: fc.integer({ min: 1500, max: 3000 }),
    L2: fc.integer({ min: 1500, max: 3000 }),
    g: fc.integer({ min: 230, max: 280 }),
  })
  .map(({ E, L1, L2, g }) => {
    const walk = L1 - E + (Math.PI * E) / 4 + L2 - E;
    const n = Math.max(6, Math.round(walk / g) + 1);
    return quarterTurnModel({
      width: E,
      legs: [L1, L2],
      riserCount: n,
      floorToFloor: n * 175,
      windersPerSide: 2,
    });
  });

/**
 * Tracés réels (`computeLayout`) : droit ou quart tournant, à gauche ou à droite, jour vif, en
 * arc ou à poteau, placement quelconque. E ∈ [700 ; 1 200], volées au-delà du minimum requis.
 */
export const layoutArb: fc.Arbitrary<Model> = fc
  .record({
    E: fc.integer({ min: 700, max: 1200 }),
    turn: fc.boolean(),
    direction: fc.constantFrom("left" as const, "right" as const),
    inner: fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 50, max: 300 }) }),
      fc.integer({ min: 30, max: 75 }).map((k) => ({ kind: "newel" as const, size: 2 * k })),
    ),
    extra: fc.tuple(fc.integer({ min: 800, max: 2500 }), fc.integer({ min: 800, max: 2500 })),
    origin: fc.record({
      x: fc.integer({ min: -5000, max: 5000 }),
      y: fc.integer({ min: -5000, max: 5000 }),
    }),
    rotation: fc.integer({ min: -180, max: 180 }),
    g: fc.integer({ min: 230, max: 280 }),
  })
  .map(({ E, turn, direction, inner, extra, origin, rotation, g }) => {
    const setback =
      inner.kind === "arc" ? inner.radius : inner.kind === "newel" ? inner.size / 2 : 0;
    const legs = turn ? [E + setback + extra[0], E + setback + extra[1]] : [extra[0] + extra[1]];
    const project = layoutProject({ width: E, legs, direction, inner, origin, rotation });
    const walk = legs.reduce((a, b) => a + b, 0);
    return layoutModel(project, { riserCount: Math.max(6, Math.round(walk / g)) });
  });
