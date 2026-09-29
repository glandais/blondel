import fc from "fast-check";
import { ProjectSchema, buildModel, createProject, vec2, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  EXPERT_ANGLE_LIMIT_DEG,
  angleFromPointer,
  directionForAngle,
  expertAvailability,
  nosingAngleDeg,
  orphanOverrides,
  overrideNotes,
  overridesAt,
  perpendicularAt,
  roundAngle,
  withAngleOverride,
  withFixedOverride,
  withoutNosingOverrides,
} from "./expert.js";

const quarterLeft = createProject("quarter-left");
const quarterRight = createProject("quarter-right");
const modelLeft = buildModel(quarterLeft);
const modelRight = buildModel(quarterRight);

describe("géométrie des nez (mode expert)", () => {
  it("la perpendiculaire est unitaire, orthogonale à Γ et dirigée vers le mur (côté R)", () => {
    for (const model of [modelLeft, modelRight]) {
      for (const nosing of model.stepping.nosings) {
        const perp = perpendicularAt(model, nosing.index);
        expect(vec2.norm(perp)).toBeCloseTo(1, 9);
        // R est du côté du mur : P → R va dans le sens de la perpendiculaire.
        expect(vec2.dot(vec2.sub(nosing.r, nosing.p), perp)).toBeGreaterThan(0);
      }
    }
  });

  it("un nez droit a un angle nul, un nez balancé un angle non nul", () => {
    const nosings = modelLeft.stepping.nosings;
    expect(nosingAngleDeg(modelLeft, 0)).toBeCloseTo(0, 6);
    const balanced = nosings.find((n) => n.balanced);
    expect(balanced).toBeDefined();
    expect(Math.abs(nosingAngleDeg(modelLeft, balanced!.index))).toBeGreaterThan(1);
  });

  it("propriété : la poignée placée à l'angle a rend l'angle a (arrondi au pas), des deux côtés", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(modelLeft, modelRight),
        fc.nat(),
        fc.double({ min: -EXPERT_ANGLE_LIMIT_DEG, max: EXPERT_ANGLE_LIMIT_DEG, noNaN: true }),
        fc.double({ min: 50, max: 3000, noNaN: true }),
        fc.boolean(),
        (model, i, angle, dist, inward) => {
          const k = i % model.stepping.nosings.length;
          const p = model.stepping.nosings[k]!.p;
          const dir = directionForAngle(model, k, angle);
          const pointer = vec2.addScaled(p, dir, inward ? -dist : dist);
          const got = angleFromPointer(model, k, pointer);
          expect(got).not.toBeNull();
          expect(Math.abs(got! - angle)).toBeLessThanOrEqual(0.05 + 1e-9);
        },
      ),
    );
  });

  it("borne l'angle de la poignée et rend null sur P_k", () => {
    const k = 3;
    const p = modelLeft.stepping.nosings[k]!.p;
    const t = vec2.perpLeft(perpendicularAt(modelLeft, k));
    const near = vec2.addScaled(vec2.addScaled(p, t, 1000), perpendicularAt(modelLeft, k), 1);
    expect(Math.abs(angleFromPointer(modelLeft, k, near)!)).toBe(EXPERT_ANGLE_LIMIT_DEG);
    expect(angleFromPointer(modelLeft, k, p)).toBeNull();
    expect(angleFromPointer(modelLeft, 999, p)).toBeNull();
  });

  it("arrondit sans « −0 »", () => {
    expect(Object.is(roundAngle(-0.01), 0)).toBe(true);
    expect(roundAngle(12.345)).toBe(12.3);
    expect(roundAngle(-7.06)).toBe(-7.1);
  });

  it("refuse l'hélicoïdal (nez rayonnants)", () => {
    const helical = buildModel(createProject("helical"));
    expect(expertAvailability(helical).ok).toBe(false);
    expect(expertAvailability(modelLeft).ok).toBe(true);
  });
});

describe("surcharges des nez", () => {
  it("angle imposé : remplace l'angle précédent, garde le nez fixe, validé par le schéma", () => {
    let p: Project = withFixedOverride(quarterLeft, 4, true);
    p = withAngleOverride(p, 4, 10);
    p = withAngleOverride(p, 4, 12.5);
    expect(overridesAt(p, 4)).toEqual({ fixed: true, angle: 12.5 });
    expect(p.stair.nosingOverrides).toHaveLength(2);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(() => withAngleOverride(p, 4, Number.NaN)).toThrow();
  });

  it("nez fixe : ajout et retrait idempotents", () => {
    const a = withFixedOverride(withFixedOverride(quarterLeft, 2, true), 2, true);
    expect(a.stair.nosingOverrides).toEqual([{ kind: "fixed", index: 2 }]);
    expect(withFixedOverride(a, 2, false).stair.nosingOverrides).toEqual([]);
  });

  it("retrait par nez ou global", () => {
    let p = withAngleOverride(quarterLeft, 1, 5);
    p = withFixedOverride(p, 2, true);
    expect(withoutNosingOverrides(p, [1]).stair.nosingOverrides).toEqual([
      { kind: "fixed", index: 2 },
    ]);
    expect(withoutNosingOverrides(p).stair.nosingOverrides).toEqual([]);
  });

  it("l'angle imposé est appliqué par le cœur autour de P_k", () => {
    const k = modelLeft.stepping.nosings.find((n) => n.balanced)!.index;
    const p = withAngleOverride(quarterLeft, k, 7.5);
    const m = buildModel(ProjectSchema.parse(p));
    expect(nosingAngleDeg(m, k)).toBeCloseTo(7.5, 6);
    // Le point P_k ne bouge pas.
    expect(vec2.distance(m.stepping.nosings[k]!.p, modelLeft.stepping.nosings[k]!.p)).toBeLessThan(
      1e-6,
    );
  });

  it("un angle imposé qui rompt K3 est signalé dans les remarques du mode expert", () => {
    const k = modelLeft.stepping.nosings.find((n) => n.balanced)!.index;
    expect(overrideNotes(modelLeft)).toEqual([]);
    const m = buildModel(ProjectSchema.parse(withAngleOverride(quarterLeft, k, 30)));
    expect(overrideNotes(m).some((t) => t.startsWith("K3 : "))).toBe(true);
  });

  it("surcharge orpheline : listée, signalée par le cœur, jamais appliquée", () => {
    const n = modelLeft.stepping.nosings.length;
    const p = ProjectSchema.parse(withFixedOverride(quarterLeft, n + 2, true));
    const m = buildModel(p);
    expect(orphanOverrides(p, m)).toEqual([{ kind: "fixed", index: n + 2 }]);
    expect(overrideNotes(m).some((t) => t.includes("orpheline"))).toBe(true);
    expect(orphanOverrides(p, { stepping: { ...m.stepping, nosings: [] } })).toEqual([]);
  });
});
