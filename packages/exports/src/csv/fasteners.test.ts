import { fastenerKindLabel, msg, type Fastener, type Model } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { translatorOf } from "../i18n.js";
import { residualFrench } from "../testing/french.js";
import { sampleParts } from "../testing/fixtures.js";
import { CSV_BOM } from "./cutlist.js";
import {
  exportFastenersCsv,
  fastenerScheduleRows,
  fastenersCsvHeader,
  hasFasteners,
} from "./fasteners.js";

/** Élément de visserie de test (désignation : nature, assemblage : libellé du cœur). */
function fastener(o: Partial<Fastener> & Pick<Fastener, "id" | "mark">): Fastener {
  const kind = o.kind ?? "bolt";
  return {
    kind,
    grade: "8.8",
    diameter: 12,
    length: 100,
    quantity: 4,
    joint: "plateFloor",
    name: fastenerKindLabel(kind),
    origin: msg("fastener.joint.plateFloor"),
    partIds: ["stringer-inner-1"],
    deduced: ["diameter", "quantity"],
    ...o,
  };
}

/** Visserie de test : deux éléments VS1 (deux assemblages), un VS2 sur deux marches. */
function fixtureFasteners(): Fastener[] {
  return [
    fastener({ id: "f1", mark: "VS1" }),
    fastener({
      id: "f2",
      mark: "VS1",
      quantity: 2,
      joint: "plateTrimmer",
      partIds: ["stringer-inner-1", "tread-2"],
    }),
    fastener({
      id: "f3",
      mark: "VS2",
      kind: "wood-screw",
      grade: "zinc-plated",
      diameter: 6,
      length: 30.5,
      quantity: 8,
      joint: "treadScrewed",
      partIds: ["tread-2", "tread-3"],
      deduced: [],
    }),
  ];
}

const model = (fasteners?: readonly Fastener[]): Pick<Model, "parts" | "fasteners"> => ({
  parts: sampleParts(),
  ...(fasteners === undefined ? {} : { fasteners }),
});

/** Lecture CSV minimale (séparateur donné, guillemets doublés). */
function parseCsv(text: string, sep: string): string[][] {
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
    else if (c === sep) {
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

describe("liste de visserie (lignes)", () => {
  it("une ligne par repère, quantités additionnées, repères de pièces distincts", () => {
    const rows = fastenerScheduleRows(model(fixtureFasteners()));
    expect(rows.map((r) => [r.mark, r.quantity])).toEqual([
      ["VS1", 6],
      ["VS2", 8],
    ]);
    expect(rows[0]!.joints).toEqual(["Platine sur sol", "Platine sur chevêtre"]);
    expect(rows[0]!.partMarks).toEqual(["LI1", "M2"]);
    // Deux pièces de même repère (M2) : un seul repère.
    expect(rows[1]!.partMarks).toEqual(["M2"]);
    expect(rows[1]!.partIds).toEqual(["tread-2", "tread-3"]);
    expect(rows[1]!.grade).toBe("acier zingué");
  });

  it("sans visserie : aucune ligne", () => {
    expect(hasFasteners(model())).toBe(false);
    expect(hasFasteners(model([]))).toBe(false);
    expect(hasFasteners(model(fixtureFasteners()))).toBe(true);
    expect(fastenerScheduleRows(model())).toEqual([]);
  });
});

describe("exportFastenersCsv", () => {
  it("français : BOM, « ; », virgule décimale, total des quantités", () => {
    const csv = exportFastenersCsv(model(fixtureFasteners()));
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const rows = parseCsv(csv.slice(1), ";");
    expect(rows[0]).toEqual([...fastenersCsvHeader()]);
    expect(rows[0]![0]).toBe("Repère");
    expect(rows.every((r) => r.length === 9)).toBe(true);
    expect(rows[1]).toEqual([
      "VS1",
      "Boulon",
      "Boulon",
      "12",
      "100",
      "classe 8.8",
      "6",
      "Platine sur sol ; Platine sur chevêtre",
      "LI1 ; M2",
    ]);
    expect(rows[2]![4]).toBe("30,5");
    const total = rows[rows.length - 1]!;
    expect(total[0]).toBe("Total");
    expect(total[6]).toBe("14");
  });

  it("anglais : « , », point décimal, aucun texte français", () => {
    const csv = exportFastenersCsv(model(fixtureFasteners()), { locale: "en" });
    const rows = parseCsv(csv.slice(1), ",");
    expect(rows[0]).toEqual([...fastenersCsvHeader(translatorOf({ locale: "en" }))]);
    expect(rows[1]![1]).toBe("Bolt");
    expect(rows[2]![4]).toBe("30.5");
    expect(rows[1]![7]).toBe("Plate to floor; Plate to trimmer");
    expect(residualFrench(csv.slice(1).split(/\r?\n/))).toEqual([]);
  });

  it("sans visserie : en-tête seul, sans total", () => {
    const csv = exportFastenersCsv(model());
    expect(parseCsv(csv.slice(1), ";")).toEqual([[...fastenersCsvHeader()]]);
    expect(exportFastenersCsv(model([]), { bom: false })).toBe(
      `${fastenersCsvHeader().join(";")}\r\n`,
    );
  });

  it("champs neutralisés (repère commençant par « = »), totaux facultatifs", () => {
    const csv = exportFastenersCsv(model([fastener({ id: "x", mark: "=VS1" })]), {
      totals: false,
      bom: false,
    });
    const rows = parseCsv(csv, ";");
    expect(rows).toHaveLength(2);
    expect(rows[1]![0]).toBe("'=VS1");
  });
});
