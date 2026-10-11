/**
 * Couches empilées du limon central bois, décisions A38 du 2026-10-11 (`woodCentralLayers.ts`) :
 * - (3) bande tendue du décalage des aboutages selon ANSI A190.1-2017 § 10.4 (a) (C §1.11 [85]) :
 *   part de hauteur `section.tensionZone` (1/8) depuis la sous-face, plus
 *   `section.tensionZoneLayers` couches (1), sur la part centrale `section.tensionZoneLength`
 *   (75 %) de la longueur ; `bandTopAt` ; constat `FAB_LIMON_CENTRAL_BOIS_ABOUTAGES` seulement
 *   pour des joints de la bande ; N = 0 et part centrale 1 redonnent la zone d'avant A38 ;
 * - (4) et (9) longueur minimale `auto` des planches = 2 × enture + marge
 *   (`resolveMinBoardLength`), valeur saisie respectée, pente de fil prioritaire, constat
 *   `FAB_LIMON_CENTRAL_BOIS_PLANCHES_COURTES` seulement sous ce minimum.
 * Propriétés sur générateurs contraints (rayon et longueur de l'arc, largeur, décalage, enture,
 * couches en plus 0 à 3, part centrale 0,3 à 1, haut de bande variable).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import type { StructureContext } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import { createProject } from "../project/presets.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";
import {
  bandTopAt,
  buildStackedLayers,
  layerBounds,
  resolveLayerThickness,
  WOOD_CENTRAL_LAYER_RULES,
  type LayerBound,
  type StackedBeamShape,
  type StackedLayersResult,
} from "./woodCentralLayers.js";
import { resolveMinBoardLength, type WoodCentralParams } from "./woodCentralParams.js";

const PROFILE = resolveWorkshopProfile();
const BEAM_ID = "wood-central-beam";
const RULE = WOOD_CENTRAL_LAYER_RULES.fingerJoints.id;
const SHORT_RULE = WOOD_CENTRAL_LAYER_RULES.shortBoards.id;

/** Trace en arc de rayon R, longueur L (tournant à gauche). */
function arcTrace(R: Mm, L: Mm): CentralTrace {
  const th = (s: Mm) => s / R;
  return {
    kind: "turning",
    curve: { segments: [] } as unknown as CentralTrace["curve"],
    length: L,
    point: (s) => V.vec(R * Math.sin(th(s)), R * (1 - Math.cos(th(s)))),
    tangent: (s) => V.vec(Math.cos(th(s)), Math.sin(th(s))),
    left: (s) => V.vec(-Math.sin(th(s)), Math.cos(th(s))),
    nosingSigma: [],
    nosingZ: () => 0,
    slope: 0,
    naissances: [],
    arcs: [{ radius: R, sigma0: -1e9, sigma1: 1e9, turnsLeft: true }],
    notes: [],
  };
}

const CTX = (() => {
  let ctx: StructureContext | null = null;
  return (): StructureContext => (ctx ??= woodCentralContext(createProject("quarter-left")));
})();

/** Couches d'une forme simple (dessous plat sauf mention, dessus constant) sur un arc. */
function run(
  trace: CentralTrace,
  shape: Partial<StackedBeamShape>,
  section: Record<string, unknown>,
): { r: StackedLayersResult; checks: CheckCollector; params: WoodCentralParams } {
  const ctx = CTX();
  const params = woodCentralParams({ section });
  const checks = new CheckCollector(ctx.project, ctx.stepping);
  const r = buildStackedLayers({
    params,
    trace,
    profile: PROFILE,
    checks,
    beam: {
      beamId: BEAM_ID,
      beamMark: "LC1",
      b: 80,
      sStart: 0,
      sEnd: trace.length,
      bottomAt: () => 0,
      topAt: () => 120,
      nodes: [],
      baseZ: 0,
      ...shape,
    },
  });
  return { r, checks, params };
}

/** Coupes intérieures (plans de joint) d'une couche. */
const innerCuts = (l: StackedLayersResult["layers"][number]): Mm[] =>
  [...new Set(l.boards!.map((bd) => bd.sigma0))].filter((x) => x > l.sigma0);

/** Constat d'une règle sur une pièce. */
const findingOf = (checks: CheckCollector, rule: string, partId: string) =>
  checks.results.filter(
    (x) => x.ruleId === rule && x.location.kind === "part" && x.location.partId === partId,
  );

/**
 * Oracle indépendant du haut de bande (A38 (3)) : dessus de la couche de rang j + N, j la couche
 * qui contient bt, relevé à bt ; bt sous la première couche : ses N premières couches.
 */
function oracleTop(bounds: readonly LayerBound[], bt: Mm, n: number): Mm {
  let j = -1;
  bounds.forEach((x, i) => {
    if (x.z0 <= bt) j = i;
  });
  if (j + n < 0) return bt;
  return Math.max(bt, bounds[Math.min(j + n, bounds.length - 1)]!.z1);
}

describe("bandTopAt (A38 (3))", () => {
  const bounds: LayerBound[] = [
    { z0: 0, z1: 40 },
    { z0: 40, z1: 80 },
    { z0: 80, z1: 120 },
  ];
  it("couche qui contient le haut de bande, plus N couches au-dessus", () => {
    expect(bandTopAt(bounds, 30, 0)).toBe(40);
    expect(bandTopAt(bounds, 30, 1)).toBe(80);
    expect(bandTopAt(bounds, 30, 2)).toBe(120);
    expect(bandTopAt(bounds, 30, 5)).toBe(120);
    // Haut de bande sur un joint : la couche du dessus le contient.
    expect(bandTopAt(bounds, 40, 0)).toBe(80);
  });
  it("haut de bande sous la première couche ou au-dessus de tout ; valeurs non finies", () => {
    expect(bandTopAt(bounds, -10, 0)).toBe(-10);
    expect(bandTopAt(bounds, -10, 1)).toBe(40);
    expect(bandTopAt(bounds, 500, 1)).toBe(500);
    expect(bandTopAt(bounds, Infinity, 0)).toBe(Infinity);
    expect(Number.isNaN(bandTopAt(bounds, NaN, 1))).toBe(true);
    expect(bandTopAt([], 30, 1)).toBe(30);
  });
  it("N = 0 : z0 < haut ⇔ z0 < bt, sauf égalité z0 = bt (zone d'avant A38)", () => {
    fc.assert(
      fc.property(fc.double({ min: -20, max: 140, noNaN: true }), (bt) => {
        const top = bandTopAt(bounds, bt, 0);
        for (const x of bounds) {
          if (Math.abs(x.z0 - bt) < 1e-5) continue;
          expect(x.z0 < top - 1e-6).toBe(x.z0 < bt - 1e-6);
        }
      }),
    );
  });
});

describe("bande tendue selon [85] (A38 (3)) : forme simple", () => {
  /** Arc de 1 500 mm, planches ≈ 250 mm, décalage intenable de 400 mm. */
  const arc = arcTrace(3000, 1500);
  const section = {
    layerThickness: 40,
    dressingAllowance: 5,
    maxGrainSlope: 5,
    jointOffset: 400,
    fingerLength: 15,
    minBoardLength: 0,
  };

  it("défauts : 1/8, une couche en plus, 75 % centraux", () => {
    const p = woodCentralParams();
    expect(p.section.tensionZone).toBe(0.125);
    expect(p.section.tensionZoneLayers).toBe(1);
    expect(p.section.tensionZoneLength).toBe(0.75);
  });

  it("joint juste dans ou juste hors de la bande, en hauteur", () => {
    // Haut de bande à 30 (dans la couche 1 [0 ; 40]) plus une couche : couches 1 et 2 dans la
    // bande, couche 3 [80 ; 120] hors de la bande. Part centrale 1 : seule la hauteur joue.
    const { r, checks } = run(
      arc,
      { tensionZoneTop: () => 30 },
      { ...section, tensionZoneLength: 1 },
    );
    expect(r.layers.map((l) => [l.z0, l.z1])).toEqual([
      [0, 40],
      [40, 80],
      [80, 120],
    ]);
    const [f2] = findingOf(checks, RULE, r.layers[1]!.partId);
    expect(f2!.status).toBe("violation");
    expect(f2!.message.key).toBe("structure.woodCentral.check.layerJoint");
    const [f3] = findingOf(checks, RULE, r.layers[2]!.partId);
    expect(f3!.status).toBe("ok");
    expect(f3!.message.key).toBe("structure.woodCentral.check.layerJointsOutsideBand");
    // Couche 3 libre : partage égal gardé.
    const bare = run(arc, {}, { ...section, jointOffset: 0 }).r;
    expect(innerCuts(r.layers[2]!)).toEqual(innerCuts(bare.layers[2]!));
    // Haut de bande juste sous le joint 40 : la couche 2 n'est plus que la « couche en plus » ;
    // avec N = 0, elle sort de la bande.
    const n0 = run(
      arc,
      { tensionZoneTop: () => 40 - 1e-3 },
      { ...section, tensionZoneLength: 1, tensionZoneLayers: 0 },
    );
    const [g2] = findingOf(n0.checks, RULE, n0.r.layers[1]!.partId);
    expect(g2!.message.key).toBe("structure.woodCentral.check.layerJointsOutsideBand");
    // Juste au-dessus du joint : la couche 2 contient le haut de bande, elle est dans la bande.
    const n1 = run(
      arc,
      { tensionZoneTop: () => 40 + 1e-3 },
      { ...section, tensionZoneLength: 1, tensionZoneLayers: 0 },
    );
    const [h2] = findingOf(n1.checks, RULE, n1.r.layers[1]!.partId);
    expect(h2!.status).toBe("violation");
  });

  it("joint juste dans ou juste hors de la part centrale, en longueur", () => {
    // Toute la hauteur dans la bande ; 75 % centraux de [0 ; 1 500] = [187,5 ; 1 312,5].
    const { r, checks } = run(arc, { tensionZoneTop: () => 1e9 }, section);
    const lo = 187.5;
    const hi = 1312.5;
    for (let i = 1; i < r.layers.length; i++) {
      const l = r.layers[i]!;
      const below = innerCuts(r.layers[i - 1]!);
      const cuts = innerCuts(l);
      const band = cuts.filter((x) => x >= lo - 1e-6 && x <= hi + 1e-6);
      const [f] = findingOf(checks, RULE, l.partId);
      let gap = Infinity;
      for (const c of band) for (const d of below) gap = Math.min(gap, Math.abs(c - d));
      expect(f!.measured).toBeCloseTo(gap - 15, 6);
    }
    // Couche 2 : ses coupes de bout (125 et 1 375 en partage égal, sous le décalage des joints du
    // dessous) sont repoussées juste hors de la part centrale, où elles sont libres.
    const cuts2 = innerCuts(r.layers[1]!);
    expect(cuts2[0]).toBeLessThan(lo);
    expect(cuts2[0]).toBeGreaterThan(lo - 0.01);
    expect(cuts2[cuts2.length - 1]).toBeGreaterThan(hi);
    expect(cuts2[cuts2.length - 1]).toBeLessThan(hi + 0.01);
    // Toute la longueur : les coupes de bout restent en partage égal (125, 1 375), en violation.
    const whole = run(arc, { tensionZoneTop: () => 1e9 }, { ...section, tensionZoneLength: 1 });
    expect(innerCuts(whole.r.layers[1]!)[0]).toBeCloseTo(125, 6);
  });

  it("N = 0, part centrale 1, part 0,5 : coupes et constats d'avant A38 (sens migré)", () => {
    // Valeurs relevées le 2026-10-11 avec le code A37 (zone z0 < sous-face + 0,5 · h, toute la
    // longueur, minBoardLength 150) : dessous incliné, haut de zone traversant les couches.
    const { r, checks } = run(
      arc,
      {
        bottomAt: (s) => 0.02 * s,
        topAt: () => 160,
        tensionZoneTop: (s) => 0.02 * s + 0.5 * (160 - 0.02 * s),
      },
      {
        ...section,
        jointOffset: 152,
        minBoardLength: 150,
        tensionZone: 0.5,
        tensionZoneLayers: 0,
        tensionZoneLength: 1,
      },
    );
    const cuts = r.layers.map((l) => innerCuts(l));
    const expected = [
      [250, 500, 750, 1000, 1250],
      [150.191406, 400.191406, 642.857143, 857.142857, 1099.808594, 1349.808594],
      [256.968109, 506.968109, 750, 993.031891, 1243.031891],
      [250, 500, 750, 1000, 1250],
    ];
    expect(cuts).toHaveLength(expected.length);
    cuts.forEach((row, i) => {
      expect(row).toHaveLength(expected[i]!.length);
      row.forEach((x, j) => expect(x).toBeCloseTo(expected[i]![j]!, 5));
    });
    const joints = r.layers.map((l) => findingOf(checks, RULE, l.partId)[0]!);
    expect(joints.map((f) => f.status)).toEqual(["ok", "violation", "violation", "ok"]);
    expect(joints[1]!.measured).toBeCloseTo(84.808594, 5);
    expect(joints[2]!.measured).toBeCloseTo(91.776703, 5);
    expect(joints[0]!.message.key).toBe("structure.woodCentral.check.layerJointFree");
    // Clé nouvelle (A38), même sens que `layerJointsOutsideTension` d'avant.
    expect(joints[3]!.message.key).toBe("structure.woodCentral.check.layerJointsOutsideBand");
    const shorts = r.layers.map((l) => findingOf(checks, SHORT_RULE, l.partId)[0]!);
    expect(shorts.map((f) => f.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(shorts.map((f) => f.measured)).toEqual([
      expect.closeTo(250, 5),
      expect.closeTo(150.191406, 5),
      expect.closeTo(243.031891, 5),
      expect.closeTo(250, 5),
    ]);
  });

  it("remarque de synthèse : bande rappelée (part, couches en plus, part centrale)", () => {
    const { r } = run(arc, { tensionZoneTop: () => 30 }, section);
    const note = r.notes.find((n) => n.key === "structure.woodCentral.note.layerFingerJointsBand");
    expect(note).toBeDefined();
    expect(note!.params).toMatchObject({
      zone: { num: 12.5 },
      layers: 1,
      length: { num: 75 },
    });
  });
});

describe("bande tendue selon [85] (A38 (3)) : propriété", () => {
  it("aucune violation hors de la bande ; tout joint de la bande sous le décalage est signalé", () => {
    fc.assert(
      fc.property(
        fc.record({
          R: fc.integer({ min: 600, max: 5000 }),
          L: fc.integer({ min: 900, max: 2400 }),
          b: fc.integer({ min: 60, max: 160 }),
          slope: fc.double({ min: 0, max: 0.25, noNaN: true }),
          t: fc.integer({ min: 25, max: 60 }),
          offset: fc.integer({ min: 0, max: 300 }),
          finger: fc.integer({ min: 0, max: 40 }),
          layers: fc.integer({ min: 0, max: 3 }),
          length: fc.double({ min: 0.3, max: 1, noNaN: true }),
          part: fc.double({ min: 0.02, max: 1, noNaN: true }),
        }),
        (c) => {
          const H = 180;
          const bottomAt = (s: Mm): Mm => Math.min(c.slope * s, H - 40);
          const top = (s: Mm): Mm => bottomAt(s) + c.part * (H - bottomAt(s));
          const { r, checks, params } = run(
            arcTrace(c.R, c.L),
            { b: c.b, bottomAt, topAt: () => H, tensionZoneTop: top },
            {
              width: c.b,
              layerThickness: c.t,
              dressingAllowance: 5,
              jointOffset: c.offset,
              fingerLength: c.finger,
              minBoardLength: 0,
              tensionZoneLayers: c.layers,
              tensionZoneLength: c.length,
            },
          );
          expect(r.errors).toEqual([]);
          const { bounds } = layerBounds(0, H, resolveLayerThickness(params, PROFILE));
          const margin = ((1 - c.length) * c.L) / 2;
          const inBand = (z0: Mm, x: Mm): boolean =>
            x >= margin - 1e-6 &&
            x <= c.L - margin + 1e-6 &&
            z0 < oracleTop(bounds, top(x), c.layers) - 1e-6;
          for (let i = 0; i < r.layers.length; i++) {
            const l = r.layers[i]!;
            if (l.boards!.length < 2) continue;
            const prev = r.layers[i - 1];
            const below =
              prev && Math.abs(prev.z1 - l.z0) < 1e-6 && prev.boards ? innerCuts(prev) : [];
            const cuts = innerCuts(l);
            const band = cuts.filter((x) => inBand(l.z0, x));
            const [f] = findingOf(checks, RULE, l.partId);
            expect(f).toBeDefined();
            if (cuts.length === 0 || below.length === 0) {
              expect(f!.message.key).toBe("structure.woodCentral.check.layerJointFree");
              continue;
            }
            if (band.length === 0) {
              // Joints hors de la bande : jamais de violation.
              expect(f!.status).toBe("ok");
              expect(f!.message.key).toBe("structure.woodCentral.check.layerJointsOutsideBand");
              continue;
            }
            let gap = Infinity;
            for (const x of band) for (const d of below) gap = Math.min(gap, Math.abs(x - d));
            expect(f!.measured).toBeCloseTo(gap - c.finger, 6);
            const held = !(c.offset > 0) || gap - c.finger >= c.offset - 1e-6;
            expect(f!.status).toBe(held ? "ok" : "violation");
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("longueur minimale des planches `auto` (A38 (4) (9))", () => {
  const arc = arcTrace(3000, 1500);
  const base = { layerThickness: 40, dressingAllowance: 5, maxGrainSlope: 5, fingerLength: 15 };
  const shortest = (l: StackedLayersResult["layers"][number]): Mm =>
    Math.min(...l.boards!.map((bd) => bd.sigma1 - bd.sigma0));

  it("défaut `auto` = 2 × 15 + 50 = 80 mm ; propriété sur l'enture et la marge", () => {
    expect(resolveMinBoardLength(woodCentralParams())).toBe(80);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 200 }),
        (finger, margin) => {
          const p = woodCentralParams({
            section: { fingerLength: finger, boardLengthMargin: margin },
          });
          expect(p.section.minBoardLength).toBe("auto");
          expect(resolveMinBoardLength(p)).toBe(2 * finger + margin);
          // Valeur saisie respectée, 0 compris.
          const entered = woodCentralParams({
            section: { fingerLength: finger, boardLengthMargin: margin, minBoardLength: 123 },
          });
          expect(resolveMinBoardLength(entered)).toBe(123);
          expect(resolveMinBoardLength(woodCentralParams({ section: { minBoardLength: 0 } }))).toBe(
            0,
          );
        },
      ),
    );
  });

  it("constat : `min` = longueur résolue, aucune planche courte quand toutes la tiennent", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 160 }),
        fc.integer({ min: 0, max: 200 }),
        (finger, margin, offset) => {
          const { r, checks, params } = run(
            arc,
            {},
            { ...base, fingerLength: finger, boardLengthMargin: margin, jointOffset: offset },
          );
          const min = resolveMinBoardLength(params);
          const composed = r.layers.filter((l) => l.boards!.length > 1);
          expect(composed.length).toBeGreaterThan(0);
          for (const l of composed) {
            const [f] = findingOf(checks, SHORT_RULE, l.partId);
            expect(f!.min).toBe(min);
            const m = shortest(l);
            expect(f!.measured).toBeCloseTo(m, 9);
            expect(f!.status).toBe(m < min - 1e-6 ? "violation" : "ok");
            // Partage égal ≈ 250 mm ≥ minimum : tenable, aucune planche courte.
            if (min <= 200) expect(f!.status).toBe("ok");
          }
        },
      ),
      { numRuns: 12 },
    );
  });

  it("valeur saisie respectée (constat comparé à la saisie, pas à `auto`)", () => {
    const { r, checks } = run(arc, {}, { ...base, jointOffset: 0, minBoardLength: 260 });
    const composed = r.layers.filter((l) => l.boards!.length > 1);
    expect(composed.length).toBeGreaterThan(0);
    for (const l of composed) {
      const [f] = findingOf(checks, SHORT_RULE, l.partId);
      expect(f!.min).toBe(260);
      expect(f!.status).toBe("violation");
    }
  });

  it("pente de fil prioritaire : `auto` intenable (marge forte), partage gardé, constat", () => {
    const { r, checks, params } = run(arc, {}, { ...base, jointOffset: 0, boardLengthMargin: 400 });
    expect(resolveMinBoardLength(params)).toBe(430);
    const composed = r.layers.filter((l) => l.boards!.length > 1);
    expect(composed.length).toBeGreaterThan(0);
    const beta = Math.atan(5 / 100);
    for (const l of composed) {
      const [f] = findingOf(checks, SHORT_RULE, l.partId);
      expect(f!.status).toBe("violation");
      expect(f!.min).toBe(430);
      expect(f!.message.key).toBe("structure.woodCentral.check.layerBoardShort");
      for (const bd of l.boards!) expect(bd.grainDeviation).toBeLessThanOrEqual(beta + 1e-9);
    }
  });
});
