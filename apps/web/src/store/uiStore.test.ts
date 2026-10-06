import { afterEach, describe, expect, it } from "vitest";
import { createJourneyStore } from "./journeyStore.js";
import { memoryStorage } from "./persistence.js";
import { createProjectStore } from "./projectStore.js";
import {
  createUiStore,
  linkDrawerToSelection,
  linkWorkspaceAndView,
  workspaceOfView,
} from "./uiStore.js";

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

describe("navigation du parcours guidé (vague 5)", () => {
  /** Stores de l'application en guidé, à l'étape 1, liste du contrôle fermée. */
  async function guided() {
    const { appStore, journeyStore } = await import("./appStore.js");
    const ui = await import("./uiStore.js");
    journeyStore.getState().setJourney("free");
    journeyStore.getState().setGuidedStep(1);
    journeyStore.getState().setJourney("guided");
    ui.closeGuidedControl();
    ui.setGuidedControlContext(false);
    return { appStore, journeyStore, ...ui };
  }

  afterEach(async () => {
    const { journeyStore } = await import("./appStore.js");
    journeyStore.getState().setJourney("free");
  });

  it("goToGuidedStep : étape vue, vue conseillée et mode du plan, liste fermée", async () => {
    const { appStore, journeyStore, uiStore, goToGuidedStep, openGuidedControl } = await guided();
    appStore.getState().select({ location: { kind: "tread", number: 2 } });
    const { project, history, selection } = appStore.getState();
    openGuidedControl();
    goToGuidedStep(3);
    expect(journeyStore.getState()).toMatchObject({ guidedStep: 3, workspace: "design" });
    expect(journeyStore.getState().visitedSteps.has(3)).toBe(true);
    expect(appStore.getState().view).toBe("elevation");
    expect(uiStore.getState().guidedControlOpen).toBe(false);
    goToGuidedStep(1);
    expect(appStore.getState()).toMatchObject({ view: "plan", planMode: "site" });
    goToGuidedStep(2);
    expect(appStore.getState()).toMatchObject({ view: "plan", planMode: "drawing" });
    goToGuidedStep(7);
    expect(journeyStore.getState().workspace).toBe("fabrication");
    expect(appStore.getState().view).toBe("flat");
    goToGuidedStep(5);
    expect(journeyStore.getState().workspace).toBe("design");
    expect(appStore.getState().view).toBe("3d");
    // Projet, historique et sélection inchangés.
    expect(appStore.getState().project).toBe(project);
    expect(appStore.getState().history).toBe(history);
    expect(appStore.getState().selection).toBe(selection);
  });

  it("étape 7, onglet 3D : la bascule Guidé ↔ Libre ne change pas la vue active", async () => {
    const { appStore, journeyStore, goToGuidedStep } = await guided();
    goToGuidedStep(7);
    expect(appStore.getState().view).toBe("flat");
    appStore.getState().setView("3d");
    journeyStore.getState().setJourney("free");
    expect(appStore.getState().view).toBe("3d");
    expect(journeyStore.getState()).toMatchObject({ journey: "free", workspace: "design" });
    journeyStore.getState().setJourney("guided");
    expect(appStore.getState().view).toBe("3d");
    expect(journeyStore.getState()).toMatchObject({ journey: "guided", guidedStep: 7 });
    // Cas ordinaire (onglet Pièces) : Fabrication à l'aller, vue gardée elle aussi.
    appStore.getState().setView("flat");
    journeyStore.getState().setJourney("free");
    expect(appStore.getState().view).toBe("flat");
    expect(journeyStore.getState().workspace).toBe("fabrication");
  });

  it("goToGuidedStep sur l'étape courante : sans effet (la vue choisie reste)", async () => {
    const { appStore, uiStore, goToGuidedStep, openGuidedControl } = await guided();
    goToGuidedStep(4);
    appStore.getState().setView("elevation");
    openGuidedControl();
    goToGuidedStep(4);
    expect(appStore.getState().view).toBe("elevation");
    expect(uiStore.getState().guidedControlOpen).toBe(true);
  });

  it("openSection : libre → panneau en Conception ; guidé → étape, Contexte → liste", async () => {
    const { journeyStore, uiStore, openSection } = await guided();
    journeyStore.getState().setJourney("free");
    journeyStore.getState().setWorkspace("fabrication");
    openSection("treads");
    expect(journeyStore.getState()).toMatchObject({ workspace: "design", freePanel: "treads" });

    journeyStore.getState().setJourney("guided");
    openSection("balancing");
    expect(journeyStore.getState()).toMatchObject({ journey: "guided", guidedStep: 2 });
    openSection("guards");
    expect(journeyStore.getState().guidedStep).toBe(6);
    openSection("compliance");
    expect(journeyStore.getState().guidedStep).toBe(6);
    expect(uiStore.getState()).toMatchObject({
      guidedControlOpen: true,
      guidedControlContext: true,
    });
  });

  it("openParam : étape du paramètre ; à défaut, libre avec le panneau de la section", async () => {
    const { journeyStore, uiStore, openParam, openGuidedControl } = await guided();
    openGuidedControl();
    openParam({ key: "guards.material", section: "guards", steps: [6] });
    expect(journeyStore.getState()).toMatchObject({ journey: "guided", guidedStep: 6 });
    expect(uiStore.getState().guidedControlOpen).toBe(false);
    openParam({ key: "guards.posts.size", section: "guards", steps: [] });
    expect(journeyStore.getState().guidedStep).toBe(7);
    // Réglage de Conception absent du guidé : passage en libre, panneau de la section.
    openParam({ key: "stair.balancing.rotationReach", section: "balancing", steps: [] });
    expect(journeyStore.getState()).toMatchObject({
      journey: "free",
      workspace: "design",
      freePanel: "balancing",
      freePanelFromGuided: false,
    });
    // Libre : panneau de la section, en Conception.
    journeyStore.getState().setWorkspace("fabrication");
    openParam({ key: "guards.material", section: "guards", steps: [6] });
    expect(journeyStore.getState()).toMatchObject({ workspace: "design", freePanel: "guards" });
  });

  it("switchWorkspace, revealControl et revealOverrides en guidé", async () => {
    const g = await guided();
    const { appStore, journeyStore, uiStore } = g;
    g.goToGuidedStep(3);
    g.switchWorkspace("design");
    expect(journeyStore.getState()).toMatchObject({ guidedStep: 3, workspace: "design" });
    g.switchWorkspace("fabrication");
    expect(journeyStore.getState()).toMatchObject({ guidedStep: 7, workspace: "fabrication" });
    expect(appStore.getState().view).toBe("flat");
    const { project, history } = appStore.getState();
    for (const reveal of [g.revealControl, g.revealOverrides]) {
      g.closeGuidedControl();
      appStore.getState().select({ location: { kind: "tread", number: 1 } });
      const before = uiStore.getState();
      reveal();
      // Pas de retour en Conception : l'étape reste, la liste du contrôle s'ouvre.
      expect(journeyStore.getState()).toMatchObject({ guidedStep: 7, workspace: "fabrication" });
      expect(appStore.getState().selection).toBeNull();
      const after = uiStore.getState();
      expect(after.guidedControlOpen).toBe(true);
      expect(after.controlRevealSeq + after.overridesRevealSeq).toBe(
        before.controlRevealSeq + before.overridesRevealSeq + 1,
      );
    }
    expect(appStore.getState().project).toBe(project);
    expect(appStore.getState().history).toBe(history);
    g.setGuidedControlContext(true);
    expect(uiStore.getState().guidedControlContext).toBe(true);
    g.setGuidedControlContext(false);
    expect(uiStore.getState().guidedControlContext).toBe(false);
  });

  it("bascule guidé ↔ libre : panneau de l'étape, puis étape du panneau ; rien d'autre ne change", async () => {
    const { appStore, journeyStore, goToGuidedStep } = await guided();
    appStore.getState().setField(["site", "floorToFloor"], 2750);
    const { project, history } = appStore.getState();
    goToGuidedStep(2);
    const view = appStore.getState().view;
    journeyStore.getState().setJourney("free");
    expect(journeyStore.getState()).toMatchObject({
      journey: "free",
      freePanel: "layout",
      freePanelFromGuided: true,
    });
    expect(appStore.getState().view).toBe(view);
    journeyStore.getState().openFreePanel("treads");
    journeyStore.getState().setJourney("guided");
    expect(journeyStore.getState()).toMatchObject({ journey: "guided", guidedStep: 4 });
    expect(appStore.getState().view).toBe(view);
    expect(appStore.getState().project).toBe(project);
    expect(appStore.getState().history).toBe(history);
    appStore.getState().undo();
  });
});

describe("tiroir de l'inspecteur (fenêtre moyenne, vague 6)", () => {
  it("lié à la sélection : ouvert par une sélection, fermé par son effacement", () => {
    const app = createProjectStore();
    const ui = createUiStore();
    const unlink = linkDrawerToSelection(app, ui);
    expect(ui.getState().inspectorDrawerOpen).toBe(false);
    app.getState().select({ location: { kind: "tread", number: 2 } });
    expect(ui.getState().inspectorDrawerOpen).toBe(true);
    // Fermé à la main : la sélection reste.
    ui.setState({ inspectorDrawerOpen: false });
    expect(app.getState().selection).not.toBeNull();
    // Nouvelle sélection : rouvert.
    app.getState().select({ location: { kind: "tread", number: 3 } });
    expect(ui.getState().inspectorDrawerOpen).toBe(true);
    app.getState().select(null);
    expect(ui.getState().inspectorDrawerOpen).toBe(false);
    unlink();
    app.getState().select({ location: { kind: "tread", number: 3 } });
    expect(ui.getState().inspectorDrawerOpen).toBe(false);
  });

  it("badge Contrôle et lien des surcharges : tiroir ouvert sur la 2d ; fermeture sans toucher à la sélection", async () => {
    const { appStore, journeyStore } = await import("./appStore.js");
    const ui = await import("./uiStore.js");
    journeyStore.getState().setJourney("free");
    journeyStore.getState().setWorkspace("design");
    ui.closeInspectorDrawer();
    appStore.getState().select({ location: { kind: "tread", number: 2 } });
    expect(ui.uiStore.getState().inspectorDrawerOpen).toBe(true);
    ui.closeInspectorDrawer({ restoreFocus: true });
    expect(ui.uiStore.getState().inspectorDrawerOpen).toBe(false);
    expect(appStore.getState().selection).not.toBeNull();
    ui.revealControl();
    expect(appStore.getState().selection).toBeNull();
    expect(ui.uiStore.getState().inspectorDrawerOpen).toBe(true);
    ui.closeInspectorDrawer();
    ui.revealOverrides();
    expect(ui.uiStore.getState().inspectorDrawerOpen).toBe(true);
    ui.closeInspectorDrawer();
    ui.openInspectorDrawer();
    expect(ui.uiStore.getState().inspectorDrawerOpen).toBe(true);
    ui.closeInspectorDrawer();
  });

  it("guidé : le badge ouvre la liste du contrôle, pas le tiroir", async () => {
    const { journeyStore } = await import("./appStore.js");
    const ui = await import("./uiStore.js");
    journeyStore.getState().setJourney("guided");
    ui.closeInspectorDrawer();
    ui.revealControl();
    expect(ui.uiStore.getState().guidedControlOpen).toBe(true);
    expect(ui.uiStore.getState().inspectorDrawerOpen).toBe(false);
    ui.closeGuidedControl();
    journeyStore.getState().setJourney("free");
  });

  it("guidé imposé : openParam d'un paramètre hors du guidé ne quitte pas le guidé", async () => {
    const { journeyStore } = await import("./appStore.js");
    const ui = await import("./uiStore.js");
    journeyStore.getState().setJourney("guided");
    journeyStore.getState().setNarrowViewport(true);
    const before = journeyStore.getState();
    ui.openParam({ key: "stair.unknown", section: "compliance", steps: [] });
    expect(journeyStore.getState()).toMatchObject({
      journey: "guided",
      workspace: before.workspace,
      freePanel: before.freePanel,
    });
    journeyStore.getState().setNarrowViewport(false);
    journeyStore.getState().setJourney("free");
  });
});
