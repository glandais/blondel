import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { translatorFor, type Message } from "@blondel/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Project } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { SteelProfileParamsSchema, profileNewelFits } from "../structures/steelProfile.js";
import { DEFAULT_NEWEL_SIZE, suggestFixes } from "./fixes.js";
import {
  layoutAccepts,
  newelRequiredStructures,
  newelSatisfies,
  profileNewelFamily,
  withNewels,
} from "./newel.js";
import { toCageLayout, toFlightsLayout } from "./layoutConversion.js";
import { parseProjectText } from "./parse.js";
import { createDemoProject } from "./presetDemo.js";
import { ALL_PRESET_IDS, createProject, PRESET_IDS } from "./presets.js";
import {
  PROFILE_NEWEL_EXEMPT_RULES,
  PROFILE_NEWEL_ITERATIONS,
  PROFILE_NEWEL_VERIFICATIONS,
  addedViolations,
  applyStructureChoice,
  explicitStructureParams,
  hasBrokenNosingLine,
  isTurningLayout,
  resolveProfileNewel,
  stringerLineOnTurn,
  violationCounts,
  type ProfileNewelModel,
} from "./structureChoice.js";

beforeEach(() => clearModelCache());

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
const withNosingOverrides = (p: Project, nosingOverrides: Project["stair"]["nosingOverrides"]) => ({
  ...p,
  stair: { ...p.stair, nosingOverrides },
});

describe("stringerLineOnTurn : ligne d'appui écrite au passage d'une volée droite à un tournant (K-Q36, sous-lot K2h) ou au premier nez imposé incliné (K-Q39 option a, sous-lot K2i)", () => {
  // Préréglages (volées, hélicoïdal), cages saisies (démo à palier droit, exemple relu) et
  // escalier droit converti en cage à un seul tronçon (relecture K2h). Variantes de l'escalier
  // droit à nez retouchés (K-Q39 option a, sous-lot K2i), placées avant les trois cages pour que
  // les `examples` de la propriété gardent leurs indices.
  const straightCage = toCageLayout(createProject("straight"))!;
  const straight = createProject("straight");
  const TILTED = [
    withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: 8 }]),
    withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: 0 }]),
    withNosingOverrides(straight, [{ kind: "fixed", index: 4 }]),
    withNosingOverrides(straight, [
      { kind: "angle", index: 4, angle: 8 },
      { kind: "angle", index: 4, angle: 0 },
    ]),
  ];
  const BASES = [
    ...ALL_PRESET_IDS.map((id) => createProject(id)),
    ...TILTED,
    createDemoProject("demo-cage-landing-steel"),
    loadExample("cage-palier-droit.blondel.json"),
    straightCage,
  ];
  const withStructure = (p: Project, kind: string, params: Record<string, unknown>): Project => ({
    ...p,
    stair: { ...p.stair, structure: { kind, params } },
  });

  it("isTurningLayout : volées droites faux, volées à tournant vrai, hélicoïdal faux, cage vrai (même à un seul tronçon, convention de l'orchestrateur, QUESTIONS A41 K2h)", () => {
    expect(isTurningLayout(createProject("straight").stair.layout)).toBe(false);
    expect(isTurningLayout(createProject("quarter-left").stair.layout)).toBe(true);
    expect(isTurningLayout(createProject("two-quarters-s").stair.layout)).toBe(true);
    expect(isTurningLayout(createProject("helical").stair.layout)).toBe(false);
    expect(isTurningLayout(createDemoProject("demo-cage-landing-steel").stair.layout)).toBe(true);
    expect(straightCage.stair.layout.kind).toBe("cage");
    expect(
      straightCage.stair.layout.kind === "cage" && straightCage.stair.layout.sections.length,
    ).toBe(1);
    expect(isTurningLayout(straightCage.stair.layout)).toBe(true);
  });

  it("escalier droit en profilés converti en cage (tracé libre) : `nosing` écrit ; retour aux volées droites : inchangé", () => {
    const p = withStructure(createProject("straight"), "steel-profile", { family: "UPN" });
    const cage = toCageLayout(p)!;
    const out = stringerLineOnTurn(p, cage);
    expect(out.stair.structure.params).toEqual({ family: "UPN", stringerLine: "nosing" });
    expect(out.stair.layout).toBe(cage.stair.layout);
    const back = toFlightsLayout(cage)!;
    expect(stringerLineOnTurn(cage, back)).toBe(back);
  });

  it("hasBrokenNosingLine (K-Q39 option a, K2i) : tournant, cage, ou volées droites à nez imposé incliné (dernier angle non nul) ; hélicoïdal jamais", () => {
    const cases: [string, Project, boolean][] = [
      ["droit", straight, false],
      ["droit + fixe@4", withNosingOverrides(straight, [{ kind: "fixed", index: 4 }]), false],
      [
        "droit + 0°@4",
        withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: 0 }]),
        false,
      ],
      [
        "droit + 8°@4",
        withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: 8 }]),
        true,
      ],
      [
        "droit + −8°@4",
        withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: -8 }]),
        true,
      ],
      [
        "droit + [8°, 0°]@4 (dernier appliqué)",
        withNosingOverrides(straight, [
          { kind: "angle", index: 4, angle: 8 },
          { kind: "angle", index: 4, angle: 0 },
        ]),
        false,
      ],
      [
        "droit + [0°, 8°]@4",
        withNosingOverrides(straight, [
          { kind: "angle", index: 4, angle: 0 },
          { kind: "angle", index: 4, angle: 8 },
        ]),
        true,
      ],
      [
        "droit + 8°@999 (orphelin compté, convention de l'implémenteur K2i, à valider)",
        withNosingOverrides(straight, [{ kind: "angle", index: 999, angle: 8 }]),
        true,
      ],
      [
        "droit + 6°@0 (nez de départ, jamais appliqué par le découpage, compté : même convention)",
        withNosingOverrides(straight, [{ kind: "angle", index: 0, angle: 6 }]),
        true,
      ],
      [
        "droit + −0°@4 (angle nul)",
        withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: -0 }]),
        false,
      ],
      ["quart gauche", createProject("quarter-left"), true],
      [
        "hélicoïdal + 8°@4 (retouches ignorées)",
        withNosingOverrides(createProject("helical"), [{ kind: "angle", index: 4, angle: 8 }]),
        false,
      ],
      ["cage à un seul tronçon", straightCage, true],
    ];
    for (const [label, p, expected] of cases) {
      expect([label, hasBrokenNosingLine(p.stair)]).toEqual([label, expected]);
    }
    // Sans retouche, le prédicat est exactement `isTurningLayout`.
    for (const p of [...ALL_PRESET_IDS.map((id) => createProject(id)), straightCage]) {
      expect(p.stair.nosingOverrides).toEqual([]);
      expect(hasBrokenNosingLine(p.stair)).toBe(isTurningLayout(p.stair.layout));
    }
  });

  it("K-Q39 : premier nez imposé incliné d'un escalier droit en profilés : `nosing` écrit ; sinon le même objet", () => {
    const p = withStructure(straight, "steel-profile", { family: "UPN" });
    const tilted = withNosingOverrides(p, [{ kind: "angle", index: 4, angle: 8 }]);
    const out = stringerLineOnTurn(p, tilted);
    expect(out.stair.structure).toEqual({
      kind: "steel-profile",
      params: { family: "UPN", stringerLine: "nosing" },
    });
    expect({ ...out, stair: { ...out.stair, structure: tilted.stair.structure } }).toEqual(tilted);
    // Tracé précédent déjà à ligne brisée (second nez incliné) : rien n'est écrit.
    const second = withNosingOverrides(tilted, [
      ...tilted.stair.nosingOverrides,
      { kind: "angle", index: 6, angle: -5 },
    ]);
    expect(stringerLineOnTurn(tilted, second)).toBe(second);
    // Retrait des retouches : rien n'est retiré ni écrit.
    const removed = withNosingOverrides(tilted, []);
    expect(stringerLineOnTurn(tilted, removed)).toBe(removed);
    // `chord` jamais remplacé.
    const chordParams = { family: "UPN", stringerLine: "chord" };
    const chord = withStructure(tilted, "steel-profile", chordParams);
    expect(stringerLineOnTurn(withStructure(p, "steel-profile", chordParams), chord)).toBe(chord);
    // Angle nul : face à une seule pente, rien n'est écrit.
    const zero = withNosingOverrides(p, [{ kind: "angle", index: 4, angle: 0 }]);
    expect(stringerLineOnTurn(p, zero)).toBe(zero);
  });

  it("K-Q36 conservée (relecture K2i) : un droit déjà incliné sans ligne d'appui (fichier enregistré avant K2i, ou profilés choisis avant le premier nez incliné) qui devient tournant ou cage reçoit `nosing`", () => {
    const tilted = withStructure(
      withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: 8 }]),
      "steel-profile",
      { family: "UPN" },
    );
    const targets: [string, Project][] = [
      ...ALL_PRESET_IDS.filter((id) => isTurningLayout(createProject(id).stair.layout)).map(
        (id): [string, Project] => [
          id,
          { ...tilted, stair: { ...tilted.stair, layout: createProject(id).stair.layout } },
        ],
      ),
      ["cage", toCageLayout(tilted)!],
    ];
    expect(targets.length).toBeGreaterThan(2);
    for (const [label, next] of targets) {
      expect([label, stringerLineOnTurn(tilted, next).stair.structure.params]).toEqual([
        label,
        { family: "UPN", stringerLine: "nosing" },
      ]);
    }
  });

  it("explicitStructureParams (K-Q39 option a) : `nosing` écrit au choix neuf des profilés sur un droit à nez incliné, jamais sur un droit à une seule pente", () => {
    const tilted = withNosingOverrides(straight, [{ kind: "angle", index: 4, angle: 8 }]);
    expect(explicitStructureParams(tilted, "steel-profile", { family: "UPN" })).toEqual({
      family: "UPN",
      stringerLine: "nosing",
    });
    const chord = { family: "UPN", stringerLine: "chord" };
    expect(explicitStructureParams(tilted, "steel-profile", chord)).toBe(chord);
    const flat = { family: "UPN" };
    expect(explicitStructureParams(tilted, "steel-flat", flat)).toBe(flat);
    expect(explicitStructureParams(straight, "steel-profile", flat)).toBe(flat);
    const params = applyStructureChoice(tilted, "steel-profile", { family: "UPN" }).project.stair
      .structure.params;
    expect(params).toMatchObject({ family: "UPN", stringerLine: "nosing" });
  });

  // L'identité du modèle découle de celle du projet : le plugin et le pipeline ne changent pas
  // en K2i (diff de `steelProfile.ts` limité aux commentaires).
  it("propriété I1 : escalier droit à une seule pente (retouches `fixed`, angle nul ou −0, dernier angle nul) : paramètres et projet inchangés", () => {
    const override = fc.oneof(
      fc.record({ kind: fc.constant("fixed" as const), index: fc.nat({ max: 20 }) }),
      fc.record({
        kind: fc.constant("angle" as const),
        index: fc.nat({ max: 20 }),
        angle: fc.constantFrom(0, -0),
      }),
      // Un nez incliné puis remis à zéro : le dernier angle compte.
      fc.tuple(fc.nat({ max: 20 }), fc.integer({ min: -30, max: 30 })).map(([index, angle]) => [
        { kind: "angle" as const, index, angle },
        { kind: "angle" as const, index, angle: 0 },
      ]),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 2400, max: 3200 }),
        fc.integer({ min: 700, max: 1100 }),
        fc.array(override, { maxLength: 4 }),
        fc.constantFrom("steel-profile", "steel-flat", "wood-housed"),
        fc.constantFrom<Record<string, unknown>>({}, { family: "UPN" }, { stringerLine: "chord" }),
        (floorToFloor, width, drawn, kind, params) => {
          const base = createProject("straight", { floorToFloor, width });
          const p = withNosingOverrides(base, drawn.flat());
          expect(hasBrokenNosingLine(p.stair)).toBe(false);
          expect(explicitStructureParams(p, kind, params)).toBe(params);
          const before = withStructure(base, kind, params);
          const after = withStructure(p, kind, params);
          expect(stringerLineOnTurn(before, after)).toBe(after);
        },
      ),
      { numRuns: RUNS },
    );
    const chosen = applyStructureChoice(
      withNosingOverrides(createProject("straight"), [{ kind: "angle", index: 4, angle: 0 }]),
      "steel-profile",
      { family: "UPN" },
    ).project.stair.structure.params;
    expect(Object.hasOwn(chosen, "stringerLine")).toBe(false);
  });

  // Oracle indépendant de la ligne des nez brisée (le dernier angle d'un nez compte, hélicoïdal
  // exclu), pour ne pas prendre le prédicat testé comme son propre oracle.
  const tiltedOracle = (p: Project): boolean => {
    if (p.stair.layout.kind === "helical") return false;
    const last = new Map<number, number>();
    for (const o of p.stair.nosingOverrides) if (o.kind === "angle") last.set(o.index, o.angle);
    return [...last.values()].some((a) => a !== 0);
  };
  const brokenOracle = (p: Project): boolean => isTurningLayout(p.stair.layout) || tiltedOracle(p);

  it("propriété : écriture de `nosing` si et seulement si profilés sans ligne d'appui et passage à un tournant (K-Q36) ou d'une seule pente à une ligne des nez brisée (K-Q39) ; sinon le même objet", () => {
    let written = 0;
    let writtenCage = 0;
    let writtenTilted = 0;
    let writtenTiltedToTurn = 0;
    fc.assert(
      fc.property(
        fc.nat({ max: BASES.length - 1 }),
        fc.nat({ max: BASES.length - 1 }),
        fc.constantFrom("steel-profile", "steel-flat", "wood-housed", "none"),
        fc.constantFrom<Record<string, unknown>>(
          {},
          { family: "UPN" },
          { family: "IPE", stringerLine: "chord" },
          { stringerLine: "nosing" },
        ),
        (i, j, kind, params) => {
          const previous = withStructure(BASES[i]!, kind, params);
          const next = withStructure(BASES[j]!, kind, params);
          const out = stringerLineOnTurn(previous, next);
          const expected =
            kind === "steel-profile" &&
            !Object.hasOwn(params, "stringerLine") &&
            ((!isTurningLayout(previous.stair.layout) && isTurningLayout(next.stair.layout)) ||
              (!brokenOracle(previous) && brokenOracle(next)));
          if (!expected) {
            expect(out).toBe(next);
            return;
          }
          written++;
          if (next.stair.layout.kind === "cage") writtenCage++;
          if (!isTurningLayout(next.stair.layout)) writtenTilted++;
          if (tiltedOracle(previous) && isTurningLayout(next.stair.layout)) writtenTiltedToTurn++;
          expect(out.stair.structure).toEqual({
            kind,
            params: { ...params, stringerLine: "nosing" },
          });
          expect({ ...out, stair: { ...out.stair, structure: next.stair.structure } }).toEqual(
            next,
          );
          // `chord` jamais remplacé, et une seconde application ne change plus rien.
          expect(stringerLineOnTurn(previous, out)).toBe(out);
        },
      ),
      {
        numRuns: RUNS,
        // Passages d'un escalier droit à chacune des trois cages et au droit à nez incliné de
        // 8° (K-Q39), et du droit incliné au quart tournant (K-Q36), toujours exercés.
        examples: [
          ...[BASES.length - 3, BASES.length - 2, BASES.length - 1, ALL_PRESET_IDS.length].map(
            (j): [number, number] => [ALL_PRESET_IDS.indexOf("straight"), j],
          ),
          [ALL_PRESET_IDS.length, ALL_PRESET_IDS.indexOf("quarter-left")] as [number, number],
        ].map(([i, j]): [number, number, string, Record<string, unknown>] => [
          i,
          j,
          "steel-profile",
          { family: "UPN" },
        ]),
      },
    );
    expect(written).toBeGreaterThan(0);
    expect(writtenCage).toBeGreaterThanOrEqual(3);
    expect(writtenTilted).toBeGreaterThanOrEqual(1);
    expect(writtenTiltedToTurn).toBeGreaterThanOrEqual(1);
  });

  it("projet de forme inattendue (non validé) : rendu tel quel, sans lever", () => {
    const p = createProject("straight");
    const broken = { ...p, stair: { ...p.stair, layout: undefined } } as unknown as Project;
    const profiles = withStructure(broken, "steel-profile", {});
    expect(stringerLineOnTurn(p, profiles)).toBe(profiles);
    expect(stringerLineOnTurn(profiles, profiles)).toBe(profiles);
  });
});

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
/** Ligne d'appui lue sur les paramètres complétés par les défauts (`nosing` depuis K2d). */
const lineOf = (p: Project): string =>
  SteelProfileParamsSchema.parse(p.stair.structure.params).stringerLine;

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
  const CHORD = project({ family: "UPN", stringerLine: "chord" });
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
    // K-Q29 : le coudé au jour gardé (110 / 35) n'ajoute rien à la barre droite (remarque neutre).
    expect(r.chordJour!.keptAdds).toEqual([]);
  });

  it("K-Q29 : le jour gardé qui ajoute encore une violation à la barre droite la nomme (`keptAdds`, FAB_ONGLET_RACCORD exempté), sans modèle de plus", () => {
    const { build, trace } = fakeBuild({
      nosing: {
        "100/0": { b: 80 },
        "120/40": { b: 80, violations: { FAB_SUPPORT_DEBORD: 1, G_COLLET_MONOTONE: 1 } },
        // Coudé au jour de la barre droite : FAB_SUPPORT_DEBORD (que la barre droite n'a pas)
        // et FAB_ONGLET_RACCORD (exempté, K-Q21).
        "110/35": { b: 85, violations: { FAB_SUPPORT_DEBORD: 1, FAB_ONGLET_RACCORD: 1 } },
        "125/43": { b: 85, violations: { FAB_SUPPORT_DEBORD: 1, G_COLLET_MONOTONE: 2 } },
        "130/45": { b: 90, violations: { FAB_SUPPORT_DEBORD: 1, G_COLLET_MONOTONE: 1 } },
      },
      chord: { "100/0": { b: 70 }, "110/35": { b: 70 } },
    });
    const r = resolveProfileNewel(NOSING, all, build)!;
    expect(r.chordJour!.rules).toEqual(["G_COLLET_MONOTONE"]);
    expect(r.chordJour!.keptAdds).toEqual(["FAB_SUPPORT_DEBORD"]);
    // Le modèle du jour gardé est celui de la base : construit une seule fois.
    expect(trace.filter((t) => t === "nosing 110/35")).toHaveLength(1);
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
          // K-Q29 (vérification de K2d), rappel vrai par construction (max(a, b) ≥ b), qui ne
          // teste pas le code : comparé à la base K-Q24 entière, le coudé au jour gardé n'ajoute
          // jamais rien (il en est le second terme) ; la remarque `newelAddsViolations` serait
          // inatteignable. Seule la barre droite, premier terme de la base, est comparée (testé
          // ci-dessous sur `keptAdds`).
          expect(addedViolations(fakeModel(nosing[rcKey]!), ref).size).toBe(0);
          // K-Q29 : règles que le coudé au jour gardé ajoute à la barre droite (seule).
          expect(r!.chordJour.keptAdds).toEqual(
            [
              ...addedViolations(
                fakeModel(nosing[rcKey]!),
                new Map(Object.entries(refViolations)),
              ).keys(),
            ].sort(),
          );
        }
      }),
      { numRuns: RUNS },
    );
  });
});
