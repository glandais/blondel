/**
 * Invariant des repères sur les sorties de fabrication (chantier part-marks R2b et R2c,
 * décisions F10 Q3, Q5, Q6 et Q7, convention C3), sur tous les exemples et le préréglage
 * `helical` : un repère = une ligne de la liste de débit = une ligne de la fiche de débit = un
 * seul fichier DXF de développé (texte de référence commun, sans pièce porteuse) = une seule
 * désignation (`partDesignation`) ; partition des développés du dossier PDF identique à celle
 * des DXF ; chaque ligne de la liste porte exactement les pièces débitées de son repère
 * (`cutListGroups`, appartenance lue par la nomenclature de l'interface, C2, R2d).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, createProject, parseProjectText, type Project } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cutListGroups, cutListRows, cutParts } from "./csv/cutlist.js";
import { cutSheet } from "./cutsheet.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { flatPartGroups } from "./flatGroups.js";
import { partDesignation, translatorOf } from "./i18n.js";
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

/**
 * Invariant C3 complet sur un modèle : une ligne de liste et de fiche de débit par repère (mêmes
 * repères), un seul fichier DXF de développé par repère (et la partition `flatPartGroups` est
 * celle des fichiers), une seule désignation traduite par repère sur les pièces du débit.
 * Rend le nombre de repères portés par deux pièces ou plus.
 */
function expectOneOutputPerMark(model: ReturnType<typeof buildModel>): number {
  const rows = cutListRows(model.parts).map((r) => r.mark);
  expect(rows.length, "liste de débit").toBe(new Set(rows).size);
  // Appartenance (C2, R2d) : chaque ligne porte toutes les pièces débitées de son repère et
  // seulement elles ; la nomenclature de l'interface la lit telle quelle.
  const groups = cutListGroups(model.parts);
  expect(groups.map((g) => g.row)).toEqual(cutListRows(model.parts));
  const debited = cutParts(model.parts);
  for (const g of groups) {
    expect([...g.partIds].sort(), `pièces de ${g.row.mark}`).toEqual(
      debited
        .filter((p) => p.mark === g.row.mark)
        .map((p) => p.id)
        .sort(),
    );
  }
  expect(groups.flatMap((g) => g.partIds).length).toBe(debited.length);
  const sheet = cutSheet(model.parts).flatMap((g) => g.rows.map((r) => r.mark));
  expect(sheet.length, "fiche de débit").toBe(new Set(sheet).size);
  expect([...sheet].sort()).toEqual([...rows].sort());

  const files = exportPartsDxf(model);
  const fileMarks = files.map((f) => f.mark);
  expect(
    fileMarks.filter((m, i) => fileMarks.indexOf(m) !== i),
    "repères en plusieurs DXF",
  ).toEqual([]);
  expect(canonical(flatPartGroups(model.parts).map((g) => g.ids))).toEqual(
    canonical(files.map((f) => f.partIds)),
  );

  const t = translatorOf();
  const names = new Map<string, Set<string>>();
  for (const p of cutParts(model.parts)) {
    names.set(p.mark, (names.get(p.mark) ?? new Set()).add(t.t(partDesignation(p))));
  }
  expect(
    [...names].filter(([, s]) => s.size > 1).map(([m, s]) => `${m} : ${[...s].join(" / ")}`),
    "repères à plusieurs désignations",
  ).toEqual([]);
  const counts = new Map<string, number>();
  for (const p of model.parts) counts.set(p.mark, (counts.get(p.mark) ?? 0) + 1);
  return [...counts.values()].filter((n) => n > 1).length;
}

const canonical = (groups: readonly (readonly string[])[]): string[] =>
  groups.map((g) => [...g].sort().join(",")).sort();

describe("un repère = une ligne de débit = une ligne de fiche = un DXF = une désignation (F10 Q3, Q5, Q6, Q7, C3)", () => {
  it.each(PROJECTS)(
    "%s",
    (_name, make) => {
      const model = buildModel(make(), { memo: false });
      expectOneOutputPerMark(model);
      const files = exportPartsDxf(model);

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

describe("propriété : un repère = une ligne de débit = une ligne de fiche = un DXF = une désignation (C3)", () => {
  // Projets acier des exemples (tous les plugins acier), hauteur d'étage et tolérance
  // d'identité T tirées : ni la clé de regroupement de la liste et de la fiche de débit, ni la
  // partition des développés, ni la désignation ne doivent séparer deux pièces d'un même repère.
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
          if (expectOneOutputPerMark(model) > 0) shared++;
        },
      ),
      { numRuns: 40, seed: 29 },
    );
    expect(steel.length).toBeGreaterThan(5);
    expect(shared).toBeGreaterThan(0);
  }, 300_000);
});
