/**
 * Pince axiale a1,CG des tire-fonds de marche mesurée le long du fil et boulons du sabot de pied
 * regroupés (QUESTIONS A36 (4), (10), décisions du 2026-10-09, conventions à valider) ; ancrage
 * minimal, partie filetée et bois autour d'un perçage (QUESTIONS A37 (1), (5), (17), décisions du
 * 2026-10-10) :
 * - tout tire-fond posé a une partie filetée (b = ⌊20 + L / 3⌋ côté pointe, ou saisie) pénétrant
 *   de 6·d au moins en `auto`, de la valeur saisie sinon (une valeur saisie porte aussi sur la
 *   partie filetée, QUESTIONS A38 (14), décision du 2026-10-11) ; le centre de gravité de la
 *   seule partie filetée comprise dans la poutre (pointe + p / 2) est à
 *   `lagScrews.threadEndDistance` au moins, le long du fil, de la coupe au sol et des faces de
 *   cran (a2,CG au-dessus de la coupe au sol en couches empilées) ; il s'écarte de chaque perçage
 *   horizontal de la poutre (`lagHoleClearance` avec `lagScrews.holeWood`) ou s'arrête au-dessus ;
 *   aucun constat de pénétration (propriété sur les préréglages droit, quart tournant, U et
 *   hélicoïdal, épaisseur de marche, largeur de poutre, ancrage et réglages tirés) ;
 * - l'ancrage total `lagScrews.minTotalAnchorage` = N (cible de la migration des projets
 *   antérieurs à A38) redonne exactement les tire-fonds d'avant A38 avec `minAnchorage` = N
 *   (table de référence calculée avec le code d'avant A38) ;
 * - les boulons du sabot de pied sont dans `anchors.footBoltZone` quand ils y tiennent, à
 *   l'entraxe a1 et à la pince a3,c du bois mesurée le long du fil ;
 * - l'exemple droit `j5c-limon-central-bois-droit` : M1 sans tire-fond faute de 6·d de partie
 *   filetée (A37 (1)), deux tire-fonds de 130 mm avec une pénétration saisie de 50 mm (sans
 *   constat) ou un ancrage total de 50 mm (constat de pénétration, comme avant A38).
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
  lagAnchorageHolds,
  lagHoleClearance,
  lagRequired,
  lagRetained,
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
              // (a) Ancrage minimal : pénétration filetée ≥ 6·d en `auto`, ≥ valeur saisie sinon
              // (une valeur saisie porte sur la partie filetée, QUESTIONS A38 (14)).
              const min = minAnchorage === "auto" ? 6 * sp.d : minAnchorage;
              expect(p, label).toBeGreaterThanOrEqual(min - 1e-9);
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
          // (d) Mode `thread` (`auto` ou saisi) : aucun constat de pénétration de la partie
          // filetée, tenue par construction (A38 (14)).
          expect(
            checks.results.filter((c) =>
              c.message.key.startsWith("structure.woodCentral.check.spacing.lagPenetration"),
            ),
          ).toEqual([]);
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

  it("pénétration filetée saisie à 50 mm (A38 (14)) : M1 garde deux tire-fonds de 130 mm, sans constat de pénétration", () => {
    // Écart voulu (QUESTIONS A38 (14), décision du 2026-10-11) : la valeur saisie porte sur la
    // partie filetée ; à 130 mm, elle pénètre de 50 mm : tenue, sans constat (avant A38 : la
    // valeur portait sur l'ancrage total, constat de pénétration sous 6·d).
    const lagScrews = { ...((raw["lagScrews"] as object | undefined) ?? {}), minAnchorage: 50 };
    const params = woodCentralParams({ ...raw, lagScrews });
    const { beam, checks } = woodBeamOf(ctx, params);
    expect(beam.seats[0]!.bolts.map((o) => [o.kind, o.length])).toEqual([
      ["lagScrew", 130],
      ["lagScrew", 130],
    ]);
    expect(
      checks.results.filter((c) => c.ruleId === BOLTS_RULE && c.status === "violation"),
    ).toEqual([]);
    expect(
      checks.results.filter(
        (c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.spacing.id && c.status === "violation",
      ),
    ).toEqual([]);
    const note = beam.notes.find(
      (n) => n.key === "structure.woodCentral.note.lagScrewsThreadEnteredMin",
    )!;
    expect(fr(note)).toMatch(/partie filetée pénétrant de 50 mm au moins/);
  });

  it("ancrage total de 50 mm (mode hérité d'avant A38) : M1 garde deux tire-fonds de 130 mm, constat de pénétration", () => {
    const lagScrews = {
      ...((raw["lagScrews"] as object | undefined) ?? {}),
      minTotalAnchorage: 50,
    };
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
      "structure.woodCentral.check.spacing.lagPenetrationTotal",
    ]);
    expect(spacing[0]!.location).toMatchObject({ treadNumber: 1 });
    expect(spacing[0]!.measured).toBeCloseTo(50, 6);
    expect(spacing[0]!.min).toBeCloseTo(60, 6);
    expect(fr(spacing[0]!.message)).toMatch(/lagScrews\.minTotalAnchorage/);
    expect(EN.t(spacing[0]!.message)).toMatch(/minimum total anchorage/);
    const ok = checks.results.find((c) => c.ruleId === BOLTS_RULE)!;
    expect(EN.t(ok.message)).toMatch(/a1,CG/);
  });
});

/**
 * Référence d'avant A38 (QUESTIONS A38 (14)) : organes des quatre premières assises
 * (`<nature><longueur>@<σ>`), constats de pénétration (marche, mesure) et assises incomplètes
 * (marche, organes posés), calculés avec le code d'avant A38 (commit c9ff9f3, `minAnchorage` = N
 * saisi, ancrage total sous la marche) sur l'escalier droit par défaut et l'exemple droit, sabot
 * en U (ni âme de platine ni couches empilées : A38 (6) (8) (12) sans effet), épaisseur de marche
 * tm et N tirés. Le mode `total` (`minTotalAnchorage` = N, cible de la migration) doit les
 * redonner exactement.
 */
const LEGACY: Record<
  string,
  {
    readonly organs: readonly (readonly string[])[];
    readonly pen: readonly (readonly [number, number])[];
    readonly missing: readonly (readonly [number, number])[];
  }
> = {
  "straight/40/30": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b320@530.000"],
      ["b450@610.000", "b320@800.000"],
      ["b450@880.000", "b320@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/40/50": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b320@530.000"],
      ["b450@610.000", "b320@800.000"],
      ["b450@880.000", "b320@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/40/70": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b320@530.000"],
      ["b450@610.000", "b320@800.000"],
      ["b450@880.000", "b320@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/40/90": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b320@530.000"],
      ["b450@610.000", "b320@800.000"],
      ["b450@880.000", "b320@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/60/30": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b340@530.000"],
      ["b470@610.000", "b340@800.000"],
      ["b470@880.000", "b340@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/60/50": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b340@530.000"],
      ["b470@610.000", "b340@800.000"],
      ["b470@880.000", "b340@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/60/70": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b340@530.000"],
      ["b470@610.000", "b340@800.000"],
      ["b470@880.000", "b340@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/60/90": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "b340@530.000"],
      ["b470@610.000", "b340@800.000"],
      ["b470@880.000", "b340@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/80/30": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "l160@530.000"],
      ["b490@610.000", "b360@800.000"],
      ["b490@880.000", "b360@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/80/50": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "l160@530.000"],
      ["b490@610.000", "b360@800.000"],
      ["b490@880.000", "b360@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/80/70": {
    organs: [
      ["l150@146.438", "l150@260.000"],
      ["l160@383.205", "l160@530.000"],
      ["b490@610.000", "b360@800.000"],
      ["b490@880.000", "b360@1070.000"],
    ],
    pen: [],
    missing: [],
  },
  "straight/80/90": {
    organs: [[], [], ["b490@610.000", "b360@800.000"], ["b490@880.000", "b360@1070.000"]],
    pen: [],
    missing: [
      [1, 0],
      [2, 0],
    ],
  },
  "j5c-droit/40/30": {
    organs: [
      ["l140@125.570", "l140@197.857"],
      ["l140@319.252", "b330@440.714"],
      ["b440@520.714", "b330@683.571"],
      ["b440@763.571", "b330@926.429"],
    ],
    pen: [],
    missing: [],
  },
  "j5c-droit/40/50": {
    organs: [
      ["l140@125.570", "l140@197.857"],
      ["l140@319.252", "b330@440.714"],
      ["b440@520.714", "b330@683.571"],
      ["b440@763.571", "b330@926.429"],
    ],
    pen: [],
    missing: [],
  },
  "j5c-droit/40/70": {
    organs: [
      ["l140@125.570", "l140@197.857"],
      ["l140@319.252", "b330@440.714"],
      ["b440@520.714", "b330@683.571"],
      ["b440@763.571", "b330@926.429"],
    ],
    pen: [],
    missing: [],
  },
  "j5c-droit/40/90": {
    organs: [
      ["l140@125.570", "l140@197.857"],
      ["l140@319.252", "b330@440.714"],
      ["b440@520.714", "b330@683.571"],
      ["b440@763.571", "b330@926.429"],
    ],
    pen: [],
    missing: [],
  },
  "j5c-droit/60/30": {
    organs: [
      ["l140@125.570", "l140@197.857"],
      ["l140@319.252", "l160@440.714"],
      ["b460@520.714", "b350@683.571"],
      ["b460@763.571", "b350@926.429"],
    ],
    pen: [],
    missing: [],
  },
  "j5c-droit/60/50": {
    organs: [
      ["l140@125.570", "l140@197.857"],
      ["l140@319.252", "l160@440.714"],
      ["b460@520.714", "b350@683.571"],
      ["b460@763.571", "b350@926.429"],
    ],
    pen: [],
    missing: [],
  },
  "j5c-droit/60/70": {
    organs: [
      ["l140@125.570", "l140@197.857"],
      ["l140@319.252", "l160@440.714"],
      ["b460@520.714", "b350@683.571"],
      ["b460@763.571", "b350@926.429"],
    ],
    pen: [],
    missing: [],
  },
  "j5c-droit/60/90": {
    organs: [
      [],
      ["l160@335.252", "l160@440.714"],
      ["b460@520.714", "b350@683.571"],
      ["b460@763.571", "b350@926.429"],
    ],
    pen: [],
    missing: [[1, 0]],
  },
  "j5c-droit/80/30": {
    organs: [
      ["l130@125.570", "l130@197.857"],
      ["l140@319.252", "l160@440.714"],
      ["b480@520.714", "b370@683.571"],
      ["b480@763.571", "b370@926.429"],
    ],
    pen: [[1, 50]],
    missing: [],
  },
  "j5c-droit/80/50": {
    organs: [
      ["l130@125.570", "l130@197.857"],
      ["l140@319.252", "l160@440.714"],
      ["b480@520.714", "b370@683.571"],
      ["b480@763.571", "b370@926.429"],
    ],
    pen: [[1, 50]],
    missing: [],
  },
  "j5c-droit/80/70": {
    organs: [
      [],
      ["l160@335.252", "l160@440.714"],
      ["b480@520.714", "b370@683.571"],
      ["b480@763.571", "b370@926.429"],
    ],
    pen: [],
    missing: [[1, 0]],
  },
  "j5c-droit/80/90": {
    organs: [[], [], ["b480@520.714", "b370@683.571"], ["b480@763.571", "b370@926.429"]],
    pen: [],
    missing: [
      [1, 0],
      [2, 0],
    ],
  },
};

describe("ancrage total hérité `minTotalAnchorage` (QUESTIONS A38 (14))", () => {
  it("propriété : le prédicat d'ancrage du mode `total` est celui d'avant A38 (L − tm ≥ N)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 20, max: 100 }),
        fc.integer({ min: 0, max: 300 }),
        fc.oneof(fc.constant("auto" as const), fc.integer({ min: 20, max: 120 })),
        (n, tm, length, minAnchorage) => {
          const lag = woodCentralBoltSpacing(
            { holeDiameter: 11, minSpacing: "auto", edgeDistance: "auto" },
            PROFILE.fasteners,
            { minSpacing: "auto", endDistance: "auto", minAnchorage, minTotalAnchorage: n },
          ).lag;
          expect(lag.anchorageMode).toBe("total");
          expect(lagRequired(lag)).toBe(n);
          // Logique de référence d'avant A38 (valeur saisie = ancrage sous la marche).
          const anchorage = Math.max(0, length - tm);
          expect(lagRetained(lag, length, tm)).toBe(anchorage);
          expect(lagAnchorageHolds(lag, length, tm)).toBe(anchorage >= n - 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("propriété : avec `minTotalAnchorage` = N et `minAnchorage` auto, mêmes tire-fonds qu'avant A38 avec `minAnchorage` = N", () => {
    const example = parseProjectText(readFileSync(join(EXAMPLES_DIR, STRAIGHT_EXAMPLE), "utf8"));
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(LEGACY)), (key) => {
        const [src, tmText, nText] = key.split("/");
        const tm = Number(tmText);
        const n = Number(nText);
        const base = src === "straight" ? createProject("straight") : example;
        const project: Project = {
          ...base,
          stair: { ...base.stair, treads: { ...base.stair.treads, thickness: tm } },
        };
        const raw =
          src === "straight" || base.stair.structure.kind !== "wood-central"
            ? {}
            : (base.stair.structure.params as Record<string, unknown>);
        const params = woodCentralParams({
          ...raw,
          anchors: { kind: "shoe" },
          lagScrews: { minTotalAnchorage: n },
        });
        const { beam, checks } = woodBeamOf(woodCentralContext(project), params);
        const want = LEGACY[key]!;
        expect(
          beam.seats
            .slice(0, 4)
            .map((x) => x.bolts.map((o) => `${o.kind[0]}${o.length}@${o.sigma.toFixed(3)}`)),
          key,
        ).toEqual(want.organs);
        expect(
          checks.results
            .filter(
              (c) => c.message.key === "structure.woodCentral.check.spacing.lagPenetrationTotal",
            )
            .map((c) => [c.location?.kind === "part" ? c.location.treadNumber : null, c.measured]),
          key,
        ).toEqual(want.pen);
        expect(
          checks.results
            .filter((c) => c.ruleId === BOLTS_RULE && c.status === "violation")
            .map((c) => [c.location?.kind === "part" ? c.location.treadNumber : null, c.measured]),
          key,
        ).toEqual(want.missing);
      }),
      { numRuns: 24 },
    );
  });
});
