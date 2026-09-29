import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_K_FACTOR,
  DEFAULT_METAL_PROFILE,
  METAL_PROVENANCE,
  bendAllowance,
  din6935Correction,
  findBendLaw,
  minBendRadiusFactor,
  minProfileBendRadius,
  outsideSetback,
  resolveBend,
  type BendLaw,
} from "./metal.js";
import { WorkshopProfileSchema, resolveWorkshopProfile } from "./profile.js";

const law = (over: Partial<BendLaw> = {}): BendLaw => ({
  grade: "any",
  thickness: 5,
  innerRadius: 6.5,
  minFlange: 23,
  method: "kFactor",
  ...over,
});

describe("profil d'atelier — capacités métal", () => {
  it("défauts : presse 2 980 mm / 8 mm (C-M-04), barres 6 / 12 m, acier 7 850 kg/m³, provenance déclarée", () => {
    const p = resolveWorkshopProfile();
    expect(p.metal).toBe(DEFAULT_METAL_PROFILE);
    expect(p.metal.pressBrake).toEqual({ maxLength: 2980, maxThickness: 8 });
    expect(p.metal.barLengths).toEqual([6000, 12000]);
    expect(p.metal.density).toBe(7850);
    expect(p.metal.defaultK).toBe(DEFAULT_K_FACTOR);
    for (const k of Object.keys(DEFAULT_METAL_PROFILE)) {
      expect(METAL_PROVENANCE[k as keyof typeof METAL_PROVENANCE]).toBeDefined();
    }
    expect(METAL_PROVENANCE.defaultK.status).toBe("a-valider");
    // Table [17] : 5 mm → r 6,5 / L_int 23.
    expect(findBendLaw(p.metal, "S235", 5)).toMatchObject({ innerRadius: 6.5, minFlange: 23 });
    expect(findBendLaw(p.metal, "S235", 7)).toBeNull();
  });

  it("profil partiel du projet : champs métal surchargés, le reste par défaut ; loi propre à une nuance prioritaire", () => {
    const input = WorkshopProfileSchema.parse({
      metal: {
        pressBrake: { maxLength: 2000 },
        bendLaws: [
          { thickness: 5, innerRadius: 5, minFlange: 20 },
          { grade: "S355", thickness: 5, innerRadius: 8, minFlange: 25, method: "din6935" },
        ],
      },
    });
    const p = resolveWorkshopProfile(input);
    expect(p.metal.pressBrake).toEqual({ maxLength: 2000, maxThickness: 8 });
    expect(p.metal.sheetFormats).toBe(DEFAULT_METAL_PROFILE.sheetFormats);
    expect(findBendLaw(p.metal, "S235", 5)!.innerRadius).toBe(5);
    expect(findBendLaw(p.metal, "S355", 5)!.innerRadius).toBe(8);
    expect(p.wood).toEqual(resolveWorkshopProfile().wood);
  });

  it("DIN 6935 (norme étrangère) : k = 0,65 + 0,5·log10(r/t) si r/t < 5, sinon 1 ; K équivalent = k/2", () => {
    expect(din6935Correction(6.5, 5)).toBeCloseTo(0.65 + 0.5 * Math.log10(1.3), 12);
    expect(din6935Correction(25, 5)).toBe(1);
    expect(din6935Correction(30, 5)).toBe(1);
    const b = resolveBend(law({ method: "din6935" }), 0.33);
    expect(b.k).toBeCloseTo((0.65 + 0.5 * Math.log10(1.3)) / 2, 12);
  });

  it("méthodes kFactor et table : K de la loi, sinon K par défaut ; table ⇔ déduction de pli à 90°", () => {
    expect(resolveBend(law(), 0.33).k).toBe(0.33);
    expect(resolveBend(law({ k: 0.42 }), 0.33).k).toBe(0.42);
    // Déduction à 90° d'une tôle t = 5, r = 6,5 de K = 0,4 : BD = 2(r + t) − (π/2)(r + K t).
    const bd = 2 * (6.5 + 5) - (Math.PI / 2) * (6.5 + 0.4 * 5);
    expect(resolveBend(law({ method: "table", deduction90: bd }), 0.33).k).toBeCloseTo(0.4, 12);
    expect(() => resolveBend(law({ method: "table" }), 0.33)).toThrow(/deduction90/);
    expect(() => resolveBend(law({ method: "table", deduction90: 0 }), 0.33)).toThrow(/hors de/);
  });

  it("propriété : table construite depuis K redonne K ; longueur de pli à 90° = développé − 2 ailes extérieures + 2 retraits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.double({ min: 0.2, max: 0.5, noNaN: true }),
        (t, ratio, k) => {
          const r = ratio * t;
          const ba = bendAllowance(Math.PI / 2, r, k, t);
          const ossb = outsideSetback(Math.PI / 2, r, t);
          expect(ossb).toBeCloseTo(r + t, 9);
          const bd = 2 * ossb - ba;
          const back = resolveBend(
            law({ thickness: t, innerRadius: r, method: "table", deduction90: bd }),
            0.33,
          );
          expect(back.k).toBeCloseTo(k, 9);
        },
      ),
    );
  });

  it("rayon mini C-M-02 : 1 × t en S235, 1,5 × t en S355", () => {
    expect(minBendRadiusFactor("S235")).toBe(1);
    expect(minBendRadiusFactor("S355")).toBe(1.5);
  });
});

describe("capacités de cintrage des profilés (C-M-06 / C-M-07) et barème", () => {
  it("rayons minimaux par famille et par sens, section hors capacité, famille inconnue", () => {
    const m = resolveWorkshopProfile().metal;
    expect(minProfileBendRadius(m, "UPN", "flangeIn", 160)).toMatchObject({ radius: 650 });
    expect(minProfileBendRadius(m, "UPN", "flangeOut", 260)).toMatchObject({ radius: 500 });
    expect(minProfileBendRadius(m, "UPN", "edge", 160)).toMatchObject({ radius: 200 });
    expect(minProfileBendRadius(m, "UPN", "edge", 200)).toEqual({ outOfRange: 160 });
    expect(minProfileBendRadius(m, "IPE", "flat", 200)).toMatchObject({ radius: 650 });
    expect(minProfileBendRadius(m, "IPN", "edge", 180)).toMatchObject({ radius: 1400 });
    expect(minProfileBendRadius(m, "HEA", "flat", 200)).toBeNull();
    expect(m.sawKerf).toBe(3);
    expect(METAL_PROVENANCE.sawKerf.status).toBe("a-valider");
  });

  it("barème de coût : aucun défaut, surcharge par le projet", () => {
    expect(resolveWorkshopProfile().costs).toEqual({});
    const p = resolveWorkshopProfile(WorkshopProfileSchema.parse({ costs: { hourlyRate: 55 } }));
    expect(p.costs).toEqual({ hourlyRate: 55 });
  });
});
