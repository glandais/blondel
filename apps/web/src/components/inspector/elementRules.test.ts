/**
 * Bloc « Règles sur cette marche / cette pièce » (inspecteurs 2a et 2b) en rendu serveur :
 * nombre de violations, cartes compactes (constat, sans localisation), phrase sans violation,
 * ligne « Respectées ici », en français et en anglais.
 */
import {
  buildModel,
  createProject,
  ruleTitle,
  textMessage,
  type Model,
  type RuleResult,
} from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { appStore, journeyStore, modelService, workshopStore } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { ElementRules, PASSED_PREVIEW, type ElementTarget } from "./ElementRules.js";

const initial = appStore.getState().project;

appStore.getInitialState = appStore.getState;
modelService.store.getInitialState = modelService.store.getState;
journeyStore.getInitialState = journeyStore.getState;
uiStore.getInitialState = uiStore.getState;
workshopStore.getInitialState = workshopStore.getState;

/** Projet droit et son modèle, résultats du contrôle remplacés. */
function loadWith(results: readonly RuleResult[]): Model {
  appStore.getState().replaceProject(createProject("straight"));
  const project = appStore.getState().project;
  const built = buildModel(project);
  const model = { ...built, compliance: { ...built.compliance, results } };
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project, pending: false },
  }));
  return model;
}

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().replaceProject(initial);
});

function render(target: ElementTarget, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(ElementRules, { target }));
}

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

function result(partial: Partial<RuleResult>): RuleResult {
  return {
    ruleId: "G_MIN_DTU",
    status: "violation",
    severity: "avertissement",
    declaredSeverity: "avertissement",
    location: { kind: "tread", number: 3 },
    nature: "normatif",
    confidence: "eleve",
    source: "",
    secondarySource: false,
    message: textMessage("Giron trop court sur la marche 3."),
    ...partial,
  };
}

const FR = translatorFor("fr");
const PASSED_IDS = ["H_MAX_DTU", "BLONDEL_DTU", "H_REGULARITE", "G_TOL_DROITE", "NEZ_CONTRASTE"];

describe("règles sur une marche", () => {
  it("violations en cartes compactes (constat), ordre de sévérité, nez n − 1 compris", () => {
    loadWith([
      result({}),
      result({
        ruleId: "ECHAPPEE_MIN_DTU",
        severity: "bloquant",
        location: { kind: "nosing", index: 2 },
        message: textMessage("Échappée insuffisante au nez 2."),
      }),
      result({ ruleId: "G_MIN_LOGEMENT", location: { kind: "tread", number: 4 } }),
    ]);
    const html = render({ kind: "tread", number: 3 });
    expect(text(html)).toContain("Règles sur cette marche · 2");
    const cards = [
      ...html.matchAll(
        /class="blueprint rule-card rule-card--compact" data-severity="(\w+)" data-rule="(\w+)"/g,
      ),
    ];
    expect(cards.map((c) => [c[1], c[2]])).toEqual([
      ["bloquant", "ECHAPPEE_MIN_DTU"],
      ["avertissement", "G_MIN_DTU"],
    ]);
    expect(text(html)).toContain("Échappée insuffisante au nez 2.");
    expect(html).not.toContain("rule-card__loc");
    expect(html).not.toContain("element-rules__none");
  });

  it("aucune violation : phrase ; respectées : 3 titres puis (+ k), repliées", () => {
    loadWith(PASSED_IDS.map((ruleId) => result({ ruleId, status: "ok" })));
    const html = render({ kind: "tread", number: 3 });
    expect(text(html)).toContain("Règles sur cette marche · 0");
    expect(text(html)).toContain("Aucune règle en défaut sur cet élément.");
    const titles = PASSED_IDS.slice(0, PASSED_PREVIEW).map((id) => FR.t(ruleTitle(id)));
    expect(text(html)).toContain(
      `Respectées ici : ${titles.join(", ")} (+ ${PASSED_IDS.length - PASSED_PREVIEW})`,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('class="results"');
  });

  it("anglais : libellés traduits, sans clé brute", () => {
    loadWith([result({}), result({ ruleId: "H_MAX_DTU", status: "ok" })]);
    const t = text(render({ kind: "tread", number: 3 }, "en"));
    expect(t).toContain("Rules on this tread · 1");
    expect(t).toContain("Passed here: Maximum rise (timber DTU)");
    expect(t).not.toMatch(/\bui\.[a-zA-Z]+\./);
  });
});

describe("règles sur une pièce", () => {
  it("la pièce et la marche qu'elle matérialise", () => {
    const m = loadWith([]);
    const tread = m.parts.find((p) => p.treadNumber === 3)!;
    loadWith([
      result({ ruleId: "FAB_SUPPORT_LONGUEUR_MIN", location: { kind: "part", partId: tread.id } }),
      result({}),
      result({ ruleId: "H_MAX_DTU", location: { kind: "tread", number: 5 } }),
    ]);
    const html = render({ kind: "part", partId: tread.id });
    expect(text(html)).toContain("Règles sur cette pièce · 2");
    expect(text(render({ kind: "part", partId: tread.id }, "en"))).toContain(
      "Rules on this part · 2",
    );
  });

  it("pièce sans résultat : phrase, pas de ligne des respectées", () => {
    loadWith([result({ status: "ok" })]);
    const html = render({ kind: "part", partId: "inconnue" });
    expect(text(html)).toContain("Règles sur cette pièce · 0");
    expect(text(html)).toContain("Aucune règle en défaut sur cet élément.");
    expect(html).not.toContain("element-rules__passed");
  });
});
