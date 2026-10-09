/**
 * Pied du limon central bois sur platine à âme noyée, intégration poutre + platine (QUESTIONS
 * A35 (a), (b), (e), décisions du 2026-10-09) : l'âme de pied prolongée le long de la trace rend
 * à la première marche la place de ses organes (boulons ou tire-fonds) sur les préréglages
 * droit, quart tournant, U, demi-tour et hélicoïdal ; propriété sur générateurs contraints
 * (épaisseur de marche, organes par marche, largeur de poutre) sous la garde « quand la
 * géométrie le permet ».
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { fr } from "../i18n.test-helpers.js";
import { createProject } from "../project/presets.js";
import type { StructureContext } from "../model/plugins.js";
import { DEFAULT_WORKSHOP_PROFILE } from "../workshop/profile.js";
import { WOOD_CENTRAL_BEAM_RULES } from "./woodCentralBeam.js";
import { woodBeamOf, woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";
import { WOOD_CENTRAL_PLATE_FOOT_ID, WOOD_CENTRAL_PLATE_FOOT_WEB_ID } from "./woodCentralPlates.js";
import { roundUpTo } from "./woodCentralShoes.js";
import { ec5EndDistance, woodCentralBoltSpacing } from "./woodSpacing.js";

const PRESETS = ["straight", "quarter-left", "two-quarters-u", "half-turn", "helical"] as const;
type PresetId = (typeof PRESETS)[number];
const PROFILE = DEFAULT_WORKSHOP_PROFILE;
const BOLTS_RULE = WOOD_CENTRAL_BEAM_RULES.bolts.id;

const contexts = new Map<string, StructureContext>();
/** Contexte d'un préréglage à l'épaisseur de marche donnée (mis en cache). */
function contextFor(id: PresetId, thickness?: number): StructureContext {
  const key = `${id}/${thickness ?? ""}`;
  let ctx = contexts.get(key);
  if (!ctx) {
    const p = createProject(id);
    const project: Project =
      thickness === undefined
        ? p
        : { ...p, stair: { ...p.stair, treads: { ...p.stair.treads, thickness } } };
    ctx = woodCentralContext(project);
    contexts.set(key, ctx);
  }
  return ctx;
}

function run(id: PresetId, over: Record<string, unknown> = {}, thickness?: number) {
  const ctx = contextFor(id, thickness);
  const params = woodCentralParams({
    ...over,
    anchors: { kind: "embeddedPlate", ...((over.anchors as object | undefined) ?? {}) },
  });
  return { ctx, params, ...woodBeamOf(ctx, params) };
}

/** Constats `FAB_LIMON_CENTRAL_BOIS_BOULONS` en violation visant la marche `tread`. */
const boltIssuesOn = (checks: ReturnType<typeof woodBeamOf>["checks"], tread: number) =>
  checks.results.filter(
    (r) =>
      r.ruleId === BOLTS_RULE &&
      r.status === "violation" &&
      r.location?.kind === "part" &&
      r.location.treadNumber === tread,
  );

describe("pied sur platine à âme noyée : âme prolongée, M1 fixée (A35 (a))", () => {
  it.each(PRESETS)("%s : M1 reçoit ses organes, âme prolongée et broches hors de M1", (id) => {
    const { beam, checks, params, ctx } = run(id);
    expect(beam.errors).toEqual([]);
    const web = beam.parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID)!;
    const plate = beam.parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_ID)!;
    expect(web).toBeDefined();
    expect(plate).toBeDefined();
    // Âme prolongée : plus longue que l'âme centrée d'autrefois (`webLength`).
    expect(beam.footWebLength).toBeGreaterThan(params.anchors.plate.webLength);
    // Platine couvrant l'âme.
    expect(plate.stock!.length).toBeGreaterThanOrEqual(beam.footWebLength! - 1e-6);
    const m1 = beam.seats[0]!;
    expect(m1.tread).toBe(ctx.stepping.treads[0]!.number);
    expect(m1.bolts).toHaveLength(params.bolts.perTread);
    expect(boltIssuesOn(checks, m1.tread)).toEqual([]);
    // Broches : deux, posées au-delà de la zone des organes de M1.
    expect(web.flat!.outline.holes).toHaveLength(params.anchors.plate.pins);
  });

  it.each(["quarter-left", "two-quarters-u"] as const)(
    "%s à poutre cintrée sur moule : M1 fixée, broches à a3,c au moins de la coupe au sol",
    (id) => {
      const { beam, checks, params } = run(id, { section: { curvedMethod: "mould" } });
      expect(beam.curvedMethod).toBe("mould");
      expect(beam.seats[0]!.bolts).toHaveLength(2);
      expect(boltIssuesOn(checks, beam.seats[0]!.tread)).toEqual([]);
      // Contour de l'âme : y = 0 au dessus de la platine (coupe au sol) ; centre d'un perçage
      // = moyenne de ses sommets.
      const web = beam.parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID)!;
      const holes = web.flat!.outline.holes;
      expect(holes).toHaveLength(params.anchors.plate.pins);
      const a3c = ec5EndDistance("dowel", params.anchors.plate.pinDiameter, "unloaded");
      for (const h of holes) {
        const y = h.reduce((t, p) => t + p.y, 0) / h.length;
        expect(y).toBeGreaterThanOrEqual(a3c - 1e-6);
      }
    },
  );

  it("escalier droit sur sabot en U (ancrage par défaut) : M1 reçoit ses deux organes", () => {
    // Relecture A35 : autour d'un perçage horizontal (boulon de sabot), un tire-fond ne garde
    // que le jeu géométrique (`lagHoleClearance`, QUESTIONS A36 (10)).
    const ctx = contextFor("straight");
    const params = woodCentralParams({});
    const { beam, checks } = woodBeamOf(ctx, params);
    expect(beam.anchorKind).toBe("shoe");
    expect(beam.seats[0]!.bolts).toHaveLength(params.bolts.perTread);
    expect(boltIssuesOn(checks, beam.seats[0]!.tread)).toEqual([]);
  });
});

describe("assise trop courte pour les tire-fonds (A35 (l), QUESTIONS A36 (11))", () => {
  it("U, poutre de 220 mm : M3 à un organe, constat avec les deux pinces des tire-fonds", () => {
    // M3 chevauche la limite de l'écrou : son premier organe ne peut être qu'un tire-fond, et
    // les règles des tire-fonds (100 + 70 + 40 = 210 mm) ne tiennent pas dans son assise.
    const { checks } = run("two-quarters-u", { section: { width: 220 } });
    const m3 = boltIssuesOn(checks, 3);
    expect(m3).toHaveLength(1);
    expect(m3[0]!.message.key).toBe("structure.woodCentral.check.fixings.missingLag");
    expect(fr(m3[0]!.message)).toMatch(
      /tire-fonds à 100 mm du bout avant, 40 mm du bout arrière, entraxe 70 mm/,
    );
  });
});

describe("pied sur platine à âme noyée ou sabot : propriété (A35 (a))", () => {
  it("M1 reçoit `bolts.perTread` organes quand la géométrie le permet", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESETS),
        fc.integer({ min: 30, max: 80 }),
        fc.integer({ min: 1, max: 2 }),
        fc.option(fc.integer({ min: 70, max: 240 }), { nil: undefined }),
        fc.constantFrom("embeddedPlate", "shoe"),
        (id, thickness, perTread, width, kind) => {
          const over = {
            bolts: { perTread },
            anchors: { kind },
            ...(width !== undefined ? { section: { width } } : {}),
          };
          const { beam, checks, params } = run(id, over, thickness);
          if (beam.errors.length > 0 || beam.seats.length === 0) return;
          const bp = params.bolts;
          const lp = params.lagScrews;
          const lag = woodCentralBoltSpacing(bp, PROFILE.fasteners, lp).lag;
          const tp = params.anchors.plate.thickness;
          const c = PROFILE.wood.clearance;
          const seatClearance =
            roundUpTo(thickness + lp.minAnchorage, bp.lengthStep) - thickness + lp.tipCover;
          const m1 = beam.seats[0]!;
          // Garde : assise assez longue pour ses organes, assez de bois sous M1.
          const room =
            m1.sigma1 -
            m1.sigma0 -
            (lag.frontEndDistance + lag.rearEndDistance + (perTread - 1) * lag.minSpacing);
          if (room < 0 || m1.z - tp < seatClearance + c) return;
          expect(m1.bolts, `${id} ${kind} tm=${thickness} n=${perTread} b=${width}`).toHaveLength(
            perTread,
          );
          expect(boltIssuesOn(checks, m1.tread)).toEqual([]);
        },
      ),
      { numRuns: 40 },
    );
  });
});
