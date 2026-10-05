import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ProjectOrigin } from "../store/projectStore.js";
import {
  DEFAULT_JOURNEY_PREFS,
  STEP_SECTIONS,
  goToStep,
  initialJourney,
  isStepChecked,
  journeyAfterOpening,
  panelAfter,
  panelForStep,
  parsePrefs,
  recommendedView,
  serializePrefs,
  stepForPanel,
  stepWorkspace,
  switchJourney,
  type JourneyPrefs,
  type PanelEvent,
} from "./journey.js";
import { GUIDED_STEPS, SECTION_IDS, type GuidedStep, type SectionId } from "./sectionIds.js";

const ORIGINS: readonly ProjectOrigin[] = ["demo", "assistant", "import", "restore", "preset"];

const stepArb = fc.constantFrom<GuidedStep>(...GUIDED_STEPS);
const sectionArb = fc.constantFrom<SectionId>(...SECTION_IDS);
const prefsArb: fc.Arbitrary<JourneyPrefs> = fc.record({
  journey: fc.constantFrom("guided" as const, "free" as const),
  guidedStep: stepArb,
  visitedSteps: fc.uniqueArray(stepArb).map((a) => new Set(a)),
  freePanel: fc.option(sectionArb, { nil: null }),
  freePanelPinned: fc.boolean(),
  workspace: fc.constantFrom("design" as const, "fabrication" as const),
  hintFreeJourneyDismissed: fc.boolean(),
});
const eventArb: fc.Arbitrary<PanelEvent> = fc.oneof(
  sectionArb.map((section) => ({ type: "rail" as const, section })),
  fc.constant({ type: "escape" as const }),
  fc.constant({ type: "close" as const }),
  fc.constant({ type: "outside" as const }),
  fc.boolean().map((pinned) => ({ type: "pin" as const, pinned })),
);

describe("parcours à l'ouverture (README § Comportements)", () => {
  it("première visite → guidé ; projet repris → libre ; ensuite dernier choix", () => {
    expect(initialJourney({ remembered: null, hasAutosave: false })).toBe("guided");
    expect(initialJourney({ remembered: null, hasAutosave: true })).toBe("free");
    expect(initialJourney({ remembered: "guided", hasAutosave: true })).toBe("guided");
    expect(initialJourney({ remembered: "free", hasAutosave: false })).toBe("free");
  });

  it("démo et assistant → guidé à l'étape 1 ; import et reprise → libre ; préréglage → inchangé", () => {
    const prefs: JourneyPrefs = {
      ...DEFAULT_JOURNEY_PREFS,
      journey: "free",
      guidedStep: 4,
      visitedSteps: new Set([1, 2, 3, 4]),
      freePanel: "structure",
      freePanelPinned: true,
      workspace: "fabrication",
    };
    expect(journeyAfterOpening("demo", prefs)).toMatchObject({ journey: "guided", guidedStep: 1 });
    expect(journeyAfterOpening("assistant", prefs)).toMatchObject({
      journey: "guided",
      guidedStep: 1,
    });
    const guided = { ...prefs, journey: "guided" as const };
    expect(journeyAfterOpening("import", guided).journey).toBe("free");
    expect(journeyAfterOpening("restore", guided).journey).toBe("free");
    expect(journeyAfterOpening("preset", guided)).toMatchObject({
      journey: "guided",
      guidedStep: 4,
    });
    expect(journeyAfterOpening("preset", prefs).journey).toBe("free");
    for (const origin of ORIGINS) {
      const r = journeyAfterOpening(origin, prefs);
      expect(r.visitedSteps.size).toBe(0);
      expect(r.workspace).toBe("design");
      expect(r.freePanel).toBe("structure");
      expect(r.freePanelPinned).toBe(true);
      expect(r.hintFreeJourneyDismissed).toBe(prefs.hintFreeJourneyDismissed);
    }
  });
});

describe("correspondances étape ↔ panneau et vue conseillée", () => {
  it("table des sections par étape", () => {
    expect(STEP_SECTIONS).toEqual({
      1: ["site"],
      2: ["layout", "balancing"],
      3: ["stepping"],
      4: ["treads"],
      5: ["structure"],
      6: ["guards"],
      7: [],
    });
  });

  it("chaque section a au plus une étape ; le Contexte n'en a pas", () => {
    const expected: Record<SectionId, GuidedStep | null> = {
      site: 1,
      layout: 2,
      balancing: 2,
      stepping: 3,
      treads: 4,
      structure: 5,
      guards: 6,
      compliance: null,
    };
    for (const s of SECTION_IDS) expect(stepForPanel(s)).toBe(expected[s]);
  });

  it("panneau d'une étape : première section, aucun pour la Fabrication", () => {
    expect(GUIDED_STEPS.map(panelForStep)).toEqual([
      "site",
      "layout",
      "stepping",
      "treads",
      "structure",
      "guards",
      null,
    ]);
    for (const step of GUIDED_STEPS) {
      const panel = panelForStep(step);
      if (panel !== null) expect(stepForPanel(panel)).toBe(step);
    }
  });

  it("espace de travail : Fabrication à l'étape 7 seulement", () => {
    expect(GUIDED_STEPS.map(stepWorkspace)).toEqual([
      "design",
      "design",
      "design",
      "design",
      "design",
      "design",
      "fabrication",
    ]);
  });

  it("passage à une étape : étape vue, espace de l'étape", () => {
    const to7 = goToStep({ ...DEFAULT_JOURNEY_PREFS, guidedStep: 2 }, 7);
    expect(to7).toMatchObject({ guidedStep: 7, workspace: "fabrication" });
    expect([...to7.visitedSteps]).toContain(7);
    const back = goToStep(to7, 3);
    expect(back).toMatchObject({ guidedStep: 3, workspace: "design" });
    expect([...back.visitedSteps].sort()).toEqual([3, 7]);
  });

  it("vue conseillée", () => {
    expect(recommendedView(1)).toEqual({ view: "plan", planMode: "site" });
    expect(recommendedView(2)).toEqual({ view: "plan", planMode: "drawing" });
    expect(recommendedView(3)).toEqual({ view: "elevation" });
    for (const step of [4, 5, 6] as const) expect(recommendedView(step)).toEqual({ view: "3d" });
    expect(recommendedView(7)).toEqual({ view: "flat" });
  });
});

describe("panneau unique du parcours libre", () => {
  const closed = { freePanel: null, freePanelPinned: false };

  it("rail : ouvre, remplace, referme", () => {
    const a = panelAfter(closed, { type: "rail", section: "site" });
    expect(a.freePanel).toBe("site");
    const b = panelAfter(a, { type: "rail", section: "guards" });
    expect(b.freePanel).toBe("guards");
    expect(panelAfter(b, { type: "rail", section: "guards" }).freePanel).toBeNull();
  });

  it("Échap et croix ferment, même épinglé", () => {
    const pinned = { freePanel: "treads" as const, freePanelPinned: true };
    expect(panelAfter(pinned, { type: "escape" })).toEqual({
      freePanel: null,
      freePanelPinned: true,
    });
    expect(panelAfter(pinned, { type: "close" }).freePanel).toBeNull();
  });

  it("clic dans la vue : ferme seulement un panneau non épinglé", () => {
    const open = { freePanel: "treads" as const, freePanelPinned: false };
    expect(panelAfter(open, { type: "outside" }).freePanel).toBeNull();
    const pinned = panelAfter(open, { type: "pin", pinned: true });
    expect(pinned).toEqual({ freePanel: "treads", freePanelPinned: true });
    expect(panelAfter(pinned, { type: "outside" })).toBe(pinned);
    // Épinglé : le changement de section garde un panneau ouvert.
    expect(panelAfter(pinned, { type: "rail", section: "site" })).toEqual({
      freePanel: "site",
      freePanelPinned: true,
    });
  });

  it("propriété : au plus un panneau, toujours une section connue", () => {
    fc.assert(
      fc.property(fc.array(eventArb), (events) => {
        let s: { freePanel: SectionId | null; freePanelPinned: boolean } = closed;
        for (const e of events) {
          s = panelAfter(s, e);
          expect(s.freePanel === null || SECTION_IDS.includes(s.freePanel)).toBe(true);
          if (e.type === "escape" || e.type === "close") expect(s.freePanel).toBeNull();
        }
      }),
    );
  });
});

describe("bascule de parcours", () => {
  it("guidé → libre : section de l'étape en cours", () => {
    const p = { ...DEFAULT_JOURNEY_PREFS, guidedStep: 3 as const };
    expect(switchJourney(p, "free")).toMatchObject({
      journey: "free",
      freePanel: "stepping",
      workspace: "design",
    });
  });

  it("guidé → libre à l'étape 7 : mode Fabrication, panneau inchangé", () => {
    const p = { ...DEFAULT_JOURNEY_PREFS, guidedStep: 7 as const, freePanel: "site" as const };
    expect(switchJourney(p, "free")).toMatchObject({
      journey: "free",
      freePanel: "site",
      workspace: "fabrication",
    });
  });

  it("libre → guidé : étape du panneau ouvert, marquée vue", () => {
    const p: JourneyPrefs = {
      ...DEFAULT_JOURNEY_PREFS,
      journey: "free",
      guidedStep: 1,
      freePanel: "balancing",
    };
    const r = switchJourney(p, "guided");
    expect(r).toMatchObject({ journey: "guided", guidedStep: 2 });
    expect([...r.visitedSteps]).toEqual([2]);
  });

  it("libre → guidé : Fabrication → étape 7 ; Contexte ou aucun panneau → étape inchangée", () => {
    const base: JourneyPrefs = { ...DEFAULT_JOURNEY_PREFS, journey: "free", guidedStep: 5 };
    expect(
      switchJourney({ ...base, freePanel: "site", workspace: "fabrication" }, "guided").guidedStep,
    ).toBe(7);
    expect(switchJourney({ ...base, freePanel: "compliance" }, "guided").guidedStep).toBe(5);
    expect(switchJourney({ ...base, freePanel: null }, "guided").guidedStep).toBe(5);
  });

  it("même parcours : inchangé", () => {
    expect(switchJourney(DEFAULT_JOURNEY_PREFS, "guided")).toBe(DEFAULT_JOURNEY_PREFS);
  });

  it("aller-retour depuis le guidé : on retrouve l'étape", () => {
    fc.assert(
      fc.property(prefsArb, (p0) => {
        const p = { ...p0, journey: "guided" as const };
        const back = switchJourney(switchJourney(p, "free"), "guided");
        expect(back.journey).toBe("guided");
        expect(back.guidedStep).toBe(p.guidedStep);
        expect(back.visitedSteps.has(p.guidedStep)).toBe(true);
      }),
    );
  });
});

describe("étape cochée", () => {
  it("vue et sans règle bloquante", () => {
    expect(isStepChecked(2, new Set([1, 2]), 0)).toBe(true);
    expect(isStepChecked(2, new Set([1, 2]), 1)).toBe(false);
    expect(isStepChecked(3, new Set([1, 2]), 0)).toBe(false);
  });
});

describe("préférences mémorisées", () => {
  it("aller-retour sérialisation / lecture", () => {
    fc.assert(
      fc.property(prefsArb, (p) => {
        expect(parsePrefs(serializePrefs(p))).toEqual(p);
      }),
    );
  });

  it("étapes vues en tableau trié", () => {
    const text = serializePrefs({ ...DEFAULT_JOURNEY_PREFS, visitedSteps: new Set([5, 1, 3]) });
    expect(JSON.parse(text).visitedSteps).toEqual([1, 3, 5]);
  });

  it("entrées corrompues : champs ignorés, sans exception", () => {
    for (const text of [null, "", "{", "null", "42", '"guided"', "[]", "{}"]) {
      expect(parsePrefs(text)).toEqual({});
    }
    expect(
      parsePrefs(
        JSON.stringify({
          journey: "expert",
          guidedStep: 8,
          visitedSteps: [1, 9, "2", 3, null],
          freePanel: "nope",
          freePanelPinned: "yes",
          workspace: "garage",
          hintFreeJourneyDismissed: 1,
        }),
      ),
    ).toEqual({ visitedSteps: new Set([1, 3]) });
    expect(parsePrefs('{"freePanel":null,"guidedStep":4}')).toEqual({
      freePanel: null,
      guidedStep: 4,
    });
  });

  it("propriété : n'importe quel JSON est lu sans exception", () => {
    fc.assert(
      fc.property(fc.json(), (text) => {
        const r = parsePrefs(text);
        expect(typeof r).toBe("object");
      }),
    );
  });
});
