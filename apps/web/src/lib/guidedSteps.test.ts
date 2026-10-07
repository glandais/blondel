import { buildModel, createDemoProject, createProject, type Project } from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import {
  GUIDED_DESIGN_TABS,
  GUIDED_FABRICATION_TABS,
  GUIDED_STEP_COUNT,
  STEP_TITLE_KEYS,
  guidedShownView,
  guidedStepOfParam,
  guidedStepOfRow,
  guidedViewTabs,
  isRecommendedView,
  nextStep,
  previousStep,
  stepSummary,
  type StepSummarySources,
} from "./guidedSteps.js";
import { defaultGuards } from "./guardsForm.js";
import { structureParamEntry, tierEntry, toValidateCountByStep } from "./paramTiers.js";
import { GUIDED_STEPS, type GuidedStep } from "./sectionIds.js";

const fr = createTranslator("fr");
const en = createTranslator("en");
/** Espaces fines et insécables du français ramenées à des espaces simples. */
const plain = (s: string): string => s.replace(/[  ]/g, " ");

function sources(project: Project, unit: "mm" | "cm" = "mm"): StepSummarySources {
  const model = buildModel(project);
  return { project, model, unit, toValidateByStep: toValidateCountByStep(project, model) };
}

function summaries(s: StepSummarySources, t = fr): string[] {
  return GUIDED_STEPS.map((step) => plain(stepSummary(step, s, t).text));
}

describe("titres et navigation", () => {
  it("sept étapes titrées en français et en anglais", () => {
    expect(GUIDED_STEP_COUNT).toBe(7);
    expect(GUIDED_STEPS.map((s) => fr.t(STEP_TITLE_KEYS[s]))).toEqual([
      "Site",
      "Forme",
      "Découpage",
      "Marches",
      "Structure",
      "Garde-corps",
      "Fabrication",
    ]);
    expect(GUIDED_STEPS.map((s) => en.t(STEP_TITLE_KEYS[s]))).toEqual([
      "Site",
      "Shape",
      "Stepping",
      "Treads",
      "Structure",
      "Guarding",
      "Fabrication",
    ]);
  });

  it("précédente / suivante, bornées aux étapes 1 et 7", () => {
    expect(previousStep(1)).toBeNull();
    expect(nextStep(7)).toBeNull();
    expect(previousStep(4)).toBe(3);
    expect(nextStep(4)).toBe(5);
    // Parcours complet dans les deux sens.
    const forward: GuidedStep[] = [1];
    for (let s = nextStep(1); s !== null; s = nextStep(s)) forward.push(s);
    expect(forward).toEqual([...GUIDED_STEPS]);
    const back: GuidedStep[] = [7];
    for (let s = previousStep(7); s !== null; s = previousStep(s)) back.push(s);
    expect(back).toEqual([...GUIDED_STEPS].reverse());
  });
});

describe("onglets et vue conseillée", () => {
  it("onglets de conception (ordre de la maquette) et de l'étape 7", () => {
    expect(GUIDED_DESIGN_TABS).toEqual(["elevation", "plan", "3d"]);
    expect(GUIDED_FABRICATION_TABS).toEqual(["flat", "bom", "compare", "3d"]);
    for (const s of [1, 2, 3, 4, 5, 6] as const) expect(guidedViewTabs(s)).toBe(GUIDED_DESIGN_TABS);
    expect(guidedViewTabs(7)).toBe(GUIDED_FABRICATION_TABS);
  });

  it("vue montrée : la vue active si c'est un onglet de l'étape, sinon la vue conseillée", () => {
    expect(guidedShownView(3, "plan")).toBe("plan");
    expect(guidedShownView(3, "flat")).toBe("elevation");
    expect(guidedShownView(4, "validate")).toBe("3d");
    expect(guidedShownView(7, "3d")).toBe("3d");
    expect(guidedShownView(7, "validate")).toBe("flat");
    expect(guidedShownView(7, "elevation")).toBe("flat");
  });

  it("vue conseillée : vue et, pour le plan, mode du plan", () => {
    expect(isRecommendedView(1, "plan", "site")).toBe(true);
    expect(isRecommendedView(1, "plan", "drawing")).toBe(false);
    expect(isRecommendedView(2, "plan", "drawing")).toBe(true);
    expect(isRecommendedView(2, "plan", "site")).toBe(false);
    expect(isRecommendedView(3, "elevation", "site")).toBe(true);
    expect(isRecommendedView(3, "3d", "drawing")).toBe(false);
    for (const s of [4, 5, 6] as const) expect(isRecommendedView(s, "3d", "drawing")).toBe(true);
    expect(isRecommendedView(7, "flat", "drawing")).toBe(true);
    expect(isRecommendedView(7, "bom", "drawing")).toBe(false);
  });
});

describe("étape d'un paramètre", () => {
  it("champ essentiel, champ « Plus », réglage d'atelier, Conception absent du guidé", () => {
    expect(guidedStepOfParam(tierEntry("stair.stepping.riserCount")!)).toBe(3);
    expect(guidedStepOfParam(tierEntry("stair.balancing.targetCollet")!)).toBe(2);
    expect(guidedStepOfParam(tierEntry("guards.posts.size")!)).toBe(7);
    expect(guidedStepOfParam(tierEntry("stair.balancing.rotationReach")!)).toBeNull();
    expect(guidedStepOfParam(tierEntry("compliance.profile")!)).toBeNull();
    // Essence de structure : d'abord dans « Marches » (étape 4), aussi à l'étape 5.
    expect(guidedStepOfParam(structureParamEntry("wood-housed", ["material"]))).toBe(4);
  });

  it("ligne de la liste ◆ : entrée du plugin pour un paramètre de plugin", () => {
    expect(guidedStepOfRow({ key: "guards.material", steps: [6] })).toBe(6);
    expect(guidedStepOfRow({ key: "guards.infill.spacing", steps: [6] })).toBe(6);
    expect(guidedStepOfRow({ key: "guards.wallTolerance", steps: [] })).toBe(7);
    expect(guidedStepOfRow({ key: "stair.balancing.rotationSteepness", steps: [] })).toBeNull();
    expect(
      guidedStepOfRow({
        key: "stair.structure.params.supports.pinch",
        steps: [],
        structureKind: "steel-flat",
      }),
    ).toBe(7);
    expect(
      guidedStepOfRow({
        key: "stair.structure.params.column.material",
        steps: [5],
        structureKind: "helical-core",
      }),
    ).toBe(5);
    // Sans entrée : première étape de la ligne.
    expect(guidedStepOfRow({ key: "inconnu.chemin", steps: [4] })).toBe(4);
    expect(guidedStepOfRow({ key: "inconnu.chemin", steps: [] })).toBeNull();
  });
});

describe("résumés de la barre d'étapes", () => {
  it("projet droit sans garde-corps, en français", () => {
    const s = sources(createProject("straight"));
    const out = summaries(s);
    expect(out[0]).toMatch(/^H 2 700 · trémie \d[\d ]* × \d[\d ]*$/);
    expect(out[1]).toBe("Escalier droit · E 900");
    expect(out[2]).toBe(
      `${s.model!.stepping!.riserCount} hauteurs · ${Math.round(s.model!.stepping!.rise)} mm`,
    );
    expect(out[3]).toMatch(/^Chêne 40 · nez \d+$/);
    expect(out[4]).toBe("Aucune structure");
    expect(out[5]).toBe("sans garde-corps");
    expect(out[6]).toBe(`${s.model!.parts.length} pièces`);
    expect(GUIDED_STEPS.every((step) => stepSummary(step, s, fr).toValidate === 0)).toBe(true);
  });

  it("même projet en anglais", () => {
    const out = summaries(sources(createProject("quarter-left")), en);
    expect(out[0]).toMatch(/^H 2,700 · opening [\d,]+ × [\d,]+$/);
    expect(out[1]).toBe("Quarter-turn stair, left-hand · W 900");
    expect(out[2]).toMatch(/^\d+ rises · \d+ mm$/);
    expect(out[3]).toMatch(/^Oak 40 · nosing \d+$/);
    expect(out[5]).toBe("no guarding");
    expect(out[6]).toMatch(/^\d+ parts$/);
  });

  it("démo à structure acier : libellé du plugin, remplissage, ◆ restantes", () => {
    const s = sources(createDemoProject("demo-quarter-curved"));
    const step6 = stepSummary(6, s, fr);
    expect(step6.toValidate).toBe(s.toValidateByStep[6]);
    expect(step6.toValidate).toBeGreaterThan(0);
    // Spécification : « Verre · 3 lignes · ◆ 1 » (lignes lues dans `Model.figures.guards`).
    const lines = s.model!.figures!.guards!.lines;
    expect(lines).toBe(3);
    expect(plain(step6.text)).toBe(`Verre · 3 lignes · ◆ ${step6.toValidate}`);
    expect(plain(stepSummary(6, s, en).base)).toBe("Glass · 3 runs");
    const step7 = stepSummary(7, s, fr);
    expect(plain(step7.text)).toBe(
      `${s.model!.parts.length} pièces · ◆ ${s.toValidateByStep[7]} à valider`,
    );
    expect(plain(stepSummary(7, s, en).text)).toBe(
      `${s.model!.parts.length} parts · ◆ ${s.toValidateByStep[7]} to validate`,
    );
    // Texte de base et partie ◆ séparés : seule la base se tronque à l'affichage.
    expect(step7.base).toBe(`${s.model!.parts.length} pièces`);
    expect(step7.toValidateText).toBe(`· ◆ ${s.toValidateByStep[7]} à valider`);
    // Étape 5 : libellé court et nuance d'acier (spécification : « Débillardé soudé · S235 »).
    const step5 = stepSummary(5, s, fr);
    expect(step5.base).toBe("Débillardé soudé · S235");
    expect(stepSummary(5, s, en).base).toBe("Welded wreathed string · S235");
  });

  it("étape 5 : limon central, libellé court et nuance (A29)", () => {
    const base = createProject("straight");
    const central: Project = {
      ...base,
      stair: { ...base.stair, structure: { kind: "steel-central", params: {} } },
    };
    const s = sources(central);
    expect(plain(stepSummary(5, s, fr).base)).toBe("Limon central · S235");
    expect(plain(stepSummary(5, s, en).base)).toBe("Mono-stringer · S235");
  });

  it("étape 5 : limon central bois, libellé court et essence (A29, vague 2)", () => {
    const base = createProject("straight");
    const central: Project = {
      ...base,
      stair: { ...base.stair, structure: { kind: "wood-central", params: {} } },
    };
    const s = sources(central);
    expect(plain(stepSummary(5, s, fr).base)).toBe("Limon central bois · Chêne");
    expect(plain(stepSummary(5, s, en).base)).toBe("Timber mono-stringer · Oak");
  });

  it("étape 5 : essence d'une structure bois, plugin indisponible traduit", () => {
    const wood = sources(createDemoProject("demo-u-oak"));
    expect(plain(stepSummary(5, wood, fr).base)).toMatch(/^Limons .+ · Chêne$/);
    const base = createProject("straight");
    const missing: Project = {
      ...base,
      stair: { ...base.stair, structure: { kind: "plugin-absent", params: {} } },
    };
    expect(stepSummary(5, { ...sources(base), project: missing }, fr).base).toBe(
      fr.t("ui.structure.pluginMissing", { kind: "plugin-absent" }),
    );
  });

  it("sans ◆ : pas de partie ◆, texte = base", () => {
    const r = stepSummary(1, sources(createProject("straight")), fr);
    expect(r.toValidateText).toBeNull();
    expect(r.text).toBe(r.base);
  });

  it("variante ◆ : n'apparaît que s'il en reste", () => {
    const s = sources(createProject("straight"));
    const with3 = { ...s, toValidateByStep: { ...s.toValidateByStep, 3: 3 } };
    const r = stepSummary(3, with3, fr);
    expect(r.toValidate).toBe(3);
    expect(plain(r.text)).toBe(`${plain(stepSummary(3, s, fr).text)} · ◆ 3`);
  });

  it("trémie tracée, sans trémie, hélicoïdal, sans modèle", () => {
    const helical = sources(createDemoProject("demo-helical-glass"));
    expect(plain(stepSummary(1, helical, fr).text)).toBe("H 2 750 · trémie tracée");
    expect(plain(stepSummary(2, helical, fr).text)).toMatch(/^Hélicoïdal · E /);
    expect(plain(stepSummary(2, helical, en).text)).toMatch(/^Spiral · W /);
    const base = createProject("straight");
    const noOpening: Project = { ...base, site: { ...base.site, opening: undefined } };
    expect(plain(stepSummary(1, sources(noOpening), fr).text)).toBe("H 2 700 · sans trémie");
    const noModel: StepSummarySources = { ...sources(base), model: null };
    expect(stepSummary(3, noModel, fr).text).toBe("–");
    expect(stepSummary(7, noModel, fr).text).toBe("–");
  });

  it("unité affichée en cm ; garde-corps présents", () => {
    const base = createProject("straight");
    const s = sources({ ...base, guards: defaultGuards() }, "cm");
    expect(plain(stepSummary(1, s, fr).text)).toMatch(/^H 270 · trémie/);
    expect(plain(stepSummary(3, s, fr).text)).toMatch(/^\d+ hauteurs · [\d,]+ cm$/);
    expect(plain(stepSummary(6, s, fr).base)).toMatch(/ · \d+ lignes?$/);
  });

  it("étape 6 : pluriel du nombre de lignes, remplissage seul sans modèle", () => {
    const s = sources(createDemoProject("demo-quarter-curved"));
    const g = s.model!.figures!.guards!;
    const one = { ...s, model: { ...s.model!, figures: { guards: { ...g, lines: 1 } } } };
    expect(plain(stepSummary(6, one, fr).base)).toBe("Verre · 1 ligne");
    expect(plain(stepSummary(6, one, en).base)).toBe("Glass · 1 run");
    expect(stepSummary(6, { ...s, model: null }, fr).base).toBe("Verre");
  });

  it("étape 4 : matériau, épaisseur et nez (« Chêne 40 · nez 30 »)", () => {
    const base = createProject("quarter-left");
    const p: Project = {
      ...base,
      stair: { ...base.stair, treads: { ...base.stair.treads, thickness: 40, nosing: 30 } },
    };
    expect(plain(stepSummary(4, sources(p), fr).base)).toBe("Chêne 40 · nez 30");
  });
});
