/**
 * Invariant des repères sur les sorties de fabrication (chantier part-marks R2b, décisions F10
 * Q3 et Q7, convention C3), sur tous les exemples et le préréglage `helical` : un repère = une
 * ligne de la liste de débit = une ligne de la fiche de débit ; les fichiers DXF d'un repère ne
 * diffèrent que par le texte de référence du développé (qui nomme encore la pièce porteuse :
 * l'invariant « un repère = un DXF » est posé au sous-lot R2c, décision Q5) ; partition des
 * développés du dossier PDF identique à celle des DXF.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModel,
  createProject,
  parseProjectText,
  type Part,
  type Project,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cutListRows } from "./csv/cutlist.js";
import { cutSheet } from "./cutsheet.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { flatPartGroups } from "./flatGroups.js";
import { RecordingCanvas } from "./pdf/canvas.js";
import { renderPdf, type PdfPages } from "./pdf/document.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const SUFFIX = ".blondel.json";

const PROJECTS: readonly (readonly [string, () => Project])[] = [
  ...readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(SUFFIX))
    .sort()
    .map(
      (f) =>
        [
          f.slice(0, -SUFFIX.length),
          () => parseProjectText(readFileSync(join(EXAMPLES_DIR, f), "utf8")),
        ] as const,
    ),
  ["préréglage helical", () => createProject("helical")],
];

const FLATS_ONLY: PdfPages = {
  toc: false,
  plan: false,
  elevation: false,
  installation: false,
  bom: false,
  fasteners: false,
  cutsheet: false,
  compliance: false,
  flats: true,
  templates: false,
};

/** Pièce sans le texte de référence de son développé. */
const withoutReference = (p: Part): Part => {
  if (!p.flat?.reference) return p;
  const { reference: _reference, ...flat } = p.flat;
  return { ...p, flat };
};

const canonical = (groups: readonly (readonly string[])[]): string[] =>
  groups.map((g) => [...g].sort().join(",")).sort();

describe("un repère = une ligne de débit = une ligne de fiche (F10 Q3, Q7, C3)", () => {
  it.each(PROJECTS)(
    "%s",
    (_name, make) => {
      const model = buildModel(make(), { memo: false });
      const marks = (xs: readonly { mark: string }[]) => xs.map((x) => x.mark);

      const rows = marks(cutListRows(model.parts));
      expect(rows.length, "liste de débit").toBe(new Set(rows).size);

      const sheet = marks(cutSheet(model.parts).flatMap((g) => g.rows));
      expect(sheet.length, "fiche de débit").toBe(new Set(sheet).size);
      expect([...sheet].sort()).toEqual([...rows].sort());

      // DXF : fichiers d'un même repère et matériau distincts seulement par le texte de référence.
      const files = exportPartsDxf(model);
      const stripped = flatPartGroups(model.parts.map(withoutReference));
      const keys = stripped.map((g) => `${g.part.mark}|${g.part.material}`);
      expect(keys.length, "développés hors texte de référence").toBe(new Set(keys).size);
      expect(new Set(files.map((f) => f.mark))).toEqual(new Set(stripped.map((g) => g.part.mark)));

      // PDF : partition des développés dessinés identique à celle des DXF.
      const pages = renderPdf(new RecordingCanvas(), model, { pages: FLATS_ONLY });
      const pdfGroups = pages.filter((p) => p.kind === "flat").map((p) => p.partIds ?? []);
      const drawable = files.filter((f) => {
        const part = model.parts.find((p) => p.id === f.partIds[0])!;
        return part.flat!.outline.outer.length >= 3;
      });
      expect([...new Set(canonical(pdfGroups))]).toEqual(canonical(drawable.map((f) => f.partIds)));
    },
    60_000,
  );
});

describe("propriété : un repère = une ligne de débit = une ligne de fiche (C3)", () => {
  // Projets acier des exemples (tous les plugins acier), hauteur d'étage et tolérance
  // d'identité T tirées : la clé de regroupement de la liste et de la fiche de débit ne doit
  // jamais séparer deux pièces d'un même repère.
  const steel = PROJECTS.filter(([, make]) => make().stair.structure.kind.startsWith("steel-"));

  it("exemples acier, hauteur ± 90 mm, T ∈ [0, 2]", () => {
    let shared = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...steel),
        fc.integer({ min: -90, max: 90 }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        ([, make], dh, t) => {
          const base = make();
          const project: Project = {
            ...base,
            site: { ...base.site, floorToFloor: base.site.floorToFloor + dh },
            workshop: { ...base.workshop, identicalPartTolerance: t },
          };
          const model = buildModel(project, { memo: false });
          const rows = cutListRows(model.parts).map((r) => r.mark);
          expect(rows.length, "liste de débit").toBe(new Set(rows).size);
          const sheet = cutSheet(model.parts).flatMap((g) => g.rows.map((r) => r.mark));
          expect(sheet.length, "fiche de débit").toBe(new Set(sheet).size);
          expect([...sheet].sort()).toEqual([...rows].sort());
          const counts = new Map<string, number>();
          for (const p of model.parts) counts.set(p.mark, (counts.get(p.mark) ?? 0) + 1);
          if ([...counts.values()].some((n) => n > 1)) shared++;
        },
      ),
      { numRuns: 40, seed: 29 },
    );
    expect(steel.length).toBeGreaterThan(5);
    expect(shared).toBeGreaterThan(0);
  }, 300_000);
});
