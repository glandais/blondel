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
import { cutSheet } from "./cutsheet.js";
import { exportPartDxf } from "./dxf/part.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { exportProjectJson } from "./json.js";
import { exportGlb } from "./gltf/glb.js";
import { COMPLIANCE_DISCLAIMER, exportPdfDocument } from "./pdf/document.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderFlatPatternSvg } from "./svg/flat.js";
import { renderPlanSvg } from "./svg/plan.js";
import { entitiesOn, readDxf } from "./testing/dxf-reader.js";
import { readGlb } from "./testing/glb-reader.js";
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

      it("DXF de tous les développés et planches SVG", () => {
        const files = exportPartsDxf(model);
        const flats = model.parts.filter((p) => p.flat !== undefined);
        expect(files.reduce((s, f) => s + f.quantity, 0)).toBe(flats.length);
        for (const f of files) expect(readDxf(f.content).entities.length).toBeGreaterThan(0);
        for (const part of flats) parseXml(renderFlatPatternSvg(part));
        // Limons bois (plugin J3a) : chaque segment de mortaise sur le calque MORTAISE, le
        // repère sur TEXTE. Sans plugin (aucun développé), la boucle est vide.
        for (const part of flats) {
          const f = readDxf(exportPartDxf(part, { version: "AC1021" }));
          const mortises = part.flat!.lines.filter((l) => l.feature === "mortise").length;
          expect(entitiesOn(f, "LINE", "MORTAISE"), part.id).toHaveLength(mortises);
          expect(entitiesOn(f, "TEXT", "TEXTE").map((t) => t.value)).toContain(part.mark);
        }
      });

      it("dossier PDF : pages prévues, avertissement du contrôle de conception", () => {
        const { bytes, pages } = exportPdfDocument(model, {
          project,
          date: "29/09/2026",
          compress: false,
        });
        expect(pages[0]!.kind).toBe("toc");
        const kinds = pages.map((p) => p.kind);
        expect(kinds.filter((k) => k !== "toc").slice(0, 2)).toEqual(["plan", "elevation"]);
        for (const k of ["installation", "bom", "cutsheet", "compliance"] as const) {
          expect(kinds, k).toContain(k);
        }
        // Un gabarit 1:1 au moins par développé distinct.
        const flatIds = new Set(
          pages.filter((p) => p.kind === "flat").map((p) => p.partIds!.join()),
        );
        const tplIds = new Set(
          pages.filter((p) => p.kind === "template").map((p) => p.partIds!.join()),
        );
        expect(tplIds).toEqual(flatIds);
        const text = new TextDecoder("latin1").decode(bytes);
        expect(text.startsWith("%PDF-")).toBe(true);
        expect(text.match(/\/Type \/Page\b/g)).toHaveLength(pages.length);
        expect(text).toContain(`(${COMPLIANCE_DISCLAIMER}) Tj`);
        expect(text).not.toMatch(NON_FINITE);
      });

      it("modèle 3D glTF binaire relu : un nœud par pièce, métadonnées", () => {
        const r = readGlb(exportGlb(model, { project }));
        const root = r.doc.nodes[r.doc.scenes[0]!.nodes[0]!]!;
        expect(root.name).toBe(project.name);
        expect(root.children).toHaveLength(model.parts.length);
        root.children!.forEach((ni, k) => {
          const node = r.doc.nodes[ni]!;
          expect(node.name).toBe(model.parts[k]!.mark);
          expect(node.extras?.["id"]).toBe(model.parts[k]!.id);
          expect(node.mesh, node.name).toBeDefined();
        });
      });

      it("fiche de débit : profilés, tubes et ronds acier groupés par section", () => {
        for (const g of cutSheet(model.parts)) {
          if (g.material.startsWith("wood-") || g.basis === "section") continue;
          for (const r of g.rows) expect(r.section).not.toMatch(/^(UPN|IPE|HEA|L |tube|rond)/);
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
