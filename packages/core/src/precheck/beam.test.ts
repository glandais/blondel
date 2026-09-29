import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findSection } from "../catalog/sections.js";
import { analyzeInclinedBeam, passesPrecheck, type InclinedBeamInput } from "./beam.js";
import { stairLoads } from "./loads.js";
import { DEFAULT_PRECHECK_SETTINGS, steelMaterialOf } from "./settings.js";

const steel = { ...steelMaterialOf("S235", DEFAULT_PRECHECK_SETTINGS, 7850) };
const weightless = { ...steel, density: 0 };

function input(over: Partial<InclinedBeamInput>): InclinedBeamInput {
  return {
    spanH: 4000,
    slope: 0,
    section: { area: 0, i: 1e7, w: 1e5 },
    material: weightless,
    tributaryWidth: 1000,
    permanentArea: 0,
    loads: { qk: 0, Qk: 0, vibrationMass: 0, category: "A", source: "test" },
    settings: { gammaG: 1.35, gammaQ: 1.5, pointLoadShare: 1 },
    ...over,
  };
}

describe("prédimensionnement — poutre de référence calculée à la main", () => {
  it("UPN 160 sur 4,8 m, 1,6 kN/m : 5,69 mm (C §2.3, recalcul du vérificateur)", () => {
    const upn = findSection("UPN 160")!;
    const r = analyzeInclinedBeam(
      input({
        spanH: 4800,
        section: { area: upn.area, i: upn.iy, w: upn.wy },
        loads: { qk: 1.6, Qk: 0, vibrationMass: 0, category: "A", source: "C §2.3" },
      }),
    );
    // 5·q·L⁴ / (384·E·I) = 5 × 1,6 × 4 800⁴ / (384 × 210 000 × 9 250 000)
    expect(r.deflection).toBeCloseTo(5.69328, 4);
    // M_Ed = 1,5 × 1,6 × 4 800² / 8 = 6 912 000 N·mm ; σ = M / 116 000 = 59,59 MPa.
    expect(r.mEd).toBeCloseTo(6_912_000, 0);
    expect(r.stress).toBeCloseTo(59.586, 2);
    expect(r.spanRatio).toBeCloseTo(4800 / 5.69328, 0);
  });

  it("poutre inclinée 3/4 : composantes perpendiculaires (w_h·cos²α, P·cos α)", () => {
    // L_h = 4 000, cos α = 0,8 → L = 5 000.
    const r = analyzeInclinedBeam(
      input({
        slope: 0.75,
        loads: { qk: 1, Qk: 2, vibrationMass: 0, category: "A", source: "test" },
      }),
    );
    expect(r.length).toBeCloseTo(5000, 9);
    // 5 × (1 × 0,64) × 5 000⁴ / (384 × 210 000 × 1e7) = 2e15 / 8,064e14
    expect(r.deflectionQ).toBeCloseTo(2.48016, 4);
    // 2 000 × 0,8 × 5 000³ / (48 × 210 000 × 1e7) = 2e14 / 1,008e14
    expect(r.deflectionPoint).toBeCloseTo(1.98413, 4);
    expect(r.deflection).toBeCloseTo(2.48016, 4);
    // Moments en projection horizontale : q·L_h²/8 = 2e6, P·L_h/4 = 2e6.
    expect(r.mEd).toBeCloseTo(1.5 * 2e6, 3);
  });

  it("fréquence : Rayleigh proche de la solution exacte π/(2L²)·√(EI/m) sans masse ponctuelle", () => {
    const upn = findSection("UPN 160")!;
    const r = analyzeInclinedBeam(
      input({
        spanH: 4000,
        section: { area: upn.area, i: upn.iy, w: upn.wy },
        material: steel,
      }),
    );
    const m = (upn.area / 1e6) * 7850; // kg/m
    const exact = (Math.PI / (2 * 4 ** 2)) * Math.sqrt((210e9 * upn.iy * 1e-12) / m);
    expect(Math.abs(r.frequency - exact) / exact).toBeLessThan(0.01);
  });

  it("charges de l'AN (catégorie A : 2,5 kN/m², 2 kN) et de l'EN 16481 (3 kN/m²)", () => {
    const an = stairLoads(DEFAULT_PRECHECK_SETTINGS, ["tous", "logement_interieur"]);
    expect(an).toMatchObject({ qk: 2.5, Qk: 2, category: "A" });
    const erp = stairLoads(DEFAULT_PRECHECK_SETTINGS, ["tous", "erp_neuf"]);
    expect(erp).toMatchObject({ qk: 5, Qk: 5, category: "D1" });
    // Parties communes d'un BHC : catégorie A (contextes de CHARGE_ESCALIER_A).
    expect(stairLoads(DEFAULT_PRECHECK_SETTINGS, ["tous", "bhc_parties_communes"]).category).toBe(
      "A",
    );
    // Aucune destination d'habitation ni ERP : catégorie non spécifiée ⇒ D1 (A §3.6), pas A.
    for (const ctx of [[], ["tous", "exterieur"], ["tous", "industriel"], ["bois_dtu"]]) {
      expect(stairLoads(DEFAULT_PRECHECK_SETTINGS, ctx), ctx.join()).toMatchObject({
        qk: 5,
        Qk: 5,
        category: "D1",
      });
    }
    // Catégorie imposée : prime sur les contextes.
    expect(
      stairLoads({ ...DEFAULT_PRECHECK_SETTINGS, category: "C5" }, ["erp_neuf"]),
    ).toMatchObject({ qk: 5, Qk: 4.5, category: "C5" });
    const en = stairLoads({ ...DEFAULT_PRECHECK_SETTINGS, loadSet: "EN16481" }, []);
    expect(en).toMatchObject({ qk: 3, Qk: 2 });
  });

  it("propriété : flèche et contrainte croissantes, fréquence décroissante avec la portée", () => {
    const upn = findSection("UPN 180")!;
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 6000 }),
        fc.integer({ min: 1, max: 1500 }),
        fc.double({ min: 0, max: 1.2, noNaN: true }),
        (span, extra, slope) => {
          const base = input({
            slope,
            material: steel,
            section: { area: upn.area, i: upn.iy, w: upn.wy },
            permanentArea: 0.5,
            loads: { qk: 2.5, Qk: 2, vibrationMass: 1, category: "A", source: "AN" },
          });
          const a = analyzeInclinedBeam({ ...base, spanH: span });
          const b = analyzeInclinedBeam({ ...base, spanH: span + extra });
          return (
            b.deflection > a.deflection &&
            b.stress > a.stress &&
            b.frequency < a.frequency &&
            (!passesPrecheck(a) ? !passesPrecheck(b) : true)
          );
        },
      ),
    );
  });
});
