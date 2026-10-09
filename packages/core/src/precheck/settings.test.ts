/**
 * Réglages du prédimensionnement (`settings.ts`) : classes de lamellé-collé GL24h / GL28h /
 * GL32h (QUESTIONS A33 (a), valeurs NF EN 14080 rapportées par C §1.11 [71]), classe `auto`,
 * γ_M du lamellé-collé ; D30 des essences feuillues, massives ou lamellées-collées, et classes
 * massives de l'EN 338 (QUESTIONS A36 (1), (2), C §1.11 [84][89][90]).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRECHECK_SETTINGS,
  GLULAM_WOOD_CLASSES,
  HARDWOOD_WOOD_CLASS,
  PRECHECK_PROVENANCE,
  PrecheckSettingsSchema,
  WOOD_CLASSES,
  WOOD_CLASS_PROPERTIES,
  WOOD_CLASS_SETTINGS,
  resolveWoodClass,
  woodMaterialOf,
  type WoodClass,
} from "./settings.js";
import { WOOD_MATERIALS } from "../workshop/profile.js";

const settings = (over: Record<string, unknown> = {}) => PrecheckSettingsSchema.parse(over);

describe("classe de bois du prédimensionnement", () => {
  it("défaut `auto` : GL24h pour l'essence lamellé-collé, D30 pour un feuillu, C24 sinon ou sans essence", () => {
    expect(DEFAULT_PRECHECK_SETTINGS.woodClass).toBe("auto");
    expect(resolveWoodClass(DEFAULT_PRECHECK_SETTINGS, "wood-glulam")).toBe("GL24h");
    expect(resolveWoodClass(DEFAULT_PRECHECK_SETTINGS, "wood-oak")).toBe("D30");
    expect(resolveWoodClass(DEFAULT_PRECHECK_SETTINGS, "wood-pine")).toBe("C24");
    expect(resolveWoodClass(DEFAULT_PRECHECK_SETTINGS)).toBe("C24");
  });

  it("essences feuillues (A36 (1)) : D30 pour chêne, hêtre, frêne, massif ou lamellé-collé ; GL24h, C24 sinon", () => {
    const s = DEFAULT_PRECHECK_SETTINGS;
    // Essences feuillues du code : toutes celles de WOOD_MATERIALS sauf le pin et le lamellé-collé.
    expect(WOOD_MATERIALS.filter((m) => m !== "wood-pine" && m !== "wood-glulam").sort()).toEqual(
      Object.keys(HARDWOOD_WOOD_CLASS).sort(),
    );
    for (const m of ["wood-oak", "wood-beech", "wood-ash"]) {
      expect(HARDWOOD_WOOD_CLASS[m]).toBe("D30");
      // Massif (wood-cut, wood-housed…) comme lamellé-collé (wood-central) : même classe.
      expect(resolveWoodClass(s, m)).toBe("D30");
      expect(resolveWoodClass(s, m, {})).toBe("D30");
    }
    expect(resolveWoodClass(s, "wood-glulam")).toBe("GL24h");
    expect(resolveWoodClass(s, "wood-pine")).toBe("C24");
    expect(resolveWoodClass(s, "wood-unknown")).toBe("C24");
    // Classe saisie : prime sur l'essence.
    expect(resolveWoodClass(settings({ woodClass: "GL28h" }), "wood-oak")).toBe("GL28h");
    expect(resolveWoodClass(settings({ woodClass: "D40" }), "wood-pine")).toBe("D40");
    // Classe FCBA imposée par le plugin (`wood-central.strengthClass` saisie) : prime pour un
    // feuillu, sans effet sur un résineux, le lamellé-collé ni une classe saisie.
    expect(resolveWoodClass(s, "wood-oak", { strengthClass: "C30" })).toBe("C30");
    expect(resolveWoodClass(s, "wood-beech", { strengthClass: "D40" })).toBe("D40");
    expect(resolveWoodClass(s, "wood-pine", { strengthClass: "C30" })).toBe("C24");
    expect(resolveWoodClass(s, "wood-glulam", { strengthClass: "D40" })).toBe("GL24h");
    expect(
      resolveWoodClass(settings({ woodClass: "C24" }), "wood-oak", { strengthClass: "D40" }),
    ).toBe("C24");
    // γ_M du bois massif pour D30, propriétés de la table.
    const oak = woodMaterialOf(s, 700, "wood-oak");
    expect(oak.label).toBe("D30");
    expect(oak.e).toBe(11_000);
    expect(oak.strength).toBe(30);
    expect(oak.design).toBeCloseTo((s.kmod * 30) / s.gammaMWood, 12);
    expect(oak.density).toBe(700);
    expect(PRECHECK_PROVENANCE.woodClass.note.key).toBe("precheck.provenance.woodClassAuto");
  });

  it("propriété : la classe `auto` ne dépend que de l'essence ; la classe imposée ne vaut que pour un feuillu", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WOOD_CLASS_SETTINGS),
        fc.constantFrom(undefined, ...WOOD_MATERIALS, "wood-unknown"),
        fc.constantFrom(undefined, ...WOOD_CLASSES),
        (woodClass, material, strengthClass) => {
          const s = settings({ woodClass });
          const plain = resolveWoodClass(s, material);
          const imposed = resolveWoodClass(
            s,
            material,
            strengthClass !== undefined ? { strengthClass } : undefined,
          );
          const hardwood = material !== undefined && HARDWOOD_WOOD_CLASS[material] !== undefined;
          if (woodClass !== "auto") {
            expect(plain).toBe(woodClass);
            expect(imposed).toBe(woodClass);
          } else {
            expect(plain).toBe(material === "wood-glulam" ? "GL24h" : hardwood ? "D30" : "C24");
            expect(imposed).toBe(hardwood && strengthClass !== undefined ? strengthClass : plain);
          }
        },
      ),
    );
  });

  it("classe saisie conservée, quelle que soit l'essence", () => {
    for (const cls of WOOD_CLASSES) {
      for (const material of [undefined, "wood-glulam", "wood-oak", "wood-pine"]) {
        expect(resolveWoodClass(settings({ woodClass: cls }), material)).toBe(cls);
      }
    }
    expect(WOOD_CLASS_SETTINGS).toEqual([...WOOD_CLASSES, "auto"]);
  });

  it("classes massives de l'EN 338:2016 (C §1.11 [84][89], recoupées par [90]) : valeur par valeur", () => {
    expect(WOOD_CLASSES).toEqual(["C24", "C30", "D30", "D40", "GL24h", "GL28h", "GL32h"]);
    // [e, f_m,k, ρ_k, ρ_mean, f_v,k]
    const en338: Record<string, readonly [number, number, number, number, number]> = {
      C24: [11_000, 24, 350, 420, 4.0],
      C30: [12_000, 30, 380, 460, 4.0],
      D30: [11_000, 30, 530, 640, 3.9],
      D40: [13_000, 40, 550, 660, 4.2],
    };
    for (const [cls, [e, fmk, rhoK, rhoMean, fvk]] of Object.entries(en338)) {
      const p = WOOD_CLASS_PROPERTIES[cls as WoodClass];
      expect(p.e, cls).toBe(e);
      expect(p.fmk, cls).toBe(fmk);
      expect(p.rhoK, cls).toBe(rhoK);
      expect(p.rhoMean, cls).toBe(rhoMean);
      expect(p.fvk, cls).toBe(fvk);
      expect(p.sourced.key).toBe(`precheck.woodClass.${cls}`);
    }
    // E_0,mean de D40 : 13 000 MPa confirmé (A36 (2)) ; classes GL sans valeurs informatives.
    for (const c of GLULAM_WOOD_CLASSES) {
      expect(WOOD_CLASS_PROPERTIES[c].rhoK).toBeUndefined();
      expect(WOOD_CLASS_PROPERTIES[c].fvk).toBeUndefined();
    }
  });

  it("ρ_k et f_v,k informatifs : le matériau de calcul garde la masse volumique du profil", () => {
    for (const cls of WOOD_CLASSES) {
      const m = woodMaterialOf(settings({ woodClass: cls }), 612);
      expect(m.density).toBe(612);
    }
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
    expect(oak.label).toBe("D30");
    expect(oak.design).toBeCloseTo((0.8 * 30) / 1.3, 12);
    const pine = woodMaterialOf(s, 500, "wood-pine");
    expect(pine.label).toBe("C24");
    expect(pine.design).toBeCloseTo((0.8 * 24) / 1.3, 12);
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
