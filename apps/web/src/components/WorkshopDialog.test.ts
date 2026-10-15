/**
 * Dialogue « Atelier… » : réglage du profil d'atelier **du projet** (décision F10 (21)) sous le
 * barème de coût. La tolérance d'identité des pièces repérées s'y édite (même chemin du projet
 * que la section Structure, annulable), marquée ◆ tant qu'elle n'est pas validée quand le modèle
 * a des pièces repérées (sinon ni ◆ ni rappel du représentant, question (38)) ; le barème
 * (navigateur) ne la porte pas et ne la touche pas.
 */
import { buildModel, createProject, withValidatedValues, type Project } from "@blondel/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IDENTICAL_TOLERANCE_PATH } from "../lib/partMarks.js";
import { ratesToJson } from "../lib/workshopRates.js";
import { appStore, modelService, workshopStore } from "../store/appStore.js";
import { closeWorkshopDialog, openWorkshopDialog, uiStore } from "../store/uiStore.js";
import { WorkshopDialog } from "./WorkshopDialog.js";

for (const store of [appStore, modelService.store, uiStore, workshopStore]) {
  (store as { getInitialState: () => unknown }).getInitialState = store.getState;
}

const initial = appStore.getState().project;
const base = createProject("straight");
const steel: Project = {
  ...base,
  stair: { ...base.stair, structure: { kind: "steel-flat", params: {} } },
};

function load(p: Project): void {
  appStore.getState().replaceProject(p);
  const project = appStore.getState().project;
  const model = buildModel(project);
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project, pending: false },
  }));
}

const render = (locale: "fr" | "en" = "fr"): string => {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(WorkshopDialog));
};

/** Fieldset du réglage du projet dans le rendu du dialogue. */
const projectFieldset = (html: string): string => {
  const start = html.indexOf('data-testid="workshop-part-marks"');
  return start < 0 ? "" : html.slice(start, html.indexOf("</fieldset>", start));
};

describe("dialogue « Atelier… » : repérage des pièces (F10 (21))", () => {
  beforeAll(() => openWorkshopDialog());
  afterEach(() => {
    appStore.getState().setLocale("fr");
    workshopStore.getState().setRates({});
  });
  afterAll(() => {
    closeWorkshopDialog();
    load(initial);
  });

  it("fieldset distinct sous le barème : tolérance (0,5 mm, ◆), rappel du représentant", () => {
    load(steel);
    const html = render();
    const form = html.indexOf('aria-label="Barème de coût"');
    const fieldset = projectFieldset(html);
    expect(form).toBeGreaterThan(0);
    expect(html.indexOf('data-testid="workshop-part-marks"')).toBeGreaterThan(form);
    expect(fieldset).toContain("Repérage des pièces (enregistré dans le projet)");
    expect(fieldset).toContain("Tolérance d&#x27;identité des pièces repérées");
    expect(fieldset).toContain('value="0,5"');
    expect(fieldset).toContain("tiered__item--tv");
    expect(fieldset).toContain("la plus courte");
    expect(fieldset).toContain("dans la section Structure");
    expect(fieldset).toContain("compte des pièces uniques");
    const en = projectFieldset(render("en"));
    expect(en).toContain("Part marking (saved in the project)");
    expect(en).toContain('value="0.5"');
    expect(en).not.toContain("Repérage");
  });

  it("saisie : chemin du projet, une entrée d'historique annulable ; ◆ retiré une fois validée", () => {
    load(steel);
    expect(appStore.getState().setField(IDENTICAL_TOLERANCE_PATH, 0.3).ok).toBe(true);
    expect(appStore.getState().project.workshop?.identicalPartTolerance).toBe(0.3);
    expect(projectFieldset(render())).toContain('value="0,3"');
    appStore.getState().undo();
    expect(appStore.getState().project.workshop?.identicalPartTolerance).toBeUndefined();
    expect(projectFieldset(render())).toContain('value="0,5"');
    load(withValidatedValues(steel, [{ path: "workshop.identicalPartTolerance", value: 0.5 }]));
    expect(projectFieldset(render())).not.toContain("tiered__item--tv");
  });

  it("projet sans pièces repérées (bois) : tolérance éditable, sans ◆ ni rappel ni renvoi (38)", () => {
    load(base);
    expect(modelService.store.getState().model.model?.parts.some((p) => p.markName)).toBe(false);
    const fieldset = projectFieldset(render());
    expect(fieldset).toContain('value="0,5"');
    expect(fieldset).toContain("compte des pièces uniques");
    expect(fieldset).not.toContain("tiered__item--tv");
    expect(fieldset).not.toContain("la plus courte");
    expect(fieldset).not.toContain("section Structure");
    // Validation enregistrée : sans effet visible, aucune ligne ◆ ne la porte sur ce projet.
    load(withValidatedValues(base, [{ path: "workshop.identicalPartTolerance", value: 0.5 }]));
    expect(projectFieldset(render())).not.toContain("tiered__item--tv");
  });

  it("pièces repérées : ◆ retiré par une validation de la valeur courante, caduque sinon", () => {
    load(withValidatedValues(steel, [{ path: "workshop.identicalPartTolerance", value: 0.5 }]));
    expect(projectFieldset(render())).not.toContain("tiered__item--tv");
    expect(appStore.getState().setField(IDENTICAL_TOLERANCE_PATH, 0.4).ok).toBe(true);
    load(appStore.getState().project);
    expect(projectFieldset(render())).toContain("tiered__item--tv");
  });

  it("barème : n'enregistre ni n'efface la tolérance du projet", () => {
    load({ ...steel, workshop: { identicalPartTolerance: 0.3 } });
    workshopStore.getState().setRates({ hourlyRate: 50 });
    expect(ratesToJson(workshopStore.getState().rates)).not.toContain("identicalPartTolerance");
    workshopStore.getState().setRates({});
    expect(appStore.getState().project.workshop?.identicalPartTolerance).toBe(0.3);
    expect(projectFieldset(render())).toContain('value="0,3"');
  });
});
