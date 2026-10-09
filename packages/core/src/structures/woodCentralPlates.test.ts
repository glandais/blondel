/**
 * Platines à âme noyée du limon central bois (`woodCentralPlates.ts`, QUESTIONS A33 (f),
 * A34 (b) (c), décisions du 2026-10-09 ; C §1.11 [71][80]) : pièces, fixations, traits de scie
 * et perçages de la poutre, contrôle `FAB_PLATINE_AME_NOYEE`, entraxes et pinces des broches
 * (EC5), propriétés sur générateurs contraints. Géométrie de poutre synthétique
 * (`ShoeBeamGeometry`) sur des traces réelles (droite, quart tournant, hélicoïdale).
 */
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { fr } from "../i18n.test-helpers.js";
import type { Part } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import { solidProblem } from "../parts/solidChecks.js";
import { createProject } from "../project/presets.js";
import { DEFAULT_WORKSHOP_PROFILE } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { STEEL_RULES } from "./steelCommon.js";
import { woodCentralContext, woodCentralParams, woodTraceOf } from "./woodCentral.test-helpers.js";
import type { WoodCentralParams } from "./woodCentralParams.js";
import {
  WOOD_CENTRAL_PLATE_FOOT_ID,
  WOOD_CENTRAL_PLATE_FOOT_MARK,
  WOOD_CENTRAL_PLATE_FOOT_WEB_ID,
  WOOD_CENTRAL_PLATE_FOOT_WEB_MARK,
  WOOD_CENTRAL_PLATE_HEAD_ID,
  WOOD_CENTRAL_PLATE_HEAD_MARK,
  WOOD_CENTRAL_PLATE_HEAD_WEB_ID,
  WOOD_CENTRAL_PLATE_HEAD_WEB_MARK,
  WOOD_CENTRAL_PLATE_RULES,
  buildWoodCentralEmbeddedPlates,
  embeddedWebLine,
  resolvePlateWidth,
  type WoodCentralPlatesResult,
} from "./woodCentralPlates.js";
import type { ShoeBeamGeometry } from "./woodCentralShoes.js";
import { ec5Spacing } from "./woodSpacing.js";

const EN = translatorFor("en");
const RULE_ID = WOOD_CENTRAL_PLATE_RULES.plateFit.id;
const PROFILE = DEFAULT_WORKSHOP_PROFILE;
const C = PROFILE.wood.clearance;
const BEAM_ID = "wood-central-beam";

type TraceId = "straight" | "quarter-left" | "helical";
const contexts = new Map<TraceId, { ctx: StructureContext; trace: CentralTrace }>();

/** Contexte et trace d'un préréglage (trace calculée avec les paramètres par défaut). */
function traceFor(id: TraceId): { ctx: StructureContext; trace: CentralTrace } {
  let hit = contexts.get(id);
  if (!hit) {
    const ctx = woodCentralContext(createProject(id));
    hit = { ctx, trace: woodTraceOf(ctx, woodCentralParams()) };
    contexts.set(id, hit);
  }
  return hit;
}

interface GeomOver {
  readonly floorCut?: number;
  readonly firstSeatZ?: number;
  readonly headHeight?: number;
}

/**
 * Géométrie synthétique de la poutre : face avant au premier nez, coupe au sol de 250 mm,
 * dessous de la première marche à 200 mm, chevêtre au dernier nez, coupe de tête de 300 mm sous
 * le dernier dessous de marche (40 mm sous la ligne des nez).
 */
function geometry(trace: CentralTrace, over: GeomOver = {}): ShoeBeamGeometry {
  const sig = trace.nosingSigma;
  const trimmer = sig[sig.length - 1]!;
  const headTop = trace.nosingZ(trimmer) - 40;
  return {
    beamId: BEAM_ID,
    beamMark: "LC1",
    frontSigma: sig[0]!,
    floorCutLength: over.floorCut ?? 250,
    firstSeatZ: over.firstSeatZ ?? 200,
    trimmerSigma: trimmer,
    headBottom: headTop - (over.headHeight ?? 300),
    headTop,
  };
}

function run(
  id: TraceId,
  over: Record<string, unknown> = {},
  geom: GeomOver = {},
): {
  readonly r: WoodCentralPlatesResult;
  readonly checks: CheckCollector;
  readonly params: WoodCentralParams;
  readonly trace: CentralTrace;
  readonly beam: ShoeBeamGeometry;
} {
  const { ctx, trace } = traceFor(id);
  const params = woodCentralParams({
    ...over,
    anchors: { kind: "embeddedPlate", ...(over.anchors ?? {}) },
  });
  const checks = new CheckCollector(ctx.project, ctx.stepping);
  const beam = geometry(trace, geom);
  const r = buildWoodCentralEmbeddedPlates({ params, trace, profile: PROFILE, beam, checks });
  return { r, checks, params, trace, beam };
}

const part = (r: WoodCentralPlatesResult, id: string): Part => {
  const p = r.parts.find((q) => q.id === id);
  if (!p) throw new Error(`pièce ${id} absente`);
  return p;
};

const fits = (checks: CheckCollector) => checks.results.filter((x) => x.ruleId === RULE_ID);

describe("platines à âme noyée : pièces et fixations", () => {
  it("pied et tête sur un escalier droit : PP1, AP1, PT1, AT1, chevilles et broches", () => {
    const { r, checks, params } = run("straight");
    expect(r.errors).toEqual([]);
    expect(r.parts.map((p) => [p.id, p.mark])).toEqual([
      [WOOD_CENTRAL_PLATE_FOOT_ID, WOOD_CENTRAL_PLATE_FOOT_MARK],
      [WOOD_CENTRAL_PLATE_FOOT_WEB_ID, WOOD_CENTRAL_PLATE_FOOT_WEB_MARK],
      [WOOD_CENTRAL_PLATE_HEAD_ID, WOOD_CENTRAL_PLATE_HEAD_MARK],
      [WOOD_CENTRAL_PLATE_HEAD_WEB_ID, WOOD_CENTRAL_PLATE_HEAD_WEB_MARK],
    ]);
    expect(r.welded).toBe(true);
    for (const p of r.parts) {
      expect(p.category).toBe("fixing");
      expect(p.material).toBe("steel-painted");
      expect(p.flat?.reference?.kind).toBe("face");
      expect(solidProblem(p.solid)).toBeUndefined();
      expect(fr(p.name)).not.toMatch(/structure\./);
      expect(EN.t(p.section!)).toMatch(/^flat \d+ mm, S235$/);
    }
    const PP1 = part(r, WOOD_CENTRAL_PLATE_FOOT_ID);
    const PT1 = part(r, WOOD_CENTRAL_PLATE_HEAD_ID);
    const AP1 = part(r, WOOD_CENTRAL_PLATE_FOOT_WEB_ID);
    const AT1 = part(r, WOOD_CENTRAL_PLATE_HEAD_WEB_ID);
    expect(PP1.fixings).toEqual([{ joint: "plateFloor", points: 2, holeDiameter: 13 }]);
    expect(PT1.fixings).toEqual([{ joint: "plateTrimmer", points: 2, holeDiameter: 13 }]);
    for (const web of [AP1, AT1]) {
      expect(web.fixings).toEqual([
        {
          joint: "embeddedPlatePinned",
          points: 2,
          holeDiameter: 13,
          length: params.section.width,
          with: [BEAM_ID],
        },
      ]);
      expect(web.flat!.outline.holes).toHaveLength(2);
      expect(web.flat!.thickness).toBe(params.anchors.plate.webThickness);
      // Deux cordons d'angle le long de l'âme.
      expect(web.quantities.weld_mm).toBeCloseTo(2 * params.anchors.plate.webLength, 6);
      expect(web.assembledWith).toEqual(expect.arrayContaining([BEAM_ID]));
    }
    // Platines : largeur auto b + 4 × pince, chevilles de part et d'autre de la poutre.
    const W = resolvePlateWidth(params);
    expect(W).toBe(params.section.width + 4 * params.anchors.holeEdgeDistance);
    expect(PP1.stock).toEqual({ length: 200, width: W, thickness: 8 });
    expect(PP1.flat!.outline.holes).toHaveLength(2);
    expect(PP1.flat!.lines.some((l) => l.kind === "mark" && fr(l.label) === "Âme AP1 soudée")).toBe(
      true,
    );
    expect(PP1.quantities.weld_mm).toBe(0);
    expect(r.assemblies).toEqual([
      { a: { partId: PP1.id }, b: { partId: AP1.id } },
      { a: { partId: AP1.id }, b: { partId: BEAM_ID } },
      { a: { partId: PT1.id }, b: { partId: AT1.id } },
      { a: { partId: AT1.id }, b: { partId: BEAM_ID } },
    ]);
    // Contrôle : un constat par platine, conforme.
    const f = fits(checks);
    expect(f.map((x) => x.status)).toEqual(["ok", "ok"]);
    expect(fr(f[0]!.message)).toContain("PP1");
    expect(fr(f[1]!.message)).toContain("PT1");
    expect(r.notes.map((m) => fr(m)).join(" ")).toContain("C §1.11 [80]");
    // Découpe laser contrôlée pour les quatre pièces.
    const laser = checks.results.filter((x) => x.ruleId === STEEL_RULES.laser.id);
    expect(laser.map((x) => x.status)).toEqual(["ok"]);
  });

  it("traits de scie et perçages des broches reportés sur la poutre", () => {
    const { r, params, beam } = run("straight");
    const P = params.anchors.plate;
    expect(r.beamKerfs).toHaveLength(2);
    const [foot, head] = r.beamKerfs;
    expect(foot!.mark).toBe("AP1");
    expect(foot!.width).toBe(P.webThickness + 2 * C);
    expect(foot!.z0).toBe(P.thickness);
    expect(foot!.z1).toBeCloseTo(P.thickness + P.webDepth + C, 9);
    expect(foot!.sigma1 - foot!.sigma0).toBeCloseTo(P.webLength + 2 * C, 9);
    expect(head!.mark).toBe("AT1");
    // Trait de tête ouvert sur la coupe d'aplomb (chevêtre − platine − jeu).
    expect(head!.sigma1).toBeCloseTo(beam.trimmerSigma - P.thickness - C, 9);
    expect(head!.sigma1 - head!.sigma0).toBeCloseTo(P.webDepth, 9);
    expect(r.beamHoles).toHaveLength(4);
    for (const h of r.beamHoles) expect(h.diameter).toBe(P.pinDiameter);
    // Broches au pied : au-dessus de la platine à la pince d'extrémité a3,t de l'EC5.
    const ec5 = ec5Spacing("dowel", P.pinDiameter);
    for (const h of r.beamHoles.filter((x) => x.mark === "AP1")) {
      expect(h.z - P.thickness).toBeGreaterThanOrEqual(ec5.a3t - 1e-9);
      expect(h.z).toBeLessThanOrEqual(foot!.z1);
    }
    for (const h of r.beamHoles.filter((x) => x.mark === "AT1")) {
      expect(head!.sigma1 - h.sigma).toBeGreaterThanOrEqual(ec5.a3t - 1e-9);
    }
  });

  it("âme plus profonde que le bois disponible : ramenée sous la première marche (remarque)", () => {
    // Dessous de la première marche à 140 mm (marche de 40 mm sur une hauteur de 180 mm) :
    // 140 − joue mini − platine < âme + jeu ; l'âme réduite tient encore ses broches.
    const { r, checks, params } = run("straight", {}, { firstSeatZ: 140 });
    const room = 140 - PROFILE.wood.minCheek - params.anchors.plate.thickness;
    expect(fits(checks)[0]!.status).toBe("ok");
    const note = r.notes.map((m) => fr(m)).find((t) => t.startsWith("Âme AP1 ramenée"));
    expect(note).toContain(`${room} mm de bois disponible`);
    expect(r.notes.map((m) => EN.t(m)).join(" ")).toContain("Web AP1 reduced");
    const AP1 = part(r, WOOD_CENTRAL_PLATE_FOOT_WEB_ID);
    expect(AP1.stock!.width).toBeCloseTo(room - C, 9);
    expect(r.beamKerfs[0]!.z1).toBeLessThanOrEqual(params.anchors.plate.thickness + room + 1e-9);
  });

  it("âme ramenée qui ne tient plus ses broches aux pinces de l'EC5 : constat en violation", () => {
    // 120 − 20 − 8 = 92 mm de bois : broches sous la pince d'extrémité a3,t (84 mm).
    const { r, checks } = run("straight", {}, { firstSeatZ: 120 });
    const f = fits(checks)[0]!;
    expect(f.status).toBe("violation");
    expect(f.min).toBe(ec5Spacing("dowel", 12).a3t);
    expect(fr(f.message)).toContain("pince a3,t de 84 mm");
    expect(EN.t(f.message)).toContain("a3,t distance of 84 mm");
    expect(r.parts.some((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_WEB_ID)).toBe(true);
  });

  it("âme sans place (plus de deux pinces) : constat en violation, platine de pied non générée", () => {
    const { r, checks, params } = run("straight", {}, { firstSeatZ: 60 });
    expect(r.parts.some((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_ID)).toBe(false);
    const f = fits(checks)[0]!;
    expect(f.status).toBe("violation");
    expect(f.measured).toBeCloseTo(params.anchors.plate.webDepth + C, 9);
    expect(f.max).toBeCloseTo(60 - PROFILE.wood.minCheek - params.anchors.plate.thickness, 9);
    expect(fr(f.message)).toContain("non générée");
  });

  it("coupe au sol trop courte : platine réduite, puis absente", () => {
    const reduced = run("straight", {}, { floorCut: 120 });
    const PP1 = part(reduced.r, WOOD_CENTRAL_PLATE_FOOT_ID);
    expect(Math.max(...PP1.flat!.outline.outer.map((p) => p.x))).toBeCloseTo(120, 9);
    expect(fits(reduced.checks)[0]!.status).toBe("violation");
    expect(fr(fits(reduced.checks)[0]!.message)).toContain("platine réduite à 120 mm");
    const missing = run("straight", {}, { floorCut: 30 });
    expect(missing.r.parts.some((p) => p.id === WOOD_CENTRAL_PLATE_FOOT_ID)).toBe(false);
    expect(fr(fits(missing.checks)[0]!.message)).toContain("platine de pied non générée");
  });

  it("platine trop étroite : chevilles sous la poutre signalées", () => {
    const { checks } = run("straight", { anchors: { plate: { width: 100 } } });
    const f = fits(checks);
    expect(f.every((x) => x.status === "violation")).toBe(true);
    expect(fr(f[0]!.message)).toContain("platine à élargir");
  });

  it("broches impossibles à l'entraxe a1 : celles qui tiennent, constat en violation", () => {
    const { r, checks } = run("straight", { anchors: { plate: { pins: 4 } } });
    const ec5 = ec5Spacing("dowel", 12);
    const foot = r.beamHoles.filter((h) => h.mark === "AP1");
    expect(foot.length).toBeLessThan(4);
    expect(foot.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < foot.length; i++) {
      expect(foot[i]!.sigma - foot[i - 1]!.sigma).toBeGreaterThanOrEqual(ec5.a1 - 1e-9);
    }
    expect(fr(fits(checks)[0]!.message)).toMatch(/broches posées \d sur 4/);
  });

  it("sans ancrage : un constat conforme, aucune pièce", () => {
    const { r, checks } = run("straight", { anchors: { foot: false, head: false } });
    expect(r.parts).toEqual([]);
    expect(r.welded).toBe(false);
    expect(fits(checks).map((x) => x.status)).toEqual(["ok"]);
  });

  it("pied seul : pas de platine de tête", () => {
    const { r, checks } = run("straight", { anchors: { head: false } });
    expect(r.parts.map((p) => p.mark)).toEqual(["PP1", "AP1"]);
    expect(fits(checks)).toHaveLength(1);
  });

  it.each(["quarter-left", "helical"] as const)(
    "%s : âme plane sur la corde, flèche centrée et contrôlée",
    (id) => {
      const { r, checks, params, trace, beam } = run(id);
      expect(r.errors).toEqual([]);
      const P = params.anchors.plate;
      const b = params.section.width;
      const head = r.beamKerfs.find((k) => k.mark === "AT1")!;
      const line = embeddedWebLine(trace, head.sigma0 + C, beam.trimmerSigma - P.thickness);
      // Flèche centrée : au plus la moitié de l'écart à la tangente du chevêtre.
      if (trace.kind === "helical") expect(line.sag).toBeGreaterThan(0);
      const ec5 = ec5Spacing("dowel", P.pinDiameter);
      const reach = line.sag + head.width / 2;
      const status = fits(checks)[1]!.status;
      if (status === "ok") expect(reach).toBeLessThanOrEqual(b / 2 - ec5.a4c + 1e-6);
      if (reach > b / 2 - ec5.a4c + 1e-6) {
        expect(status).toBe("violation");
        expect(fr(fits(checks)[1]!.message)).toContain("âme plane dans une poutre cintrée");
      }
      for (const p of r.parts) expect(solidProblem(p.solid)).toBeUndefined();
    },
  );
});

describe("platines à âme noyée : saisies trop courtes signalées", () => {
  it("platine plus courte que deux pinces, âme trop peu profonde : non générées, constat en violation", () => {
    for (const over of [{ anchors: { length: 30 } }, { anchors: { plate: { webDepth: 30 } } }]) {
      const { r, checks } = run("straight", over);
      expect(r.parts).toEqual([]);
      const f = fits(checks);
      expect(f.map((x) => x.status)).toEqual(["violation", "violation"]);
      expect(fr(f[0]!.message)).toMatch(/non générée/);
    }
  });
});

describe("embeddedWebLine", () => {
  it("trace droite : flèche nulle, âme sur l'axe", () => {
    const { trace } = traceFor("straight");
    const line = embeddedWebLine(trace, 100, 300);
    expect(line.sag).toBeCloseTo(0, 9);
    expect(V.distance(line.center, trace.point(200))).toBeCloseTo(0, 6);
  });

  it("arc de rayon R : flèche ≈ L² / 16R (corde décalée de la demi-flèche)", () => {
    const { trace } = traceFor("helical");
    const R = trace.arcs[0]!.radius;
    const L = 200;
    const line = embeddedWebLine(trace, 1000, 1000 + L);
    expect(line.sag).toBeCloseTo((L * L) / (16 * R), 0);
  });
});

describe("platines à âme noyée : propriétés", () => {
  const traceArb = fc.constantFrom<TraceId>("straight", "quarter-left", "helical");
  const overArb = fc.record({
    width: fc.integer({ min: 40, max: 160 }),
    plate: fc.record({
      thickness: fc.integer({ min: 4, max: 15 }),
      webThickness: fc.integer({ min: 3, max: 10 }),
      webDepth: fc.integer({ min: 30, max: 220 }),
      webLength: fc.integer({ min: 30, max: 260 }),
      pins: fc.integer({ min: 0, max: 5 }),
      pinDiameter: fc.integer({ min: 6, max: 16 }),
    }),
    length: fc.integer({ min: 40, max: 400 }),
    foot: fc.boolean(),
    head: fc.boolean(),
  });
  const geomArb = fc.record({
    floorCut: fc.integer({ min: 0, max: 400 }),
    firstSeatZ: fc.integer({ min: 40, max: 260 }),
    headHeight: fc.integer({ min: 20, max: 450 }),
  });

  it("ne lève jamais ; broches à l'entraxe a1, dans l'âme ; trait de scie dans le bois si conforme", () => {
    fc.assert(
      fc.property(traceArb, overArb, geomArb, (id, o, g) => {
        const plate = { ...o.plate, pinHoleDiameter: o.plate.pinDiameter + 1 };
        const { r, checks, params, trace, beam } = run(
          id,
          {
            section: { width: o.width },
            anchors: { length: o.length, foot: o.foot, head: o.head, plate },
          },
          g,
        );
        expect(r.errors).toEqual([]);
        const P = params.anchors.plate;
        const ec5 = ec5Spacing("dowel", P.pinDiameter);
        const statuses = fits(checks);
        expect(statuses).toHaveLength(o.foot || o.head ? (o.foot ? 1 : 0) + (o.head ? 1 : 0) : 1);
        // Constat conforme ⇒ platine et âme générées (aucune platine ne disparaît en silence).
        const sides: [string, string][] = [
          ...(o.foot ? [["PP1", "AP1"] as [string, string]] : []),
          ...(o.head ? [["PT1", "AT1"] as [string, string]] : []),
        ];
        sides.forEach(([mark, webMark], i) => {
          const present =
            r.parts.some((q) => q.mark === mark) && r.parts.some((q) => q.mark === webMark);
          if (statuses[i]!.status === "ok") expect(present, mark).toBe(true);
          if (!present) expect(statuses[i]!.status, mark).toBe("violation");
        });
        for (const web of r.parts.filter((p) => p.mark.startsWith("A"))) {
          const pins = r.beamHoles.filter((h) => h.mark === web.mark);
          expect(pins.length).toBeLessThanOrEqual(P.pins);
          for (let i = 0; i < pins.length; i++) {
            for (let j = i + 1; j < pins.length; j++) {
              const d = Math.hypot(pins[i]!.sigma - pins[j]!.sigma, pins[i]!.z - pins[j]!.z);
              expect(d).toBeGreaterThanOrEqual(ec5.a1 - 1e-6);
            }
          }
          // Broches dans l'âme (développé de l'âme).
          const out = web.flat!.outline.outer;
          const wx = Math.max(...out.map((p) => p.x));
          const wy = Math.max(...out.map((p) => p.y));
          for (const hole of web.flat!.outline.holes) {
            for (const q of hole) {
              expect(q.x).toBeGreaterThanOrEqual(-1e-6);
              expect(q.y).toBeGreaterThanOrEqual(-1e-6);
              expect(q.x).toBeLessThanOrEqual(wx + 1e-6);
              expect(q.y).toBeLessThanOrEqual(wy + 1e-6);
            }
          }
        }
        // Trait de scie dans le bois quand le constat de la platine est conforme.
        const foot = r.beamKerfs.find((k) => k.mark === "AP1");
        const head = r.beamKerfs.find((k) => k.mark === "AT1");
        const pairs: [typeof foot, number, number][] = [];
        if (foot) pairs.push([foot, foot.sigma0 + C, foot.sigma1 - C]);
        if (head) pairs.push([head, head.sigma0 + C, beam.trimmerSigma - P.thickness]);
        for (const [k, s0, s1] of pairs) {
          const f = statuses[k === foot ? 0 : statuses.length - 1]!;
          if (f.status !== "ok") continue;
          const line = embeddedWebLine(trace, s0, s1);
          expect(line.sag + k!.width / 2).toBeLessThanOrEqual(o.width / 2 - ec5.a4c + 1e-6);
          expect(line.sag + k!.width / 2).toBeLessThanOrEqual(o.width / 2);
        }
      }),
      { numRuns: 60 },
    );
  });
});
