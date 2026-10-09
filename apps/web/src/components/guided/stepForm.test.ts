/**
 * Formulaires d'étape du parcours guidé (maquette 1a, spécification de contenu § 2) en rendu
 * serveur, en français et en anglais : en-tête, champs essentiels, réglages « Plus » repliés,
 * réglages d'atelier seulement à l'étape 7, chiffres clés, jauge 2h + g, contenu de l'étape 7.
 */
import {
  buildModel,
  createProject,
  fabricatedParts,
  parseProjectText,
  type Model,
  type Project,
} from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import quarterTurnText from "../../../../../examples/j5c-limon-central-bois-quart-tournant.blondel.json?raw";
import { defaultGuards } from "../../lib/guardsForm.js";
import { GUIDED_STEPS, type GuidedStep } from "../../lib/sectionIds.js";
import { chooseStructure } from "../../lib/structureChoice.js";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { blondelGaugeText } from "./BlondelGauge.js";
import { blondelGauge } from "../../lib/blondelGauge.js";
import { StepForm, withStrong } from "./StepForm.js";
import { STEP_FIGURE_IDS, fabricationStepFigures, stepFigures } from "./StepFigures.js";

const initial = appStore.getState().project;

// Rendu serveur : zustand lit `getInitialState()` ; le test rend l'état courant des stores.
appStore.getInitialState = appStore.getState;
journeyStore.getInitialState = journeyStore.getState;
modelService.store.getInitialState = modelService.store.getState;

/** Projet courant et son modèle (calculé ici, sans le worker). */
function load(p: Project): Model {
  appStore.getState().replaceProject(p);
  const model = buildModel(appStore.getState().project);
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project: appStore.getState().project, pending: false },
  }));
  return model;
}

/** Quart tournant à gauche avec garde-corps, limons en profilés UPN (paramètres de plugin, dont l'atelier). */
function steelProject(): Project {
  const p = chooseStructure(createProject("quarter-left"), "steel-profile", { family: "UPN" });
  return { ...p.project, guards: defaultGuards() };
}

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().setDisplayUnit("mm");
  load(initial);
});

function render(step: GuidedStep, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(StepForm, { step }));
}

/** Texte des entités HTML courantes rendu lisible. */
const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** Contenu des replis « Plus de réglages » (y compris imbriqués), texte seul. */
function moreText(html: string): string {
  const start = html.indexOf('class="tiered__fold tiered__fold--more');
  return start < 0 ? "" : decode(html.slice(start));
}

/** Texte hors des replis « Plus de réglages ». */
function mainText(html: string): string {
  const start = html.indexOf("<details");
  return decode(start < 0 ? html : html.slice(0, start));
}

const fr = createTranslator("fr");

const TITLES_FR = [
  "Site",
  "Forme",
  "Découpage",
  "Marches",
  "Structure",
  "Garde-corps",
  "Fabrication",
];
const TITLES_EN = ["Site", "Shape", "Stepping", "Treads", "Structure", "Guarding", "Fabrication"];

/** Un champ essentiel de chaque étape (hors repli), et un champ « Plus » (dans un repli). */
const FIELDS: Readonly<Record<GuidedStep, { main: string; more?: string }>> = {
  1: { main: "Hauteur à monter H", more: "Revêtement du sol bas" },
  2: { main: "Emmarchement E", more: "Recaler volées et trémie" },
  3: { main: "Nombre de hauteurs n", more: "Correction de la 1re hauteur" },
  4: { main: "Épaisseur de marche", more: "Épaisseur de contremarche" },
  5: { main: "Nuance d'acier", more: "Section du catalogue" },
  6: { main: "Garde-corps de volée", more: "Entraxe maximal des balustres" },
  7: { main: "Valeurs ◆ à valider", more: "Comparer les structures" },
};

/** Champ d'atelier (paramètre de plugin de niveau Atelier). */
const WORKSHOP_FIELD = "Prolongement avant le nez de départ";

describe("StepForm : en-tête, champs par niveau", () => {
  it("chaque étape : surtitre, titre, objectif, champ essentiel, champ Plus replié", () => {
    load(steelProject());
    for (const step of GUIDED_STEPS) {
      const html = render(step);
      const text = decode(html);
      expect(html).toMatch(/^<div class="step-form" data-step="\d">/);
      expect(text).toContain(`Étape ${step} sur 7`);
      expect(html).toContain(`<h2 class="step-form__title">${TITLES_FR[step - 1]}</h2>`);
      const { main, more } = FIELDS[step];
      expect(mainText(html), `étape ${step}`).toContain(main);
      if (more !== undefined) {
        expect(mainText(html), `étape ${step}`).not.toContain(more);
        expect(moreText(html), `étape ${step}`).toContain(more);
      }
    }
  });

  it("objectifs de la spécification ; étape 3 : hauteur à monter du projet", () => {
    load(steelProject());
    expect(decode(render(1))).toContain("Où va l'escalier : niveaux, trémie, murs.");
    expect(decode(render(2))).toContain("Le plan de l'escalier : droit, tournant, hélicoïdal.");
    const h = appStore.getState().project.site.floorToFloor;
    expect(h).toBe(2700);
    expect(decode(render(3))).toContain(
      "Combien de marches pour monter 2 700 mm, et de quelle hauteur.",
    );
    expect(decode(render(4))).toContain("De quoi sont faites les marches.");
    expect(decode(render(5))).toContain("Ce qui porte les marches.");
    expect(decode(render(6))).toContain("Protéger du vide.");
    expect(decode(render(7))).toContain("Vérifier avant de fabriquer, puis sortir les documents.");
  });

  it("champ d'atelier : absent des étapes 1 à 6, sous « Plus » à l'étape 7", () => {
    load(steelProject());
    for (const step of GUIDED_STEPS) {
      const html = render(step);
      if (step === 7) expect(moreText(html)).toContain(WORKSHOP_FIELD);
      else expect(decode(html), `étape ${step}`).not.toContain(WORKSHOP_FIELD);
    }
  });

  it("étape 2 : type de tournant et jour en segmentés (pas de liste déroulante)", () => {
    load(createProject("quarter-left"));
    const html = decode(render(2));
    const turnMode = fr.t("ui.params.turn.mode");
    expect(html).toContain(`role="radiogroup" aria-label="${turnMode}"`);
    expect(html).toContain('role="radiogroup" aria-label="Jour"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Marches balancées</);
    expect(html).not.toMatch(/<option value="winders"/);
    expect(html).not.toMatch(/<option value="sharp"/);
  });

  it("étape 2 : balancement seulement avec un tournant", () => {
    load(createProject("quarter-left"));
    expect(decode(render(2))).toContain("Collet cible (corde)");
    load(createProject("straight"));
    expect(decode(render(2))).not.toContain("Collet cible");
  });

  it("encart d'aide ; étape 3 : module de Blondel en gras", () => {
    load(steelProject());
    const html = render(3);
    expect(html).toContain('class="step-form__help"');
    expect(html).toContain("<b>2h + g, le module de Blondel</b>, mesure le confort du pas");
    // Une seule phrase traduite, terme en gras interpolé : l'anglais garde son ordre.
    expect(render(3, "en")).toContain(
      "<b>2R + G, the Blondel formula</b>, measures how comfortable the stride is",
    );
  });

  it("withStrong : terme en gras à la place de chaque repère, ailleurs texte inchangé", () => {
    const html = renderToStaticMarkup(createElement("p", null, withStrong("a\u0000b", "X")));
    expect(html).toBe("<p>a<b>X</b>b</p>");
    expect(renderToStaticMarkup(createElement("p", null, withStrong("abc", "X")))).toBe(
      "<p>abc</p>",
    );
  });

  it("étape 7 : un seul repli « Plus de réglages », réglages d'atelier à plat dedans", () => {
    load(steelProject());
    const html = render(7);
    expect(html.match(/tiered__fold--more/g)).toHaveLength(1);
    expect(moreText(html)).toContain(WORKSHOP_FIELD);
  });
});

describe("StepFigures : chiffres clés", () => {
  it("cadre blueprint de chaque étape, chiffres choisis dans la bande du panneau libre", () => {
    const model = load(steelProject());
    const t = createTranslator("fr");
    const project = appStore.getState().project;
    for (const step of GUIDED_STEPS) {
      const html = render(step);
      expect(html).toContain(`class="blueprint step-figures" role="group"`);
      expect(html).toContain('aria-label="Chiffres clés de l&#x27;étape"');
      const ids = stepFigures(step, { project, model, unit: "mm", mass: 1 }, t).map((f) => f.id);
      // Garde-corps présents : la case « aucun garde-corps » n'apparaît pas.
      expect(ids).toEqual(
        step === 7
          ? ["parts", "mass", "executionClass"]
          : STEP_FIGURE_IDS[step].ids.filter((id) => id !== "guards"),
      );
      for (const id of ids) expect(html).toContain(`data-figure="${id}"`);
    }
  });

  it("étape 3 : n, h, 2h + g du modèle, unité accolée au chiffre", () => {
    const model = load(steelProject());
    const html = render(3);
    expect(html).toMatch(
      new RegExp(
        `data-figure="riserCount"[^>]*><dt[^>]*>n</dt><dd[^>]*>${model.stepping.riserCount}<`,
      ),
    );
    expect(html).toMatch(/>2h \+ g<\/dt><dd[^>]*>\d+<span class="step-figures__unit">mm<\/span>/);
    expect(html).not.toMatch(/<dt[^>]*>[^<]*mm<\/dt>/);
  });

  it("étape 7 : pièces, masse, classe d'exécution", () => {
    const model = load(steelProject());
    const t = createTranslator("fr");
    const f = fabricationStepFigures(model, 412.4, t);
    expect(f.map((x) => x.value)).toEqual([String(model.parts.length), "412", "EXC1"]);
    expect(fabricationStepFigures(null, undefined, t).map((x) => x.value)).toEqual(["–", "–", "–"]);
  });

  it("étape 7 : pièces fabriquées seulement, sans double compte des composantes (A36 (9))", () => {
    // Poutre en couches empilées : LC1 et ses couches composées ne sont pas comptées.
    const model = buildModel(parseProjectText(quarterTurnText));
    const fab = fabricatedParts(model.parts).length;
    expect(model.parts.some((p) => p.componentOf !== undefined)).toBe(true);
    expect(fab).toBeLessThan(model.parts.length);
    const f = fabricationStepFigures(model, undefined, createTranslator("fr"));
    expect(f[0]!.value).toBe(String(fab));
  });
});

describe("BlondelGauge", () => {
  it("étape 3 : role meter, valeur du modèle, phrase en valuetext", () => {
    const model = load(steelProject());
    const html = render(3);
    const blondel = model.stepping.blondel;
    expect(html).toContain('role="meter" aria-label="Module 2h + g"');
    expect(html).toContain(`aria-valuenow="${blondel}"`);
    expect(html).toContain(`data-value="${blondel}"`);
    const g = blondelGauge(model)!;
    expect(html).toContain(`aria-valuemin="${g.scale.min}" aria-valuemax="${g.scale.max}"`);
    const text = blondelGaugeText(g, createTranslator("fr"));
    expect(decode(html)).toContain(`aria-valuetext="${text}"`);
    // Graduations : bornes de l'échelle et de la zone, en cm.
    expect(html).toMatch(/>56<\/span>.*>60<\/span>.*>64<\/span>.*>68 cm<\/span>/);
  });

  it("phrases selon le statut, nombres dans la langue", () => {
    const g = {
      value: 605,
      zone: { min: 600, max: 640 },
      scale: { min: 560, max: 680 },
      position: { zoneStart: 1 / 3, zoneEnd: 2 / 3, value: 0.375 },
    };
    const fr = createTranslator("fr");
    const en = createTranslator("en");
    expect(blondelGaugeText({ ...g, status: "comfortable" }, fr)).toBe(
      "Confortable : 60,5 cm, dans la zone 60–64 cm.",
    );
    expect(blondelGaugeText({ ...g, status: "comfortable" }, en)).toBe(
      "Comfortable: 60.5 cm, within the 60–64 cm range.",
    );
    expect(blondelGaugeText({ ...g, status: "outside" }, fr)).toBe(
      "Hors de la zone de confort : 60,5 cm, zone 60–64 cm.",
    );
    expect(blondelGaugeText({ ...g, status: "unknown" }, fr)).toContain("non évaluée");
  });

  it("autres étapes : pas de jauge", () => {
    load(steelProject());
    expect(render(2)).not.toContain('role="meter"');
  });
});

describe("étape 7 Fabrication", () => {
  it("liste ◆, pièces par famille, sorties, comparateur et atelier sous « Plus »", () => {
    load(steelProject());
    const html = decode(render(7));
    expect(html).toContain("Valeurs ◆ à valider");
    expect(html).toContain("Tout valider");
    expect(html).toContain('aria-label="Pièces par famille"');
    expect(html).toContain("Limons");
    expect(html).toContain("Dossier PDF");
    expect(html).toContain("Générer…");
    expect(html).toContain("Fiche de pose (PDF)");
    expect(html).toContain("Liste de débit (CSV)");
    expect(html).toContain("Coût estimé");
    expect(moreText(html)).toContain("Comparer les structures");
  });

  it("sans modèle : état du calcul à la place des pièces", () => {
    load(steelProject());
    modelService.store.setState((s) => ({ model: { ...s.model, model: null, pending: true } }));
    expect(render(7)).toContain("Calcul du modèle…");
  });
});

describe("anglais", () => {
  it("titres, surtitre, objectifs, jauge, étape 7 traduits ; aucune clé brute", () => {
    load(steelProject());
    for (const step of GUIDED_STEPS) {
      const html = render(step, "en");
      expect(html).toContain(`Step ${step} of 7`);
      expect(html).toContain(`<h2 class="step-form__title">${TITLES_EN[step - 1]}</h2>`);
      expect(html).not.toContain("Étape");
      expect(html).not.toMatch(/\bui\.[a-z]+\.[\w.]+/);
    }
    expect(render(3, "en")).toContain('aria-label="2R + G formula"');
    expect(render(3, "en")).toContain("How many steps to climb 2,700 mm");
    expect(render(7, "en")).toContain("Compare structures");
  });
});
