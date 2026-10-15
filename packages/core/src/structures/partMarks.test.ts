/**
 * Attribution des repères sur les exemples (chantier part-marks R2a, décisions F10 Q1a, Q1b,
 * Q2) : cornières et supports regroupés autour de la plus courte à T près (T =
 * `workshop.identicalPartTolerance`), signature des perçages dans la clé, entretoises comparées
 * à la plus petite. R2b (Q3, C3, (23)) : une ligne de débit par repère (cotes du représentant
 * recopiées, solide réel), régime de répartition des perçages dans la clé.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { msg, type Message } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Model, Part, RuleResult } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { MARK_REPRESENTATIVE_RULE, resolveWorkshopProfile } from "../workshop/profile.js";
import { countUniqueParts } from "./compare.js";
import { expectFittedNotLarger, expectMarkNames, expectMarksUnified } from "./marks.testing.js";
import { QUANTITY_BUTT_WELD_MM, QUANTITY_WELD_MM } from "./steelCommon.js";
import { minAreaRect } from "./geom.js";
import { refreshRemarkedChecks } from "./steelCurved.js";
import { markGroups } from "./steelFlat.js";
import {
  drillingPositions,
  supportGroupKey,
  supportPart,
  treadScrewDistribution,
  type SupportPlacement,
  type SupportSpec,
} from "./supports.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

const example = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

const withTolerance = (p: Project, t: number): Project => ({
  ...p,
  workshop: { ...p.workshop, identicalPartTolerance: t },
});

const build = (p: Project): Model => buildModel(p, { memo: false });

const markOf = (m: Model, id: string): string | undefined => m.parts.find((p) => p.id === id)?.mark;

/** Longueur réelle d'une barre (profondeur de son solide extrudé), sinon longueur de débit. */
const realLength = (p: Part): number =>
  p.solid.kind === "extrusion" ? p.solid.depth : (p.stock?.length ?? 0);

/** Réglages de `markGroups` pour des cornières (désignation commune, décision F10 Q6). */
const CR_OPTS = { markName: () => msg("structure.common.support.angleWelded") };

/** Pièces d'un repère, groupées. */
const byMark = (parts: readonly Part[]): Map<string, Part[]> => {
  const out = new Map<string, Part[]>();
  for (const p of parts) out.set(p.mark, [...(out.get(p.mark) ?? []), p]);
  return out;
};

describe("repères des cornières et supports (F10 Q1a, Q2)", () => {
  it("cage-45-palier-acier : CR2 réunit 139,964 et 139,507 mm (écart 0,457), séparés à T = 0,4", () => {
    const p = example("cage-45-palier-acier");
    const m = build(p);
    const a = "support-4-stringer-inner-1";
    const b = "support-7-stringer-inner-j1";
    expect(markOf(m, a)).toBe("CR2");
    expect(markOf(m, b)).toBe("CR2");
    const m4 = build(withTolerance(p, 0.4));
    expect(markOf(m4, a)).not.toBe(markOf(m4, b));
  });

  it("j3c-acceptance-01-upn (steel-profile) : CR3 (72,424 et 72,728 mm) séparé à T = 0,2", () => {
    const p = example("j3c-acceptance-01-upn");
    const a = "support-2-stringer-inner-1";
    const b = "support-3-stringer-inner-1";
    const m = build(p);
    expect(markOf(m, a)).toBe("CR3");
    expect(markOf(m, b)).toBe("CR3");
    const m2 = build(withTolerance(p, 0.2));
    expect(markOf(m2, a)).not.toBe(markOf(m2, b));
  });

  it("deux supports de même longueur dont le diamètre de perçage diffère : deux repères", () => {
    const m = build(example("cage-45-palier-acier"));
    const cr1 = m.parts.filter((p) => p.mark === "CR1").slice(0, 2);
    expect(cr1).toHaveLength(2);
    const drilled = (p: Part, d: number): Part => ({
      ...p,
      fixings: [{ joint: "treadBolted", points: 2, holeDiameter: d }],
    });
    const same = markGroups(
      [drilled(cr1[0]!, 7), drilled(cr1[1]!, 7)],
      "CR",
      supportGroupKey,
      0.5,
      CR_OPTS,
    );
    expect(new Set(same.map((p) => p.mark)).size).toBe(1);
    const diff = markGroups(
      [drilled(cr1[0]!, 7), drilled(cr1[1]!, 9)],
      "CR",
      supportGroupKey,
      0.5,
      CR_OPTS,
    );
    expect(diff.map((p) => p.mark)).toEqual(["CR1", "CR2"]);
  });

  it("propriété : T tiré dans [0, 2], tout repère CR / PS a un écart de longueur ≤ T + ε et une seule clé", () => {
    const projects = [
      "cage-45-palier-acier",
      "demo-cage-flared-steel",
      "j3c-acceptance-01-upn",
    ].map(example);
    fc.assert(
      fc.property(
        fc.constantFrom(...projects),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (p, t) => {
          const m = build(withTolerance(p, t));
          expect(m.errors).toEqual([]);
          const supports = m.parts.filter((x) => /^(CR|PS)\d+$/.test(x.mark));
          expect(supports.length).toBeGreaterThan(0);
          for (const [, g] of byMark(supports)) {
            // Longueur réelle (solide), la longueur de débit étant celle du représentant (Q3).
            const ls = g.map(realLength);
            expect(Math.max(...ls) - Math.min(...ls)).toBeLessThanOrEqual(t + GEOM_EPS);
            expect(new Set(g.map(supportGroupKey)).size).toBe(1);
            // Représentant : la plus courte, règle exposée à l'interface (rappel ◆, décision (30)).
            expect(MARK_REPRESENTATIVE_RULE).toBe("shortest");
            for (const x of g) expect(x.stock!.length).toBeCloseTo(Math.min(...ls), 9);
          }
          expectMarksUnified(m);
          expectMarkNames(m);
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);
});

describe("repères des entretoises (F10 Q1b) : comparaison à la plus petite", () => {
  it("cage-60-palier-central : EC1 = {1, 2, 6, 7, 8, 9}, EC2 = {3, 4}, EC3 = {5}", () => {
    const m = build(example("cage-60-palier-central"));
    const ec = m.parts.filter((p) => p.id.startsWith("central-diaphragm-"));
    const groups = [...byMark(ec)]
      .map(([mark, g]): [string, number[]] => [
        mark,
        g.map((p) => Number(p.id.slice("central-diaphragm-".length))).sort((a, b) => a - b),
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    expect(groups).toEqual([
      ["EC1", [1, 2, 6, 7, 8, 9]],
      ["EC2", [3, 4]],
      ["EC3", [5]],
    ]);
  });

  it("T = 0 : mêmes repères qu'à T = 1e-9 (développés identiques au bruit près réunis)", () => {
    for (const name of ["cage-60-palier-central", "j5c-limon-central-helicoidal"]) {
      const p = example(name);
      const marks = (t: number): number =>
        new Set(build(withTolerance(p, t)).parts.map((x) => x.mark)).size;
      expect(marks(0)).toBe(marks(1e-9));
    }
  }, 60_000);
});

// ------------------------------------------------------------------ R2b : recopie (Q3)

const ALL_EXAMPLES = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".blondel.json"))
  .map((f) => f.slice(0, -".blondel.json".length))
  .sort();

describe("une ligne de débit par repère (F10 Q3, C3) : cotes du représentant recopiées", () => {
  it.each(ALL_EXAMPLES)(
    "%s : pièces d'un même repère aux mêmes cotes de débit, désignation et référence communes",
    (name) => {
      const m = build(example(name));
      expectMarksUnified(m);
      expectMarkNames(m);
    },
  );

  it("préréglage helical : pièces d'un même repère aux mêmes cotes de débit", () => {
    const m = build(createProject("helical"));
    expectMarksUnified(m);
    expectMarkNames(m);
  });

  /** Pièces d'un repère et la pièce attendue comme représentant (cotes réelles à T = 0). */
  const representatives: readonly (readonly [string, string, string])[] = [
    ["cage-60-palier-central", "EC1", "central-diaphragm-6"],
    ["cage-60-palier-central", "EC2", "central-diaphragm-4"],
    ["demo-cage-central-steel", "EC1", "central-diaphragm-3"],
    ["cage-45-palier-acier", "CR2", "support-7-stringer-inner-j1"],
    ["j3c-acceptance-01-upn", "CR11", "support-9-stringer-outer-2"],
  ];

  it.each(representatives)("%s : %s débité sur %s (la plus petite)", (name, mark, repId) => {
    const p = example(name);
    const m = build(p);
    const real = build(withTolerance(p, 0));
    const rep = real.parts.find((x) => x.id === repId)!;
    const members = m.parts.filter((x) => x.mark === mark);
    expect(members.length).toBeGreaterThan(1);
    expect(members.map((x) => x.id)).toContain(repId);
    for (const x of members) {
      expect(x.stock).toEqual(rep.stock);
      // Le représentant est la plus petite pièce du repère (longueur réelle à T = 0).
      const own = real.parts.find((y) => y.id === x.id)!;
      expect(own.stock!.length).toBeGreaterThanOrEqual(rep.stock!.length - GEOM_EPS);
    }
  });

  /** Masse volumique (kg/m³) d'une pièce, lue dans ses grandeurs. */
  const density = (p: Part): number => p.quantities["mass_kg"]! / p.quantities["volume_m3"]!;
  const perimeter = (pts: readonly { x: number; y: number }[]): number =>
    pts.reduce(
      (s, q, i) =>
        s + Math.hypot(pts[(i + 1) % pts.length]!.x - q.x, pts[(i + 1) % pts.length]!.y - q.y),
      0,
    );

  it.each([
    "cage-45-palier-acier",
    "cage-60-palier-central",
    "demo-cage-central-steel",
    "demo-cage-flared-steel",
    "demo-quarter-curved",
    "j3c-acceptance-01-upn",
    "j5b-debillarde-soude",
  ])(
    "%s : par pièce, débit à au plus T de la pièce réelle (T = 0), cordons inchangés",
    (name) => {
      const p = example(name);
      const t = resolveWorkshopProfile(p.workshop).identicalPartTolerance;
      const m = build(p);
      const real = new Map(build(withTolerance(p, 0)).parts.map((x) => [x.id, x]));
      let changed = 0;
      for (const x of m.parts) {
        const r = real.get(x.id);
        if (!r || !x.stock || !r.stock) continue;
        const dl = Math.abs(x.stock.length - r.stock.length);
        const dw = Math.abs(x.stock.width - r.stock.width);
        expect(dl, x.id).toBeLessThanOrEqual(t + 1e-6);
        expect(dw, x.id).toBeLessThanOrEqual(t + 1e-6);
        if (dl > 1e-9 || dw > 1e-9) changed++;
        const dm = Math.abs((x.quantities["mass_kg"] ?? 0) - (r.quantities["mass_kg"] ?? 0));
        if (r.flat) {
          // Développé : aire changée d'au plus périmètre × T.
          const bound =
            (density(r) * r.flat.thickness * perimeter(r.flat.outline.outer) * (t + 1e-6)) / 1e9;
          expect(dm, x.id).toBeLessThanOrEqual(bound + 1e-12);
        } else {
          // Barre : section × T.
          const bound = (r.quantities["mass_kg"]! / r.stock.length) * (t + 1e-6);
          expect(dm, x.id).toBeLessThanOrEqual(bound + 1e-12);
        }
        // Cordons : grandeurs d'assemblage de la pièce en place, jamais recopiées.
        for (const k of [QUANTITY_WELD_MM, QUANTITY_BUTT_WELD_MM])
          expect(x.quantities[k], `${x.id} ${k}`).toBe(r.quantities[k]);
        // Solide réel.
        expect(x.solid, x.id).toEqual(r.solid);
      }
      expect(changed).toBeGreaterThan(0);
    },
    60_000,
  );

  it("steel-curved (demo-quarter-curved) : recopie faite une seule fois, sur les valeurs réelles", () => {
    const m = build(example("demo-quarter-curved"));
    const cr13 = m.parts.filter((x) => x.mark === "CR13");
    expect(cr13).toHaveLength(2);
    expect(cr13.map((x) => x.stock!.length)).toEqual([
      Math.min(...cr13.map(realLength)),
      Math.min(...cr13.map(realLength)),
    ]);
  });
});

// ------------------------------------------------------------------ R2b : décision (23)

describe("régime de répartition des perçages dans la clé des supports (F10 (23))", () => {
  const spec: SupportSpec = {
    kind: "angle",
    fixing: "welded",
    angleLeg: 40,
    angleThickness: 4,
    plateWidth: 60,
    plateThickness: 8,
    bolts: 0,
    holeDiameter: 11,
    slotLength: 0,
    holeEdgeDistance: 30,
    treadScrews: 2,
  };
  const place = (tread: number, length: number): SupportPlacement => ({
    tread,
    treadMark: `M${tread}`,
    face: {
      key: "stringer-inner-1",
      owner: "stringer-inner-1",
      ownerMark: "LI1",
      kind: "stringer",
      side: "inner",
      a: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      into: { x: 0, y: 1 },
      uMin: 0,
      uMax: 5000,
    },
    u0: 100 * tread,
    u1: 100 * tread + length,
    zTop: 200 * tread,
  });
  const profile = resolveWorkshopProfile(undefined);
  const T = profile.identicalPartTolerance;

  it("support long : entre pinces ; un seul point : centré ; trop court : régulier", () => {
    expect(treadScrewDistribution(place(1, 200), spec)).toBe("betweenEdges");
    expect(treadScrewDistribution(place(1, 200), { ...spec, treadScrews: 1 })).toBe("centered");
    expect(treadScrewDistribution(place(1, 50), spec)).toBe("even");
    expect(treadScrewDistribution(place(1, 200), { ...spec, treadScrews: 0 })).toBeNull();
  });

  it.each(["wood", "steel"] as const)(
    "marche %s : supports de 2 × pince ± T/4, même nombre de perçages, deux repères",
    (tread) => {
      const lo = 2 * spec.holeEdgeDistance - T / 4;
      const hi = 2 * spec.holeEdgeDistance + T / 4;
      const parts = [
        supportPart(place(1, lo), spec, "S", "steel-painted", profile, tread),
        supportPart(place(2, hi), spec, "S", "steel-painted", profile, tread),
      ];
      expect(parts[0]!.quantities["holes"]).toBe(parts[1]!.quantities["holes"]);
      expect(parts[0]!.fixings?.[0]?.distribution).toBe("even");
      expect(parts[1]!.fixings?.[0]?.distribution).toBe("betweenEdges");
      const marked = markGroups(parts, "CR", supportGroupKey, T, CR_OPTS);
      expect(marked.map((p) => p.mark)).toEqual(["CR1", "CR2"]);
      expect(countUniqueParts(parts, T)).toBe(2);
      // Même régime : un seul repère.
      const same = [
        supportPart(place(1, hi), spec, "S", "steel-painted", profile, tread),
        supportPart(place(2, hi + T / 4), spec, "S", "steel-painted", profile, tread),
      ];
      expect(
        new Set(markGroups(same, "CR", supportGroupKey, T, CR_OPTS).map((p) => p.mark)).size,
      ).toBe(1);
      expect(countUniqueParts(same, T)).toBe(1);
    },
  );
});

// ------------------------------------------------------------------ R2b : relecture

describe("entretoises EC débitées sur la plus petite, cote par cote (F10 Q3)", () => {
  const central = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(".blondel.json"))
    .map((f) => f.slice(0, -".blondel.json".length))
    .filter((n) =>
      readFileSync(join(EXAMPLES_DIR, `${n}.blondel.json`), "utf8").includes('"steel-central"'),
    );

  it.each(central)(
    "%s : développé débité jamais plus grand que la pièce réelle",
    (name) => {
      const p = example(name);
      expectFittedNotLarger(build(p), build(withTolerance(p, 0)), GEOM_EPS);
    },
    60_000,
  );

  it("des exemples portent des repères EC partagés (le test ne tourne pas à vide)", () => {
    let checked = 0;
    for (const name of ["cage-60-palier-central", "demo-cage-central-steel"]) {
      const p = example(name);
      checked += expectFittedNotLarger(build(p), build(withTolerance(p, 0)), GEOM_EPS);
    }
    expect(checked).toBeGreaterThan(2);
  }, 60_000);
});

describe("recopie du représentant faite une seule fois (F10 Q3, steel-curved)", () => {
  const spec: SupportSpec = {
    kind: "angle",
    fixing: "welded",
    angleLeg: 40,
    angleThickness: 4,
    plateWidth: 60,
    plateThickness: 8,
    bolts: 0,
    holeDiameter: 11,
    slotLength: 0,
    holeEdgeDistance: 30,
    treadScrews: 2,
  };
  const place = (tread: number, length: number): SupportPlacement => ({
    tread,
    treadMark: `M${tread}`,
    face: {
      key: "stringer-inner-1",
      owner: "stringer-inner-1",
      ownerMark: "LI1",
      kind: "stringer",
      side: "inner",
      a: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      into: { x: 0, y: 1 },
      uMin: 0,
      uMax: 5000,
    },
    u0: 1000 * tread,
    u1: 1000 * tread + length,
    zTop: 200 * tread,
  });
  const profile = resolveWorkshopProfile(undefined);
  const cr = (tread: number, length: number): Part =>
    supportPart(place(tread, length), spec, "S", "steel-painted", profile);

  it("markGroups n'est pas ré-entrant sur des pièces déjà recopiées (d'où `unifyMarks: false`)", () => {
    const a = cr(1, 100.4);
    const b = cr(2, 100.8);
    const c = cr(3, 100);
    const once = markGroups([a, b, c], "CR", supportGroupKey, 0.5, CR_OPTS);
    expect(once.map((p) => p.mark)).toEqual(["CR1", "CR2", "CR1"]);
    for (const p of once)
      expect(Math.abs(p.stock!.length - realLength(p))).toBeLessThanOrEqual(0.5 + GEOM_EPS);
    // Deux passages (a, b recopiés d'abord, puis c) : b, réelle 100,8, débitée à 100 (> T).
    const first = markGroups([a, b], "CR", supportGroupKey, 0.5, CR_OPTS);
    const twice = markGroups([...first, c], "CR", supportGroupKey, 0.5, CR_OPTS);
    expect(new Set(twice.map((p) => p.mark)).size).toBe(1);
    expect(twice[1]!.stock!.length).toBeCloseTo(100, 9);
    expect(realLength(twice[1]!)).toBeCloseTo(100.8, 9);
  });

  it.each(["demo-quarter-curved", "j5b-debillarde-soude"])(
    "%s à T = 12 : chaque barre débitée à au plus T de sa longueur réelle (recopie unique)",
    (name) => {
      const p = example(name);
      const t = 12;
      const m = build(withTolerance(p, t));
      const real = new Map(build(withTolerance(p, 0)).parts.map((x) => [x.id, x]));
      let shared = 0;
      for (const x of m.parts) {
        const r = real.get(x.id);
        if (!r?.stock || !x.stock || x.flat) continue;
        expect(Math.abs(x.stock.length - r.stock.length), x.id).toBeLessThanOrEqual(t + 1e-6);
        if (x.stock.length !== r.stock.length) shared++;
      }
      expect(shared).toBeGreaterThan(0);
    },
    60_000,
  );
});

// ------------------------------------------------------------------ R2c : décision (27)

describe("positions des perçages le long de la pièce dans la clé des supports (F10 (27))", () => {
  const spec: SupportSpec = {
    kind: "angle",
    fixing: "welded",
    angleLeg: 40,
    angleThickness: 4,
    plateWidth: 60,
    plateThickness: 8,
    bolts: 0,
    holeDiameter: 11,
    slotLength: 0,
    holeEdgeDistance: 30,
    treadScrews: 2,
  };
  /** Face le long de x (sens `dir`), support de `u0` à `u0 + length`. */
  const place = (
    tread: number,
    length: number,
    face: { a: { x: number; y: number }; dir: { x: number; y: number } } = {
      a: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
    },
    u0 = 1000 * tread,
  ): SupportPlacement => ({
    tread,
    treadMark: `M${tread}`,
    face: {
      key: "stringer-inner-1",
      owner: "stringer-inner-1",
      ownerMark: "LI1",
      kind: "stringer",
      side: "inner",
      a: face.a,
      dir: face.dir,
      into: { x: 0, y: 1 },
      uMin: -5000,
      uMax: 5000,
    },
    u0,
    u1: u0 + length,
    zTop: 200 * tread,
  });
  const profile = resolveWorkshopProfile(undefined);
  const T = profile.identicalPartTolerance;
  const positionsOf = (p: Part): number[] => drillingPositions(p);
  const marksOf = (parts: Part[], t = T): string[] =>
    markGroups(parts, "CR", supportGroupKey, t, CR_OPTS).map((p) => p.mark);

  it("positions par régime : centré, entre pinces, régulier ; boulons de la joue", () => {
    const L = 200;
    const e = spec.holeEdgeDistance;
    const one = supportPart(
      place(1, L),
      { ...spec, treadScrews: 1 },
      "S",
      "steel-painted",
      profile,
    );
    expect(positionsOf(one)).toEqual([L / 2]);
    const two = supportPart(place(1, L), spec, "S", "steel-painted", profile);
    expect(positionsOf(two)[0]).toBeCloseTo(e, 9);
    expect(positionsOf(two)[1]).toBeCloseTo(L - e, 9);
    const short = supportPart(place(1, 50), spec, "S", "steel-painted", profile);
    expect(positionsOf(short)[0]).toBeCloseTo(50 / 3, 9);
    expect(positionsOf(short)[1]).toBeCloseTo((2 * 50) / 3, 9);
    const bolted = supportPart(
      place(1, L),
      { ...spec, fixing: "bolted", bolts: 3, treadScrews: 0 },
      "S",
      "steel-painted",
      profile,
    );
    const b = bolted.fixings!.find((f) => f.joint === "supportBolted")!;
    expect(b.positions!.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([e, L / 2, L - e]);
  });

  it("marche en tôle : mêmes longueur et nombre de perçages, points percés différents ⇒ deux repères", () => {
    const a = supportPart(place(1, 200), spec, "S", "steel-painted", profile, "steel", [0]);
    const b = supportPart(place(2, 200), spec, "S", "steel-painted", profile, "steel", [1]);
    expect(supportGroupKey(a)).toBe(supportGroupKey(b));
    expect(marksOf([a, b])).toEqual(["CR1", "CR2"]);
    expect(countUniqueParts([a, b], T)).toBe(2);
    const c = supportPart(place(3, 200 + T / 2), spec, "S", "steel-painted", profile, "steel", [0]);
    expect(marksOf([a, c])).toEqual(["CR1", "CR1"]);
    expect(countUniqueParts([a, c], T)).toBe(1);
  });

  it("positions décalées à T près : un repère ; au-delà de T : deux", () => {
    const base = supportPart(place(1, 200), spec, "S", "steel-painted", profile);
    const shifted = (id: string, dx: number): Part => ({
      ...base,
      id,
      fixings: base.fixings!.map((f) => ({
        ...f,
        positions: f.positions!.map((x, i) => (i === 0 ? x + dx : x)),
      })),
    });
    expect(marksOf([base, shifted("near", 0.9 * T)])).toEqual(["CR1", "CR1"]);
    expect(countUniqueParts([base, shifted("near", 0.9 * T)], T)).toBe(1);
    expect(marksOf([base, shifted("far", 1.1 * T)])).toEqual(["CR1", "CR2"]);
    expect(countUniqueParts([base, shifted("far", 1.1 * T)], T)).toBe(2);
  });

  it("positions propres à la pièce : même cornière posée depuis l'autre bout de la face", () => {
    // A : face dans le sens +x ; B : même face parcourue dans le sens −x (origine en x = 200).
    // Le point percé d'indice 0 de A et celui d'indice 1 de B sont au même endroit du monde,
    // donc de la même pièce physique : mêmes positions, même repère.
    const a = supportPart(
      place(1, 200, undefined, 0),
      spec,
      "S",
      "steel-painted",
      profile,
      "steel",
      [0],
    );
    const b = supportPart(
      place(2, 200, { a: { x: 200, y: 0 }, dir: { x: -1, y: 0 } }, 0),
      spec,
      "S",
      "steel-painted",
      profile,
      "steel",
      [1],
    );
    expect(positionsOf(a)).toEqual(positionsOf(b));
    expect(marksOf([a, b])).toEqual(["CR1", "CR1"]);
  });

  it("recopie : les membres d'un repère portent les positions du représentant", () => {
    const a = supportPart(place(1, 200), spec, "S", "steel-painted", profile);
    const b = supportPart(place(2, 200.4), spec, "S", "steel-painted", profile);
    const [ma, mb] = markGroups([a, b], "CR", supportGroupKey, T, CR_OPTS);
    expect(ma!.mark).toBe(mb!.mark);
    expect(positionsOf(mb!)).toEqual(positionsOf(a));
    expect(mb!.fixings![0]!.joint).toBe(b.fixings![0]!.joint);
  });

  it("propriété : chaque membre à T (+ ε) de l'ancre sur la longueur et chaque position ; partition indépendante de l'ordre", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            length: fc.double({ min: 150, max: 154, noNaN: true }),
            drilled: fc.subarray([0, 1, 2], { minLength: 0 }),
          }),
          { minLength: 2, maxLength: 8 },
        ),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.integer({ min: 0, max: 1000 }),
        (rows, t, seed) => {
          const s3 = { ...spec, treadScrews: 3 };
          const parts = rows.map((r, i) =>
            supportPart(
              place(i + 1, r.length),
              s3,
              "S",
              "steel-painted",
              profile,
              "steel",
              r.drilled,
            ),
          );
          const real = new Map(parts.map((p) => [p.id, p]));
          const marked = markGroups(parts, "CR", supportGroupKey, t, CR_OPTS);
          const groups = new Map<string, Part[]>();
          for (const p of marked) groups.set(p.mark, [...(groups.get(p.mark) ?? []), p]);
          const lim = t + GEOM_EPS;
          for (const g of groups.values()) {
            const measures = g.map((p) => {
              const r = real.get(p.id)!;
              return [r.stock!.length, ...drillingPositions(r)];
            });
            const anchored = measures.some((a) =>
              measures.every(
                (m) => m.length === a.length && m.every((x, k) => Math.abs(x - a[k]!) <= lim),
              ),
            );
            expect(anchored).toBe(true);
            expect(new Set(g.map(supportGroupKey)).size).toBe(1);
          }
          const partition = (xs: Part[]): string[] => {
            const by = new Map<string, string[]>();
            for (const p of markGroups(xs, "CR", supportGroupKey, t, CR_OPTS))
              by.set(p.mark, [...(by.get(p.mark) ?? []), p.id]);
            return [...by.values()].map((ids) => ids.sort().join(",")).sort();
          };
          // Permutation déterministe tirée de `seed`.
          const shuffled = parts
            .map((p, i) => ({ p, k: (i * 7919 + seed * 104729) % 1009 }))
            .sort((x, y) => x.k - y.k)
            .map((x) => x.p);
          expect(partition(shuffled)).toEqual(partition(parts));
        },
      ),
      { numRuns: 200, seed: 27 },
    );
  });
});

// ------------------------------------------------------------------ R2c : décision (29)

describe("steel-curved : contrôles repris de steel-flat refaits après la recopie (F10 (29))", () => {
  const curved = [
    "demo-quarter-curved",
    "j5b-debillarde-soude",
    "cage-arc-palier-cintre",
    "demo-cage-arc-glass",
  ];

  /** Contrôles FAB_FORMAT_TOLE des platines et FAB_BARRE_LONGUEUR, sur les valeurs débitées. */
  const expectChecksOnCutValues = (m: Model): { sheets: number; bars: number } => {
    const byId = new Map(m.parts.map((p) => [p.id, p]));
    let sheets = 0;
    let bars = 0;
    for (const r of m.compliance.results) {
      if (r.ruleId === "FAB_FORMAT_TOLE" && r.location.kind === "part") {
        const p = byId.get(r.location.partId)!;
        if (!p.id.startsWith("plate-")) continue;
        expect(r.measured).toBeCloseTo(minAreaRect(p.flat!.outline.outer).length, 9);
        expect(r.message.params?.["mark"], p.id).toBe(p.mark);
        sheets++;
      }
      if (r.ruleId === "FAB_BARRE_LONGUEUR" && r.status === "ok" && r.measured !== undefined) {
        const item = r.message.params?.["item"] as Message | undefined;
        const mark = item?.params?.["text"];
        const members = m.parts.filter((p) => p.mark === mark);
        expect(members.length, `repère ${String(mark)}`).toBeGreaterThan(0);
        for (const p of members) expect(p.stock!.length).toBeCloseTo(r.measured, 9);
        // Barres de steel-flat (supports hors limon débillardé) : aucune plus longue.
        for (const p of m.parts) {
          if (p.category !== "support" || p.id.includes("curved") || !p.stock) continue;
          expect(p.stock.length).toBeLessThanOrEqual(r.measured + 1e-9);
        }
        bars++;
      }
      // Épaisseur laser : libellé d'un repère final, porté par une pièce de cette épaisseur.
      if (r.ruleId === "FAB_LASER_EPAISSEUR" && r.measured !== undefined) {
        // Limon de mur : constat enveloppé (`wallStringer.detail`).
        const base = (r.message.params?.["detail"] as Message | undefined) ?? r.message;
        const item = base.params?.["item"] as Message | undefined;
        const mark = item?.params?.["text"];
        const members = m.parts.filter((p) => p.mark === mark && p.flat);
        expect(members.length, `repère laser ${String(mark)}`).toBeGreaterThan(0);
        expect(members.map((p) => p.flat!.thickness)).toContain(r.measured);
      }
    }
    return { sheets, bars };
  };

  it.each(curved.flatMap((n) => [0.5, 12, 150].map((t) => [n, t] as const)))(
    "%s à T = %s : format de tôle des platines, longueur de barre et épaisseur laser lus sur les pièces finales",
    (name, t) => {
      const m = build(withTolerance(example(name), t));
      const n = expectChecksOnCutValues(m);
      if (name === "demo-quarter-curved" || name === "j5b-debillarde-soude") {
        expect(n.sheets).toBe(2);
        expect(n.bars).toBe(1);
      }
    },
    60_000,
  );

  it("demo-quarter-curved à T = 150 : la barre la plus défavorable est lue débitée, pas réelle", () => {
    // La recopie ne touche la barre la plus longue des exemples `steel-curved` qu'à partir de
    // T = 30 mm (`demo-quarter-curved`, `j5b-debillarde-soude`) : contrôle refait 405,5 mm (CR3)
    // contre 452,4 mm réels (CR2 du premier repérage) sans la décision (29).
    const p = example("demo-quarter-curved");
    const m = build(withTolerance(p, 150));
    const bar = m.compliance.results.find((r) => r.ruleId === "FAB_BARRE_LONGUEUR")!;
    const real = build(withTolerance(p, 0)).parts.filter(
      (x) => x.category === "support" && !x.id.includes("curved"),
    );
    const longest = Math.max(...real.map((x) => x.stock!.length));
    expect(bar.measured!).toBeLessThan(longest - 1);
    expectChecksOnCutValues(m);
  }, 60_000);

  it("refreshRemarkedChecks : constats remplacés à leur place, sur les pièces finales ; le reste tel quel", () => {
    const project = example("demo-quarter-curved");
    const m = build(project);
    const ctx: StructureContext = { project, layout: m.layout, stepping: m.stepping };
    const metal = resolveWorkshopProfile(project.workshop).metal;
    const rs = m.compliance.results;
    const find = (pred: (r: RuleResult) => boolean): RuleResult => rs.find(pred)!;
    const plateSheet = find(
      (r) =>
        r.ruleId === "FAB_FORMAT_TOLE" &&
        r.location.kind === "part" &&
        r.location.partId.startsWith("plate-"),
    );
    const plateId = (plateSheet.location as { partId: string }).partId;
    const stringer = m.parts.find((p) => p.category === "stringer" && p.flat)!;
    const bar = find((r) => r.ruleId === "FAB_BARRE_LONGUEUR");
    const laser = find((r) => r.ruleId === "FAB_LASER_EPAISSEUR");
    const other = find((r) => !/^FAB_(FORMAT_TOLE|BARRE_LONGUEUR|LASER_EPAISSEUR)$/.test(r.ruleId));
    // Pièce finale différente de celle du premier repérage : autre repère, autre développé.
    const plate = m.parts.find((p) => p.id === plateId)!;
    const grown: Part = {
      ...plate,
      mark: "PF7",
      flat: {
        ...plate.flat!,
        outline: {
          outer: plate.flat!.outline.outer.map((q) => ({ x: q.x * 1.5, y: q.y * 1.25 })),
          holes: [],
        },
      },
    };
    const supports = m.parts.filter((p) => p.category === "support" && p.stock).slice(0, 2);
    const stale = (r: RuleResult, measured: number): RuleResult => ({
      ...r,
      measured,
      message: msg("structure.steel.check.inSheetFormat", { mark: "PF9" }),
    });
    const stringerSheet: RuleResult = {
      ...stale(plateSheet, 1),
      location: { kind: "part", partId: stringer.id },
    };
    const input = [
      other,
      stale(plateSheet, 999),
      stringerSheet,
      stale(bar, 1),
      stale(bar, 2),
      stale(laser, 3),
      stale(laser, 4),
      other,
    ];
    const out = refreshRemarkedChecks(input, {
      ctx,
      plates: [grown],
      bars: supports,
      laser: [stringer, grown],
      metal,
    });
    // Ordre : autre, format (platine), format (limon), bloc barres, bloc laser, autre.
    expect(out[0]).toBe(other);
    expect(out.at(-1)).toBe(other);
    expect(out[1]!.ruleId).toBe("FAB_FORMAT_TOLE");
    expect(out[1]!.measured).toBeCloseTo(minAreaRect(grown.flat!.outline.outer).length, 9);
    expect(out[1]!.message.params?.["mark"]).toBe("PF7");
    expect(out[1]!.location).toEqual({ kind: "part", partId: plateId });
    expect(out[2]).toBe(stringerSheet);
    const ruleIds = out.slice(3, -1).map((r) => r.ruleId);
    const bars = out.slice(3, -1).filter((r) => r.ruleId === "FAB_BARRE_LONGUEUR");
    const lasers = out.slice(3, -1).filter((r) => r.ruleId === "FAB_LASER_EPAISSEUR");
    expect(ruleIds).toEqual([
      ...bars.map(() => "FAB_BARRE_LONGUEUR"),
      ...lasers.map(() => "FAB_LASER_EPAISSEUR"),
    ]);
    expect(bars.length).toBeGreaterThan(0);
    expect(lasers.length).toBeGreaterThan(0);
    const itemText = (r: RuleResult) =>
      (r.message.params?.["item"] as Message | undefined)?.params?.["text"];
    // Valeurs et libellés des pièces passées, aucun constat périmé.
    for (const r of bars) {
      expect(supports.map((p) => p.stock!.length)).toContain(r.measured);
      expect(supports.map((p) => p.mark)).toContain(itemText(r));
    }
    for (const r of lasers) {
      expect([stringer.flat!.thickness, grown.flat!.thickness]).toContain(r.measured);
      expect([stringer.mark, "PF7"]).toContain(itemText(r));
    }
    expect(out.filter((r) => r.message.params?.["mark"] === "PF9")).toEqual([stringerSheet]);
  });

  it("propriété : T ∈ [0 ; 160] sur les exemples steel-curved", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...curved),
        fc.double({ min: 0, max: 160, noNaN: true }),
        (name, t) => {
          expectChecksOnCutValues(build(withTolerance(example(name), t)));
        },
      ),
      { numRuns: 16, seed: 29 },
    );
  }, 300_000);
});
