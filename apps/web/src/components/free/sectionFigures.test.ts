/**
 * Bande de chiffres clés du panneau libre (spécification de contenu § 2) : chiffres du cœur
 * (`Model.figures`), unité à droite du chiffre, grille sans case vide.
 */
import { buildModel, createProject, type Model, type Project } from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGuards } from "../../lib/guardsForm.js";
import { bomSummary } from "../../lib/parts.js";
import { SECTION_IDS } from "../../lib/sectionIds.js";
import { formatFigureLength } from "../../lib/units.js";
import { appStore, modelService } from "../../store/appStore.js";
import {
  SectionFigures,
  columnsOf,
  figureSpans,
  sectionFigures,
  type SectionFigure,
} from "./SectionFigures.js";

const fr = createTranslator("fr");
const en = createTranslator("en");
/** Espaces fines et insécables du français ramenées à des espaces simples. */
const plain = (s: string): string => s.replace(/[  ]/g, " ");
/** Chiffre entier attendu (même arrondi que la bande : mm entiers). */
const L = (v: number): string => formatFigureLength(v, "mm", "fr");

const initial = appStore.getState().project;
appStore.getInitialState = appStore.getState;
modelService.store.getInitialState = modelService.store.getState;

function load(p: Project): Model {
  appStore.getState().replaceProject(p);
  const model = buildModel(appStore.getState().project);
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project: appStore.getState().project, pending: false },
  }));
  return model;
}

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().setDisplayUnit("mm");
  load(initial);
});

const fig = (figures: readonly SectionFigure[], id: string) => figures.find((f) => f.id === id);

function figuresOf(section: Parameters<typeof sectionFigures>[0], p: Project, t = fr) {
  const model = buildModel(p);
  return sectionFigures(
    section,
    { project: p, model, unit: "mm", structureMass: undefined, treadMass: 12.6 },
    t,
  );
}

describe("chiffres du cœur (Model.figures)", () => {
  it("Tracé : collet mini (marches balancées) et emprise au sol « X × Y », unité à droite", () => {
    const p = createProject("quarter-left");
    const m = buildModel(p);
    const f = figuresOf("layout", p);
    expect(f.map((x) => x.id)).toEqual(["typology", "run", "width", "minCollet", "footprint"]);
    expect(fig(f, "minCollet")).toEqual({
      id: "minCollet",
      value: String(Math.round(m.figures!.minCollet!)),
      caption: "collet mini",
      unit: "mm",
    });
    const fp = m.figures!.footprint!;
    const footprint = fig(f, "footprint")!;
    expect(plain(footprint.value)).toBe(plain(`${L(fp.x)} × ${L(fp.y)}`));
    expect(footprint.caption).toBe("emprise au sol");
    expect(footprint.unit).toBe("mm");
  });

  it("Tracé : escalier droit sans balancée → pas de collet mini", () => {
    const f = figuresOf("layout", createProject("straight"));
    expect(f.map((x) => x.id)).toEqual(["typology", "run", "width", "footprint"]);
  });

  it("Marches : masse des marches (kg) et recouvrement au nez", () => {
    const p = createProject("quarter-left");
    const f = figuresOf("treads", p);
    expect(f.map((x) => x.id)).toEqual([
      "treadCount",
      "thickness",
      "nosing",
      "treadMass",
      "nosingOverlap",
    ]);
    expect(fig(f, "treadMass")).toEqual({
      id: "treadMass",
      value: "13",
      caption: "masse des marches",
      unit: "kg",
    });
    expect(fig(f, "nosingOverlap")).toEqual({
      id: "nosingOverlap",
      value: String(p.stair.treads.nosing),
      caption: "recouvrement au nez",
      unit: "mm",
    });
    const noMass = sectionFigures(
      "treads",
      { project: p, model: null, unit: "mm", structureMass: undefined },
      fr,
    );
    expect(fig(noMass, "treadMass")).toEqual({
      id: "treadMass",
      value: "–",
      caption: "masse des marches",
    });
  });

  it("Garde-corps : lignes, longueur, poteaux, hauteur mini exigée", () => {
    const p: Project = { ...createProject("quarter-left"), guards: defaultGuards() };
    const g = buildModel(p).figures!.guards!;
    const f = figuresOf("guards", p);
    expect(f.map((x) => x.id)).toEqual([
      "guardLines",
      "guardLength",
      "guardPosts",
      "guardRequiredHeight",
    ]);
    expect(fig(f, "guardLines")!.value).toBe(String(g.lines));
    expect(plain(fig(f, "guardLength")!.value)).toBe(plain(L(g.length)));
    expect(fig(f, "guardPosts")!.value).toBe(String(g.posts));
    expect(g.requiredHeight).toBeDefined();
    expect(plain(fig(f, "guardRequiredHeight")!.value)).toBe(plain(L(g.requiredHeight!)));
    expect(f.map((x) => x.caption)).toEqual([
      "lignes de garde-corps",
      "longueur de garde-corps",
      "poteaux",
      "hauteur mini exigée",
    ]);
    expect(figuresOf("guards", p, en).map((x) => x.caption)).toEqual([
      "guarding runs",
      "guarding length",
      "posts",
      "minimum required height",
    ]);
  });

  it("légendes sans unité, en français et en anglais (l'unité est à droite du chiffre)", () => {
    const p: Project = { ...createProject("quarter-left"), guards: defaultGuards() };
    for (const t of [fr, en]) {
      for (const id of SECTION_IDS) {
        for (const f of figuresOf(id, p, t)) {
          expect(f.caption, `${id} ${f.id}`).not.toMatch(/\b(mm|cm|kg)\b/);
        }
      }
    }
  });
});

describe("grille sans case vide", () => {
  const cells = (n: number, wideAt: readonly number[] = []): SectionFigure[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `f${i}`,
      value: "1",
      caption: "c",
      ...(wideAt.includes(i) ? { wide: true } : {}),
    }));

  it("cas types : Découpage (5 sur 3), Tracé (typologie puis 4 sur 2), 2 sur 3", () => {
    expect(figureSpans(cells(5), 3)).toEqual([1, 1, 1, 1, 2]);
    expect(figureSpans(cells(5, [0]), 2)).toEqual([2, 1, 1, 1, 1]);
    expect(figureSpans(cells(3, [0]), 3)).toEqual([3, 1, 2]);
    expect(figureSpans(cells(3, [1]), 2)).toEqual([2, 2, 2]);
    expect(figureSpans(cells(1), 3)).toEqual([3]);
    expect(figureSpans([], 3)).toEqual([]);
    expect(columnsOf(cells(4))).toBe(2);
    expect(columnsOf(cells(5))).toBe(3);
    expect(columnsOf(cells(4, [0]))).toBe(3);
  });

  it("propriété : chaque ligne est pleine", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 12 }),
        fc.integer({ min: 1, max: 4 }),
        (wide, cols) => {
          const figures = wide.map((w, i) => ({ id: `${i}`, value: "", caption: "", wide: w }));
          const spans = figureSpans(figures, cols);
          let pos = 0;
          for (const s of spans) {
            expect(s).toBeGreaterThanOrEqual(1);
            expect(pos + s).toBeLessThanOrEqual(cols);
            pos = (pos + s) % cols;
          }
          expect(pos).toBe(0);
        },
      ),
    );
  });

  it("rendu : la masse des marches vient de la nomenclature des pièces de la famille marches", () => {
    const model = load(createProject("quarter-left"));
    const mass = bomSummary(
      model.parts.filter((p) => p.family === "treads"),
      "fr",
    ).mass!;
    const html = renderToStaticMarkup(createElement(SectionFigures, { section: "treads" }));
    const cell =
      /data-figure="treadMass"[^>]*><dt>masse des marches<\/dt><dd>([^<]*)<span class="section-figures__unit">kg<\/span>/.exec(
        html,
      );
    expect(cell).not.toBeNull();
    expect(plain(cell![1]!)).toBe(plain(L(mass)));
    // Cinq chiffres sur trois colonnes : le dernier s'étend sur deux colonnes.
    expect(html).toContain('data-figure="nosingOverlap" style="grid-column:span 2 / span 2"');
  });
});
