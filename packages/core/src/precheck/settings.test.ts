/**
 * Réglages du prédimensionnement (`settings.ts`) : classes de lamellé-collé GL24h / GL28h /
 * GL32h (QUESTIONS A33 (a), valeurs NF EN 14080 rapportées par C §1.11 [71]), classe `auto`,
 * γ_M du lamellé-collé.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRECHECK_SETTINGS,
  GLULAM_WOOD_CLASSES,
  PRECHECK_PROVENANCE,
  PrecheckSettingsSchema,
  WOOD_CLASSES,
  WOOD_CLASS_PROPERTIES,
  WOOD_CLASS_SETTINGS,
  resolveWoodClass,
  woodMaterialOf,
  type WoodClass,
} from "./settings.js";

const settings = (over: Record<string, unknown> = {}) => PrecheckSettingsSchema.parse(over);

describe("classe de bois du prédimensionnement", () => {
  it("défaut `auto` : GL24h pour l'essence lamellé-collé, C24 sinon ou sans essence", () => {
    expect(DEFAULT_PRECHECK_SETTINGS.woodClass).toBe("auto");
    expect(resolveWoodClass(DEFAULT_PRECHECK_SETTINGS, "wood-glulam")).toBe("GL24h");
    expect(resolveWoodClass(DEFAULT_PRECHECK_SETTINGS, "wood-oak")).toBe("C24");
    expect(resolveWoodClass(DEFAULT_PRECHECK_SETTINGS)).toBe("C24");
  });

  it("classe saisie conservée, quelle que soit l'essence", () => {
    for (const cls of WOOD_CLASSES) {
      for (const material of [undefined, "wood-glulam", "wood-oak"]) {
        expect(resolveWoodClass(settings({ woodClass: cls }), material)).toBe(cls);
      }
    }
    expect(WOOD_CLASS_SETTINGS).toEqual([...WOOD_CLASSES, "auto"]);
  });

  it("propriétés GL (NF EN 14080 via C §1.11 [71]) : E 11 500 / 12 600 / 14 200 MPa, f_m,k 24 / 28 / 32 MPa", () => {
    expect(GLULAM_WOOD_CLASSES).toEqual(["GL24h", "GL28h", "GL32h"]);
    expect(GLULAM_WOOD_CLASSES.map((c) => WOOD_CLASS_PROPERTIES[c].e)).toEqual([
      11_500, 12_600, 14_200,
    ]);
    expect(GLULAM_WOOD_CLASSES.map((c) => WOOD_CLASS_PROPERTIES[c].fmk)).toEqual([24, 28, 32]);
    for (const c of GLULAM_WOOD_CLASSES) {
      expect(WOOD_CLASS_PROPERTIES[c].sourced.key).toBe(`precheck.woodClass.${c}`);
    }
  });

  it("γ_M du lamellé-collé 1,25 (à valider) appliqué aux seules classes GL", () => {
    const s = DEFAULT_PRECHECK_SETTINGS;
    expect(s.gammaMGlulam).toBe(1.25);
    expect(PRECHECK_PROVENANCE.gammaMGlulam.status).toBe("a-valider");
    for (const cls of WOOD_CLASSES) {
      const m = woodMaterialOf(settings({ woodClass: cls }), 500);
      const gammaM = GLULAM_WOOD_CLASSES.includes(cls) ? s.gammaMGlulam : s.gammaMWood;
      expect(m.label).toBe(cls);
      expect(m.kind).toBe("wood");
      expect(m.e).toBe(WOOD_CLASS_PROPERTIES[cls].e);
      expect(m.strength).toBe(WOOD_CLASS_PROPERTIES[cls].fmk);
      expect(m.design).toBeCloseTo((s.kmod * WOOD_CLASS_PROPERTIES[cls].fmk) / gammaM, 12);
      expect(m.density).toBe(500);
    }
    // `auto` : classe et γ_M suivent l'essence.
    const glulam = woodMaterialOf(s, 450, "wood-glulam");
    expect(glulam.label).toBe("GL24h");
    expect(glulam.design).toBeCloseTo((0.8 * 24) / 1.25, 12);
    const oak = woodMaterialOf(s, 700, "wood-oak");
    expect(oak.label).toBe("C24");
    expect(oak.design).toBeCloseTo((0.8 * 24) / 1.3, 12);
  });

  it("propriété : résistance de calcul croissante avec la classe GL, à k_mod et γ_M fixés", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.2, max: 1.1, noNaN: true }),
        fc.double({ min: 1, max: 2, noNaN: true }),
        (kmod, gammaMGlulam) => {
          const designs = GLULAM_WOOD_CLASSES.map(
            (cls: WoodClass) =>
              woodMaterialOf(settings({ woodClass: cls, kmod, gammaMGlulam }), 450).design,
          );
          for (let i = 1; i < designs.length; i++) {
            expect(designs[i]!).toBeGreaterThan(designs[i - 1]!);
          }
        },
      ),
    );
  });
});
