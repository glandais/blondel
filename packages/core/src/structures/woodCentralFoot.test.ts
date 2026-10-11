/**
 * Pied du limon central bois sur platine à âme noyée, intégration poutre + platine (QUESTIONS
 * A35 (a), (b), (e), décisions du 2026-10-09) : l'âme de pied prolongée le long de la trace rend
 * à la première marche la place de ses organes (boulons ou tire-fonds) sur les préréglages
 * droit, quart tournant, U, demi-tour et hélicoïdal ; propriété sur générateurs contraints
 * (épaisseur de marche, organes par marche, largeur de poutre) sous la garde « quand la
 * géométrie le permet ».
 */
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { fr } from "../i18n.test-helpers.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import type { StructureContext } from "../model/plugins.js";
import { DEFAULT_WORKSHOP_PROFILE } from "../workshop/profile.js";
import {
  WOOD_CENTRAL_BEAM_RULES,
  kerfObstacleTop,
  kerfPlaneOffset,
  kerfShiftAllowed,
} from "./woodCentralBeam.js";
import {
  woodBeamOf,
  woodCentralContext,
  woodCentralParams,
  woodTraceOf,
} from "./woodCentral.test-helpers.js";
import { WOOD_CENTRAL_PLATE_FOOT_ID, WOOD_CENTRAL_PLATE_FOOT_WEB_ID } from "./woodCentralPlates.js";
import {
  ec5EndDistance,
  lagAnchorageHolds,
  woodCentralBoltSpacing,
  type WoodCentralLagSpacing,
} from "./woodSpacing.js";

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

/** Contexte d'un préréglage quelconque (demi-tour compris) à l'épaisseur de marche donnée. */
function contextForAny(id: PresetId | "half-turn", thickness: number): StructureContext {
  return contextFor(id as PresetId, thickness);
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

/**
 * Garde des propriétés : place sous une assise du plus court tire-fond admissible de la grille
 * des longueurs (L − tm + `tipCover`), repli sur l'ancrage requis arrondi au pas. Sert seulement
 * à écarter les cas sans bois sous M1 ; la poutre réserve la place du tire-fond posé (A38 (6)).
 */
function shortestLagRoom(
  lag: WoodCentralLagSpacing,
  o: { tm: number; lengthStep: number; maxLength: number; tipCover: number },
): number {
  const step = o.lengthStep > 0 ? o.lengthStep : 1;
  for (let L = Math.ceil(o.tm / step - 1e-9) * step; L <= o.maxLength + 1e-9; L += step) {
    if (L > o.tm && lagAnchorageHolds(lag, L, o.tm)) return L - o.tm + o.tipCover;
  }
  const req = lag.anchorageMode === "total" ? lag.minTotalAnchorage : lag.minAnchorage;
  return Math.ceil((o.tm + req) / step - 1e-9) * step - o.tm + o.tipCover;
}

describe("pied sur platine à âme noyée : âme prolongée, M1 fixée (A35 (a))", () => {
  it.each(PRESETS)("%s : M1 reçoit ses organes, âme prolongée et broches hors de M1", (id) => {
    const { beam, checks, params, ctx } = run(id);
    expect(beam.errors).toEqual([]);
    const web = beam.parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID)!;
    const plate = beam.parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_ID)!;
    expect(web).toBeDefined();
    expect(plate).toBeDefined();
    // Âme prolongée le long de la trace, au moins deux pinces de perçage. Depuis A37 (1), la
    // place laissée sous chaque assise est celle du plus court tire-fond dont la partie filetée
    // pénètre de 6·d (marche de 40 mm : 120 mm, ancrage 80, au lieu de 90 mm, ancrage 50) ;
    // depuis A38 (6), celle du tire-fond réellement posé sous l'assise (pré-passe sans obstacle) :
    // M1 de ces préréglages en porte deux de 160 mm (130 mm réservés), longueurs d'âme
    // inchangées ; sur le droit et l'hélicoïdal, le palier sous M1 tombe sous deux pinces et l'âme s'arrête
    // avant M1 (`plateFootWebExtendedOne`), plus courte que l'âme centrée `webLength`.
    expect(beam.footWebLength).toBeGreaterThanOrEqual(2 * params.anchors.holeEdgeDistance - 1e-6);
    // Platine couvrant l'âme.
    expect(plate.stock!.length).toBeGreaterThanOrEqual(beam.footWebLength! - 1e-6);
    const m1 = beam.seats[0]!;
    expect(m1.tread).toBe(ctx.stepping.treads[0]!.number);
    expect(m1.bolts).toHaveLength(params.bolts.perTread);
    expect(boltIssuesOn(checks, m1.tread)).toEqual([]);
    // Broches : deux, posées au-delà de la zone des organes de M1.
    expect(web.flat!.outline.holes).toHaveLength(params.anchors.plate.pins);
    // Logement de l'âme tracé sur le développé de LC1 selon la filière (A36 (5)).
    const lc1 = beam.parts.find((p) => p.id === "wood-central-beam")!;
    const kerfKeys = lc1.flat!.lines.flatMap((l) => (l.label ? [l.label.key] : []));
    expect(kerfKeys).toContain(
      beam.curvedMethod === "stacked"
        ? "structure.woodCentral.flatLine.kerfLayerCut"
        : "structure.woodCentral.flatLine.kerfMilled",
    );
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
    // Relecture A35 : autour d'un perçage horizontal (boulon de sabot), un tire-fond garde le jeu
    // géométrique plus le bois `lagScrews.holeWood` (`lagHoleClearance`, QUESTIONS A36 (10),
    // A37 (17), `auto` 0,5·d), retiré sinon.
    const ctx = contextFor("straight");
    const params = woodCentralParams({});
    const { beam, checks } = woodBeamOf(ctx, params);
    expect(beam.anchorKind).toBe("shoe");
    expect(beam.seats[0]!.bolts).toHaveLength(params.bolts.perTread);
    expect(boltIssuesOn(checks, beam.seats[0]!.tread)).toEqual([]);
  });
});

describe("assise trop courte pour les tire-fonds (A35 (l), QUESTIONS A36 (4), (11))", () => {
  it("U, poutre de 220 mm en couches empilées : M3 reste à un organe, a1,CG mesurée le long du fil ne la règle pas", () => {
    // Couches empilées (fil horizontal) : la mesure de a1,CG le long du fil (A36 (4)) part de la
    // face de la dent précédente, à la hauteur du centre de gravité de la partie filetée, au-
    // dessus du plafond de l'entaille de M2 : 100 mm comme avant. M3 chevauche la limite de
    // l'écrou ; avant elle, seul un tire-fond tient, à σ0 + 100 au plus tôt ; la pince arrière
    // (40 mm) laisse 62 mm pour l'entraxe de 70 mm : un seul organe, l'avertissement reste.
    const { beam, checks } = run("two-quarters-u", { section: { width: 220 } });
    expect(beam.curvedMethod).toBe("stacked");
    const m3 = boltIssuesOn(checks, 3);
    expect(m3).toHaveLength(1);
    // Ancrage `auto` (A37 (1)) : message des tire-fonds raccourcis jusqu'à 6·d de partie filetée.
    expect(m3[0]!.message.key).toBe("structure.woodCentral.check.fixings.missingLagThreadAuto");
    expect(fr(m3[0]!.message)).toMatch(
      /tire-fonds à 40 mm du bout avant, 40 mm du bout arrière, entraxe 70 mm, centre de gravité de la partie filetée à 100 mm au moins de la coupe au sol et des faces de cran le long du fil/,
    );
    const seat = beam.seats.find((x) => x.tread === 3)!;
    expect(seat.bolts).toHaveLength(1);
    // Le seul organe : un tire-fond à 100 mm au moins de la face de la dent (fil horizontal).
    expect(seat.bolts[0]!.kind).toBe("lagScrew");
    expect(seat.bolts[0]!.sigma - seat.sigma0).toBeGreaterThanOrEqual(100 - 1e-6);
  });
});

describe("U à poutre de 200 à 240 mm cintrée sur moule : M3 réglée (QUESTIONS A36 (11))", () => {
  it.each([200, 220, 240])(
    "b = %i mm : M3 reçoit ses deux organes, aucun constat de fixation",
    (width) => {
      // Fil le long de la pente (moule) : a1,CG mesurée le long du fil depuis la face de la dent
      // laisse place à deux organes sur l'assise de M3, contrairement aux couches empilées
      // (cas ci-dessus, fil horizontal).
      const { beam, checks } = run("two-quarters-u", {
        section: { width, curvedMethod: "mould" },
      });
      expect(beam.curvedMethod).toBe("mould");
      expect(boltIssuesOn(checks, 3)).toEqual([]);
      const seat = beam.seats.find((x) => x.tread === 3)!;
      expect(seat.bolts).toHaveLength(2);
    },
  );
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
          // Garde : place du plus court tire-fond admissible sous M1 (A37 (1)).
          const seatClearance = shortestLagRoom(lag, {
            tm: thickness,
            lengthStep: bp.lengthStep,
            maxLength: lp.maxLength,
            tipCover: lp.tipCover,
          });
          const m1 = beam.seats[0]!;
          // Garde : assise assez longue pour ses organes (pinces latérales et entraxe), assez de
          // bois sous M1. La pince axiale a1,CG le long du fil (A36 (4)) n'entre pas dans la
          // garde : la propriété vérifie qu'elle ne retire aucun organe à M1 dans ce domaine
          // (tire-fonds raccourcis au besoin jusqu'à l'ancrage minimal).
          const room =
            m1.sigma1 -
            m1.sigma0 -
            (lag.frontEndDistance + lag.rearEndDistance + (perTread - 1) * lag.minSpacing);
          if (room < 0 || m1.z - tp < seatClearance + c) return;
          // Âme de pied non prolongée (repli sur l'âme centrée sous M1, `plateWebReduced`) : la
          // place sous M1 n'est pas rendue, hors du domaine de la propriété (A35 (a)). Depuis
          // A37 (1), un tire-fond arrêté au-dessus de cette âme ne tient plus 6·d de partie
          // filetée (quart tournant, marche de 47 mm : 100 mm, b = 53). Dans ce cas, M1 garde
          // tous ses organes ou le constat « boulons » le signale : jamais de retrait muet.
          if (beam.notes.some((n) => n.key === "structure.woodCentral.note.plateWebReduced")) {
            if (m1.bolts.length < perTread)
              expect(boltIssuesOn(checks, m1.tread).length).toBeGreaterThan(0);
            return;
          }
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

describe("place réservée sous chaque assise : tire-fond réellement posé (QUESTIONS A38 (6))", () => {
  it("exemple droit sur platine : M1 sans tire-fond ne réserve rien, l'âme prolongée passe dessous", () => {
    // Écart voulu (décision du 2026-10-11) : M1 (marche de 80 mm) ne reçoit aucun tire-fond
    // (A38 (5)) ; avant A38, la place du plus court tire-fond admissible (140 mm, 70 mm sous
    // l'assise) y était réservée quand même et l'âme s'arrêtait après M1 (188 mm sous M2) ; elle
    // court maintenant sous M1 et M2 (432 mm), à la joue minimale sous M1.
    const url = new URL(
      "../../../../examples/j5c-limon-central-bois-droit.blondel.json",
      import.meta.url,
    );
    const project = parseProjectText(readFileSync(url, "utf8"));
    const raw = (project.stair.structure.params ?? {}) as Record<string, unknown>;
    const ctx = woodCentralContext(project);
    const params = woodCentralParams({ ...raw, anchors: { kind: "embeddedPlate" } });
    const { beam, checks } = woodBeamOf(ctx, params);
    expect(beam.errors).toEqual([]);
    expect(beam.seats[0]!.bolts).toEqual([]);
    expect(beam.seatReserve![0]).toMatchObject({ reserved: 0, lags: 0, organs: 0 });
    // M2 : tire-fonds de 140 et 160 mm posés par la pré-passe (relecture finale A38 (6) : place
    // de la longueur posée, non plus du plus court qui tient, 140 mm) : 160 − 80 + 10 = 90 mm
    // réservés ; l'âme ne raccourcit aucun tire-fond (mêmes longueurs que sur sabot).
    expect(beam.seatReserve![1]).toMatchObject({ reserved: 90, lags: 2 });
    const shoe = woodBeamOf(ctx, woodCentralParams({ ...raw, anchors: { kind: "shoe" } })).beam;
    expect(beam.seats[1]!.bolts.map((o) => o.length)).toEqual([140, 160]);
    expect(beam.seats[1]!.bolts.map((o) => o.length)).toEqual(
      shoe.seats[1]!.bolts.map((o) => o.length),
    );
    expect(beam.footWebLength).toBeCloseTo(432.1, 1);
    const note = beam.notes.find(
      (n) => n.key === "structure.woodCentral.note.plateFootWebExtended",
    )!;
    expect(note.params).toMatchObject({ first: 1, last: 2 });
    // Sous M1 : dessus de l'assise − joue minimale − jeu ; sous M2 : profondeur demandée.
    const web = beam.parts.find((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID)!;
    const ys = [...new Set(web.flat!.outline.outer.map((p) => p.y))].sort((a, b) => a - b);
    const tp = params.anchors.plate.thickness;
    const c = PROFILE.wood.clearance;
    expect(ys[1]).toBeCloseTo(beam.seats[0]!.z - PROFILE.wood.minCheek - c - tp, 6);
    expect(ys[2]).toBeCloseTo(params.anchors.plate.webDepth, 6);
    expect(
      checks.results.filter(
        (r) => r.ruleId === "FAB_PLATINE_AME_NOYEE" && r.status === "violation",
      ),
    ).toEqual([]);
    // Seul constat « boulons » : M1, comme sur sabot (A38 (5), point clos).
    expect(
      checks.results
        .filter((r) => r.ruleId === BOLTS_RULE && r.status === "violation")
        .map((r) => (r.location?.kind === "part" ? r.location.treadNumber : null)),
    ).toEqual([1]);
  });

  it("âme de pied demandée très profonde : elle ne raccourcit pas les tire-fonds posés (A38 (6), relecture finale)", () => {
    // Place réservée = longueur posée par la pré-passe (160 mm sous une marche de 40 : 130 mm),
    // non plus le plus court tire-fond qui tient (120 mm : 90 mm) ; avec 90 mm réservés, une âme
    // de 400 mm demandés ramenait les tire-fonds de M2 à 150 mm.
    for (const id of ["quarter-left", "two-quarters-u", "helical"] as const) {
      const deep = run(id, { anchors: { plate: { webDepth: 400 } } });
      const shoe = run(id, { anchors: { kind: "shoe" } });
      expect(deep.beam.errors, id).toEqual([]);
      expect(
        deep.beam.seatReserve!.slice(0, 2).map((r) => r.reserved),
        id,
      ).toEqual([130, 130]);
      for (const i of [0, 1]) {
        expect(
          deep.beam.seats[i]!.bolts.map((o) => o.length),
          `${id} M${i + 1}`,
        ).toEqual(shoe.beam.seats[i]!.bolts.map((o) => o.length));
      }
    }
  });

  it("propriété : tire-fonds au-dessus du trait de l'âme, rien réservé sans tire-fond, aucun retrait dû à l'âme ; organes hors du plan réel de l'âme (A38 (6) (8))", () => {
    let lagsOverWeb = 0;
    let shifted = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESETS, "half-turn" as const),
        fc.integer({ min: 30, max: 80 }),
        fc.integer({ min: 70, max: 240 }),
        fc.integer({ min: 100, max: 220 }),
        fc.constantFrom(5, 10, 20),
        (id, thickness, width, maxLength, lengthStep) => {
          const over = {
            section: { width },
            bolts: { lengthStep },
            lagScrews: { maxLength },
          };
          const ctx = contextForAny(id, thickness);
          const params = woodCentralParams({ ...over, anchors: { kind: "embeddedPlate" } });
          const { beam } = woodBeamOf(ctx, params);
          if (beam.errors.length > 0 || beam.seats.length === 0 || !beam.seatReserve) return;
          const trace = woodTraceOf(ctx, params);
          const bp = params.bolts;
          const lp = params.lagScrews;
          const sp = woodCentralBoltSpacing(bp, PROFILE.fasteners, lp);
          const r = bp.holeDiameter / 2 + PROFILE.wood.clearance;
          const label = `${id} tm=${thickness} b=${width} max=${maxLength} pas=${lengthStep}`;
          // (b) Rien n'est réservé sous une assise sans tire-fond dans la pré-passe.
          for (const x of beam.seatReserve) {
            if (x.lags === 0) expect(x.reserved, label).toBe(0);
            else expect(x.reserved, label).toBeGreaterThan(lp.tipCover);
          }
          const kerfs = beam.beamKerfs ?? [];
          for (const seat of beam.seats) {
            for (const o of seat.bolts) {
              for (const k of kerfs) {
                if (!(o.sigma > k.sigma0 - r && o.sigma < k.sigma1 + r)) continue;
                const d = kerfPlaneOffset(k, trace, o.sigma, o.lateral);
                const inPlane = Math.abs(d) < k.width / 2 + bp.holeDiameter / 2 - 1e-6;
                if (o.lateral !== 0) {
                  shifted++;
                  // (8) Décalé hors du trait, pince de rive de sa nature tenue de son côté.
                  expect(inPlane, `${label} M${seat.tread} σ=${o.sigma}`).toBe(false);
                  expect(kerfShiftAllowed(width, Math.abs(o.lateral), o.kind, sp)).toBe(true);
                }
                // Un boulon traversant n'est jamais dans le plan d'une âme.
                if (o.kind === "bolt") expect(inPlane, label).toBe(false);
                if (o.kind === "lagScrew" && inPlane) {
                  lagsOverWeb++;
                  // (a) Pointe au-dessus du trait + bois sous la pointe.
                  const tip = seat.z - (o.length - thickness);
                  expect(kerfObstacleTop(k, o.sigma, r) + lp.tipCover, label).toBeLessThanOrEqual(
                    tip + 1e-6,
                  );
                }
              }
            }
          }
          // (c) Sans broche (aucun perçage), la passe finale ne retire aucun organe posé par la
          // pré-passe : l'âme laisse sous chaque assise la place réservée.
          const bare = woodBeamOf(
            ctx,
            woodCentralParams({ ...over, anchors: { kind: "embeddedPlate", plate: { pins: 0 } } }),
          ).beam;
          if (bare.errors.length > 0 || !bare.seatReserve) return;
          bare.seats.forEach((seat, i) => {
            expect(seat.bolts.length, `${label} M${seat.tread}`).toBeGreaterThanOrEqual(
              bare.seatReserve![i]!.organs,
            );
          });
        },
      ),
      { numRuns: 40 },
    );
    expect(lagsOverWeb + shifted).toBeGreaterThan(0);
  });
});
