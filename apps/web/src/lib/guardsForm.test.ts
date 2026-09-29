import {
  GUARD_MATERIALS,
  GuardInfillSchema,
  GuardSectionSchema,
  createProject,
  type GuardInfill,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createProjectStore } from "../store/projectStore.js";
import {
  GUARD_MATERIAL_OPTIONS,
  INFILL_KINDS,
  INFILL_LABELS,
  defaultGuards,
  infillHasSection,
  infillIsPanel,
  sectionLabel,
  switchInfill,
  switchSection,
} from "./guardsForm.js";

describe("panneau Garde-corps", () => {
  it("activation : défauts du cœur, projet valide, garde-corps générés ; désactivation annulable", () => {
    const store = createProjectStore({ initialProject: createProject("straight") });
    expect(store.getState().project.guards).toBeUndefined();
    expect(store.getState().setField(["guards"], defaultGuards()).ok).toBe(true);
    const g = store.getState().project.guards!;
    expect(g.flight.enabled).toBe(true);
    expect(g.infill.kind).toBe("balusters");
    expect(store.getState().setField(["guards", "flight", "inner"], "wall").ok).toBe(true);
    expect(store.getState().setField(["guards", "flight", "height"], 0).ok).toBe(false);
    expect(store.getState().setField(["guards"], undefined).ok).toBe(true);
    expect(store.getState().project.guards).toBeUndefined();
    store.getState().undo();
    expect(store.getState().project.guards?.flight.inner).toBe("wall");
  });

  it("changement de remplissage : défauts du type, vide inférieur conservé, toujours valide", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...INFILL_KINDS),
        fc.constantFrom(...INFILL_KINDS),
        fc.integer({ min: 0, max: 300 }),
        (from, to, gap) => {
          const cur = GuardInfillSchema.parse({ kind: from, bottomGap: gap }) as GuardInfill;
          const next = switchInfill(cur, to);
          expect(next.kind).toBe(to);
          expect(next.bottomGap).toBe(gap);
          expect(GuardInfillSchema.safeParse(next).success).toBe(true);
          if (from === to) expect(next).toBe(cur);
        },
      ),
    );
    for (const k of INFILL_KINDS) expect(INFILL_LABELS[k]).toBeTruthy();
  });

  it("changement de forme de section : dimension principale conservée", () => {
    const round = { kind: "round", diameter: 42 } as const;
    const rect = switchSection(round, "rect");
    expect(rect).toEqual({ kind: "rect", width: 42, height: 42 });
    expect(switchSection(rect, "round")).toEqual(round);
    expect(switchSection(round, "round")).toBe(round);
    expect(GuardSectionSchema.safeParse(rect).success).toBe(true);
    expect(sectionLabel(round)).toBe("Ø 42");
    expect(sectionLabel({ kind: "rect", width: 40, height: 30 })).toBe("40 × 30");
  });

  it("classes de remplissage et matériaux du cœur", () => {
    const g = defaultGuards();
    expect(infillHasSection(g.infill)).toBe(true);
    expect(infillIsPanel(switchInfill(g.infill, "glass"))).toBe(true);
    expect(infillIsPanel(switchInfill(g.infill, "cables"))).toBe(false);
    expect(GUARD_MATERIAL_OPTIONS.map((o) => o.value)).toEqual([...GUARD_MATERIALS]);
    expect(GUARD_MATERIAL_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
