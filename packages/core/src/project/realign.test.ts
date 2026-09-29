import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveLength } from "../geom2d/curve.js";
import { computeLayout } from "../layout/layout.js";
import { resolveRiserCount, resolveTargetGoing } from "../layout/resolve.js";
import { buildModel } from "../pipeline/build.js";
import type { Project } from "../model/project.js";
import { createProject, PRESET_IDS, type PresetId } from "./presets.js";
import { matchingFlightsPreset, realignFlightsAndOpening } from "./realign.js";

/** Projet `p` avec H, E et la dalle modifiés (comme dans le formulaire, sans recalage). */
function edited(p: Project, o: { floorToFloor?: number; width?: number; slab?: number }): Project {
  return {
    ...p,
    site: {
      ...p.site,
      ...(o.floorToFloor !== undefined ? { floorToFloor: o.floorToFloor } : {}),
      ...(o.slab !== undefined ? { upperSlabThickness: o.slab } : {}),
    },
    stair: {
      ...p.stair,
      layout: { ...p.stair.layout, ...(o.width !== undefined ? { width: o.width } : {}) },
    },
  };
}

const FLIGHTS: readonly PresetId[] = PRESET_IDS;

describe("realignFlightsAndOpening (A18 a)", () => {
  it.each(FLIGHTS)("%s : H, E et dalle modifiés → volées et trémie du préréglage", (id) => {
    const cases = [
      { floorToFloor: 2900 },
      { floorToFloor: 2550, slab: 250 },
      { width: id === "straight" ? 1000 : 850, floorToFloor: 2800 },
    ];
    for (const c of cases) {
      const expected = createProject(id, {
        floorToFloor: c.floorToFloor,
        ...(c.width !== undefined ? { width: c.width } : {}),
        ...(c.slab !== undefined ? { upperSlabThickness: c.slab } : {}),
      });
      const r = realignFlightsAndOpening(edited(createProject(id), c));
      expect(r.project.stair.layout.legs).toEqual(expected.stair.layout.legs);
      expect(r.project.site.opening).toEqual(expected.site.opening);
      expect(r.notes.join(" ")).toMatch(/Volées recalées|Trémie recalée/);
    }
  });

  it("sens des tournants conservés (quart à droite, Z)", () => {
    const z = createProject("two-quarters-s", { direction: "right" });
    const r = realignFlightsAndOpening(edited(z, { floorToFloor: 2850 }));
    expect(r.project.stair.layout.turns).toEqual(z.stair.layout.turns);
    expect(r.project.stair.layout.legs).toEqual(
      createProject("two-quarters-s", { direction: "right", floorToFloor: 2850 }).stair.layout.legs,
    );
    expect(matchingFlightsPreset(createProject("quarter-right"), 280)).toBe("quarter-right");
  });

  it("projet déjà calé : projet rendu à l'identique (aucune entrée d'annulation utile)", () => {
    const p = createProject("quarter-left");
    const r = realignFlightsAndOpening(p);
    expect(r.project).toBe(p);
    expect(r.notes).toContain("Volées et trémie déjà calées.");
  });

  it("seules les volées et la trémie changent (structure, garde-corps, nom conservés)", () => {
    const p = { ...createProject("two-quarters-u"), name: "Chantier Dupont" };
    const r = realignFlightsAndOpening(edited(p, { floorToFloor: 2900 })).project;
    expect(r.name).toBe("Chantier Dupont");
    expect(r.stair.structure).toBe(p.stair.structure);
    expect(r.stair.layout.turns).toBe(p.stair.layout.turns);
    expect(r.compliance).toBe(p.compliance);
  });

  it("sans trémie : aucune trémie ajoutée", () => {
    const p = createProject("quarter-left");
    const { opening: _o, ...site } = p.site;
    const r = realignFlightsAndOpening(edited({ ...p, site }, { floorToFloor: 2900 }));
    expect(r.project.site.opening).toBeUndefined();
    expect(r.notes.join(" ")).toContain("aucune trémie ajoutée");
  });

  it("jour en arc et E > 1 200 : la ligne de foulée mesure (n − 1)·g", () => {
    const base = createProject("quarter-left");
    const p: Project = {
      ...base,
      stair: {
        ...base.stair,
        layout: {
          ...base.stair.layout,
          width: 1300,
          turns: [{ ...base.stair.layout.turns[0]!, inner: { kind: "arc", radius: 150 } }],
        },
      },
    };
    const r = realignFlightsAndOpening(p).project;
    const n = resolveRiserCount(r);
    const g = resolveTargetGoing(r, n);
    const layout = computeLayout(r);
    // Longueurs arrondies au mm : écart ≤ 1 mm par volée.
    expect(Math.abs(curveLength(layout.walkline) - (n - 1) * g)).toBeLessThanOrEqual(1);
  });

  it("S / Z avec E > 1 200 : transition oblique prise en compte", () => {
    const s = edited(createProject("two-quarters-s"), { width: 1300, floorToFloor: 3000 });
    const r = realignFlightsAndOpening(s).project;
    const n = resolveRiserCount(r);
    const g = resolveTargetGoing(r, n);
    const layout = computeLayout(r);
    expect(layout.walklineTransitions?.length).toBe(1);
    expect(Math.abs(curveLength(layout.walkline) - (n - 1) * g)).toBeLessThanOrEqual(2);
  });

  it("escalier droit de longueur automatique : longueur conservée, trémie recalée", () => {
    const p = createProject("straight", {
      patch: { stair: { layout: { legs: [{ length: "auto" }] } } },
    });
    const r = realignFlightsAndOpening(edited(p, { floorToFloor: 3000 }));
    expect(r.project.stair.layout.legs).toEqual([{ length: "auto" }]);
    expect(r.project.site.opening).not.toEqual(p.site.opening);
  });

  it("refus explicites : hélicoïdal, topologie sans préréglage, H trop faible", () => {
    expect(() => realignFlightsAndOpening(createProject("helical"))).toThrow(RangeError);
    const u = createProject("two-quarters-u");
    const three: Project = {
      ...u,
      stair: {
        ...u.stair,
        layout: {
          ...u.stair.layout,
          legs: [...u.stair.layout.legs, { length: 2000 }],
          turns: [...u.stair.layout.turns, u.stair.layout.turns[0]!],
        },
      },
    };
    expect(() => realignFlightsAndOpening(three)).toThrow(/aucun préréglage/);
    expect(() =>
      realignFlightsAndOpening(edited(createProject("half-turn"), { floorToFloor: 1200 })),
    ).toThrow(RangeError);
  });

  it("propriété : après recalage, le modèle se construit sans erreur au giron cible", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PresetId>("straight", "quarter-left", "quarter-landing", "two-quarters-u"),
        fc.integer({ min: 2500, max: 3100 }),
        fc.integer({ min: 800, max: 1000 }),
        fc.integer({ min: 150, max: 300 }),
        (id, h, e, slab) => {
          const p = edited(createProject(id), { floorToFloor: h, width: e, slab });
          const r = realignFlightsAndOpening(p).project;
          const m = buildModel(r);
          expect(m.errors).toEqual([]);
          const n = resolveRiserCount(r);
          expect(m.stepping.riserCount).toBe(n);
          expect(Math.abs(m.stepping.going - resolveTargetGoing(r, n))).toBeLessThan(1);
        },
      ),
      { numRuns: 25 },
    );
  });
});
