import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sampleParts, treadPart } from "../testing/fixtures.js";
import { CSV_BOM, csvField, cutListRows, exportCutListCsv } from "./cutlist.js";

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
    expect(rows.every((r) => r.length === 12)).toBe(true);
    // Limon d'abord (catégorie), puis marches en ordre naturel : M1, M2 (×2), M10.
    expect(rows.slice(1, -1).map((r) => r[0])).toEqual(["LI1", "M1", "M2", "M10"]);
    const m2 = rows.find((r) => r[0] === "M2")!;
    expect(m2[7]).toBe("2");
    expect(m2[4]).toBe("950,0");
    expect(m2[8]).toBe("0,0101");
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

  it("options et cas vide", () => {
    const csv = exportCutListCsv({ parts: [] }, { bom: false, totals: false });
    expect(csv).toBe(
      "Repère;Désignation;Matériau;Section;Longueur (mm);Largeur (mm);Épaisseur (mm);Quantité;Volume unitaire (m³);Volume total (m³);Masse unitaire (kg);Masse totale (kg)\r\n",
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
});
