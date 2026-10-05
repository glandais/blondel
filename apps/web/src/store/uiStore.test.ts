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
