/**
 * Pince axiale a1,CG des tire-fonds de marche mesurée le long du fil et boulons du sabot de pied
 * regroupés (QUESTIONS A36 (4), (10), décisions du 2026-10-09, conventions à valider) :
 * - tout tire-fond posé a le centre de gravité de sa partie filetée (milieu de l'ancrage) à
 *   `lagScrews.threadEndDistance` au moins, le long du fil, de la coupe au sol et des faces de
 *   cran, et un ancrage ≥ `minAnchorage` (propriété sur les préréglages droit, quart tournant,
 *   U et hélicoïdal, épaisseur de marche, largeur de poutre et ancrage tirés) ;
 * - les boulons du sabot de pied sont dans `anchors.footBoltZone` quand ils y tiennent, à
 *   l'entraxe a1 et à la pince a3,c du bois mesurée le long du fil ;
 * - l'exemple droit `j5c-limon-central-bois-droit` fixe M1 par ses deux tire-fonds, sans constat.
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

/** Distance le long du fil de la poutre d'un point du développement aux surfaces de bout. */
function alongGrain(beam: WoodCentralBeamResult, outer: readonly Vec2[], p: Vec2): number {
  return grainEndDistance(
    p,
    grainDirection(beam.lamination.method, beam.slope),
    outer,
    isBeamEndSide,
  );
}

describe("pince axiale a1,CG des tire-fonds le long du fil (A36 (4))", () => {
  it("propriété : tout tire-fond posé tient a1,CG le long du fil et l'ancrage minimal", () => {
    let lags = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESETS),
        fc.integer({ min: 30, max: 80 }),
        fc.integer({ min: 70, max: 240 }),
        fc.constantFrom("shoe", "embeddedPlate"),
        fc.oneof(fc.constant("auto" as const), fc.integer({ min: 40, max: 160 })),
        (id, thickness, width, kind, threadEndDistance) => {
          const ctx = contextFor(id, thickness);
          const params = woodCentralParams({
            section: { width },
            anchors: { kind },
            lagScrews: { threadEndDistance },
          });
          const { beam } = woodBeamOf(ctx, params);
          if (beam.seats.length === 0 || !beam.parts.some((p) => p.id === WOOD_CENTRAL_BEAM_ID))
            return;
          const lp = params.lagScrews;
          const sp = woodCentralBoltSpacing(params.bolts, PROFILE.fasteners, lp);
          const { outer } = outlineOf(beam);
          const floor = Math.min(...outer.map((q) => q.y));
          for (const s of beam.seats) {
            for (const o of s.bolts) {
              if (o.kind !== "lagScrew") continue;
              lags++;
              const anchorage = o.length - thickness;
              expect(anchorage).toBeGreaterThanOrEqual(lp.minAnchorage - 1e-9);
              const cg = V.vec(o.sigma, s.z - anchorage / 2);
              const d = alongGrain(beam, outer, cg);
              expect(
                d,
                `${id} ${kind} tm=${thickness} b=${width} M${s.tread}`,
              ).toBeGreaterThanOrEqual(sp.lag.threadEndDistance - 1e-6);
              // Couches empilées : coupe au sol parallèle au fil, rive a2,CG.
              if (beam.lamination.method === "stacked") {
                expect(cg.y - floor).toBeGreaterThanOrEqual(sp.lag.axial.a2CG - 1e-6);
              }
              // Pince latérale a3,c au bout avant de l'assise (A36 (4)).
              expect(o.sigma - s.sigma0).toBeGreaterThanOrEqual(sp.lag.frontEndDistance - 1e-6);
            }
          }
        },
      ),
      { numRuns: 30 },
    );
    expect(lags).toBeGreaterThan(0);
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

describe("exemple droit j5c-limon-central-bois-droit : M1 fixée par ses deux tire-fonds (A36 (10))", () => {
  const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, STRAIGHT_EXAMPLE), "utf8"));
  const ctx = woodCentralContext(project);
  const structure = project.stair.structure;
  const params = woodCentralParams(
    structure.kind === "wood-central" ? (structure.params as Record<string, unknown>) : {},
  );
  const { beam, checks } = woodBeamOf(ctx, params);

  it("boulons du sabot dans ses 100 premiers millimètres, tire-fonds de 130 mm au-delà, aucun constat de fixation sur M1", () => {
    expect(beam.anchorKind).toBe("shoe");
    const tm = project.stair.treads.thickness;
    expect(tm).toBe(80);
    const m1 = beam.seats[0]!;
    // Deux tire-fonds raccourcis à l'ancrage minimal (a1,CG le long du fil depuis la coupe au
    // sol : 150 mm laisseraient 90 mm, 130 mm en laissent ≈ 107).
    expect(m1.bolts.map((o) => [o.kind, o.length])).toEqual([
      ["lagScrew", 130],
      ["lagScrew", 130],
    ]);
    const { outer, holes, s0 } = outlineOf(beam);
    for (const o of m1.bolts) {
      const cg = V.vec(o.sigma, m1.z - (o.length - tm) / 2);
      expect(alongGrain(beam, outer, cg)).toBeGreaterThanOrEqual(100 - 1e-6);
    }
    expect(m1.bolts[0]!.sigma).toBeGreaterThan(115);
    expect(m1.bolts[0]!.sigma).toBeLessThan(130);
    expect(m1.bolts[1]!.sigma - m1.bolts[0]!.sigma).toBeGreaterThanOrEqual(70 - 1e-6);
    // Boulons SP1 (Ø13, M12) à ≈ 39 et 99 mm de la face avant (σ ≈ 49 et 109) : pince a3,c de
    // 48 mm le long du fil depuis la face avant, entraxe a1 de 60 mm, dans les 100 premiers
    // millimètres (`anchors.footBoltZone`).
    const sp1 = holes.filter((h) => h.x - s0 < 200).map((h) => h.x - m1.sigma0);
    expect(sp1).toHaveLength(2);
    expect(sp1[0]).toBeGreaterThan(35);
    expect(sp1[0]).toBeLessThan(60);
    expect(sp1[1]! - sp1[0]!).toBeCloseTo(60, 6);
    expect(sp1[1]).toBeLessThanOrEqual(params.anchors.footBoltZone + 1e-6);
    // Aucun constat FAB_LIMON_CENTRAL_BOIS_BOULONS sur M1 ni ailleurs.
    const bad = checks.results.filter((c) => c.ruleId === BOLTS_RULE && c.status === "violation");
    expect(bad.map((c) => fr(c.message))).toEqual([]);
    const spacing = checks.results.filter(
      (c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.spacing.id && c.status === "violation",
    );
    // Seul écart aux pinces : la pénétration de la partie filetée (50 mm pour 6·d = 60 mm,
    // EN 1995-1-1 § 8.7.2 (3) via [88]), constat sans retrait des tire-fonds (QUESTIONS A37 (1)).
    expect(spacing.map((c) => c.message.key)).toEqual([
      "structure.woodCentral.check.spacing.lagPenetration",
    ]);
    expect(spacing[0]!.location).toMatchObject({ treadNumber: 1 });
    const ok = checks.results.find((c) => c.ruleId === BOLTS_RULE)!;
    expect(EN.t(ok.message)).toMatch(/a1,CG/);
  });
});
