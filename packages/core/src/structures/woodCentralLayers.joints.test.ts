/**
 * Couches empilées du limon central bois, décisions A36 du 2026-10-09 (`woodCentralLayers.ts`) :
 * (12) joints de colle hors des perçages horizontaux, broches de pied au milieu de leur couche
 * (`layerBounds` avec perçages ; constat `FAB_LIMON_CENTRAL_BOIS_JOINT_PERCAGE` pour un perçage
 * non tenu) ; (6) aboutages à entures décalés d'une couche à l'autre, gabarit et débit prolongés
 * d'une demi-enture, constat `FAB_LIMON_CENTRAL_BOIS_ABOUTAGES` par couche composée ;
 * (9) couche composée pièce intermédiaire (planches composantes de la couche, aucun double
 * compte) ; (5) contour des logements d'âme sur les gabarits des couches. Propriétés sur
 * générateurs contraints (quart tournant, U, hélicoïdal ; largeur 70 à 240 mm ; broches Ø10 à
 * Ø16 ; épaisseur de marche ; épaisseur maximale des couches).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import type { StructureContext } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import type { Mm } from "../model/primitives.js";
import { fabricatedParts, rootAssemblyId } from "../parts/components.js";
import { createProject } from "../project/presets.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { QUANTITY_VOLUME_M3 } from "./quantities.js";
import {
  woodBeamOf,
  woodCentralContext,
  woodCentralParams,
  woodTraceOf,
} from "./woodCentral.test-helpers.js";
import {
  buildStackedLayers,
  layerBounds,
  resolveLayerThickness,
  WOOD_CENTRAL_LAYER_RULES,
  type HoleLevel,
  type StackedBeamShape,
  type StackedLayersResult,
} from "./woodCentralLayers.js";
import type { WoodCentralParams } from "./woodCentralParams.js";
import type { BeamKerf } from "./woodCentralPlates.js";
import type { ShoeBeamHole } from "./woodCentralShoes.js";

const PROFILE = resolveWorkshopProfile();
const CLEARANCE = PROFILE.wood.clearance;
const BEAM_ID = "wood-central-beam";
const RULE = WOOD_CENTRAL_LAYER_RULES.fingerJoints.id;
const HOLE_RULE = WOOD_CENTRAL_LAYER_RULES.holeJoints.id;
const PRESETS = ["quarter-left", "two-quarters-u", "helical"] as const;
type PresetId = (typeof PRESETS)[number];

/** Niveaux (bornes) des tranches, triés. */
const levelsOf = (bounds: readonly { z0: Mm; z1: Mm }[]): Mm[] => [
  ...new Set(bounds.flatMap((x) => [x.z0, x.z1])),
];

describe("layerBounds avec perçages (A36 (12))", () => {
  it("sans perçage : partage égal inchangé, pas de champ `issues`", () => {
    const plain = layerBounds(0, 500, 75, [180, 360]);
    expect(plain.issues).toBeUndefined();
    expect(layerBounds(0, 500, 75, [180, 360], 1000, [])).toEqual(plain);
  });

  it("broche de pied centrée : premier intervalle partagé, plus mince couche la plus épaisse", () => {
    // Base 8, assise 140, broche Ø12 à 56 (a4,t = 48 au-dessus de la platine), jeu 1 : r = 7.
    const pin: HoleLevel = { z: 56, r: 7, centered: true, mark: "AP1" };
    const { bounds, issues } = layerBounds(8, 140, 75, [140], 1000, [pin]);
    expect(issues).toEqual([]);
    // Couche centrée e, dessous 48 − e/2, dessus 84 − e/2 ≤ 75 : e = 32 rend la plus mince
    // couche la plus épaisse (32 / 32 / 68), au lieu de 66 / 66 (joint à 74, broche décentrée).
    expect(bounds.map((x) => [x.z0, x.z1])).toEqual([
      [8, expect.closeTo(40, 2)],
      [expect.closeTo(40, 2), expect.closeTo(72, 2)],
      [expect.closeTo(72, 2), 140],
    ]);
    expect((bounds[1]!.z0 + bounds[1]!.z1) / 2).toBeCloseTo(56, 6);
  });

  it("perçage non centré traversé par un joint égal : joints écartés, plus mince couche maximale", () => {
    const hole: HoleLevel = { z: 120, r: 7, centered: false, mark: "SP1" };
    const { bounds, issues } = layerBounds(0, 180, 75, [180], 1000, [hole]);
    expect(issues).toEqual([]);
    expect(bounds).toHaveLength(3);
    for (const z of levelsOf(bounds)) expect(Math.abs(z - 120)).toBeGreaterThanOrEqual(7 - 1e-6);
    // Joint haut à 113 (couches j, 113 − j, 67) : la plus mince fait 56,5.
    const thinnest = Math.min(...bounds.map((x) => x.z1 - x.z0));
    expect(thinnest).toBeCloseTo(56.5, 2);
    for (const x of bounds) expect(x.z1 - x.z0).toBeLessThanOrEqual(75 + 1e-9);
  });

  it("partage égal déjà conforme : inchangé", () => {
    const hole: HoleLevel = { z: 90, r: 7, centered: false };
    expect(layerBounds(0, 180, 75, [180], 1000, [hole]).bounds).toEqual(
      layerBounds(0, 180, 75, [180]).bounds,
    );
  });

  it("perçage à cheval sur une assise : remarque, jamais d'exception", () => {
    const hole: HoleLevel = { z: 182, r: 7, centered: false, mark: "SP1" };
    const { bounds, issues } = layerBounds(0, 360, 75, [180, 360], 1000, [hole]);
    expect(bounds.length).toBeGreaterThan(0);
    expect(issues).toEqual([{ kind: "joint", mark: "SP1", z: 182, distance: 2, min: 7 }]);
  });

  it("broche trop près de la base pour être centrée : remarque `offCenter`", () => {
    const pin: HoleLevel = { z: 4, r: 7, centered: true, mark: "AP1" };
    const { issues } = layerBounds(0, 180, 75, [180], 1000, [pin]);
    expect(issues!.map((i) => i.kind)).toContain("offCenter");
  });

  it("deux broches de pied à des niveaux différents dans le même intervalle", () => {
    const pins: HoleLevel[] = [
      { z: 50, r: 7, centered: true, mark: "AP1" },
      { z: 130, r: 7, centered: true, mark: "AP1" },
    ];
    const { bounds, issues } = layerBounds(0, 180, 75, [180], 1000, pins);
    expect(issues).toEqual([]);
    for (const p of pins) {
      expect(bounds.some((x) => Math.abs((x.z0 + x.z1) / 2 - p.z) < 1e-6)).toBe(true);
    }
    for (const x of bounds) expect(x.z1 - x.z0).toBeLessThanOrEqual(75 + 1e-9);
  });
});

// ------------------------------------------------------------------ formes réalistes

const contexts = new Map<string, StructureContext>();
function contextFor(id: PresetId, thickness: number): StructureContext {
  const key = `${id}/${thickness}`;
  let ctx = contexts.get(key);
  if (!ctx) {
    const p = createProject(id);
    const project: Project = {
      ...p,
      stair: { ...p.stair, treads: { ...p.stair.treads, thickness } },
    };
    ctx = woodCentralContext(project);
    contexts.set(key, ctx);
  }
  return ctx;
}

/**
 * Forme **synthétique** tirée d'une trace réelle (assises sous les nez à l'épaisseur de marche,
 * sous-face parallèle, platine de `tp` au pied) avec les perçages et le logement d'une platine à
 * âme noyée : 2 broches de pied à a4,t = 4·d au-dessus de la platine (repère AP1), 2 broches de
 * tête (AT1, placées par le test hors du voisinage des assises) et un logement de pied en
 * escalier (comme `woodCentralPlates.ts`). Les perçages réels de la platine sont couverts sur la
 * poutre réelle (`woodBeamOf`, plus bas), où une broche de tête peut tomber sur une assise.
 */
function plateShape(
  trace: CentralTrace,
  b: Mm,
  tread: Mm,
  pin: Mm,
  tp: Mm,
): { shape: StackedBeamShape; holes: ShoeBeamHole[]; kerfs: BeamKerf[] } {
  const ns = trace.nosingSigma;
  const sStart = ns[0]! - 30;
  const sEnd = ns[ns.length - 1]!;
  const seatAt = (k: number): Mm => trace.nosingZ(ns[k]!) - tread;
  const topAt = (s: Mm): Mm => {
    for (let k = 1; k < ns.length; k++) if (s < ns[k]!) return seatAt(k);
    return seatAt(ns.length - 1);
  };
  const seats = ns.slice(1).map((_, k) => seatAt(k + 1));
  const zTop = seats[seats.length - 1]!;
  const footZ = tp + 4 * pin;
  const holes: ShoeBeamHole[] = [
    { mark: "AP1", sigma: ns[1]! + 40, z: footZ, diameter: pin },
    { mark: "AP1", sigma: ns[2]! + 40, z: footZ, diameter: pin },
    { mark: "AT1", sigma: sEnd - 100, z: zTop - 215, diameter: pin },
    { mark: "AT1", sigma: sEnd - 100, z: zTop - 115, diameter: pin },
  ];
  const k0 = sStart;
  const kMid = ns[2]!;
  const k1 = ns[2]! + 120;
  const low = Math.min(seatAt(1), footZ + 3 * pin);
  const high = Math.min(seatAt(2) - 10, footZ + 6 * pin);
  const kerfs: BeamKerf[] = [
    {
      mark: "AP1",
      sigma0: k0,
      sigma1: k1,
      z0: tp,
      z1: high,
      width: 8,
      outline: [
        V.vec(k0, tp),
        V.vec(k1, tp),
        V.vec(k1, high),
        V.vec(kMid, high),
        V.vec(kMid, low),
        V.vec(k0, low),
      ],
    },
  ];
  return {
    shape: {
      beamId: BEAM_ID,
      beamMark: "LC1",
      b,
      sStart,
      sEnd,
      bottomAt: (s) => Math.max(tp, trace.nosingZ(s) - 320),
      topAt,
      nodes: [...ns],
      baseZ: tp,
      seatLevels: seats,
      holes,
      kerfs,
    },
    holes,
    kerfs,
  };
}

function runShape(
  ctx: StructureContext,
  params: WoodCentralParams,
  shape: StackedBeamShape,
): { r: StackedLayersResult; checks: CheckCollector } {
  const trace = woodTraceOf(ctx, params);
  const checks = new CheckCollector(ctx.project, ctx.stepping);
  const r = buildStackedLayers({ params, trace, profile: PROFILE, checks, beam: shape });
  return { r, checks };
}

const caseArb = fc.record({
  id: fc.constantFrom(...PRESETS),
  tread: fc.integer({ min: 30, max: 80 }),
  b: fc.integer({ min: 70, max: 240 }),
  pin: fc.integer({ min: 10, max: 16 }),
  t: fc.option(fc.integer({ min: 30, max: 80 }), { nil: undefined }),
});

describe("couches empilées sur formes réalistes : propriétés (A36 (12), (6), (9))", () => {
  it("forme synthétique : aucun joint de colle ne coupe ni ne touche un perçage ; broches de pied au milieu de leur couche", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ctx = contextFor(c.id, c.tread);
        const params = woodCentralParams({
          section: { width: c.b, ...(c.t !== undefined ? { layerThickness: c.t } : {}) },
        });
        const trace = woodTraceOf(ctx, params);
        const { shape, holes } = plateShape(trace, c.b, c.tread, c.pin, 8);
        const { r, checks } = runShape(ctx, params, shape);
        expect(r.errors).toEqual([]);
        const tMax = resolveLayerThickness(params, PROFILE);
        const keys = r.notes.map((n) => n.key);
        expect(keys).not.toContain("structure.woodCentral.note.layerPinOffCenter");
        const holeFindings = checks.results.filter((x) => x.ruleId === HOLE_RULE);
        expect(holeFindings.length).toBeGreaterThan(0);
        expect(holeFindings.every((f) => f.status === "ok")).toBe(true);
        // Joints de colle : bornes des couches (les tranches vides omises n'en sont pas).
        const joints = r.layers.flatMap((l) => [l.z0, l.z1]);
        for (const h of holes) {
          const rr = h.diameter / 2 + CLEARANCE;
          for (const z of joints) expect(Math.abs(z - h.z)).toBeGreaterThanOrEqual(rr - 1e-6);
        }
        for (const h of holes.filter((x) => x.mark === "AP1")) {
          const layer = r.layers.find((l) => Math.abs((l.z0 + l.z1) / 2 - h.z) < 1e-6);
          expect(layer, `${c.id} broche à ${h.z}`).toBeDefined();
          expect(layer!.z1 - layer!.z0).toBeLessThanOrEqual(tMax + 1e-9);
        }
        for (const l of r.layers) expect(l.z1 - l.z0).toBeLessThanOrEqual(tMax + 1e-9);
        // Joints toujours calés sur les assises.
        for (const seat of shape.seatLevels!) {
          expect(joints.some((z) => Math.abs(z - seat) < 1e-6)).toBe(true);
        }
        expect(keys).toContain("structure.woodCentral.note.layerHolesPins");
      }),
      { numRuns: 25 },
    );
  });

  it("aboutages décalés d'au moins jointOffset + fingerLength, ou constat sur la couche fautive ; aucun double compte", () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 30 }),
        (c, offset, finger) => {
          const ctx = contextFor(c.id, c.tread);
          const params = woodCentralParams({
            section: {
              width: c.b,
              jointOffset: offset,
              fingerLength: finger,
              ...(c.t !== undefined ? { layerThickness: c.t } : {}),
            },
          });
          const trace = woodTraceOf(ctx, params);
          const { shape } = plateShape(trace, c.b, c.tread, c.pin, 8);
          const { r, checks } = runShape(ctx, params, shape);
          expect(r.errors).toEqual([]);
          const beta = Math.atan(params.section.maxGrainSlope / 100);
          const findings = checks.results.filter((x) => x.ruleId === RULE);
          const byPart = new Map(
            findings.map((f) => [f.location.kind === "part" ? f.location.partId : "", f]),
          );
          const byId = new Map(r.parts.map((p) => [p.id, p]));
          for (let i = 0; i < r.layers.length; i++) {
            const l = r.layers[i]!;
            const boards = l.boards!;
            const below =
              i > 0 && Math.abs(r.layers[i - 1]!.z1 - l.z0) < 1e-6 ? r.layers[i - 1]! : null;
            const belowCuts = below
              ? [...new Set(below.boards!.map((bd) => bd.sigma0))].filter((x) => x > below.sigma0)
              : [];
            if (boards.length === 1) {
              expect(byPart.has(l.partId)).toBe(false);
              continue;
            }
            // (9) couche composée : pièce sans gabarit, planches composantes de la couche.
            const layer = byId.get(l.partId)!;
            expect(layer.componentOf).toBe(BEAM_ID);
            expect(layer.flat).toBeUndefined();
            expect(layer.stock).toBeUndefined();
            let layerGap = Infinity;
            for (const bd of boards) {
              const p = byId.get(bd.partId)!;
              expect(p.componentOf).toBe(l.partId);
              expect(rootAssemblyId([...r.parts, { id: BEAM_ID }], p.id)).toBe(BEAM_ID);
              expect(bd.grainDeviation).toBeLessThanOrEqual(beta + 1e-9);
              // Aucun constat par planche (un constat par couche, QUESTIONS A37 (13)).
              expect(byPart.has(bd.partId)).toBe(false);
              // (6) décalage recalculé des bouts aboutés.
              const ends = [bd.sigma0, bd.sigma1].filter((x) => x > l.sigma0 && x < l.sigma1);
              let gap = Infinity;
              for (const e of ends) for (const d of belowCuts) gap = Math.min(gap, Math.abs(e - d));
              if (!Number.isFinite(gap)) {
                expect(bd.jointOffset).toBeUndefined();
                continue;
              }
              expect(bd.jointOffset).toBeCloseTo(gap - finger, 6);
              layerGap = Math.min(layerGap, gap - finger);
            }
            // Un constat par couche composée : plus petit décalage de ses planches.
            const f = byPart.get(l.partId)!;
            expect(f).toBeDefined();
            if (!Number.isFinite(layerGap)) {
              expect(f.status).toBe("ok");
              expect(f.measured).toBeUndefined();
              continue;
            }
            const held = !(offset > 0) || layerGap >= offset - 1e-6;
            expect(f.status).toBe(held ? "ok" : "violation");
            expect(f.measured).toBeCloseTo(layerGap, 6);
          }
          // Constats de la seule règle des aboutages, sur des couches existantes.
          for (const f of findings) {
            expect(f.location.kind === "part" && byId.has(f.location.partId)).toBe(true);
          }
          // Aucun double compte : pièces fabriquées = planches et couches d'une planche.
          const fab = new Set(fabricatedParts([...r.parts, { id: BEAM_ID }]).map((p) => p.id));
          expect(fab.has(BEAM_ID)).toBe(false);
          for (const l of r.layers) {
            const boards = l.boards!;
            expect(fab.has(l.partId)).toBe(boards.length === 1);
            if (boards.length > 1) for (const bd of boards) expect(fab.has(bd.partId)).toBe(true);
          }
          for (const p of r.parts) {
            if (fab.has(p.id)) expect(p.quantities[QUANTITY_VOLUME_M3]).toBeGreaterThan(0);
            else expect(p.quantities).toEqual({});
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("couches empilées sur la poutre réelle (platine à âme noyée)", () => {
  for (const id of PRESETS) {
    it(`${id} : broches de pied au milieu d'une couche, pièces fabriquées sans double compte`, () => {
      const ctx = contextFor(id, createProject(id).stair.treads.thickness);
      const params = woodCentralParams({
        section: { curvedMethod: "stacked" },
        anchors: { kind: "embeddedPlate" },
      });
      const { beam, checks } = woodBeamOf(ctx, params);
      expect(beam.errors).toEqual([]);
      const keys = beam.notes.map((n) => n.key);
      expect(keys).toContain("structure.woodCentral.note.layerHolesPins");
      expect(keys).not.toContain("structure.woodCentral.note.layerPinOffCenter");
      const holeFindings = checks.results.filter((x) => x.ruleId === HOLE_RULE);
      expect(holeFindings.length).toBeGreaterThan(0);
      expect(holeFindings.every((x) => x.status === "ok")).toBe(true);
      // Pièces fabriquées : ni la poutre, ni les couches composées ; volumes > 0 ; aucune
      // pièce intermédiaire au débit.
      const fab = fabricatedParts(beam.parts);
      expect(fab.some((p) => p.id === beam.beamPartId)).toBe(false);
      const layerParts = beam.parts.filter((p) => p.id.startsWith("wood-central-layer-"));
      for (const p of layerParts) {
        expect(rootAssemblyId(beam.parts, p.id)).toBe(beam.beamPartId);
        const composite = beam.parts.some((q) => q.componentOf === p.id);
        expect(fab.includes(p)).toBe(!composite);
        expect(p.flat === undefined).toBe(composite);
        expect(p.stock === undefined).toBe(composite);
      }
      // Constats d'aboutage : une entrée par couche composée (QUESTIONS A37 (13)).
      const composites = layerParts.filter((p) => beam.parts.some((q) => q.componentOf === p.id));
      const joints = checks.results.filter((x) => x.ruleId === RULE);
      expect(joints).toHaveLength(composites.length);
      for (const j of joints) {
        expect(composites.some((p) => j.location.kind === "part" && j.location.partId === p.id));
      }
      // (5) logement de l'âme de pied tracé sur les gabarits des couches basses.
      const kerfLines = fab.flatMap((p) =>
        (p.flat?.lines ?? []).filter(
          (l) =>
            l.label?.key === "structure.woodCentral.flatLine.layerKerf" &&
            l.label.params?.["web"] === "AP1",
        ),
      );
      expect(kerfLines.length).toBeGreaterThan(0);
    });
  }
});

describe("couches empilées sur la poutre réelle : propriété des perçages (A36 (12), A37 (15))", () => {
  it("chaque perçage réel est hors des joints de colle, ou fait l'objet d'un constat", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.constantFrom(...PRESETS),
          tread: fc.integer({ min: 30, max: 80 }),
          b: fc.integer({ min: 80, max: 240 }),
          t: fc.option(fc.integer({ min: 30, max: 80 }), { nil: undefined }),
        }),
        (c) => {
          const ctx = contextFor(c.id, c.tread);
          const params = woodCentralParams({
            section: {
              width: c.b,
              curvedMethod: "stacked",
              ...(c.t !== undefined ? { layerThickness: c.t } : {}),
            },
            anchors: { kind: "embeddedPlate" },
          });
          const { beam, checks } = woodBeamOf(ctx, params);
          if (!beam.stacked) return;
          const layers = beam.stacked.layers;
          const joints: Mm[] = [];
          for (let i = 1; i < layers.length; i++) {
            if (Math.abs(layers[i - 1]!.z1 - layers[i]!.z0) < 1e-6) joints.push(layers[i]!.z0);
          }
          const bad = checks.results.filter(
            (x) => x.ruleId === HOLE_RULE && x.status === "violation",
          );
          for (const h of beam.stacked.holes) {
            const rr = h.diameter / 2 + CLEARANCE;
            const near = joints.some((z) => Math.abs(z - h.z) < rr - 1e-6);
            // Perçage au droit d'un joint de colle : constat (avertissement) à son repère.
            const flagged = bad.some(
              (f) =>
                f.message.params?.["mark"] === h.mark &&
                Math.abs(
                  (f.measured ?? Infinity) - Math.min(...joints.map((z) => Math.abs(z - h.z))),
                ) < 1e-6,
            );
            expect(flagged, `${c.id} ${h.mark} z = ${h.z}`).toBe(near);
          }
          for (const f of bad) {
            expect(f.severity).toBe("avertissement");
            expect(f.measured!).toBeLessThan(f.min! - 1e-9);
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe("aboutages à entures (A36 (6)) : gabarit, débit, volume", () => {
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
  const shape: StackedBeamShape = {
    beamId: BEAM_ID,
    beamMark: "LC1",
    b: 80,
    sStart: 0,
    sEnd: 1500,
    bottomAt: () => 0,
    topAt: () => 120,
    nodes: [],
    baseZ: 0,
  };
  const runArc = (over: Record<string, unknown>) => {
    const ctx = woodCentralContext(createProject("quarter-left"));
    const params = woodCentralParams({
      section: { layerThickness: 40, dressingAllowance: 5, maxGrainSlope: 5, ...over },
    });
    const checks = new CheckCollector(ctx.project, ctx.stepping);
    const r = buildStackedLayers({
      params,
      trace: arcTrace(3000, 1500),
      profile: PROFILE,
      checks,
      beam: shape,
    });
    return { r, checks };
  };
  const extent = (r: StackedLayersResult, id: string): number => {
    const xs = r.parts.find((p) => p.id === id)!.flat!.outline.outer.map((q) => q.x);
    const ys = r.parts.find((p) => p.id === id)!.flat!.outline.outer.map((q) => q.y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };

  it("gabarit et débit prolongés de fingerLength / 2 par bout abouté ; volume fini inchangé ; plan de joint tracé", () => {
    const bare = runArc({ jointOffset: 0, fingerLength: 0 }).r;
    const { r } = runArc({ jointOffset: 0, fingerLength: 40 });
    const l = r.layers[0]!;
    const boards = l.boards!;
    expect(boards.length).toBeGreaterThanOrEqual(3);
    // Mêmes coupes (aucun décalage imposé).
    expect(boards.map((bd) => bd.sigma0)).toEqual(bare.layers[0]!.boards!.map((bd) => bd.sigma0));
    boards.forEach((bd, j) => {
      const abutted = (j > 0 ? 1 : 0) + (j + 1 < boards.length ? 1 : 0);
      // Sur l'arc, le rectangle minimal s'allonge d'un peu plus que la demi-enture (rotation).
      const grow = extent(r, bd.partId) - extent(bare, bd.partId);
      expect(grow).toBeGreaterThan(20 * abutted - 0.5);
      expect(grow).toBeLessThan(20 * abutted + 1.5);
      const p = r.parts.find((x) => x.id === bd.partId)!;
      expect(p.stock!.length).toBeGreaterThanOrEqual(extent(r, bd.partId) - 1e-6);
      const joints = p.flat!.lines.filter(
        (x) => x.label?.key === "structure.woodCentral.flatLine.layerFingerJoint",
      );
      expect(joints).toHaveLength(abutted);
      for (const x of joints) {
        expect(x.kind).toBe("joint");
        expect(x.label!.params?.["length"]).toMatchObject({ num: 40 });
      }
    });
    const vol = (res: StackedLayersResult): number =>
      fabricatedParts(res.parts).reduce((a, p) => a + p.quantities[QUANTITY_VOLUME_M3]!, 0);
    expect(vol(r)).toBeCloseTo(vol(bare), 12);
  });

  it("décalage tenable : joints des couches voisines décalés, remarque « tenus »", () => {
    // Planches ≈ 300 mm : un décalage de 100 mm (+ 15) se tient d'une couche à l'autre.
    const { r, checks } = runArc({ jointOffset: 100, fingerLength: 15 });
    const findings = checks.results.filter((x) => x.ruleId === RULE);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.status === "ok")).toBe(true);
    for (let i = 1; i < r.layers.length; i++) {
      const cuts = r.layers[i]!.boards!.map((bd) => bd.sigma0).slice(1);
      const below = r.layers[i - 1]!.boards!.map((bd) => bd.sigma0).slice(1);
      for (const c of cuts)
        for (const d of below) expect(Math.abs(c - d)).toBeGreaterThanOrEqual(115 - 1e-6);
    }
    const note = r.notes.find((n) => n.key === "structure.woodCentral.note.layerFingerJoints")!;
    expect(note.params?.["held"]).toBe(note.params?.["joints"]);
  });

  it("décalage intenable : meilleur placement, constat en avertissement sur les couches fautives", () => {
    const { r, checks } = runArc({ jointOffset: 400, fingerLength: 15 });
    const bad = checks.results.filter((x) => x.ruleId === RULE && x.status === "violation");
    expect(bad.length).toBeGreaterThan(0);
    for (const f of bad) {
      expect(f.severity).toBe("avertissement");
      expect(f.message.key).toBe("structure.woodCentral.check.layerJoint");
      expect(f.measured).toBeLessThan(400);
    }
    // Les joints de la couche 2 restent écartés de ceux de la couche 1 (meilleur placement).
    const l1 = r.layers[0]!.boards!.map((bd) => bd.sigma0).slice(1);
    const l2 = r.layers[1]!.boards!.map((bd) => bd.sigma0).slice(1);
    for (const c of l2) for (const d of l1) expect(Math.abs(c - d)).toBeGreaterThan(50);
  });
});

describe("logements d'âme sur les gabarits des couches (A36 (5))", () => {
  it("découpé avant collage là où il traverse la couche, fraisé avec sa profondeur sinon", () => {
    const shape: StackedBeamShape = {
      beamId: BEAM_ID,
      beamMark: "LC1",
      b: 80,
      sStart: 0,
      sEnd: 900,
      bottomAt: () => 0,
      topAt: () => 120,
      nodes: [],
      baseZ: 0,
      kerfs: [
        {
          mark: "AP1",
          sigma0: 0,
          sigma1: 400,
          z0: 0,
          z1: 100,
          width: 8,
          outline: [
            V.vec(0, 0),
            V.vec(400, 0),
            V.vec(400, 100),
            V.vec(200, 100),
            V.vec(200, 50),
            V.vec(0, 50),
          ],
        },
      ],
    };
    const ctx = woodCentralContext(createProject("quarter-left"));
    const params = woodCentralParams({ section: { layerThickness: 40, dressingAllowance: 5 } });
    const straight: CentralTrace = {
      kind: "straight",
      curve: { segments: [] } as unknown as CentralTrace["curve"],
      length: 900,
      point: (s) => V.vec(s, 0),
      tangent: () => V.vec(1, 0),
      left: () => V.vec(0, 1),
      nosingSigma: [],
      nosingZ: () => 0,
      slope: 0,
      naissances: [],
      arcs: [],
      notes: [],
    };
    const checks = new CheckCollector(ctx.project, ctx.stepping);
    const r = buildStackedLayers({
      params,
      trace: straight,
      profile: PROFILE,
      checks,
      beam: shape,
    });
    expect(r.layers.map((l) => [l.z0, l.z1])).toEqual([
      [0, 40],
      [40, 80],
      [80, 120],
    ]);
    const kerfLines = (i: number) =>
      r.parts[i]!.flat!.lines.filter((l) =>
        l.label?.key.startsWith("structure.woodCentral.flatLine.layerKerf"),
      );
    // Couche 1 : traversée sur 0 à 400 ; couche 2 : 10 mm sur 0 à 200, traversée de 200 à 400 ;
    // couche 3 : 20 mm de 200 à 400.
    expect(
      kerfLines(0).every((l) => l.label!.key === "structure.woodCentral.flatLine.layerKerf"),
    ).toBe(true);
    expect(kerfLines(0).length).toBeGreaterThan(0);
    const depths = (i: number) =>
      [...new Set(kerfLines(i).map((l) => l.depth ?? 0))].sort((a, b) => a - b);
    expect(depths(1)).toEqual([0, 10]);
    expect(depths(2)).toEqual([20]);
    expect(
      kerfLines(2).every(
        (l) =>
          l.label!.key === "structure.woodCentral.flatLine.layerKerfMilled" &&
          (l.label!.params?.["depth"] as { num: number }).num === 20,
      ),
    ).toBe(true);
    // Contour extérieur inchangé (bande droite) ; remarque fr / en de synthèse.
    for (const p of r.parts) expect(p.flat!.outline.outer.length).toBeGreaterThan(3);
    const note = r.notes.find((n) => n.key === "structure.woodCentral.note.layerKerfMilled")!;
    expect(note.params).toMatchObject({ web: "AP1", cut: 2, milled: 2 });
  });
});
