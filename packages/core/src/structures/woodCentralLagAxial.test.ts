/**
 * Pince axiale a1,CG des tire-fonds de marche mesurée le long du fil et boulons du sabot de pied
 * regroupés (QUESTIONS A36 (4), (10), décisions du 2026-10-09, conventions à valider) ; ancrage
 * minimal, partie filetée et bois autour d'un perçage (QUESTIONS A37 (1), (5), (17), décisions du
 * 2026-10-10) :
 * - tout tire-fond posé a une partie filetée (b = ⌊20 + L / 3⌋ côté pointe, ou saisie) pénétrant
 *   de 6·d au moins en `auto`, un ancrage ≥ la valeur saisie sinon ; le centre de gravité de la
 *   seule partie filetée comprise dans la poutre (pointe + p / 2) est à
 *   `lagScrews.threadEndDistance` au moins, le long du fil, de la coupe au sol et des faces de
 *   cran (a2,CG au-dessus de la coupe au sol en couches empilées) ; il s'écarte de chaque perçage
 *   horizontal de la poutre (`lagHoleClearance` avec `lagScrews.holeWood`) ou s'arrête au-dessus ;
 *   en `auto`, aucun constat de pénétration (propriété sur les préréglages droit, quart tournant,
 *   U et hélicoïdal, épaisseur de marche, largeur de poutre, ancrage et réglages tirés) ;
 * - les boulons du sabot de pied sont dans `anchors.footBoltZone` quand ils y tiennent, à
 *   l'entraxe a1 et à la pince a3,c du bois mesurée le long du fil ;
 * - l'exemple droit `j5c-limon-central-bois-droit` : M1 sans tire-fond faute de 6·d de partie
 *   filetée (A37 (1)), deux tire-fonds de 130 mm avec un ancrage minimal saisi à 50 mm.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { fr } from "../i18n.test-helpers.js";
import type { StructureContext } from "../model/plugins.js";
import type { Vec2 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { DEFAULT_WORKSHOP_PROFILE } from "../workshop/profile.js";
import { nominalDiameterFor } from "../fasteners/compute.js";
import { woodBeamOf, woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";
import {
  WOOD_CENTRAL_BEAM_ID,
  WOOD_CENTRAL_BEAM_RULES,
  type WoodCentralBeamResult,
} from "./woodCentralBeam.js";
import { WOOD_CENTRAL_SHOE_FOOT_ID } from "./woodCentralShoes.js";
import {
  ec5Spacing,
  grainDirection,
  grainEndDistance,
  isBeamEndSide,
  lagHoleClearance,
  lagThreadInBeam,
  woodCentralBoltSpacing,
} from "./woodSpacing.js";

const EN = translatorFor("en");
const PROFILE = DEFAULT_WORKSHOP_PROFILE;
const BOLTS_RULE = WOOD_CENTRAL_BEAM_RULES.bolts.id;
const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const STRAIGHT_EXAMPLE = "j5c-limon-central-bois-droit.blondel.json";

const PRESETS = ["straight", "quarter-left", "two-quarters-u", "helical"] as const;
type PresetId = (typeof PRESETS)[number];

const contexts = new Map<string, StructureContext>();
/** Contexte d'un préréglage à l'épaisseur de marche donnée (mis en cache). */
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

/** Développé de LC1 dans le repère (σ, z) de la trace : la face avant est à σ0 de M1. */
function outlineOf(beam: WoodCentralBeamResult) {
  const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
  const s0 = Math.min(...beam.seats.map((s) => s.sigma0));
  return {
    s0,
    outer: part.flat!.outline.outer.map((q) => V.vec(q.x + s0, q.y)),
    holes: part.flat!.outline.holes.map((h) => {
      const xs = h.map((q) => q.x);
      const ys = h.map((q) => q.y);
      return V.vec(
        (Math.min(...xs) + Math.max(...xs)) / 2 + s0,
        (Math.min(...ys) + Math.max(...ys)) / 2,
      );
    }),
  };
}

/**
 * Perçages horizontaux de la poutre (repère (σ, z) de la trace) : ceux de l'empilement en couches
 * empilées, sinon les trous du développé de LC1 (polygones réguliers inscrits : centre = moyenne
 * des sommets, diamètre = double du rayon).
 */
function beamHolesOf(
  beam: WoodCentralBeamResult,
): { sigma: number; z: number; diameter: number }[] {
  if (beam.stacked) return beam.stacked.holes.map((h) => ({ ...h }));
  const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
  const s0 = Math.min(...beam.seats.map((s) => s.sigma0));
  return part.flat!.outline.holes.map((h) => {
    const cx = h.reduce((t, q) => t + q.x, 0) / h.length;
    const cy = h.reduce((t, q) => t + q.y, 0) / h.length;
    const r = Math.max(...h.map((q) => Math.hypot(q.x - cx, q.y - cy)));
    return { sigma: cx + s0, z: cy, diameter: 2 * r };
  });
}

/** Distance le long du fil de la poutre d'un point du développement aux surfaces de bout. */
function alongGrain(beam: WoodCentralBeamResult, outer: readonly Vec2[], p: Vec2): number {
  return grainEndDistance(
    p,
    grainDirection(beam.lamination.method, beam.slope),
    outer,
    isBeamEndSide,
  );
}

describe("tire-fonds : partie filetée, a1,CG le long du fil, bois autour des perçages (A36 (4), A37 (1) (5) (17))", () => {
  it("propriété : tout tire-fond posé tient l'ancrage minimal, a1,CG (et a2,CG) de sa partie filetée et le bois autour des perçages", () => {
    let lags = 0;
    let autoRuns = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESETS),
        fc.integer({ min: 30, max: 80 }),
        fc.integer({ min: 70, max: 240 }),
        fc.constantFrom("shoe", "embeddedPlate"),
        fc.oneof(fc.constant("auto" as const), fc.integer({ min: 40, max: 160 })),
        fc.oneof(
          { arbitrary: fc.constant("auto" as const), weight: 3 },
          { arbitrary: fc.integer({ min: 40, max: 90 }), weight: 1 },
        ),
        fc.oneof(fc.constant("auto" as const), fc.integer({ min: 30, max: 120 })),
        fc.oneof(fc.constant("auto" as const), fc.integer({ min: 0, max: 12 })),
        (id, thickness, width, kind, threadEndDistance, minAnchorage, threadLength, holeWood) => {
          const ctx = contextFor(id, thickness);
          const params = woodCentralParams({
            section: { width },
            anchors: { kind },
            lagScrews: { threadEndDistance, minAnchorage, threadLength, holeWood },
          });
          const { beam, checks } = woodBeamOf(ctx, params);
          if (beam.seats.length === 0 || !beam.parts.some((p) => p.id === WOOD_CENTRAL_BEAM_ID))
            return;
          const lp = params.lagScrews;
          const sp = woodCentralBoltSpacing(params.bolts, PROFILE.fasteners, lp);
          const { outer } = outlineOf(beam);
          const floor = Math.min(...outer.map((q) => q.y));
          const holes = beamHolesOf(beam);
          if (minAnchorage === "auto") autoRuns++;
          for (const s of beam.seats) {
            for (const o of s.bolts) {
              if (o.kind !== "lagScrew") continue;
              lags++;
              const label = `${id} ${kind} tm=${thickness} b=${width} M${s.tread} L=${o.length}`;
              const anchorage = o.length - thickness;
              const tip = s.z - anchorage;
              const p = lagThreadInBeam(o.length, anchorage, sp.lag.threadLengthOf).penetration;
              // (a) Ancrage minimal : pénétration filetée ≥ 6·d en `auto`, ancrage ≥ valeur saisie.
              if (minAnchorage === "auto") expect(p, label).toBeGreaterThanOrEqual(6 * sp.d - 1e-9);
              else expect(anchorage, label).toBeGreaterThanOrEqual(minAnchorage - 1e-9);
              // (b) Centre de gravité de la seule partie filetée : pointe + p / 2.
              const cg = V.vec(o.sigma, tip + p / 2);
              expect(alongGrain(beam, outer, cg), label).toBeGreaterThanOrEqual(
                sp.lag.threadEndDistance - 1e-6,
              );
              // Couches empilées : coupe au sol parallèle au fil, rive a2,CG.
              if (beam.lamination.method === "stacked") {
                expect(cg.y - floor, label).toBeGreaterThanOrEqual(sp.lag.axial.a2CG - 1e-6);
              }
              // Pince latérale a3,c au bout avant de l'assise (A36 (4)).
              expect(o.sigma - s.sigma0).toBeGreaterThanOrEqual(sp.lag.frontEndDistance - 1e-6);
              // (c) Autour de chaque perçage horizontal : écart en plan, ou pointe au-dessus.
              for (const h of holes) {
                const g = lagHoleClearance(
                  h.diameter,
                  params.bolts.holeDiameter,
                  PROFILE.wood.clearance,
                  lp.tipCover,
                  { d: sp.d, thickness: sp.lag.holeWood },
                );
                const apart = Math.abs(o.sigma - h.sigma) >= g.half - 1e-6;
                const above = tip >= h.z + g.above - 1e-6;
                expect(apart || above, `${label} perçage σ=${h.sigma.toFixed(1)}`).toBe(true);
              }
            }
          }
          // (d) `auto` : aucun constat de pénétration de la partie filetée.
          if (minAnchorage === "auto") {
            expect(
              checks.results.filter(
                (c) => c.message.key === "structure.woodCentral.check.spacing.lagPenetration",
              ),
            ).toEqual([]);
          }
        },
      ),
      { numRuns: 40 },
    );
    expect(lags).toBeGreaterThan(0);
    expect(autoRuns).toBeGreaterThan(0);
  });
});

describe("boulons du sabot de pied regroupés (A36 (10))", () => {
  it("propriété : boulons dans footBoltZone quand ils y tiennent, entraxe a1 et pince a3,c le long du fil", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PresetId>("straight", "quarter-left"),
        fc.integer({ min: 30, max: 80 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 60, max: 200 }),
        fc.constantFrom(11, 13, 17),
        (id, thickness, bolts, zone, boltHoleDiameter) => {
          const ctx = contextFor(id, thickness);
          const params = woodCentralParams({
            anchors: { kind: "shoe", bolts, footBoltZone: zone, boltHoleDiameter },
          });
          const { beam } = woodBeamOf(ctx, params);
          const shoe = beam.parts.find((p) => p.id === WOOD_CENTRAL_SHOE_FOOT_ID);
          if (!shoe || beam.seats.length === 0) return;
          const an = params.anchors;
          const L = shoe.stock!.length;
          const { outer, holes, s0 } = outlineOf(beam);
          // Perçages du sabot de pied dans la poutre : abscisse depuis la face avant ≤ semelle.
          const ys = holes
            .filter((h) => h.x - s0 <= L + 1e-6)
            .map((h) => ({ y: h.x - s0, p: h }))
            .sort((a, b) => a.y - b.y);
          expect(ys).toHaveLength(bolts);
          const d = nominalDiameterFor(
            boltHoleDiameter,
            PROFILE.fasteners.nominalDiameters,
            PROFILE.fasteners.holeClearance,
          );
          const ec5 = ec5Spacing("bolt", d);
          const keys = beam.notes.map((n) => n.key);
          if (keys.includes("structure.woodCentral.note.shoeFootBoltsSpread")) return;
          // Pince de la tôle, pince a3,c du bois le long du fil, entraxe a1.
          expect(ys[0]!.y).toBeGreaterThanOrEqual(an.holeEdgeDistance - 1e-6);
          for (const h of ys) {
            expect(alongGrain(beam, outer, h.p)).toBeGreaterThanOrEqual(ec5.a3c - 1e-6);
          }
          for (let i = 1; i < ys.length; i++) {
            expect(ys[i]!.y - ys[i - 1]!.y).toBeCloseTo(ec5.a1, 6);
          }
          // Premier boulon au plus près de la face avant : 1 mm plus tôt, la pince manque.
          if (ys[0]!.y > an.holeEdgeDistance + 1e-6) {
            const before = V.vec(ys[0]!.p.x - 1, ys[0]!.p.y);
            expect(alongGrain(beam, outer, before)).toBeLessThan(ec5.a3c);
          }
          // Dans la zone, sinon remarque (entraxes gardés).
          if (ys[ys.length - 1]!.y > zone + 1e-6) {
            expect(keys).toContain("structure.woodCentral.note.shoeFootBoltsBeyondZone");
          } else {
            expect(keys).not.toContain("structure.woodCentral.note.shoeFootBoltsBeyondZone");
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("sabot de tête inchangé : boulons répartis à la pince des perçages sur sa hauteur", () => {
    const ctx = contextFor("straight", 80);
    const params = woodCentralParams({ anchors: { kind: "shoe" } });
    const { beam } = woodBeamOf(ctx, params);
    const head = beam.parts.find((p) => p.id === "wood-central-shoe-head")!;
    const ys = head
      .flat!.outline.holes.map(
        (h) => (Math.min(...h.map((q) => q.y)) + Math.max(...h.map((q) => q.y))) / 2,
      )
      .filter((y, i, a) => a.indexOf(y) === i)
      .sort((a, b) => a - b);
    const Y = head.stock!.length;
    expect(ys[0]).toBeCloseTo(params.anchors.holeEdgeDistance, 6);
    expect(ys[ys.length - 1]).toBeCloseTo(
      Math.max(...head.flat!.outline.outer.map((q) => q.y)) - params.anchors.holeEdgeDistance,
      6,
    );
    expect(Y).toBeGreaterThan(0);
  });
});

describe("exemple droit j5c-limon-central-bois-droit : M1 et l'ancrage minimal de 6·d (A36 (10), A37 (1))", () => {
  const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, STRAIGHT_EXAMPLE), "utf8"));
  const ctx = woodCentralContext(project);
  const structure = project.stair.structure;
  const raw =
    structure.kind === "wood-central" ? (structure.params as Record<string, unknown>) : {};
  const tm = project.stair.treads.thickness;

  it("boulons du sabot dans ses 100 premiers millimètres ; M1 sans tire-fond, faute de 6·d de partie filetée (A37 (1) (5))", () => {
    const params = woodCentralParams(raw);
    const { beam, checks } = woodBeamOf(ctx, params);
    expect(beam.anchorKind).toBe("shoe");
    expect(tm).toBe(80);
    const sp = woodCentralBoltSpacing(params.bolts, PROFILE.fasteners, params.lagScrews);
    expect(sp.lag.minAnchorageAuto).toBe(true);
    expect(sp.lag.minAnchorage).toBe(60);
    const m1 = beam.seats[0]!;
    // Écart voulu (QUESTIONS A37 (1), décision du 2026-10-10) : un tire-fond de 140 mm (b = 66,
    // ancrage 60, centre de gravité de la partie filetée à 30 mm sous l'assise) laisse 99 mm le
    // long du fil jusqu'à la coupe au sol pour a1,CG = 100 mm ; raccourci à 130 mm, sa partie
    // filetée ne pénètre que de 50 mm < 6·d = 60 mm : M1 perd ses deux tire-fonds.
    expect(m1.bolts).toEqual([]);
    const { outer, holes, s0 } = outlineOf(beam);
    expect(lagThreadInBeam(140, 140 - tm, sp.lag.threadLengthOf)).toEqual({
      penetration: 60,
      cgDepth: 30,
    });
    expect(lagThreadInBeam(130, 130 - tm, sp.lag.threadLengthOf).penetration).toBe(50);
    // Boulons SP1 (Ø13, M12) à ≈ 39 et 99 mm de la face avant (σ ≈ 49 et 109) : pince a3,c de
    // 48 mm le long du fil depuis la face avant, entraxe a1 de 60 mm, dans les 100 premiers
    // millimètres (`anchors.footBoltZone`).
    const sp1 = holes.filter((h) => h.x - s0 < 200).map((h) => h.x - m1.sigma0);
    expect(sp1).toHaveLength(2);
    expect(sp1[0]).toBeGreaterThan(35);
    expect(sp1[0]).toBeLessThan(60);
    expect(sp1[1]! - sp1[0]!).toBeCloseTo(60, 6);
    expect(sp1[1]).toBeLessThanOrEqual(params.anchors.footBoltZone + 1e-6);
    // Avertissement FAB_LIMON_CENTRAL_BOIS_BOULONS sur M1 seule, message des tire-fonds
    // raccourcis jusqu'à 6·d de partie filetée.
    const bad = checks.results.filter((c) => c.ruleId === BOLTS_RULE && c.status === "violation");
    expect(bad.map((c) => [c.location, c.message.key])).toEqual([
      [
        expect.objectContaining({ treadNumber: 1 }),
        "structure.woodCentral.check.fixings.missingLagThreadAuto",
      ],
    ]);
    expect(fr(bad[0]!.message)).toMatch(/partie filetée pénètre de 60 mm au moins, 6·d pour Ø10/);
    expect(EN.t(bad[0]!.message)).toMatch(/a1,CG/);
    // Plus aucun écart aux pinces, ni constat de pénétration.
    const spacing = checks.results.filter(
      (c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.spacing.id && c.status === "violation",
    );
    expect(spacing).toEqual([]);
    // M2 : tire-fonds de 140 et 160 mm, partie filetée ≥ 6·d, a1,CG tenue.
    const m2 = beam.seats[1]!;
    expect(m2.bolts.map((o) => [o.kind, o.length])).toEqual([
      ["lagScrew", 140],
      ["lagScrew", 160],
    ]);
    for (const o of m2.bolts) {
      const inBeam = lagThreadInBeam(o.length, o.length - tm, sp.lag.threadLengthOf);
      expect(inBeam.penetration).toBeGreaterThanOrEqual(60);
      const cg = V.vec(o.sigma, m2.z - inBeam.cgDepth);
      expect(alongGrain(beam, outer, cg)).toBeGreaterThanOrEqual(100 - 1e-6);
    }
  });

  it("ancrage minimal saisi à 50 mm (rétrocompatibilité) : M1 garde deux tire-fonds de 130 mm, constat de pénétration", () => {
    const lagScrews = { ...((raw["lagScrews"] as object | undefined) ?? {}), minAnchorage: 50 };
    const params = woodCentralParams({ ...raw, lagScrews });
    const { beam, checks } = woodBeamOf(ctx, params);
    const m1 = beam.seats[0]!;
    expect(m1.bolts.map((o) => [o.kind, o.length])).toEqual([
      ["lagScrew", 130],
      ["lagScrew", 130],
    ]);
    const { outer } = outlineOf(beam);
    const sp = woodCentralBoltSpacing(params.bolts, PROFILE.fasteners, params.lagScrews);
    for (const o of m1.bolts) {
      // Partie filetée b = 63 > ancrage 50 : CG au milieu de l'ancrage, a1,CG tenue.
      const inBeam = lagThreadInBeam(o.length, o.length - tm, sp.lag.threadLengthOf);
      expect(inBeam).toEqual({ penetration: 50, cgDepth: 25 });
      expect(alongGrain(beam, outer, V.vec(o.sigma, m1.z - 25))).toBeGreaterThanOrEqual(100 - 1e-6);
    }
    // Bois de 0,5·d entre filet et perçage SP1 (A37 (17)) : le premier tire-fond s'écarte du
    // boulon à σ ≈ 109 de 6,5 + 5 + 5 = 16,5 mm au moins (13 mm, jeu géométrique seul, avant).
    expect(m1.bolts[0]!.sigma).toBeGreaterThan(125);
    expect(m1.bolts[0]!.sigma).toBeLessThan(130);
    expect(
      checks.results.filter((c) => c.ruleId === BOLTS_RULE && c.status === "violation"),
    ).toEqual([]);
    const spacing = checks.results.filter(
      (c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.spacing.id && c.status === "violation",
    );
    expect(spacing.map((c) => c.message.key)).toEqual([
      "structure.woodCentral.check.spacing.lagPenetration",
    ]);
    expect(spacing[0]!.location).toMatchObject({ treadNumber: 1 });
    expect(spacing[0]!.measured).toBeCloseTo(50, 6);
    const ok = checks.results.find((c) => c.ruleId === BOLTS_RULE)!;
    expect(EN.t(ok.message)).toMatch(/a1,CG/);
  });
});
