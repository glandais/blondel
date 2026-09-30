import { textMessage } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Part } from "@blondel/core";
import { massDensityNote } from "./csv/cutlist.js";
import { cutSheet } from "./cutsheet.js";
import { sampleParts, sheetStringerPart, treadPart, woodStringerPart } from "./testing/fixtures.js";

describe("fiche de débit", () => {
  const parts = [...sampleParts(), woodStringerPart()];
  const groups = cutSheet(parts);

  it("groupes par matériau et épaisseur, lignes par repère", () => {
    expect(groups.map((g) => [g.materialLabel, g.thickness])).toEqual([
      ["Acier peint", 5],
      ["Chêne", 45],
    ]);
    const oak = groups[1]!;
    expect(oak.rows.map((r) => [r.mark, r.quantity])).toEqual([
      ["LI1", 1],
      ["M1", 1],
      ["M2", 2],
      ["M10", 1],
    ]);
    const m2 = oak.rows.find((r) => r.mark === "M2")!;
    expect(m2).toMatchObject({
      length: 950,
      width: 300,
      thickness: 45,
      source: "stock",
      unitMass: 7.06,
    });
  });

  it("pièce sans débit : dimensions du développé (flan), L ≥ l", () => {
    const steel = groups[0]!.rows[0]!;
    expect(steel).toMatchObject({
      mark: "LI1",
      source: "flat",
      length: 3250.5,
      width: 260,
      thickness: 5,
    });
  });

  it("totaux : longueur cumulée, volume brut, masse incomplète si une masse manque", () => {
    const oak = groups[1]!;
    const L = woodStringerPart().stock!.length;
    expect(oak.totals.quantity).toBe(5);
    expect(oak.totals.lengthM).toBeCloseTo((4 * 950 + L) / 1000, 9);
    expect(oak.totals.volumeM3).toBeCloseTo((4 * 950 * 300 * 45 + L * 350 * 45) / 1e9, 12);
    // Le limon bois n'a pas de masse : total incomplet, pas de somme fausse.
    expect(oak.totals.massKg).toBeUndefined();
    expect(groups[0]!.totals.massKg).toBeCloseTo(18.4, 9);
  });

  it("profilés et tubes : groupés par section, jamais mêlés aux tôles de même « épaisseur »", () => {
    // Tube Ø140 × 5 : débit L × Ø × paroi, sans développé ; la tôle LI1 a une épaisseur de 5 mm.
    const tube: Part = {
      ...treadPart(1),
      id: "column",
      mark: "F1",
      category: "post",
      name: textMessage("Fût"),
      material: "steel-painted",
      section: textMessage("tube Ø140 × 5"),
      stock: { length: 2700, width: 140, thickness: 5 },
      quantities: { mass: 44.6 },
    };
    // UPN 260 : débit L × h × b (b = 90), pas une épaisseur de 90 mm.
    const upn: Part = {
      ...tube,
      id: "upn",
      mark: "LE1",
      section: textMessage("UPN 260 (S235)"),
      stock: { length: 3000, width: 260, thickness: 90 },
    };
    const gs = cutSheet([sheetStringerPart(), tube, upn]);
    const plate = gs.find((g) => g.thickness === 5)!;
    expect(plate.basis).toBe("thickness");
    expect(plate.rows.map((r) => r.mark)).toEqual(["LI1"]);
    const tubeGroup = gs.find((g) => g.section === "tube Ø140 × 5")!;
    expect(tubeGroup).toMatchObject({ basis: "section" });
    expect(tubeGroup.thickness).toBeUndefined();
    expect(tubeGroup.rows.map((r) => r.mark)).toEqual(["F1"]);
    // Pas de volume « brut » L × Ø × paroi pour un tube.
    expect(tubeGroup.totals.volumeM3).toBeUndefined();
    expect(tubeGroup.totals.massKg).toBeCloseTo(44.6, 9);
    expect(gs.some((g) => g.thickness === 90)).toBe(false);
  });

  it("propriété : quantités conservées, chaque pièce dans un seul groupe", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 30 }),
        fc.boolean(),
        (ns, withSheet) => {
          const ps = [...ns.map((n) => treadPart(n)), ...(withSheet ? [sheetStringerPart()] : [])];
          const gs = cutSheet(ps);
          expect(gs.reduce((s, g) => s + g.totals.quantity, 0)).toBe(ps.length);
          const marks = gs.flatMap((g) => g.rows.map((r) => `${g.material}|${r.mark}`));
          expect(new Set(marks).size).toBe(marks.length);
          for (const g of gs) {
            if (g.totals.massKg !== undefined) {
              const expected = g.rows.reduce((s, r) => s + r.unitMass! * r.quantity, 0);
              expect(g.totals.massKg).toBeCloseTo(expected, 9);
            }
          }
        },
      ),
    );
  });

  it("masses `mass_kg` cumulées, remarque bois « masse volumique à valider » (QUESTIONS A6)", () => {
    const oak: Part = { ...treadPart(1), quantities: { mass_kg: 7.5 } };
    const oak2: Part = { ...treadPart(2), quantities: { mass_kg: 2.5 } };
    const steel: Part = { ...sheetStringerPart(), quantities: { mass_kg: 18.4 } };
    const gs = cutSheet([oak, oak2, steel]);
    const wood = gs.find((g) => g.material === "wood-oak")!;
    expect(wood.totals.massKg).toBeCloseTo(10, 9);
    expect(wood.totals.massNotes).toEqual([massDensityNote()]);
    expect(wood.rows.every((r) => r.massNote === massDensityNote())).toBe(true);
    const metal = gs.find((g) => g.material === "steel-painted")!;
    expect(metal.totals.massKg).toBeCloseTo(18.4, 9);
    expect(metal.totals.massNotes).toEqual([]);
    expect(metal.rows[0]!.massNote).toBeUndefined();
    // Remarque paramétrable.
    const none = cutSheet([oak], { massNote: () => undefined });
    expect(none[0]!.totals.massNotes).toEqual([]);
  });
});
