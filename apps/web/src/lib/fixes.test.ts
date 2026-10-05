import {
  ProjectSchema,
  buildModel,
  createProject,
  type FixSuggestion,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { textMessage, translatorFor } from "@blondel/i18n";
import { appStore } from "../store/appStore.js";
import { createProjectStore } from "../store/projectStore.js";
import { applyFix, applyFixInStore, fixesFor, fixesForRule } from "./fixes.js";

const withStructure = (p: Project, kind: string): Project =>
  ProjectSchema.parse({ ...p, stair: { ...p.stair, structure: { kind, params: {} } } });

describe("corrections proposées", () => {
  const project = withStructure(createProject("quarter-left"), "wood-housed");

  it("jour à angle vif sous des limons à la française : passer en poteau, annulable", () => {
    const model = buildModel(project);
    const fixes = fixesFor(project, model);
    const fix = fixes.find((f) => f.id === "jour-newel");
    expect(fix).toBeDefined();
    expect(translatorFor("fr").t(fix!.label)).toMatch(/poteau/);
    const fixed = applyFix(project, fix!);
    expect(fixed.stair.layout.turns[0]!.inner.kind).toBe("newel");
    // Plus de correction « jour » une fois appliquée.
    expect(fixesFor(fixed, buildModel(fixed)).some((f) => f.id === "jour-newel")).toBe(false);

    const store = createProjectStore({ initialProject: project });
    expect(store.getState().update((p) => applyFix(p, fix!)).ok).toBe(true);
    expect(store.getState().project.stair.layout.turns[0]!.inner.kind).toBe("newel");
    expect(store.getState().canUndo()).toBe(true);
    store.getState().undo();
    expect(store.getState().project).toBe(project);
  });

  it("aucun modèle ou modèle sans problème : pas d'exception", () => {
    expect(fixesFor(project, null).map((f) => f.id)).toEqual(["jour-newel"]);
    const straight = createProject("straight");
    expect(fixesFor(straight, buildModel(straight))).toEqual([]);
    // Modèle incohérent : liste vide plutôt qu'une exception.
    expect(fixesFor(project, { compliance: null } as never)).toEqual([]);
  });

  it("patch invalide : refusé par le schéma (le store garde le projet)", () => {
    const store = createProjectStore({ initialProject: project });
    const bad = { patch: { site: { floorToFloor: -5 } } };
    const r = store.getState().update((p) => applyFix(p, bad));
    expect(r.ok).toBe(false);
    expect(store.getState().project).toBe(project);
  });
});

describe("corrections d'une règle (inspecteur Règle)", () => {
  const fix = (id: FixSuggestion["id"], ruleIds?: readonly string[]): FixSuggestion => ({
    id,
    label: textMessage(id),
    reason: textMessage(id),
    patch: {},
    ...(ruleIds ? { ruleIds } : {}),
  });

  it("filtre sur FixSuggestion.ruleIds ; sans ruleIds : aucune règle", () => {
    const fixes = [
      fix("opening-clearance", ["GC_CONFLIT_DALLE"]),
      fix("jour-newel"),
      fix("jour-wall", ["GC_CONFLIT_DALLE", "GC_POTEAUX_JOUR"]),
    ];
    expect(fixesForRule(fixes, "GC_CONFLIT_DALLE").map((f) => f.id)).toEqual([
      "opening-clearance",
      "jour-wall",
    ]);
    expect(fixesForRule(fixes, "GC_POTEAUX_JOUR").map((f) => f.id)).toEqual(["jour-wall"]);
    expect(fixesForRule(fixes, "G_MIN_DTU")).toEqual([]);
    expect(fixesForRule([], "G_MIN_DTU")).toEqual([]);
  });

  it("trémie au nu : la correction « opening-clearance » vise GC_CONFLIT_DALLE (cœur)", () => {
    const p = ProjectSchema.parse({
      ...createProject("quarter-left", { openingClearance: 0 }),
      guards: {},
    });
    const model = buildModel(p);
    const fixes = fixesFor(p, model);
    const opening = fixes.find((f) => f.id === "opening-clearance");
    expect(opening).toBeDefined();
    // Contrat du cœur (`ruleIds`, tâche core-exposure) : tant qu'il n'est pas rempli, la
    // correction n'est rattachée à aucune règle.
    if (opening!.ruleIds !== undefined) {
      expect(fixesForRule(fixes, "GC_CONFLIT_DALLE").map((f) => f.id)).toContain(
        "opening-clearance",
      );
    }
  });

  it("application dans le store de l'application : annulable, motif d'un refus", () => {
    const before = appStore.getState().project;
    const p = withStructure(createProject("quarter-left"), "wood-housed");
    appStore.getState().replaceProject(p);
    const loaded = appStore.getState().project;
    const jour = fixesFor(loaded, buildModel(loaded)).find((f) => f.id === "jour-newel")!;
    expect(applyFixInStore(jour)).toBeNull();
    expect(appStore.getState().project.stair.layout.turns[0]!.inner.kind).toBe("newel");
    expect(translatorFor("fr").t(appStore.getState().notice!.msg)).toMatch(/^Correction appliquée/);
    appStore.getState().undo();
    expect(appStore.getState().project).toBe(loaded);
    const refused = applyFixInStore({ ...jour, patch: { site: { floorToFloor: -5 } } });
    expect(refused).not.toBeNull();
    expect(appStore.getState().project).toBe(loaded);
    appStore.getState().replaceProject(before);
  });
});
