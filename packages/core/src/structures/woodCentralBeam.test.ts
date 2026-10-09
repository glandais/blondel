/**
 * Poutre du limon central bois (`woodCentralBeam.ts`, QUESTIONS A29 vague 2) : assises,
 * entailles arrière, sous-face et reste sous entaille, lamellation (k_r, refus de cintrage),
 * boulons, sabots, solides et développés ; propriétés sur générateurs contraints.
 */
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { fr } from "../i18n.test-helpers.js";
import type { Part, SolidDesc } from "../model/derived.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { solidProblem } from "../parts/solidChecks.js";
import { createProject, type PresetId } from "../project/presets.js";
import { getRule, ruleParam } from "../rules/table.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { buildCentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { fcbaTable, requiredCentralResidual } from "./fcba.js";
import { pointSegmentDistance } from "./geom.js";
import { readPlanExtrusion } from "./housing.js";
import { WoodCutParamsSchema, buildWoodCut } from "./woodCut.js";
import {
  LAMINATION_RULE_ID,
  QUANTITY_LAMELLAE,
  WOOD_CENTRAL_BEAM_ID,
  WOOD_CENTRAL_BEAM_RULES,
  buildWoodCentralBeam,
  laminationKr,
  type WoodCentralBeamResult,
} from "./woodCentralBeam.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import { WOOD_CENTRAL_SHOE_FOOT_ID, WOOD_CENTRAL_SHOE_HEAD_ID } from "./woodCentralShoes.js";
import { woodBeamOf, woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";
import { woodCentralBoltSpacing } from "./woodSpacing.js";

const EN = translatorFor("en");
const RULE = getRule(LAMINATION_RULE_ID);
const MIN = RULE.min!;
const REC = RULE.recommande!;
const KR_A = ruleParam(RULE, "kr_a");
const KR_B = ruleParam(RULE, "kr_b");

/** Projet à marches sans contremarche (entaille arrière dans la dent suivante). */
function noRisers(p: Project, nosing?: number): Project {
  return {
    ...p,
    stair: {
      ...p.stair,
      treads: { ...p.stair.treads, risers: "none", ...(nosing !== undefined ? { nosing } : {}) },
    },
  };
}

/** Poutre d'un projet (trace calculée) ; `null` si la trace n'est pas calculable. */
function beamFor(project: Project, over: Record<string, unknown> = {}) {
  const ctx = woodCentralContext(project);
  const params = woodCentralParams(over);
  const tr = buildCentralTrace(ctx, params);
  if (!tr.ok) return null;
  const checks = new CheckCollector(project, ctx.stepping);
  const beam = buildWoodCentralBeam({ ctx, params, trace: tr.trace, checks });
  return { ctx, params, trace: tr.trace, beam, checks };
}

/** Points en plan (repère monde) d'un solide extrudé ou réglé. */
function planPoints(s: SolidDesc): Vec2[] {
  if (s.kind === "extrusion") {
    const f = s.frame;
    const out: Vec2[] = [];
    for (const p of s.profile.outer) {
      for (const d of [0, s.depth]) {
        out.push(
          V.vec(
            f.origin.x + f.xAxis.x * p.x + f.yAxis.x * p.y + f.zAxis.x * d,
            f.origin.y + f.xAxis.y * p.x + f.yAxis.y * p.y + f.zAxis.y * d,
          ),
        );
      }
    }
    return out;
  }
  if (s.kind === "ruled") {
    return [...s.a, ...s.b].flatMap((p, i) => {
      const n = s.normals[i % s.normals.length]!;
      const l = Math.hypot(n.x, n.y);
      return [V.vec(p.x, p.y), V.vec(p.x + (n.x / l) * s.thickness, p.y + (n.y / l) * s.thickness)];
    });
  }
  return s.path.map((p) => V.vec(p.x, p.y));
}

/** Distance d'un point hors du polygone (0 dedans). */
function outsideBy(p: Vec2, poly: Polygon2): number {
  if (pointInPolygon(p, poly, 1e-6) !== "outside") return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  }
  return d;
}

/** Étendue verticale [min ; max] d'un polygone sur la verticale x (`null` hors du polygone). */
function verticalExtent(poly: readonly Vec2[], x: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((a.x - x) * (b.x - x) > 0 || Math.abs(b.x - a.x) < 1e-9) continue;
    const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi > lo ? [lo, hi] : null;
}

/**
 * Boulons de marche contre le contour réel de la poutre (développé, u = σ − σ de la face avant) :
 * sous-face au moins `protrusion` + pas d'arrondi au-dessus de la semelle (place de l'écrou),
 * extrémité sous la sous-face d'au moins `protrusion` et d'au plus `protrusion` + pas d'arrondi,
 * au-dessus du sol ou de la semelle ;
 * entraxe aux perçages des boulons de sabot ≥ somme des rayons. Le cœur et le test lisent le même
 * contour développé (sous-face échantillonnée) : tolérance d'arrondi seulement.
 */
const TOL = 1e-6;
function expectBoltsInsideBeam(
  beam: WoodCentralBeamResult,
  tm: number,
  over: { floor?: number; protrusion?: number; step?: number; hole?: number } = {},
): number {
  const floor = over.floor ?? 6;
  const protrusion = over.protrusion ?? 20;
  const step = over.step ?? 10;
  const hole = over.hole ?? 11;
  const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
  const outer = part.flat!.outline.outer;
  const s0 = beam.seats[0]!.sigma0;
  const shoeHoles = part.flat!.outline.holes.map((h) => {
    const xs = h.map((q) => q.x);
    const ys = h.map((q) => q.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      r: (Math.max(...xs) - Math.min(...xs)) / 2,
    };
  });
  let n = 0;
  for (const s of beam.seats) {
    for (const b of s.bolts) {
      if (b.kind !== "bolt") continue;
      n++;
      const ext = verticalExtent(outer, b.sigma - s0)!;
      expect(ext, `σ = ${b.sigma}`).not.toBeNull();
      const bottom = ext[0];
      expect(bottom).toBeGreaterThanOrEqual(floor + protrusion + step - TOL);
      const tip = s.z + tm - b.length;
      expect(tip).toBeLessThanOrEqual(bottom - protrusion + TOL);
      expect(tip).toBeGreaterThan(bottom - protrusion - step - TOL);
      // Bout du boulon au-dessus du sol ou de la semelle du sabot.
      expect(tip).toBeGreaterThanOrEqual(floor - TOL);
      for (const h of shoeHoles) {
        expect(Math.abs(b.sigma - s0 - h.x)).toBeGreaterThanOrEqual(h.r + hole / 2 - 1e-6);
      }
    }
  }
  return n;
}

/**
 * Tire-fonds de marche contre le contour réel de la poutre : pointe au-dessus du dessous réel de
 * `tipCover` au moins (ancrage borné par le bois disponible), longueur multiple du pas, au plus
 * `maxLength`, ancrage ≥ `minAnchorage`. Rend le nombre de tire-fonds.
 */
function expectLagScrewsInsideBeam(
  beam: WoodCentralBeamResult,
  tm: number,
  over: { tipCover?: number; minAnchorage?: number; maxLength?: number; step?: number } = {},
): number {
  const tipCover = over.tipCover ?? 10;
  const minAnchorage = over.minAnchorage ?? 50;
  const maxLength = over.maxLength ?? 160;
  const step = over.step ?? 10;
  const outer = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!.flat!.outline.outer;
  const s0 = Math.min(...beam.seats.map((s) => s.sigma0));
  let n = 0;
  for (const s of beam.seats) {
    for (const o of s.bolts) {
      if (o.kind !== "lagScrew") continue;
      n++;
      const ext = verticalExtent(outer, o.sigma - s0);
      expect(ext, `σ = ${o.sigma}`).not.toBeNull();
      const anchorage = o.length - tm;
      expect(o.length % step).toBe(0);
      expect(o.length).toBeLessThanOrEqual(maxLength);
      expect(anchorage).toBeGreaterThanOrEqual(minAnchorage - TOL);
      // Longueur ≤ épaisseur de marche + bois disponible − tipCover.
      expect(o.length).toBeLessThanOrEqual(tm + (s.z - ext![0]) - tipCover + TOL);
    }
  }
  return n;
}

/** Distance d'un point au contour d'un polygone. */
function boundaryDistance(p: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  }
  return d;
}

// ------------------------------------------------------------------ Cas de base

describe("limon central bois : escalier droit, lamellé-collé en couches droites", () => {
  const project = noRisers(createProject("straight"));
  const r = beamFor(project)!;
  const { beam, ctx } = r;
  const tm = project.stair.treads.thickness;

  it("une assise par marche, au dessous de la marche, entaille arrière de 15 mm", () => {
    expect(beam.errors.map(fr)).toEqual([]);
    expect(beam.seats.map((s) => s.tread)).toEqual(ctx.stepping.treads.map((t) => t.number));
    for (const s of beam.seats) {
      const t = ctx.stepping.treads.find((x) => x.number === s.tread)!;
      expect(s.z).toBeCloseTo(t.z - tm, 9);
      expect(s.treadPartId).toBe(`tread-${s.tread}`);
      expect(s.sigma1).toBeGreaterThan(s.sigma0);
    }
    expect(beam.rearDepth).toBe(15);
    const inner = beam.seats.slice(0, -1);
    for (const s of inner) {
      expect(s.rearDepth).toBeCloseTo(15, 6);
      expect(s.toothAbove).toBeGreaterThan(0);
      expect(Number.isFinite(s.toothAbove)).toBe(true);
    }
    // Arrivée : marche contre le chevêtre, sans entaille.
    expect(beam.seats.at(-1)!.rearDepth).toBe(0);
    expect(beam.seats.at(-1)!.toothAbove).toBe(Infinity);
  });

  it("reste sous entaille ≥ valeur retenue (repli : tableau FCBA hors domaine)", () => {
    expect(beam.fcba.required).toBeNull();
    expect(beam.fcba.unusable).toBeDefined();
    expect(beam.residual).toBe(180);
    for (const s of beam.seats) expect(s.residual).toBeGreaterThanOrEqual(beam.residual - 1e-6);
    expect(Math.min(...beam.seats.map((s) => s.residual))).toBeCloseTo(beam.residual, 6);
  });

  it("lamellation : 2 couches collées de 44 mm, k_r = 1, quantités propres", () => {
    expect(beam.lamination).toMatchObject({
      kind: "glulam",
      curved: false,
      lamellaThickness: 44,
      lamellae: 2,
      kr: 1,
      ratio: Infinity,
      bends: [],
    });
    const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(part.mark).toBe("LC1");
    expect(part.category).toBe("carriage");
    expect(part.quantities[QUANTITY_LAMELLAE]).toBe(2);
    // Débit : une lame par couche (plateau du profil d'atelier), contrôlée par
    // FAB_DEBIT_DISPONIBLE sur la même épaisseur.
    expect(part.stock!.count).toBe(2);
    expect(part.stock!.thickness).toBeGreaterThanOrEqual(44);
    expect(part.stock!.thickness).toBeLessThan(88);
    const debit = r.checks.results.filter((c) => c.ruleId === "FAB_DEBIT_DISPONIBLE");
    expect(debit.map((c) => c.status)).toEqual(["ok"]);
    expect(fr(debit[0]!.message)).toContain(`× ${part.stock!.thickness}`);
    expect(fr(part.section!)).toMatch(/^lamellé-collé 88 × \d+, 2 lamelles de 44$/);
    expect(EN.t(part.section!)).toMatch(/^glulam 88 × \d+, 2 laminations of 44$/);
    expect(part.solid.kind).toBe("extrusion");
    expect(solidProblem(part.solid)).toBeUndefined();
  });

  it("organes : deux par marche, tire-fonds sur les marches basses (coupe au sol), boulons ailleurs, fixations déclarées", () => {
    const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    // Marches 1 et 2 au-dessus de la coupe au sol (semelle du sabot) : pas de place pour
    // l'écrou, tire-fonds depuis le dessus de la marche (QUESTIONS A34 (a)).
    expect(beam.seats[0]!.bolts.map((o) => o.kind)).toEqual(["lagScrew", "lagScrew"]);
    expect(beam.seats[1]!.bolts.map((o) => o.kind)).toContain("lagScrew");
    const lags = beam.seats.flatMap((s) => s.bolts.filter((o) => o.kind === "lagScrew"));
    expect(lags.length).toBeGreaterThanOrEqual(3);
    expect(expectLagScrewsInsideBeam(beam, tm)).toBe(lags.length);
    // Plus aucun constat : toutes les marches ont leurs organes.
    const fixing = r.checks.results.filter((c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.bolts.id);
    expect(fixing.map((c) => [c.status, c.message.key])).toEqual([
      ["ok", "structure.woodCentral.check.fixings.ok"],
    ]);
    expect(fr(fixing[0]!.message)).toMatch(/tire-fonds sur 2 assise\(s\)/);
    expect(beam.notes.map((n) => n.key)).toContain("structure.woodCentral.note.lagScrews");
    // Deux couches : organes au milieu d'une couche, hors du joint de colle central.
    expect(beam.notes.map((n) => n.key)).toContain("structure.woodCentral.note.boltOffset");
    const nBolts = beam.seats.reduce(
      (n, s) => n + s.bolts.filter((o) => o.kind === "bolt").length,
      0,
    );
    expect(expectBoltsInsideBeam(beam, tm)).toBe(nBolts);
    for (const s of beam.seats) {
      expect(s.bolts).toHaveLength(2);
      for (const b of s.bolts) {
        expect(b.lateral).toBe(22);
        expect(b.length % 10).toBe(0);
        expect(b.length).toBeGreaterThan(tm);
        // Pince a3,c = 4·d = 40 mm (M10 dans un perçage de 11, EC5 via C §1.11 [71]).
        expect(b.sigma).toBeGreaterThanOrEqual(s.sigma0 + 40 - 1e-6);
        expect(b.sigma).toBeLessThanOrEqual(s.sigma1 - 40 + 1e-6);
      }
      // Entraxe a1 = 5·d = 50 mm.
      for (let i = 1; i < s.bolts.length; i++) {
        expect(s.bolts[i]!.sigma - s.bolts[i - 1]!.sigma).toBeGreaterThanOrEqual(50 - 1e-6);
      }
    }
    const fixings = part.fixings ?? [];
    expect(fixings.every((f) => f.holeDiameter === 11)).toBe(true);
    const points = (joint: string) =>
      fixings.filter((f) => f.joint === joint).reduce((n, f) => n + f.points, 0);
    expect(points("treadBeamBolted")).toBe(nBolts);
    expect(points("treadBeamLagScrewed")).toBe(lags.length);
    expect(points("treadBeamBolted") + points("treadBeamLagScrewed")).toBe(2 * beam.seats.length);
    for (const s of beam.seats) {
      for (const [kind, joint] of [
        ["bolt", "treadBeamBolted"],
        ["lagScrew", "treadBeamLagScrewed"],
      ] as const) {
        const mine = fixings.filter((f) => f.joint === joint && f.with?.[0] === s.treadPartId);
        expect(mine.map((f) => f.length).sort()).toEqual(
          [...new Set(s.bolts.filter((o) => o.kind === kind).map((b) => b.length))].sort(),
        );
      }
    }
    // Développé : un trait par tire-fond, de l'assise à la pointe, libellé avec l'avant-trou.
    const lagLines = part.flat!.lines.filter(
      (l) => l.label !== undefined && l.label.key === "structure.woodCentral.flatLine.lagScrew",
    );
    expect(lagLines).toHaveLength(lags.length);
    expect(fr(lagLines[0]!.label!)).toMatch(/^Tire-fond Ø10 × \d+, avant-trou Ø7$/);
    expect(EN.t(lagLines[0]!.label!)).toMatch(/^Coach screw Ø10 × \d+, pilot hole Ø7$/);
  });

  it("tire-fonds : longueur au pas inférieur, bornée par le bois disponible et par maxLength", () => {
    const short = beamFor(project, { lagScrews: { maxLength: 120 } })!;
    const lags = short.beam.seats.flatMap((s) => s.bolts.filter((o) => o.kind === "lagScrew"));
    expect(lags.length).toBeGreaterThan(0);
    for (const o of lags) expect(o.length).toBeLessThanOrEqual(120);
    expectLagScrewsInsideBeam(short.beam, tm, { maxLength: 120 });
    // Pointe épargnée de 60 mm : bois disponible réduit, longueurs plus courtes ou égales.
    const covered = beamFor(project, { lagScrews: { tipCover: 60 } })!;
    expectLagScrewsInsideBeam(covered.beam, tm, { tipCover: 60 });
  });

  it("bois insuffisant pour un tire-fond : le constat reste, message dédié", () => {
    const deep = beamFor(project, { lagScrews: { minAnchorage: 400 } })!;
    expect(deep.beam.seats[0]!.bolts).toEqual([]);
    const bad = deep.checks.results.filter(
      (c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.bolts.id && c.status === "violation",
    );
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.message.key).toBe("structure.woodCentral.check.fixings.lagShort");
    expect(bad[0]!.location).toMatchObject({ partId: WOOD_CENTRAL_BEAM_ID, treadNumber: 1 });
    expect(fr(bad[0]!.message)).toMatch(
      /bois insuffisant pour un tire-fond \(\d+ mm d'ancrage < 400 mm\)/,
    );
    expect(EN.t(bad[0]!.message)).toMatch(/not enough timber for a coach screw/);
  });

  it("entraxes et pinces de l'EC5 : demi-couche à 22 mm des faces (< a4,c = 30 mm) signalée", () => {
    const spacing = r.checks.results.filter((c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.spacing.id);
    // Décalage d'une demi-couche sur 2 couches de 44 mm (A34 (d)) : 22 mm < 3·d = 30 mm.
    expect(spacing.map((c) => [c.status, c.message.key])).toEqual([
      ["violation", "structure.woodCentral.check.spacing.face"],
    ]);
    expect(spacing[0]!.measured).toBeCloseTo(22, 9);
    expect(spacing[0]!.min).toBe(30);
    expect(spacing[0]!.severity).toBe("avertissement");
    // Une seule couche (organes sur l'axe) : entraxes et pinces tenus.
    const one = beamFor(project, { section: { lamellaThickness: 88 } })!;
    const ok = one.checks.results.filter((c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.spacing.id);
    expect(ok.map((c) => c.status)).toEqual(["ok"]);
    expect(fr(ok[0]!.message)).toMatch(/entraxe ≥ 50 mm, bouts ≥ 40 mm, faces ≥ 30 mm/);
  });

  it("entraxes et pinces saisis sous l'EC5 : entraxe et bouts signalés par assise", () => {
    const tight = beamFor(project, {
      section: { lamellaThickness: 88 },
      bolts: { perTread: 3, minSpacing: 20, edgeDistance: 100 },
    })!;
    const pitch = tight.checks.results.filter(
      (c) => c.message.key === "structure.woodCentral.check.spacing.pitch",
    );
    expect(pitch.length).toBeGreaterThan(0);
    for (const c of pitch) {
      expect(c.status).toBe("violation");
      expect(c.measured!).toBeLessThan(50);
      expect(c.location).toMatchObject({ partId: WOOD_CENTRAL_BEAM_ID });
    }
    const ends = beamFor(project, {
      section: { lamellaThickness: 88 },
      bolts: { edgeDistance: 20 },
    })!.checks.results.filter((c) => c.message.key === "structure.woodCentral.check.spacing.end");
    // Toutes les assises sauf celles où un perçage de sabot écarte les organes du bout.
    expect(ends.length).toBeGreaterThanOrEqual(beamFor(project)!.beam.seats.length - 2);
    for (const c of ends) {
      expect(c.measured!).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(c.measured!).toBeLessThan(40);
    }
  });

  it("boulons de marche écartés des boulons des sabots (aucun perçage croisé)", () => {
    // Joues de tête courtes : les boulons du sabot de tête tombent sur l'assise de la dernière
    // marche, dont les boulons doivent s'en écarter.
    const near = beamFor(project, { anchors: { cheekDepth: 60 } })!;
    expect(near.beam.errors).toEqual([]);
    const last = near.beam.seats.at(-1)!;
    const s0 = near.beam.seats[0]!.sigma0;
    const flat = near.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!.flat!;
    expect(flat.outline.holes).toHaveLength(4);
    const headX = Math.max(...flat.outline.holes.flatMap((h) => h.map((q) => q.x)));
    expect(headX + s0).toBeGreaterThan(last.sigma0 + 30);
    expect(headX + s0).toBeLessThan(last.sigma1);
    expect(last.bolts.length).toBeGreaterThan(0);
    expectBoltsInsideBeam(near.beam, tm);
  });

  it("sabots de pied et de tête : U plié, chevilles et boulons déclarés, assemblés à la poutre", () => {
    const foot = beam.parts.find((p) => p.id === WOOD_CENTRAL_SHOE_FOOT_ID)!;
    const head = beam.parts.find((p) => p.id === WOOD_CENTRAL_SHOE_HEAD_ID)!;
    expect(foot.mark).toBe("SP1");
    expect(head.mark).toBe("ST1");
    for (const [p, joint] of [
      [foot, "plateFloor"],
      [head, "plateTrimmer"],
    ] as const) {
      expect(p.category).toBe("fixing");
      expect(p.material).toBe("steel-painted");
      expect(p.flat!.lines.filter((l) => l.kind === "bend")).toHaveLength(2);
      expect(p.flat!.outline.holes).toHaveLength(2 + 2 * 2);
      expect(p.fixings).toEqual([
        { joint, points: 2, holeDiameter: 13 },
        {
          joint: "shoeBolted",
          points: 2,
          holeDiameter: 13,
          // b + 2 t + 2 jeu + dépassement = 88 + 12 + 2 + 20 = 122 → 130.
          length: 130,
          with: [WOOD_CENTRAL_BEAM_ID],
        },
      ]);
      expect(solidProblem(p.solid)).toBeUndefined();
      expect(beam.assemblies).toContainEqual({
        a: { partId: p.id },
        b: { partId: WOOD_CENTRAL_BEAM_ID },
      });
    }
    const fit = r.checks.results.filter((c) => c.ruleId === "FAB_SABOT_EMPRISE");
    expect(fit.map((c) => c.status)).toEqual(["ok", "ok"]);
  });

  it("développé non dégénéré : contour, repères des nez, assises, perçages", () => {
    const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    const flat = part.flat!;
    expect(Math.abs(signedArea(flat.outline.outer))).toBeGreaterThan(1e5);
    expect(Math.min(...flat.outline.outer.map((p) => p.x))).toBeCloseTo(0, 9);
    expect(flat.thickness).toBe(88);
    expect(flat.reference?.kind).toBe("face");
    const labels = flat.lines.map((l) => (l.label ? fr(l.label) : ""));
    // N0 est devant la face avant (débord) ; N1 est sur la poutre.
    expect(labels).toContain("N1");
    const nBolts = beam.seats.reduce(
      (n, s) => n + s.bolts.filter((o) => o.kind === "bolt").length,
      0,
    );
    expect(labels.filter((l) => l === "Perçage Ø11")).toHaveLength(nBolts);
    // Perçages des boulons de sabot (2 × SP1, 2 × ST1) : vrais trous du développé.
    expect(flat.outline.holes).toHaveLength(4);
    expect(labels.filter((l) => l === "Perçage Ø13 (sabot SP1)")).toHaveLength(2);
    expect(labels.filter((l) => l === "Perçage Ø13 (sabot ST1)")).toHaveLength(2);
    for (const h of flat.outline.holes) {
      for (const q of h) expect(pointInPolygon(q, flat.outline.outer, 1e-6)).toBe("inside");
    }
    expect(labels.filter((l) => l.startsWith("Assise "))).toHaveLength(beam.seats.length);
    expect(labels).toContain("LC1");
    expect(flat.lines.some((l) => l.kind === "roll")).toBe(false);
    expect(beam.assemblies.filter((a) => "treadNumber" in a.b)).toHaveLength(beam.seats.length);
  });

  it("section de prédimensionnement b × reste sous entaille", () => {
    const h = Math.min(...beam.seats.map((s) => s.residual));
    expect(beam.section.area).toBeCloseTo(88 * h, 6);
    expect(beam.section.i).toBeCloseTo((88 * h ** 3) / 12, 3);
    expect(beam.spanH).toBeGreaterThan(1000);
  });
});

describe("tableau FCBA exploitable (escalier droit court, chêne D40)", () => {
  it("reste sous entaille auto = distance exigée à b / facteur", () => {
    const p = noRisers(makeSteppingProject({ width: 900, legs: [2000], floorToFloor: 2400 }));
    const r = beamFor(p)!;
    const required = requiredCentralResidual(fcbaTable(), "D40", 88);
    expect(required).not.toBeNull();
    expect(r.beam.fcba).toEqual({ cls: "D40", required });
    expect(r.beam.residual).toBe(required);
  });

  it("lamellé-collé (`wood-glulam`) : classe inconnue, tableau non exploitable", () => {
    const p = noRisers(makeSteppingProject({ width: 900, legs: [2000], floorToFloor: 2400 }));
    const r = beamFor(p, { material: "wood-glulam" })!;
    expect(r.beam.fcba.cls).toBe("unknown");
    expect(r.beam.fcba.unusable?.key).toBe("structure.woodCut.fcba.unknownClass");
    expect(r.beam.residual).toBe(180);
  });
});

describe("équivalence avec wood-cut (droit à girons égaux, sans entaille arrière)", () => {
  for (const nosing of [0, 30]) {
    it(`même contour, même rive basse, même reste sous entaille (débord ${nosing} mm)`, () => {
      const p = noRisers(
        makeSteppingProject({ width: 900, legs: [3200], floorToFloor: 2700 }),
        nosing,
      );
      const r = beamFor(p, {
        notch: { rearDepth: 0 },
        section: { residual: 150 },
        anchors: { foot: false, head: false },
      })!;
      expect(r.beam.errors).toEqual([]);
      const cut = buildWoodCut(r.ctx, WoodCutParamsSchema.parse({ residual: 150 }));
      const carriage = cut.carriages[0]!;
      const minU = Math.min(...carriage.outline.map((q) => q.x));
      const wc = carriage.outline.map((q) => V.vec(q.x - minU, q.y));
      const mine = r.beam.parts.find((q) => q.id === WOOD_CENTRAL_BEAM_ID)!.flat!.outline.outer;
      for (const q of wc) expect(boundaryDistance(q, mine)).toBeLessThan(1e-6);
      for (const q of mine) expect(boundaryDistance(q, wc)).toBeLessThan(1e-6);
      expect(Math.min(...r.beam.seats.map((s) => s.residual))).toBeCloseTo(carriage.residual, 6);
      expect(r.beam.seats.every((s) => s.rearDepth === 0)).toBe(true);
    });
  }
});

describe("quart tournant : lamellé-collé cintré sur moule (filière choisie)", () => {
  const MOULD = { section: { curvedMethod: "mould" } };
  const r = beamFor(noRisers(createProject("quarter-left")), MOULD)!;

  it("lamelles auto ⌊r_in / 240⌋ ≥ 1, k_r = 1, portées cintrées", () => {
    const lam = r.beam.lamination;
    expect(r.beam.errors.map(fr)).toEqual([]);
    expect(r.beam.curvedMethod).toBe("mould");
    expect(lam.method).toBe("mould");
    expect(lam.curved).toBe(true);
    const rIn = Math.min(...r.trace.arcs.map((a) => a.radius - 44));
    expect(lam.innerRadius).toBeCloseTo(rIn, 9);
    const wanted = Math.max(1, Math.floor(rIn / REC));
    expect(lam.lamellae).toBe(Math.ceil(88 / wanted));
    // Lamelles égales : la composition redonne b.
    expect(lam.lamellaThickness).toBeCloseTo(88 / lam.lamellae, 12);
    expect(lam.lamellaThickness).toBeLessThanOrEqual(wanted);
    expect(lam.ratio).toBeGreaterThanOrEqual(REC);
    expect(lam.kr).toBe(1);
    expect(lam.bends.length).toBeGreaterThan(0);
    // Débit : un placage par lamelle, acheté à l'épaisseur de la lamelle (A34 (e)) ; longueur
    // et largeur avec les surcotes du profil d'atelier.
    const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(part.stock).toMatchObject({
      count: lam.lamellae,
      thickness: lam.lamellaThickness,
      supply: "veneer",
    });
    const wood = resolveWorkshopProfile(r.ctx.project.workshop).wood;
    const box = part.quantities["length_mm"]!;
    expect(part.stock!.length).toBeCloseTo(box + wood.lengthAllowance, 9);
    expect(part.quantities["mass_kg"]).toBeGreaterThan(0);
    // Poutre de 88 mm cintrée sur moule : hors du domaine « < 60 mm » de la source, remarque.
    expect(r.beam.notes.map((n) => n.key)).toContain("structure.woodCentral.note.mouldDomain");
    expect(r.beam.fcba.unusable?.key).toBe("structure.woodCentral.fcba.curved");
  });

  it("solide réglé valide, développé avec lignes de cintrage, remarque sur les entailles", () => {
    const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(part.solid.kind).toBe("ruled");
    expect(solidProblem(part.solid)).toBeUndefined();
    const rolls = part.flat!.lines.filter((l) => l.kind === "roll");
    expect(rolls.length).toBeGreaterThan(0);
    expect(fr(rolls[0]!.label!)).toMatch(/^Cintrage sur moule R = \d+ mm$/);
    expect(fr(part.section!)).toMatch(/^lamellé-collé cintré 88 × \d+/);
    expect(r.beam.notes.map((n) => n.key)).toContain("structure.woodCentral.note.notchNot3d");
    // Aucun contrôle de débit sur une trace courbe (plis non comparés aux plateaux).
    expect(r.checks.results.some((c) => c.ruleId === "FAB_DEBIT_DISPONIBLE")).toBe(false);
  });
});

describe("hélicoïdal : lamellé-collé cintré", () => {
  it("poutre générée, k_r = 1, solide réglé valide", () => {
    const r = beamFor(noRisers(createProject("helical")), {
      section: { curvedMethod: "mould" },
    })!;
    expect(r.beam.errors.map(fr)).toEqual([]);
    expect(r.trace.kind).toBe("helical");
    expect(r.beam.lamination.kr).toBe(1);
    const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(solidProblem(part.solid)).toBeUndefined();
    expect(r.beam.seats).toHaveLength(r.ctx.stepping.treads.length);
    expect(r.beam.lamination.lamellaThickness * r.beam.lamination.lamellae).toBeCloseTo(88, 9);
    expectBoltsInsideBeam(r.beam, r.ctx.project.stair.treads.thickness);
  });

  it("sabots choisis sur la poutre cintrée : écart aux joues signalé (FAB_SABOT_EMPRISE)", () => {
    const r = beamFor(noRisers(createProject("helical")), { anchors: { kind: "shoe" } })!;
    expect(r.beam.anchorKind).toBe("shoe");
    const curved = r.checks.results.filter(
      (c) =>
        c.ruleId === "FAB_SABOT_EMPRISE" &&
        c.message.key === "structure.woodCentral.check.shoe.curved",
    );
    expect(curved.length).toBeGreaterThan(0);
    for (const c of curved) {
      expect(c.status).toBe("violation");
      expect(c.measured!).toBeGreaterThan(1);
    }
    // Quart tournant : départ et arrivée droits, sabots droits sans écart.
    const q = beamFor(noRisers(createProject("quarter-left")), { anchors: { kind: "shoe" } })!;
    expect(
      q.checks.results.some((c) => c.message.key === "structure.woodCentral.check.shoe.curved"),
    ).toBe(false);
  });
});

// ------------------------------------------------------------------ Filières et ancrages

describe("filière sur trace courbe (A33 (e)) : couches empilées par défaut au-delà de 60 mm", () => {
  it("choix auto : couches empilées (b = 88 > 60), moule (b = 50, ou filière choisie)", () => {
    const quarter = noRisers(createProject("quarter-left"));
    const auto = beamFor(quarter)!;
    expect(auto.beam.curvedMethod).toBe("stacked");
    expect(auto.beam.lamination.method).toBe("stacked");
    const narrow = beamFor(quarter, { section: { width: 50 } })!;
    expect(narrow.beam.curvedMethod).toBe("mould");
    expect(narrow.beam.lamination.curved).toBe(true);
    const forced = beamFor(quarter, { section: { curvedMethod: "mould" } })!;
    expect(forced.beam.lamination.method).toBe("mould");
    const raised = beamFor(quarter, { section: { mouldMaxWidth: 100 } })!;
    expect(raised.beam.lamination.method).toBe("mould");
    // Trace droite : couches droites, aucune filière courbe.
    const straight = beamFor(noRisers(createProject("straight")), {
      section: { curvedMethod: "stacked" },
    })!;
    expect(straight.beam.curvedMethod).toBeNull();
    expect(straight.beam.lamination.method).toBe("straight");
  });

  for (const id of ["quarter-left", "helical"] as const) {
    it(`${id} : sans cintrage (k_r = 1), poutre finie sans débit ni matière, couches composantes`, () => {
      const r = beamFor(noRisers(createProject(id)))!;
      const { beam } = r;
      expect(beam.errors.map(fr)).toEqual([]);
      expect(beam.lamination).toMatchObject({
        kind: "glulam",
        method: "stacked",
        curved: false,
        kr: 1,
        ratio: Infinity,
        bends: [],
      });
      expect(beam.stacked).not.toBeNull();
      expect(beam.lamination.lamellae).toBe(beam.stacked!.count);
      expect(beam.lamination.lamellaThickness).toBe(beam.stacked!.layerThickness);
      const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
      expect(part.stock).toBeUndefined();
      expect(Object.keys(part.quantities).sort()).toEqual(
        ["lamella_thickness_mm", "lamellae", "length_mm"].sort(),
      );
      expect(part.solid.kind).toBe("ruled");
      expect(solidProblem(part.solid)).toBeUndefined();
      expect(part.flat).toBeDefined();
      expect(part.fixings?.length).toBeGreaterThan(0);
      expect(fr(part.section!)).toMatch(
        /^lamellé-collé en couches empilées 88 × \d+, \d+ couches de/,
      );
      expect(EN.t(part.section!)).toMatch(/^stacked-layer glulam 88 × \d+/);
      // Couches composantes (câblage) : rattachées à la poutre, autant que `lamellae`.
      const layers = beam.parts.filter((p) => p.componentOf !== undefined);
      expect(layers).toHaveLength(beam.stacked!.count);
      for (const l of layers) expect(l.componentOf).toBe(WOOD_CENTRAL_BEAM_ID);
      // Pas de cintrage : ni lignes de moule, ni remarque sur le domaine du moule ; débit et
      // longueur de plateau de LC1 non contrôlés (les couches le sont).
      expect(part.flat!.lines.some((l) => l.kind === "roll")).toBe(false);
      const keys = beam.notes.map((n) => n.key);
      expect(keys).toContain("structure.woodCentral.note.stackedGlulam");
      expect(keys).not.toContain("structure.woodCentral.note.mouldDomain");
      const onBeam = (rule: string) =>
        r.checks.results.filter(
          (c) =>
            c.ruleId === rule &&
            c.location.kind === "part" &&
            c.location.partId === WOOD_CENTRAL_BEAM_ID,
        );
      expect(onBeam("FAB_DEBIT_DISPONIBLE")).toEqual([]);
      expect(onBeam("FAB_PLATEAU_LONGUEUR_MAX")).toEqual([]);
    });
  }

  it("couches empilées : épaisseur de lamelle saisie sans effet, aucun refus de cintrage", () => {
    const r = beamFor(noRisers(createProject("quarter-left")), {
      section: { lamellaThickness: 10 },
    })!;
    expect(r.beam.errors).toEqual([]);
    expect(r.beam.lamination.method).toBe("stacked");
  });
});

describe("ancrages (A33 (f), A34 (c)) : platine à âme noyée par défaut sur une poutre cintrée", () => {
  it("auto : platine sur quart tournant et hélicoïdal, sabot sur droit", () => {
    for (const [id, kind] of [
      ["quarter-left", "embeddedPlate"],
      ["helical", "embeddedPlate"],
      ["straight", "shoe"],
    ] as const) {
      const r = beamFor(noRisers(createProject(id)))!;
      expect(r.beam.anchorKind, id).toBe(kind);
      const shoes = r.beam.parts.filter(
        (p) => p.id === WOOD_CENTRAL_SHOE_FOOT_ID || p.id === WOOD_CENTRAL_SHOE_HEAD_ID,
      );
      const fit = r.checks.results.filter((c) => c.ruleId === "FAB_SABOT_EMPRISE");
      if (kind === "shoe") {
        expect(shoes).toHaveLength(2);
        expect(fit.length).toBeGreaterThan(0);
        expect(r.beam.anchorsWelded).toBe(false);
      } else {
        // FAB_SABOT_EMPRISE ne concerne que le sabot choisi explicitement.
        expect(shoes).toEqual([]);
        expect(fit).toEqual([]);
      }
    }
  });

  it("platine choisie sur un droit : coupe au sol sur la platine, traits de scie et broches tracés", () => {
    const project = noRisers(createProject("straight"));
    const r = beamFor(project, { anchors: { kind: "embeddedPlate" } })!;
    expect(r.beam.anchorKind).toBe("embeddedPlate");
    const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    // Coupe de niveau sur le dessus de la platine de pied (anchors.plate.thickness = 8).
    expect(Math.min(...part.flat!.outline.outer.map((q) => q.y))).toBeCloseTo(8, 9);
    const webs = r.beam.parts.filter(
      (p) => p.id.startsWith("wood-central-plate-") && p.id.endsWith("-web"),
    );
    const kerfLabels = part.flat!.lines.filter(
      (l) => l.label !== undefined && l.label.key === "structure.woodCentral.flatLine.beamKerf",
    );
    expect(kerfLabels).toHaveLength(webs.length);
    const dowelLabels = part.flat!.lines.filter(
      (l) => l.label !== undefined && l.label.key === "structure.woodCentral.flatLine.beamDowel",
    );
    expect(dowelLabels).toHaveLength(part.flat!.outline.holes.length);
    // Aucun organe de marche traversant dans le plan d'une âme ni sur une broche.
    expectBoltsInsideBeam(r.beam, project.stair.treads.thickness, { floor: 8 });
    expectLagScrewsInsideBeam(r.beam, project.stair.treads.thickness);
    // Sans pied ni tête : aucune platine, poutre au sol.
    const none = beamFor(project, {
      anchors: { kind: "embeddedPlate", foot: false, head: false },
    })!;
    const p0 = none.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(Math.min(...p0.flat!.outline.outer.map((q) => q.y))).toBeCloseTo(0, 9);
  });

  it("tête : coupe d'aplomb reculée de l'épaisseur d'ancrage (sabot 6 mm, platine 8 mm) et du jeu", () => {
    const project = noRisers(createProject("straight"));
    const end = (over: Record<string, unknown>) =>
      Math.max(
        ...beamFor(project, over)!
          .beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!
          .flat!.outline.outer.map((q) => q.x),
      );
    const free = end({ anchors: { head: false } });
    expect(free - end({ anchors: { kind: "shoe" } })).toBeCloseTo(6 + 1, 6);
    expect(free - end({ anchors: { kind: "embeddedPlate" } })).toBeCloseTo(8 + 1, 6);
  });
});

describe("refus et configurations non prises en charge", () => {
  it("lamelles de 10 mm sur un quart tournant : rayon de cintrage trop petit, aucune pièce", () => {
    const ctx = woodCentralContext(createProject("quarter-left"));
    const { beam } = woodBeamOf(
      ctx,
      woodCentralParams({ section: { lamellaThickness: 10, curvedMethod: "mould" } }),
    );
    expect(beam.parts).toEqual([]);
    expect(beam.beamPartId).toBeUndefined();
    expect(beam.seats).toEqual([]);
    expect(beam.lamination.ratio).toBeLessThan(MIN);
    expect(beam.lamination.kr).toBeNaN();
    expect(beam.errors.map((e) => e.key)).toEqual(["structure.woodCentral.error.bendRadius"]);
    expect(fr(beam.errors[0]!)).toMatch(/^Limon central bois : rayon de cintrage trop petit/);
    expect(EN.t(beam.errors[0]!)).toMatch(/^Timber mono-stringer: bending radius too small/);
  });

  it("rayon trop petit même pour des lamelles de 1 mm : refus sans conseiller des lamelles plus fines", () => {
    const ctx = woodCentralContext(createProject("quarter-left"));
    const { beam } = woodBeamOf(
      ctx,
      woodCentralParams({ trace: { lateralOffset: 300 }, section: { curvedMethod: "mould" } }),
    );
    expect(beam.parts).toEqual([]);
    expect(beam.lamination.lamellaThickness).toBe(1);
    expect(beam.errors.map((e) => e.key)).toEqual(["structure.woodCentral.error.bendRadiusMinPly"]);
    expect(fr(beam.errors[0]!)).not.toMatch(/lamelles plus fines/);
    expect(fr(beam.errors[0]!)).toMatch(/jour plus large/);
  });

  it("épaisseur de lamelle saisie : lamelles égales dont la somme redonne b", () => {
    const straight = noRisers(createProject("straight"));
    for (const [t, n] of [
      [30, 3],
      [44, 2],
      [1000, 1],
    ] as const) {
      const r = beamFor(straight, { section: { lamellaThickness: t } })!;
      expect(r.beam.lamination.lamellae).toBe(n);
      expect(r.beam.lamination.lamellaThickness).toBeCloseTo(88 / n, 12);
      const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
      expect(part.quantities[QUANTITY_LAMELLAE]).toBe(n);
      expect(part.stock!.count).toBe(n);
    }
  });

  it("bois massif sur un tournant : erreur explicite, aucune poutre", () => {
    const ctx = woodCentralContext(createProject("quarter-left"));
    const { beam } = woodBeamOf(ctx, woodCentralParams({ section: { kind: "solid" } }));
    expect(beam.parts).toEqual([]);
    expect(beam.errors.map((e) => e.key)).toEqual([
      "structure.woodCentral.unsupported.solidCurved",
    ]);
  });

  it("bois massif sur un droit : une pièce, débit contrôlé", () => {
    const r = beamFor(noRisers(createProject("straight")), { section: { kind: "solid" } })!;
    expect(r.beam.lamination).toMatchObject({ kind: "solid", lamellae: 1, kr: 1 });
    const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(fr(part.section!)).toMatch(/^massif 88 × \d+$/);
    expect(part.quantities[QUANTITY_LAMELLAE]).toBeUndefined();
    expect(r.checks.results.some((c) => c.ruleId === "FAB_DEBIT_DISPONIBLE")).toBe(true);
  });

  it("pinces trop grandes : boulons non placés, constat localisé sur la marche", () => {
    const r = beamFor(noRisers(createProject("straight")), { bolts: { edgeDistance: 200 } })!;
    const bad = r.checks.results.filter(
      (c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.bolts.id && c.status === "violation",
    );
    expect(bad.length).toBe(r.beam.seats.length);
    expect(bad[0]!.location).toMatchObject({ kind: "part", partId: WOOD_CENTRAL_BEAM_ID });
  });

  it("semelle plus longue que la coupe au sol : sabot réduit, constat en violation", () => {
    const r = beamFor(noRisers(createProject("straight")), { anchors: { length: 5000 } })!;
    const fit = r.checks.results.filter((c) => c.ruleId === "FAB_SABOT_EMPRISE");
    expect(fit.map((c) => c.status)).toEqual(["violation", "violation"]);
    const foot = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_SHOE_FOOT_ID);
    expect(foot).toBeDefined();
    expect(Math.max(...foot!.flat!.outline.outer.map((q) => q.y))).toBeLessThan(5000);
  });

  it("contremarches pleines (A33 (i)) : marche prolongée sous la contremarche, dent derrière elle", () => {
    const closed = createProject("straight");
    const sp = closed.stair.treads;
    const rt = sp.riserThickness;
    const r = beamFor(closed)!;
    const open = beamFor(noRisers(closed))!;
    expect(r.beam.errors).toEqual([]);
    const inner = r.beam.seats.slice(0, -1);
    expect(inner.length).toBeGreaterThan(0);
    for (const s of inner) {
      expect(s.rearDepth).toBeCloseTo(15, 6);
      expect(Number.isFinite(s.toothAbove)).toBe(true);
    }
    // Escalier droit (lignes de nez d'équerre sur la trace) : chaque dent (début de l'assise
    // suivante) est à la face arrière de la contremarche, soit rt + entaille plus loin que
    // sans contremarche (dent à l'entaille devant la ligne du débord).
    for (let i = 1; i < r.beam.seats.length; i++) {
      expect(r.beam.seats[i]!.sigma0 - open.beam.seats[i]!.sigma0).toBeCloseTo(rt + 15, 6);
    }
    expect(r.beam.notes.map((n) => n.key)).toContain("structure.woodCentral.note.riserHousing");
    // Pièces de base remplacées : marche entaillée prolongée de rt + entaille sous la
    // contremarche suivante, contremarche posée sur la marche (aucune interpénétration).
    const base = r.ctx.baseParts!;
    const zRange = (p: Part): [number, number] => {
      const e = readPlanExtrusion(p.solid)!;
      return [e.zBottom, e.zBottom + e.height];
    };
    for (const s of inner) {
      const tread = r.beam.parts.find((p) => p.id === `tread-${s.tread}`)!;
      const before = base.find((p) => p.id === `tread-${s.tread}`)!;
      const riser = r.beam.parts.find((p) => p.id === `riser-${s.tread + 1}`)!;
      expect(tread, `tread-${s.tread}`).toBeDefined();
      expect(riser, `riser-${s.tread + 1}`).toBeDefined();
      expect(tread.stock!.width - before.stock!.width).toBeCloseTo(rt + 15, 6);
      expect(zRange(riser)[0]).toBeCloseTo(zRange(tread)[1], 9);
      // La contremarche (σ du nez + débord à + rt) est devant la dent (début de l'assise suivante).
      const next = r.beam.seats.find((q) => q.tread === s.tread + 1)!;
      const nosingSigma = r.trace.nosingSigma[s.tread]!;
      expect(next.sigma0).toBeGreaterThanOrEqual(nosingSigma + sp.nosing + rt - 1e-6);
    }
    // Marche simplement posée (entaille nulle saisie) : chemin conservé.
    const laid = beamFor(closed, { notch: { rearDepth: 0 } })!;
    expect(laid.beam.seats.every((s) => s.rearDepth === 0 && s.toothAbove === Infinity)).toBe(true);
  });
});

// ------------------------------------------------------------------ Propriétés

describe("propriétés (générateurs contraints)", () => {
  it("laminationKr : 1 dès `recommande`, kr_a + kr_b·r entre `min` et `recommande`, NaN sous `min`", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2000, noNaN: true }), (ratio) => {
        const kr = laminationKr(ratio);
        if (ratio < MIN) expect(kr).toBeNaN();
        else if (ratio >= REC) expect(kr).toBe(1);
        else {
          expect(kr).toBeCloseTo(KR_A + KR_B * ratio, 12);
          expect(kr).toBeGreaterThanOrEqual(KR_A + KR_B * MIN - 1e-12);
          expect(kr).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(
        fc.double({ min: MIN, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (a, d) => {
          expect(laminationKr(a + d)).toBeGreaterThanOrEqual(laminationKr(a) - 1e-12);
        },
      ),
    );
    // Continuité en `recommande`.
    expect(laminationKr(REC - 1e-9)).toBeCloseTo(1, 6);
    expect(laminationKr(Number.NaN)).toBeNaN();
  });

  const straightArb = fc
    .record({
      H: fc.integer({ min: 2200, max: 3300 }),
      E: fc.integer({ min: 700, max: 1200 }),
      nosing: fc.integer({ min: 0, max: 40 }),
    })
    .map(({ H, E, nosing }) => {
      const n = Math.round(H / 175);
      const g = 630 - (2 * H) / n;
      return makeSteppingProject({
        width: E,
        legs: [Math.round((n - 1) * g)],
        floorToFloor: H,
        treads: { nosing },
      });
    });
  const projectArb = fc.oneof(
    straightArb,
    stairArb().map((s) => s.project),
    fc
      .constantFrom<PresetId>("helical", "quarter-landing", "quarter-left", "straight")
      .map((id) => createProject(id)),
  );
  const paramsArb = fc.record({
    material: fc.constantFrom("wood-oak", "wood-pine", "wood-glulam"),
    trace: fc.record({
      lateralOffset: fc.oneof(fc.constant(0), fc.integer({ min: -60, max: 60 })),
    }),
    section: fc.record({
      width: fc.integer({ min: 60, max: 140 }),
      residual: fc.oneof(fc.constant("auto"), fc.integer({ min: 80, max: 250 })),
    }),
    notch: fc.record({ rearDepth: fc.oneof(fc.constant("auto"), fc.integer({ min: 0, max: 30 })) }),
    bolts: fc.record({ perTread: fc.integer({ min: 0, max: 3 }) }),
    lagScrews: fc.record({
      minAnchorage: fc.integer({ min: 20, max: 120 }),
      tipCover: fc.integer({ min: 0, max: 40 }),
    }),
    anchors: fc.record({
      foot: fc.boolean(),
      head: fc.boolean(),
      kind: fc.constantFrom("auto", "shoe", "embeddedPlate"),
    }),
  });
  const risersArb = fc.constantFrom("full", "none", "open") as fc.Arbitrary<
    Project["stair"]["treads"]["risers"]
  >;

  it("assises sous chaque marche, sous le dessous de la marche, reste sous entaille tenu, aucune exception", () => {
    let complete = 0;
    fc.assert(
      fc.property(projectArb, paramsArb, risersArb, (base, params, risers) => {
        const project: Project = {
          ...base,
          stair: { ...base.stair, treads: { ...base.stair.treads, risers } },
        };
        let r: ReturnType<typeof beamFor> = null;
        expect(() => {
          r = beamFor(project, params);
        }).not.toThrow();
        if (r === null) return;
        const { beam, ctx } = r as NonNullable<ReturnType<typeof beamFor>>;
        for (const p of beam.parts) {
          for (const [k, v] of Object.entries(p.quantities)) {
            expect(Number.isFinite(v) && v >= 0, `${p.id}.${k} = ${v}`).toBe(true);
          }
        }
        if (beam.errors.length > 0 || beam.parts.length === 0) return;
        complete++;
        const tm = project.stair.treads.thickness;
        expect(beam.seats.map((s) => s.tread)).toEqual(ctx.stepping.treads.map((t) => t.number));
        for (const s of beam.seats) {
          const t = ctx.stepping.treads.find((x) => x.number === s.tread)!;
          expect(s.z).toBeLessThanOrEqual(t.z - tm + 1e-9);
          expect(s.sigma0).toBeLessThan(s.sigma1);
          expect(s.toothAbove).toBeGreaterThanOrEqual(0);
          expect(s.residual).toBeGreaterThanOrEqual(beam.residual - 1e-6);
          expect(s.rearDepth).toBeGreaterThanOrEqual(0);
          for (const b of s.bolts) {
            expect(b.sigma).toBeGreaterThan(s.sigma0);
            expect(b.sigma).toBeLessThan(s.sigma1);
          }
        }
        // Entaille arrière : chaque marche non finale (contremarches pleines comprises, A33 (i))
        // est logée de la profondeur retenue dans la dent suivante.
        if (beam.rearDepth > 0) {
          for (const s of beam.seats.slice(0, -1)) {
            expect(s.rearDepth, `M${s.tread}`).toBeGreaterThanOrEqual(beam.rearDepth - 1e-6);
            expect(s.sigma1).toBeGreaterThan(s.sigma0);
          }
        }
        // Lamelles égales dont la somme redonne b (couches empilées : épaisseur de couche).
        const lam = beam.lamination;
        if (lam.method !== "stacked") {
          expect(lam.lamellae * lam.lamellaThickness).toBeCloseTo(
            (params.section as { width: number }).width,
            9,
          );
        }
        // Boulons : extrémité sous le dessous réel de la poutre, place de l'écrou (aucun boulon
        // traversant avant σ*), aucun perçage croisé avec les perçages d'ancrage.
        const floor = params.anchors.foot ? (beam.anchorKind === "shoe" ? 6 : 8) : 0;
        expectBoltsInsideBeam(beam, tm, { floor });
        // Tire-fonds : ancrage ≥ minAnchorage, longueur ≤ marche + bois disponible − tipCover.
        expectLagScrewsInsideBeam(beam, tm, params.lagScrews);
        // Entraxe ≥ spacing et pinces ≥ edge (valeurs `auto` de l'EC5).
        const sp = woodCentralBoltSpacing(
          woodCentralParams(params).bolts,
          resolveWorkshopProfile(project.workshop).fasteners,
        );
        for (const s of beam.seats) {
          const xs = s.bolts.map((o) => o.sigma);
          for (let i = 1; i < xs.length; i++) {
            expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(sp.minSpacing - 1e-6);
          }
          for (const x of xs) {
            expect(x - s.sigma0).toBeGreaterThanOrEqual(sp.edgeDistance - 1e-6);
            expect(s.sigma1 - x).toBeGreaterThanOrEqual(sp.edgeDistance - 1e-6);
          }
        }
        for (const p of beam.parts) expect(solidProblem(p.solid), p.id).toBeUndefined();
      }),
      { numRuns: 60 },
    );
    expect(complete).toBeGreaterThanOrEqual(20);
  });

  it("buildWoodCentralBeam ne lève jamais, quels que soient la filière et l'ancrage", () => {
    fc.assert(
      fc.property(
        projectArb,
        fc.constantFrom("auto", "mould", "stacked"),
        fc.constantFrom("auto", "shoe", "embeddedPlate"),
        fc.integer({ min: 30, max: 140 }),
        (project, curvedMethod, kind, width) => {
          let r: ReturnType<typeof beamFor> = null;
          expect(() => {
            r = beamFor(project, { section: { curvedMethod, width }, anchors: { kind } });
          }).not.toThrow();
          if (r === null) return;
          const { beam } = r as NonNullable<ReturnType<typeof beamFor>>;
          for (const p of beam.parts) {
            for (const [k, v] of Object.entries(p.quantities)) {
              expect(Number.isFinite(v) && v >= 0, `${p.id}.${k} = ${v}`).toBe(true);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("aucune pièce hors emprise (poutre et sabots, au débord d'arrivée près)", () => {
    fc.assert(
      fc.property(projectArb, paramsArb, (project, params) => {
        const r = beamFor(project, params);
        if (r === null || r.beam.errors.length > 0) return;
        const footprint = r.ctx.layout.footprint;
        const holes = r.ctx.layout.footprintHoles ?? [];
        const sp = project.stair.treads;
        // Chevêtre : ligne du nez d'arrivée décalée du débord et de la contremarche (wood-cut).
        const tol = sp.nosing + (sp.risers === "full" ? sp.riserThickness : 0) + 2;
        // Platines : emprise contrôlée par leurs propres tests (woodCentralPlates.test.ts).
        for (const p of r.beam.parts.filter((q) => !q.id.startsWith("wood-central-plate"))) {
          for (const q of planPoints(p.solid)) {
            expect(outsideBy(q, footprint), p.id).toBeLessThan(tol);
            for (const h of holes) expect(pointInPolygon(q, h, 1e-6), p.id).not.toBe("inside");
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it("platines à âme noyée : constat conforme ⇒ trait de scie et broches dans le contour de la poutre", () => {
    const presetArb = fc.constantFrom<PresetId>("straight", "quarter-left", "helical");
    const plateArb = fc.record({
      length: fc.integer({ min: 40, max: 400 }),
      webDepth: fc.integer({ min: 30, max: 500 }),
      webLength: fc.integer({ min: 30, max: 300 }),
    });
    fc.assert(
      fc.property(presetArb, plateArb, (preset, o) => {
        const r = beamFor(createProject(preset), {
          anchors: {
            kind: "embeddedPlate",
            length: o.length,
            plate: { webDepth: o.webDepth, webLength: o.webLength },
          },
        });
        if (r === null || r.beam.errors.length > 0) return;
        const lc1 = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
        const flat = lc1.flat!;
        const outer = flat.outline.outer;
        const statuses = r.checks.results.filter((x) => x.ruleId === "FAB_PLATINE_AME_NOYEE");
        const okWebs = new Set<string>();
        statuses.forEach((x, i) => {
          if (x.status === "ok") okWebs.add(i === 0 ? "AP1" : "AT1");
        });
        const lines = flat.lines;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]!;
          const label = l.label ? fr(l.label) : "";
          const web = /Trait de scie .*, (A[PT]1)$/.exec(label)?.[1];
          if (!web || !okWebs.has(web)) continue;
          const corners = lines.slice(i, i + 4).map((x) => x.a);
          const xs = corners.map((q) => q.x);
          const ys = corners.map((q) => q.y);
          const [x0, x1, y0, y1] = [
            Math.min(...xs),
            Math.max(...xs),
            Math.min(...ys),
            Math.max(...ys),
          ];
          for (const q of corners) {
            expect(pointInPolygon(q, outer, 1e-3), `${preset} ${web}`).not.toBe("outside");
          }
          // Aucun sommet du contour (entaille, assise) strictement dans le trait de scie.
          for (const q of outer) {
            const inside = q.x > x0 + 1e-3 && q.x < x1 - 1e-3 && q.y > y0 + 1e-3 && q.y < y1 - 1e-3;
            expect(inside, `${preset} ${web} (${q.x}, ${q.y})`).toBe(false);
          }
        }
        // Perçages (broches et organes) : centres dans le contour.
        for (const h of flat.outline.holes) {
          const c = V.scale(
            h.reduce((acc, q) => V.add(acc, q), V.vec(0, 0)),
            1 / h.length,
          );
          expect(pointInPolygon(c, outer, 1e-6), preset).toBe("inside");
        }
      }),
      { numRuns: 30 },
    );
  });

  it("refus ⇔ r_in / t < min (quarts tournants, épaisseur de lamelle tirée)", () => {
    const quarterArb = stairArb(["M1", "M3"], ["quarter-low", "quarter-mid", "quarter-high"]);
    let refused = 0;
    let accepted = 0;
    fc.assert(
      fc.property(quarterArb, fc.integer({ min: 1, max: 6 }), (s, t) => {
        const r = beamFor(noRisers(s.project), {
          section: { lamellaThickness: t, curvedMethod: "mould" },
        });
        if (r === null || r.trace.kind === "straight") return;
        const rIn = Math.min(...r.trace.arcs.map((a) => a.radius - 44));
        const refuse = rIn / (88 / Math.ceil(88 / t)) < MIN;
        const tEff = 88 / Math.ceil(88 / t);
        expect(r.beam.lamination.ratio).toBeCloseTo(rIn / tEff, 9);
        const bend = r.beam.errors.some(
          (e) =>
            e.key === "structure.woodCentral.error.bendRadius" ||
            e.key === "structure.woodCentral.error.bendRadiusMinPly",
        );
        expect(bend).toBe(rIn / tEff < MIN);
        if (refuse) {
          refused++;
          expect(r.beam.parts).toEqual([]);
        } else if (r.beam.errors.length === 0) {
          accepted++;
          expect(r.beam.parts.some((p) => p.id === WOOD_CENTRAL_BEAM_ID)).toBe(true);
          expect(r.beam.lamination.kr).toBeCloseTo(
            laminationKr(rIn / (88 / Math.ceil(88 / t))),
            12,
          );
        }
      }),
      { numRuns: 60 },
    );
    expect(refused).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThan(0);
  });
});

describe("débit et matière de la poutre finie", () => {
  it("couches empilées non produites (A33 (e)) : poutre gardant volume, masse et débit d'enveloppe", () => {
    const r = beamFor(createProject("quarter-left"), {
      section: { curvedMethod: "stacked", layerThickness: 1 },
    })!;
    expect(r.beam.errors.length).toBeGreaterThan(0);
    const lc1 = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(r.beam.parts.some((p) => p.componentOf !== undefined)).toBe(false);
    expect(lc1.stock).toBeDefined();
    expect(lc1.quantities["volume_m3"]).toBeGreaterThan(0);
    expect(r.beam.notes.map((n) => n.key)).not.toContain(
      "structure.woodCentral.note.stackedGlulam",
    );
  });

  it("couches empilées produites : surfaces des couches = face développée de la poutre finie", () => {
    const project = createProject("quarter-left");
    const stacked = beamFor(project, { section: { curvedMethod: "stacked" } })!;
    const mould = beamFor(project, { section: { curvedMethod: "mould" } })!;
    expect(stacked.beam.errors).toEqual([]);
    expect(mould.beam.errors).toEqual([]);
    const layers = stacked.beam.parts.filter((p) => p.componentOf === WOOD_CENTRAL_BEAM_ID);
    expect(layers.length).toBeGreaterThan(0);
    const sum = layers.reduce((acc, p) => acc + (p.quantities["surface_m2"] ?? 0), 0);
    const finished = mould.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(sum / finished.quantities["surface_m2"]!).toBeCloseTo(1, 1);
    // Fil horizontal de la poutre finie en couches empilées.
    const lc1 = stacked.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(lc1.grain!.z).toBeCloseTo(0, 12);
  });

  it("lamelles cintrées : placage seulement pour des plis minces (≤ thinPlyMax, A34 (e))", () => {
    const project = createProject("quarter-left");
    const thin = beamFor(project, { section: { curvedMethod: "mould" } })!;
    const t = thin.beam.lamination.lamellaThickness;
    const thinStock = thin.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!.stock!;
    expect(thinStock.supply).toBe("veneer");
    expect(thinStock.thickness).toBeCloseTo(t, 9);
    // Seuil abaissé sous l'épaisseur des lamelles : lames ordinaires, surcote de corroyage.
    const thick = beamFor(project, {
      section: { curvedMethod: "mould", lamellaThickness: 2, thinPlyMax: 1 },
    })!;
    expect(thick.beam.errors).toEqual([]);
    const t2 = thick.beam.lamination.lamellaThickness;
    expect(t2).toBeGreaterThan(1);
    const thickStock = thick.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!.stock!;
    expect(thickStock.supply).toBeUndefined();
    expect(thickStock.thickness).toBeGreaterThan(t2);
    expect(thickStock.count).toBe(thick.beam.lamination.lamellae);
  });
});
