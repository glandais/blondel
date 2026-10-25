/**
 * Limon coudé câblé dans `steel-profile` (sous-lot K2b, paramètre `stringerLine`) sur des
 * escaliers réels : paramètres rétrocompatibles, `chord` sans nouveau chemin, escaliers droits
 * identiques en `nosing` (CK7), critères de fin de K2b (j3c, j5b du comparateur, onglets au bout
 * d'aile, hauteur de poteau, point fixe section ↔ poteau), non-régression par rapport à la barre
 * droite grâce au repli par face (K-Q12, K-Q13) et propriété sur escaliers générés.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findSection, sectionsOf } from "../catalog/sections.js";
import type { Model } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { checkSolids } from "../parts/solidChecks.js";
import { buildModel } from "../pipeline/build.js";
import { expectedNewel, newelMatches, withNewels, type NewelInner } from "../project/newel.js";
import { parseProjectText } from "../project/parse.js";
import {
  PROFILE_NEWEL_ITERATIONS,
  applyStructureChoice,
  resolveProfileNewel,
} from "../project/structureChoice.js";
import { precheckModel } from "../precheck/stringers.js";
import { ALL_TYPOLOGIES, makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { adaptJour } from "./compare.js";
import { riveFns } from "./profileBearing.js";
import { StructureError } from "./registry.js";
import {
  SteelProfileParamsSchema,
  buildSteelProfile,
  profileFlangeWidth,
  profileNewelFits,
  type SteelProfileResult,
} from "./steelProfile.js";
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

  // Cages à palier droit : `buildModel` refuse les profilés (palier droit non pris en charge,
  // `structure.cageUnsupported`) dans les deux modes ; les critères ci-dessous ne portent que sur
  // le plugin appelé directement (chemin que l'utilisateur n'atteint pas encore).
  for (const file of [
    "cage-60-palier-limon.blondel.json",
    "cage-60-palier-central.blondel.json",
    "cage-45-palier-acier.blondel.json",
  ]) {
    it(`${file} : profilés refusés par buildModel dans les deux modes (aucun limon)`, () => {
      const p = choose(loadExample(file));
      for (const line of ["chord", "nosing"] as const) {
        const x = run(withLine(p, line));
        expect(errorKeys(x)).toContain("structure.cageUnsupported");
        expect(x.m.parts.some((q) => q.category === "stringer")).toBe(false);
      }
    });
  }

  it("cage-60-palier-limon, plugin seul : limon de jour en pan coupé replié (nez au-dessus de la rive, raccord raide), sans erreur", () => {
    const x = run(withLine(choose(loadExample("cage-60-palier-limon.blondel.json")), "nosing"));
    expect(x.r.output.errors ?? []).toEqual([]);
    const reasons = new Map(
      x.r.stringers.map((s) => [s.face.mark, s.crankedFallback?.kind ?? "coudé"]),
    );
    expect(reasons.get("LIC1")).toBe("noseAboveRive");
    expect(reasons.get("LI2")).toBe("steepSegment");
  });

  for (const [name, file, kinds] of [
    [
      "demo-cage-flared-steel",
      "demo-cage-flared-steel.blondel.json",
      ["noseAboveRive", "steepSegment"],
    ],
    ["cage-45-palier-acier (plugin seul)", "cage-45-palier-acier.blondel.json", ["heavier"]],
  ] as const) {
    it(`${name} : repli signalé par une remarque, aucune erreur nouvelle`, () => {
      const p = choose(loadExample(file));
      const chord = run(withLine(p, "chord"));
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

describe("steel-profile — point fixe section ↔ poteau en `nosing`", () => {
  const params = { family: "UPN", stringerLine: "nosing" };
  const which = (): boolean => true;
  const flangeAt = (variant: Project, n: NewelInner): number | null =>
    profileFlangeWidth(buildModel(withNewels(variant, n, which), { memo: false }).parts);

  // Point fixe atteint : le poteau rendu est exact (aile + 2 × jeu de la section qu'il produit)
  // et a été vérifié sur son propre modèle avant le plafond de `PROFILE_NEWEL_ITERATIONS`
  // modèles (la boucle s'arrête sur `newelMatches`, pas sur le plafond).
  const exact: [string, () => Project, number][] = [
    ["j3c", () => loadExample("j3c-acceptance-01-upn.blondel.json"), 2],
    ["quart", () => loadExample("quarter-left.blondel.json"), 2],
    ["demi-tournant", () => loadExample("half-turn.blondel.json"), 2],
    ["U", () => loadExample("two-quarters-u.blondel.json"), 3],
  ];
  for (const [name, make, expectedModels] of exact) {
    it(`${name} : point fixe exact, atteint en ${expectedModels} modèles (≤ ${PROFILE_NEWEL_ITERATIONS})`, () => {
      const variant = withParams(make(), params);
      const built: NewelInner[] = [];
      const r = resolveProfileNewel(variant, which, (p) => {
        const t = "turns" in p.stair.layout ? p.stair.layout.turns[0]?.inner : undefined;
        if (t?.kind === "newel") built.push(t);
        return buildModel(p, { memo: false });
      });
      expect(r).not.toBeNull();
      expect(built).toHaveLength(expectedModels);
      // Arrêt sur le poteau exact : le dernier modèle construit est celui du poteau rendu.
      expect(newelMatches(built[built.length - 1]!, r!.newel)).toBe(true);
      const b = flangeAt(variant, r!.newel);
      expect(b).toBe(r!.flangeWidth);
      expect(newelMatches(r!.newel, expectedNewel("steel-profile", params, b)!)).toBe(true);
    }, 60_000);
  }

  // j5b du comparateur : **aucun poteau exact** (question ouverte, ledger K2b). Le balancement
  // change avec le poteau : le poteau attendu par la section obtenue sur le poteau rendu en
  // donne une autre, dont le poteau attendu revient au premier (cycle). `resolveProfileNewel`
  // rend le poteau vérifié qui reçoit sa section (`profileNewelFits`).
  it("j5b (comparateur) : pas de point fixe, cycle entre deux poteaux ; poteau rendu qui reçoit sa section (UPN ≤ 240)", () => {
    const variant = withParams(j5bReference("chord"), params);
    const r = resolveProfileNewel(variant, which)!;
    expect(r).not.toBeNull();
    const b1 = flangeAt(variant, r.newel)!;
    expect(b1).toBe(r.flangeWidth);
    expect(profileNewelFits(r.newel, b1, SteelProfileParamsSchema.parse(params).newel)).toBe(true);
    const atReturned = run(withNewels(variant, r.newel, which));
    expect(atReturned.r.section!.h).toBeLessThanOrEqual(240);
    const n2 = expectedNewel("steel-profile", params, b1)!;
    expect(newelMatches(r.newel, n2)).toBe(false);
    const atExpected = run(withNewels(variant, n2, which));
    expect(atExpected.r.section!.h).toBeGreaterThan(240);
    const n3 = expectedNewel("steel-profile", params, flangeAt(variant, n2))!;
    expect(newelMatches(n3, r.newel)).toBe(true);
  }, 60_000);
});

describe("steel-profile — propriété sur escaliers générés (limon coudé)", () => {
  it("ne lève pas, section ≤ barre droite, aucune erreur nouvelle, faces coudées, repliées ou à une seule pente", () => {
    let evaluated = 0;
    let bent = 0;
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
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
          p = choose(withNewelsP);
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
        expect(newViolations(chord, nosing)).toEqual([]);
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
      }),
      { numRuns: RUNS },
    );
    expect(evaluated).toBeGreaterThan(RUNS / 2);
    expect(bent).toBeGreaterThan(0);
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
