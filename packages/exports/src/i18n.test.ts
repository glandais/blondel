/**
 * Langue des exports (ADR-0007), test transversal : pour **chaque** exemple de `examples/` et
 * chaque format (plan et élévation SVG, développés SVG, plan DXF R12 et 2007, développés DXF,
 * liste de débit CSV, fiche de débit, fiche de pose, glTF, dossier PDF), la sortie anglaise ne
 * garde ni texte français, ni clé brute, ni paramètre non rempli, ni « [object Object] »
 * (heuristique partagée `testing/french.ts`). Le français par défaut est couvert octet par
 * octet par les instantanés et tests existants ; ici, `locale: "fr"` explicite = défaut.
 *
 * Textes repris tels quels, exclus du contrôle : nom du projet, identifiants des murs, sources
 * citées des règles (`rules.yaml`), identifiants de contextes et de profil du contrôle.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, type Model, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { cutListRows, exportCutListCsv, massNoteFor } from "./csv/cutlist.js";
import { cutSheet } from "./cutsheet.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { buildGltf } from "./gltf/glb.js";
import { installationSheet } from "./installation.js";
import { RecordingCanvas, helveticaMeasure } from "./pdf/canvas.js";
import { exportPdfDocument, renderPdf } from "./pdf/document.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderFlatPatternSvg } from "./svg/flat.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readDxf } from "./testing/dxf-reader.js";
import { residualFrench } from "./testing/french.js";
import { findAll, parseXml } from "./testing/xml.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const EXAMPLES = readdirSync(EXAMPLES_DIR)
  .filter((n) => n.endsWith(".blondel.json"))
  .sort();

/** Textes affichés d'un SVG : `<title>`, `<desc>` et contenus des `<text>` / `<tspan>`. */
function svgTexts(svg: string): string[] {
  const root = parseXml(svg);
  return ["title", "desc", "text", "tspan"].flatMap((tag) => findAll(root, tag).map((e) => e.text));
}

/** Textes (séquences `\U+XXXX` décodées) et noms de calques d'un DXF. */
function dxfTexts(content: string): string[] {
  const f = readDxf(content);
  const decode = (s: string): string =>
    s.replace(/\\U\+([0-9A-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return [
    ...f.entities.flatMap((e) => (e.type === "TEXT" ? [decode(e.value)] : [])),
    ...f.layers.keys(),
  ];
}

/** Chaînes d'une valeur JSON (valeurs seulement, clés d'objet exclues). */
function jsonStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(jsonStrings);
  if (v !== null && typeof v === "object") return Object.values(v).flatMap(jsonStrings);
  return [];
}

function verbatimOf(project: Project, model: Model): string[] {
  return [
    project.name,
    ...project.site.walls.map((w) => w.id),
    ...model.compliance.results.flatMap((r) => [r.source, r.ruleId]),
    ...model.compliance.contexts,
    model.compliance.profile,
  ];
}

describe("exports en anglais sur tous les exemples : aucun texte français restant", () => {
  it("les exemples sont bien lus et l'heuristique détecte le français", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(20);
    const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, EXAMPLES[0]!), "utf8"));
    const model = buildModel(project);
    const verbatim = verbatimOf(project, model);
    expect(residualFrench(svgTexts(renderPlanSvg(model, { project })), verbatim)).not.toEqual([]);
    expect(
      residualFrench(["Limon LE1", "Bord de jour", "pdf.toc.title", "{count} steps"]),
    ).toHaveLength(4);
    expect(residualFrench(["[object Object]", "NaN mm", "Wall string LE1, flight 2"])).toHaveLength(
      2,
    );
    // Textes repris (nom de projet tronqué, source renvoyée à la ligne) : ignorés.
    expect(
      residualFrench(
        ["Project: Escalier de la…", "de la construction"],
        ["Escalier de la cave", "Code de la construction"],
      ),
    ).toEqual([]);
  });

  for (const file of EXAMPLES) {
    describe(file, () => {
      const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
      const model = buildModel(project);
      const verbatim = verbatimOf(project, model);
      const en = { locale: "en" } as const;
      const check = (texts: readonly string[]): void => {
        expect(texts.length).toBeGreaterThan(0);
        expect(residualFrench(texts, verbatim)).toEqual([]);
      };
      const flats = model.parts.filter((p) => p.flat !== undefined);

      it("plan et élévation SVG", () => {
        check(svgTexts(renderPlanSvg(model, { ...en, project })));
        check(svgTexts(renderPlanSvg(model, { ...en, project, scale: 50, theme: "dark" })));
        check(svgTexts(renderElevationSvg(model, { ...en, project })));
      });

      it("développés SVG", () => {
        for (const part of flats) check(svgTexts(renderFlatPatternSvg(part, en)));
      });

      it("plan DXF R12 et 2007 (textes et calques)", () => {
        for (const version of ["R12", "AC1021"] as const) {
          check(dxfTexts(exportPlanDxf(model, { ...en, project, version })));
        }
      });

      it("développés DXF R12 et 2007 (textes et calques)", () => {
        for (const version of ["R12", "AC1021"] as const) {
          for (const f of exportPartsDxf(model, { ...en, version })) check(dxfTexts(f.content));
        }
      });

      it("liste de débit CSV et fiche de débit", () => {
        const massNote = massNoteFor(project.workshop);
        const csv = exportCutListCsv(model, { ...en, massNote });
        check(csv.split("\r\n"));
        expect(exportCutListCsv(model, { locale: "fr", massNote })).toBe(
          exportCutListCsv(model, { massNote }),
        );
        check(
          cutListRows(model.parts, { ...en, massNote }).flatMap((r) =>
            jsonStrings({ ...r, mark: undefined }),
          ),
        );
        check(
          cutSheet(model.parts, { ...en, massNote }).flatMap((g) => [
            g.materialLabel,
            ...(g.section !== undefined ? [g.section] : []),
            ...g.totals.massNotes,
            ...g.rows.flatMap((r) => [r.name, r.section, r.massNote ?? ""]),
          ]),
        );
      });

      it("fiche de pose", () => {
        const s = installationSheet(model, project, en);
        check([...s.points.map((p) => p.label), ...s.diagonals.flatMap((d) => [d.from, d.to])]);
        expect(installationSheet(model, project, { locale: "fr" })).toEqual(
          installationSheet(model, project),
        );
      });

      it("glTF : nom de scène et extras", () => {
        const { doc } = buildGltf(model, en);
        expect(doc.scenes[0]!.name).toBe("Staircase");
        check([
          doc.scenes[0]!.name ?? "",
          ...jsonStrings(doc.scenes[0]!.extras),
          ...doc.nodes.slice(1).flatMap((n) => {
            const {
              id: _id,
              mark: _mark,
              category: _c,
              material: _m,
              ...rest
            } = (n.extras ?? {}) as Record<string, unknown>;
            return jsonStrings(rest);
          }),
        ]);
      });

      it("dossier PDF : chaînes passées au canevas, titres de pages et métadonnées", () => {
        const c = new RecordingCanvas(297, 210, helveticaMeasure());
        const pages = renderPdf(c, model, { ...en, project, date: new Date(2026, 8, 30) });
        check(c.pageTexts().flat());
        check(pages.flatMap((p) => [p.title, ...(p.scaleNote !== undefined ? [p.scaleNote] : [])]));
        if (file === EXAMPLES[0]) {
          // Métadonnées jsPDF (non compressé : chaînes lisibles dans le fichier).
          const { bytes } = exportPdfDocument(model, { ...en, project, compress: false });
          const raw = new TextDecoder("latin1").decode(bytes);
          // Parenthèses échappées dans les chaînes PDF : « \( ».
          expect(raw).toMatch(/\/Subject \(Staircase drawing package \\\(Blondel\\\)\)/);
          expect(raw).not.toContain("[object Object]");
        }
      });
    });
  }
});
