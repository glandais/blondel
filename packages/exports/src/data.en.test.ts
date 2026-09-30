/**
 * Exports de données en anglais (ADR-0007) sur des exemples réels : liste de débit CSV (séparateur
 * « , », point décimal), fiche de débit, fiche de pose, glTF et familles de gabarits. Vérifie
 * qu'aucun texte français ni aucune clé brute ne reste, et que `locale: "fr"` explicite rend
 * exactement la sortie par défaut.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText } from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  cutListHeader,
  massDensityNote,
  csvField,
  cutListRows,
  exportCutListCsv,
  massNoteFor,
} from "./csv/cutlist.js";
import { cutSheet } from "./cutsheet.js";
import { buildGltf, exportGlb } from "./gltf/glb.js";
import { translatorOf } from "./i18n.js";
import { installationSheet } from "./installation.js";
import { residualFrench } from "./testing/french.js";
import { TEMPLATE_FAMILIES, templateFamilyLabel } from "./templateFamily.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const EXAMPLES = [
  "demo-u-oak.blondel.json",
  "j4-demi-tournant-acier-garde-corps.blondel.json",
  "j3c-acceptance-01-upn.blondel.json",
  "demo-helical-glass.blondel.json",
];

const en = translatorOf({ locale: "en" });

function expectEnglish(text: string): void {
  expect(residualFrench(text.split(/\r?\n/))).toEqual([]);
}

function load(file: string) {
  const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
  return { project, model: buildModel(project) };
}

describe("exports de données en anglais", () => {
  it("en-têtes, remarque de masse et familles : français par défaut, anglais sur demande", () => {
    expect(cutListHeader()).toEqual(cutListHeader(translatorOf({ locale: "fr" })));
    expect(cutListHeader()[0]).toBe("Repère");
    expect(massDensityNote()).toBe("masse volumique à valider");
    expect(massDensityNote(en)).toBe("density to be validated");
    for (const f of TEMPLATE_FAMILIES) {
      expect(templateFamilyLabel(f)).toBe(templateFamilyLabel(f, translatorOf({ locale: "fr" })));
      expectEnglish(templateFamilyLabel(f, en));
    }
    expectEnglish(cutListHeader(en).join(" "));
    expect(massNoteFor(undefined)("wood-oak", en)).toBe("density to be validated");
    expect(massNoteFor(undefined)("wood-oak")).toBe(massDensityNote());
  });

  it("csvField cite le séparateur de la langue", () => {
    expect(csvField("a,b", ",")).toBe('"a,b"');
    expect(csvField("a;b", ",")).toBe("a;b");
    expect(csvField("a;b")).toBe('"a;b"');
    expect(csvField("a,b")).toBe("a,b");
  });

  for (const file of EXAMPLES) {
    describe(file, () => {
      const { project, model } = load(file);

      it("CSV : « , », point décimal, sans texte français ; « fr » explicite = défaut", () => {
        const massNote = massNoteFor(project.workshop);
        const fr = exportCutListCsv(model, { massNote });
        expect(exportCutListCsv(model, { massNote, locale: "fr" })).toBe(fr);
        const csv = exportCutListCsv(model, { massNote, locale: "en" });
        expect(csv.startsWith(CSV_BOM)).toBe(true);
        const lines = csv.slice(1).split("\r\n");
        expect(lines[0]).toBe(cutListHeader(en).join(","));
        expect(lines.at(-1)).toBe("");
        const total = lines.at(-2)!;
        expect(total.startsWith("Total,")).toBe(true);
        // Point décimal ; la virgule ne sert que de séparateur (colonnes comptées plus bas).
        expect(csv).toMatch(/\d\.\d/);
        expect(csv).not.toContain(";");
        // Même nombre de colonnes que l'en-tête sur chaque ligne sans guillemets.
        for (const l of lines.slice(0, -1)) {
          if (!l.includes('"')) expect(l.split(",")).toHaveLength(cutListHeader().length);
        }
        expectEnglish(csv);
        // L'heuristique détecte bien le français.
        expect(() => expectEnglish(fr)).toThrow();
      });

      it("lignes de débit et fiche de débit sans texte français", () => {
        const massNote = massNoteFor(project.workshop);
        for (const r of cutListRows(model.parts, { massNote, locale: "en" })) {
          expectEnglish([r.name, r.material, r.section, r.massNote ?? ""].join(" | "));
        }
        for (const g of cutSheet(model.parts, { massNote, locale: "en" })) {
          expectEnglish([g.materialLabel, g.section ?? "", ...g.totals.massNotes].join(" | "));
          for (const r of g.rows) expectEnglish([r.name, r.section, r.massNote ?? ""].join(" | "));
        }
      });

      it("fiche de pose : libellés des points et diagonales en anglais", () => {
        const s = installationSheet(model, project, { locale: "en" });
        const frSheet = installationSheet(model, project);
        expect(s.points.map((p) => p.id)).toEqual(frSheet.points.map((p) => p.id));
        expect(s.points.length).toBeGreaterThan(0);
        for (const p of s.points) expectEnglish(p.label);
        for (const d of s.diagonals) expectEnglish(`${d.from} ${d.to}`);
        expect(installationSheet(model, project, { locale: "fr" })).toEqual(frSheet);
      });

      it("glTF : scène et extras en anglais, noms de nœuds = repères", () => {
        const { doc } = buildGltf(model, { locale: "en" });
        expect(doc.scenes[0]!.name).toBe("Staircase");
        const nodeNames = doc.nodes.slice(1).map((n) => n.name);
        expect(nodeNames).toEqual(
          buildGltf(model)
            .doc.nodes.slice(1)
            .map((n) => n.name),
        );
        expectEnglish(JSON.stringify(doc.scenes[0]!.extras));
        for (const n of doc.nodes.slice(1)) {
          const x = (n.extras ?? {}) as Record<string, unknown>;
          expectEnglish(
            [x["name"], x["section"], x["meshError"]].filter((v) => v !== undefined).join(" | "),
          );
        }
        expect(exportGlb(model, { locale: "fr" })).toEqual(exportGlb(model));
      });
    });
  }

  it("instantané anglais de la liste de débit (demo-u-oak)", () => {
    const { project, model } = load("demo-u-oak.blondel.json");
    expect(
      exportCutListCsv(model, { massNote: massNoteFor(project.workshop), locale: "en" }),
    ).toMatchSnapshot();
  });
});
