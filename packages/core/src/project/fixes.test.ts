import { beforeEach, describe, expect, it } from "vitest";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { DEFAULT_NEWEL_SIZE, NEWEL_REQUIRED_STRUCTURES, suggestFixes } from "./fixes.js";
import { createProject, deepMerge, PRESET_IDS } from "./presets.js";

beforeEach(() => clearModelCache());

function with_(p: Project, extra: Partial<ProjectInput>): Project {
  return ProjectSchema.parse({ ...p, ...extra });
}

function apply(p: Project, patch: unknown): Project {
  return ProjectSchema.parse(deepMerge(p, patch));
}

const sharpError = (m: { errors: readonly string[] }) =>
  m.errors.filter((e) => e.includes("jour à angle vif"));

describe("suggestFixes — jour à angle vif et structure à poteau", () => {
  it.each(NEWEL_REQUIRED_STRUCTURES)(
    "%s sur les préréglages tournants : « passer le jour en poteau » supprime l'erreur",
    (kind) => {
      for (const preset of PRESET_IDS) {
        const base = createProject(preset);
        const p = with_(base, { stair: { ...base.stair, structure: { kind, params: {} } } });
        const m = buildModel(p);
        const fixes = suggestFixes(p, m);
        const fix = fixes.find((f) => f.id === "jour-newel");
        if (p.stair.layout.turns.length === 0) {
          expect(fix).toBeUndefined();
          continue;
        }
        expect(sharpError(m).length, `${kind} ${preset}`).toBeGreaterThan(0);
        // Profilés : poteau élargi (aile de la section du modèle + 2 × jeu, décalé vers le jour).
        if (kind === "steel-profile")
          expect(fix?.label).toMatch(/poteau de \d+ mm décalé de \d+ mm vers le jour/);
        else expect(fix?.label).toContain(`poteau de ${DEFAULT_NEWEL_SIZE} mm`);
        const q = apply(p, fix!.patch);
        expect(q.stair.layout.turns.every((t) => t.inner.kind === "newel")).toBe(true);
        expect(q.stair.layout.turns.map((t) => [t.direction, t.mode])).toEqual(
          p.stair.layout.turns.map((t) => [t.direction, t.mode]),
        );
        expect(sharpError(buildModel(q)), `${kind} ${preset}`).toEqual([]);
        expect(suggestFixes(q).some((f) => f.id === "jour-newel")).toBe(false);
      }
    },
  );

  it("sans structure à poteau ou sans jour vif : rien à proposer", () => {
    const p = createProject("half-turn");
    expect(suggestFixes(p, buildModel(p))).toEqual([]);
    const wood = with_(p, {
      stair: {
        ...p.stair,
        structure: { kind: "wood-housed", params: {} },
        layout: {
          ...p.stair.layout,
          turns: p.stair.layout.turns.map((t) => ({ ...t, inner: { kind: "arc", radius: 150 } })),
        },
      },
    });
    expect(suggestFixes(wood).some((f) => f.id === "jour-newel")).toBe(false);
  });
});

describe("suggestFixes — poteau des profilés (décision A13)", () => {
  it("poteau de 100 mm sous des UPN : poteau élargi proposé, qui lève FAB_POTEAU_RECEPTION, stable", () => {
    const base = createProject("quarter-left");
    const p = with_(base, {
      stair: {
        ...base.stair,
        structure: { kind: "steel-profile", params: { family: "UPN" } },
        layout: {
          ...base.stair.layout,
          turns: base.stair.layout.turns.map((t) => ({
            ...t,
            inner: { kind: "newel", size: DEFAULT_NEWEL_SIZE },
          })),
        },
      },
    });
    const m = buildModel(p);
    const reception = (mm: typeof m) =>
      mm.compliance.results.filter(
        (r) => r.ruleId === "FAB_POTEAU_RECEPTION" && r.status === "violation",
      );
    expect(reception(m).length).toBeGreaterThan(0);
    const fixes = suggestFixes(p, m);
    expect(fixes.some((f) => f.id === "jour-newel")).toBe(false);
    const fix = fixes.find((f) => f.id === "newel-profile");
    expect(fix?.label).toMatch(
      /^Poser le poteau des profilés : poteau de \d+ mm décalé de \d+ mm vers le jour$/,
    );
    const q = apply(p, fix!.patch);
    const inner = q.stair.layout.turns[0]!.inner;
    expect(inner.kind === "newel" && (inner.offset ?? 0) > 0).toBe(true);
    const mq = buildModel(q);
    expect(reception(mq)).toEqual([]);
    expect(suggestFixes(q, mq).some((f) => f.id === "newel-profile")).toBe(false);
  });

  it("autres structures : tout poteau convient, rien à proposer", () => {
    const base = createProject("quarter-left");
    const p = with_(base, {
      stair: {
        ...base.stair,
        structure: { kind: "wood-housed", params: {} },
        layout: {
          ...base.stair.layout,
          turns: base.stair.layout.turns.map((t) => ({ ...t, inner: { kind: "newel", size: 90 } })),
        },
      },
    });
    expect(suggestFixes(p, buildModel(p)).map((f) => f.id)).not.toContain("newel-profile");
  });
});

describe("suggestFixes — garde-corps sous la dalle haute", () => {
  it("trémie au nu de l'escalier : élargissement proposé, qui supprime GC_CONFLIT_DALLE", () => {
    const p = with_(createProject("quarter-left", { openingClearance: 0 }), { guards: {} });
    const m = buildModel(p);
    expect(m.compliance.results.some((r) => r.ruleId === "GC_CONFLIT_DALLE")).toBe(true);
    const fix = suggestFixes(p, m).find((f) => f.id === "opening-clearance");
    expect(fix?.label).toBe("Élargir la trémie de 100 mm le long de l'escalier");
    const q = apply(p, fix!.patch);
    const mq = buildModel(q);
    expect(mq.compliance.results.some((r) => r.ruleId === "GC_CONFLIT_DALLE")).toBe(false);
    expect(suggestFixes(q, mq).some((f) => f.id === "opening-clearance")).toBe(false);
  });
});

describe("suggestFixes — jour plus étroit que la sphère T1", () => {
  it("propose de régler le côté jour sur « mur », ce qui lève l'erreur", () => {
    const base = createProject("half-turn");
    const legs = base.stair.layout.legs.map((l, i) =>
      i === 1 ? { length: 2 * base.stair.layout.width + 60 } : l,
    );
    const p = with_(base, {
      stair: { ...base.stair, layout: { ...base.stair.layout, legs } },
      guards: {},
    });
    const m = buildModel(p);
    expect(m.errors).toHaveLength(1);
    const fix = suggestFixes(p, m).find((f) => f.id === "jour-wall");
    expect(fix).toBeDefined();
    const q = apply(p, fix!.patch);
    expect(q.guards?.flight.inner).toBe("wall");
    expect(buildModel(q).errors).toEqual([]);
  });
});

describe("suggestFixes — relecture adverse", () => {
  it("trémie de préréglage déjà élargie (100 mm) mais décalage plus grand : complément proposé", () => {
    // Avant correction : les côtés de la trémie n'étaient plus « au nu » de l'escalier, aucun
    // élargissement n'était proposé et GC_CONFLIT_DALLE restait sans correction.
    const p = with_(createProject("quarter-left"), { guards: { flight: { edgeOffset: 120 } } });
    const m = buildModel(p);
    expect(m.compliance.results.some((r) => r.ruleId === "GC_CONFLIT_DALLE")).toBe(true);
    const fix = suggestFixes(p, m).find((f) => f.id === "opening-clearance");
    expect(fix).toBeDefined();
    const q = apply(p, fix!.patch);
    // Même trémie qu'un préréglage au nu élargi directement du jeu requis (120 + 40 → 160 mm).
    const p0 = with_(createProject("quarter-left", { openingClearance: 0 }), {
      guards: { flight: { edgeOffset: 120 } },
    });
    const fix0 = suggestFixes(p0, buildModel(p0)).find((f) => f.id === "opening-clearance");
    expect(q.site.opening).toEqual(apply(p0, fix0!.patch).site.opening);
    const mq = buildModel(q);
    expect(mq.compliance.results.some((r) => r.ruleId === "GC_CONFLIT_DALLE")).toBe(false);
    expect(suggestFixes(q, mq).some((f) => f.id === "opening-clearance")).toBe(false);
  });

  it("poteau plus large que le jour : correction non proposée (le tracé serait impossible)", () => {
    const base = createProject("half-turn");
    const withJour = (jour: number) => {
      const legs = base.stair.layout.legs.map((l, i) =>
        i === 1 ? { length: 2 * base.stair.layout.width + jour } : l,
      );
      return with_(base, {
        stair: {
          ...base.stair,
          structure: { kind: "steel-flat", params: {} },
          layout: { ...base.stair.layout, legs },
        },
      });
    };
    // Jour de 60 mm < poteau de 100 mm : avant correction, le patch proposé menait à l'erreur
    // « La volée 2 est trop courte ».
    const narrow = withJour(60);
    expect(sharpError(buildModel(narrow)).length).toBeGreaterThan(0);
    expect(suggestFixes(narrow).some((f) => f.id === "jour-newel")).toBe(false);
    // Jour de 140 mm : correction proposée, modèle sans erreur une fois appliquée.
    const wide = withJour(140);
    const fix = suggestFixes(wide).find((f) => f.id === "jour-newel");
    expect(fix).toBeDefined();
    expect(buildModel(apply(wide, fix!.patch)).errors).toEqual([]);
  });
});
