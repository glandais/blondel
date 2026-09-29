import {
  BalancingSchema,
  HERSE_DEFAULT_ANGLE,
  ROTATION_DEFAULT_REACH,
  ROTATION_DEFAULT_STEEPNESS,
  buildModel,
  createProject,
  type Model,
  type Project,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ANGLE_STEP,
  balancingMethodOptions,
  herseAlphaMaxOf,
  herseAngleRange,
  rotationRanges,
} from "./balancingForm.js";
import { enumOptions, fieldSchema } from "./structureForm.js";

const withBalancing = (p: Project, b: Partial<Project["stair"]["balancing"]>): Project => ({
  ...p,
  stair: { ...p.stair, balancing: { ...p.stair.balancing, ...b } },
});

/** Modèle réduit aux zones balancées (seule donnée lue par les curseurs). */
const zones = (...bounds: (number | undefined)[]): Pick<Model, "stepping"> =>
  ({
    stepping: {
      balancedZones: bounds.map((b, i) => ({
        turn: i,
        from: 0,
        to: 1,
        method: "M2",
        ...(b === undefined ? {} : { herseAlphaMax: b }),
      })),
    },
  }) as unknown as Pick<Model, "stepping">;

describe("méthodes de balancement", () => {
  it("toutes les méthodes du schéma du cœur sont proposées, M3 (défaut) en tête, M2 et M6 compris", () => {
    const values = balancingMethodOptions().map((o) => o.value);
    expect([...values].sort()).toEqual(
      [...(enumOptions(fieldSchema(BalancingSchema, "method")) ?? [])].sort(),
    );
    expect(values[0]).toBe("M3");
    expect(values).toContain("M2");
    expect(values).toContain("M6");
    for (const o of balancingMethodOptions()) expect(o.label).toMatch(new RegExp(`^${o.value} — `));
  });
});

describe("curseur α de la herse (M2)", () => {
  const base = createProject("quarter-left").stair.balancing;

  it("borne du modèle : la plus petite des zones, bornes ouvertes (un pas en dessous)", () => {
    expect(herseAlphaMaxOf(zones(51.8, 47.6))).toBeCloseTo(47.6, 9);
    expect(herseAlphaMaxOf(zones(undefined))).toBeNull();
    expect(herseAlphaMaxOf(null)).toBeNull();
    const r = herseAngleRange(base, zones(47.6));
    expect(r.max).toBe(47.5);
    expect(r.min).toBe(ANGLE_STEP);
    expect(r.modelBound).toBeCloseTo(47.6, 9);
    // Borne multiple du pas : exclue.
    expect(herseAngleRange(base, zones(45)).max).toBe(44.5);
  });

  it("sans borne du modèle : borne du schéma ]0 ; 90[ ; valeur par défaut du cœur", () => {
    const r = herseAngleRange(base, null);
    expect(r.max).toBe(89.5);
    expect(r.value).toBe(HERSE_DEFAULT_ANGLE);
    expect(r.isDefault).toBe(true);
    expect(r.modelBound).toBeNull();
    const s = herseAngleRange({ ...base, herseAngle: 12.5 }, null);
    expect(s.value).toBe(12.5);
    expect(s.isDefault).toBe(false);
  });

  it("propriété : min ≤ valeur ≤ max < borne, et toute position du curseur est acceptée par le schéma", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 89.9, noNaN: true }),
        fc.option(fc.double({ min: 0.01, max: 89.99, noNaN: true }), { nil: undefined }),
        (bound, angle) => {
          const r = herseAngleRange(
            { ...base, ...(angle === undefined ? {} : { herseAngle: angle }) },
            zones(bound),
          );
          expect(r.min).toBeLessThanOrEqual(r.max);
          expect(r.value).toBeGreaterThanOrEqual(r.min);
          expect(r.value).toBeLessThanOrEqual(r.max);
          if (bound > 2 * ANGLE_STEP) expect(r.max).toBeLessThan(bound);
          for (const v of [r.min, r.max, r.value]) {
            expect(BalancingSchema.safeParse({ method: "M2", herseAngle: v }).success).toBe(true);
          }
        },
      ),
    );
  });

  it("modèle réel (préréglages) : α au maximum du curseur garde une zone M2 retenue, sans erreur", () => {
    for (const id of ["quarter-left", "two-quarters-u", "half-turn", "two-quarters-s"] as const) {
      const p = withBalancing(createProject(id), { method: "M2" });
      const m = buildModel(p);
      expect(m.errors, id).toEqual([]);
      const r = herseAngleRange(p.stair.balancing, m);
      expect(r.modelBound, id).not.toBeNull();
      const top = buildModel(withBalancing(p, { herseAngle: r.max }));
      expect(top.errors, id).toEqual([]);
      expect(herseAlphaMaxOf(top), id).not.toBeNull();
    }
  });
});

describe("curseurs λ et p (M6)", () => {
  it("bornes du schéma, valeurs par défaut du cœur", () => {
    const b = createProject("quarter-left").stair.balancing;
    const { reach, steepness } = rotationRanges(b);
    expect(reach.max).toBe(50);
    expect(steepness.max).toBe(20);
    expect(reach.min).toBeGreaterThan(0);
    expect(reach.value).toBe(ROTATION_DEFAULT_REACH);
    expect(steepness.value).toBe(ROTATION_DEFAULT_STEEPNESS);
    expect(reach.isDefault && steepness.isDefault).toBe(true);
    const set = rotationRanges({ ...b, rotationReach: 3.5, rotationSteepness: 1.2 });
    expect(set.reach.value).toBe(3.5);
    expect(set.steepness.value).toBe(1.2);
    expect(set.reach.isDefault).toBe(false);
    for (const v of [reach.min, reach.max]) {
      expect(
        BalancingSchema.safeParse({ rotationReach: v, rotationSteepness: v > 20 ? 20 : v }).success,
      ).toBe(true);
    }
  });

  it("M6 sur les préréglages tournants : modèle sans erreur aux bornes des curseurs", () => {
    const p = withBalancing(createProject("quarter-left"), { method: "M6" });
    const { reach, steepness } = rotationRanges(p.stair.balancing);
    for (const [l, q] of [
      [reach.min, steepness.min],
      [reach.max, steepness.max],
      [reach.value, steepness.value],
    ] as const) {
      const m = buildModel(withBalancing(p, { rotationReach: l, rotationSteepness: q }));
      expect(m.errors).toEqual([]);
    }
  });
});
