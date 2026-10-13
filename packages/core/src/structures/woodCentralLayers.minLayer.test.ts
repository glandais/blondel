/**
 * Couches empilées du limon central bois, décision A39 (d) du 2026-10-13 (`woodCentralLayers.ts`) :
 * épaisseur minimale de couche au joint de colle imposé sur le dessus voulu de l'âme de pied
 * (`section.minLayerThickness`, 20 mm par défaut, sans source, à valider). Un joint imposé qui
 * laisserait, entre lui et le joint, l'assise, la base ou le dessus voisin, une couche plus mince
 * est abandonné (`resolveImposedLevels`, `stackedBounds`, `reason: "thin"`, remarque
 * `note.layerJointLevelThin`) ; l'âme de pied s'arrête alors au joint en dessous. 0 : aucun
 * minimum (comportement A38 exact). Exemples, propriétés sur générateurs contraints (base, deux
 * assises, niveau imposé, épaisseur maximale des couches, broche de pied avec pince de l'âme,
 * minimum 0 à 60 mm) et propriété `buildModel` sur les préréglages quart tournant et hélicoïdal.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import type { Project } from "../model/project.js";
import type { Mm } from "../model/primitives.js";
import { buildModel } from "../pipeline/build.js";
import { createProject, deepMerge } from "../project/presets.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { WoodCentralParamsSchema } from "./woodCentralParams.js";
import { woodBeamOf, woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";
import {
  buildStackedLayers,
  holeLevelsOf,
  layerBounds,
  resolveImposedLevels,
  stackedBounds,
  stackedJointLevels,
  type StackedBeamShape,
} from "./woodCentralLayers.js";
import { WOOD_CENTRAL_PLATE_FOOT_WEB_ID } from "./woodCentralPlates.js";
import type { ShoeBeamHole } from "./woodCentralShoes.js";
import "./index.js";

const PROFILE = resolveWorkshopProfile();
const CLEARANCE = PROFILE.wood.clearance;
const THIN_KEY = "structure.woodCentral.note.layerJointLevelThin";
const HOLE_KEY = "structure.woodCentral.note.layerJointLevelDropped";

/** Trace droite de longueur L (forme plate : la trace ne joue pas sur les niveaux). */
const STRAIGHT: CentralTrace = {
  kind: "straight",
  curve: { segments: [] } as unknown as CentralTrace["curve"],
  length: 600,
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

const CTX = (() => {
  let ctx: ReturnType<typeof woodCentralContext> | null = null;
  return () => (ctx ??= woodCentralContext(createProject("quarter-left")));
})();

/** Broche de pied Ø`d` (repère AP1, centrée par défaut) avec la pince de perçage de l'âme. */
const footPin = (z: Mm, d: Mm): ShoeBeamHole => ({
  mark: "AP1",
  sigma: 40,
  z,
  diameter: d,
  webEdge: 25,
});

/** Forme droite : dessous à la base, dessus au dernier niveau, assises et niveaux imposés. */
const flatShape = (base: Mm, seats: readonly Mm[], levels: readonly Mm[]): StackedBeamShape => ({
  beamId: "wood-central-beam",
  beamMark: "LC1",
  b: 80,
  sStart: 0,
  sEnd: 600,
  bottomAt: () => base,
  topAt: () => seats[seats.length - 1]!,
  nodes: [],
  baseZ: base,
  seatLevels: seats,
  jointLevels: levels,
});

/** Couches et oracle des platines pour une forme, une épaisseur maximale et un minimum. */
function buildFlat(
  shape: StackedBeamShape,
  tMax: Mm,
  minLayer: Mm,
  holes: readonly ShoeBeamHole[] = [],
) {
  const ctx = CTX();
  const params = woodCentralParams({
    section: { layerThickness: tMax, minLayerThickness: minLayer },
  });
  const checks = new CheckCollector(ctx.project, ctx.stepping);
  const r = buildStackedLayers({
    params,
    trace: STRAIGHT,
    profile: PROFILE,
    checks,
    beam: { ...shape, holes },
  });
  const oracle = stackedJointLevels({ params, profile: PROFILE, beam: shape })(holes);
  const levels = [...new Set(r.layers.flatMap((l) => [l.z0, l.z1]))].sort((p, q) => p - q);
  return { r, oracle, levels };
}

const near = (zs: readonly Mm[], z: Mm, eps = 1e-9): boolean =>
  zs.some((x) => Math.abs(x - z) < eps);

describe("épaisseur minimale de couche au joint imposé (A39 (d)) : exemples", () => {
  it("préréglage cintré type : joint de 129 à 11 mm de l'assise de 140, abandonné « thin »", () => {
    const res = resolveImposedLevels(8, 140, [140], [129], [], 20);
    expect(res.imposed).toEqual([]);
    expect(res.levels).toEqual([140]);
    expect(res.dropped).toEqual([
      { reason: "thin", z: 129, z0: 129, z1: 140, thickness: 11, min: 20 },
    ]);
    // Couches et oracle : 129 n'est pas une borne, mêmes joints, remarque traduisible.
    const { r, oracle, levels } = buildFlat(flatShape(8, [140], [129]), 75, 20);
    expect(r.errors).toEqual([]);
    expect(near(levels, 129, 1e-6)).toBe(false);
    expect(oracle).toEqual(levels);
    const note = r.notes.find((n) => n.key === THIN_KEY);
    expect(note?.params).toMatchObject({
      z: { num: 129 },
      thickness: { num: 11 },
      z0: { num: 129 },
      z1: { num: 140 },
      min: { num: 20 },
    });
    expect(r.notes.map((n) => n.key)).not.toContain(HOLE_KEY);
  });

  it("minimum nul : niveau retenu comme avec A38 ; écart égal au minimum : retenu", () => {
    const a38 = resolveImposedLevels(8, 140, [140], [129], []);
    expect(resolveImposedLevels(8, 140, [140], [129], [], 0)).toEqual(a38);
    expect(a38).toEqual({ levels: [140, 129], imposed: [129], dropped: [] });
    const zero = buildFlat(flatShape(8, [140], [129]), 75, 0);
    expect(near(zero.levels, 129)).toBe(true);
    expect(zero.r.notes.map((n) => n.key)).not.toContain(THIN_KEY);
    // 11 mm exactement : retenu (le minimum est admis).
    expect(resolveImposedLevels(8, 140, [140], [129], [], 11).imposed).toEqual([129]);
    const equal = buildFlat(flatShape(8, [140], [120]), 75, 20);
    expect(near(equal.levels, 120)).toBe(true);
    expect(equal.oracle).toEqual(equal.levels);
  });

  it("couche plus mince créée par le partage de l'intervalle voisin : niveau abandonné", () => {
    // Base 8, niveau 38, assise 140, t_max 27 : 30 mm sous le niveau (≥ 20) mais partagés en deux
    // couches de 15 mm (⌈30 / 27⌉ = 2) : le niveau est abandonné par `stackedBounds`.
    const res = resolveImposedLevels(8, 140, [140], [38], [], 20);
    expect(res.imposed).toEqual([38]);
    const sb = stackedBounds(8, 140, 27, [140], [38], [], 20);
    expect(sb.dropped).toHaveLength(1);
    expect(sb.dropped[0]).toMatchObject({ reason: "thin", z: 38, min: 20 });
    expect(sb.dropped[0]!.reason === "thin" && sb.dropped[0]!.thickness).toBeCloseTo(15, 9);
    expect(near([sb.bounds[0]!.z0, ...sb.bounds.map((b) => b.z1)], 38)).toBe(false);
    // Sans minimum : le niveau reste, deux couches de 15 mm (comportement A38).
    const a38 = stackedBounds(8, 140, 27, [140], [38], []);
    expect(a38.dropped).toEqual([]);
    expect(a38.bounds.slice(0, 2).map((b) => b.z1 - b.z0)).toEqual([15, 15]);
  });

  it("abandon au travers d'un perçage inchangé ; fusion à moins de 1 mm inchangée", () => {
    const pin = holeLevelsOf([footPin(56, 12)], CLEARANCE);
    const res = resolveImposedLevels(8, 160, [160], [60], pin, 20);
    expect(res.dropped).toEqual([
      { reason: "hole", z: 60, mark: "AP1", holeZ: 56, min: pin[0]!.r },
    ]);
    const { r } = buildFlat(flatShape(8, [160], [60]), 75, 20, [footPin(56, 12)]);
    expect(r.notes.map((n) => n.key)).toContain(HOLE_KEY);
    expect(r.notes.map((n) => n.key)).not.toContain(THIN_KEY);
    // Fusion silencieuse avec l'assise ou la base (garde technique de 1 mm), même avec un minimum.
    expect(resolveImposedLevels(8, 160, [160], [159.5, 8.4], [], 20)).toEqual({
      levels: [160],
      imposed: [],
      dropped: [],
    });
  });
});

describe("épaisseur minimale de couche au joint imposé (A39 (d)) : propriétés", () => {
  it("aucune couche plus mince que le minimum due à un joint imposé ; oracle = empilement ; minimum nul = A38", () => {
    // Abandons « thin » posés par le partage d'un intervalle (pas par l'écart au niveau voisin),
    // dont ceux d'une couche qui ne touche pas le niveau (broche sous le niveau, A39 (d)).
    let thinFromShare = 0;
    let thinApart = 0;
    fc.assert(
      fc.property(
        fc.record({
          seat: fc.integer({ min: 60, max: 260 }),
          rise: fc.integer({ min: 120, max: 200 }),
          tMax: fc.integer({ min: 20, max: 80 }),
          d: fc.integer({ min: 10, max: 16 }),
          pinFrac: fc.double({ min: 0.2, max: 0.6, noNaN: true }),
          frac: fc.double({ min: 0.001, max: 1.3, noNaN: true }),
          withPin: fc.boolean(),
          // Broche sous le niveau imposé (cas réel : broches de l'âme sous son joint).
          pinBelow: fc.boolean(),
          minLayer: fc.integer({ min: 0, max: 60 }),
        }),
        (c) => {
          const base = 8;
          const seats = [c.seat, c.seat + c.rise];
          const zTop = seats[1]!;
          const level = base + c.frac * (c.seat - base);
          const pinTop = c.pinBelow ? Math.min(level, c.seat) : c.seat;
          const holes = c.withPin ? [footPin(base + c.pinFrac * (pinTop - base), c.d)] : [];
          const hl = holeLevelsOf(holes, CLEARANCE);
          const sb = stackedBounds(base, zTop, c.tMax, seats, [level], hl, c.minLayer);
          const levels = [sb.bounds[0]!.z0, ...sb.bounds.map((x) => x.z1)];
          const isSeat = seats.some((st) => Math.abs(st - level) < 1);
          const dropped = sb.dropped.length > 0;
          // (i) Niveau imposé retenu : toute couche qui le touche a au moins le minimum ; entre les
          // niveaux qui l'encadrent, aucune couche plus mince que le minimum et que la plus mince
          // du même empilement sans ce niveau (A39 (d) : pas de couche mince créée par le joint).
          if (!dropped && !isSeat && level - base >= 1 && level <= zTop) {
            const lo = level < c.seat ? base : c.seat;
            const hi = level < c.seat ? c.seat : Infinity;
            const within = (x: { z0: Mm; z1: Mm }): boolean => x.z0 > lo - 1e-6 && x.z1 < hi + 1e-6;
            const without = stackedBounds(base, zTop, c.tMax, seats, [], hl, c.minLayer);
            const floor = Math.min(...without.bounds.filter(within).map((x) => x.z1 - x.z0));
            for (const x of sb.bounds) {
              if (Math.abs(x.z0 - level) < 1e-6 || Math.abs(x.z1 - level) < 1e-6) {
                expect(x.z1 - x.z0).toBeGreaterThanOrEqual(c.minLayer - 1e-9);
              }
              if (within(x)) {
                expect(x.z1 - x.z0).toBeGreaterThanOrEqual(Math.min(c.minLayer, floor) - 1e-9);
              }
            }
          }
          // (ii) Un niveau abandonné n'est pas une borne (sauf s'il coïncide avec une assise).
          for (const dd of sb.dropped) {
            expect(dd.z).toBe(level);
            if (!seats.some((st) => Math.abs(st - dd.z) < 1e-9)) {
              expect(near(levels, dd.z, 1e-9)).toBe(false);
            }
            if (dd.reason === "thin") {
              expect(dd.min).toBe(c.minLayer);
              expect(dd.thickness).toBeLessThan(c.minLayer);
              expect(dd.z1 - dd.z0).toBeCloseTo(dd.thickness, 9);
              if (resolveImposedLevels(base, zTop, seats, [level], hl, c.minLayer).imposed.length) {
                thinFromShare++;
                if (Math.abs(dd.z0 - level) > 1e-6 && Math.abs(dd.z1 - level) > 1e-6) thinApart++;
              }
            }
          }
          // (iii) Minimum nul : identique à l'appel sans le paramètre (A38).
          if (c.minLayer === 0) {
            expect(sb).toEqual(stackedBounds(base, zTop, c.tMax, seats, [level], hl));
            const res = resolveImposedLevels(base, zTop, seats, [level], hl);
            const lb = layerBounds(base, zTop, c.tMax, res.levels, 1000, hl);
            expect(sb.bounds).toEqual(lb.bounds);
          }
          // (v) Assises toujours des joints, couches ≤ t_max.
          for (const st of seats) expect(near(levels, st)).toBe(true);
          for (const x of sb.bounds) expect(x.z1 - x.z0).toBeLessThanOrEqual(c.tMax + 1e-9);
          // (iv) Oracle des platines = bornes des couches ; aucune erreur ; une remarque par abandon.
          const built = buildFlat(flatShape(base, seats, [level]), c.tMax, c.minLayer, holes);
          expect(built.r.errors).toEqual([]);
          expect(built.oracle).toEqual(levels);
          expect(built.levels).toEqual(levels);
          const notes = built.r.notes.filter((n) => n.key === THIN_KEY || n.key === HOLE_KEY);
          expect(notes).toHaveLength(sb.dropped.length);
        },
      ),
      { numRuns: 120 },
    );
    // Le générateur atteint bien les abandons posés par le partage des intervalles.
    expect(thinFromShare).toBeGreaterThan(0);
    expect(thinApart).toBeGreaterThan(0);
  });
});

/** Projet en couches empilées sur platine à âme noyée (`anchors.plate.webDepth` donné). */
const stackedOnPlate = (base: Project, webDepth: Mm, minLayer?: Mm): Project =>
  deepMerge(base, {
    stair: {
      structure: {
        kind: "wood-central",
        params: {
          section: {
            curvedMethod: "stacked",
            ...(minLayer !== undefined ? { minLayerThickness: minLayer } : {}),
          },
          anchors: { kind: "embeddedPlate", plate: { webDepth } },
        },
      },
    },
  });

/** Poutre et niveau imposé voulu (tp + webDepth + jeu, A38 (12)) d'un projet. */
function beamWithWanted(project: Project) {
  const params = WoodCentralParamsSchema.parse(
    project.stair.structure.kind === "wood-central" ? project.stair.structure.params : {},
  );
  const { beam } = woodBeamOf(woodCentralContext(project), params);
  const wanted = params.anchors.plate.thickness + params.anchors.plate.webDepth + CLEARANCE;
  return { beam, params, wanted, layers: beam.stacked?.layers ?? [] };
}

describe("épaisseur minimale de couche au joint imposé (A39 (d)) : poutre", () => {
  it.each([
    [60, 69],
    [80, 89],
  ])(
    "quart tournant, âme de %i mm : joint de %i mm abandonné, plus de couche mince sous lui",
    (webDepth, z) => {
      // Gardé, le joint faisait re-partager [8 ; z] autour des broches de l'âme (au milieu de
      // leur couche) en couches de 16,7 mm (webDepth 60) ou 15 mm (webDepth 80), absentes sans
      // lui : il est abandonné (relecture A39 (d)), l'âme s'arrête au joint en dessous.
      const { beam, params, wanted, layers } = beamWithWanted(
        stackedOnPlate(createProject("quarter-left"), webDepth),
      );
      expect(wanted).toBeCloseTo(z, 9);
      const note = beam.notes.find((n) => n.key === THIN_KEY);
      expect(note?.params).toMatchObject({ z: { num: z }, min: { num: 20 } });
      expect(near([...layers.map((l) => l.z0), ...layers.map((l) => l.z1)], z, 1e-6)).toBe(false);
      const below = layers.filter((l) => l.z1 <= 140 + 1e-6);
      expect(Math.min(...below.map((l) => l.z1 - l.z0))).toBeGreaterThanOrEqual(
        params.section.minLayerThickness - 1e-9,
      );
    },
  );
});

describe("épaisseur minimale de couche au joint imposé (A39 (d)) : buildModel", () => {
  it("quart tournant ou hélicoïdal, couches empilées sur platine : aucune exception ni erreur, AP1 présente", () => {
    const projects = new Map<string, Project>();
    const base = (id: "quarter-left" | "helical"): Project => {
      let p = projects.get(id);
      if (!p) {
        p = createProject(id);
        projects.set(id, p);
      }
      return p;
    };
    let withPlate = 0;
    fc.assert(
      fc.property(
        fc.record({
          id: fc.constantFrom("quarter-left" as const, "helical" as const),
          webDepth: fc.integer({ min: 60, max: 250 }),
          minLayer: fc.integer({ min: 0, max: 60 }),
        }),
        (c) => {
          const project = deepMerge(base(c.id), {
            stair: {
              structure: {
                kind: "wood-central",
                params: {
                  section: { curvedMethod: "stacked", minLayerThickness: c.minLayer },
                  anchors: { kind: "embeddedPlate", plate: { webDepth: c.webDepth } },
                },
              },
            },
          });
          const m = buildModel(project, { memo: false });
          expect(m.errors).toEqual([]);
          const notGenerated = m.compliance.results.some(
            (r) => r.ruleId === "FAB_PLATINE_AME_NOYEE" && r.severity === "bloquant",
          );
          const web = m.parts.find((x) => x.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID);
          if (!notGenerated) expect(web).toBeDefined();
          if (web) withPlate++;
          // Joint imposé retenu (ni abandonné, ni fusionné avec une assise ; un joint du partage
          // peut tomber au même niveau qu'un joint abandonné) : les couches qui le touchent ont
          // au moins le minimum.
          const { beam, wanted, layers } = beamWithWanted(project);
          const kept =
            !beam.notes.some((n) => n.key === THIN_KEY || n.key === HOLE_KEY) &&
            !beam.seats.some((st) => Math.abs(st.z - wanted) < 1 + 1e-9);
          for (const l of kept ? layers : []) {
            if (Math.abs(l.z0 - wanted) < 1e-6 || Math.abs(l.z1 - wanted) < 1e-6) {
              expect(l.z1 - l.z0).toBeGreaterThanOrEqual(c.minLayer - 1e-9);
            }
          }
        },
      ),
      { numRuns: 12 },
    );
    expect(withPlate).toBeGreaterThan(0);
  });
});
