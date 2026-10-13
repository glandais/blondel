/**
 * Couches empilées du limon central bois, décisions A39 (d) et A40 (c) du 2026-10-13
 * (`woodCentralLayers.ts`) : épaisseur minimale de couche au joint de colle imposé sur le dessus
 * voulu de l'âme de pied (`section.minLayerThickness`, 20 mm par défaut, sans source, à valider).
 * Un joint imposé qui laisserait sous le niveau voisin du dessus une couche plus mince est
 * **recalé** à « voisin − minimum » (`shifted`, remarque `note.layerJointLevelShifted`) : l'âme de
 * pied est moins profonde que voulu d'au plus le minimum, jamais plus profonde. Il reste
 * abandonné (`reason: "thin"`, remarque `note.layerJointLevelThin`, âme arrêtée au joint en
 * dessous) quand le voisin trop proche est en dessous, quand le recalage laisserait une couche
 * trop mince en dessous ou tomberait dans un perçage, quand le minimum dépasse t_max, ou quand le
 * partage des intervalles voisins (perçages) laisse encore une couche trop mince qu'un seul
 * recalage d'au plus le minimum ne corrige pas. 0 : aucun minimum (comportement A38 exact).
 * Exemples, propriétés sur générateurs contraints (base, deux assises, niveau imposé, épaisseur
 * maximale des couches, broche de pied avec pince de l'âme, minimum 0 à 60 mm) et propriété
 * `buildModel` sur les préréglages quart tournant et hélicoïdal (épaisseur des couches `auto` ou
 * de 5 à 120 mm, minimum de 0 à 200 mm). Un abandon après recalage cite l'altitude recalée
 * (`at`, remarque `note.layerJointLevelThinShifted`).
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
const THIN_SHIFTED_KEY = "structure.woodCentral.note.layerJointLevelThinShifted";
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

const SHIFTED_KEY = "structure.woodCentral.note.layerJointLevelShifted";
/** Arrondi au dixième, comme `dec(x, 1)`. */
const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Plus haut niveau de `levels` au plus égal à z (copie de `jointBelow`, `woodCentralPlates.ts`). */
const jointBelow = (levels: readonly Mm[], z: Mm): Mm => {
  let out = -Infinity;
  for (const j of levels) if (j <= z + 1e-6) out = Math.max(out, j);
  return out;
};

describe("épaisseur minimale de couche au joint imposé (A39 (d), A40 (c)) : exemples", () => {
  it("préréglage cintré type : joint de 129 à 11 mm sous l'assise de 140, recalé à 120", () => {
    const res = resolveImposedLevels(8, 140, [140], [129], [], 20);
    expect(res).toEqual({
      levels: [140, 120],
      imposed: [120],
      dropped: [],
      shifted: [{ z: 129, at: 120, neighbour: 140, min: 20 }],
    });
    // Couches et oracle : 120 est une borne (couche de 20 mm sous l'assise), 129 n'en est pas
    // une ; l'âme voulue de 120 mm (129 − 8 − 1) s'arrête au joint recalé : 111 mm.
    const { r, oracle, levels } = buildFlat(flatShape(8, [140], [129]), 75, 20);
    expect(r.errors).toEqual([]);
    expect(near(levels, 120, 1e-6)).toBe(true);
    expect(near(levels, 129, 1e-6)).toBe(false);
    expect(oracle).toEqual(levels);
    expect(jointBelow(oracle, 129)).toBe(120);
    const note = r.notes.find((n) => n.key === SHIFTED_KEY);
    expect(note?.params).toMatchObject({
      z: { num: 129 },
      at: { num: 120 },
      neighbour: { num: 140 },
      min: { num: 20 },
      wanted: { num: 129 - 8 - CLEARANCE },
      depth: { num: 120 - 8 - CLEARANCE },
    });
    expect(r.notes.map((n) => n.key)).not.toContain(THIN_KEY);
    expect(r.notes.map((n) => n.key)).not.toContain(HOLE_KEY);
  });

  it("écart de 1 mm sous l'assise : recalé à 120 ; voisin trop proche en dessous : abandonné", () => {
    expect(resolveImposedLevels(8, 140, [140], [139], [], 20).shifted).toEqual([
      { z: 139, at: 120, neighbour: 140, min: 20 },
    ]);
    // 149, 9 mm au-dessus de l'assise de 140 : jamais recalé vers le haut (âme plus profonde
    // que voulu) ; abandonné, l'âme s'arrête à l'assise (moins du minimum sous le voulu).
    const above = resolveImposedLevels(8, 200, [140, 200], [149], [], 20);
    expect(above.shifted).toEqual([]);
    expect(above.dropped).toEqual([
      { reason: "thin", z: 149, z0: 140, z1: 149, thickness: 9, min: 20 },
    ]);
  });

  it("minimum nul : niveau retenu comme avec A38 ; écart égal au minimum : retenu sans recalage", () => {
    const a38 = resolveImposedLevels(8, 140, [140], [129], []);
    expect(resolveImposedLevels(8, 140, [140], [129], [], 0)).toEqual(a38);
    expect(a38).toEqual({ levels: [140, 129], imposed: [129], dropped: [], shifted: [] });
    const zero = buildFlat(flatShape(8, [140], [129]), 75, 0);
    expect(near(zero.levels, 129)).toBe(true);
    expect(zero.r.notes.map((n) => n.key)).not.toContain(THIN_KEY);
    expect(zero.r.notes.map((n) => n.key)).not.toContain(SHIFTED_KEY);
    // 11 mm exactement : retenu (le minimum est admis).
    expect(resolveImposedLevels(8, 140, [140], [129], [], 11)).toMatchObject({
      imposed: [129],
      shifted: [],
    });
    const equal = buildFlat(flatShape(8, [140], [120]), 75, 20);
    expect(near(equal.levels, 120)).toBe(true);
    expect(equal.oracle).toEqual(equal.levels);
    expect(equal.r.notes.map((n) => n.key)).not.toContain(SHIFTED_KEY);
  });

  it("recalage impossible : intervalle trop court, perçage, minimum au-delà de t_max", () => {
    // [8 ; 40] : 30 est à 10 mm de l'assise ; recalé à 20, il laisserait 12 mm sur la base.
    expect(resolveImposedLevels(8, 40, [40], [30], [], 20)).toMatchObject({
      imposed: [],
      shifted: [],
      dropped: [{ reason: "thin", z: 30, z0: 30, z1: 40, thickness: 10, min: 20 }],
    });
    // Broche à 115 (zone interdite |z − 115| < 7) : 129 est hors de la zone, 120 dedans.
    const pin = holeLevelsOf([footPin(115, 12)], CLEARANCE);
    expect(resolveImposedLevels(8, 140, [140], [129], pin, 20)).toMatchObject({
      imposed: [],
      shifted: [],
      dropped: [{ reason: "thin", z: 129, z0: 129, z1: 140, thickness: 11, min: 20 }],
    });
    // Minimum de 80 mm pour des couches d'au plus 75 mm : aucune couche ne peut le tenir,
    // aucun recalage (abandon A39 (d)) ; sans t_max (défaut), le recalage serait possible.
    expect(resolveImposedLevels(8, 140, [140], [129], [], 80, 75)).toMatchObject({
      shifted: [],
      dropped: [{ reason: "thin", z: 129, z0: 129, z1: 140, thickness: 11, min: 80 }],
    });
    const sb = stackedBounds(8, 140, 75, [140], [129], [], 80);
    expect(sb.shifted).toEqual([]);
    expect(sb.dropped).toHaveLength(1);
    // Le dessus de la poutre est un voisin comme un autre.
    expect(resolveImposedLevels(8, 60, [60], [45], [], 20).shifted).toEqual([
      { z: 45, at: 40, neighbour: 60, min: 20 },
    ]);
  });

  it("couche plus mince créée par le partage de l'intervalle du dessous : niveau abandonné", () => {
    // Base 8, niveau 38, assise 140, t_max 27 : 30 mm sous le niveau (≥ 20) mais partagés en deux
    // couches de 15 mm (⌈30 / 27⌉ = 2), sous le niveau : aucun recalage vers le bas ne les
    // épaissit, le niveau est abandonné par `stackedBounds` (A39 (d), inchangé).
    const res = resolveImposedLevels(8, 140, [140], [38], [], 20, 27);
    expect(res.imposed).toEqual([38]);
    const sb = stackedBounds(8, 140, 27, [140], [38], [], 20);
    expect(sb.shifted).toEqual([]);
    expect(sb.dropped).toHaveLength(1);
    expect(sb.dropped[0]).toMatchObject({ reason: "thin", z: 38, min: 20 });
    expect(sb.dropped[0]!.reason === "thin" && sb.dropped[0]!.thickness).toBeCloseTo(15, 9);
    expect(near([sb.bounds[0]!.z0, ...sb.bounds.map((b) => b.z1)], 38)).toBe(false);
    // Sans minimum : le niveau reste, deux couches de 15 mm (comportement A38).
    const a38 = stackedBounds(8, 140, 27, [140], [38], []);
    expect(a38.dropped).toEqual([]);
    expect(a38.bounds.slice(0, 2).map((b) => b.z1 - b.z0)).toEqual([15, 15]);
  });

  it("recalage au partage : couche trop mince posée sur le niveau (broche au-dessus), recalée", () => {
    // Assises 100 et 260, t_max 30, minimum 15, broche AP1 Ø12 à 79 (au milieu de sa couche) :
    // le niveau 59 est loin des niveaux fixes (`resolveImposedLevels` le garde), mais le partage
    // de [59 ; 100] autour de la broche pose sur lui une couche [59 ; 72] de 13 mm. Recalé à
    // 72 − 15 = 57 (2 mm sous le voulu) : couches de 15 mm au-dessus, de 24,5 mm en dessous.
    const pin = holeLevelsOf([footPin(79, 12)], CLEARANCE);
    expect(resolveImposedLevels(8, 260, [100, 260], [59], pin, 15, 30).shifted).toEqual([]);
    const sb = stackedBounds(8, 260, 30, [100, 260], [59], pin, 15);
    expect(sb.dropped).toEqual([]);
    expect(sb.shifted).toHaveLength(1);
    const sh = sb.shifted[0]!;
    expect(sh).toMatchObject({ z: 59, min: 15 });
    expect(sh.at).toBeCloseTo(57, 9);
    expect(sh.neighbour).toBeCloseTo(72, 9);
    const levels = [sb.bounds[0]!.z0, ...sb.bounds.map((b) => b.z1)];
    expect(near(levels, sh.at, 1e-9)).toBe(true);
    expect(near(levels, 59, 1e-6)).toBe(false);
    // Couches contre le joint recalé : au moins le minimum (les couches de 14 mm de [72 ; 100],
    // autour de la broche, existent sans le niveau imposé).
    for (const b of sb.bounds.filter((x) => near([x.z0, x.z1], sh.at, 1e-9))) {
      expect(b.z1 - b.z0).toBeGreaterThanOrEqual(15 - 1e-9);
    }
    // Oracle et couches : mêmes joints, remarque du recalage.
    const { r, oracle } = buildFlat(flatShape(8, [100, 260], [59]), 30, 15, [footPin(79, 12)]);
    expect(oracle.map((z) => +z.toFixed(6))).toEqual(levels.map((z) => +z.toFixed(6)));
    expect(r.notes.find((n) => n.key === SHIFTED_KEY)?.params).toMatchObject({
      z: { num: 59 },
      at: { num: 57 },
      neighbour: { num: 72 },
    });
  });

  it("joint du partage à l'altitude voulue même : âme de la profondeur voulue, aucun recalage dit", () => {
    // Contre-exemple fast-check (intégration A40 (c)) : assises 82 et 242, t_max 27, minimum 27,
    // broche AP1 Ø10 à 68 (zone [62 ; 74]). Sans niveau imposé, le partage de [8 ; 82] autour de
    // la broche a déjà des joints à 35, 62 et 74. Le niveau voulu 62 est recalé à 55 (82 − 27),
    // puis au partage à 35 (62 − 27) : l'empilement final est celui sans niveau imposé, avec un
    // joint à 62, où l'âme de pied s'arrête (profondeur voulue tenue). Aucune remarque de
    // recalage (elle annoncerait une âme arrêtée à 35), aucun abandon.
    const pin = [footPin(68, 10)];
    const hl = holeLevelsOf(pin, CLEARANCE);
    const sb = stackedBounds(8, 242, 27, [82, 242], [62], hl, 27);
    const levels = [sb.bounds[0]!.z0, ...sb.bounds.map((b) => b.z1)];
    expect(levels).toEqual(
      [8, ...layerBounds(8, 242, 27, [82, 242], undefined, hl).bounds.map((b) => b.z1)].map((z) =>
        expect.closeTo(z, 9),
      ),
    );
    expect(near(levels, 62, 1e-9)).toBe(true);
    expect(jointBelow(levels, 62)).toBeCloseTo(62, 9);
    expect(sb.shifted).toEqual([]);
    expect(sb.dropped).toEqual([]);
    const { r, oracle } = buildFlat(flatShape(8, [82, 242], [62]), 27, 27, pin);
    expect(r.errors).toEqual([]);
    expect(oracle).toEqual(levels);
    expect(r.notes.map((n) => n.key)).not.toContain(SHIFTED_KEY);
  });

  it("recalage total au-delà du minimum : abandonné", () => {
    // Niveau 99 à 1 mm de l'assise de 100 : recalé à 80 par `resolveImposedLevels` ; avec une
    // broche à 91, le partage de [80 ; 100] pose sur lui une couche [80 ; 82] de 2 mm ; le
    // recaler sous 82 − 20 = 62 l'éloignerait de 37 mm du voulu (> 20) : abandonné.
    const pin = holeLevelsOf([footPin(91, 12)], CLEARANCE);
    expect(resolveImposedLevels(8, 260, [100, 260], [99], pin, 20, 30).shifted).toEqual([
      { z: 99, at: 80, neighbour: 100, min: 20 },
    ]);
    const sb = stackedBounds(8, 260, 30, [100, 260], [99], pin, 20);
    expect(sb.shifted).toEqual([]);
    expect(sb.dropped).toHaveLength(1);
    // La couche en cause est celle du joint recalé à 80 (`at`), pas d'un joint à 99.
    expect(sb.dropped[0]).toMatchObject({ reason: "thin", z: 99, z0: 80, at: 80, min: 20 });
    expect(sb.dropped[0]!.reason === "thin" && sb.dropped[0]!.z1).toBeCloseTo(82, 9);
    const { r } = buildFlat(flatShape(8, [100, 260], [99]), 30, 20, [footPin(91, 12)]);
    expect(r.notes.find((n) => n.key === THIN_SHIFTED_KEY)?.params).toMatchObject({
      z: { num: 99 },
      at: { num: 80 },
      z0: { num: 80 },
      z1: { num: 82 },
      min: { num: 20 },
    });
    expect(r.notes.map((n) => n.key)).not.toContain(THIN_KEY);
    expect(r.notes.map((n) => n.key)).not.toContain(SHIFTED_KEY);
    // Sans la broche, le recalage à 80 tient (couche de 20 mm sous l'assise).
    expect(stackedBounds(8, 260, 30, [100, 260], [99], [], 20).shifted).toEqual([
      { z: 99, at: 80, neighbour: 100, min: 20 },
    ]);
  });

  it("abandon au travers d'un perçage inchangé ; fusion à moins de 1 mm inchangée", () => {
    const pin = holeLevelsOf([footPin(56, 12)], CLEARANCE);
    const res = resolveImposedLevels(8, 160, [160], [60], pin, 20);
    expect(res.dropped).toEqual([
      { reason: "hole", z: 60, mark: "AP1", holeZ: 56, min: pin[0]!.r },
    ]);
    expect(res.shifted).toEqual([]);
    const { r } = buildFlat(flatShape(8, [160], [60]), 75, 20, [footPin(56, 12)]);
    expect(r.notes.map((n) => n.key)).toContain(HOLE_KEY);
    expect(r.notes.map((n) => n.key)).not.toContain(THIN_KEY);
    expect(r.notes.map((n) => n.key)).not.toContain(SHIFTED_KEY);
    // Fusion silencieuse avec l'assise ou la base (garde technique de 1 mm), même avec un minimum.
    expect(resolveImposedLevels(8, 160, [160], [159.5, 8.4], [], 20)).toEqual({
      levels: [160],
      imposed: [],
      dropped: [],
      shifted: [],
    });
  });
});

describe("épaisseur minimale de couche au joint imposé (A39 (d), A40 (c)) : propriétés", () => {
  it("couches au moins au minimum contre un joint retenu ou recalé ; recalage d'au plus le minimum ; oracle = empilement ; minimum nul = A38", () => {
    // Abandons « thin » posés par le partage d'un intervalle (pas par l'écart au niveau voisin),
    // dont ceux d'une couche qui ne touche pas le niveau (broche sous le niveau, A39 (d)), et
    // recalages contre un niveau fixe (A40 (c) ; ceux du partage : propriété suivante).
    let thinFromShare = 0;
    let thinApart = 0;
    let shiftedFixed = 0;
    fc.assert(
      fc.property(
        fc.record({
          seat: fc.integer({ min: 60, max: 260 }),
          rise: fc.integer({ min: 120, max: 200 }),
          tMax: fc.integer({ min: 20, max: 80 }),
          d: fc.integer({ min: 10, max: 16 }),
          pinFrac: fc.double({ min: 0.2, max: 0.6, noNaN: true }),
          // Niveau quelconque, ou juste sous l'assise (recalage contre un niveau fixe, A40 (c)).
          frac: fc.oneof(
            fc.double({ min: 0.001, max: 1.3, noNaN: true }),
            fc.double({ min: 0.85, max: 0.999, noNaN: true }),
          ),
          withPin: fc.boolean(),
          // Broche sous le niveau imposé (cas réel : broches de l'âme sous son joint), dans
          // l'intervalle de l'assise, ou juste au-dessus du niveau (recalage au partage, A40 (c)).
          pinAt: fc.constantFrom("below" as const, "seat" as const, "above" as const),
          pinGap: fc.integer({ min: 4, max: 40 }),
          minLayer: fc.integer({ min: 0, max: 60 }),
        }),
        (c) => {
          const base = 8;
          const seats = [c.seat, c.seat + c.rise];
          const zTop = seats[1]!;
          const level = base + c.frac * (c.seat - base);
          const pinTop = c.pinAt === "below" ? Math.min(level, c.seat) : c.seat;
          const pinZ =
            c.pinAt === "above" && level + c.pinGap < c.seat
              ? level + c.pinGap
              : base + c.pinFrac * (pinTop - base);
          const holes = c.withPin ? [footPin(pinZ, c.d)] : [];
          const hl = holeLevelsOf(holes, CLEARANCE);
          const sb = stackedBounds(base, zTop, c.tMax, seats, [level], hl, c.minLayer);
          const levels = [sb.bounds[0]!.z0, ...sb.bounds.map((x) => x.z1)];
          const isSeat = seats.some((st) => Math.abs(st - level) < 1);
          const dropped = sb.dropped.length > 0;
          const sh = sb.shifted[0];
          // (b) Recalage : z − min ≤ at < z, at = voisin − min, at est un joint ; un seul niveau.
          expect(sb.shifted.length).toBeLessThanOrEqual(1);
          if (sh) {
            expect(sh.z).toBe(level);
            expect(sh.min).toBe(c.minLayer);
            expect(sh.at).toBeLessThan(level);
            expect(sh.at).toBeGreaterThanOrEqual(level - c.minLayer - 1e-9);
            expect(sh.at).toBeCloseTo(sh.neighbour - c.minLayer, 9);
            expect(near(levels, sh.at, 1e-9)).toBe(true);
            if (seats.includes(sh.neighbour) || sh.neighbour === zTop) shiftedFixed++;
          }
          // (c) Jamais à la fois abandonné et recalé.
          expect(dropped && sh !== undefined).toBe(false);
          // (a) Niveau imposé retenu ou recalé (altitude retenue L) : toute couche qui le touche a
          // au moins le minimum ; entre les niveaux qui l'encadrent, aucune couche plus mince que
          // le minimum et que la plus mince du même empilement sans ce niveau.
          if (!dropped && !isSeat && level - base >= 1 && level <= zTop) {
            const L = sh ? sh.at : level;
            const lo = L < c.seat ? base : c.seat;
            const hi = L < c.seat ? c.seat : Infinity;
            const within = (x: { z0: Mm; z1: Mm }): boolean => x.z0 > lo - 1e-6 && x.z1 < hi + 1e-6;
            const without = stackedBounds(base, zTop, c.tMax, seats, [], hl, c.minLayer);
            const floor = Math.min(...without.bounds.filter(within).map((x) => x.z1 - x.z0));
            expect(near(levels, L, 1e-6)).toBe(true);
            for (const x of sb.bounds) {
              if (Math.abs(x.z0 - L) < 1e-6 || Math.abs(x.z1 - L) < 1e-6) {
                expect(x.z1 - x.z0).toBeGreaterThanOrEqual(c.minLayer - 1e-9);
              }
              if (within(x)) {
                expect(x.z1 - x.z0).toBeGreaterThanOrEqual(Math.min(c.minLayer, floor) - 1e-9);
              }
            }
          }
          // Un niveau abandonné n'est pas une borne, sauf s'il coïncide avec une assise ou avec un
          // joint du même empilement sans lui (partage autour d'une broche, cas limite A39 (d)).
          const bare = stackedBounds(base, zTop, c.tMax, seats, [], hl, c.minLayer).bounds;
          const bareLevels = bare.length > 0 ? [bare[0]!.z0, ...bare.map((x) => x.z1)] : [];
          for (const dd of sb.dropped) {
            expect(dd.z).toBe(level);
            if (!seats.some((st) => Math.abs(st - dd.z) < 1e-9) && !near(bareLevels, dd.z, 1e-9)) {
              expect(near(levels, dd.z, 1e-9)).toBe(false);
            }
            if (dd.reason === "thin") {
              expect(dd.min).toBe(c.minLayer);
              expect(dd.thickness).toBeLessThan(c.minLayer);
              expect(dd.z1 - dd.z0).toBeCloseTo(dd.thickness, 9);
              // Altitude recalée essayée (couche du joint recalé) : sous le voulu, d'au plus le
              // minimum.
              if (dd.at !== undefined) {
                expect(dd.at).toBeLessThan(level);
                expect(dd.at).toBeGreaterThanOrEqual(level - c.minLayer - 1e-9);
              }
              const res = resolveImposedLevels(base, zTop, seats, [level], hl, c.minLayer, c.tMax);
              if (res.imposed.length) {
                thinFromShare++;
                const L = res.imposed[0]!;
                if (Math.abs(dd.z0 - L) > 1e-6 && Math.abs(dd.z1 - L) > 1e-6) thinApart++;
              }
            }
          }
          // (d) Minimum nul : aucun recalage, identique à l'appel sans le paramètre (A38).
          if (c.minLayer === 0) {
            expect(sb.shifted).toEqual([]);
            expect(sb).toEqual(stackedBounds(base, zTop, c.tMax, seats, [level], hl));
            const res = resolveImposedLevels(base, zTop, seats, [level], hl);
            const lb = layerBounds(base, zTop, c.tMax, res.levels, 1000, hl);
            expect(sb.bounds).toEqual(lb.bounds);
          }
          // (g) Assises toujours des joints, couches ≤ t_max.
          for (const st of seats) expect(near(levels, st)).toBe(true);
          // (tolérance de 1e-6 : bornes calculées en flottants autour des broches).
          for (const x of sb.bounds) expect(x.z1 - x.z0).toBeLessThanOrEqual(c.tMax + 1e-6);
          // (e) Oracle des platines = bornes des couches ; aucune erreur ; une remarque par
          // abandon ; (h) remarque de recalage si et seulement si le niveau est recalé.
          const built = buildFlat(flatShape(base, seats, [level]), c.tMax, c.minLayer, holes);
          expect(built.r.errors).toEqual([]);
          expect(built.oracle).toEqual(levels);
          expect(built.levels).toEqual(levels);
          const notes = built.r.notes.filter(
            (n) => n.key === THIN_KEY || n.key === THIN_SHIFTED_KEY || n.key === HOLE_KEY,
          );
          expect(notes).toHaveLength(sb.dropped.length);
          // Remarque d'abandon après recalage si et seulement si l'altitude essayée est dite.
          expect(built.r.notes.filter((n) => n.key === THIN_SHIFTED_KEY)).toHaveLength(
            sb.dropped.filter((dd) => dd.reason === "thin" && dd.at !== undefined).length,
          );
          const shiftedNotes = built.r.notes.filter((n) => n.key === SHIFTED_KEY);
          expect(shiftedNotes).toHaveLength(sb.shifted.length);
          if (sh) {
            expect(shiftedNotes[0]!.params).toMatchObject({
              z: { num: r1(level) },
              at: { num: r1(sh.at) },
              neighbour: { num: r1(sh.neighbour) },
              min: { num: c.minLayer },
              wanted: { num: r1(level - base - CLEARANCE) },
              depth: { num: r1(sh.at - base - CLEARANCE) },
            });
            // (f) L'âme arrêtée au joint en dessous du voulu (oracle) s'arrête au joint recalé.
            const stop = jointBelow(built.oracle, level);
            expect(stop).toBeGreaterThanOrEqual(level - c.minLayer - 1e-6);
            expect(stop).toBeLessThanOrEqual(level);
          }
        },
      ),
      { numRuns: 300 },
    );
    // Le générateur atteint bien les abandons du partage et les recalages contre un niveau fixe.
    expect(thinFromShare).toBeGreaterThan(0);
    expect(thinApart).toBeGreaterThan(0);
    expect(shiftedFixed).toBeGreaterThan(0);
  });

  it("recalage au partage (broche juste au-dessus du niveau) : d'au plus le minimum, couches au minimum contre le joint, oracle = empilement", () => {
    let share = 0;
    fc.assert(
      fc.property(
        fc.record({
          seat: fc.integer({ min: 70, max: 200 }),
          tMax: fc.integer({ min: 20, max: 60 }),
          minLayer: fc.integer({ min: 8, max: 30 }),
          below: fc.integer({ min: 20, max: 80 }),
          pinGap: fc.integer({ min: 6, max: 24 }),
          d: fc.integer({ min: 10, max: 14 }),
        }),
        (c) => {
          const base = 8;
          const seats = [c.seat, c.seat + 160];
          const zTop = seats[1]!;
          const level = Math.max(base + 2, c.seat - c.below);
          const holes = level + c.pinGap < c.seat ? [footPin(level + c.pinGap, c.d)] : [];
          const hl = holeLevelsOf(holes, CLEARANCE);
          const sb = stackedBounds(base, zTop, c.tMax, seats, [level], hl, c.minLayer);
          const levels = [sb.bounds[0]!.z0, ...sb.bounds.map((x) => x.z1)];
          expect(sb.dropped.length + sb.shifted.length).toBeLessThanOrEqual(1);
          for (const sh of sb.shifted) {
            expect(sh.at).toBeLessThan(level);
            expect(sh.at).toBeGreaterThanOrEqual(level - c.minLayer - 1e-9);
            expect(sh.at).toBeCloseTo(sh.neighbour - c.minLayer, 9);
            expect(near(levels, sh.at, 1e-9)).toBe(true);
            for (const x of sb.bounds) {
              if (Math.abs(x.z0 - sh.at) < 1e-6 || Math.abs(x.z1 - sh.at) < 1e-6) {
                expect(x.z1 - x.z0).toBeGreaterThanOrEqual(c.minLayer - 1e-9);
              }
            }
            if (!seats.includes(sh.neighbour)) share++;
            const stop = jointBelow(levels, level);
            expect(stop).toBeCloseTo(sh.at, 9);
          }
          for (const x of sb.bounds) expect(x.z1 - x.z0).toBeLessThanOrEqual(c.tMax + 1e-6);
          const built = buildFlat(flatShape(base, seats, [level]), c.tMax, c.minLayer, holes);
          expect(built.r.errors).toEqual([]);
          expect(built.oracle).toEqual(levels);
          expect(built.r.notes.filter((n) => n.key === SHIFTED_KEY)).toHaveLength(
            sb.shifted.length,
          );
        },
      ),
      { numRuns: 200 },
    );
    expect(share).toBeGreaterThan(0);
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

describe("épaisseur minimale de couche au joint imposé (A39 (d), A40 (c)) : poutre", () => {
  it.each([
    [60, 69, 60],
    [80, 89, 73],
  ])(
    "quart tournant, âme de %i mm : joint de %i mm abandonné, plus de couche mince sous lui (âme AP1 de %i mm)",
    (webDepth, z, height) => {
      // Gardé, le joint faisait re-partager [8 ; z] autour des broches de l'âme (au milieu de
      // leur couche) en couches de 16,7 mm (webDepth 60) ou 15 mm (webDepth 80), absentes sans
      // lui : il est abandonné (relecture A39 (d)), l'âme s'arrête au joint en dessous. Toujours
      // vrai avec A40 (c) : ces couches sont sous le joint, aucun recalage vers le bas d'au plus
      // le minimum ne les épaissit (remarque d'abandon, aucune remarque de recalage).
      const { beam, params, wanted, layers } = beamWithWanted(
        stackedOnPlate(createProject("quarter-left"), webDepth),
      );
      expect(wanted).toBeCloseTo(z, 9);
      const note = beam.notes.find((n) => n.key === THIN_KEY);
      expect(note?.params).toMatchObject({ z: { num: z }, min: { num: 20 } });
      expect(near([...layers.map((l) => l.z0), ...layers.map((l) => l.z1)], z, 1e-6)).toBe(false);
      expect(beam.notes.map((n) => n.key)).not.toContain(SHIFTED_KEY);
      const below = layers.filter((l) => l.z1 <= 140 + 1e-6);
      expect(Math.min(...below.map((l) => l.z1 - l.z0))).toBeGreaterThanOrEqual(
        params.section.minLayerThickness - 1e-9,
      );
      // Âme AP1 : webDepth 80, arrêtée au joint de 82 en dessous (73 mm) ; webDepth 60, aucun
      // joint en dessous ne lui laisse deux pinces (joint suivant : la base) : profondeur voulue
      // gardée, logement fraisé (constat), comme le dit la remarque d'abandon.
      const m = buildModel(stackedOnPlate(createProject("quarter-left"), webDepth), {
        memo: false,
      });
      expect(m.errors).toEqual([]);
      expect(footWebHeight(m.parts)).toBeCloseTo(height, 6);
    },
  );
});

describe("épaisseur minimale de couche au joint imposé (A40 (c)) : abandon après recalage", () => {
  it.each([105, 120, 130])(
    "quart tournant, minimum de 30 mm, âme de %i mm : couche citée, celle du joint recalé à 110",
    (webDepth) => {
      // Joint voulu à 8 + webDepth + 1, à moins de 30 mm sous l'assise de 140 : recalé à 110
      // (140 − 30) par `resolveImposedLevels` ; le partage de [8 ; 110] autour des broches pose
      // un joint à 82, d'où une couche [82 ; 110] de 28 mm sous le niveau recalé : abandonné. La
      // remarque cite l'altitude recalée (la couche n'existe qu'avec elle), pas une couche d'un
      // joint à l'altitude voulue.
      const m = buildModel(stackedOnPlate(createProject("quarter-left"), webDepth, 30), {
        memo: false,
      });
      expect(m.errors).toEqual([]);
      const keys = (m.notes ?? []).map((n) => n.key);
      expect(keys).not.toContain(THIN_KEY);
      expect(keys).not.toContain(SHIFTED_KEY);
      expect(m.notes?.find((n) => n.key === THIN_SHIFTED_KEY)?.params).toMatchObject({
        z: { num: 8 + webDepth + 1 },
        at: { num: 110 },
        z0: { num: 82 },
        z1: { num: 110 },
        thickness: { num: 28 },
        min: { num: 30 },
      });
      expect(footWebHeight(m.parts)).toBeCloseTo(73, 6);
    },
  );
});

/** Hauteur de l'âme de pied AP1 (gabarit), mm ; NaN sans âme. */
const footWebHeight = (parts: ReturnType<typeof buildModel>["parts"]): number => {
  const web = parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID);
  const ys = web?.flat?.outline.outer.map((q) => q.y) ?? [];
  return ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : Number.NaN;
};

describe("épaisseur minimale de couche au joint imposé (A40 (c)) : quart tournant", () => {
  // Assise de M1 à 140 mm, platine de 8 mm, jeu de 1 mm, minimum de 20 mm : joint voulu à
  // 8 + webDepth + 1. 120 et 130 : à moins de 20 mm sous l'assise, recalé à 120 (âme de 111 mm,
  // A39 (d) : 73 mm) ; 140 et 150 : à moins de 20 mm au-dessus de l'assise, abandonné, l'âme
  // s'arrête à l'assise (131 mm) ; la hauteur ne décroît plus quand webDepth croît.
  it.each([
    [100, 100, null],
    [110, 110, null],
    [120, 111, SHIFTED_KEY],
    [130, 111, SHIFTED_KEY],
    [140, 131, THIN_KEY],
    [150, 131, THIN_KEY],
    [160, 160, null],
  ] as const)("webDepth %i : âme AP1 de %i mm (%s)", (webDepth, height, key) => {
    const m = buildModel(stackedOnPlate(createProject("quarter-left"), webDepth), { memo: false });
    expect(m.errors).toEqual([]);
    expect(footWebHeight(m.parts)).toBeCloseTo(height, 6);
    const keys: string[] = (m.notes ?? []).map((n) => n.key);
    for (const k of [SHIFTED_KEY, THIN_KEY, THIN_SHIFTED_KEY])
      expect(keys.includes(k)).toBe(k === key);
    if (key === SHIFTED_KEY) {
      expect(m.notes?.find((n) => n.key === SHIFTED_KEY)?.params).toMatchObject({
        at: { num: 120 },
        neighbour: { num: 140 },
        min: { num: 20 },
        wanted: { num: webDepth },
        depth: { num: 111 },
      });
    }
  });
});

describe("épaisseur minimale de couche au joint imposé (A39 (d), A40 (c)) : buildModel", () => {
  it("quart tournant ou hélicoïdal, couches empilées sur platine : aucune exception ni erreur, AP1 présente, jamais plus profonde que voulu", () => {
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
          // Jusqu'au-delà de toute épaisseur de couche (minimum > t_max : aucun recalage).
          minLayer: fc.oneof(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 61, max: 200 })),
          layerThickness: fc.oneof(fc.constant("auto" as const), fc.integer({ min: 5, max: 120 })),
        }),
        (c) => {
          const project = deepMerge(base(c.id), {
            stair: {
              structure: {
                kind: "wood-central",
                params: {
                  section: {
                    curvedMethod: "stacked",
                    minLayerThickness: c.minLayer,
                    layerThickness: c.layerThickness,
                  },
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
          // Joint imposé retenu ou recalé (ni abandonné, ni fusionné avec une assise ; un joint du
          // partage peut tomber au même niveau qu'un joint abandonné) : les couches qui le
          // touchent ont au moins le minimum (altitude recalée lue dans la remarque, au dixième).
          const { beam, wanted, layers } = beamWithWanted(project);
          const shifted = beam.notes.find((n) => n.key === SHIFTED_KEY);
          const at = shifted ? (shifted.params?.["at"] as { num: number }).num : wanted;
          const tol = shifted ? 0.051 : 1e-6;
          const kept =
            !beam.notes.some(
              (n) => n.key === THIN_KEY || n.key === THIN_SHIFTED_KEY || n.key === HOLE_KEY,
            ) && !beam.seats.some((st) => Math.abs(st.z - wanted) < 1 + 1e-9);
          // Âme AP1 jamais plus profonde que voulu ; au plus le minimum de moins si le joint est
          // recalé (A40 (c)).
          const h = footWebHeight(m.parts);
          if (Number.isFinite(h)) {
            expect(h).toBeLessThanOrEqual(c.webDepth + 1e-6);
            if (shifted) {
              expect(h).toBeGreaterThanOrEqual(c.webDepth - c.minLayer - 1e-6);
            }
          }
          for (const l of kept ? layers : []) {
            if (Math.abs(l.z0 - at) < tol || Math.abs(l.z1 - at) < tol) {
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
