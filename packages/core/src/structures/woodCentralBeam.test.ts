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
import type { SolidDesc } from "../model/derived.js";
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
import { WOOD_CENTRAL_SHOE_FOOT_ID, WOOD_CENTRAL_SHOE_HEAD_ID } from "./woodCentralShoes.js";
import { woodBeamOf, woodCentralContext, woodCentralParams } from "./woodCentral.test-helpers.js";

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

  it("boulons : deux par marche hors de la coupe au sol, longueur jusqu'au dessous réel, fixations déclarées", () => {
    const part = beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    // Marche 1 au-dessus de la coupe au sol (semelle du sabot) : pas de place pour l'écrou.
    expect(beam.seats[0]!.bolts).toEqual([]);
    const blocked = r.checks.results.filter(
      (c) => c.ruleId === WOOD_CENTRAL_BEAM_RULES.bolts.id && c.status === "violation",
    );
    expect(blocked.map((c) => c.message.key)).toEqual([
      "structure.woodCentral.check.bolts.blocked",
    ]);
    expect(blocked[0]!.location).toMatchObject({ partId: WOOD_CENTRAL_BEAM_ID, treadNumber: 1 });
    // Deux couches : boulons au milieu d'une couche, hors du joint de colle central.
    expect(beam.notes.map((n) => n.key)).toContain("structure.woodCentral.note.boltOffset");
    const bolted = beam.seats.slice(1);
    expect(expectBoltsInsideBeam(beam, tm)).toBe(2 * bolted.length);
    for (const s of bolted) {
      expect(s.bolts).toHaveLength(2);
      for (const b of s.bolts) {
        expect(b.lateral).toBe(22);
        expect(b.length % 10).toBe(0);
        expect(b.length).toBeGreaterThan(tm);
        expect(b.sigma).toBeGreaterThanOrEqual(s.sigma0 + 30 - 1e-6);
        expect(b.sigma).toBeLessThanOrEqual(s.sigma1 - 30 + 1e-6);
      }
    }
    const fixings = part.fixings ?? [];
    expect(fixings.every((f) => f.joint === "treadBeamBolted" && f.holeDiameter === 11)).toBe(true);
    expect(fixings.reduce((n, f) => n + f.points, 0)).toBe(2 * bolted.length);
    for (const s of beam.seats) {
      const mine = fixings.filter((f) => f.with?.[0] === s.treadPartId);
      expect(mine.map((f) => f.length).sort()).toEqual(
        [...new Set(s.bolts.map((b) => b.length))].sort(),
      );
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
    const nBolts = beam.seats.reduce((n, s) => n + s.bolts.length, 0);
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

describe("quart tournant : lamellé-collé cintré sur moule", () => {
  const r = beamFor(noRisers(createProject("quarter-left")))!;

  it("lamelles auto ⌊r_in / 240⌋ ≥ 1, k_r = 1, portées cintrées", () => {
    const lam = r.beam.lamination;
    expect(r.beam.errors.map(fr)).toEqual([]);
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
    // Débit : une lame par lamelle, à l'épaisseur de la lamelle.
    const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(part.stock).toMatchObject({ count: lam.lamellae, thickness: lam.lamellaThickness });
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
    const r = beamFor(noRisers(createProject("helical")))!;
    expect(r.beam.errors.map(fr)).toEqual([]);
    expect(r.trace.kind).toBe("helical");
    expect(r.beam.lamination.kr).toBe(1);
    const part = r.beam.parts.find((p) => p.id === WOOD_CENTRAL_BEAM_ID)!;
    expect(solidProblem(part.solid)).toBeUndefined();
    expect(r.beam.seats).toHaveLength(r.ctx.stepping.treads.length);
    expect(r.beam.lamination.lamellaThickness * r.beam.lamination.lamellae).toBeCloseTo(88, 9);
    expectBoltsInsideBeam(r.beam, r.ctx.project.stair.treads.thickness);
  });

  it("sabots droits sur la poutre cintrée : écart aux joues signalé (FAB_SABOT_EMPRISE)", () => {
    const r = beamFor(noRisers(createProject("helical")))!;
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
    const q = beamFor(noRisers(createProject("quarter-left")))!;
    expect(
      q.checks.results.some((c) => c.message.key === "structure.woodCentral.check.shoe.curved"),
    ).toBe(false);
  });
});

describe("refus et configurations non prises en charge", () => {
  it("lamelles de 10 mm sur un quart tournant : rayon de cintrage trop petit, aucune pièce", () => {
    const ctx = woodCentralContext(createProject("quarter-left"));
    const { beam } = woodBeamOf(ctx, woodCentralParams({ section: { lamellaThickness: 10 } }));
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
    const { beam } = woodBeamOf(ctx, woodCentralParams({ trace: { lateralOffset: 300 } }));
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

  it("contremarches pleines : marches posées, aucune entaille arrière", () => {
    const r = beamFor(createProject("straight"))!;
    expect(r.beam.seats.every((s) => s.rearDepth === 0 && s.toothAbove === Infinity)).toBe(true);
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
    anchors: fc.record({ foot: fc.boolean(), head: fc.boolean() }),
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
        // Entaille arrière : chaque marche non finale, sans contremarche pleine, est logée de la
        // profondeur retenue dans la dent suivante.
        if (risers !== "full" && beam.rearDepth > 0) {
          for (const s of beam.seats.slice(0, -1)) {
            expect(s.rearDepth, `M${s.tread}`).toBeGreaterThanOrEqual(beam.rearDepth - 1e-6);
            expect(s.sigma1).toBeGreaterThan(s.sigma0);
          }
        }
        // Lamelles égales dont la somme redonne b.
        const lam = beam.lamination;
        expect(lam.lamellae * lam.lamellaThickness).toBeCloseTo(
          (params.section as { width: number }).width,
          9,
        );
        // Boulons : extrémité sous le dessous réel de la poutre, place de l'écrou, aucun
        // perçage croisé avec les boulons des sabots.
        const anchors = params.anchors as { foot: boolean };
        expectBoltsInsideBeam(beam, tm, { floor: anchors.foot ? 6 : 0 });
        for (const p of beam.parts) expect(solidProblem(p.solid), p.id).toBeUndefined();
      }),
      { numRuns: 60 },
    );
    expect(complete).toBeGreaterThanOrEqual(20);
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
        for (const p of r.beam.parts) {
          for (const q of planPoints(p.solid)) {
            expect(outsideBy(q, footprint), p.id).toBeLessThan(tol);
            for (const h of holes) expect(pointInPolygon(q, h, 1e-6), p.id).not.toBe("inside");
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it("refus ⇔ r_in / t < min (quarts tournants, épaisseur de lamelle tirée)", () => {
    const quarterArb = stairArb(["M1", "M3"], ["quarter-low", "quarter-mid", "quarter-high"]);
    let refused = 0;
    let accepted = 0;
    fc.assert(
      fc.property(quarterArb, fc.integer({ min: 1, max: 6 }), (s, t) => {
        const r = beamFor(noRisers(s.project), { section: { lamellaThickness: t } });
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
