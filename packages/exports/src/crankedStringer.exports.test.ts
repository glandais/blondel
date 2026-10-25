/**
 * Limon coudé des profilés (`stringerLine` = `nosing`, chantier bent-stringer, sous-lot K2b) :
 * j3c traverse tous les exports sans exception ni grandeur non finie (SVG, DXF R12 / AC1021,
 * CSV, glTF, ZIP, PDF), et les textes anglais propres au limon coudé (remarques, coupes de
 * jarret) ne gardent ni clé brute ni français. Développé unique par face en K2b (tronçons en
 * K2c) : l'âme est plane, son développé est exact.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, type Project } from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { exportCutListCsv } from "./csv/cutlist.js";
import { exportPartDxf } from "./dxf/part.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { exportGlb } from "./gltf/glb.js";
import { exportPdfDocument } from "./pdf/document.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderFlatPatternSvg } from "./svg/flat.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readDxf } from "./testing/dxf-reader.js";
import { residualFrench } from "./testing/french.js";
import { readGlb } from "./testing/glb-reader.js";
import { parseXml } from "./testing/xml.js";
import { createZip } from "./zip.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const NON_FINITE = /NaN|Infinity/;

function j3cNosing(): Project {
  const p = parseProjectText(
    readFileSync(join(EXAMPLES_DIR, "j3c-acceptance-01-upn.blondel.json"), "utf8"),
  );
  return {
    ...p,
    stair: {
      ...p.stair,
      structure: {
        ...p.stair.structure,
        params: { ...p.stair.structure.params, stringerLine: "nosing" },
      },
    },
  };
}

describe("limon coudé (K2b) — exports de j3c en `nosing`", () => {
  const project = j3cNosing();
  const model = buildModel(project);
  const stringers = model.parts.filter((p) => p.category === "stringer");

  it("modèle complet, limons balayés, coupes de jarret sur les développés", () => {
    expect(model.errors).toEqual([]);
    expect(stringers.length).toBe(4);
    for (const s of stringers) {
      expect(s.solid.kind).toBe("sweep");
      expect(s.flat).toBeDefined();
    }
    const knees = stringers.flatMap((s) =>
      s.flat!.lines.filter((l) => l.label?.key === "structure.steelProfile.joint.knee"),
    );
    expect(knees).toHaveLength(9);
  });

  it("SVG, DXF (plan et pièces, R12 et AC1021), CSV, glTF, ZIP et PDF sans exception", () => {
    for (const locale of ["fr", "en"] as const) {
      const opts = { project, theme: "light" as const, title: project.name, locale };
      for (const svg of [renderPlanSvg(model, opts), renderElevationSvg(model, opts)]) {
        parseXml(svg);
        expect(svg).not.toMatch(NON_FINITE);
      }
      for (const s of stringers) {
        const svg = renderFlatPatternSvg(s, { locale });
        parseXml(svg);
        expect(svg).not.toMatch(NON_FINITE);
      }
      expect(exportCutListCsv(model, { locale })).not.toMatch(NON_FINITE);
    }
    for (const version of ["R12", "AC1021"] as const) {
      const plan = exportPlanDxf(model, { project, version });
      expect(plan).not.toMatch(NON_FINITE);
      for (const s of stringers) {
        const dxf = exportPartDxf(s, { version });
        expect(dxf, s.id).not.toMatch(NON_FINITE);
        expect(readDxf(dxf).entities.length, s.id).toBeGreaterThan(0);
      }
    }
    const files = exportPartsDxf(model);
    const zip = createZip(files.map((f) => ({ name: f.filename, data: f.content })));
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe("PK");
    const glb = readGlb(exportGlb(model, { project }));
    const root = glb.doc.nodes[glb.doc.scenes[0]!.nodes[0]!]!;
    for (const ni of root.children!) expect(glb.doc.nodes[ni]!.mesh).toBeDefined();
    for (const locale of ["fr", "en"] as const) {
      const { bytes } = exportPdfDocument(model, {
        project,
        date: "25/10/2026",
        compress: false,
        locale,
      });
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text.startsWith("%PDF-")).toBe(true);
      expect(text).not.toMatch(NON_FINITE);
    }
  });

  it("anglais : remarques et coupes de jarret sans clé brute ni français", () => {
    const en = createTranslator("en");
    const texts = [
      ...(model.notes ?? []).filter((n) => String(n.key).includes("cranked")).map((n) => en.t(n)),
      ...stringers.flatMap((s) =>
        s.flat!.lines.filter((l) => l.kind === "joint" && l.label).map((l) => en.t(l.label!)),
      ),
    ];
    expect(texts.length).toBeGreaterThan(9);
    for (const t of texts) expect(t).not.toMatch(/structure\.|\{/);
    expect(residualFrench(texts)).toEqual([]);
  });
});
