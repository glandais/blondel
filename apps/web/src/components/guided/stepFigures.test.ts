/**
 * Chiffres clés des étapes guidées (spécification de contenu § 2) : étape 2 (typologie,
 * reculement, collet mini, emprise), étape 4 (marches, masse des marches, recouvrement),
 * étape 6 (longueur, poteaux, hauteur mini exigée) ; unité accolée au chiffre, grille sans
 * case vide.
 */
import { buildModel, createProject, type Model, type Project } from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGuards } from "../../lib/guardsForm.js";
import { bomSummary } from "../../lib/parts.js";
import { formatFigureLength } from "../../lib/units.js";
import { appStore, modelService } from "../../store/appStore.js";
import { StepFigures, stepFigures } from "./StepFigures.js";

const fr = createTranslator("fr");
const en = createTranslator("en");
const plain = (s: string): string => s.replace(/[  ]/g, " ");

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

const render = (step: 1 | 2 | 4 | 6): string =>
  renderToStaticMarkup(createElement(StepFigures, { step }));

describe("StepFigures : chiffres manquants de la spécification", () => {
  it("étape 2 : typologie (ligne pleine), reculement, collet mini, emprise", () => {
    const p = createProject("quarter-left");
    const model = load(p);
    const f = stepFigures(2, { project: p, model, unit: "mm", mass: undefined }, fr);
    expect(f.map((x) => x.id)).toEqual(["typology", "run", "minCollet", "footprint"]);
    const html = render(2);
    expect(html).toContain('data-figure="typology" style="grid-column:1 / -1"');
    expect(html).toMatch(
      /data-figure="minCollet"[^>]*><dt class="step-figures__caption">collet mini<\/dt><dd class="step-figures__value">\d+<span class="step-figures__unit">mm<\/span>/,
    );
    expect(html).toMatch(
      />emprise au sol<\/dt><dd[^>]*>[^<]+ × [^<]+<span class="step-figures__unit">mm</,
    );
  });

  it("étape 2 sans marche balancée : aucune case vide, emprise « L × l » sur toute la ligne", () => {
    const p = createProject("straight");
    const model = load(p);
    const f = stepFigures(2, { project: p, model, unit: "mm", mass: undefined }, fr);
    expect(f.map((x) => x.id)).toEqual(["typology", "run", "footprint"]);
    const html = render(2);
    expect(html).toContain('data-figure="run" style="grid-column:1 / -1"');
    expect(html).toContain('data-figure="footprint" style="grid-column:1 / -1"');
  });

  it("étape 4 : marches, masse des marches (nomenclature famille marches), recouvrement", () => {
    const p = createProject("quarter-left");
    const model = load(p);
    const f = stepFigures(4, { project: p, model, unit: "mm", mass: 20 }, fr);
    expect(f.map((x) => [x.id, x.caption])).toEqual([
      ["treadCount", "marches"],
      ["treadMass", "masse des marches"],
      ["nosingOverlap", "recouvrement au nez"],
    ]);
    const mass = bomSummary(
      model.parts.filter((x) => x.family === "treads"),
      "fr",
    ).mass!;
    const cell =
      /data-figure="treadMass"[^>]*><dt[^>]*>masse des marches<\/dt><dd[^>]*>([^<]*)<span class="step-figures__unit">kg</.exec(
        render(4),
      );
    expect(plain(cell![1]!)).toBe(plain(formatFigureLength(mass, "mm", "fr")));
    expect(stepFigures(4, { project: p, model, unit: "mm", mass: 20 }, en)[1]!.caption).toBe(
      "tread mass",
    );
  });

  it("étape 6 : longueur, poteaux, hauteur mini exigée ; sans garde-corps : « aucun garde-corps »", () => {
    const p: Project = { ...createProject("quarter-left"), guards: defaultGuards() };
    const model = load(p);
    const g = model.figures!.guards!;
    const f = stepFigures(6, { project: p, model, unit: "mm", mass: undefined }, fr);
    expect(f.map((x) => x.id)).toEqual(["guardLength", "guardPosts", "guardRequiredHeight"]);
    expect(f[1]!.value).toBe(String(g.posts));
    expect(f[2]!.unit).toBe("mm");
    const none = createProject("quarter-left");
    const noneFigures = stepFigures(
      6,
      { project: none, model: buildModel(none), unit: "mm", mass: undefined },
      fr,
    );
    expect(noneFigures).toEqual([{ id: "guards", value: "–", caption: "aucun garde-corps" }]);
  });

  it("étape 3 : n · h · g · 2h + g · échappée (spécification de contenu § 2)", () => {
    const p = createProject("quarter-left");
    const model = load(p);
    const f = stepFigures(3, { project: p, model, unit: "mm", mass: undefined }, fr);
    expect(f.map((x) => x.id)).toEqual(["riserCount", "rise", "going", "blondel", "headroom"]);
  });

  it("étape 1 : trémie « L × l » sur toute la ligne (jamais coupée en deux lignes)", () => {
    const p = createProject("quarter-left");
    load(p);
    expect(render(1)).toContain('data-figure="opening" style="grid-column:1 / -1"');
  });

  it("garde-corps sans aucune ligne générée : « 0 » ligne, pas « aucun garde-corps »", () => {
    const p: Project = { ...createProject("quarter-left"), guards: defaultGuards() };
    const built = buildModel(p);
    const model: Model = {
      ...built,
      figures: { ...built.figures, guards: { ...built.figures!.guards!, lines: 0 } },
    };
    const f = stepFigures(6, { project: p, model, unit: "mm", mass: undefined }, fr);
    expect(f).toEqual([{ id: "guards", value: "0", caption: "lignes de garde-corps" }]);
  });

  it("unité en cm : chiffre au dixième, unité « cm » accolée", () => {
    const p = createProject("quarter-left");
    const model = load(p);
    appStore.getState().setDisplayUnit("cm");
    const f = stepFigures(2, { project: p, model, unit: "cm", mass: undefined }, fr);
    expect(f.find((x) => x.id === "run")!.unit).toBe("cm");
    expect(render(2)).toContain('<span class="step-figures__unit">cm</span>');
  });
});
