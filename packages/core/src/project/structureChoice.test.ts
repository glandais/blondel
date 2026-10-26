import fc from "fast-check";
import { translatorFor, type Message } from "@blondel/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Project } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { profileNewelFits } from "../structures/steelProfile.js";
import { DEFAULT_NEWEL_SIZE, suggestFixes } from "./fixes.js";
import {
  layoutAccepts,
  newelRequiredStructures,
  newelSatisfies,
  profileNewelFamily,
  withNewels,
} from "./newel.js";
import { createProject, PRESET_IDS } from "./presets.js";
import {
  PROFILE_NEWEL_EXEMPT_RULES,
  PROFILE_NEWEL_ITERATIONS,
  PROFILE_NEWEL_VERIFICATIONS,
  addedViolations,
  applyStructureChoice,
  resolveProfileNewel,
  violationCounts,
  type ProfileNewelModel,
} from "./structureChoice.js";

beforeEach(() => clearModelCache());

const RUNS = Number(process.env["STEPPING_RUNS"] ?? 200);

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

// ------------------------------------------------------------------------------ point fixe K2e2

/** Section UPN d'aile b (catalogue : 45 → UPN 80 … 90 → UPN 260). */
const UPN_OF_FLANGE: Record<number, string> = {
  45: "UPN 80",
  50: "UPN 100",
  55: "UPN 120",
  60: "UPN 140",
  65: "UPN 160",
  70: "UPN 180",
  75: "UPN 200",
  80: "UPN 220",
  85: "UPN 240",
  90: "UPN 260",
};

/** Réponse simulée d'un modèle : aile de la section retenue, violations par règle. */
interface FakeAnswer {
  readonly b: number;
  readonly violations?: Readonly<Record<string, number>>;
}

/** Modèle réduit simulé (pièce de limon profilé de la section d'aile b, contrôle de conception). */
function fakeModel(a: FakeAnswer): ProfileNewelModel {
  const results = Object.entries(a.violations ?? {}).flatMap(([ruleId, n]) =>
    Array.from({ length: n }, () => ({ ruleId, status: "violation" })),
  );
  // Un résultat `ok` d'une règle quelconque : jamais compté.
  results.push({ ruleId: "FAB_PROFILE_HAUTEUR", status: "ok" });
  return {
    parts: [
      {
        category: "stringer",
        section: { key: "structure.steelProfile.section", params: { section: UPN_OF_FLANGE[a.b] } },
      },
    ],
    compliance: { results },
  } as unknown as ProfileNewelModel;
}

const newelKey = (p: Project): string => {
  const t = p.stair.layout.turns[0]!.inner;
  return t.kind === "newel" ? `${t.size}/${t.offset ?? 0}` : t.kind;
};
const lineOf = (p: Project): string =>
  String((p.stair.structure.params as Record<string, unknown>)["stringerLine"] ?? "chord");

/**
 * `build` simulée : réponse par ligne d'appui et par poteau (`100/0` : poteau par défaut) ; trace
 * des modèles construits (« ligne poteau »).
 */
function fakeBuild(answers: {
  readonly nosing: Readonly<Record<string, FakeAnswer>>;
  readonly chord: Readonly<Record<string, FakeAnswer>>;
}) {
  const trace: string[] = [];
  const build = (p: Project): ProfileNewelModel => {
    const line = lineOf(p) === "nosing" ? "nosing" : "chord";
    const key = newelKey(p);
    trace.push(`${line} ${key}`);
    const a = answers[line][key];
    if (!a) throw new Error(`réponse manquante : ${line} ${key}`);
    return fakeModel(a);
  };
  return { build, trace };
}

describe("resolveProfileNewel — point fixe du limon coudé (K2e2 : K-Q15, K-Q19, K-Q20, K-Q21)", () => {
  const base = createProject("quarter-left");
  const project = (params: Record<string, unknown>): Project => ({
    ...base,
    stair: { ...base.stair, structure: { kind: "steel-profile", params } },
  });
  const NOSING = project({ family: "UPN", stringerLine: "nosing" });
  const CHORD = project({ family: "UPN" });
  const all = (): boolean => true;
  const n = (size: number, offset: number) => ({ kind: "newel" as const, size, offset });
  const BUDGET = PROFILE_NEWEL_ITERATIONS + PROFILE_NEWEL_VERIFICATIONS;
  /** Barre droite : point fixe exact 130 / 45 au deuxième modèle, sans violation. */
  const chordExact130 = { "100/0": { b: 90 }, "130/45": { b: 90 } };

  it("famille des poteaux UPN : 85 / 23 … 130 / 45, triés, acceptés par le tracé du quart", () => {
    const fam = profileNewelFamily("steel-profile", { family: "UPN" });
    expect(fam.map((x) => `${x.size}/${x.offset}`)).toEqual([
      "85/23",
      "90/25",
      "95/28",
      "100/30",
      "105/33",
      "110/35",
      "115/38",
      "120/40",
      "125/43",
      "130/45",
    ]);
    for (const x of fam) expect(layoutAccepts(withNewels(NOSING, x, all))).toBe(true);
    expect(profileNewelFamily("steel-flat", {})).toEqual([]);
  });

  it("violations ajoutées : compteurs par règle, toutes sévérités, `ok` ignoré, FAB_ONGLET_RACCORD exempté (K-Q21)", () => {
    const m = fakeModel({
      b: 70,
      violations: { G_COLLET_MONOTONE: 2, FAB_SUPPORT_LONGUEUR_MIN: 3, FAB_ONGLET_RACCORD: 4 },
    });
    expect(violationCounts(m)).toEqual(
      new Map([
        ["G_COLLET_MONOTONE", 2],
        ["FAB_SUPPORT_LONGUEUR_MIN", 3],
        ["FAB_ONGLET_RACCORD", 4],
      ]),
    );
    const ref = new Map([
      ["FAB_SUPPORT_LONGUEUR_MIN", 3],
      ["G_COLLET_MONOTONE", 1],
    ]);
    expect(addedViolations(m, ref)).toEqual(new Map([["G_COLLET_MONOTONE", 1]]));
    expect(PROFILE_NEWEL_EXEMPT_RULES).toEqual(["FAB_ONGLET_RACCORD"]);
    expect(addedViolations(m, ref, [])).toEqual(
      new Map([
        ["G_COLLET_MONOTONE", 1],
        ["FAB_ONGLET_RACCORD", 4],
      ]),
    );
  });

  it("barre droite : suite de modèles et résultat de l'algorithme d'origine (aucun `verified`)", () => {
    // Oracle de l'algorithme d'origine (HEAD) : 100 → UPN 220 (120 / 40), 120 / 40 → UPN 200
    // (reçu, non exact), 115 / 38 → UPN 220 (déjà essayé) : poteau gardé 120 / 40.
    const { build, trace } = fakeBuild({
      nosing: {},
      chord: { "100/0": { b: 80 }, "120/40": { b: 75 }, "115/38": { b: 80 } },
    });
    expect(resolveProfileNewel(CHORD, all, build)).toEqual({ newel: n(120, 40), flangeWidth: 75 });
    expect(trace).toEqual(["chord 100/0", "chord 120/40", "chord 115/38"]);
  });

  it("K-Q19 : poteau exact qui ajoute une violation écarté, montée au poteau de la barre droite ; K-Q20 : poteau plus petit vérifié et retenu", () => {
    const { build, trace } = fakeBuild({
      nosing: {
        "100/0": { b: 70 },
        "110/35": { b: 70, violations: { G_COLLET_MONOTONE: 1, FAB_SUPPORT_LONGUEUR_MIN: 1 } },
        "130/45": { b: 75 },
        "115/38": { b: 75 },
      },
      chord: chordExact130,
    });
    expect(resolveProfileNewel(NOSING, all, build)).toEqual({
      newel: n(115, 38),
      flangeWidth: 75,
      verified: true,
    });
    expect(trace.filter((t) => t.startsWith("nosing"))).toEqual([
      "nosing 100/0",
      "nosing 110/35",
      "nosing 130/45",
      "nosing 115/38",
    ]);
    expect(trace.filter((t) => t.startsWith("chord"))).toEqual(["chord 100/0", "chord 130/45"]);
  });

  it("K-Q20 refusé (violation ajoutée) : poteau gardé (K-Q15) ; poteau de la référence jugé sur le modèle de la base, sans modèle de plus", () => {
    const { build, trace } = fakeBuild({
      nosing: {
        "100/0": { b: 70 },
        "110/35": { b: 70, violations: { G_COLLET_MONOTONE: 1 } },
        "130/45": { b: 75 },
        "115/38": { b: 75, violations: { FAB_MARCHE_PORTEE: 1 } },
        "120/40": { b: 75, violations: { FAB_MARCHE_PORTEE: 1 } },
      },
      chord: chordExact130,
    });
    expect(resolveProfileNewel(NOSING, all, build)).toEqual({
      newel: n(130, 45),
      flangeWidth: 75,
      verified: true,
    });
    // 110 / 35 écarté → base (coudé à 130 / 45, poteau de la référence) → 130 / 45 jugé sans
    // modèle de plus, gardé ; 115 / 38 écarté ; vérification K-Q20 sur 120 / 40, écartée.
    expect(trace).toEqual([
      "nosing 100/0",
      "nosing 110/35",
      "chord 100/0",
      "chord 130/45",
      "nosing 130/45",
      "nosing 115/38",
      "nosing 120/40",
    ]);
  });

  it("base de comparaison : une violation que le coudé crée aussi au poteau de la référence n'écarte pas un poteau", () => {
    // Le coudé ajoute un débord d'appui à la barre droite quel que soit le poteau (lecture de
    // « ajoute » de K-Q19) : 110 / 35 n'en ajoute pas au coudé à 130 / 45, il est retenu.
    const { build, trace } = fakeBuild({
      nosing: {
        "100/0": { b: 70, violations: { FAB_SUPPORT_DEBORD: 1 } },
        "110/35": { b: 70, violations: { FAB_SUPPORT_DEBORD: 1 } },
        "130/45": { b: 75, violations: { FAB_SUPPORT_DEBORD: 1 } },
      },
      chord: chordExact130,
    });
    expect(resolveProfileNewel(NOSING, all, build)).toEqual({
      newel: n(110, 35),
      flangeWidth: 70,
      verified: true,
    });
    expect(trace).toEqual([
      "nosing 100/0",
      "nosing 110/35",
      "chord 100/0",
      "chord 130/45",
      "nosing 130/45",
    ]);
  });

  it("K-Q20 : dernier poteau non vérifié (plafond de trois modèles), modèle de vérification de plus retenu (cas j5b)", () => {
    const { build, trace } = fakeBuild({
      nosing: {
        "100/0": { b: 70 },
        "110/35": { b: 80 },
        "120/40": { b: 85 },
        "125/43": { b: 75 },
      },
      chord: chordExact130,
    });
    expect(resolveProfileNewel(NOSING, all, build)).toEqual({
      newel: n(125, 43),
      flangeWidth: 75,
      verified: true,
    });
    expect(trace.filter((t) => t.startsWith("nosing"))).toHaveLength(BUDGET);
  });

  it("K-Q20 non vérifié non plus : dernier poteau attendu, `verified` faux", () => {
    const { build } = fakeBuild({
      nosing: {
        "100/0": { b: 70 },
        "110/35": { b: 80 },
        "120/40": { b: 85 },
        "125/43": { b: 90 },
      },
      chord: chordExact130,
    });
    expect(resolveProfileNewel(NOSING, all, build)).toEqual({
      newel: n(125, 43),
      flangeWidth: 85,
      verified: false,
    });
  });

  it("K-Q19 : poteau écarté, montée au poteau de la référence jugé sur le modèle de la base (sans modèle de plus)", () => {
    const { build, trace } = fakeBuild({
      nosing: {
        "100/0": { b: 70 },
        "110/35": { b: 70, violations: { G_COLLET_MONOTONE: 1, FAB_SUPPORT_LONGUEUR_MIN: 1 } },
        "130/45": { b: 90, violations: { G_COLLET_MONOTONE: 1 } },
      },
      chord: chordExact130,
    });
    // Base = coudé à 130 / 45 (G_COLLET_MONOTONE 1) : 110 / 35 ajoute FAB_SUPPORT_LONGUEUR_MIN.
    expect(resolveProfileNewel(NOSING, all, build)).toEqual({
      newel: n(130, 45),
      flangeWidth: 90,
      verified: true,
    });
    expect(trace.filter((t) => t.startsWith("nosing"))).toEqual([
      "nosing 100/0",
      "nosing 110/35",
      "nosing 130/45",
    ]);
  });

  it("aucun poteau retenu (K-Q25) : jour de la barre droite (110 / 35, non vérifié en coudé), règles ajoutées par les poteaux écartés", () => {
    const { build } = fakeBuild({
      nosing: {
        "100/0": { b: 80 },
        "120/40": { b: 80, violations: { G_COLLET_MONOTONE: 1 } },
        "110/35": { b: 85 },
        "125/43": { b: 85, violations: { G_COLLET_MONOTONE: 2 } },
        "130/45": { b: 90, violations: { G_COLLET_MONOTONE: 1 } },
      },
      // Barre droite : point fixe exact 110 / 35 au deuxième modèle, sans violation.
      chord: { "100/0": { b: 70 }, "110/35": { b: 70 } },
    });
    // 110 / 35 en coudé : aile 85, non reçue ; 120 / 40, 125 / 43 et 130 / 45 écartés : le jour
    // de la barre droite (110 / 35, posé sur le jour vif du quart) est rendu, plus de « moindre
    // excédent » (K-Q25, K2f).
    const r = resolveProfileNewel(NOSING, all, build)!;
    expect(r).toMatchObject({ newel: n(110, 35), flangeWidth: 85, verified: false });
    expect(r.chordJour!.turns).toEqual([n(110, 35)]);
    expect(r.chordJour!.rules).toEqual(["G_COLLET_MONOTONE"]);
    expect(r.chordJour!.notes.map((m) => m.key)).toEqual(["project.structureChoice.change"]);
  });

  it("FAB_ONGLET_RACCORD en excédent ne fait pas écarter un poteau (K-Q21)", () => {
    const { build } = fakeBuild({
      nosing: { "100/0": { b: 70 }, "110/35": { b: 70, violations: { FAB_ONGLET_RACCORD: 2 } } },
      chord: chordExact130,
    });
    expect(resolveProfileNewel(NOSING, all, build)).toEqual({
      newel: n(110, 35),
      flangeWidth: 70,
      verified: true,
    });
  });

  it("propriété : ne lève jamais, jamais `null`, budgets tenus, poteau retenu construit ⇒ résultat retenu, `verified` ⇒ reçoit l'aile de son modèle", () => {
    const fam = profileNewelFamily("steel-profile", { family: "UPN" });
    const keys = ["100/0", ...fam.map((x) => `${x.size}/${x.offset}`)];
    const flanges = Object.keys(UPN_OF_FLANGE).map(Number);
    const answerArb = fc.record({
      b: fc.constantFrom(...flanges),
      violations: fc.record({
        G_COLLET_MONOTONE: fc.nat({ max: 2 }),
        FAB_SUPPORT_LONGUEUR_MIN: fc.nat({ max: 2 }),
        FAB_ONGLET_RACCORD: fc.nat({ max: 2 }),
      }),
    });
    const mapArb = fc.tuple(...keys.map(() => answerArb));
    // Barre droite : mêmes violations quel que soit le poteau (référence connue du test).
    const refViolations = { G_COLLET_MONOTONE: 1, FAB_SUPPORT_LONGUEUR_MIN: 1 };
    fc.assert(
      fc.property(mapArb, fc.tuple(...keys.map(() => fc.constantFrom(...flanges))), (nos, chs) => {
        const nosing = Object.fromEntries(keys.map((k, i) => [k, nos[i]!]));
        const chord = Object.fromEntries(
          keys.map((k, i) => [k, { b: chs[i]!, violations: refViolations }]),
        );
        const { build, trace } = fakeBuild({ nosing, chord });
        const r = resolveProfileNewel(NOSING, all, build);
        expect(r).not.toBeNull();
        const nosingBuilt = trace.filter((t) => t.startsWith("nosing")).map((t) => t.slice(7));
        // Point fixe + vérification + modèle coudé de la base ; point fixe de la barre droite +
        // modèle de la référence posée (poteau final du point fixe, s'il n'a pas été construit).
        expect(nosingBuilt.length).toBeLessThanOrEqual(BUDGET + 1);
        expect(trace.filter((t) => t.startsWith("chord")).length).toBeLessThanOrEqual(
          PROFILE_NEWEL_ITERATIONS + 1,
        );
        // Aucun modèle construit deux fois (cache de l'appel).
        expect(new Set(trace).size).toBe(trace.length);
        const params = NOSING.stair.structure.params;
        // Base de l'oracle : maximum de la barre droite et du coudé au poteau de la référence
        // (point fixe de la barre droite, posé sur le jour vif du quart).
        const rc = resolveProfileNewel(CHORD, all, fakeBuild({ nosing: {}, chord }).build)!;
        const rcKey = `${rc.newel.size}/${rc.newel.offset ?? 0}`;
        const ref = new Map(Object.entries(refViolations));
        for (const [rule, v] of Object.entries(nosing[rcKey]!.violations ?? {})) {
          ref.set(rule, Math.max(v, ref.get(rule) ?? 0));
        }
        const retained = (k: string): boolean => {
          const a = nosing[k]!;
          const [size, offset] = k.split("/").map(Number);
          return (
            newelSatisfies(n(size!, offset!), "steel-profile", params, a.b) &&
            addedViolations(fakeModel(a), ref).size === 0
          );
        };
        const key = `${r!.newel.size}/${r!.newel.offset ?? 0}`;
        if (r!.verified) {
          expect(nosingBuilt).toContain(key);
          expect(r!.flangeWidth).toBe(nosing[key]!.b);
          expect(newelSatisfies(r!.newel, "steel-profile", params, r!.flangeWidth)).toBe(true);
        }
        // Poteau retenu construit (hors poteau de départ, jamais jugé) ⇒ résultat retenu ; avec
        // K-Q25, le poteau de la référence (modèle de la base) peut l'être par le jour gardé.
        if (nosingBuilt.slice(1).some(retained)) {
          expect(r!.verified).toBe(true);
          expect(retained(key)).toBe(true);
          if (r!.chordJour) expect(key).toBe(rcKey);
        }
        // K-Q25 : jour de la barre droite (poteau de son point fixe posé sur le jour vif), règles
        // = union des règles ajoutées par les poteaux construits, reçus et non retenus.
        if (r!.chordJour) {
          expect(r!.chordJour.turns).toEqual([rc.newel]);
          expect(r!.newel).toEqual(rc.newel);
          const rules = new Set<string>();
          for (const k of nosingBuilt.slice(1)) {
            const a = nosing[k]!;
            const [size, offset] = k.split("/").map(Number);
            if (!newelSatisfies(n(size!, offset!), "steel-profile", params, a.b)) continue;
            for (const rule of addedViolations(fakeModel(a), ref).keys()) rules.add(rule);
          }
          expect(r!.chordJour.rules).toEqual([...rules].sort());
          expect(r!.chordJour.rules.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
