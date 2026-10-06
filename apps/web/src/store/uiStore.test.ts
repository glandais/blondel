import { describe, expect, it } from "vitest";
import { createJourneyStore } from "./journeyStore.js";
import { memoryStorage } from "./persistence.js";
import { createProjectStore } from "./projectStore.js";
import { createUiStore, linkWorkspaceAndView, workspaceOfView } from "./uiStore.js";

function stores() {
  const app = createProjectStore();
  const journey = createJourneyStore(memoryStorage(), { hasAutosave: true });
  const ui = createUiStore(app.getState().view);
  linkWorkspaceAndView(app, journey, ui);
  return { app, journey, ui };
}

describe("espace de travail et vue", () => {
  it("vues rangées par espace", () => {
    expect(workspaceOfView("3d")).toBe("design");
    expect(workspaceOfView("bom")).toBe("fabrication");
  });

  it("aller-retour Conception → Fabrication : chaque espace retrouve sa dernière vue", () => {
    const { app, journey } = stores();
    app.getState().setView("3d");
    journey.getState().setWorkspace("fabrication");
    expect(app.getState().view).toBe("flat");
    app.getState().setView("bom");
    journey.getState().setWorkspace("design");
    expect(app.getState().view).toBe("3d");
    journey.getState().setWorkspace("fabrication");
    expect(app.getState().view).toBe("bom");
  });

  it("une vue choisie ailleurs ramène son espace ; projet et historique intacts", () => {
    const { app, journey } = stores();
    const project = app.getState().project;
    const history = app.getState().history;
    journey.getState().setWorkspace("fabrication");
    app.getState().setView("plan");
    expect(journey.getState().workspace).toBe("design");
    expect(app.getState().project).toBe(project);
    expect(app.getState().history).toBe(history);
  });
});

describe("isolation 3D et lien des surcharges", () => {
  it("isoler puis tout réafficher ; révéler les surcharges efface la sélection", async () => {
    const { appStore } = await import("./appStore.js");
    const { uiStore, isolatePart, showAllParts, revealOverrides } = await import("./uiStore.js");
    expect(uiStore.getState().isolatedPartId).toBeNull();
    isolatePart("stringer-outer-1");
    expect(uiStore.getState().isolatedPartId).toBe("stringer-outer-1");
    showAllParts();
    expect(uiStore.getState().isolatedPartId).toBeNull();
    appStore.getState().select({ location: { kind: "tread", number: 3 } });
    const seq = uiStore.getState().overridesRevealSeq;
    revealOverrides();
    expect(appStore.getState().selection).toBeNull();
    expect(uiStore.getState().overridesRevealSeq).toBe(seq + 1);
  });
});

describe("mode Fabrication (vague 4)", () => {
  it("onglets de Fabrication : Pièces, Nomenclature, Comparer, À valider", async () => {
    const { FABRICATION_VIEWS, DESIGN_VIEWS } = await import("./uiStore.js");
    expect(FABRICATION_VIEWS).toEqual(["flat", "bom", "compare", "validate"]);
    expect(DESIGN_VIEWS).toEqual(["plan", "3d", "elevation"]);
    expect(workspaceOfView("validate")).toBe("fabrication");
  });

  it("l'onglet À valider se retrouve au retour en Fabrication", () => {
    const { app, journey } = stores();
    journey.getState().setWorkspace("fabrication");
    app.getState().setView("validate");
    journey.getState().setWorkspace("design");
    expect(app.getState().view).toBe("plan");
    journey.getState().setWorkspace("fabrication");
    expect(app.getState().view).toBe("validate");
  });

  it("badge Contrôle et lien des surcharges : retour en Conception depuis la Fabrication", async () => {
    const { appStore, journeyStore } = await import("./appStore.js");
    const { revealControl, revealOverrides, uiStore } = await import("./uiStore.js");
    for (const reveal of [revealControl, revealOverrides]) {
      journeyStore.getState().setWorkspace("fabrication");
      appStore.getState().select({ location: { kind: "part", partId: "tread-1" } });
      const { project, history } = appStore.getState();
      const before = uiStore.getState();
      reveal();
      expect(journeyStore.getState().workspace).toBe("design");
      expect(appStore.getState().selection).toBeNull();
      expect(appStore.getState().project).toBe(project);
      expect(appStore.getState().history).toBe(history);
      const after = uiStore.getState();
      expect(after.controlRevealSeq + after.overridesRevealSeq).toBe(
        before.controlRevealSeq + before.overridesRevealSeq + 1,
      );
    }
  });

  it("en Conception, le badge Contrôle ne change pas d'espace", async () => {
    const { journeyStore } = await import("./appStore.js");
    const { revealControl } = await import("./uiStore.js");
    journeyStore.getState().setWorkspace("design");
    revealControl();
    expect(journeyStore.getState().workspace).toBe("design");
  });
});
