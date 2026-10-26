/**
 * Limon coudé câblé dans `steel-profile` (sous-lot K2b, paramètre `stringerLine`) sur des
 * escaliers réels : paramètres rétrocompatibles, `chord` sans nouveau chemin, escaliers droits
 * identiques en `nosing` (CK7), critères de fin de K2b (j3c, j5b du comparateur, onglets au bout
 * d'aile, hauteur de poteau, point fixe section ↔ poteau), non-régression par rapport à la barre
 * droite grâce au repli par face (K-Q12, K-Q13) et propriété sur escaliers générés ; cornière au
 * coin du mur (K-Q4, K2e ; K-Q16 à K-Q21, K2e2) : critères de fin, comparaison par règle à la
 * barre droite du même projet, marche sans appui côté jour et paliers gardant toutes leurs
 * cornières, cornières retirées absentes des sorties, invariants dans les propriétés ; point fixe
 * section ↔ poteau (K-Q19, K-Q20).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dec, msg, textMessage, translatorFor, type Message } from "@blondel/i18n";
import { CAGE_FEATURE_LABELS } from "../model/cageFeatures.js";
import { findSection, sectionPerimeter, sectionsOf } from "../catalog/sections.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import type { Model } from "../model/derived.js";
import { PROJECT_SCHEMA_VERSION, ProjectSchema, type Project } from "../model/project.js";
import { checkSolids } from "../parts/solidChecks.js";
import { buildModel } from "../pipeline/build.js";
import {
  expectedNewel,
  newelMatches,
  newelSatisfies,
  withNewels,
  type NewelInner,
} from "../project/newel.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import {
  PROFILE_NEWEL_ITERATIONS,
  PROFILE_NEWEL_VERIFICATIONS,
  applyStructureChoice,
  resolveProfileNewel,
} from "../project/structureChoice.js";
import { precheckModel } from "../precheck/stringers.js";
import {
  ALL_TYPOLOGIES,
  SAME_SIDE_TYPOLOGIES,
  makeSteppingProject,
  stairArb,
} from "../stepping/test-helpers.js";
import { adaptJour } from "./compare.js";
import { fitInWebPolyline, polylineAt, riveFns } from "./profileBearing.js";
import { StructureError, registerStructure } from "./registry.js";
import {
  STEEL_PROFILE,
  STEEL_PROFILE_CAGE,
  SteelProfileParamsSchema,
  buildSteelProfile,
  profileFlangeWidth,
  profileNewelFits,
  type SteelProfileResult,
} from "./steelProfile.js";
import { cornerSupportKey } from "./steelProfileCranked.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
const RUNS = Math.min(Number(process.env["STEPPING_RUNS"] ?? 20), 100);
type Line = "chord" | "nosing";

const withParams = (p: Project, params: Record<string, unknown>): Project => ({
  ...p,
  stair: { ...p.stair, structure: { kind: "steel-profile", params } },
});
/** Même projet, ligne d'appui `line` (autres paramètres conservés). */
const withLine = (p: Project, line: Line): Project =>
  withParams(p, { ...p.stair.structure.params, stringerLine: line });
const choose = (p: Project, params: Record<string, unknown> = { family: "UPN" }): Project =>
  applyStructureChoice(p, "steel-profile", params).project;

/**
 * Plugin d'essai « barre droite qui accepte le palier droit » (K2f) : la vraie barre droite
 * refuse le palier droit d'une cage (`structure.cageUnsupported`) ; la référence des critères
 * « aucune règle de plus que la barre droite » sur ces cages est ce plugin, même code que
 * `steel-profile`, garde-fou levé. Son nom (`kind`) diffère : les branches qui testent le nom
 * de la structure (`newel.ts`, `compare.ts`, `fixes.ts`) ne portent que sur les tournants de
 * volées, jamais sur une cage saisie ; un test vérifie qu'il rend le même modèle que
 * `steel-profile` sur une cage sans palier.
 */
const REF_KIND = "steel-profile-k2f-ref";
registerStructure(
  {
    ...STEEL_PROFILE,
    kind: REF_KIND,
    capabilities: {
      ...STEEL_PROFILE.capabilities,
      cageWith: undefined,
      cage: [...STEEL_PROFILE_CAGE, "straightLanding"],
    },
  },
  { replace: true },
);
/** Même projet, structure passée au plugin d'essai (paramètres conservés). */
const withRefKind = (p: Project): Project => ({
  ...p,
  stair: { ...p.stair, structure: { ...p.stair.structure, kind: REF_KIND } },
});

interface Run {
  readonly m: Model;
  readonly r: SteelProfileResult;
}
function run(project: Project): Run {
  const m = buildModel(project, { memo: false });
  const params = SteelProfileParamsSchema.parse(project.stair.structure.params);
  return { m, r: buildSteelProfile({ project, layout: m.layout, stepping: m.stepping }, params) };
}
const errorKeys = (x: Run): string[] => (x.m.errors ?? []).map((e) => e.key);
/** Règles du contrôle de conception en violation (identifiants distincts). */
const violations = (x: Run): Set<string> =>
  new Set(x.m.compliance.results.filter((c) => c.status === "violation").map((c) => c.ruleId));
/** Violations de `nosing` absentes de `chord`. */
const newViolations = (chord: Run, nosing: Run): string[] => {
  const known = violations(chord);
  return [...violations(nosing)].filter((r) => !known.has(r));
};
const mass = (x: Run): number => x.r.section?.massPerMeter ?? Infinity;
const reserve = (x: Run): number => x.r.section!.h - x.r.requiredHeight;

/** j5b du comparateur (critère d'acceptation n° 2) : (i) avec les paramètres du mode. */
const j5bComparator = (line: Line): Project => {
  const params = { family: "UPN", stringerLine: line };
  const a = adaptJour(loadExample("j5b-debillarde-soude.blondel.json"), {
    kind: "steel-profile",
    params,
  }).project;
  return withParams(a, params);
};
/** (ii) référence K2a : comparateur en `chord`, puis la ligne d'appui du mode. */
const j5bReference = (line: Line): Project => {
  const a = adaptJour(loadExample("j5b-debillarde-soude.blondel.json"), {
    kind: "steel-profile",
    params: { family: "UPN" },
  }).project;
  return withParams(a, { family: "UPN", stringerLine: line });
};

describe("steel-profile — paramètre stringerLine (K2b)", () => {
  it("défauts `chord` et jarrets 50 mm / 0,5° ; valeur inconnue refusée ; projet ancien lu tel quel", () => {
    const d = SteelProfileParamsSchema.parse({});
    expect(d.stringerLine).toBe("chord");
    expect(d.knee).toEqual({ minSegmentLength: 50, minKneeAngle: 0.5 });
    expect(SteelProfileParamsSchema.safeParse({ stringerLine: "arc" }).success).toBe(false);
    expect(SteelProfileParamsSchema.safeParse({ knee: { minSegmentLength: -1 } }).success).toBe(
      false,
    );
    const old = loadExample("j3c-acceptance-01-upn.blondel.json");
    expect(old.stair.structure.params).not.toHaveProperty("stringerLine");
    expect(SteelProfileParamsSchema.parse(old.stair.structure.params).stringerLine).toBe("chord");
  });

  const tournants: [string, () => Project][] = [
    ["j3c", () => loadExample("j3c-acceptance-01-upn.blondel.json")],
    ["j5b (comparateur)", () => j5bReference("chord")],
    ["quart", () => choose(loadExample("quarter-left.blondel.json"))],
    ["U", () => choose(loadExample("two-quarters-u.blondel.json"))],
    ["cage-60", () => choose(loadExample("cage-60.blondel.json"))],
    ["cage-60-palier-limon", () => choose(loadExample("cage-60-palier-limon.blondel.json"))],
  ];
  for (const [name, make] of tournants) {
    it(`${name} : \`chord\` explicite = paramètre absent, sans plan ni limon coudé`, () => {
      const p = make();
      const absent = run(withParams(p, { ...p.stair.structure.params }));
      const chord = run(withLine(p, "chord"));
      expect(chord.r.output).toEqual(absent.r.output);
      expect(chord.r.cranked).toBeUndefined();
      expect(chord.r.stringers.every((x) => !x.bearing && !x.crankedFallback)).toBe(true);
    });
  }

  const droits: [string, () => Project][] = [
    ["demo-erp-grand", () => loadExample("demo-erp-grand.blondel.json")],
    ["demo-straight-loft", () => loadExample("demo-straight-loft.blondel.json")],
    ...[8, 15, 19].map((n): [string, () => Project] => [
      `droit ${n}`,
      () =>
        withParams(
          makeSteppingProject({
            width: 900,
            legs: ["auto"],
            floorToFloor: 175 * n,
            stepping: { riserCount: n, targetRise: 175, targetGoing: 280 },
          }),
          {},
        ),
    ]),
  ];
  for (const [name, make] of droits) {
    it(`${name} : en \`nosing\`, sortie identique à \`chord\` (CK7, aucune remarque)`, () => {
      const p = make();
      const chord = run(withLine(p, "chord"));
      const nosing = run(withLine(p, "nosing"));
      expect(nosing.r.output).toEqual(chord.r.output);
      expect(nosing.m.parts).toEqual(chord.m.parts);
      for (const f of nosing.r.cranked!.faces.values()) {
        expect(f.mode).toBe("chord");
        expect(f.fallback).toBeUndefined();
      }
    });
  }

  it("propriété : escalier droit généré, sortie `nosing` identique à `chord` (CK7)", () => {
    fc.assert(
      fc.property(
        fc.record({
          n: fc.integer({ min: 6, max: 20 }),
          rise: fc.integer({ min: 150, max: 200 }),
          going: fc.integer({ min: 230, max: 320 }),
          width: fc.integer({ min: 700, max: 1200 }),
          drift: fc.integer({ min: -9, max: 9 }),
        }),
        (r) => {
          const p = withParams(
            makeSteppingProject({
              width: r.width,
              legs: ["auto"],
              floorToFloor: r.rise * r.n + r.drift,
              stepping: { riserCount: r.n, targetRise: r.rise, targetGoing: r.going },
            }),
            {},
          );
          const chord = run(withLine(p, "chord"));
          const nosing = run(withLine(p, "nosing"));
          expect(nosing.r.output).toEqual(chord.r.output);
          expect(nosing.m.parts).toEqual(chord.m.parts);
        },
      ),
      { numRuns: RUNS },
    );
  }, 120_000);
});

describe("steel-profile — critères de fin de K2b en `nosing`", () => {
  it("j3c : UPN ≤ 200 sans erreur, 9 jarrets, onglets fermés au bout d'aile, solides balayés valides", () => {
    const p = loadExample("j3c-acceptance-01-upn.blondel.json");
    const x = run(withLine(p, "nosing"));
    expect(x.r.section!.name).toBe("UPN 180");
    expect(x.r.output.errors ?? []).toEqual([]);
    expect(errorKeys(x)).toEqual([]);
    expect(reserve(x)).toBeGreaterThanOrEqual(0);
    expect(x.r.stringers.every((s) => s.bearing !== undefined)).toBe(true);
    expect(x.r.stringers.reduce((a, s) => a + (s.bearing?.knees.length ?? 0), 0)).toBe(9);
    expect(x.r.stringers.every((s) => s.part.solid.kind === "sweep")).toBe(true);
    expect(checkSolids(x.m.parts)).toEqual([]);
    const tol = SteelProfileParamsSchema.parse(p.stair.structure.params).miterTolerance;
    const miters = x.r.output.checks.filter((c) => c.ruleId === "FAB_ONGLET_RACCORD");
    expect(miters.length).toBeGreaterThan(0);
    for (const c of miters) {
      expect(c.measured!).toBeLessThan(tol);
      expect(c.measured!).toBeLessThan(1e-6);
    }
    const carried = x.m.compliance.results.filter((c) => c.ruleId === "FAB_MARCHE_PORTEE");
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.every((c) => c.status === "ok")).toBe(true);
    // Remarque par face coudée, aucune face repliée.
    const notes = x.r.output.notes.map((n) => n.key);
    expect(notes.filter((k) => k === "structure.steelProfile.note.cranked")).toHaveLength(4);
    expect(notes).not.toContain("structure.steelProfile.note.crankedFallback");
  });

  it("j3c : poteau à la rive haute coudée de l'extrémité reçue (CK12), plus bas que la corde", () => {
    const p = loadExample("j3c-acceptance-01-upn.blondel.json");
    const x = run(withLine(p, "nosing"));
    const chord = run(withLine(p, "chord"));
    const params = SteelProfileParamsSchema.parse(p.stair.structure.params);
    const post = x.r.posts[0]!;
    let top = -Infinity;
    for (const s of x.r.stringers) {
      if (s.face.side !== "inner") continue;
      const u = s.face.end === "newel" ? s.uHi : s.face.start === "newel" ? s.uLo : null;
      if (u === null) continue;
      top = Math.max(top, riveFns(s.bearing!).upper(u));
    }
    for (const sp of x.r.supports) {
      if (sp.placement.face.owner === post.id) top = Math.max(top, sp.placement.zTop);
    }
    expect(x.r.output.notes.map((n) => n.key)).not.toContain("structure.steel.note.newelRaised");
    expect(post.stock!.length).toBeCloseTo(top + params.newel.topExtension, 9);
    expect(post.stock!.length).toBeLessThan(chord.r.posts[0]!.stock!.length);
  });

  for (const [name, make] of [
    ["(i) comparateur en nosing", () => j5bComparator("nosing")],
    ["(ii) référence K2a", () => j5bReference("nosing")],
  ] as const) {
    it(`j5b ${name} : UPN ≤ 240, réserve d'âme ≥ 5 mm, sans erreur`, () => {
      const x = run(make());
      const s = x.r.section!;
      expect(s.family).toBe("UPN");
      expect(s.h).toBeLessThanOrEqual(240);
      expect(reserve(x)).toBeGreaterThanOrEqual(5);
      expect(x.r.output.errors ?? []).toEqual([]);
      expect(errorKeys(x)).toEqual([]);
      // Barre droite : aucune UPN (critère d'acceptation n° 2 aujourd'hui en échec).
      expect(run(j5bReference("chord")).r.output.errors?.map((e) => e.key)).toContain(
        "structure.steelProfile.error.noSectionPasses",
      );
    });
  }

  // Cas que `buildModel` construit réellement en profilés (le pipeline accepte la structure).
  const noRegression: [string, () => Project][] = [
    ["j4-demi", () => choose(loadExample("j4-demi-tournant-acier-garde-corps.blondel.json"))],
    ["demo-cage-flared-steel", () => choose(loadExample("demo-cage-flared-steel.blondel.json"))],
    ["demo-cage-room", () => choose(loadExample("demo-cage-room.blondel.json"))],
    ["demo-cage-central-steel", () => choose(loadExample("demo-cage-central-steel.blondel.json"))],
  ];
  for (const [name, make] of noRegression) {
    it(`${name} : section ≤ barre droite, aucune erreur ni violation nouvelle (repli par face)`, () => {
      const p = make();
      const chord = run(withLine(p, "chord"));
      const nosing = run(withLine(p, "nosing"));
      expect(chord.m.parts.some((x) => x.category === "stringer")).toBe(true);
      expect(mass(nosing)).toBeLessThanOrEqual(mass(chord));
      const known = new Set(errorKeys(chord));
      expect(errorKeys(nosing).filter((k) => !known.has(k))).toEqual([]);
      expect(nosing.r.output.errors?.length ?? 0).toBeLessThanOrEqual(
        chord.r.output.errors?.length ?? 0,
      );
      expect(newViolations(chord, nosing)).toEqual([]);
    });
  }

  it("coins dont les deux limons sont repliés : écart d'onglet mesuré comme en `chord`", () => {
    // demo-cage-room, UPN 260 imposée : les coins du jour (limons repliés) gardent les écarts de
    // `chord` (ligne de l'âme) au lieu d'un écart plus fort au bout d'aile sur la même géométrie.
    const p = withParams(choose(loadExample("demo-cage-room.blondel.json")), {
      family: "UPN",
      section: "UPN 260",
    });
    // Écarts publiés en violation, par limon d'arrivée du coin (`location.partId`).
    const miters = (x: Run): Map<string, number> =>
      new Map(
        x.r.output.checks.flatMap((c) =>
          c.ruleId === "FAB_ONGLET_RACCORD" &&
          c.status === "violation" &&
          c.location?.kind === "part"
            ? [[c.location.partId, c.measured!] as const]
            : [],
        ),
      );
    const chord = run(withLine(p, "chord"));
    const nosing = run(withLine(p, "nosing"));
    const straightIds = new Set(nosing.r.stringers.filter((x) => !x.bearing).map((x) => x.face.id));
    let compared = 0;
    for (const [id, v] of miters(nosing)) {
      const b = nosing.r.stringers.find((x) => x.face.id === id);
      const prev = nosing.r.stringers.find(
        (x) =>
          x !== b &&
          b !== undefined &&
          x.face.side === b.face.side &&
          Math.abs(x.face.sigmaA + x.face.faceLength - b.face.sigmaA) < 1e-6,
      );
      if (!straightIds.has(id) || !prev || !straightIds.has(prev.face.id)) continue;
      expect(v).toBeCloseTo(miters(chord).get(id)!, 9);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("aucune remarque de limon coudé ou de repli pour un limon non généré", () => {
    for (const file of ["demo-cage-room.blondel.json", "demo-cage-central-steel.blondel.json"]) {
      const p = withParams(choose(loadExample(file)), { family: "HEA", stringerLine: "nosing" });
      const x = run(p);
      const built = new Set(x.r.stringers.map((s) => s.face.mark));
      for (const n of x.r.output.notes) {
        if (
          n.key !== "structure.steelProfile.note.cranked" &&
          n.key !== "structure.steelProfile.note.crankedFallback"
        ) {
          continue;
        }
        expect(built.has(String(n.params?.["mark"]))).toBe(true);
      }
    }
  });

  it("precheckModel : portée d'un limon coudé lue sur la corde de la rive haute (± 5 % du plugin)", () => {
    for (const p of [
      loadExample("j3c-acceptance-01-upn.blondel.json"),
      choose(loadExample("quarter-left.blondel.json")),
      choose(loadExample("half-turn.blondel.json")),
    ]) {
      const project = withLine(p, "nosing");
      const m = buildModel(project, { memo: false });
      const parts = new Map(m.parts.map((x) => [x.id, x]));
      const recomputed = new Map(
        precheckModel(project, m).beams.map((b) => [b.partId, b.result.length]),
      );
      let bent = 0;
      for (const b of m.precheck!.beams) {
        if (parts.get(b.partId)?.solid.kind !== "sweep") continue;
        bent++;
        const l = recomputed.get(b.partId)!;
        expect(l / b.result.length).toBeGreaterThan(0.95);
        expect(l / b.result.length).toBeLessThan(1.05);
      }
      expect(bent).toBeGreaterThan(0);
    }
  });

  // Cages à palier droit (K-Q5, sous-lot K2f) : `buildModel` refuse le palier droit en barre
  // droite (`structure.cageUnsupported`, message inchangé) et le construit en limon coudé, sauf
  // raccord de palier où le coudé est infaisable (K-Q27, sous-lot K2f2 : cage-60-palier-limon,
  // refus du plugin, seules les marches produites).
  for (const file of [
    "cage-60-palier-limon.blondel.json",
    "cage-60-palier-central.blondel.json",
    "cage-45-palier-acier.blondel.json",
  ]) {
    const refused = file === "cage-60-palier-limon.blondel.json";
    it(`${file} : palier droit refusé en barre droite (message inchangé), ${refused ? "refusé par K-Q27" : "construit"} en \`nosing\``, () => {
      const p = choose(loadExample(file));
      const chord = run(withLine(p, "chord"));
      expect(errorKeys(chord)).toContain("structure.cageUnsupported");
      expect(chord.m.parts.some((q) => q.category === "stringer")).toBe(false);
      const refusal = chord.m.errors.find((e) => e.key === "structure.cageUnsupported")!;
      expect(refusal).toEqual(
        msg("structure.cageUnsupported", {
          structure: msg("structure.steelProfile.label"),
          reason: msg("structure.cageUnsupported.features", {
            features: msg(CAGE_FEATURE_LABELS.straightLanding),
          }),
        }),
      );
      const nosing = run(withLine(p, "nosing"));
      expect(errorKeys(nosing)).not.toContain("structure.cageUnsupported");
      expect(nosing.m.parts.some((q) => q.category === "stringer")).toBe(!refused);
      expect(errorKeys(nosing).includes("structure.steelProfile.error.landingSpliceRefused")).toBe(
        refused,
      );
    });
  }

  it("plugin d'essai de la barre droite : même modèle que `steel-profile` sur une cage sans palier droit (seul le garde-fou diffère)", () => {
    const p = choose(loadExample("demo-cage-central-steel.blondel.json"));
    for (const line of ["chord", "nosing"] as const) {
      const a = run(withLine(p, line));
      const b = run(withRefKind(withLine(p, line)));
      expect(b.r.section?.name).toBe(a.r.section?.name);
      expect(b.r.requiredHeight).toBe(a.r.requiredHeight);
      expect(errorKeys(b)).toEqual(errorKeys(a));
      expect(violationCounts(b)).toEqual(violationCounts(a));
      expect(b.m.parts.map((q) => [q.id, q.category])).toEqual(
        a.m.parts.map((q) => [q.id, q.category]),
      );
      expect(b.r.output.notes).toEqual(a.r.output.notes);
    }
  });

  // Critères de fin de K2f (`nosing`) : section, erreurs, besoin, aucune règle en violation de
  // plus que la barre droite d'essai (référence `withRefKind`, base K-Q24) hors
  // FAB_ONGLET_RACCORD (K-Q21). K2f2 (K-Q27) : plus aucun raccord de palier mixte, chaque raccord
  // relie deux limons coudés ; cage-60-palier-limon est refusée (test suivant), cage-45 et
  // cage-60-palier-central sont inchangées (même section, même besoin).
  for (const [file, section, errors, need, joints] of [
    ["cage-45-palier-acier.blondel.json", "UPN 220", [], 213.7, 2],
    // Jour en pan coupé (LI2, raccord raide replié en barre droite, K-Q12) : même erreur et même
    // besoin que la barre droite.
    [
      "cage-60-palier-central.blondel.json",
      "UPN 260",
      ["structure.steelProfile.error.noSectionPasses"],
      293.4,
      0,
    ],
  ] as const) {
    it(`${file} : critères de fin de K2f en \`nosing\` (section, erreurs, règles ≤ barre droite)`, () => {
      const p = choose(loadExample(file));
      const x = run(withLine(p, "nosing"));
      const ref = run(withRefKind(withLine(p, "chord")));
      expect(x.r.section!.name).toBe(section);
      expect(errorKeys(x)).toEqual(errors);
      // Erreurs au plus celles de la barre droite d'essai (comparaison à la référence, pas
      // seulement à la liste ci-dessus).
      const known = new Set(errorKeys(ref));
      expect(errorKeys(x).filter((k) => !known.has(k))).toEqual([]);
      expect(x.r.requiredHeight).toBeCloseTo(need, 1);
      expect(mass(x)).toBeLessThanOrEqual(mass(ref));
      const excess = violationCounts(x);
      const base = violationCounts(ref);
      for (const [rule, n] of Object.entries(excess)) {
        if (rule === "FAB_ONGLET_RACCORD") continue;
        expect(n, rule).toBeLessThanOrEqual(base[rule] ?? 0);
      }
      // Raccords de palier entre deux limons coudés : rives continues (K2f (2c)). Le palier de
      // cage-60-palier-central tourne légèrement (coin `wall` / `jour`, pas de raccord de palier).
      // K-Q27 : tout raccord de palier relie deux limons coudés (aucun mixte).
      let landingJoints = 0;
      for (const a of x.r.stringers) {
        if (a.face.endCorner?.joint !== "landing") continue;
        const b = x.r.stringers.find(
          (s) =>
            s.face.side === a.face.side &&
            s.face.startCorner?.joint === "landing" &&
            Math.abs(s.face.sigmaA - a.face.sigmaA - a.face.faceLength) < 1e-6,
        );
        if (!b) continue;
        expect(a.bearing, `${a.face.mark} / ${b.face.mark}`).toBeDefined();
        expect(b.bearing, `${a.face.mark} / ${b.face.mark}`).toBeDefined();
        if (!a.bearing || !b.bearing) continue;
        landingJoints++;
        const ra = riveFns(a.bearing);
        const rb = riveFns(b.bearing);
        expect(Math.abs(ra.upper(a.face.faceLength) - rb.upper(0))).toBeLessThan(1e-6);
        expect(Math.abs(ra.lower(a.face.faceLength) - rb.lower(0))).toBeLessThan(1e-6);
      }
      expect(landingJoints).toBe(joints);
      expect(x.r.landing!.chains).toHaveLength(joints);
      expect(x.r.landing!.refusals).toEqual([]);
      if (file === "cage-60-palier-central.blondel.json") {
        expect(x.r.stringers.find((s) => s.face.mark === "LI2")!.crankedFallback?.kind).toBe(
          "steepSegment",
        );
        expect(ref.r.requiredHeight).toBeCloseTo(293.4, 1);
      }
    });
  }

  // K-Q27 (K2f2) : au raccord de palier LI2 / LI3, LI2 (jour en pan coupé) ne peut pas rester
  // coudé (raccord raide, dans toutes les sections) : le palier droit est refusé pour cette cage,
  // en erreur chiffrée qui nomme le limon, le raccord et la cause ; seules les marches sont
  // produites. Angle lu sur la section où le refus est rendu : la plus haute de la famille en
  // section automatique (UPN 260 : 86,7° ; IPE 300 : 89,8°), la section imposée sinon (UPN 240 :
  // 86,4°, mesure de K2f).
  for (const [params, angle] of [
    [{ family: "UPN", stringerLine: "nosing" }, 86.7],
    [{ family: "IPE", stringerLine: "nosing" }, 89.8],
    [{ family: "UPN", stringerLine: "nosing", section: "UPN 240" }, 86.4],
  ] as const) {
    it(`cage-60-palier-limon (${JSON.stringify(params)}) : raccord de palier refusé (K-Q27), LI2 en raccord raide à ${angle}°, seules les marches produites`, () => {
      const raw = loadExample("cage-60-palier-limon.blondel.json");
      const p = withParams(choose(raw, params), params);
      const x = run(p);
      expect(errorKeys(x)).toEqual(["structure.steelProfile.error.landingSpliceRefused"]);
      expect(x.r.stringers).toEqual([]);
      expect(x.r.section).toBeNull();
      expect(x.m.parts.some((q) => q.category === "stringer")).toBe(false);
      expect(x.m.parts.some((q) => q.category === "tread")).toBe(true);
      expect(x.r.landing!.refusals).toHaveLength(1);
      const err = x.m.errors.find(
        (e) => e.key === "structure.steelProfile.error.landingSpliceRefused",
      )!;
      expect(err.params?.["mark"]).toBe("LI2");
      expect(translatorFor("fr").t(err.params?.["splice"] as Message)).toBe("LI2 / LI3");
      const reason = err.params?.["reason"] as Message;
      expect(reason.key).toBe("structure.steelProfile.crankedFallback.steepSegment");
      expect(reason.params?.["angle"]).toEqual(dec(angle, 1));
      // Rendu fr / en : chiffres formatés, aucun paramètre non résolu, pas de français en anglais.
      const fr = translatorFor("fr").t(err);
      const en = translatorFor("en").t(err);
      expect(fr).toContain("LI2 / LI3");
      expect(fr).toContain(`${String(angle).replace(".", ",")}°`);
      expect(en).toContain(`${angle}°`);
      expect(en).toContain("K-Q27");
      for (const text of [fr, en]) expect(text).not.toMatch(/\{|\}|\[object|undefined|NaN/);
      expect(en).not.toMatch(/limon|palier|marche|raccord/i);
      // Refus du plugin, et non du garde-fou de cage (K-Q30 : paramètres valides).
      expect(errorKeys(x)).not.toContain("structure.cageUnsupported");
    });
  }

  // Relecture K2f2 : en section imposée, un limon de chaîne de palier ne peut pas demander plus
  // que la section (ses supports ne logeraient pas, marche non portée possible, violation que la
  // barre droite n'a pas) : LE2 (186,9 mm coudé contre 186,7 mm en barre droite) est refusé.
  it("cage-45-palier-acier en UPN 180 imposée : LE2 ne loge pas coudé dans la section imposée au raccord LE2 / LE3 (K-Q27, `beyondSection`), palier droit refusé, seules les marches", () => {
    const params = { family: "UPN", stringerLine: "nosing", section: "UPN 180" };
    const x = run(
      withParams(choose(loadExample("cage-45-palier-acier.blondel.json"), params), params),
    );
    expect(errorKeys(x)).toEqual(["structure.steelProfile.error.landingSpliceRefused"]);
    expect(x.r.stringers).toEqual([]);
    expect(x.m.parts.some((q) => q.category === "stringer")).toBe(false);
    expect(x.m.parts.some((q) => q.category === "tread")).toBe(true);
    expect(x.r.landing!.forcedSections).toEqual([]);
    expect(x.r.landing!.refusedSections).toEqual(["UPN 180"]);
    const [r] = x.r.landing!.refusals;
    expect(x.r.landing!.refusals).toHaveLength(1);
    expect(r!.reason.kind).toBe("beyondSection");
    if (r!.reason.kind !== "beyondSection") return;
    expect(r!.reason.bent).toBeCloseTo(186.9, 1);
    expect(r!.reason.section).toBe("UPN 180");
    const err = x.m.errors.find(
      (e) => e.key === "structure.steelProfile.error.landingSpliceRefused",
    )!;
    expect(err.params?.["mark"]).toBe("LE2");
    const fr = translatorFor("fr").t(err);
    const en = translatorFor("en").t(err);
    expect(fr).toContain("LE2 / LE3");
    expect(fr).toContain("âme requise 186,9 mm, plus que la section imposée UPN 180 (180 mm)");
    expect(en).toContain("required web 186.9 mm, more than the imposed section UPN 180 (180 mm)");
    for (const text of [fr, en]) expect(text).not.toMatch(/\{|\}|\[object|undefined|NaN/);
  });

  it("cage-45-palier-acier en section automatique : LE2 forcé coudé de l'UPN 80 à l'UPN 180 (sections écartées), UPN 220 retenue comme en K2f", () => {
    const x = run(withLine(choose(loadExample("cage-45-palier-acier.blondel.json")), "nosing"));
    expect(x.r.landing!.forcedSections).toEqual([
      "UPN 80",
      "UPN 100",
      "UPN 120",
      "UPN 140",
      "UPN 160",
      "UPN 180",
    ]);
    expect(x.r.section!.name).toBe("UPN 220");
    expect(x.r.landing!.refusedSections).toEqual([]);
    for (const id of x.r.landing!.chains.flat()) {
      expect(x.r.cranked!.faces.get(id)!.mode, id).toBe("nosing");
    }
  });

  for (const [name, file, kinds] of [
    [
      "demo-cage-flared-steel",
      "demo-cage-flared-steel.blondel.json",
      ["noseAboveRive", "steepSegment"],
    ],
    ["cage-45-palier-acier", "cage-45-palier-acier.blondel.json", ["heavier"]],
  ] as const) {
    it(`${name} : repli signalé par une remarque, aucune erreur nouvelle`, () => {
      const p = choose(loadExample(file));
      // Barre droite de référence : plugin d'essai qui accepte le palier droit (la vraie barre
      // droite le refuse, K2f).
      const chord = run(withRefKind(withLine(p, "chord")));
      const nosing = run(withLine(p, "nosing"));
      const fallbacks = nosing.r.stringers.filter((s) => s.crankedFallback);
      expect(fallbacks.length).toBeGreaterThan(0);
      for (const s of fallbacks) expect(kinds).toContain(s.crankedFallback!.kind);
      const notes = nosing.r.output.notes.filter(
        (n) => n.key === "structure.steelProfile.note.crankedFallback",
      );
      expect(notes).toHaveLength(fallbacks.length);
      const known = new Set(errorKeys(chord));
      expect(errorKeys(nosing).filter((k) => !known.has(k))).toEqual([]);
      expect(mass(nosing)).toBeLessThanOrEqual(mass(chord));
    });
  }
});

/** Violations du contrôle de conception par règle (compte, et non ensemble des identifiants). */
const violationCounts = (x: Run): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const c of x.m.compliance.results) {
    if (c.status === "violation") out[c.ruleId] = (out[c.ruleId] ?? 0) + 1;
  }
  return out;
};
/**
 * Règles en violation plus souvent dans `x` que dans la référence `ref` (barre droite du même
 * projet), avec l'excédent. Seule tolérance (K-Q21) : FAB_ONGLET_RACCORD aux coins dont l'un des
 * deux limons est replié `heavier` (onglet ouvert accepté par l'utilisateur) ; l'excédent de
 * cette règle n'est retiré que de ces coins (partie reçue au coin ou limon qui y arrive).
 */
const excessOverChord = (ref: Run, x: Run): Record<string, number> => {
  const a = violationCounts(x);
  const b = violationCounts(ref);
  const heavier = new Set(
    x.r.stringers.filter((s) => s.crankedFallback?.kind === "heavier").map((s) => s.face.id),
  );
  // Coin dû au repli : la partie reçue (`partId` du constat, début `corner`) ou le limon qui
  // arrive au même coin du même côté est replié `heavier`.
  const dueToHeavier = (partId: string): boolean => {
    if (heavier.has(partId)) return true;
    const recv = x.r.stringers.find((s) => s.face.id === partId);
    if (!recv) return false;
    return x.r.stringers.some(
      (s) =>
        heavier.has(s.face.id) &&
        s.face.side === recv.face.side &&
        Math.abs(s.face.sigmaA + s.face.faceLength - recv.face.sigmaA) < 1e-6,
    );
  };
  const tolerated = x.m.compliance.results.filter(
    (c) =>
      c.ruleId === "FAB_ONGLET_RACCORD" &&
      c.status === "violation" &&
      c.location?.kind === "part" &&
      dueToHeavier(c.location.partId),
  ).length;
  const out: Record<string, number> = {};
  for (const [rule, n] of Object.entries(a)) {
    const allowed = (b[rule] ?? 0) + (rule === "FAB_ONGLET_RACCORD" ? tolerated : 0);
    if (n > allowed) out[rule] = n - allowed;
  }
  return out;
};
/** Clé d'un support posé (marche × face), comme dans les ensembles du coin. */
const placedKey = (pl: { tread: number; face: { key: string } }): string =>
  cornerSupportKey(pl.tread, pl.face.key);

/**
 * Invariants de la cornière au coin du mur (K-Q4, K2e) sur un résultat du plugin en `nosing` :
 * chaque marche au coin garde au moins une cornière posée côté mur dès que l'une est logeable
 * dans le mode final de sa face (section faisable), sans violation FAB_MARCHE_PORTEE côté mur ;
 * les cornières retirées sont toutes facultatives, à partie logée < `minLength` ; une facultative
 * est posée ou retirée (sauf marche sans aucune cornière posée, comportement de K2b) ; une
 * remarque par marche qui perd une cornière. K2e2 : une marche au coin sans support posé côté
 * jour est une marche « sans appui côté jour » du plan (et réciproquement), qui ne perd aucune
 * cornière et n'en a aucune facultative (K-Q16) ; un palier ne forme aucun groupe et ne perd
 * aucune cornière (K-Q18). Rend le nombre de groupes vérifiés.
 */
function expectCornerAngles(x: Run, project: Project): number {
  // Plugin arrêté avant le choix de section (hélicoïdal, découpage vide…) : rien à vérifier.
  if (!x.r.section || !x.r.cornerAngles || !x.r.cranked) return 0;
  const ca = x.r.cornerAngles;
  const plan = x.r.cranked;
  const params = SteelProfileParamsSchema.parse(project.stair.structure.params);
  const minLen = params.supports.minLength;
  // Supports des profilés : cornières (hauteur = aile).
  const webFit = {
    depth: params.supports.angleLeg,
    edge: params.supports.edgeMargin,
    tf: x.r.section!.shape === "I" ? x.r.section!.tf : 0,
    minLength: minLen,
  };
  const placed = new Set(x.r.supports.map((s) => placedKey(s.placement)));
  const removed = new Set(ca.removed.map((r) => cornerSupportKey(r.tread, r.faceId)));
  const feasible = !errorKeys(x).includes("structure.steelProfile.error.noSectionPasses");
  const landings = new Set(
    x.m.stepping.treads.filter((t) => t.kind === "landing").map((t) => t.number),
  );
  for (const t of landings) {
    expect(
      ca.groups.some((g) => g.tread === t),
      `palier M${t}`,
    ).toBe(false);
    expect(
      ca.removed.some((r) => r.tread === t),
      `palier M${t}`,
    ).toBe(false);
  }
  let checked = 0;
  for (const g of ca.groups) {
    // K-Q16 : appui côté jour posé ⇔ marche jugée appuyée côté jour par le plan.
    const jourPlaced = x.r.supports.some(
      (s) => s.placement.tread === g.tread && s.placement.face.side === "inner",
    );
    expect(plan.corner.jourless.has(g.tread), `marche ${g.tread} (jour)`).toBe(!jourPlaced);
    if (plan.corner.jourless.has(g.tread)) {
      for (const c of g.candidates) {
        expect(plan.corner.optional.has(c.key), c.key).toBe(false);
        expect(removed.has(c.key), c.key).toBe(false);
      }
    }
    // Logeable (à hauteur infinie) dans le mode final de sa face : rive coudée ou corde.
    const loggable = g.candidates.some((c) => {
      if (c.u1 - c.u0 < minLen - 1e-9) return false;
      const st = x.r.stringers.find((s) => s.face.id === c.faceId);
      if (!st) return false;
      const upper = st.bearing
        ? st.bearing.upperRive
        : [st.uLo - 5000, st.uHi + 5000].map((u) => ({
            x: u,
            y: st.line.z0 + st.line.slope * (u - st.line.u0) + params.upperOffset,
          }));
      const f = fitInWebPolyline(upper, null, c, webFit);
      return f.u1 - f.u0 >= minLen - 1e-9;
    });
    const kept = g.candidates.filter((c) => placed.has(c.key));
    if (feasible && loggable) {
      checked++;
      expect(kept.length, `marche ${g.tread}`).toBeGreaterThanOrEqual(1);
      const wall = x.m.compliance.results.filter(
        (c) =>
          c.ruleId === "FAB_MARCHE_PORTEE" &&
          c.status === "violation" &&
          c.location?.kind === "tread" &&
          c.location.number === g.tread &&
          (c.message.key === "structure.steel.check.treadNotCarried.wall" ||
            c.message.key === "structure.steel.check.treadNotCarried.both"),
      );
      expect(wall, `marche ${g.tread}`).toEqual([]);
    }
    for (const c of g.candidates) {
      if (!plan.corner.optional.has(c.key)) continue;
      // Facultative : posée, ou retirée (une autre posée) ; ni l'un ni l'autre seulement si
      // aucune cornière de la marche n'est posée (constat de longueur, comme K2b).
      if (kept.length === 0) expect(removed.has(c.key)).toBe(false);
      else expect(placed.has(c.key) !== removed.has(c.key), c.key).toBe(true);
    }
  }
  for (const r of ca.removed) {
    expect(plan.corner.optional.has(cornerSupportKey(r.tread, r.faceId))).toBe(true);
    expect(r.logged).toBeLessThan(minLen);
  }
  const treads = new Set(ca.removed.map((r) => r.tread));
  const notes = x.r.output.notes.filter(
    (n) => n.key === "structure.steelProfile.note.cornerAngleRemoved",
  );
  expect(notes).toHaveLength(treads.size);
  return checked;
}

/** Plus grande zone brute d'appui (u1 − u0) des faces de poteau côté jour de la marche au coin. */
const postZone = (x: Run, tread: number): number => {
  const g = x.r.cornerAngles?.groups.find((q) => q.tread === tread);
  return Math.max(0, ...(g?.jour ?? []).filter((c) => c.onPost).map((c) => c.u1 - c.u0));
};

/**
 * Marche au coin portée côté jour par un poteau à zone voisine de l'appui mini (signalement
 * K2e2, sous-lot K2f) : vérifie la règle (K-Q16, K-Q23) plutôt qu'une égalité fragile. Zone sous
 * `supports.minLength` (seuil inchangé) : marche sans appui côté jour, aucune cornière murale
 * retirée, aucun support posé côté jour ; rend `true` (les attentes chiffrées du cas valent).
 * Zone atteinte : marche appuyée côté jour par le poteau, règle du coin (une cornière exigée),
 * section au plus celle de la barre droite, aucune erreur nouvelle ; rend `false`. Le message
 * d'assertion porte la marge mesurée.
 */
function expectPostSensitive(x: Run, ref: Run, project: Project, tread: number): boolean {
  const min = SteelProfileParamsSchema.parse(project.stair.structure.params).supports.minLength;
  const z = postZone(x, tread);
  const why = `zone sur poteau M${tread} : ${z.toFixed(2)} mm pour ${min} (marge ${(z - min).toFixed(2)} mm)`;
  const jourPlaced = x.r.supports.filter(
    (s) => s.placement.tread === tread && s.placement.face.side === "inner",
  );
  if (z < min - 1e-9) {
    expect(x.r.cranked!.corner.jourless.has(tread), why).toBe(true);
    expect(
      x.r.cornerAngles!.removed.some((r) => r.tread === tread),
      why,
    ).toBe(false);
    expect(jourPlaced, why).toEqual([]);
    return true;
  }
  expect(x.r.cranked!.corner.jourless.has(tread), why).toBe(false);
  expect(jourPlaced.length, why).toBeGreaterThan(0);
  // Règle du coin (K-Q4, une cornière exigée) sur la marche, désormais appuyée côté jour.
  expectCornerAngles(x, project);
  expect(
    x.r.cornerAngles!.groups.some((g) => g.tread === tread),
    why,
  ).toBe(true);
  expect(mass(x), why).toBeLessThanOrEqual(mass(ref));
  const known = new Set(errorKeys(ref));
  expect(
    errorKeys(x).filter((k) => !known.has(k)),
    why,
  ).toEqual([]);
  return false;
}

describe("steel-profile — cornière au coin du mur (K2e, K-Q4 ; K2e2, K-Q16 à K-Q21) en `nosing`", () => {
  const NOSING = { family: "UPN", stringerLine: "nosing" };
  const CHORD = { family: "UPN" };
  const pick =
    (file: string) =>
    (params: Record<string, unknown>): Project =>
      choose(loadExample(file), params);
  /**
   * Critères de fin de K2e2. Le modèle livré (`make(NOSING)`, poteau posé par
   * `applyStructureChoice` ou par le comparateur) est comparé règle par règle à la **barre droite
   * du même projet** (`make(CHORD)`, poteau de son propre point fixe) : aucune règle en violation
   * plus souvent, sauf FAB_ONGLET_RACCORD dû à un repli `heavier` (K-Q21, `excessOverChord`).
   * `section` : section mesurée en K2e2 (égalité, pour qu'une régression se voie) ; `errors` :
   * erreurs attendues du modèle. Demi-tournant et trapèze : la marche au coin sans appui côté jour
   * (M8, M7) garde ses deux cornières murales (K-Q16) ; aucune UPN ne les loge (288,4 et
   * 270,9 mm), comme la barre droite (UPN 260 en erreur dans les deux modes).
   */
  const cases: {
    name: string;
    make: (params: Record<string, unknown>) => Project;
    section: string;
    errors: string[];
    /** Marches au coin sans appui côté jour (K-Q16), mesurées en K2e2. */
    jourless: number[];
    /**
     * Marche au coin dont l'appui côté jour est une face de poteau à zone brute voisine de la
     * longueur minimale d'appui (signalement K2e2 : quart M4 49,6 mm, demi-tournant M8 49 mm,
     * pour 50) : les attentes `section`, `errors` et `jourless` valent si la zone reste sous la
     * longueur minimale ; sinon la marche suit la règle du coin (`expectPostSensitive`).
     */
    postTread?: number;
  }[] = [
    {
      name: "j3c",
      make: pick("j3c-acceptance-01-upn.blondel.json"),
      section: "UPN 180",
      errors: [],
      jourless: [],
    },
    {
      name: "j5b (comparateur)",
      make: (pr) => j5bComparator(pr["stringerLine"] === "nosing" ? "nosing" : "chord"),
      section: "UPN 200",
      errors: [],
      jourless: [],
    },
    {
      name: "quart",
      make: pick("quarter-left.blondel.json"),
      section: "UPN 220",
      errors: [],
      jourless: [4],
      postTread: 4,
    },
    {
      name: "U",
      make: pick("two-quarters-u.blondel.json"),
      section: "UPN 200",
      errors: [],
      jourless: [],
    },
    {
      name: "demi-tournant (préréglage)",
      make: (pr) => choose(createProject("half-turn"), pr),
      section: "UPN 260",
      errors: ["structure.steelProfile.error.noSectionPasses"],
      jourless: [8],
      postTread: 8,
    },
    ...["j4-demi-tournant-acier-garde-corps", "demo-half-turn-industrial"].map((f) => ({
      name: f,
      make: pick(`${f}.blondel.json`),
      section: "UPN 200",
      errors: [],
      jourless: [],
    })),
    {
      name: "cage-trapeze",
      make: pick("cage-trapeze.blondel.json"),
      section: "UPN 260",
      // Limons de jour refusés sur un jour vif de cage (CK14) : M7 sans appui côté jour (K-Q16).
      errors: [
        "structure.steel.error.sharpWellCage",
        "structure.steelProfile.error.noSectionPasses",
      ],
      jourless: [7],
    },
    {
      name: "demo-cage-flared-steel (pan coupé)",
      make: pick("demo-cage-flared-steel.blondel.json"),
      // Section imposée par le jour en barre droite (repli K-Q12) : UPN 260 sans erreur.
      section: "UPN 260",
      errors: [],
      jourless: [],
    },
    {
      name: "demo-cage-central-steel",
      make: pick("demo-cage-central-steel.blondel.json"),
      section: "UPN 220",
      errors: [],
      jourless: [8],
    },
    {
      name: "quarter-landing (palier d'angle)",
      make: pick("quarter-landing.blondel.json"),
      section: "UPN 200",
      errors: [],
      jourless: [],
    },
  ];
  for (const c of cases) {
    it(`${c.name} : ${c.section}, erreurs attendues seulement, aucune règle en violation de plus que la barre droite`, () => {
      const p = c.make(NOSING);
      const x = run(p);
      const ref = run(c.make(CHORD));
      if (c.postTread === undefined || expectPostSensitive(x, ref, p, c.postTread)) {
        expect(x.r.section!.name).toBe(c.section);
        expect(errorKeys(x)).toEqual(c.errors);
        expect(x.r.cranked!.corner.jourless).toEqual(new Set(c.jourless));
      }
      const checked = expectCornerAngles(x, p);
      if (errorKeys(x).length === 0) expect(reserve(x)).toBeGreaterThanOrEqual(0);
      expect(excessOverChord(ref, x)).toEqual({});
      // Invariants du coin vérifiés sur au moins une marche quand la section est faisable.
      if (!c.errors.includes("structure.steelProfile.error.noSectionPasses")) {
        if (x.r.cornerAngles!.groups.length > 0) expect(checked).toBeGreaterThan(0);
      }
    }, 60_000);
  }

  it("j5b (comparateur) : aucun poteau retenu (K-Q19), poteau de la barre droite 130 / 45 (K-Q25), réserve d'âme ≥ 5 mm ; j3c : UPN 180", () => {
    // K2e2 rendait le « moindre excédent » (125 / 43, FAB_SUPPORT_LONGUEUR_MIN ajouté) ; K-Q25
    // (sous-lot K2f) : le poteau de la barre droite du même projet (point fixe en `chord`).
    const raw = loadExample("j5b-debillarde-soude.blondel.json");
    const r = resolveProfileNewel(
      withParams(raw, { family: "UPN", stringerLine: "nosing" }),
      () => true,
    )!;
    expect(r.chordJour?.rules).toEqual(["FAB_SUPPORT_LONGUEUR_MIN"]);
    // K-Q29 (K2f2) : le coudé au poteau de la barre droite n'ajoute rien à la barre droite.
    expect(r.chordJour?.keptAdds).toEqual([]);
    const chordNewel = resolveProfileNewel(withParams(raw, { family: "UPN" }), () => true)!.newel;
    expect(r.newel).toEqual(chordNewel);
    const p = j5bComparator("nosing");
    const turns = p.stair.layout.kind === "cage" ? [] : p.stair.layout.turns;
    expect(turns.map((t) => t.inner)).toContainEqual({ kind: "newel", size: 130, offset: 45 });
    expect(run(p).r.section!.name).toBe("UPN 200");
    expect(reserve(run(p))).toBeGreaterThanOrEqual(5);
    expect(run(pick("j3c-acceptance-01-upn.blondel.json")(NOSING)).r.section!.name).toBe("UPN 180");
  });

  it("quart : M4 sans appui côté jour (K-Q16), deux cornières murales, UPN 220 (si la zone sur poteau reste sous l'appui mini)", () => {
    const p = pick("quarter-left.blondel.json")(NOSING);
    const x = run(p);
    expectCornerAngles(x, p);
    if (!expectPostSensitive(x, run(pick("quarter-left.blondel.json")(CHORD)), p, 4)) return;
    expect(x.r.section!.name).toBe("UPN 220");
    expect(x.r.cranked!.corner.jourless).toEqual(new Set([4]));
    expect(x.r.cornerAngles!.removed).toEqual([]);
    const m4 = x.r.supports.filter((s) => s.placement.tread === 4);
    expect(
      m4.filter((s) => s.placement.face.side === "outer").map((s) => s.placement.face.ownerMark),
    ).toEqual(["LE1", "LE2"]);
    expect(m4.filter((s) => s.placement.face.side === "inner")).toEqual([]);
  });

  it("quart à appui mini de 49 mm : zone sur poteau de M4 atteinte, marche appuyée côté jour, règle du coin, section ≤ barre droite (branche « zone atteinte » de `expectPostSensitive`)", () => {
    // Même projet, `supports.minLength` abaissé sous la zone mesurée de M4 (49,6 mm) : couvre la
    // branche que le seuil de 50 mm n'exécute pas (relecture K2f).
    const supports = { minLength: 49 };
    const p = pick("quarter-left.blondel.json")({ ...NOSING, supports });
    const x = run(p);
    expect(postZone(x, 4)).toBeGreaterThanOrEqual(49);
    expect(postZone(x, 4)).toBeLessThan(50);
    const ref = run(pick("quarter-left.blondel.json")({ ...CHORD, supports }));
    expect(expectPostSensitive(x, ref, p, 4)).toBe(false);
  });

  it("j4-demi au poteau 110 / 35 : M9 sans appui côté jour (K-Q16), deux cornières murales", () => {
    const p = withNewels(
      pick("j4-demi-tournant-acier-garde-corps.blondel.json")(NOSING),
      { kind: "newel", size: 110, offset: 35 },
      () => true,
    );
    const x = run(p);
    expect(x.r.cranked!.corner.jourless).toEqual(new Set([9]));
    expect(x.r.cornerAngles!.removed.map((r) => r.treadMark)).not.toContain("M9");
    const m9 = x.r.supports.filter((s) => s.placement.tread === 9);
    expect(
      m9.filter((s) => s.placement.face.side === "outer").map((s) => s.placement.face.ownerMark),
    ).toEqual(["LE2", "LE3"]);
    expect(m9.filter((s) => s.placement.face.side === "inner")).toEqual([]);
    expect(expectCornerAngles(x, p)).toBeGreaterThan(0);
  });

  it("paliers (K-Q18) : quarter-landing et demo-quarter-landing-ash, palier d'angle sans groupe, toutes ses cornières posées", () => {
    for (const f of ["quarter-landing", "demo-quarter-landing-ash"]) {
      const p = pick(`${f}.blondel.json`)(NOSING);
      const x = run(p);
      const landings = x.m.stepping.treads.filter((t) => t.kind === "landing").map((t) => t.number);
      expect(landings.length, f).toBeGreaterThan(0);
      for (const t of landings) {
        expect(x.r.cornerAngles!.groups.some((g) => g.tread === t)).toBe(false);
        expect(x.r.cornerAngles!.removed.some((r) => r.tread === t)).toBe(false);
      }
      // Palier d'angle (marche 3) : ses deux cornières murales posées.
      const wall = x.r.supports.filter(
        (s) => s.placement.tread === 3 && s.placement.face.side === "outer",
      );
      expect(wall.length, f).toBe(2);
    }
  });

  it("palier d'angle en volées (K-Q5, K2f) : rive de niveau sur le plat du palier, onglet fermé, M3 sur ses deux cornières murales", () => {
    for (const f of ["quarter-landing", "demo-quarter-landing-ash"]) {
      const x = run(pick(`${f}.blondel.json`)(NOSING));
      expect(errorKeys(x), f).toEqual([]);
      const le1 = x.r.stringers.find((s) => s.face.mark === "LE1")!;
      const le2 = x.r.stringers.find((s) => s.face.mark === "LE2")!;
      expect(le1.bearing && le2.bearing, f).toBeTruthy();
      // Altitude du palier (nez de la marche 3) et plat de la ligne des nez de chaque côté du
      // coin : LE1 de niveau sur [540 ; 1 440], LE2 sur [0 ; 630] (mesures K2f).
      const z = x.m.stepping.nosings[2]!.z;
      for (const [st, lo, hi] of [
        [le1, 540, 1440],
        [le2, 0, 630],
      ] as const) {
        const us = [lo, hi, ...st.bearing!.line.map((q) => q.x).filter((u) => u > lo && u < hi)];
        for (const u of us) {
          const dz = Math.abs(polylineAt(st.bearing!.line, u) - z);
          expect(dz, `${f} ${st.face.mark} u=${u}`).toBeLessThan(1e-6);
        }
      }
      const miter = x.r.output.checks.filter((c) => c.ruleId === "FAB_ONGLET_RACCORD");
      expect(miter.length, f).toBeGreaterThan(0);
      for (const c of miter) expect(c.measured!, f).toBeLessThan(1e-6);
      expect(violationCounts(x)["FAB_ONGLET_RACCORD"] ?? 0, f).toBe(0);
      // Barre droite : 1 020 mm d'écart à l'onglet du même coin.
      const ref = run(pick(`${f}.blondel.json`)(CHORD));
      expect(
        Math.max(
          ...ref.r.output.checks
            .filter((c) => c.ruleId === "FAB_ONGLET_RACCORD")
            .map((c) => c.measured!),
        ),
        f,
      ).toBeCloseTo(1020, 0);
    }
  });

  // Écart à la lettre de K-Q16 (« j4-demi M9 sans appui côté jour », « UPN 220 attendu »), en
  // attente d'arbitrage de l'utilisateur : au poteau retenu (130 / 45), M9 est portée côté jour
  // par le poteau PT2, donc la règle du coin s'applique et retire M9 / LE3 (UPN 200) ; M9 n'est
  // sans appui côté jour qu'au poteau 110 / 35 (test précédent), que le point fixe ne rend pas.
  it("j4-demi (modèle livré, 130 / 45) : deux cornières retirées (M5 sur LE2, M9 sur LE3), absentes des supports, développés, débit et assemblages", () => {
    const p = pick("j4-demi-tournant-acier-garde-corps.blondel.json")(NOSING);
    const x = run(p);
    expect(x.r.section!.name).toBe("UPN 200");
    expect(x.r.output.errors ?? []).toEqual([]);
    const removed = x.r.cornerAngles!.removed;
    expect(removed.map((r) => [r.treadMark, r.faceMark])).toEqual([
      ["M5", "LE2"],
      ["M9", "LE3"],
    ]);
    const notes = x.r.output.notes.filter(
      (n) => n.key === "structure.steelProfile.note.cornerAngleRemoved",
    );
    expect(notes.map((n) => n.params?.["mark"])).toEqual(["M5", "M9"]);
    for (const r of removed) {
      // Ni support posé, ni trait de cornière sur les développés de la face.
      expect(
        x.r.supports.some(
          (s) => s.placement.tread === r.tread && s.placement.face.owner === r.faceId,
        ),
      ).toBe(false);
      const st = x.r.stringers.find((s) => s.face.id === r.faceId)!;
      const allMarks: unknown[] = [];
      for (const q of st.components ?? [st.part]) {
        const marks = (q.flat?.lines ?? [])
          .filter((l) => l.label?.key === "structure.steel.flatLine.support")
          .map((l) => l.label?.params?.["mark"]);
        expect(marks, q.mark).not.toContain(r.treadMark);
        allMarks.push(...marks);
      }
      // Contrôle positif : les cornières posées du même limon restent tracées.
      const placedOnFace = x.r.supports.filter((s) => s.placement.face.owner === r.faceId);
      expect(placedOnFace.length).toBeGreaterThan(0);
      for (const s of placedOnFace) expect(allMarks).toContain(s.placement.treadMark);
      // Assemblages : aucune cornière liée à la fois à la marche et au limon.
      const assemblies = x.r.output.assemblies ?? [];
      const byPart = new Map<string, { tread?: number; owner?: string }>();
      for (const a of assemblies) {
        if (!("partId" in a.a)) continue;
        const e = byPart.get(a.a.partId) ?? {};
        if ("treadNumber" in a.b) e.tread = a.b.treadNumber;
        else e.owner = a.b.partId;
        byPart.set(a.a.partId, e);
      }
      expect([...byPart.values()].some((e) => e.tread === r.tread && e.owner === r.faceId)).toBe(
        false,
      );
    }
    // Débit des cornières : une pièce par support posé, aucune pour les retirées.
    // Clé du plan : désignation française de la section des cornières (« L 40 × 40 × 4 »).
    const angles = Object.entries(x.r.cutting).find(([k]) => k.startsWith("L"))![1];
    const pieces = angles.bars.reduce((a, b) => a + b.pieces.length, 0);
    expect(pieces).toBe(x.r.supports.length);
    expect(x.m.parts.filter((q) => q.category === "support").length).toBeGreaterThanOrEqual(
      x.r.supports.length,
    );
    // FAB_MARCHE_PORTEE : marches 5 et 9 portées côté mur, et côté jour par les poteaux.
    expect(expectCornerAngles(x, p)).toBe(2);
  });

  it("`chord` : aucun plan de coin, aucune remarque (sorties inchangées)", () => {
    const p = withLine(choose(createProject("half-turn"), NOSING), "chord");
    const x = run(p);
    expect(x.r.cornerAngles).toBeUndefined();
    expect(x.r.output.notes.map((n) => n.key)).not.toContain(
      "structure.steelProfile.note.cornerAngleRemoved",
    );
  });
});

/**
 * Contrat des pièces d'un limon coudé (K2c, CK8, A33) sur un résultat du plugin : composantes
 * rattachées à une pièce finie présente, pièce finie sans développé, débit, masse, cordons ni
 * coupes, partition de l'âme, masse de débit des tronçons = ρ·A·(Σ encombrements − coupe de sol)
 * à ±1 % (cohérence des grandeurs ; la masse de débit est comparée à des valeurs indépendantes
 * dans le test de débit de j3c et dans les exports), tout anneau de perçage intérieur au contour
 * de son tronçon, à la pince `holeEdgeDistance` au moins des coupes de jarret, aucune composante
 * pour une face à un seul tronçon (I11).
 */
function expectCrankedParts(x: Run, density: number, project: Project): void {
  const ids = new Set(x.m.parts.map((p) => p.id));
  const s = x.r.section!;
  const sup = SteelProfileParamsSchema.parse(project.stair.structure.params).supports;
  const holeReach = Math.max(sup.holeEdgeDistance, sup.holeDiameter / 2 + sup.slotLength / 2);
  for (const st of x.r.stringers) {
    const comps = st.components ?? [];
    if (!st.bearing || st.bearing.segments.length < 2) {
      expect(comps, st.face.mark).toEqual([]);
      continue;
    }
    expect(comps).toHaveLength(st.bearing.segments.length);
    const f = st.part;
    expect(f.flat, f.mark).toBeUndefined();
    expect(f.stock, f.mark).toBeUndefined();
    for (const k of ["mass_kg", "weld_mm", "cuts", "volume_m3", "holes"]) {
      expect(f.quantities[k], `${f.mark} ${k}`).toBeUndefined();
    }
    expect(f.beamChord).toBeDefined();
    expect(f.solid.kind).toBe("sweep");
    comps.forEach((c, i) => {
      expect(c.componentOf).toBe(f.id);
      expect(ids.has(c.componentOf!)).toBe(true);
      expect(c.mark).toBe(`${f.mark}-${i + 1}`);
      expect(c.markName).toBeUndefined();
      expect(c.flat).toBeDefined();
      expect(c.flat!.lines.some((l) => l.kind === "bend")).toBe(false);
      expect(c.stock!.length).toBeGreaterThan(0);
    });
    // Partition de l'âme : aires des développés = aire du contour coupé au sol.
    const area = (pts: readonly { x: number; y: number }[]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        a += p.x * q.y - q.x * p.y;
      }
      return Math.abs(a / 2);
    };
    const sumArea = comps.reduce((a, c) => a + area(c.flat!.outline.outer), 0);
    expect(Math.abs(sumArea - area(st.outline)) / area(st.outline)).toBeLessThan(1e-6);
    const sumL = comps.reduce((a, c) => a + c.stock!.length, 0);
    expect(sumL).toBeCloseTo(st.cutLength, 6);
    const sumMass = comps.reduce((a, c) => a + c.quantities["mass_kg"]!, 0);
    const expected = (s.area * st.cutLength * density) / 1e9;
    expect(Math.abs(sumMass - expected) / expected).toBeLessThan(0.01);
    // Perçages : anneau entier dans le contour du tronçon, loin des coupes de jarret (un trou
    // trop près d'une coupe est reporté sur la pièce finie, après soudage, remarque).
    for (const c of comps) {
      const flat = c.flat!;
      const knees = flat.lines.filter(
        (l) =>
          l.label?.key === "structure.steelProfile.joint.knee" ||
          l.label?.key === "structure.steelProfile.joint.kneeWelded",
      );
      for (const ring of flat.outline.holes) {
        for (const q of ring) expect(insidePolygon(q, flat.outline.outer), c.mark).toBe(true);
        const cx = ring.reduce((a, q) => a + q.x, 0) / ring.length;
        const cy = ring.reduce((a, q) => a + q.y, 0) / ring.length;
        for (const k of knees) {
          expect(distanceToLine({ x: cx, y: cy }, k.a, k.b), c.mark).toBeGreaterThanOrEqual(
            holeReach - 1e-6,
          );
        }
      }
      expect(c.quantities["holes"]!).toBeGreaterThanOrEqual(flat.outline.holes.length);
    }
  }
}

/** Point strictement intérieur à un polygone simple (parité des croisements). */
function insidePolygon(q: { x: number; y: number }, poly: readonly { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance du point q à la droite (a, b). */
function distanceToLine(
  q: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / Math.hypot(dx, dy);
}

describe("steel-profile — pièces du limon coudé (K2c, CK8 à CK10, A33)", () => {
  const p = loadExample("j3c-acceptance-01-upn.blondel.json");
  const x = run(withLine(p, "nosing"));
  const density = resolveWorkshopProfile(p.workshop).metal.density;
  const comps = x.r.stringers.flatMap((s) => s.components ?? []);

  it("j3c : 4 pièces finies et 13 tronçons LI1 2, LE1 3, LI2 3, LE2 5 (du bas vers le haut)", () => {
    expect(x.r.stringers.map((s) => [s.face.mark, s.components?.length])).toEqual([
      ["LI1", 2],
      ["LE1", 3],
      ["LI2", 3],
      ["LE2", 5],
    ]);
    for (const c of comps) expect(c.mark).toMatch(/^L[EI]\d-\d+$/);
    // Ordre des pièces : chaque pièce finie suivie de ses tronçons.
    const order = x.r.output.parts.filter((q) => q.category === "stringer").map((q) => q.mark);
    expect(order.slice(0, 3)).toEqual(["LI1", "LI1-1", "LI1-2"]);
    expectCrankedParts(x, density, withLine(p, "nosing"));
    expect(checkSolids(x.m.parts)).toEqual([]);
    // Tronçons consécutifs assemblés (relation normalisée par le pipeline).
    const le2 = x.m.parts.filter((q) => q.componentOf === "stringer-outer-2");
    expect(le2[1]!.assembledWith).toEqual(expect.arrayContaining([le2[0]!.id, le2[2]!.id]));
  });

  it("j3c : coupes de jarret en lignes `joint` (9 « jarret » et 9 « jarret soudé »), aucune `bend`", () => {
    const lines = comps.flatMap((c) => c.flat!.lines);
    const keys = lines.map((l) => l.label?.key);
    expect(keys.filter((k) => k === "structure.steelProfile.joint.knee")).toHaveLength(9);
    expect(keys.filter((k) => k === "structure.steelProfile.joint.kneeWelded")).toHaveLength(9);
    expect(lines.some((l) => l.kind === "bend")).toBe(false);
    for (const c of comps) {
      const joints = c.flat!.lines.filter((l) => l.kind === "joint");
      expect(joints, c.mark).toHaveLength(2);
    }
  });

  it("j3c : débit Σ = longueurs K2b, coupes Σ = K2b, cordons = extrémités + cordons de jarret", () => {
    const k2b: Record<string, { cut: number; cuts: number }> = {
      LI1: { cut: 925.83, cuts: 5 },
      LE1: { cut: 1618.79, cuts: 7 },
      LI2: { cut: 2904.46, cuts: 6 },
      LE2: { cut: 3841.75, cuts: 10 },
    };
    const s = x.r.section!;
    const P = sectionPerimeter(s);
    for (const st of x.r.stringers) {
      const cs = st.components!;
      const ref = k2b[st.face.mark]!;
      expect(cs.reduce((a, c) => a + c.stock!.length, 0)).toBeCloseTo(ref.cut, 1);
      expect(cs.reduce((a, c) => a + c.quantities["cuts"]!, 0)).toBe(ref.cuts);
      // Masse de débit figée sur le débit K2b (valeurs indépendantes du calcul par tronçon).
      const sumMass = cs.reduce((a, c) => a + c.quantities["mass_kg"]!, 0);
      const k2bMass = (s.area * ref.cut * density) / 1e9;
      expect(Math.abs(sumMass - k2bMass) / k2bMass).toBeLessThan(0.01);
      // Cordon de jarret sur le tronçon du dessus, mesuré sur le développé : deux rives le long
      // du trait de coupe soudé (sa longueur, de rive basse à rive haute, vaut h / cos β) et les
      // largeurs transversales inchangées (P − 2h).
      cs.forEach((c, i) => {
        if (i === 0) return;
        const cut = c.flat!.lines.find(
          (l) => l.label?.key === "structure.steelProfile.joint.kneeWelded",
        )!;
        const knee = 2 * Math.hypot(cut.b.x - cut.a.x, cut.b.y - cut.a.y) + P - 2 * s.h;
        const end =
          i === cs.length - 1 && st.face.end === "newel"
            ? (2 * s.h) / Math.cos(st.bearing!.segments[i]!.alpha) + P - 2 * s.h
            : 0;
        expect(c.quantities["weld_mm"]!).toBeCloseTo(knee + end, 6);
      });
      expect(cs.reduce((a, c) => a + c.quantities["holes"]!, 0)).toBe(0);
    }
  });

  it("j3c en cornières boulonnées : perçages intérieurs aux tronçons, ceux d'un jarret reportés après soudage", () => {
    const bolted = (line: Line): Project =>
      withParams(p, {
        ...p.stair.structure.params,
        stringerLine: line,
        supports: { fixing: "bolted", bolts: 2 },
      });
    const b = run(bolted("nosing"));
    const c = run(bolted("chord"));
    expect(b.m.errors).toEqual([]);
    // Section de `nosing` au plus celle de la barre droite (UPN 180 contre UPN 240 en boulonné).
    expect(mass(b)).toBeLessThanOrEqual(mass(c));
    expectCrankedParts(b, density, bolted("nosing"));
    let drawn = 0;
    let counted = 0;
    for (const st of b.r.stringers) {
      const cs = st.components ?? [st.part];
      const n = cs.reduce((a, q) => a + q.quantities["holes"]!, 0);
      // Même nombre de perçages que la barre droite de la même face (aucun perdu ni doublé).
      const bar = c.r.stringers.find((q) => q.face.mark === st.face.mark)!;
      expect(n, st.face.mark).toBe(bar.part.quantities["holes"]);
      counted += n;
      drawn += cs.reduce((a, q) => a + q.flat!.outline.holes.length, 0);
    }
    expect(counted).toBeGreaterThan(0);
    // Cornière gardée en place (K-Q10 révisée) : au moins une est à cheval sur un jarret
    // (relecture K2c : LI2-2, LE2-3), ses perçages trop près de la coupe sont reportés, avec
    // une remarque.
    const notes = b.r.output.notes.filter(
      (n) => n.key === "structure.steelProfile.note.kneeHolesAfterWeld",
    );
    const deferred = notes.reduce((a, n) => a + Number(n.params?.["count"]), 0);
    expect(deferred).toBeGreaterThan(0);
    expect(drawn + deferred).toBe(counted);
  });

  it("j3c : débit des UPN par tronçon, trait de scie compris ; FAB_BARRE_LONGUEUR par tronçon", () => {
    const plan = x.r.cutting[x.r.section!.name]!;
    const pieces = plan.bars.flatMap((b) => b.pieces.map((q) => q.id));
    expect(pieces.sort()).toEqual(comps.map((c) => c.id).sort());
    // Tout est sous la plus grande barre : constat « ok » unique, mesuré sur la plus longue des
    // pièces contrôlées (tronçons, cornières, poteaux ; aucune pièce finie).
    const bar = x.r.output.checks.filter((c) => c.ruleId === "FAB_BARRE_LONGUEUR");
    expect(bar).toHaveLength(1);
    const others = [...x.r.posts, ...x.r.supports.map((sp) => sp.part)];
    const longest = Math.max(...[...comps, ...others].map((q) => q.stock!.length));
    expect(bar[0]!.measured).toBeCloseTo(longest, 9);
    expect(bar[0]!.measured).toBeLessThan(Math.max(...x.r.stringers.map((s) => s.cutLength)));
  });

  it("remarques : tronçons et cotes de gabarit par face coudée", () => {
    const keys = x.r.output.notes.map((n) => n.key);
    expect(keys.filter((k) => k === "structure.steelProfile.note.cranked")).toHaveLength(4);
    expect(keys.filter((k) => k === "structure.steelProfile.note.jigDimensions")).toHaveLength(4);
  });

  it("face coudée à un seul tronçon (U LI2) : pièce autonome, développé du tronçon, remarque propre", () => {
    const up = withLine(choose(loadExample("two-quarters-u.blondel.json")), "nosing");
    const u = run(up);
    const single = u.r.stringers.filter((s) => s.bearing && s.bearing.segments.length === 1);
    expect(single.length).toBeGreaterThan(0);
    for (const s of single) {
      expect(s.components).toBeUndefined();
      expect(s.part.flat).toBeDefined();
      expect(s.part.stock!.length).toBeCloseTo(s.cutLength, 9);
      expect(s.part.quantities["mass_kg"]).toBeGreaterThan(0);
      // Repère du tronçon : rive basse y = 0, rive haute y = h.
      const ys = s.part.flat!.outline.outer.map((q) => q.y);
      expect(Math.max(...ys)).toBeCloseTo(u.r.section!.h, 6);
    }
    const keys = u.r.output.notes.map((n) => n.key);
    expect(keys.filter((k) => k === "structure.steelProfile.note.crankedSingle")).toHaveLength(
      single.length,
    );
    expectCrankedParts(u, resolveWorkshopProfile(up.workshop).metal.density, up);
  });
});

describe("steel-profile — point fixe section ↔ poteau en `nosing` (K-Q15, K-Q19, K-Q20)", () => {
  const params = { family: "UPN", stringerLine: "nosing" };
  const which = (): boolean => true;
  const flangeAt = (variant: Project, n: NewelInner): number | null =>
    profileFlangeWidth(buildModel(withNewels(variant, n, which), { memo: false }).parts);
  const BUDGET = PROFILE_NEWEL_ITERATIONS + PROFILE_NEWEL_VERIFICATIONS;
  /** Résolution instrumentée : poteaux des modèles `nosing`, nombre de modèles `chord`. */
  const resolveCounted = (variant: Project) => {
    const nosingNewels: NewelInner[] = [];
    let chordModels = 0;
    const r = resolveProfileNewel(variant, which, (p) => {
      if ((p.stair.structure.params as Record<string, unknown>)["stringerLine"] === "nosing") {
        const t = "turns" in p.stair.layout ? p.stair.layout.turns[0]?.inner : undefined;
        if (t?.kind === "newel") nosingNewels.push(t);
      } else chordModels++;
      return buildModel(p, { memo: false });
    });
    return { r, nosingNewels, chordModels };
  };

  // Point fixe atteint : le poteau rendu est exact (aile + 2 × jeu de la section qu'il produit),
  // vérifié sur son propre modèle, sans violation ajoutée à la barre droite. K2e2 (K-Q16, K-Q18) :
  // quart 120 / 40 (UPN 220, M4 sans appui côté jour) ; demi-tournant exact 130 / 45 (UPN 260 en
  // erreur, comme la barre droite : M8 sans appui côté jour). Dépendance signalée en K2e2 : ces
  // nombres de modèles supposent M4 (quart, 49,6 mm sur poteau) et M8 (demi-tournant, 49 mm) sans
  // appui côté jour, à moins de 1 mm de la longueur minimale d'appui (50 mm) : un léger
  // déplacement du balancement ou du poteau les ferait passer à la règle du coin et changerait la
  // suite de modèles (voir `expectPostSensitive`).
  // Quart et demi-tournant : le nombre exact de modèles n'est exigé que si la zone sur poteau de
  // la marche au coin reste sous l'appui mini au poteau rendu (sinon : au plus le budget).
  const exact: [string, () => Project, number, number?][] = [
    ["j3c", () => loadExample("j3c-acceptance-01-upn.blondel.json"), 2],
    ["quart", () => loadExample("quarter-left.blondel.json"), 3, 4],
    ["U", () => loadExample("two-quarters-u.blondel.json"), 3],
    ["demi-tournant", () => loadExample("half-turn.blondel.json"), 2, 8],
  ];
  for (const [name, make, expectedModels, postTread] of exact) {
    it(`${name} : point fixe exact et vérifié, atteint en ${expectedModels} modèles coudés`, () => {
      const variant = withParams(make(), params);
      const { r, nosingNewels, chordModels } = resolveCounted(variant);
      expect(r).not.toBeNull();
      expect(r!.verified).toBe(true);
      const min = SteelProfileParamsSchema.parse(variant.stair.structure.params).supports.minLength;
      const zone =
        postTread === undefined
          ? -Infinity
          : postZone(run(withNewels(variant, r!.newel, which)), postTread);
      const why = `zone sur poteau M${postTread} : ${zone.toFixed(2)} mm pour ${min}`;
      if (zone < min - 1e-9) expect(nosingNewels, why).toHaveLength(expectedModels);
      else expect(nosingNewels.length, why).toBeLessThanOrEqual(BUDGET);
      expect(chordModels).toBeLessThanOrEqual(BUDGET);
      // Arrêt sur le poteau exact : le dernier modèle coudé construit est celui du poteau rendu.
      expect(newelMatches(nosingNewels[nosingNewels.length - 1]!, r!.newel)).toBe(true);
      const b = flangeAt(variant, r!.newel);
      expect(b).toBe(r!.flangeWidth);
      expect(newelMatches(r!.newel, expectedNewel("steel-profile", params, b)!)).toBe(true);
    }, 60_000);
  }

  // Sans poteau exact atteint : poteau vérifié qui reçoit sa section (K-Q15), sans violation
  // ajoutée (K-Q19). j5b : 100 → 110 / 35 → 120 / 40 (non vérifiés, plafond de trois modèles),
  // puis le modèle de vérification de K-Q20 retient 125 / 43 (UPN 200). j4-demi : 130 / 45
  // retenu non exact (UPN 200) ; K-Q20 essaie 115 / 38 (UPN 260, ne reçoit pas l'aile) et garde
  // 130 / 45.
  const noFixedPoint: [string, () => Project, NewelInner][] = [
    ["j5b (comparateur)", () => j5bReference("chord"), { kind: "newel", size: 125, offset: 43 }],
    [
      "j4-demi",
      () => loadExample("j4-demi-tournant-acier-garde-corps.blondel.json"),
      { kind: "newel", size: 130, offset: 45 },
    ],
  ];
  for (const [name, make, want] of noFixedPoint) {
    it(`${name} : poteau vérifié rendu (${want.size} / ${want.offset}), UPN ≤ 200 sans erreur ni violation ajoutée, en ≤ ${BUDGET} modèles coudés`, () => {
      const variant = withParams(make(), params);
      const { r, nosingNewels, chordModels } = resolveCounted(variant);
      expect(r).not.toBeNull();
      expect(r!.newel).toEqual(want);
      expect(r!.verified).toBe(true);
      expect(nosingNewels.length).toBeLessThanOrEqual(BUDGET);
      expect(chordModels).toBeLessThanOrEqual(BUDGET);
      const b1 = flangeAt(variant, r!.newel)!;
      expect(b1).toBe(r!.flangeWidth);
      expect(profileNewelFits(r!.newel, b1, SteelProfileParamsSchema.parse(params).newel)).toBe(
        true,
      );
      const atReturned = run(withNewels(variant, r!.newel, which));
      expect(atReturned.r.section!.h).toBeLessThanOrEqual(200);
      expect(errorKeys(atReturned)).toEqual([]);
      expect(reserve(atReturned)).toBeGreaterThanOrEqual(5);
    }, 120_000);
  }

  it("j4-demi : le poteau 110 / 35 n'est pas vérifié (UPN 260, aile 90, `newelSatisfies` faux : rejet du point fixe, pas de K-Q19), jamais rendu ; il ajouterait G_COLLET_MONOTONE et FAB_SUPPORT_LONGUEUR_MIN à la barre droite", () => {
    const raw = loadExample("j4-demi-tournant-acier-garde-corps.blondel.json");
    const variant = withParams(raw, params);
    const n110: NewelInner = { kind: "newel", size: 110, offset: 35 };
    // Montée de section due à K-Q16 (M9 sans appui côté jour à ce poteau) : aile 90.
    expect(flangeAt(variant, n110)).toBe(90);
    expect(newelSatisfies(n110, "steel-profile", params, 90)).toBe(false);
    const ref = run(choose(raw, { family: "UPN" }));
    const at110 = run(withNewels(variant, n110, which));
    expect(excessOverChord(ref, at110)).toEqual({
      G_COLLET_MONOTONE: 1,
      FAB_SUPPORT_LONGUEUR_MIN: 1,
    });
    expect(resolveCounted(variant).r!.newel).not.toEqual(n110);
  }, 60_000);

  // K-Q19 sur modèle réel : exemples d'acceptation en IPE. Le point fixe coudé passe par 140 / 50
  // (IPE 180, vérifié), qui ajoute FAB_SUPPORT_LONGUEUR_MIN et FAB_SUPPORT_DEBORD à la base
  // (maximum de la barre droite à 190 / 75 et du coudé à 190 / 75) : écarté ; le poteau de la
  // référence, 190 / 75, jugé sur le modèle coudé de la base, est retenu (IPE 200).
  const ipeAcceptance = [
    "acceptance-01-quart-tournant",
    "j3a-acceptance-01-bois",
    "j3b-acceptance-01-acier-plat",
    "j3b-acceptance-01-tole-pliee",
    "j3c-acceptance-01-upn",
    "j4-acceptance-01-garde-corps",
  ];
  for (const f of ipeAcceptance) {
    it(`${f} en IPE : 140 / 50 écarté (K-Q19), poteau de la barre droite 190 / 75 retenu, aucune règle en violation de plus que la barre droite`, () => {
      const raw = loadExample(`${f}.blondel.json`);
      const ipe = { family: "IPE", stringerLine: "nosing" };
      const variant = withParams(raw, ipe);
      const { r, nosingNewels } = resolveCounted(variant);
      expect(nosingNewels).toContainEqual({ kind: "newel", size: 140, offset: 50 });
      expect(r).toEqual({
        newel: { kind: "newel", size: 190, offset: 75 },
        flangeWidth: 100,
        verified: true,
      });
      const chosen = applyStructureChoice(raw, "steel-profile", ipe);
      expect(chosen.notes.map((n) => n.key)).not.toContain(
        "project.structureChoice.newelAddsViolations",
      );
      const nosing = run(chosen.project);
      const chord = run(choose(raw, { family: "IPE" }));
      expect(nosing.r.section!.name).toBe("IPE 200");
      expect(excessOverChord(chord, nosing)).toEqual({});
    }, 60_000);
  }

  it("aucun poteau retenu (escalier généré, IPE) : jour de la barre droite posé, remarque neutre (K-Q25, K-Q29)", () => {
    // Barre droite : poteau élargi refusé par le tracé, poteau par défaut (FAB_POTEAU_RECEPTION) ;
    // en coudé, les poteaux élargis acceptés par le tracé réduisent le collet (G_COLLET_MIN) :
    // aucun n'est retenu (K-Q19), le jour de la barre droite du même projet est gardé (K-Q25).
    // Le coudé à ce jour n'ajoute rien à la barre droite : remarque neutre (K-Q29, K2f2).
    const project = fc.sample(stairArb(["M1", "M3"], SAME_SIDE_TYPOLOGIES), {
      numRuns: 1,
      seed: 777,
    })[0]!.project;
    const ipe = { family: "IPE", stringerLine: "nosing" };
    const chosen = applyStructureChoice(project, "steel-profile", ipe);
    expect(chosen.notes.map((n) => n.key)).not.toContain(
      "project.structureChoice.newelAddsViolations",
    );
    const note = chosen.notes.find((n) => n.key === "project.structureChoice.newelFromChord");
    expect(note).toBeDefined();
    // Rendu traduit (fr, en) : règles et jour gardé listés par `common.list`.
    const fr = translatorFor("fr").t(note!);
    const en = translatorFor("en").t(note!);
    expect(fr).toContain("FAB_MARCHE_PORTEE ; G_COLLET_MIN");
    expect(en).toContain("FAB_MARCHE_PORTEE; G_COLLET_MIN");
    expect(fr).toContain("sans violation ajoutée");
    expect(en).toContain("with no added violation");
    for (const text of [fr, en]) {
      expect(text).toContain("K-Q25");
      expect(text).toContain("K-Q29");
      expect(text).not.toMatch(/\{|\}|\[object/);
    }
    const r = resolveProfileNewel(
      withParams(project, ipe),
      (t) => t.inner.kind === "sharp" || t.inner.kind === "newel",
    )!;
    expect(r.chordJour?.rules).toEqual(["FAB_MARCHE_PORTEE", "G_COLLET_MIN"]);
    expect(r.chordJour?.keptAdds).toEqual([]);
    // Jours posés = jours de la barre droite du même projet (`applyStructureChoice` en `chord`).
    const chordChoice = applyStructureChoice(project, "steel-profile", { family: "IPE" });
    const innersOf = (p: Project) =>
      p.stair.layout.kind === "cage" ? [] : p.stair.layout.turns.map((t) => t.inner);
    expect(innersOf(chosen.project)).toEqual(innersOf(chordChoice.project));
    expect(r.chordJour?.turns).toEqual(innersOf(chordChoice.project));
    // Remarques de pose de la barre droite, puis la remarque K-Q25 (jour gardé nommé).
    expect(chosen.notes.slice(0, -1)).toEqual(chordChoice.notes);
    expect(chosen.notes[chosen.notes.length - 1]).toBe(note);
    expect(note!.params?.["jour"]).toBeDefined();
    // Remarque neutre : aucune règle en violation de plus que la barre droite (FAB_ONGLET_RACCORD
    // exempté, comme dans `keptAdds`).
    const nosingRun = run(chosen.project);
    const chordRun = run(chordChoice.project);
    const excess = Object.keys(excessOverChord(chordRun, nosingRun));
    expect(excess.filter((k) => k !== "FAB_ONGLET_RACCORD")).toEqual([]);
  }, 60_000);

  // K-Q29 (K2f2) : escaliers générés en IPE (graine 4242) où aucun poteau n'est retenu (K-Q25).
  // Seul arb113 garde un jour qui ajoute encore une violation à la barre droite
  // (FAB_SUPPORT_DEBORD + 1, alors que ses poteaux écartés citaient FAB_SUPPORT_LONGUEUR_MIN) :
  // `newelAddsViolations` avec `{added}` ; les autres prennent la remarque neutre.
  const IPE_KQ25 = [
    [13, []],
    [46, []],
    [52, []],
    [72, []],
    [76, []],
    [92, []],
    [113, ["FAB_SUPPORT_DEBORD"]],
  ] as const;
  it("K-Q29 : escaliers générés en IPE sans poteau retenu, remarque neutre sauf jour gardé qui ajoute une violation (arb113, FAB_SUPPORT_DEBORD), rendu fr / en", () => {
    const projects = fc
      .sample(stairArb(["M1", "M3"], ALL_TYPOLOGIES), { numRuns: 120, seed: 4242 })
      .map((s) => s.project);
    const ipe = { family: "IPE", stringerLine: "nosing" };
    const which = (t: { inner: { kind: string } }): boolean =>
      t.inner.kind === "sharp" || t.inner.kind === "newel";
    for (const [i, adds] of IPE_KQ25) {
      const project = projects[i]!;
      const r = resolveProfileNewel(withParams(project, ipe), which)!;
      expect(r.chordJour, `arb${i}`).toBeDefined();
      expect(r.chordJour!.keptAdds, `arb${i}`).toEqual(adds);
      const chosen = applyStructureChoice(project, "steel-profile", ipe);
      const note = chosen.notes[chosen.notes.length - 1]!;
      expect(note.key, `arb${i}`).toBe(
        adds.length > 0
          ? "project.structureChoice.newelAddsViolations"
          : "project.structureChoice.newelFromChord",
      );
      const fr = translatorFor("fr").t(note);
      const en = translatorFor("en").t(note);
      for (const text of [fr, en]) {
        expect(text).toContain("K-Q29");
        expect(text).not.toMatch(/\{|\}|\[object/);
      }
      // Modèle livré contre la barre droite du même projet : excédent = règles annoncées.
      const nosingRun = run(chosen.project);
      const chordRun = run(
        applyStructureChoice(project, "steel-profile", { family: "IPE" }).project,
      );
      const excess = Object.keys(excessOverChord(chordRun, nosingRun)).filter(
        (k) => k !== "FAB_ONGLET_RACCORD",
      );
      expect(excess, `arb${i}`).toEqual([...adds]);
      if (adds.length > 0) {
        expect(note.params?.["added"]).toEqual(textMessage("FAB_SUPPORT_DEBORD"));
        expect(fr).toContain("ajoute encore FAB_SUPPORT_DEBORD");
        expect(en).toContain("still adds FAB_SUPPORT_DEBORD");
        // Les poteaux écartés citaient une autre règle.
        expect(r.chordJour!.rules).toEqual(["FAB_SUPPORT_LONGUEUR_MIN"]);
      } else {
        expect(fr).toContain("sans violation ajoutée");
        expect(en).toContain("with no added violation");
      }
    }
  }, 300_000);

  // Les remarques K-Q29 ne sortent pas sur cette graine en UPN (relecture K2f2) : leurs deux
  // branches sont prouvées par le test IPE épinglé ci-dessus (7 escaliers de la graine 4242). La
  // propriété ne peut pas tirer d'IPE : la ligne coudée y crée un débord d'appui quel que soit le
  // poteau (FAB_SUPPORT_DEBORD, lecture de K-Q24), excédent sans remarque attendu.
  it("propriété (UPN, escaliers générés) : applyStructureChoice en `nosing` ne lève pas ; aucune règle en violation de plus que la barre droite, sauf poteau signalé ; K-Q19 écarte des poteaux (compteur)", () => {
    let evaluated = 0;
    let acted = 0;
    const which = (t: { inner: { kind: string } }): boolean =>
      t.inner.kind === "sharp" || t.inner.kind === "newel";
    // Modèle sans contrôle de conception : K-Q19 n'écarte rien (référence du compteur).
    const blind = (p: Project): Model => {
      const m = buildModel(p, { memo: false });
      return { ...m, compliance: { ...m.compliance, results: [] } };
    };
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
        if (project.stair.layout.kind === "cage" || project.stair.layout.turns.length === 0) return;
        let nosing: Run;
        let chord: Run;
        let flagged: boolean;
        let added: readonly string[] | null = null;
        let chosenProject: Project;
        try {
          const chosen = applyStructureChoice(project, "steel-profile", params);
          chosenProject = chosen.project;
          const adds = chosen.notes.find(
            (n) => n.key === "project.structureChoice.newelAddsViolations",
          );
          // K-Q29 : remarque qui nomme les règles ajoutées par le jour gardé, ou remarque neutre.
          flagged =
            adds !== undefined ||
            chosen.notes.some((n) => n.key === "project.structureChoice.newelFromChord");
          if (adds) {
            const r = resolveProfileNewel(withParams(project, params), which)!;
            added = r.chordJour!.keptAdds;
            expect(added.length).toBeGreaterThan(0);
          }
          nosing = run(chosen.project);
          chord = run(choose(project, { family: "UPN" }));
        } catch (e) {
          // Découpage en faces impossible (tournants opposés S / Z…) : hors du limon coudé.
          if (e instanceof StructureError) return;
          throw e;
        }
        evaluated++;
        // Sans remarque, ou remarque neutre (K-Q29) : aucun excédent sur la barre droite ;
        // `newelAddsViolations` : excédent (hors FAB_ONGLET_RACCORD) = règles nommées `{added}`.
        const excess = Object.keys(excessOverChord(chord, nosing)).filter(
          (k) => k !== "FAB_ONGLET_RACCORD",
        );
        if (!flagged) expect(excessOverChord(chord, nosing)).toEqual({});
        else expect(excess).toEqual(added === null ? [] : [...added]);
        // K-Q25 : remarque présente ⇒ jours posés = jours de la barre droite du même projet.
        if (flagged) {
          const innersOf = (p: Project) =>
            p.stair.layout.kind === "cage" ? [] : p.stair.layout.turns.map((t) => t.inner);
          const chordChoice = applyStructureChoice(project, "steel-profile", { family: "UPN" });
          expect(innersOf(chosenProject)).toEqual(innersOf(chordChoice.project));
        }
        const variant = withParams(project, params);
        const a = resolveProfileNewel(variant, which);
        const b = resolveProfileNewel(variant, which, blind);
        if (a && b && !newelMatches(a.newel, b.newel)) acted++;
      }),
      { numRuns: 60, seed: 42 },
    );
    expect(evaluated).toBeGreaterThan(30);
    expect(acted).toBeGreaterThan(0);
  }, 300_000);
});

/**
 * Escaliers à paliers en volées (quart ou deux quarts, palier d'angle `landing`), pour K-Q18 :
 * H ∈ [2 400 ; 3 000], E ∈ [800 ; 1 000], volées de 1 300 à 3 900 mm ; tracé refusé : écarté.
 */
const landingArb = fc
  .record({
    H: fc.integer({ min: 2400, max: 3000 }),
    E: fc.integer({ min: 800, max: 1000 }),
    legs: fc.oneof(
      fc.tuple(fc.integer({ min: 1300, max: 2600 }), fc.integer({ min: 2600, max: 3900 })),
      fc.tuple(
        fc.integer({ min: 1300, max: 2200 }),
        fc.integer({ min: 1000, max: 1800 }),
        fc.integer({ min: 1300, max: 2600 }),
      ),
    ),
    direction: fc.constantFrom("left" as const, "right" as const),
  })
  .map((r) => ({
    project: makeSteppingProject({
      width: r.E,
      legs: [...r.legs],
      direction: r.direction,
      mode: "landing",
      floorToFloor: r.H,
    }),
  }));

describe("steel-profile — propriété sur escaliers générés (limon coudé)", () => {
  it("ne lève pas, section ≤ barre droite, aucune erreur nouvelle, faces coudées, repliées ou à une seule pente, cornière au coin du mur gardée (K2e), marche sans appui côté jour et palier gardant toutes leurs cornières (K2e2)", () => {
    let evaluated = 0;
    let bent = 0;
    let corners = 0;
    let jourless = 0;
    let landings = 0;
    fc.assert(
      fc.property(
        fc.oneof(stairArb(undefined, ALL_TYPOLOGIES), landingArb),
        fc.boolean(),
        ({ project }, bolted) => {
          const withNewelsP: Project = {
            ...project,
            stair: {
              ...project.stair,
              layout: {
                ...project.stair.layout,
                turns: project.stair.layout.turns.map((t) => ({
                  ...t,
                  inner: { kind: "newel" as const, size: 120 },
                })),
              },
            },
          };
          let p: Project;
          let chord: Run;
          try {
            p = choose(withNewelsP, {
              family: "UPN",
              ...(bolted ? { supports: { fixing: "bolted", bolts: 2 } } : {}),
            });
            // Tracé refusé (palier généré trop court…) : hors du limon coudé.
            if (!buildModel(p, { memo: false }).layout) return;
            chord = run(withLine(p, "chord"));
          } catch (e) {
            // Découpage en faces impossible (tournants opposés S / Z…) : hors du limon coudé.
            if (e instanceof StructureError) return;
            throw e;
          }
          const nosingProject = withLine(p, "nosing");
          expect(() => buildModel(nosingProject, { memo: false })).not.toThrow();
          const nosing = run(nosingProject);
          evaluated++;
          expect(mass(nosing)).toBeLessThanOrEqual(mass(chord));
          const known = new Set(errorKeys(chord));
          expect(errorKeys(nosing).filter((k) => !known.has(k))).toEqual([]);
          // Aucune règle nouvelle en violation ; FAB_ONGLET_RACCORD toléré aux coins d'un repli
          // `heavier` (K-Q21 : onglet ouvert accepté, cas arb12 de la relecture K2e).
          const excess = excessOverChord(chord, nosing);
          expect(newViolations(chord, nosing).filter((r) => r in excess)).toEqual([]);
          const plan = nosing.r.cranked!;
          for (const s of nosing.r.stringers) {
            const f = plan.faces.get(s.face.id)!;
            if (s.bearing) {
              bent++;
              expect(f.mode).toBe("nosing");
              expect(s.part.solid.kind).toBe("sweep");
            } else {
              expect(f.mode).toBe("chord");
              // Repli signalé, ou face à une seule pente (CK7) sans remarque.
              if (!f.fallback) expect(s.part.solid.kind).toBe("extrusion");
              expect(s.crankedFallback).toEqual(f.fallback);
            }
          }
          const viol = (x: Run): number =>
            x.m.compliance.results.filter(
              (c) => c.ruleId === "FAB_SUPPORT_DANS_LIMON" && c.status === "violation",
            ).length;
          expect(viol(nosing)).toBe(0);
          expect(checkSolids(nosing.m.parts)).toEqual([]);
          // I11 (K2c) : composantes rattachées, aucun double compte, masses à ±1 %.
          expectCrankedParts(
            nosing,
            resolveWorkshopProfile(p.workshop).metal.density,
            nosingProject,
          );
          const ids = new Set(nosing.m.parts.map((q) => q.id));
          for (const q of nosing.m.parts) {
            if (q.componentOf !== undefined) expect(ids.has(q.componentOf)).toBe(true);
          }
          // K2e (K-Q4) : au moins une cornière par marche au coin du mur, retirées facultatives
          // et signalées ; K2e2 (K-Q16, K-Q18) : marche sans appui côté jour et palier sans
          // retrait ni facultative (`expectCornerAngles`).
          corners += expectCornerAngles(nosing, nosingProject);
          jourless += plan?.corner.jourless.size ?? 0;
          const landingTreads = nosing.m.stepping.treads.filter((t) => t.kind === "landing");
          landings += landingTreads.length;
          // Aucune remarque de retrait pour une marche sans appui côté jour ou un palier.
          const kept = new Set([
            ...(plan?.corner.jourless ?? []),
            ...landingTreads.map((t) => t.number),
          ]);
          expect((nosing.r.cornerAngles?.removed ?? []).filter((r) => kept.has(r.tread))).toEqual(
            [],
          );
        },
      ),
      // Graine fixée (relecture K2f) : sans graine, les compteurs de non-vacuité ci-dessous
      // cédaient environ une fois sur dix au réglage par défaut (« sans appui côté jour » le plus
      // souvent), d'autant plus que `STEPPING_RUNS` est petit.
      { numRuns: RUNS, seed: 42 },
    );
    expect(evaluated, "évalués").toBeGreaterThan(RUNS / 2);
    expect(bent, "coudés").toBeGreaterThan(0);
    expect(corners, "coins").toBeGreaterThan(0);
    expect(jourless, "sans appui côté jour").toBeGreaterThan(0);
    expect(landings, "paliers").toBeGreaterThan(0);
  }, 300_000);
});

describe("steel-profile — limon coudé, IPE (âme à shift)", () => {
  it("j3c en IPE : limons coudés, onglets fermés au bout d'aile, solides valides", () => {
    const p = withParams(loadExample("j3c-acceptance-01-upn.blondel.json"), {
      family: "IPE",
      stringerLine: "nosing",
    });
    const x = run(p);
    expect(x.r.section?.family).toBe("IPE");
    expect(findSection(x.r.section!.name)).toBeDefined();
    expect(x.r.stringers.some((s) => s.bearing)).toBe(true);
    expect(checkSolids(x.m.parts)).toEqual([]);
    const miters = x.r.output.checks.filter((c) => c.ruleId === "FAB_ONGLET_RACCORD");
    const bentPairs = miters.length > 0 && x.r.stringers.every((s) => s.bearing);
    if (bentPairs) for (const c of miters) expect(c.measured!).toBeLessThan(1e-6);
    expect(sectionsOf("IPE").indexOf(x.r.section!)).toBeLessThanOrEqual(
      sectionsOf("IPE").indexOf(run(withLine(p, "chord")).r.section!),
    );
  });
});

/**
 * Cages à palier droit générées (sous-lot K2f) : deux ou trois tronçons droits, jonctions en
 * palier droit (profondeur 300 à 1 500 mm) ou tournantes à pan coupé, bords de palier alignés
 * (largeur constante) ou non (largeurs tirées). Le palier imposé est à la première jonction ou,
 * avec trois tronçons, à la dernière : palier droit **après un tournant** (relevé de la partie
 * de niveau du coin, relecture K2f).
 */
/** Erreur du refus d'un raccord de palier (K-Q27, K2f2). */
const LANDING_REFUSED = "structure.steelProfile.error.landingSpliceRefused";

const landingCageArb = fc
  .record({
    sections: fc.array(
      fc.record({
        length: fc.integer({ min: 900, max: 2200 }),
        width: fc.integer({ min: 800, max: 1100 }),
        widthEnd: fc.option(fc.integer({ min: 800, max: 1100 }), { nil: undefined }),
      }),
      { minLength: 2, maxLength: 3 },
    ),
    junctions: fc.array(
      fc.record({
        landing: fc.boolean(),
        angle: fc.integer({ min: 30, max: 120 }),
        setback: fc.integer({ min: 200, max: 350 }),
        depth: fc.integer({ min: 300, max: 1500 }),
      }),
      { minLength: 2, maxLength: 2 },
    ),
    sign: fc.constantFrom(1, -1),
    aligned: fc.boolean(),
    landingLast: fc.boolean(),
  })
  .map((r) => ({
    kind: "cage" as const,
    sections: r.sections.map((s) => ({
      axis: { kind: "straight" as const, length: s.length },
      width: r.aligned ? 900 : s.width,
      ...(!r.aligned && s.widthEnd !== undefined ? { widthEnd: s.widthEnd } : {}),
    })),
    junctions: r.sections.slice(1).map((_, i) => {
      const j = r.junctions[i]!;
      const forced = r.landingLast ? i === r.sections.length - 2 : i === 0;
      return j.landing || forced
        ? { angle: 0, mode: "landing" as const, depth: j.depth }
        : {
            angle: r.sign * j.angle,
            mode: "winders" as const,
            well: { kind: "chamfer" as const, setbackIn: j.setback, setbackOut: j.setback },
          };
    }),
  }));

describe("steel-profile — plats de palier du limon coudé (relecture K2f)", () => {
  const cage = (floorToFloor: number, layout: unknown): Project =>
    ProjectSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      site: { floorToFloor, upperSlabThickness: 200 },
      stair: {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout,
        structure: { kind: "steel-profile", params: { family: "UPN", stringerLine: "nosing" } },
      },
    });
  const straight = (length: number, width: number, widthEnd: number) => ({
    axis: { kind: "straight" as const, length },
    width,
    widthEnd,
  });

  it("palier droit après un tournant : partie de niveau du coin relevée au niveau du palier, rive de niveau sur le plat, aucun constat", () => {
    // Cas de la relecture (graine 9191, #119) : le nez du palier tombe à 22,9 mm après le coin
    // LI2 → LIP2 ; la partie de niveau était à P(σ) = 2 805,2, 13,3 mm sous lui, et LIP2 montait
    // en pente le long du palier.
    const p = cage(3347, {
      kind: "cage",
      sections: [straight(1776, 958, 1070), straight(1955, 1118, 913), straight(603, 874, 913)],
      junctions: [
        {
          angle: -86,
          mode: "winders",
          well: { kind: "chamfer", setbackIn: 322, setbackOut: 322 },
        },
        { angle: 0, mode: "landing", depth: 1640 },
      ],
    });
    const x = run(p);
    expect(errorKeys(x)).toEqual([]);
    const nos = x.m.stepping.nosings;
    const landing = x.m.stepping.treads.find((t) => t.kind === "landing")!;
    const zLanding = nos[landing.number - 1]!.z;
    const result = x.r.cranked!.result;
    const lip2 = x.r.stringers.find((s) => s.face.mark === "LIP2")!;
    const corner = result.corners.find((c) => c.faceAfter === lip2.face.id)!;
    expect(corner.z).toBeCloseTo(zLanding, 9);
    expect(corner.skippedNoses).toContain(landing.number - 1);
    expect(lip2.bearing).toBeDefined();
    const k = landing.number - 1;
    const going = nos[k + 2]!.sigmaInner - nos[k + 1]!.sigmaInner;
    const flatEnd = nos[k + 1]!.sigmaInner - going - lip2.face.sigmaA;
    expect(flatEnd).toBeGreaterThan(1000);
    for (const u of [0, flatEnd / 2, flatEnd]) {
      expect(polylineAt(lip2.bearing!.line, u)).toBeCloseTo(zLanding, 6);
    }
    expect(result.issues.filter((i) => i.kind === "landingNotLevel")).toEqual([]);
  });

  it("palier trop court entre les parties de niveau de ses coins : constat `landingNotLevel` et remarque de la face", () => {
    // Cas de la relecture (graine 2026, cage#27) : palier de 310 mm, plat de 113,7 mm avant la
    // montée vers la volée suivante ; la partie de niveau du coin haut (1 260) ne laisse pas de
    // place à un raccord depuis la fin du plat : la rive monte de 180 mm sur le palier.
    const p = cage(2700, {
      kind: "cage",
      sections: [straight(908, 853, 917), straight(1570, 893, 1074)],
      junctions: [{ angle: 0, mode: "landing", depth: 310 }],
    });
    const x = run(p);
    expect(errorKeys(x)).toEqual([]);
    const result = x.r.cranked!.result;
    for (const mark of ["LIP1", "LEP1"]) {
      const st = x.r.stringers.find((s) => s.face.mark === mark)!;
      expect(st.bearing, mark).toBeDefined();
      const issues = result.issues.filter(
        (i) => i.kind === "landingNotLevel" && i.faceId === st.face.id,
      );
      expect(issues, mark).toHaveLength(1);
      const i = issues[0]!;
      if (i.kind !== "landingNotLevel") throw new Error(mark);
      expect(i.excess).toBeCloseTo(180, 6);
      const notes = x.r.output.notes.filter(
        (n) =>
          n.key === "structure.steelProfile.note.landingNotLevel" && n.params?.["mark"] === mark,
      );
      expect(notes, mark).toHaveLength(1);
      expect(notes[0]!.params?.["excess"]).toEqual(dec(180, 0));
    }
  });
});

describe("steel-profile — propriété sur cages à palier droit générées (K2f, `nosing`)", () => {
  it("ne lève pas, palier construit, rives continues aux raccords de palier, plat du palier de niveau (ou écart justifié), composantes sans double compte, règles ≤ barre droite d'essai", () => {
    let evaluated = 0;
    let joints = 0;
    let flats = 0;
    let notLevel = 0;
    let afterTurn = 0;
    let refusedRuns = 0;
    let raised = 0;
    fc.assert(
      fc.property(landingCageArb, (layout) => {
        const p = ProjectSchema.parse({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          site: { floorToFloor: 2700, upperSlabThickness: 200 },
          stair: {
            placement: { origin: { x: 0, y: 0 }, rotation: 0 },
            layout,
            structure: { kind: "steel-profile", params: { family: "UPN", stringerLine: "nosing" } },
          },
        });
        let m!: Model;
        expect(() => (m = buildModel(p, { memo: false }))).not.toThrow();
        const keys = (m.errors ?? []).map((e) => e.key);
        expect(keys).not.toContain("structure.cageUnsupported");
        expect(keys).not.toContain("pipeline.internalError");
        // Tracé impossible (tronçons qui se recouvrent…) : hors du domaine.
        if (m.stepping.treads.length === 0 || keys.some((k) => k.startsWith("layout."))) return;
        evaluated++;
        const js = layout.junctions;
        if (
          js.some(
            (j, i) => j.mode === "landing" && js.slice(0, i).some((q) => q.mode !== "landing"),
          )
        )
          afterTurn++;
        const x = run(p);
        const ref = run(withRefKind(withLine(p, "chord")));
        // K-Q27 (K2f2) : refus du raccord de palier, seule erreur permise en plus de la référence.
        const known = new Set([...errorKeys(ref), LANDING_REFUSED]);
        expect(errorKeys(x).filter((k) => !known.has(k))).toEqual([]);
        const refused = errorKeys(x).includes(LANDING_REFUSED);
        // Section plus lourde que la barre droite d'essai : seulement par K-Q27, la section de la
        // barre droite étant écartée par un limon gardé coudé ou refusée à un raccord de palier.
        if (!refused && mass(x) > mass(ref)) {
          raised++;
          expect(sectionDiscardedByKQ27(x, ref)).toBe(true);
        }
        const a = violationCounts(x);
        const b = violationCounts(ref);
        for (const [rule, n] of Object.entries(a)) {
          if (rule !== "FAB_ONGLET_RACCORD") expect(n, rule).toBeLessThanOrEqual(b[rule] ?? 0);
        }
        if (refused) {
          refusedRuns++;
          expect(x.m.parts.some((q) => q.category === "stringer")).toBe(false);
          return;
        }
        expectCrankedParts(x, resolveWorkshopProfile(p.workshop).metal.density, p);
        // Raccords de palier : deux limons coudés (K-Q27), rives haute et basse continues.
        for (const s of x.r.stringers) {
          if (s.face.endCorner?.joint !== "landing") continue;
          const t = x.r.stringers.find(
            (q) =>
              q.face.side === s.face.side &&
              q.face.startCorner?.joint === "landing" &&
              Math.abs(q.face.sigmaA - s.face.sigmaA - s.face.faceLength) < 1e-6,
          );
          if (!t) continue;
          expect(s.bearing, `${s.face.mark} / ${t.face.mark}`).toBeDefined();
          expect(t.bearing, `${s.face.mark} / ${t.face.mark}`).toBeDefined();
          if (!s.bearing || !t.bearing) continue;
          joints++;
          const ra = riveFns(s.bearing);
          const rb = riveFns(t.bearing);
          expect(Math.abs(ra.upper(s.face.faceLength) - rb.upper(0))).toBeLessThan(1e-6);
          expect(Math.abs(ra.lower(s.face.faceLength) - rb.lower(0))).toBeLessThan(1e-6);
        }
        // K-Q18 : un palier ne forme aucun groupe du coin et garde toutes ses cornières.
        expectCornerAngles(x, p);
        // Plat du palier (convention de `nosingPitchLine` : du nez du palier à un giron avant le
        // nez suivant) de niveau sur chaque limon coudé, au-dessus comme au-dessous, sauf le
        // raccord glissant vers la partie de niveau d'un coin plus haut (`rampBefore`, convention
        // K2f) ; tout autre écart (palier trop court entre les parties de niveau de ses coins,
        // jarret retiré pour tronçon court) est publié par le constat `landingNotLevel` du noyau
        // et par une remarque de la face.
        const nos = x.m.stepping.nosings;
        const result = x.r.cranked!.result;
        for (const tr of x.m.stepping.treads) {
          if (tr.kind !== "landing") continue;
          const k = tr.number - 1;
          if (k < 0 || k + 2 >= nos.length) continue;
          for (const st of x.r.stringers) {
            if (!st.bearing) continue;
            const sg = (j: number): number =>
              st.face.side === "inner" ? nos[j]!.sigmaInner : nos[j]!.sigmaOuter;
            const g = sg(k + 2) - sg(k + 1);
            const lo = Math.max(sg(k) - st.face.sigmaA, st.uLo);
            let hi = Math.min(Math.max(sg(k), sg(k + 1) - g) - st.face.sigmaA, st.uHi);
            // Raccord glissant lu sur le coin de fin de la chaîne de palier du limon (son départ
            // peut tomber dans un membre précédent de la chaîne).
            let last = st;
            for (let guard = 0; guard < 8 && last.face.endCorner?.joint === "landing"; guard++) {
              const end = last.face.sigmaA + last.face.faceLength;
              const next = x.r.stringers.find(
                (q) =>
                  q.face.side === last.face.side &&
                  q.face.startCorner?.joint === "landing" &&
                  Math.abs(q.face.sigmaA - end) < 1e-6,
              );
              if (!next) break;
              last = next;
            }
            const corner = result.corners.find((c) => c.faceBefore === last.face.id);
            if (corner?.rampBefore !== undefined) {
              const sigmaRamp = last.face.sigmaA + last.face.faceLength - corner.rampBefore;
              hi = Math.min(hi, sigmaRamp - st.face.sigmaA);
            }
            if (!(hi - lo > 1e-6)) continue;
            flats++;
            const us = [lo, hi, ...st.bearing.line.map((q) => q.x).filter((u) => u > lo && u < hi)];
            const dev = Math.max(
              ...us.map((u) => Math.abs(polylineAt(st.bearing!.line, u) - nos[k]!.z)),
            );
            if (dev <= 1e-6) continue;
            notLevel++;
            const issue = result.issues.find(
              (i) =>
                i.kind === "landingNotLevel" &&
                i.faceId === st.face.id &&
                i.u0 < hi + 1e-6 &&
                i.u1 > lo - 1e-6 &&
                i.excess >= dev - 1e-6,
            );
            expect(issue, `${st.face.mark} M${tr.number} écart ${dev}`).toBeDefined();
            expect(
              x.r.output.notes.some(
                (n) =>
                  n.key === "structure.steelProfile.note.landingNotLevel" &&
                  n.params?.["mark"] === st.face.mark,
              ),
              `${st.face.mark} M${tr.number} remarque`,
            ).toBe(true);
          }
        }
      }),
      { numRuns: Math.max(RUNS, 40), seed: 2026 },
    );
    expect(evaluated, "évalués").toBeGreaterThan(20);
    expect(joints, "raccords de palier coudés").toBeGreaterThan(0);
    expect(flats, "plats de palier").toBeGreaterThan(0);
    expect(afterTurn, "paliers après un tournant").toBeGreaterThan(0);
    // Plats non de niveau (publiés) : cas de bord, bornés (mesure K2f : voir le journal).
    expect(notLevel, "plats non de niveau publiés").toBeLessThanOrEqual(flats / 10);
    // Refus K-Q27 : minoritaires (mesure K2f2 : 2 sur 40 tirages de cette graine).
    expect(refusedRuns, "refus K-Q27").toBeLessThanOrEqual(evaluated / 5);
    // Sections montées (K-Q27) : rares, toutes expliquées ci-dessus (0 sur cette graine).
    expect(raised, "sections montées").toBeLessThanOrEqual(evaluated / 10);
  }, 300_000);
});

/** Paires du plugin : limons consécutifs d'un même côté reliés par un raccord de palier. */
function landingPairs(x: Run): [ProfileStringerOf, ProfileStringerOf][] {
  const out: [ProfileStringerOf, ProfileStringerOf][] = [];
  for (const s of x.r.stringers) {
    if (s.face.endCorner?.joint !== "landing") continue;
    const t = x.r.stringers.find(
      (q) =>
        q.face.side === s.face.side &&
        q.face.startCorner?.joint === "landing" &&
        Math.abs(q.face.sigmaA - s.face.sigmaA - s.face.faceLength) < 1e-6,
    );
    if (t) out.push([s, t]);
  }
  return out;
}
type ProfileStringerOf = SteelProfileResult["stringers"][number];

/**
 * Section de la barre droite d'essai écartée par K-Q27 dans le limon coudé : un limon de chaîne de
 * palier y est gardé coudé au-delà de la section, ou refusé.
 */
function sectionDiscardedByKQ27(x: Run, ref: Run): boolean {
  const name = ref.r.section?.name;
  const landing = x.r.landing;
  return (
    name !== undefined &&
    landing !== undefined &&
    (landing.forcedSections.includes(name) || landing.refusedSections.includes(name))
  );
}

/** Raccord mixte : un limon coudé abouté à une barre droite repliée (face à une seule pente exclue). */
function isMixedSplice(s: ProfileStringerOf, t: ProfileStringerOf): boolean {
  const straight = (q: ProfileStringerOf): boolean => !q.bearing && q.crankedFallback !== undefined;
  return (!!s.bearing && straight(t)) || (straight(s) && !!t.bearing);
}

describe("steel-profile — raccords de palier, coudé forcé sinon refus (K-Q27, K2f2, `nosing`)", () => {
  it("propriété (cages générées, graine 2026) : aucun raccord mixte, refus chiffré sinon, chaînes du noyau = paires du plugin, règles ≤ barre droite d'essai, aucun limon forcé dans la section retenue ; cas exercés (compteurs)", () => {
    let splices = 0;
    let refusals = 0;
    // Modèles dont au moins une section essayée a été écartée par un limon gardé coudé (K-Q27) :
    // un limon forcé ne loge jamais dans la section de son plan (repli `heavier`), donc aucune
    // section retenue n'en porte (vérifié ci-dessous).
    let sectionsDiscardedByForcing = 0;
    let mixed = 0;
    let forcedNoSection = 0;
    const allowed = new Set([
      "emptyWindow",
      "cutsCross",
      "shortSegment",
      "noseAboveRive",
      "steepSegment",
      "lostSupport",
      "heavier",
      "beyondCatalog",
      "beyondSection",
    ]);
    fc.assert(
      fc.property(landingCageArb, (layout) => {
        const p = ProjectSchema.parse({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          site: { floorToFloor: 2700, upperSlabThickness: 200 },
          stair: {
            placement: { origin: { x: 0, y: 0 }, rotation: 0 },
            layout,
            structure: { kind: "steel-profile", params: { family: "UPN", stringerLine: "nosing" } },
          },
        });
        let m!: Model;
        expect(() => (m = buildModel(p, { memo: false }))).not.toThrow();
        const keys = (m.errors ?? []).map((e) => e.key);
        expect(keys).not.toContain("pipeline.internalError");
        if (m.stepping.treads.length === 0 || keys.some((k) => k.startsWith("layout."))) return;
        const x = run(p);
        const ref = run(withRefKind(withLine(p, "chord")));
        const known = new Set([...errorKeys(ref), LANDING_REFUSED]);
        expect(errorKeys(x).filter((k) => !known.has(k))).toEqual([]);
        // Aucune règle en violation de plus que la barre droite d'essai (K-Q24), hors onglet.
        const a = violationCounts(x);
        const b = violationCounts(ref);
        for (const [rule, n] of Object.entries(a)) {
          if (rule !== "FAB_ONGLET_RACCORD") expect(n, rule).toBeLessThanOrEqual(b[rule] ?? 0);
        }
        const landing = x.r.landing!;
        if (landing.forcedSections.length > 0) sectionsDiscardedByForcing++;
        if (errorKeys(x).includes(LANDING_REFUSED)) {
          refusals++;
          // Refus : seules les marches, une erreur par limon refusé, membre d'une chaîne.
          expect(x.r.stringers).toEqual([]);
          expect(x.m.parts.some((q) => q.category === "stringer")).toBe(false);
          const errs = x.m.errors.filter((e) => e.key === LANDING_REFUSED);
          expect(errs).toHaveLength(landing.refusals.length);
          for (const r of landing.refusals) {
            expect(landing.chains).toContainEqual(r.chain);
            expect(r.chain).toContain(r.faceId);
            expect(allowed.has(r.reason.kind), r.reason.kind).toBe(true);
            if (r.reason.kind === "heavier") expect(Number.isFinite(r.reason.bent)).toBe(false);
          }
          for (const e of errs) {
            const t = translatorFor("en").t(e);
            expect(t).not.toMatch(/\{|\}|\[object|NaN|undefined/);
          }
          return;
        }
        expect(landing.refusals).toEqual([]);
        // Aucun limon forcé dans la section retenue (section automatique : écartée par le choix).
        for (const fp of x.r.cranked!.faces.values()) expect(fp.landingForced).toBeUndefined();
        expect(landing.forcedSections).not.toContain(x.r.section!.name);
        // `noSectionPasses` après des sections écartées par forçage : remarque qui les nomme.
        if (
          errorKeys(x).includes("structure.steelProfile.error.noSectionPasses") &&
          landing.forcedSections.length > 0
        ) {
          forcedNoSection++;
          expect(
            x.r.output.notes.some(
              (n) => n.key === "structure.steelProfile.note.landingForcedSections",
            ),
          ).toBe(true);
        }
        // Chaînes du noyau = paires du plugin (même côté, raccord de palier, σ continu).
        const pairs = landingPairs(x);
        const fromChains = landing.chains.flatMap((c) =>
          c.slice(1).map((id, k) => `${c[k]}>${id}`),
        );
        expect(pairs.map(([s, t]) => `${s.face.id}>${t.face.id}`).sort()).toEqual(
          [...fromChains].sort(),
        );
        for (const [s, t] of pairs) {
          splices++;
          if (isMixedSplice(s, t)) mixed++;
          // Deux barres droites (aucun limon coudé) : hors K-Q27, comportement de K2f.
          if (!s.bearing || !t.bearing) continue;
          const ra = riveFns(s.bearing);
          const rb = riveFns(t.bearing);
          expect(Math.abs(ra.upper(s.face.faceLength) - rb.upper(0))).toBeLessThan(1e-6);
          expect(Math.abs(ra.lower(s.face.faceLength) - rb.lower(0))).toBeLessThan(1e-6);
        }
        // Section plus lourde que la barre droite d'essai : seulement par K-Q27.
        if (mass(x) > mass(ref)) expect(sectionDiscardedByKQ27(x, ref)).toBe(true);
      }),
      { numRuns: 100, seed: 2026 },
    );
    // Mesure (relecture K2f2) : 86 raccords, 9 refus, 8 modèles à sections écartées par forçage,
    // 1 `noSectionPasses` après forçage.
    expect(splices, "raccords de palier").toBeGreaterThan(0);
    expect(mixed, "raccords mixtes").toBe(0);
    expect(refusals, "refus K-Q27").toBeGreaterThanOrEqual(1);
    expect(sectionsDiscardedByForcing, "sections écartées par forçage").toBeGreaterThanOrEqual(1);
    expect(forcedNoSection, "noSectionPasses après forçage").toBeGreaterThanOrEqual(1);
  }, 300_000);

  // Section montée par K-Q27 (relecture K2f2 ; cage générée de la graine 31337, tirage 74) :
  // cage alignée 909 / 1 064 / 1 338 mm, paliers droits de 309 et 1 196 mm, chaînes de trois
  // limons par côté. Barre droite d'essai : UPN 220 (âme requise 206,5 mm, LI2 / LE2). Limon
  // coudé : en UPN 220, LI1 et LI3 sont coudés et LI2 replié `heavier` (256,8 mm coudé) ; LI2
  // est gardé coudé (K-Q27), il dépasse l'UPN 220, qui est écartée ; en UPN 240, toute la chaîne
  // est coudée (LI2 : 166,4 mm). En UPN 220 imposée : refus `beyondSection` chiffré.
  const RAISED_LAYOUT = {
    kind: "cage" as const,
    sections: [909, 1064, 1338].map((length) => ({
      axis: { kind: "straight" as const, length },
      width: 900,
    })),
    junctions: [309, 1196].map((depth) => ({ angle: 0, mode: "landing" as const, depth })),
  };
  const raisedProject = (params: Record<string, unknown>): Project =>
    ProjectSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      site: { floorToFloor: 2700, upperSlabThickness: 200 },
      stair: {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout: RAISED_LAYOUT,
        structure: { kind: "steel-profile", params },
      },
    });

  it("section montée (cage 909 / 1 064 / 1 338, paliers 309 et 1 196) : UPN 240 retenue contre UPN 220 en barre droite d'essai, UPN 220 écartée par LI2 / LE2 gardés coudés (256,8 mm) ; chaînes toutes coudées", () => {
    const p = raisedProject({ family: "UPN", stringerLine: "nosing" });
    const x = run(p);
    const ref = run(withRefKind(withLine(p, "chord")));
    expect(ref.r.section!.name).toBe("UPN 220");
    expect(ref.r.requiredHeight).toBeCloseTo(206.5, 1);
    expect(x.r.section!.name).toBe("UPN 240");
    expect(errorKeys(x)).toEqual([]);
    expect(mass(x)).toBeGreaterThan(mass(ref));
    expect(sectionDiscardedByKQ27(x, ref)).toBe(true);
    const landing = x.r.landing!;
    expect(landing.chains).toHaveLength(2);
    expect(landing.chains.every((c) => c.length === 3)).toBe(true);
    expect(landing.forcedSections).toEqual(["UPN 140", "UPN 160", "UPN 180", "UPN 200", "UPN 220"]);
    expect(landing.refusedSections).toEqual([]);
    for (const id of landing.chains.flat()) {
      expect(x.r.cranked!.faces.get(id)!.mode, id).toBe("nosing");
      expect(x.r.cranked!.faces.get(id)!.landingForced, id).toBeUndefined();
    }
    for (const [s, t] of landingPairs(x)) expect(isMixedSplice(s, t)).toBe(false);
    // Aucune règle en violation de plus que la barre droite d'essai (hors onglet).
    const a = violationCounts(x);
    const b = violationCounts(ref);
    for (const [rule, n] of Object.entries(a)) {
      if (rule !== "FAB_ONGLET_RACCORD") expect(n, rule).toBeLessThanOrEqual(b[rule] ?? 0);
    }
    // UPN 220 imposée : LI2 et LE2 ne logent pas coudés, refus chiffré.
    const imposed = run(
      raisedProject({ family: "UPN", stringerLine: "nosing", section: "UPN 220" }),
    );
    expect(errorKeys(imposed)).toEqual([LANDING_REFUSED, LANDING_REFUSED]);
    const marks = imposed.m.errors.map((e) => e.params?.["mark"]);
    expect(marks).toEqual(["LI2", "LE2"]);
    for (const r of imposed.r.landing!.refusals) {
      expect(r.reason.kind).toBe("beyondSection");
      if (r.reason.kind === "beyondSection") expect(r.reason.bent).toBeCloseTo(256.8, 1);
    }
    expect(translatorFor("fr").t(imposed.m.errors[0]!)).toContain(
      "âme requise 256,8 mm, plus que la section imposée UPN 220 (220 mm)",
    );
  });

  it("`noSectionPasses` après des sections écartées par forçage : remarque qui les nomme, rendu fr / en", () => {
    const m = msg("structure.steelProfile.note.landingForcedSections", {
      sections: msg("common.list", { first: textMessage("IPN 200"), rest: textMessage("IPN 220") }),
    });
    expect(translatorFor("fr").t(m)).toContain("sections IPN 200 ; IPN 220, écartées");
    expect(translatorFor("en").t(m)).toContain("sections IPN 200; IPN 220, discarded");
    for (const l of ["fr", "en"] as const) {
      expect(translatorFor(l).t(m)).toContain("K-Q27");
      expect(translatorFor(l).t(m)).not.toMatch(/\{|\}|\[object/);
    }
  });
});
