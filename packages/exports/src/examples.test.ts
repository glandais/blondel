/**
 * Bout en bout sur les exemples `examples/*.blondel.json` : projet lu → `buildModel` (pipeline
 * réel du cœur) → tous les exports. Vérifie que chaque fichier est lisible (XML bien formé, DXF
 * relu) et sans grandeur non finie, et que le projet JSON exporté se relit à l'identique.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, clearModelCache, parseProjectText } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { CSV_BOM, CUT_LIST_HEADER, exportCutListCsv } from "./csv/cutlist.js";
import { exportPartDxf } from "./dxf/part.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { exportProjectJson } from "./json.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readDxf } from "./testing/dxf-reader.js";
import { parseXml } from "./testing/xml.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const files = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".blondel.json"))
  .sort();

const NON_FINITE = /NaN|Infinity/;

describe("exports de bout en bout sur examples/", () => {
  it("les exemples existent", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of files) {
    describe(file, () => {
      const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
      const model = buildModel(project);

      it("modèle complet, sans erreur de génération", () => {
        expect(model.errors).toEqual([]);
        expect(model.stepping.treads.length).toBeGreaterThan(0);
        expect(model.parts.length).toBeGreaterThan(0);
      });

      it("plan et élévation SVG bien formés, une cible data-tread par marche", () => {
        for (const theme of ["light", "dark"] as const) {
          const plan = renderPlanSvg(model, { project, theme, title: project.name });
          const elev = renderElevationSvg(model, { project, theme, title: project.name });
          parseXml(plan);
          parseXml(elev);
          expect(plan).not.toMatch(NON_FINITE);
          expect(elev).not.toMatch(NON_FINITE);
          for (const t of model.stepping.treads) {
            expect(plan).toContain(`data-tread="${t.number}"`);
            expect(elev).toContain(`data-tread="${t.number}"`);
          }
        }
      });

      it("plan DXF (AC1021 et R12) relu", () => {
        for (const version of ["AC1021", "R12"] as const) {
          const dxf = exportPlanDxf(model, { project, version });
          expect(dxf).not.toMatch(NON_FINITE);
          expect(readDxf(dxf).entities.length).toBeGreaterThan(0);
        }
      });

      it("DXF de chaque pièce à plat relu ; refus explicite sans développé", () => {
        const flats = model.parts.filter((p) => p.flat !== undefined);
        // Jalon 1-2 : les pièces de base (marches, contremarches) n'ont pas de développé à
        // plat ; les plugins de structure (J3) en fourniront. L'export refuse alors clairement.
        const noFlat = model.parts.find((p) => p.flat === undefined);
        if (noFlat) expect(() => exportPartDxf(noFlat)).toThrow(/développé à plat/);
        for (const part of flats) {
          const dxf = exportPartDxf(part);
          expect(dxf, part.id).not.toMatch(NON_FINITE);
          expect(readDxf(dxf).entities.length, part.id).toBeGreaterThan(0);
        }
      });

      it("liste de débit : en-tête, une ligne au moins, sans NaN", () => {
        const csv = exportCutListCsv(model);
        expect(csv.startsWith(CSV_BOM)).toBe(true);
        expect(csv).toContain(CUT_LIST_HEADER[0]);
        expect(csv).not.toMatch(NON_FINITE);
        expect(csv.trim().split(/\r?\n/).length).toBeGreaterThan(1);
      });

      it("projet JSON : relecture identique, même modèle", () => {
        const again = parseProjectText(exportProjectJson(project));
        expect(again).toEqual(project);
        clearModelCache();
        const rebuilt = buildModel(again);
        expect(rebuilt.stepping.nosings.map((n) => n.s)).toEqual(
          model.stepping.nosings.map((n) => n.s),
        );
      });
    });
  }
});
