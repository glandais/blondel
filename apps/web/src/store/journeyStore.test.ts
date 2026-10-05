import { DEMO_PRESET_IDS, createProject, serializeProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { serializePrefs, DEFAULT_JOURNEY_PREFS } from "../lib/journey.js";
import { JOURNEY_KEY, createJourneyStore, linkJourneyToProject } from "./journeyStore.js";
import { memoryStorage, type StorageLike } from "./persistence.js";
import { createProjectStore } from "./projectStore.js";

/** Stockage qui lève à chaque accès (navigation privée, accès bloqué). */
const throwing: StorageLike = {
  getItem: () => {
    throw new Error("bloqué");
  },
  setItem: () => {
    throw new Error("bloqué");
  },
  removeItem: () => {
    throw new Error("bloqué");
  },
};

function stored(storage: ReturnType<typeof memoryStorage>): Record<string, unknown> {
  return JSON.parse(storage.data.get(JOURNEY_KEY) ?? "null") as Record<string, unknown>;
}

describe("store du parcours", () => {
  it("première visite → guidé, mémorisé tout de suite", () => {
    const storage = memoryStorage();
    const s = createJourneyStore(storage, { hasAutosave: false });
    expect(s.getState().journey).toBe("guided");
    expect(stored(storage).journey).toBe("guided");
    // Lancement suivant : le projet est repris, mais le dernier choix (guidé) l'emporte.
    expect(createJourneyStore(storage, { hasAutosave: true }).getState().journey).toBe("guided");
  });

  it("projet repris sans préférence → libre", () => {
    expect(createJourneyStore(memoryStorage(), { hasAutosave: true }).getState().journey).toBe(
      "free",
    );
  });

  it("relit les préférences mémorisées, ignore les valeurs corrompues", () => {
    const storage = memoryStorage({
      [JOURNEY_KEY]: JSON.stringify({
        journey: "free",
        guidedStep: 4,
        visitedSteps: [1, 2, 42],
        freePanel: "guards",
        freePanelPinned: true,
        workspace: "fabrication",
        hintFreeJourneyDismissed: "oui",
      }),
    });
    const st = createJourneyStore(storage, { hasAutosave: false }).getState();
    expect(st.journey).toBe("free");
    expect(st.guidedStep).toBe(4);
    expect([...st.visitedSteps]).toEqual([1, 2]);
    expect(st.freePanel).toBe("guards");
    expect(st.freePanelPinned).toBe(true);
    expect(st.workspace).toBe("fabrication");
    expect(st.hintFreeJourneyDismissed).toBe(false);
    expect(
      createJourneyStore(memoryStorage({ [JOURNEY_KEY]: "{oups" }), {
        hasAutosave: false,
      }).getState().journey,
    ).toBe("guided");
  });

  it("mémorise chaque changement", () => {
    const storage = memoryStorage();
    const s = createJourneyStore(storage, { hasAutosave: false });
    s.getState().setGuidedStep(3);
    expect(stored(storage)).toMatchObject({ guidedStep: 3, visitedSteps: [3] });
    s.getState().setJourney("free");
    expect(stored(storage)).toMatchObject({ journey: "free", freePanel: "stepping" });
    s.getState().panelEvent({ type: "pin", pinned: true });
    s.getState().panelEvent({ type: "outside" });
    expect(s.getState().freePanel).toBe("stepping");
    s.getState().panelEvent({ type: "escape" });
    expect(stored(storage)).toMatchObject({ freePanel: null, freePanelPinned: true });
    s.getState().openFreePanel("compliance");
    expect(s.getState().freePanel).toBe("compliance");
    s.getState().closeFreePanel();
    expect(s.getState().freePanel).toBeNull();
    s.getState().setFreePanelPinned(false);
    s.getState().setWorkspace("fabrication");
    s.getState().dismissFreeJourneyHint();
    s.getState().markStepVisited(6);
    expect(stored(storage)).toMatchObject({
      freePanelPinned: false,
      workspace: "fabrication",
      hintFreeJourneyDismissed: true,
      visitedSteps: [3, 6],
    });
    // Rien de plus : les préférences relues sont celles de l'état.
    const again = createJourneyStore(storage, { hasAutosave: true }).getState();
    expect(serializePrefs(again)).toBe(storage.data.get(JOURNEY_KEY));
  });

  it("stockage qui lève ou absent : valeurs par défaut, sans exception", () => {
    for (const storage of [throwing, undefined]) {
      const s = createJourneyStore(storage, { hasAutosave: false });
      expect(serializePrefs(s.getState())).toBe(serializePrefs(DEFAULT_JOURNEY_PREFS));
      s.getState().setJourney("free");
      expect(s.getState().journey).toBe("free");
    }
  });

  it("règle d'ouverture d'un projet", () => {
    const storage = memoryStorage();
    const s = createJourneyStore(storage, { hasAutosave: false });
    s.getState().setGuidedStep(5);
    s.getState().setWorkspace("fabrication");
    s.getState().applyOpening("import");
    expect(s.getState()).toMatchObject({ journey: "free", workspace: "design" });
    expect(s.getState().visitedSteps.size).toBe(0);
    s.getState().applyOpening("preset");
    expect(s.getState().journey).toBe("free");
    s.getState().applyOpening("assistant");
    expect(s.getState()).toMatchObject({ journey: "guided", guidedStep: 1 });
    expect(stored(storage)).toMatchObject({ journey: "guided", guidedStep: 1, visitedSteps: [] });
  });

  it("étape 7 ↔ espace Fabrication, quel que soit le chemin", () => {
    const s = createJourneyStore(memoryStorage(), { hasAutosave: false });
    s.getState().setGuidedStep(7);
    expect(s.getState().workspace).toBe("fabrication");
    s.getState().setGuidedStep(4);
    expect(s.getState().workspace).toBe("design");
  });
});

describe("liaison au projet chargé", () => {
  it("import → libre, démo → guidé à l'étape 1, préréglage → parcours inchangé", () => {
    const projects = createProjectStore();
    const journey = createJourneyStore(memoryStorage(), { hasAutosave: false });
    const unlink = linkJourneyToProject(projects, journey);
    journey.getState().setGuidedStep(4);
    expect(projects.getState().importText(serializeProject(createProject("straight"))).ok).toBe(
      true,
    );
    expect(journey.getState().journey).toBe("free");
    // Saisie et annuler : pas un chargement, le parcours ne bouge pas.
    journey.getState().setJourney("guided");
    journey.getState().setGuidedStep(3);
    projects.getState().setField(["site", "floorToFloor"], 2800);
    projects.getState().undo();
    expect(journey.getState()).toMatchObject({ journey: "guided", guidedStep: 3 });
    journey.getState().setJourney("free");
    expect(projects.getState().loadDemo(DEMO_PRESET_IDS[0]!).ok).toBe(true);
    expect(journey.getState()).toMatchObject({ journey: "guided", guidedStep: 1 });
    journey.getState().setJourney("free");
    expect(projects.getState().loadPreset("quarter-left").ok).toBe(true);
    expect(journey.getState().journey).toBe("free");
    // Désabonné : plus d'effet.
    unlink();
    projects.getState().loadDemo(DEMO_PRESET_IDS[0]!);
    expect(journey.getState().journey).toBe("free");
  });
});
