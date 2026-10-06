import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { ProjectSchema, buildModel, createProject, vec2, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { BALANCING_METHOD_LABELS } from "./balancingForm.js";
import {
  EXPERT_ANGLE_LIMIT_DEG,
  arrivalNosingIndex,
  clampAngle,
  nosingEditAvailability,
  orphanOverrides,
  overrideLabel,
  overridesByNosing,
  overrideNotes,
  overridesAt,
  roundAngle,
  withAngleOverride,
  withFixedOverride,
  withoutNosingOverrides,
  zoneMethodLabel,
  zoneOfNosing,
  zoneOfTread,
} from "./nosingOverrides.js";

const quarterLeft = createProject("quarter-left");
const modelLeft = buildModel(quarterLeft);
/** Le cœur expose-t-il l'angle des lignes de nez (`NosingLine.angle`) ? */
const coreAngles = modelLeft.stepping.nosings.some((n) => n.angle !== undefined);

const FR = translatorFor("fr");
const EN = translatorFor("en");

describe("disponibilité et arrondis", () => {
  it("refuse l'hélicoïdal (nez rayonnants) et un modèle sans nez", () => {
    const helical = buildModel(createProject("helical"));
    const off = nosingEditAvailability(helical);
    expect(off.ok).toBe(false);
    if (!off.ok) expect(FR.t(off.reason)).toContain("rayonnantes");
    expect(nosingEditAvailability(modelLeft).ok).toBe(true);
    const empty = nosingEditAvailability({
      layout: modelLeft.layout,
      stepping: { ...modelLeft.stepping, nosings: [] },
    });
    expect(empty.ok).toBe(false);
  });

  it("nez d'arrivée (A28) : dernier nez, aucune marche ne le porte ; éditable comme les autres", () => {
    const last = modelLeft.stepping.nosings.length - 1;
    expect(arrivalNosingIndex(modelLeft.stepping)).toBe(last);
    expect(modelLeft.stepping.treads.some((t) => t.number === last + 1)).toBe(false);
    // Disponibilité de l'édition : la même que pour les nez des marches (tracé à volées).
    expect(nosingEditAvailability(modelLeft).ok).toBe(true);
    const straight = buildModel(createProject("straight"));
    expect(arrivalNosingIndex(straight.stepping)).toBe(straight.stepping.nosings.length - 1);
    expect(nosingEditAvailability(straight).ok).toBe(true);
    // Sans nez : pas de nez d'arrivée, édition indisponible.
    expect(arrivalNosingIndex({ ...modelLeft.stepping, nosings: [] })).toBeNull();
    // Découpage tronqué (le dernier nez porte une marche) : pas de nez d'arrivée.
    const cut = { ...modelLeft.stepping, nosings: modelLeft.stepping.nosings.slice(0, last) };
    expect(arrivalNosingIndex(cut)).toBeNull();
    // Hélicoïdal : le nez d'arrivée existe, mais l'édition reste indisponible (motif affiché).
    const helical = buildModel(createProject("helical"));
    expect(arrivalNosingIndex(helical.stepping)).toBe(helical.stepping.nosings.length - 1);
    expect(nosingEditAvailability(helical).ok).toBe(false);
  });

  it("nez d'arrivée : retouches d'angle et de nez fixe écrites et retirées comme les autres", () => {
    const k = arrivalNosingIndex(modelLeft.stepping)!;
    const p = withFixedOverride(withAngleOverride(quarterLeft, k, 3), k, true);
    expect(overridesAt(p, k)).toEqual({ fixed: true, angle: 3 });
    expect(orphanOverrides(p, modelLeft)).toEqual([]);
    expect(overridesAt(withoutNosingOverrides(p, [k]), k)).toEqual({ fixed: false, angle: null });
  });

  it("arrondit au dixième sans « −0 »", () => {
    expect(roundAngle(4.449)).toBe(4.4);
    expect(roundAngle(-0.04)).toBe(0);
    expect(Object.is(roundAngle(-0.04), -0)).toBe(false);
    expect(roundAngle(12.25, 0.5)).toBe(12.5);
  });

  it("propriété : angle borné à ± la limite et arrondi au pas", () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (a) => {
        const c = clampAngle(a);
        expect(Math.abs(c)).toBeLessThanOrEqual(EXPERT_ANGLE_LIMIT_DEG);
        expect(Math.abs(c * 10 - Math.round(c * 10))).toBeLessThan(1e-9);
      }),
    );
  });
});

describe("retouches des nez", () => {
  it("angle imposé : remplace l'angle précédent, garde le nez fixe, validé par le schéma", () => {
    let p: Project = withFixedOverride(quarterLeft, 4, true);
    p = withAngleOverride(p, 4, 10);
    p = withAngleOverride(p, 4, 12.5);
    expect(overridesAt(p, 4)).toEqual({ fixed: true, angle: 12.5 });
    expect(overridesAt(p, 3)).toEqual({ fixed: false, angle: null });
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

  it("l'angle imposé est appliqué par le cœur autour de P_k (P_k immobile)", () => {
    const k = modelLeft.stepping.nosings.find((n) => n.balanced)!.index;
    const m = buildModel(ProjectSchema.parse(withAngleOverride(quarterLeft, k, 7.5)));
    expect(vec2.distance(m.stepping.nosings[k]!.p, modelLeft.stepping.nosings[k]!.p)).toBeLessThan(
      1e-6,
    );
    expect(
      vec2.distance(m.stepping.nosings[k]!.dir, modelLeft.stepping.nosings[k]!.dir),
    ).toBeGreaterThan(1e-6);
  });

  it.skipIf(!coreAngles)(
    "angle exposé par le cœur : retouche lue, valeur calculée en regard",
    () => {
      const k = modelLeft.stepping.nosings.find((n) => n.balanced)!.index;
      const before = modelLeft.stepping.nosings[k]!.angle!;
      const m = buildModel(ProjectSchema.parse(withAngleOverride(quarterLeft, k, 7.5)));
      expect(m.stepping.nosings[k]!.angle).toBeCloseTo(7.5, 6);
      expect(m.stepping.nosings[k]!.computedAngle).toBeCloseTo(before, 6);
      expect(modelLeft.stepping.nosings[k]!.computedAngle).toBeUndefined();
    },
  );

  it("un angle imposé qui rompt K3 est signalé dans les remarques", () => {
    const k = modelLeft.stepping.nosings.find((n) => n.balanced)!.index;
    expect(overrideNotes(modelLeft)).toEqual([]);
    const m = buildModel(ProjectSchema.parse(withAngleOverride(quarterLeft, k, 30)));
    expect(overrideNotes(m).some((t) => FR.t(t).startsWith("K3 : "))).toBe(true);
  });

  it("retouche orpheline : listée, signalée par le cœur, jamais appliquée", () => {
    const n = modelLeft.stepping.nosings.length;
    const p = ProjectSchema.parse(withFixedOverride(quarterLeft, n + 2, true));
    const m = buildModel(p);
    expect(orphanOverrides(p, m)).toEqual([{ kind: "fixed", index: n + 2 }]);
    expect(overrideNotes(m).some((t) => FR.t(t).includes("orpheline"))).toBe(true);
    expect(orphanOverrides(p, { stepping: { ...m.stepping, nosings: [] } })).toEqual([]);
  });

  it("retouches regroupées par nez, indices croissants", () => {
    let p = withAngleOverride(quarterLeft, 5, 2);
    p = withFixedOverride(p, 1, true);
    p = withFixedOverride(p, 5, true);
    expect(overridesByNosing(p)).toEqual([
      { index: 1, overrides: [{ kind: "fixed", index: 1 }] },
      {
        index: 5,
        overrides: [
          { kind: "angle", index: 5, angle: 2 },
          { kind: "fixed", index: 5 },
        ],
      },
    ]);
    expect(overridesByNosing(withoutNosingOverrides(p))).toEqual([]);
  });

  it("libellés courts, en français et en anglais", () => {
    expect(overrideLabel({ kind: "fixed", index: 3 }, "fr")).toBe("nez 3 : fixe");
    expect(overrideLabel({ kind: "angle", index: 3, angle: 4.5 }, "fr")).toBe(
      "nez 3 : angle imposé 4,5°",
    );
    expect(overrideLabel({ kind: "angle", index: 3, angle: 4.5 }, "en")).toBe(
      "nosing 3: imposed angle 4.5°",
    );
  });
});

describe("zones balancées (lecture du découpage)", () => {
  const stepping = {
    balancedZones: [{ turn: 0, from: 1, to: 6, method: "M3-quintic" }],
  };

  it("nez et marches d'une zone, bornes comprises", () => {
    expect(zoneOfNosing(stepping, 0)).toBeUndefined();
    expect(zoneOfNosing(stepping, 1)?.turn).toBe(0);
    expect(zoneOfNosing(stepping, 6)?.turn).toBe(0);
    expect(zoneOfNosing(stepping, 7)).toBeUndefined();
    // Marche n : entre les nez n − 1 et n.
    expect(zoneOfTread(stepping, 1)).toBeUndefined();
    expect(zoneOfTread(stepping, 2)?.turn).toBe(0);
    expect(zoneOfTread(stepping, 6)?.turn).toBe(0);
    expect(zoneOfTread(stepping, 7)).toBeUndefined();
  });

  it("les marches balancées du cœur sont dans une zone", () => {
    for (const t of modelLeft.stepping.treads) {
      if (t.kind === "winder") expect(zoneOfTread(modelLeft.stepping, t.number)).toBeDefined();
    }
  });

  it("libellé de méthode : variante de M3, méthode, sinon notation brute", () => {
    const tr = (m: ReturnType<typeof zoneMethodLabel>, t = FR) =>
      typeof m === "string" ? m : t.t(m);
    expect(tr(zoneMethodLabel("M3-quintic", BALANCING_METHOD_LABELS))).toBe(
      "M3 · courbe continue (quintique)",
    );
    expect(tr(zoneMethodLabel("M3-cubic", BALANCING_METHOD_LABELS), EN)).not.toContain("cubique");
    expect(tr(zoneMethodLabel("M1", BALANCING_METHOD_LABELS))).toBe(
      "M1 · progression arithmétique des collets",
    );
    expect(zoneMethodLabel("M9-x", BALANCING_METHOD_LABELS)).toBe("M9-x");
  });
});
