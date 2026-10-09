import { textMessage } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  sampleParts,
  sheetStringerPart,
  treadPart,
  woodStringerPart,
} from "../testing/fixtures.js";
import {
  CSV_BOM,
  csvField,
  csvTextField,
  cutListRows,
  exportCutListCsv,
  massDensityNote,
  massNoteFor,
  neutralizeFormula,
  partMassKg,
} from "./cutlist.js";

/** Lecture CSV minimale (« ; », guillemets doublés) pour les tests. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  return rows;
}

describe("exportCutListCsv", () => {
  it("instantané de la liste de débit", () => {
    expect(exportCutListCsv({ parts: sampleParts() })).toMatchSnapshot();
  });

  it("BOM UTF-8, « ; », virgule décimale, regroupement par repère", () => {
    const csv = exportCutListCsv({ parts: sampleParts() });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows[0]![0]).toBe("Repère");
    expect(rows.every((r) => r.length === 13)).toBe(true);
    // Limon d'abord (catégorie), puis marches en ordre naturel : M1, M2 (×2), M10.
    expect(rows.slice(1, -1).map((r) => r[0])).toEqual(["LI1", "M1", "M2", "M10"]);
    const m2 = rows.find((r) => r[0] === "M2")!;
    expect(m2[7]).toBe("2");
    expect(m2[4]).toBe("950,0");
    expect(m2[8]).toBe("0,010080");
    expect(m2[11]).toBe("14,12");
    const li1 = rows.find((r) => r[0] === "LI1")!;
    expect(li1[1]).toBe('Limon intérieur "jour"; tôle');
    expect(li1[2]).toBe("Acier peint");
    expect(li1[8]).toBe(""); // ni volume ni débit : rien d'inventé
    const total = rows[rows.length - 1]!;
    expect(total[0]).toBe("Total");
    expect(total[7]).toBe("5");
    expect(total[9]).toBe("incomplet");
    expect(total[11]).toBe("46,64");
  });

  it("même repère, débit différent : jamais fusionné en silence", () => {
    const a = treadPart(4);
    const b: typeof a = {
      ...treadPart(4),
      id: "tread-4b",
      stock: { length: 1200, width: 300, thickness: 45 },
    };
    const c: typeof a = { ...treadPart(4), id: "tread-4c", material: "wood-ash" };
    const rows = cutListRows([a, b, c, { ...a, id: "tread-4d" }]);
    expect(rows.map((r) => [r.mark, r.quantity, r.length, r.material])).toEqual([
      ["M4", 2, 950, "Chêne"],
      ["M4", 1, 1200, "Chêne"],
      ["M4", 1, 950, "Frêne"],
    ]);
  });

  it("pièce en lamellé-collé (`stock.count`) : une ligne de débit par lame, totaux de la pièce", () => {
    const beam = {
      ...treadPart(1, "LC1"),
      id: "wood-central-beam",
      category: "carriage" as const,
      stock: { length: 4140, width: 320, thickness: 54, count: 2 },
      quantities: { volume: 0.1, mass_kg: 70 },
    };
    const rows = cutListRows([beam]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mark: "LC1",
      length: 4140,
      width: 320,
      thickness: 54,
      quantity: 2,
      unitVolume: 0.05,
      unitMass: 35,
    });
    const csv = parseCsv(exportCutListCsv({ parts: [beam] }).slice(1));
    const total = csv[csv.length - 1]!;
    expect(total[7]).toBe("2");
    expect(total[9]).toBe("0,100000");
    expect(total[11]).toBe("70,00");
  });

  it("petite pièce : volume non nul affiché (cornière 80,3 × 304 mm² ≈ 2,4e-5 m³)", () => {
    const angle = {
      ...treadPart(1, "CR1"),
      id: "cr1",
      stock: undefined,
      quantities: { volume: 80.3 * 304e-9 },
    };
    const rows = parseCsv(exportCutListCsv({ parts: [angle] }).slice(1));
    expect(rows[1]![8]).toBe("0,000024");
    expect(rows[1]![9]).toBe("0,000024");
    // Même en deçà du pas affiché, une pièce non vide ne s'affiche pas nulle.
    const tiny = { ...angle, quantities: { volume: 1e-8 } };
    expect(parseCsv(exportCutListCsv({ parts: [tiny] }).slice(1))[1]![8]).toBe("0,000001");
  });

  it("propriété : le total de colonne est la somme des lignes affichées", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            volume: fc.double({ min: 1e-9, max: 0.5, noNaN: true }),
            mass: fc.double({ min: 1e-4, max: 500, noNaN: true }),
            normalized: fc.boolean(),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (specs) => {
          // Masse sous la clé normalisée `mass_kg` ou sous la clé historique `mass`.
          const parts = specs.map((q, i) => ({
            ...treadPart(i + 1),
            id: `p${i}`,
            quantities: { volume: q.volume, [q.normalized ? "mass_kg" : "mass"]: q.mass },
          }));
          const rows = parseCsv(exportCutListCsv({ parts }).slice(1));
          const num = (s: string): number => Number(s.replace(",", "."));
          const body = rows.slice(1, -1);
          const total = rows[rows.length - 1]!;
          for (const r of body) {
            expect(num(r[8]!)).toBeGreaterThan(0);
            expect(num(r[9]!)).toBeGreaterThan(0);
          }
          const sv = body.reduce((a, r) => a + Math.round(num(r[9]!) * 1e6), 0);
          const sm = body.reduce((a, r) => a + Math.round(num(r[11]!) * 1e2), 0);
          expect(Math.round(num(total[9]!) * 1e6)).toBe(sv);
          expect(Math.round(num(total[11]!) * 1e2)).toBe(sm);
        },
      ),
    );
  });

  it("options et cas vide", () => {
    const csv = exportCutListCsv({ parts: [] }, { bom: false, totals: false });
    expect(csv).toBe(
      "Repère;Désignation;Matériau;Section;Longueur (mm);Largeur (mm);Épaisseur (mm);Quantité;Volume unitaire (m³);Volume total (m³);Masse unitaire (kg);Masse totale (kg);Remarque masse\r\n",
    );
    expect(csvField(" a")).toBe('" a"');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });

  it("propriété : quantités conservées, une ligne par repère", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 30 }), { maxLength: 40 }), (nums) => {
        const parts = nums.map((n, i) => ({ ...treadPart(n), id: `p${i}` }));
        const rows = cutListRows(parts);
        expect(rows.reduce((a, r) => a + r.quantity, 0)).toBe(parts.length);
        expect(rows).toHaveLength(new Set(nums).size);
        const parsed = parseCsv(exportCutListCsv({ parts }).slice(1));
        expect(parsed).toHaveLength(rows.length + 2);
      }),
    );
  });

  it("anti-formule : champs texte commençant par =, +, -, @ neutralisés", () => {
    expect(neutralizeFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeFormula("+33")).toBe("'+33");
    expect(neutralizeFormula("-2")).toBe("'-2");
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("\t=1")).toBe("'\t=1");
    expect(neutralizeFormula("M1")).toBe("M1");
    expect(csvTextField('=HYPERLINK("x";"y")')).toBe(`"'=HYPERLINK(""x"";""y"")"`);
    const evil = {
      ...treadPart(1, "=cmd|' /C calc'!A0"),
      name: textMessage("+Marche"),
      section: textMessage("@x"),
    };
    const rows = parseCsv(exportCutListCsv({ parts: [evil] }).slice(1));
    const r = rows[1]!;
    expect(r[0]).toBe("'=cmd|' /C calc'!A0");
    expect(r[1]).toBe("'+Marche");
    expect(r[3]).toBe("'@x");
    // Colonnes numériques intactes.
    expect(r[4]).toBe("950,0");
  });

  it("propriété : aucun champ du CSV ne commence par un caractère de formule", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ mark: fc.string(), name: fc.string(), section: fc.string() }), {
          maxLength: 10,
        }),
        (specs) => {
          const parts = specs.map((s, i) => ({
            ...treadPart(1, s.mark),
            mark: s.mark,
            name: textMessage(s.name),
            section: textMessage(s.section),
            id: `p${i}`,
          }));
          const rows = parseCsv(exportCutListCsv({ parts }).slice(1));
          for (const row of rows) for (const f of row) expect(f).not.toMatch(/^[=+\-@\t\r]/);
        },
      ),
    );
  });

  describe("masses (QUESTIONS A6)", () => {
    const oak = { ...treadPart(1), quantities: { volume: 0.01, mass_kg: 7.5 } };
    const steel = { ...sheetStringerPart(), quantities: { mass_kg: 18.4 } };

    it("clé normalisée `mass_kg` lue d'abord, clé historique `mass` à défaut", () => {
      expect(partMassKg({ quantities: { mass_kg: 3, mass: 4 } })).toBe(3);
      expect(partMassKg({ quantities: { mass: 4 } })).toBe(4);
      expect(partMassKg({ quantities: {} })).toBeUndefined();
      expect(partMassKg({ quantities: { mass_kg: Number.NaN } })).toBeUndefined();
    });

    it("bois : mention « masse volumique à valider » ; acier : aucune", () => {
      const rows = parseCsv(exportCutListCsv({ parts: [oak, steel] }).slice(1));
      const m1 = rows.find((r) => r[0] === "M1")!;
      const li1 = rows.find((r) => r[0] === "LI1")!;
      expect(m1[11]).toBe("7,50");
      expect(m1[12]).toBe(massDensityNote());
      expect(li1[11]).toBe("18,40");
      expect(li1[12]).toBe("");
      const total = rows[rows.length - 1]!;
      expect(total[11]).toBe("25,90");
      expect(total[12]).toBe(massDensityNote());
    });

    it("sans masse : pas de remarque ; total incomplet", () => {
      const bare = { ...treadPart(2), quantities: { volume: 0.01 } };
      const rows = parseCsv(exportCutListCsv({ parts: [bare] }).slice(1));
      expect(rows[1]![12]).toBe("");
      expect(rows[2]![11]).toBe("incomplet");
    });

    it("profil d'atelier du projet : essence renseignée par l'atelier sans mention", () => {
      const note = massNoteFor({ wood: { densities: { "wood-oak": 690 } } });
      expect(note("wood-oak")).toBeUndefined();
      expect(note("wood-pine")).toBe(massDensityNote());
      expect(note("steel-raw")).toBeUndefined();
      expect(massNoteFor(undefined)("wood-oak")).toBe(massDensityNote());
      const rows = cutListRows([oak], { massNote: note });
      expect(rows[0]!.massNote).toBeUndefined();
    });

    it("remarque paramétrable (option `massNote`)", () => {
      const csv = exportCutListCsv(
        { parts: [oak, steel] },
        { massNote: (m) => (m.startsWith("steel") ? "=acier estimé" : undefined) },
      );
      const rows = parseCsv(csv.slice(1));
      expect(rows.find((r) => r[0] === "LI1")![12]).toBe("'=acier estimé");
      expect(rows.find((r) => r[0] === "M1")![12]).toBe("");
    });

    it("propriété : une masse de bois porte toujours la mention, un autre matériau jamais", () => {
      const materials = [
        "wood-oak",
        "wood-pine",
        "steel-raw",
        "stainless-brushed",
        "glass",
      ] as const;
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              material: fc.constantFrom(...materials),
              mass: fc.option(fc.double({ min: 1e-3, max: 300, noNaN: true }), { nil: undefined }),
            }),
            { maxLength: 20 },
          ),
          (specs) => {
            const parts = specs.map((s, i) => ({
              ...treadPart(i + 1),
              id: `p${i}`,
              material: s.material,
              quantities: (s.mass === undefined ? {} : { mass_kg: s.mass }) as Record<
                string,
                number
              >,
            }));
            for (const r of cutListRows(parts)) {
              const wood = parts.find((p) => p.mark === r.mark)!.material.startsWith("wood-");
              expect(r.massNote).toBe(
                r.unitMass !== undefined && wood ? massDensityNote() : undefined,
              );
            }
          },
        ),
      );
    });
  });
});

describe("pièces composées et placages (QUESTIONS A33 (e), A34 (e))", () => {
  /** Poutre finie (sans débit propre) et ses deux couches composantes. */
  function layered() {
    const beam = { ...woodStringerPart(), id: "beam", mark: "LC1" };
    const { stock: _stock, ...finished } = beam;
    const layer = (k: number, volume: number, mass: number) => ({
      ...beam,
      id: `beam-layer-${k}`,
      mark: `LC1-${k}`,
      name: textMessage(`Couche ${k}`),
      componentOf: "beam",
      stock: { length: 3000, width: 300, thickness: 40 },
      quantities: { volume, mass_kg: mass },
    });
    return [finished, layer(1, 0.03, 21), layer(2, 0.02, 14)];
  }

  it("la pièce finie n'est pas listée, ses couches le sont ; totaux = somme des couches", () => {
    for (const locale of ["fr", "en"] as const) {
      const rows = cutListRows(layered(), { locale });
      expect(rows.map((r) => r.mark)).toEqual(["LC1-1", "LC1-2"]);
    }
    const csv = parseCsv(exportCutListCsv({ parts: layered() }).slice(1));
    const total = csv[csv.length - 1]!;
    expect(total[7]).toBe("2");
    expect(total[9]).toBe("0,050000");
    expect(total[11]).toBe("35,00");
    // Sans composante dans le lot, une pièce porteuse de `componentOf` reste listée.
    const [, alone] = layered();
    expect(cutListRows([alone!]).map((r) => r.mark)).toEqual(["LC1-1"]);
  });

  it("débit en placage : désignation « (placage) », champ `supply`, pas de nouvelle colonne", () => {
    const ply = {
      ...treadPart(3),
      id: "ply",
      mark: "PL1",
      name: textMessage("Pli"),
      stock: { length: 1200, width: 120, thickness: 3, supply: "veneer" as const },
    };
    const fr = cutListRows([ply])[0]!;
    expect(fr.name).toBe("Pli (placage)");
    expect(fr.supply).toBe("placage");
    expect(fr.thickness).toBe(3);
    const en = cutListRows([ply], { locale: "en" })[0]!;
    expect(en.name).toBe("Pli (veneer)");
    expect(en.supply).toBe("veneer");
    // Même repère et même débit, l'un en placage : jamais fusionnés.
    const { supply: _s, ...plain } = ply.stock;
    expect(cutListRows([ply, { ...ply, id: "ply-b", stock: plain }])).toHaveLength(2);
    // Débit ordinaire : ni mention ni champ.
    expect(cutListRows([treadPart(3)])[0]!.supply).toBeUndefined();
    const csv = parseCsv(exportCutListCsv({ parts: [ply] }).slice(1));
    expect(csv.every((r) => r.length === 13)).toBe(true);
    expect(csv[1]![1]).toBe("Pli (placage)");
  });

  it("propriété : retirer les pièces finies conserve les quantités des composantes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.boolean(), (n, withAlone) => {
        const beam = { ...woodStringerPart(), id: "beam", mark: "LC1" };
        const layers = Array.from({ length: n }, (_, i) => ({
          ...beam,
          id: `l${i}`,
          mark: `LC1-${i + 1}`,
          componentOf: "beam",
        }));
        const parts = [beam, ...layers, ...(withAlone ? [treadPart(1)] : [])];
        const rows = cutListRows(parts);
        const qty = rows.reduce((s, r) => s + r.quantity, 0);
        expect(rows.some((r) => r.mark === "LC1")).toBe(false);
        expect(qty).toBe(n + (withAlone ? 1 : 0));
      }),
      { numRuns: 30 },
    );
  });
});
