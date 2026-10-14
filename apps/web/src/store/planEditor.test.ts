import cage60Text from "../../../../examples/cage-60.blondel.json?raw";
import {
  buildModel,
  createProject,
  parseProjectText,
  type Model,
  type Project,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAN_EDITOR,
  PLAN_TOOL_AVAILABLE,
  planSelectionExists,
  prunePlanSelection,
  samePlanSelection,
  withPlanSelection,
  withPlanTool,
  type PlanEditorState,
  type PlanEditorTool,
  type PlanSelection,
} from "./planEditor.js";

const TOOLS = Object.keys(PLAN_TOOL_AVAILABLE) as PlanEditorTool[];

/** Générateur de sélections (indices et identifiants contraints). */
const arbSelection: fc.Arbitrary<PlanSelection> = fc.oneof(
  fc.constant({ kind: "stair" } as const),
  fc.constant({ kind: "opening" } as const),
  fc.constant({ kind: "room" } as const),
  fc.record({ kind: fc.constant("section" as const), index: fc.nat(20) }),
  fc.record({ kind: fc.constant("junction" as const), index: fc.nat(20) }),
  fc.record({ kind: fc.constant("openingVertex" as const), index: fc.nat(20) }),
  fc.record({ kind: fc.constant("roomVertex" as const), index: fc.nat(20) }),
  fc.record({ kind: fc.constant("wall" as const), id: fc.string({ minLength: 1, maxLength: 6 }) }),
  fc.record({
    kind: fc.constant("obstacle" as const),
    id: fc.string({ minLength: 1, maxLength: 6 }),
  }),
  fc.record({
    kind: fc.constant("wallEnd" as const),
    id: fc.string({ minLength: 1, maxLength: 6 }),
    end: fc.constantFrom("a" as const, "b" as const),
  }),
);

const arbState: fc.Arbitrary<PlanEditorState> = fc.record({
  planTool: fc.constantFrom(...TOOLS),
  planSelection: fc.option(arbSelection, { nil: null }),
});

describe("outil et sélection de l'éditeur de plan (réducteurs)", () => {
  it("état initial : outil de sélection, rien de sélectionné", () => {
    expect(INITIAL_PLAN_EDITOR).toEqual({ planTool: "select", planSelection: null });
  });

  it("contour de pièce et obstacles disponibles (sous-lot 5b)", () => {
    expect(PLAN_TOOL_AVAILABLE.room).toBe(true);
    expect(PLAN_TOOL_AVAILABLE.obstacle).toBe(true);
    expect(withPlanTool(INITIAL_PLAN_EDITOR, "room")).toEqual({
      planTool: "room",
      planSelection: null,
    });
    const sel = withPlanSelection(INITIAL_PLAN_EDITOR, { kind: "obstacle", id: "obstacle-1" });
    expect(withPlanTool(sel, "obstacle")).toEqual({ planTool: "obstacle", planSelection: null });
  });

  it("sélection, clic sur le même élément sans effet, désélection", () => {
    const a = withPlanSelection(INITIAL_PLAN_EDITOR, { kind: "section", index: 1 });
    expect(a.planSelection).toEqual({ kind: "section", index: 1 });
    expect(withPlanSelection(a, { kind: "section", index: 1 })).toBe(a);
    const b = withPlanSelection(a, { kind: "junction", index: 0 });
    expect(b.planSelection).toEqual({ kind: "junction", index: 0 });
    expect(withPlanSelection(b, null).planSelection).toBeNull();
  });

  it("un outil de tracé efface la sélection et refuse d'en poser une", () => {
    const a = withPlanSelection(INITIAL_PLAN_EDITOR, { kind: "wall", id: "m1" });
    const w = withPlanTool(a, "wall");
    expect(w).toEqual({ planTool: "wall", planSelection: null });
    expect(withPlanSelection(w, { kind: "stair" })).toBe(w);
    expect(withPlanTool(w, "select")).toEqual(INITIAL_PLAN_EDITOR);
  });

  it("propriétés : outil toujours disponible, sélection seulement dans l'outil de sélection", () => {
    fc.assert(
      fc.property(
        arbState.filter((s) => s.planTool === "select" || s.planSelection === null),
        fc.array(
          fc.oneof(
            fc.record({ tool: fc.constantFrom(...TOOLS) }),
            fc.record({ sel: fc.option(arbSelection, { nil: null }) }),
          ),
          { maxLength: 12 },
        ),
        (start, actions) => {
          let s = PLAN_TOOL_AVAILABLE[start.planTool] ? start : INITIAL_PLAN_EDITOR;
          for (const a of actions) {
            s = "tool" in a ? withPlanTool(s, a.tool) : withPlanSelection(s, a.sel);
            expect(PLAN_TOOL_AVAILABLE[s.planTool]).toBe(true);
            if (s.planTool !== "select") expect(s.planSelection).toBeNull();
          }
        },
      ),
    );
  });

  it("samePlanSelection est une égalité de valeur", () => {
    fc.assert(
      fc.property(arbSelection, arbSelection, (a, b) => {
        expect(samePlanSelection(a, { ...a })).toBe(true);
        expect(samePlanSelection(a, b)).toBe(JSON.stringify(a) === JSON.stringify(b));
        expect(samePlanSelection(a, null)).toBe(false);
      }),
    );
    expect(samePlanSelection(null, null)).toBe(true);
  });
});

describe("existence de l'élément sélectionné (cage-60)", () => {
  const project: Project = parseProjectText(cage60Text);
  const model: Model = buildModel(project);
  const withWall: Project = {
    ...project,
    site: {
      ...project.site,
      walls: [
        { id: "m1", a: { x: 0, y: 0 }, b: { x: 0, y: 1000 }, thickness: 200, loadBearing: false },
      ],
    },
  };

  it("tronçons et jonctions lus dans le modèle", () => {
    expect(model.layout.sections).toHaveLength(2);
    expect(planSelectionExists({ kind: "section", index: 1 }, project, model)).toBe(true);
    expect(planSelectionExists({ kind: "section", index: 2 }, project, model)).toBe(false);
    expect(planSelectionExists({ kind: "junction", index: 0 }, project, model)).toBe(true);
    expect(planSelectionExists({ kind: "junction", index: 1 }, project, model)).toBe(false);
    expect(planSelectionExists({ kind: "stair" }, project, model)).toBe(true);
    expect(planSelectionExists({ kind: "section", index: 0 }, project, null)).toBe(false);
  });

  it("hélicoïdal (moteur de cage, F10 P2) : son tronçon en arc n'est pas sélectionnable", () => {
    const helical = createProject("helical");
    const mh = buildModel(helical);
    expect(mh.layout.sections).toHaveLength(1);
    expect(planSelectionExists({ kind: "section", index: 0 }, helical, mh)).toBe(false);
    expect(planSelectionExists({ kind: "stair" }, helical, mh)).toBe(true);
  });

  it("murs, extrémités, trémie, pièce et obstacles lus dans le site", () => {
    expect(planSelectionExists({ kind: "wall", id: "m1" }, withWall, model)).toBe(true);
    expect(planSelectionExists({ kind: "wallEnd", id: "m1", end: "b" }, withWall, model)).toBe(
      true,
    );
    expect(planSelectionExists({ kind: "wall", id: "m2" }, withWall, model)).toBe(false);
    // cage-60 : trémie rectangulaire (4 sommets, indices 0 à 3).
    expect(project.site.opening?.kind).toBe("rect");
    expect(planSelectionExists({ kind: "opening" }, project, model)).toBe(true);
    expect(planSelectionExists({ kind: "openingVertex", index: 3 }, project, model)).toBe(true);
    expect(planSelectionExists({ kind: "openingVertex", index: 4 }, project, model)).toBe(false);
    expect(planSelectionExists({ kind: "openingVertex", index: -1 }, project, model)).toBe(false);
    const { opening: _opening, ...siteWithout } = project.site;
    const noOpening: Project = { ...project, site: siteWithout };
    expect(planSelectionExists({ kind: "opening" }, noOpening, model)).toBe(false);
    expect(planSelectionExists({ kind: "openingVertex", index: 0 }, noOpening, model)).toBe(false);
    expect(planSelectionExists({ kind: "roomVertex", index: 0 }, project, model)).toBe(false);
    expect(planSelectionExists({ kind: "room" }, project, model)).toBe(false);
    expect(planSelectionExists({ kind: "obstacle", id: "o1" }, project, model)).toBe(false);
    const withRoom: Project = {
      ...project,
      site: {
        ...project.site,
        room: {
          points: [
            { x: -3000, y: -1000 },
            { x: 2000, y: -1000 },
            { x: 2000, y: 5000 },
          ],
        },
      },
    };
    expect(planSelectionExists({ kind: "room" }, withRoom, model)).toBe(true);
    expect(planSelectionExists({ kind: "roomVertex", index: 2 }, withRoom, model)).toBe(true);
    expect(planSelectionExists({ kind: "roomVertex", index: 3 }, withRoom, model)).toBe(false);
  });

  it("prune : sélection d'un mur retiré effacée, sélection valide gardée telle quelle", () => {
    const s = withPlanSelection(INITIAL_PLAN_EDITOR, { kind: "wall", id: "m1" });
    expect(prunePlanSelection(s, withWall, model)).toBe(s);
    expect(prunePlanSelection(s, project, model).planSelection).toBeNull();
    expect(prunePlanSelection(INITIAL_PLAN_EDITOR, project, model)).toBe(INITIAL_PLAN_EDITOR);
  });
});
