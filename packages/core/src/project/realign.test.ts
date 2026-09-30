import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveLength } from "../geom2d/curve.js";
import { computeLayout } from "../layout/layout.js";
import { resolveRiserCount, resolveTargetGoing } from "../layout/resolve.js";
import { buildModel } from "../pipeline/build.js";
import type { Project } from "../model/project.js";
import {
  computeOpening,
  createProject,
  PRESET_IDS,
  PRESET_OPENING_CLEARANCE,
  type PresetId,
} from "./presets.js";
import { matchingFlightsPreset, realignBlocker, realignFlightsAndOpening } from "./realign.js";

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

/** Longueur de Γ hors paliers (ce que le découpage répartit en (n − 1 − paliers) girons). */
function walkLength(p: Project): { length: number; landings: number } {
  const layout = computeLayout(p);
  const landings = layout.turns.filter((t) => t.mode === "landing");
  const onLandings = landings.reduce((acc, t) => acc + (t.sEnd - t.sStart), 0);
  return { length: curveLength(layout.walkline) - onLandings, landings: landings.length };
}

/** Γ hors paliers = (n − 1 − paliers)·g à l'arrondi des longueurs saisies près. */
function expectOnTarget(p: Project, tolerance = 1): void {
  const n = resolveRiserCount(p);
  const g = resolveTargetGoing(p, n);
  const w = walkLength(p);
  expect(Math.abs(w.length - (n - 1 - w.landings) * g)).toBeLessThanOrEqual(tolerance);
}

const WINDERS: readonly PresetId[] = PRESET_IDS.filter(
  (id) => id !== "straight" && id !== "quarter-landing",
);

describe("realignFlightsAndOpening (A18 a, précisé le 2026-09-30)", () => {
  it.each(WINDERS)(
    "%s : H et dalle modifiés → seule la dernière volée change, tournants à leur place",
    (id) => {
      for (const c of [{ floorToFloor: 2900 }, { floorToFloor: 2550, slab: 250 }]) {
        const before = edited(createProject(id), c);
        const r = realignFlightsAndOpening(before);
        const legs = r.project.stair.layout.legs;
        const old = before.stair.layout.legs;
        // Position des tournants saisie conservée : toutes les volées sauf la dernière.
        expect(legs.slice(0, -1)).toEqual(old.slice(0, -1));
        expect(legs[legs.length - 1]).not.toEqual(old[old.length - 1]);
        expect(r.project.stair.layout.turns).toBe(before.stair.layout.turns);
        expectOnTarget(r.project);
        // Trémie rectangulaire recalculée sur le tracé recalé.
        const { x, y, sizeX, sizeY } = computeOpening(r.project, PRESET_OPENING_CLEARANCE)!;
        expect(r.project.site.opening).toEqual({ kind: "rect", x, y, sizeX, sizeY });
        expect(r.notes.join(" ")).toMatch(
          /Dernière volée recalée.*position des tournants conservée/,
        );
        const m = buildModel(r.project);
        expect(m.errors).toEqual([]);
        expect(
          Math.abs(m.stepping.going - resolveTargetGoing(r.project, m.stepping.riserCount)),
        ).toBeLessThan(1);
      }
    },
  );

  it("escalier droit : longueur du préréglage à la nouvelle hauteur", () => {
    const r = realignFlightsAndOpening(edited(createProject("straight"), { floorToFloor: 2900 }));
    const expected = createProject("straight", { floorToFloor: 2900 });
    expect(r.project.stair.layout.legs).toEqual(expected.stair.layout.legs);
    expect(r.project.site.opening).toEqual(expected.site.opening);
  });

  it("position du premier tournant saisie conservée (plus celle du préréglage)", () => {
    const p = createProject("quarter-left");
    const moved = {
      ...p,
      stair: {
        ...p.stair,
        layout: {
          ...p.stair.layout,
          legs: [{ length: 1600 }, p.stair.layout.legs[1]!],
        },
      },
    };
    const r = realignFlightsAndOpening(edited(moved, { floorToFloor: 2800 })).project;
    expect(r.stair.layout.legs[0]).toEqual({ length: 1600 });
    expectOnTarget(r);
  });

  it("U dont la partie droite intermédiaire est plus courte qu'un giron : reste un U", () => {
    const u = createProject("two-quarters-u");
    const { width, legs } = u.stair.layout;
    // Partie droite intermédiaire de 150 mm (< giron) entre les deux jours vifs.
    const short: Project = {
      ...u,
      stair: {
        ...u.stair,
        layout: { ...u.stair.layout, legs: [legs[0]!, { length: 2 * width + 150 }, legs[2]!] },
      },
    };
    const before = edited(short, { floorToFloor: 2800 });
    const r = realignFlightsAndOpening(before).project;
    // Avant : classé « demi-tournant », volée intermédiaire remplacée par celle du préréglage.
    expect(r.stair.layout.legs[1]).toEqual({ length: 2 * width + 150 });
    expect(r.stair.layout.legs[0]).toEqual(legs[0]);
    expect(r.stair.layout.turns).toBe(before.stair.layout.turns);
    expectOnTarget(r);
  });

  it("trémie polygonale conservée telle quelle", () => {
    const p = createProject("quarter-left");
    const rect = p.site.opening!;
    if (rect.kind !== "rect") throw new Error("trémie rectangulaire attendue");
    const polygon = {
      kind: "polygon" as const,
      points: [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.sizeX, y: rect.y },
        { x: rect.x + rect.sizeX, y: rect.y + rect.sizeY },
        { x: rect.x + 200, y: rect.y + rect.sizeY },
        { x: rect.x, y: rect.y + rect.sizeY - 200 },
      ],
    };
    const withPolygon = { ...p, site: { ...p.site, opening: polygon } } as Project;
    const r = realignFlightsAndOpening(edited(withPolygon, { floorToFloor: 2900 }));
    expect(r.project.site.opening).toBe(withPolygon.site.opening);
    expect(r.notes.join(" ")).toMatch(/Trémie polygonale conservée/);
  });

  it("quart tournant avec palier : partie droite hors d'un nombre entier de girons → refus expliqué, puis recalage après correction", () => {
    const before = edited(createProject("quarter-landing"), { floorToFloor: 2900 });
    expect(() => realignFlightsAndOpening(before)).toThrow(/nombre entier de girons/);
    const reason = realignBlocker(before)!;
    const m = /saisir ([\d\s\u202f\u00a0]+) mm pour la volée 1/.exec(reason);
    expect(m).not.toBeNull();
    const suggested = Number(m![1]!.replace(/[\s\u202f\u00a0]/g, ""));
    const fixed: Project = {
      ...before,
      stair: {
        ...before.stair,
        layout: {
          ...before.stair.layout,
          legs: [{ length: suggested }, before.stair.layout.legs[1]!],
        },
      },
    };
    expect(realignBlocker(fixed)).toBeNull();
    const r = realignFlightsAndOpening(fixed).project;
    expect(r.stair.layout.legs[0]).toEqual({ length: suggested });
    expectOnTarget(r);
    const model = buildModel(r);
    expect(model.errors).toEqual([]);
    // Girons égaux à l'arrondi au mm des longueurs saisies près.
    const g = resolveTargetGoing(r, resolveRiserCount(r));
    for (const t of model.stepping.treads.filter((x) => x.kind === "straight")) {
      expect(Math.abs(t.going - g)).toBeLessThan(1);
    }
  });

  it("palier au départ (partie droite de 0 giron) : recalage possible ; partie droite de quelques mm : longueur proposée (relecture A18 a)", () => {
    // Avant la relecture : « la partie droite qui le précède (0 mm) ne contient pas un nombre
    // entier de girons » (0 est un nombre entier de girons, le découpage l'accepte), et aucune
    // longueur proposée pour une partie droite de 30 mm (arrondie à 0 giron).
    const p0 = createProject("quarter-landing");
    const E = p0.stair.layout.width;
    const withFirst = (l1: number): Project =>
      edited(
        {
          ...p0,
          stair: {
            ...p0.stair,
            layout: { ...p0.stair.layout, legs: [{ length: l1 }, p0.stair.layout.legs[1]!] },
          },
        },
        { floorToFloor: 2900 },
      );
    const atStart = withFirst(E);
    expect(realignBlocker(atStart)).toBeNull();
    const r = realignFlightsAndOpening(atStart).project;
    expect(r.stair.layout.legs[0]).toEqual({ length: E });
    expectOnTarget(r);
    expect(buildModel(r).errors).toEqual([]);
    const reason = realignBlocker(withFirst(E + 30))!;
    expect(reason).toMatch(new RegExp(`saisir ${E.toLocaleString("fr-FR")} mm pour la volée 1`));
  });

  it("sens des tournants conservés (quart à droite, Z)", () => {
    const z = createProject("two-quarters-s", { direction: "right" });
    const r = realignFlightsAndOpening(edited(z, { floorToFloor: 2850 }));
    expect(r.project.stair.layout.turns).toEqual(z.stair.layout.turns);
    expect(r.project.stair.layout.legs.slice(0, 2)).toEqual(z.stair.layout.legs.slice(0, 2));
    expectOnTarget(r.project, 2);
    expect(matchingFlightsPreset(createProject("quarter-right"), 280)).toBe("quarter-right");
  });

  it("projet déjà calé : projet rendu à l'identique (aucune entrée d'annulation utile)", () => {
    const p = createProject("quarter-left");
    const r = realignFlightsAndOpening(p);
    expect(r.project).toBe(p);
    expect(r.notes).toContain("Volées et trémie déjà calées.");
    expect(realignBlocker(p)).toBeNull();
  });

  it("seules la dernière volée et la trémie changent (structure, garde-corps, nom conservés)", () => {
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
          legs: [{ length: 1900 }, { length: 3000 }],
          turns: [{ ...base.stair.layout.turns[0]!, inner: { kind: "arc", radius: 150 } }],
        },
      },
    };
    const r = realignFlightsAndOpening(p).project;
    expect(r.stair.layout.legs[0]).toEqual({ length: 1900 });
    expectOnTarget(r);
  });

  it("S / Z avec E > 1 200 : transition oblique prise en compte", () => {
    const base = createProject("two-quarters-s");
    const s: Project = edited(
      {
        ...base,
        stair: {
          ...base.stair,
          layout: {
            ...base.stair.layout,
            legs: [{ length: 1800 }, { length: 3200 }, { length: 2000 }],
          },
        },
      },
      { width: 1300, floorToFloor: 3000 },
    );
    const r = realignFlightsAndOpening(s).project;
    expect(computeLayout(r).walklineTransitions?.length).toBe(1);
    expectOnTarget(r, 2);
  });

  it("escalier droit de longueur automatique : longueur conservée, trémie recalée", () => {
    const p = createProject("straight", {
      patch: { stair: { layout: { legs: [{ length: "auto" }] } } },
    });
    const r = realignFlightsAndOpening(edited(p, { floorToFloor: 3000 }));
    expect(r.project.stair.layout.legs).toEqual([{ length: "auto" }]);
    expect(r.project.site.opening).not.toEqual(p.site.opening);
  });

  it("refus explicites (bouton désactivé avec la raison du cœur) : hélicoïdal, H trop faible, volée devenue trop courte", () => {
    const helical = createProject("helical");
    expect(() => realignFlightsAndOpening(helical)).toThrow(RangeError);
    expect(realignBlocker(helical)).toMatch(/hélicoïdal/);
    const low = edited(createProject("half-turn"), { floorToFloor: 1200 });
    expect(() => realignFlightsAndOpening(low)).toThrow(RangeError);
    expect(realignBlocker(low)).toMatch(
      /il manque \d+ mm de ligne de foulée après le dernier tournant/,
    );
    // E élargi : la première volée saisie ne reçoit plus le tournant (message du tracé).
    const q = createProject("quarter-left");
    const wide: Project = {
      ...q,
      stair: {
        ...q.stair,
        layout: {
          ...q.stair.layout,
          width: 1300,
          turns: [{ ...q.stair.layout.turns[0]!, inner: { kind: "arc", radius: 150 } }],
        },
      },
    };
    expect(realignBlocker(wide)).toMatch(/volée 1 est trop courte/);
  });

  it("propriété : recalage possible → modèle sans erreur au giron cible ; sinon raison lisible", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PresetId>("straight", "quarter-left", "half-turn", "two-quarters-u"),
        fc.integer({ min: 2500, max: 3100 }),
        fc.integer({ min: 800, max: 1000 }),
        fc.integer({ min: 150, max: 300 }),
        (id, h, e, slab) => {
          const p = edited(createProject(id), { floorToFloor: h, width: e, slab });
          const reason = realignBlocker(p);
          if (reason !== null) {
            expect(reason.length).toBeGreaterThan(10);
            expect(() => realignFlightsAndOpening(p)).toThrow(RangeError);
            return;
          }
          const r = realignFlightsAndOpening(p).project;
          expect(r.stair.layout.legs.slice(0, -1)).toEqual(p.stair.layout.legs.slice(0, -1));
          const m = buildModel(r);
          expect(m.errors).toEqual([]);
          const n = resolveRiserCount(r);
          expect(m.stepping.riserCount).toBe(n);
          expect(Math.abs(m.stepping.going - resolveTargetGoing(r, n))).toBeLessThan(1);
        },
      ),
      { numRuns: 30 },
    );
  });
});
