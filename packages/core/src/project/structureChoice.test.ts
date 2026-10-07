import fc from "fast-check";
import { translatorFor, type Message } from "@blondel/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Project } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { profileNewelFits } from "../structures/steelProfile.js";
import { DEFAULT_NEWEL_SIZE, suggestFixes } from "./fixes.js";
import { newelRequiredStructures } from "./newel.js";
import { createProject, PRESET_IDS } from "./presets.js";
import { applyStructureChoice, resolveProfileNewel } from "./structureChoice.js";

beforeEach(() => clearModelCache());

const TURNING = PRESET_IDS.filter((id) => createProject(id).stair.layout.turns.length > 0);
const sharpError = (m: { errors: readonly Message[] }) =>
  m.errors.filter((e) => fr(e).includes("jour à angle vif"));

function withStructure(p: Project, family: string): Project {
  return { ...p, stair: { ...p.stair, structure: { kind: "steel-profile", params: { family } } } };
}

function withTurns(
  p: Project,
  inner: Project["stair"]["layout"]["turns"][number]["inner"],
): Project {
  return {
    ...p,
    stair: {
      ...p.stair,
      layout: { ...p.stair.layout, turns: p.stair.layout.turns.map((t) => ({ ...t, inner })) },
    },
  };
}

describe("applyStructureChoice — poteau automatique (décision A4)", () => {
  it.each(["wood-housed", "steel-flat"])(
    "%s sur les préréglages tournants : jour vif → poteau de 100 mm, sans erreur, une remarque par tournant",
    (kind) => {
      for (const preset of TURNING) {
        const base = createProject(preset);
        const { project, notes } = applyStructureChoice(base, kind);
        expect(project.stair.structure).toEqual({ kind, params: {} });
        const turns = project.stair.layout.turns;
        expect(turns.map((t) => t.inner)).toEqual(
          turns.map(() => ({ kind: "newel", size: DEFAULT_NEWEL_SIZE })),
        );
        expect(turns.map((t) => [t.direction, t.mode])).toEqual(
          base.stair.layout.turns.map((t) => [t.direction, t.mode]),
        );
        expect(notes).toHaveLength(turns.length);
        expect(fr(notes[0])).toMatch(/Tournant 1 : jour vif → poteau de 100 mm .*décision A4/);
        expect(translatorFor("en").t(notes[0]!)).toMatch(
          /^Turn 1: sharp-cornered well → 100 mm newel post \(.*decision A4.*\)\. This change can be undone\.$/,
        );
        expect(sharpError(buildModel(project)), `${kind} ${preset}`).toEqual([]);
        // Plus rien à corriger côté jour.
        expect(suggestFixes(project).some((f) => f.id === "jour-newel")).toBe(false);
      }
    },
  );

  it("sans structure (ou structure sans poteau) : le jour vif reste le défaut", () => {
    const base = createProject("quarter-left");
    for (const kind of ["none", "steel-curved", "steel-central"]) {
      const { project, notes } = applyStructureChoice(base, kind);
      expect(project.stair.layout).toEqual(base.stair.layout);
      expect(project.stair.structure.kind).toBe(kind);
      expect(notes).toEqual([]);
    }
  });

  it("limon central (QUESTIONS A29) : volées et hélicoïdal acceptés, jour conservé, modèle sans erreur", () => {
    for (const id of ["quarter-left", "half-turn", "helical"] as const) {
      const base = createProject(id);
      const { project, notes } = applyStructureChoice(base, "steel-central");
      expect(project.stair.structure).toEqual({ kind: "steel-central", params: {} });
      expect(project.stair.layout).toEqual(base.stair.layout);
      expect(notes).toEqual([]);
      expect(frList(buildModel(project, { memo: false }).errors), id).toEqual([]);
    }
  });

  it("jour en arc ou poteau existant (hors profilés) : conservés", () => {
    const base = createProject("quarter-left");
    const arc = withTurns(base, { kind: "arc", radius: 150 });
    expect(applyStructureChoice(arc, "wood-housed").project.stair.layout).toEqual(arc.stair.layout);
    const post = withTurns(base, { kind: "newel", size: 90 });
    const r = applyStructureChoice(post, "steel-flat");
    expect(r.project.stair.layout).toEqual(post.stair.layout);
    expect(r.notes).toEqual([]);
  });

  it("poteau refusé par le tracé (volée centrale trop courte) : jour conservé, remarque", () => {
    const base = createProject("half-turn");
    const E = base.stair.layout.width;
    const legs = base.stair.layout.legs.map((l, i) => (i === 1 ? { length: 2 * E + 60 } : l));
    const narrow: Project = {
      ...base,
      stair: { ...base.stair, layout: { ...base.stair.layout, legs } },
    };
    const { project, notes } = applyStructureChoice(narrow, "wood-housed");
    expect(project.stair.layout).toEqual(narrow.stair.layout);
    expect(fr(notes[0])).toMatch(/impossible dans ce tracé .*jour conservé/);
  });

  it("propriété : idempotent, sens et types de tournants inchangés, structure posée", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TURNING),
        fc.constantFrom(...newelRequiredStructures(), "none"),
        (preset, kind) => {
          const base = createProject(preset);
          const once = applyStructureChoice(base, kind);
          const twice = applyStructureChoice(once.project, kind);
          expect(twice.project).toEqual(once.project);
          expect(twice.notes).toEqual([]);
          expect(once.project.stair.structure.kind).toBe(kind);
          expect(once.project.stair.layout.turns.map((t) => [t.direction, t.mode])).toEqual(
            base.stair.layout.turns.map((t) => [t.direction, t.mode]),
          );
          const required = newelRequiredStructures().includes(kind);
          for (const t of once.project.stair.layout.turns) {
            expect(t.inner.kind).toBe(required ? "newel" : "sharp");
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("applyStructureChoice — poteau élargi des profilés (décision A13)", () => {
  it("quart tournant : poteau décalé vers le jour qui reçoit l'aile de la section retenue", () => {
    const base = createProject("quarter-left");
    const { project, notes } = applyStructureChoice(base, "steel-profile", { family: "UPN" });
    const inner = project.stair.layout.turns[0]!.inner;
    expect(inner.kind).toBe("newel");
    if (inner.kind !== "newel") return;
    expect(inner.offset).toBeGreaterThan(0);
    expect(fr(notes[0])).toMatch(/jour vif → poteau de \d+ mm décalé de \d+ mm vers le jour .*A13/);
    const m = buildModel(project);
    expect(sharpError(m)).toEqual([]);
    const reception = m.compliance.results.filter((r) => r.ruleId === "FAB_POTEAU_RECEPTION");
    expect(reception.length).toBeGreaterThan(0);
    expect(reception.every((r) => r.status === "ok")).toBe(true);
    const upn = m.parts.find((p) => p.id === "stringer-inner-1")!;
    const b = upn.stock!.thickness;
    expect(profileNewelFits(inner, b, { size: "auto", clearance: 20 })).toBe(true);
    // Corrections : rien à reposer.
    const ids = suggestFixes(project, m).map((f) => f.id);
    expect(ids).not.toContain("jour-newel");
    expect(ids).not.toContain("newel-profile");
  });

  it("poteau existant de 100 mm remplacé par le poteau élargi", () => {
    const base = withTurns(createProject("quarter-left"), { kind: "newel", size: 100 });
    const { project, notes } = applyStructureChoice(base, "steel-profile", { family: "UPN" });
    expect(project.stair.layout.turns[0]!.inner).not.toEqual({ kind: "newel", size: 100 });
    expect(fr(notes[0])).toMatch(/Tournant 1 : poteau de 100 mm → poteau de \d+ mm décalé/);
  });

  it("poteau élargi refusé par le tracé (demi-tournant, IPE / HEA) : poteau par défaut, pas de jour vif", () => {
    // Revue : le jour restait vif (erreur « jour à angle vif »), contraire à la décision A4.
    for (const family of ["IPE", "HEA"]) {
      const base = createProject("half-turn");
      const { project, notes } = applyStructureChoice(base, "steel-profile", { family });
      expect(project.stair.layout.turns.map((t) => t.inner)).toEqual(
        base.stair.layout.turns.map(() => ({ kind: "newel", size: DEFAULT_NEWEL_SIZE })),
      );
      expect(fr(notes[0])).toMatch(/impossible dans ce tracé .*poteau par défaut posé/);
      expect(frList(notes.slice(1)).join(" ")).toMatch(/jour vif → poteau de 100 mm/);
      expect(sharpError(buildModel(project)), family).toEqual([]);
      // La correction proposée reste le poteau par défaut, qui est accepté.
      // Avec le modèle (section lue sur les pièces) : le poteau élargi est refusé par le tracé.
      const profiled = withStructure(base, family);
      const fixes = suggestFixes(profiled, buildModel(profiled));
      const fix = fixes.find((f) => f.id === "jour-newel");
      expect(fr(fix?.label)).toMatch(/poteau de 100 mm/);
    }
  });

  it("côté imposé ou section nommée : sans calcul de modèle", () => {
    const base = createProject("quarter-left");
    const build = vi.fn(() => buildModel(base));
    const chosen = (params: Record<string, unknown>): Project => ({
      ...base,
      stair: { ...base.stair, structure: { kind: "steel-profile", params } },
    });
    expect(resolveProfileNewel(chosen({ newel: { size: 160 } }), () => true, build)).toEqual({
      newel: { kind: "newel", size: 160, offset: 60 },
      flangeWidth: null,
    });
    // UPN 200 : b = 75 → 115 mm décalé de 38 mm.
    expect(resolveProfileNewel(chosen({ section: "UPN 200" }), () => true, build)?.newel).toEqual({
      kind: "newel",
      size: 115,
      offset: 38,
    });
    expect(build).not.toHaveBeenCalled();
  });
});
