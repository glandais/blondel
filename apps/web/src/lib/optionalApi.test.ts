import type { PdfPages } from "@blondel/exports/pdf";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  availableStructures,
  loadExportPdf,
  pick,
  resolveOptionalApi,
  type PdfJobOptions,
} from "./optionalApi.js";

describe("API facultatives", () => {
  it("ne retient que les fonctions exportées", () => {
    const f = () => [];
    expect(resolveOptionalApi({ listStructures: f, other: 1 }).listStructures).toBe(f);
    expect(resolveOptionalApi({ listStructures: "non" })).toEqual({});
    expect(pick({ a: 1 }, "a")).toBeUndefined();
  });

  it("listStructures absent ou qui lève : liste vide", () => {
    expect(availableStructures({})).toEqual([]);
    expect(
      availableStructures({
        listStructures: () => {
          throw new Error("x");
        },
      }),
    ).toEqual([]);
  });

  it("cœur réel : plugins bois du jalon 3a proposés", () => {
    const kinds = availableStructures().map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(["wood-housed", "wood-cut"]));
  });

  it("exportPdf chargé à la demande depuis @blondel/exports/pdf", async () => {
    const exportPdf = await loadExportPdf();
    expect(typeof exportPdf).toBe("function");
  });

  it("pages du dossier PDF : type de @blondel/exports/pdf (pas de liste recopiée)", () => {
    expectTypeOf<keyof NonNullable<PdfJobOptions["pages"]>>().toEqualTypeOf<keyof PdfPages>();
  });
});
