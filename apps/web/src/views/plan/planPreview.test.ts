import cage60Text from "../../../../../examples/cage-60.blondel.json?raw";
import {
  buildModel,
  buildPlanPreview,
  parseProjectText,
  setSectionLength,
  toLocal,
  toWorld,
  withPlacement,
  type Model,
  type Project,
  type SiteConflict,
  type Vec2,
} from "@blondel/core";
import { createTranslator, msg } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PreviewView } from "../../store/modelStore.js";
import {
  conflictAt,
  conflictSelection,
  conflictsAnnouncement,
  conflictText,
  movePoint,
  placementTransform,
  planDisplay,
} from "./planPreview.js";

const FR = createTranslator("fr");

type Placement = Project["stair"]["placement"];

/** Applique une transformation `matrix(a b c d e f)` SVG à un point. */
function applyMatrix(t: string, p: Vec2): Vec2 {
  const m = /^matrix\(([^)]*)\)$/.exec(t);
  if (!m) throw new Error(t);
  const [a, b, c, d, e, f] = m[1]!.split(" ").map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

const arbPlacement: fc.Arbitrary<Placement> = fc.record({
  origin: fc.record({
    x: fc.integer({ min: -5000, max: 5000 }),
    y: fc.integer({ min: -5000, max: 5000 }),
  }),
  rotation: fc.integer({ min: -360, max: 360 }),
});
const arbPoint = fc.record({
  x: fc.double({ min: -5000, max: 5000, noNaN: true }),
  y: fc.double({ min: -5000, max: 5000, noNaN: true }),
});

describe("report d'affichage d'un déplacement ou d'une rotation (niveau 1)", () => {
  it("placements égaux : aucune transformation", () => {
    const p: Placement = { origin: { x: 10, y: -20 }, rotation: 30 };
    expect(placementTransform(p, { ...p, origin: { ...p.origin } })).toBeNull();
  });

  it("translation pure", () => {
    const t = placementTransform(
      { origin: { x: 0, y: 0 }, rotation: 0 },
      { origin: { x: 120, y: -40 }, rotation: 0 },
    );
    expect(t).toBe("matrix(1 0 0 1 120 -40)");
  });

  it("propriété : la matrice SVG reporte un point comme le placement du cœur (toLocal puis toWorld)", () => {
    fc.assert(
      fc.property(arbPlacement, arbPlacement, arbPoint, (from, to, p) => {
        const expected = toWorld(toLocal(p, from), to);
        const viaMove = movePoint(p, from, to);
        expect(viaMove.x).toBeCloseTo(expected.x, 6);
        expect(viaMove.y).toBeCloseTo(expected.y, 6);
        const t = placementTransform(from, to);
        if (t === null) {
          expect(from).toEqual(to);
          return;
        }
        const q = applyMatrix(t, p);
        // Matrice arrondie à 1e-6 : écart ≤ 1e-6 × |p| + 1e-6.
        expect(Math.abs(q.x - expected.x)).toBeLessThan(0.02);
        expect(Math.abs(q.y - expected.y)).toBeLessThan(0.02);
      }),
    );
  });
});

describe("dessin de l'éditeur : modèle complet ou aperçu (niveau 2)", () => {
  const project = parseProjectText(cage60Text);
  const model = buildModel(project);
  const longer = setSectionLength(project, 1, 2100).project!;
  const preview: PreviewView = {
    project: longer,
    result: { ...buildPlanPreview(longer), timeMs: 1 },
  };

  it("sans aperçu : le modèle, sans report", () => {
    const d = planDisplay(model, project, null, project);
    expect(d.model).toBe(model);
    expect(d.source).toBe(project);
    expect(d.transform).toBeNull();
    expect(d.previewing).toBe(false);
  });

  it("avec aperçu : tracé, nez et conflits de l'aperçu ; le reste du modèle conservé", () => {
    const d = planDisplay(model, project, preview, longer);
    expect(d.previewing).toBe(true);
    expect(d.source).toBe(longer);
    expect(d.model.layout).toBe(preview.result.layout);
    expect(d.model.stepping).toBe(preview.result.stepping);
    expect(d.model.siteFit).toBe(preview.result.siteFit);
    expect(d.model.parts).toBe(model.parts);
    expect(d.transform).toBeNull();
  });

  it("aperçu sans tracé (étape en échec) : dernier modèle complet", () => {
    const failed: PreviewView = {
      project: longer,
      result: { siteFit: [], errors: [msg("ui.plan.site.refused")], timeMs: 0 },
    };
    const d = planDisplay(model, project, failed, longer);
    expect(d.model).toBe(model);
    expect(d.source).toBe(project);
    expect(d.previewing).toBe(false);
  });

  it("aperçu sans découpage : nez vides plutôt que ceux d'un autre tracé", () => {
    const { stepping: _s, ...rest } = preview.result;
    const d = planDisplay(model, project, { project: longer, result: rest }, longer);
    expect(d.model.stepping.nosings).toEqual([]);
    expect(d.model.stepping.treads).toEqual([]);
  });

  it("escalier déplacé depuis le dessin : report au placement courant", () => {
    const moved = withPlacement(project, { origin: { x: 300, y: 0 }, rotation: 0 }).project!;
    const d = planDisplay(model, project, null, moved);
    expect(d.model.layout).toBe(model.layout);
    expect(d.model.stepping).toBe(model.stepping);
    expect(d.previewing).toBe(false);
    expect(d.transform).toBe("matrix(1 0 0 1 300 0)");
  });

  it("report : les conflits liés au site sont masqués, seuls ceux de l'escalier suivent", () => {
    const zone: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const wall: SiteConflict = {
      kind: "wall",
      severity: "erreur",
      message: msg("site.fit.wall", { wall: "M1" }),
      zone,
      targetId: "M1",
    };
    const self: SiteConflict = {
      kind: "selfOverlap",
      severity: "erreur",
      message: msg("site.fit.selfOverlap", { sectionA: 1, sectionB: 3 }),
      zone,
    };
    const withConflicts: Model = { ...model, siteFit: [wall, self] };
    const moved = withPlacement(project, { origin: { x: 300, y: 0 }, rotation: 15 }).project!;
    const d = planDisplay(withConflicts, project, null, moved);
    expect(d.transform).not.toBeNull();
    expect(d.model.siteFit).toEqual([self]);
    expect(d.model.layout).toBe(model.layout);
    // Sans report : tous les conflits, même objet.
    expect(planDisplay(withConflicts, project, null, project).model).toBe(withConflicts);
    // Report d'un aperçu : même filtre.
    const p = planDisplay(
      withConflicts,
      project,
      { ...preview, result: { ...preview.result, siteFit: [wall, self] } },
      withPlacement(longer, { origin: { x: 0, y: 500 }, rotation: 0 }).project!,
    );
    expect(p.previewing).toBe(true);
    expect(p.model.siteFit).toEqual([self]);
  });
});

describe("conflits : élément visé, bulle, annonce", () => {
  const zone: Vec2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const conflict = (c: Partial<SiteConflict>): SiteConflict => ({
    kind: "wall",
    severity: "erreur",
    message: msg("site.fit.wall", { wall: "M1" }),
    zone,
    ...c,
  });
  const site = {
    ...parseProjectText(cage60Text).site,
    walls: [
      { id: "M1", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 200, loadBearing: false },
    ],
    obstacles: [
      {
        kind: "post" as const,
        id: "P1",
        center: { x: 0, y: 0 },
        sizeX: 100,
        sizeY: 100,
        rotation: 0,
      },
    ],
  } as Project["site"];

  it("élément visé : mur, obstacle, tronçon d'un recouvrement, sinon l'escalier", () => {
    expect(conflictSelection(conflict({ targetId: "M1" }), site)).toEqual({
      kind: "wall",
      id: "M1",
    });
    expect(conflictSelection(conflict({ kind: "obstacle", targetId: "P1" }), site)).toEqual({
      kind: "obstacle",
      id: "P1",
    });
    expect(
      conflictSelection(
        conflict({
          kind: "selfOverlap",
          message: msg("site.fit.selfOverlap", { sectionA: 2, sectionB: 4 }),
        }),
        site,
      ),
    ).toEqual({ kind: "section", index: 1 });
    expect(conflictSelection(conflict({ kind: "slab", targetId: undefined }), site)).toEqual({
      kind: "stair",
    });
    // Cible disparue du site (annulation) : l'escalier.
    expect(conflictSelection(conflict({ targetId: "M9" }), site)).toEqual({ kind: "stair" });
  });

  it("bulle : premier conflit (le plus grave) dont la zone contient le point, report compris", () => {
    const list = [conflict({}), conflict({ severity: "conseil", kind: "window" })];
    expect(conflictAt(list, { x: 50, y: 50 })).toBe(0);
    expect(conflictAt(list, { x: 150, y: 50 })).toBe(-1);
    expect(conflictAt([conflict({ zone: [] }), ...list], { x: 50, y: 50 })).toBe(1);
    const shown = {
      from: { origin: { x: 0, y: 0 }, rotation: 0 },
      to: { origin: { x: 1000, y: 0 }, rotation: 0 },
    };
    expect(conflictAt(list, { x: 1050, y: 50 }, shown)).toBe(0);
    expect(conflictAt(list, { x: 50, y: 50 }, shown)).toBe(-1);
  });

  it("textes traduits : sévérité et message ; annonce de la liste", () => {
    expect(FR.t(conflictText(conflict({})))).toBe(
      `Erreur : ${FR.t(msg("site.fit.wall", { wall: "M1" }))}`,
    );
    expect(FR.t(conflictsAnnouncement([]))).toBe("Aucun conflit avec le site.");
    expect(FR.t(conflictsAnnouncement(undefined))).toBe("Aucun conflit avec le site.");
    const two = FR.t(conflictsAnnouncement([conflict({}), conflict({ severity: "conseil" })]));
    expect(two).toMatch(/^2 conflits avec le site : Erreur : .* ; Conseil : /);
    expect(FR.t(conflictsAnnouncement([conflict({})]))).toMatch(/^1 conflit avec le site : Erreur/);
  });
});
