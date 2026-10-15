/**
 * Invariant des repères sur les sorties de fabrication (chantier part-marks R2b et R2c,
 * décisions F10 Q3, Q5, Q6 et Q7, convention C3), sur tous les exemples et le préréglage
 * `helical` : un repère = une ligne de la liste de débit = une ligne de la fiche de débit = un
 * seul fichier DXF de développé (texte de référence commun, sans pièce porteuse) = une seule
 * désignation (`partDesignation`) ; partition des développés du dossier PDF identique à celle
 * des DXF ; chaque ligne de la liste porte exactement les pièces débitées de son repère
 * (`cutListGroups`, appartenance lue par la nomenclature de l'interface, C2, R2d). Étendu aux
 * garde-corps (chantier guard-marks G2c, CG6, CG7) : propriété à remplissage, hauteur d'étage,
 * T et murs tirés (main courante murale et sa visserie), un repère = une seule famille, une
 * ligne de visserie par repère de visserie.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModel,
  computeLayout,
  createProject,
  parseProjectText,
  type Model,
  type Project,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cutListGroups, cutListRows, cutParts } from "./csv/cutlist.js";
import { fastenerScheduleRows } from "./csv/fasteners.js";
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

/** Un repère n'est porté que par une seule famille (structure, garde-corps…, CG7, G-Q6). */
function expectOneFamilyPerMark(model: Pick<Model, "parts">): void {
  const families = new Map<string, Set<string>>();
  for (const p of model.parts) {
    families.set(p.mark, (families.get(p.mark) ?? new Set()).add(p.family ?? ""));
  }
  expect(
    [...families].filter(([, f]) => f.size > 1).map(([m, f]) => `${m} : ${[...f].join(" / ")}`),
    "repères portés par plusieurs familles",
  ).toEqual([]);
}

/**
 * Visserie : une ligne de la liste par repère de visserie, quantités conservées, chaque pièce
 * assemblée existe et a un repère. Rend le nombre d'éléments de supports de main courante murale.
 */
function expectFastenerLines(model: Model): number {
  const rows = fastenerScheduleRows(model);
  const marks = rows.map((r) => r.mark);
  expect(marks.length, "lignes de visserie").toBe(new Set(marks).size);
  const fasteners = model.fasteners ?? [];
  expect(rows.reduce((a, r) => a + r.quantity, 0)).toBe(
    fasteners.reduce((a, f) => a + f.quantity, 0),
  );
  const ids = new Set(model.parts.map((p) => p.id));
  for (const f of fasteners) for (const id of f.partIds) expect(ids.has(id), f.id).toBe(true);
  for (const r of rows) expect(r.partMarks.length, r.mark).toBeGreaterThan(0);
  return fasteners.filter((f) => f.joint === "handrailWall" || f.joint === "handrailPartition")
    .length;
}

type Json = Record<string, any>;

/** Murs en couronne (48 segments) à 120 mm de l'emprise, sur `arc` tour (tracé hélicoïdal). */
function ringWalls(d: Json, arc: number): void {
  const fp = computeLayout(parseProjectText(JSON.stringify(d))).footprint;
  const xs = fp.map((q) => q.x);
  const ys = fp.map((q) => q.y);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const R = Math.max(...fp.map((q) => Math.hypot(q.x - cx, q.y - cy)));
  const n = 48;
  const r = (R + 120) / Math.cos(Math.PI / n);
  d["site"].walls = Array.from({ length: Math.round(n * arc) }, (_, i) => {
    const a0 = (2 * Math.PI * i) / n;
    const a1 = (2 * Math.PI * (i + 1)) / n;
    return {
      id: `w${i}`,
      a: { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
      b: { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
      thickness: 200,
      loadBearing: i % 2 === 0,
    };
  });
}

/** Murs en cadre autour de l'emprise, à 120 mm (côtés choisis par `mask`, 4 bits). */
function boxWalls(d: Json, mask: number): void {
  const fp = computeLayout(parseProjectText(JSON.stringify(d))).footprint;
  const xs = fp.map((q) => q.x);
  const ys = fp.map((q) => q.y);
  const [x0, x1, y0, y1] = [
    Math.min(...xs) - 120,
    Math.max(...xs) + 120,
    Math.min(...ys) - 120,
    Math.max(...ys) + 120,
  ];
  const sides = [
    [x0, y0, x1, y0],
    [x1, y0, x1, y1],
    [x1, y1, x0, y1],
    [x0, y1, x0, y0],
  ] as const;
  d["site"].walls = sides
    .map((side, i) => [side, i] as const)
    .filter(([, i]) => (mask >> i) & 1)
    .map(([[ax, ay, bx, by], i]) => ({
      id: `b${i}`,
      a: { x: ax - (bx - ax) * 0.1, y: ay - (by - ay) * 0.1 },
      b: { x: bx + (bx - ax) * 0.1, y: by + (by - ay) * 0.1 },
      thickness: 200,
      loadBearing: i % 2 === 0,
    }));
}

describe("propriété : repères de garde-corps, un repère = une ligne de débit = une ligne de fiche = une désignation = une famille (CG6, CG7)", () => {
  /** Projets à garde-corps : exemples qui en ont, `j5a-helicoidal` équipé, préréglage helical. */
  const guarded: readonly (readonly [string, () => Json])[] = [
    ...readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith(SUFFIX))
      .sort()
      .map((f) => [f, JSON.parse(readFileSync(join(EXAMPLES_DIR, f), "utf8")) as Json] as const)
      .filter(([, d]) => d["guards"] !== undefined)
      .map(([f, d]) => [f, (): Json => structuredClone(d)] as const),
    [
      "j5a-helicoidal + garde-corps",
      (): Json => ({
        ...(JSON.parse(
          readFileSync(join(EXAMPLES_DIR, `j5a-helicoidal${SUFFIX}`), "utf8"),
        ) as Json),
        guards: {},
      }),
    ],
    [
      "préréglage helical + garde-corps",
      (): Json => ({ ...structuredClone(createProject("helical")), guards: {} }),
    ],
  ];

  it("remplissage, hauteur ± 90 mm, T et murs tirés", () => {
    let shared = 0;
    let wallHandrails = 0;
    let wallBrackets = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...guarded),
        fc.constantFrom(null, "rails", "cables", "glass", "balusters"),
        fc.integer({ min: -90, max: 90 }),
        fc.constantFrom(0, 0.3, 0.5, 1, 2),
        fc.constantFrom(0, 0.5, 1),
        fc.integer({ min: 1, max: 15 }),
        fc.constantFrom("auto", "both", "outer", "inner", "none"),
        ([, make], infill, dh, t, arc, mask, wallSides) => {
          const d = make();
          if (infill) d["guards"].infill = { kind: infill };
          d["site"].floorToFloor += dh;
          d["workshop"] = { ...(d["workshop"] ?? {}), identicalPartTolerance: t };
          if (arc > 0) {
            if (d["stair"].layout.kind === "helical") ringWalls(d, arc);
            else boxWalls(d, mask);
            d["guards"].handrail = { ...(d["guards"].handrail ?? {}), wallSides };
          }
          const model = buildModel(parseProjectText(JSON.stringify(d)), { memo: false });
          if (expectOneOutputPerMark(model) > 0) shared++;
          expectOneFamilyPerMark(model);
          wallBrackets += expectFastenerLines(model);
          if (model.parts.some((p) => p.id.startsWith("handrail-wall-"))) wallHandrails++;
        },
      ),
      { numRuns: 40, seed: 31 },
    );
    expect(guarded.length).toBeGreaterThan(5);
    expect(shared).toBeGreaterThan(0);
    expect(wallHandrails).toBeGreaterThan(0);
    expect(wallBrackets).toBeGreaterThan(0);
  }, 300_000);

  it("j5a-helicoidal à garde-corps dans des murs : MC1 seulement sur la main courante de la structure", () => {
    for (const wallSides of ["auto", "both", "outer"]) {
      const d: Json = {
        ...(JSON.parse(
          readFileSync(join(EXAMPLES_DIR, `j5a-helicoidal${SUFFIX}`), "utf8"),
        ) as Json),
        guards: { handrail: { wallSides } },
      };
      ringWalls(d, 1);
      const model = buildModel(parseProjectText(JSON.stringify(d)), { memo: false });
      expect(model.errors).toEqual([]);
      expectOneOutputPerMark(model);
      expectOneFamilyPerMark(model);
      expectFastenerLines(model);
      expect(
        model.parts.filter((p) => p.mark === "MC1").map((p) => p.id),
        wallSides,
      ).toEqual(["helical-handrail"]);
      expect(model.parts.some((p) => p.id.startsWith("handrail-wall-outer"))).toBe(false);
    }
  }, 60_000);
});
