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
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Model, Part } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import { countUniqueParts } from "./compare.js";
import { expectFittedNotLarger, expectMarksUnified } from "./marks.testing.js";
import { QUANTITY_BUTT_WELD_MM, QUANTITY_WELD_MM } from "./steelCommon.js";
import { markGroups } from "./steelFlat.js";
import {
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
    const same = markGroups([drilled(cr1[0]!, 7), drilled(cr1[1]!, 7)], "CR", supportGroupKey, 0.5);
    expect(new Set(same.map((p) => p.mark)).size).toBe(1);
    const diff = markGroups([drilled(cr1[0]!, 7), drilled(cr1[1]!, 9)], "CR", supportGroupKey, 0.5);
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
            // Représentant : la plus courte.
            for (const x of g) expect(x.stock!.length).toBeCloseTo(Math.min(...ls), 9);
          }
          expectMarksUnified(m);
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
  it.each(ALL_EXAMPLES)("%s : pièces d'un même repère aux mêmes cotes de débit", (name) => {
    expectMarksUnified(build(example(name)));
  });

  it("préréglage helical : pièces d'un même repère aux mêmes cotes de débit", () => {
    expectMarksUnified(build(createProject("helical")));
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
      const marked = markGroups(parts, "CR", supportGroupKey, T);
      expect(marked.map((p) => p.mark)).toEqual(["CR1", "CR2"]);
      expect(countUniqueParts(parts, T)).toBe(2);
      // Même régime : un seul repère.
      const same = [
        supportPart(place(1, hi), spec, "S", "steel-painted", profile, tread),
        supportPart(place(2, hi + T / 4), spec, "S", "steel-painted", profile, tread),
      ];
      expect(new Set(markGroups(same, "CR", supportGroupKey, T).map((p) => p.mark)).size).toBe(1);
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
    const once = markGroups([a, b, c], "CR", supportGroupKey, 0.5);
    expect(once.map((p) => p.mark)).toEqual(["CR1", "CR2", "CR1"]);
    for (const p of once)
      expect(Math.abs(p.stock!.length - realLength(p))).toBeLessThanOrEqual(0.5 + GEOM_EPS);
    // Deux passages (a, b recopiés d'abord, puis c) : b, réelle 100,8, débitée à 100 (> T).
    const first = markGroups([a, b], "CR", supportGroupKey, 0.5);
    const twice = markGroups([...first, c], "CR", supportGroupKey, 0.5);
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
