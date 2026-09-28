import fc from "fast-check";
import { PRESET_IDS, ProjectSchema, createProject, resolveLegLengths } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { createProjectStore } from "../store/projectStore.js";
import { DEFAULT_NEW_TURN, addLeg, legAutoAllowed, removeLastLeg } from "./layoutEdit.js";

describe("ajout et retrait de volées", () => {
  it("résout une longueur auto avant d'ajouter une volée (auto interdit à plusieurs volées)", () => {
    const straight = createProject("straight");
    const auto = {
      ...straight,
      stair: {
        ...straight.stair,
        layout: { ...straight.stair.layout, legs: [{ length: "auto" as const }] },
      },
    };
    const expected = Math.round(resolveLegLengths(auto)[0] as number);
    const p = addLeg(auto);
    // Avant correction : deux volées « auto », refusées par le tracé du cœur (LayoutError).
    expect(p.stair.layout.legs).toEqual([{ length: expected }, { length: expected }]);
    expect(p.stair.layout.turns).toEqual([DEFAULT_NEW_TURN]);
    expect(() => resolveLegLengths(p)).not.toThrow();
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });

  it("n'autorise le mode auto que pour une seule volée", () => {
    expect(legAutoAllowed(1)).toBe(true);
    expect(legAutoAllowed(2)).toBe(false);
    expect(legAutoAllowed(3)).toBe(false);
  });

  it("ne retire pas l'unique volée d'un escalier droit", () => {
    const p = createProject("straight");
    expect(removeLastLeg(p)).toBe(p);
  });

  it("propriété : ajouter puis retirer une volée rend le tracé initial, N volées ↔ N−1 tournants", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESET_IDS),
        fc.integer({ min: 2200, max: 3500 }),
        fc.integer({ min: 700, max: 1200 }),
        (id, H, E) => {
          let p;
          try {
            p = createProject(id, { floorToFloor: H, width: E });
          } catch {
            return true; // combinaison refusée par le cœur
          }
          const q = addLeg(p);
          const l = q.stair.layout;
          const r = removeLastLeg(q);
          return (
            l.legs.length === p.stair.layout.legs.length + 1 &&
            l.turns.length === l.legs.length - 1 &&
            ProjectSchema.safeParse(q).success &&
            JSON.stringify(r.stair.layout) === JSON.stringify(p.stair.layout)
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  it("dans le store : une seule entrée d'historique, annulable", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    expect(s.getState().update(addLeg).ok).toBe(true);
    expect(s.getState().project.stair.layout.legs).toHaveLength(2);
    s.getState().undo();
    expect(s.getState().project).toBe(p0);
  });
});
