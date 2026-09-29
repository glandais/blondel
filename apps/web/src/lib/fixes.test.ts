import { ProjectSchema, buildModel, createProject, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { createProjectStore } from "../store/projectStore.js";
import { applyFix, fixesFor } from "./fixes.js";

const withStructure = (p: Project, kind: string): Project =>
  ProjectSchema.parse({ ...p, stair: { ...p.stair, structure: { kind, params: {} } } });

describe("corrections proposées", () => {
  const project = withStructure(createProject("quarter-left"), "wood-housed");

  it("jour à angle vif sous des limons à la française : passer en poteau, annulable", () => {
    const model = buildModel(project);
    const fixes = fixesFor(project, model);
    const fix = fixes.find((f) => f.id === "jour-newel");
    expect(fix).toBeDefined();
    expect(fix!.label).toMatch(/poteau/);
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
