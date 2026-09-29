import {
  ALL_PRESET_IDS,
  ProjectSchema,
  buildModel,
  createProject,
  type Project,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeProject } from "../store/projectStore.js";
import {
  FALLBACK_TREADS_PER_TURN,
  HELICAL_CONTEXT,
  flightsTypologyLabel,
  hasOppositeTurns,
  layoutKindOf,
  presetProject,
  structureFitsLayout,
  switchLayoutKind,
  withTurnSequence,
} from "./layoutKind.js";

const withStructure = (p: Project, kind: string): Project =>
  ProjectSchema.parse({ ...p, stair: { ...p.stair, structure: { kind, params: {} } } });

describe("type de tracé", () => {
  it("compatibilité des structures : helical-core pour l'hélicoïdal, les autres pour les volées", () => {
    expect(structureFitsLayout("none", "helical")).toBe(true);
    expect(structureFitsLayout("none", "flights")).toBe(true);
    expect(structureFitsLayout("helical-core", "helical")).toBe(true);
    expect(structureFitsLayout("helical-core", "flights")).toBe(false);
    for (const k of ["wood-housed", "wood-cut", "steel-flat", "steel-profile", "steel-curved"]) {
      expect(structureFitsLayout(k, "flights")).toBe(true);
      expect(structureFitsLayout(k, "helical")).toBe(false);
    }
  });

  it("préréglage hélicoïdal de l'interface : structure à fût ; les autres inchangés", () => {
    const h = presetProject("helical");
    expect(h.stair.layout.kind).toBe("helical");
    expect(h.stair.structure.kind).toBe("helical-core");
    const parts = buildModel(h).parts.map((p) => p.id);
    expect(parts).toEqual(expect.arrayContaining(["helical-column", "helical-handrail"]));
    for (const id of ALL_PRESET_IDS.filter((x) => x !== "helical")) {
      expect(presetProject(id)).toEqual(createProject(id));
    }
  });

  it("volées → hélicoïdal : tracé et trémie du préréglage, site et réglages conservés", () => {
    const base = withStructure(
      createProject("quarter-left", { floorToFloor: 2700 }),
      "wood-housed",
    );
    const p: Project = {
      ...base,
      name: "Mon escalier",
      stair: { ...base.stair, nosingOverrides: [{ kind: "fixed", index: 3 }] },
    };
    const h = switchLayoutKind(p, "helical").project;
    expect(layoutKindOf(h)).toBe("helical");
    expect(h.name).toBe("Mon escalier");
    expect(h.site.floorToFloor).toBe(2700);
    expect(h.site.opening).toEqual(presetProject("helical", { floorToFloor: 2700 }).site.opening);
    expect(h.stair.treads).toBe(p.stair.treads);
    expect(h.stair.stepping).toBe(p.stair.stepping);
    expect(h.stair.nosingOverrides).toEqual([]);
    // Structure à volées remplacée par la structure à fût.
    expect(h.stair.structure.kind).toBe("helical-core");
    expect(h.compliance.contexts.filter((c) => c === HELICAL_CONTEXT)).toHaveLength(1);
    const n = normalizeProject(h);
    expect(n.ok).toBe(true);
    expect(buildModel(h).errors).toEqual([]);

    // Retour aux volées : escalier droit, structure « aucune », contexte retiré.
    const f = switchLayoutKind(h, "flights").project;
    expect(layoutKindOf(f)).toBe("flights");
    expect(f.stair.layout).toEqual(createProject("straight", { floorToFloor: 2700 }).stair.layout);
    expect(f.stair.structure.kind).toBe("none");
    expect(f.compliance.contexts).not.toContain(HELICAL_CONTEXT);
    expect(buildModel(f).errors).toEqual([]);
  });

  it("hauteur sans rotation admissible pour le préréglage : rotation provisoire signalée", () => {
    const p = createProject("quarter-left", { floorToFloor: 2750 });
    expect(() => createProject("helical", { floorToFloor: 2750 })).toThrow(RangeError);
    const s = switchLayoutKind(p, "helical");
    expect(s.note).toMatch(/12 marches par tour/);
    expect(s.project.stair.layout).toMatchObject({
      kind: "helical",
      sweep: { mode: "treadsPerTurn", count: FALLBACK_TREADS_PER_TURN },
    });
    expect(normalizeProject(s.project).ok).toBe(true);
  });

  it("même type : projet inchangé ; sans trémie : pas de trémie ajoutée ; structure du préréglage si aucune", () => {
    const p = createProject("straight");
    expect(switchLayoutKind(p, "flights").project).toBe(p);
    const { opening: _o, ...site } = p.site;
    const open: Project = { ...p, site };
    expect(switchLayoutKind(open, "helical").project.site.opening).toBeUndefined();
    const none = switchLayoutKind(p, "helical").project;
    expect(none.stair.structure.kind).toBe("helical-core");
    const flat = withStructure(createProject("quarter-left"), "steel-flat");
    expect(switchLayoutKind(flat, "helical").project.stair.structure.kind).toBe("helical-core");
    const housed = switchLayoutKind(
      withStructure(presetProject("helical"), "none"),
      "flights",
    ).project;
    expect(housed.stair.structure.kind).toBe("none");
  });

  it("propriété : aller-retour valide par le schéma du cœur, quels que soient H, dalle et préréglage", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PRESET_IDS),
        fc.integer({ min: 2200, max: 3400 }),
        fc.integer({ min: 150, max: 300 }),
        (id, floorToFloor, upperSlabThickness) => {
          let p: Project;
          try {
            p = presetProject(id, { floorToFloor, upperSlabThickness });
          } catch (e) {
            // Préréglage de départ impossible pour ces H et dalle (hors du sujet testé).
            expect(e).toBeInstanceOf(RangeError);
            return;
          }
          const other = layoutKindOf(p) === "helical" ? "flights" : "helical";
          const s = switchLayoutKind(p, other);
          const q = s.project;
          // Rotation provisoire seulement quand le préréglage du cœur n'a rien trouvé.
          if (s.note !== undefined) {
            expect(other).toBe("helical");
            expect(s.note).toMatch(/provisoire/);
          }
          expect(normalizeProject(q).ok).toBe(true);
          expect(layoutKindOf(q)).toBe(other);
          expect(q.site.floorToFloor).toBe(floorToFloor);
          expect(q.site.upperSlabThickness).toBe(upperSlabThickness);
          expect(structureFitsLayout(q.stair.structure.kind, other)).toBe(true);
          expect(q.compliance.contexts.includes(HELICAL_CONTEXT)).toBe(other === "helical");
        },
      ),
      { numRuns: 30 },
    );
  });

  it("volées → hélicoïdal : marches par tour et palier cherchés pour le découpage et les marches conservés", () => {
    const base = createProject("quarter-left", { floorToFloor: 2700 });
    const p: Project = ProjectSchema.parse({
      ...base,
      stair: {
        ...base.stair,
        stepping: { ...base.stair.stepping, riserCount: 15 },
        treads: { ...base.stair.treads, thickness: 60 },
      },
    });
    const kept = { stepping: p.stair.stepping, treads: p.stair.treads, walkline: p.stair.walkline };
    const expected = presetProject("helical", {
      floorToFloor: 2700,
      patch: { stair: kept },
    }).stair.layout;
    const naive = presetProject("helical", { floorToFloor: 2700 }).stair.layout;
    // Le préréglage « nu » (marches de 40 mm) retiendrait un palier plus grand que celui qui
    // dégage l'échappée avec les marches de 60 mm du projet.
    expect(expected).not.toEqual(naive);
    const s = switchLayoutKind(p, "helical");
    expect(s.note).toBeUndefined();
    expect(s.project.stair.layout).toEqual(expected);
    expect(s.project.stair.stepping).toBe(p.stair.stepping);
    expect(s.project.stair.treads).toBe(p.stair.treads);

    // n = 16 imposé : aucune rotation du préréglage ne convient → rotation provisoire signalée
    // (et non une rotation trouvée pour n = 15, silencieusement fausse).
    const p16: Project = ProjectSchema.parse({
      ...p,
      stair: { ...p.stair, stepping: { ...p.stair.stepping, riserCount: 16 } },
    });
    expect(switchLayoutKind(p16, "helical").note).toMatch(/provisoire/);
  });
});

describe("typologie des volées (S / Z)", () => {
  const turnsOf = (p: Project) => p.stair.layout.turns;

  it("libellés des préréglages à volées", () => {
    expect(flightsTypologyLabel(turnsOf(createProject("straight")))).toBe("Escalier droit");
    expect(flightsTypologyLabel(turnsOf(createProject("quarter-left")))).toBe(
      "Quart tournant à gauche",
    );
    expect(flightsTypologyLabel(turnsOf(createProject("quarter-landing")))).toMatch(/avec palier$/);
    expect(flightsTypologyLabel(turnsOf(createProject("two-quarters-u")))).toMatch(/\(U\)/);
    const s = turnsOf(createProject("two-quarters-s"));
    expect(hasOppositeTurns(s)).toBe(true);
    expect(flightsTypologyLabel(s)).toMatch(/^Deux quarts tournants opposés \(S \/ Z/);
    expect(hasOppositeTurns(turnsOf(createProject("two-quarters-u")))).toBe(false);
  });

  it("U ↔ S / Z : sens du premier tournant gardé, modèle construit sans erreur", () => {
    const u = createProject("two-quarters-u");
    const s = withTurnSequence(u, "opposite");
    expect(turnsOf(s)[0]!.direction).toBe(turnsOf(u)[0]!.direction);
    expect(turnsOf(s)[1]!.direction).not.toBe(turnsOf(u)[1]!.direction);
    expect(hasOppositeTurns(turnsOf(s))).toBe(true);
    const n = normalizeProject(s);
    expect(n.ok).toBe(true);
    const m = buildModel(s);
    expect(m.errors).toEqual([]);
    expect(withTurnSequence(s, "same")).toEqual(u);
    // Sans objet : escalier droit, un seul tournant, hélicoïdal.
    for (const id of ["straight", "quarter-left", "helical"] as const) {
      const p = createProject(id);
      expect(withTurnSequence(p, "opposite")).toBe(p);
    }
  });

  it("propriété : l'enchaînement choisi est celui rendu, les autres tournants sont inchangés", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("left" as const, "right" as const), {
          minLength: 2,
          maxLength: 4,
        }),
        fc.constantFrom("same" as const, "opposite" as const),
        (dirs, seq) => {
          const base = createProject("two-quarters-u");
          const t0 = base.stair.layout.turns[0]!;
          const p: Project = {
            ...base,
            stair: {
              ...base.stair,
              layout: {
                ...base.stair.layout,
                turns: dirs.map((direction) => ({ ...t0, direction })),
              },
            },
          };
          const q = turnsOf(withTurnSequence(p, seq));
          expect(q[0]!.direction === q[1]!.direction).toBe(seq === "same");
          expect(q[0]).toEqual(turnsOf(p)[0]);
          expect(q.slice(2)).toEqual(turnsOf(p).slice(2));
        },
      ),
    );
  });
});
