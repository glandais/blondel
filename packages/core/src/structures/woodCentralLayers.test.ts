/**
 * Couches empilées du limon central bois (`woodCentralLayers.ts`, QUESTIONS A33 (e)) : tranches,
 * identifiants et repères, pièces composantes, gabarits en plan, débit, solides, contrôles ;
 * propriétés sur générateurs contraints (volume conservé, gabarit qui contient la part finie,
 * sections non plates, aucune exception).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Part } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import { solidProblem } from "../parts/solidChecks.js";
import { createProject } from "../project/presets.js";
import { resolveWorkshopProfile, type WorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { QUANTITY_STOCK_VOLUME_M3, QUANTITY_VOLUME_M3 } from "./quantities.js";
import { woodCentralContext, woodCentralParams, woodTraceOf } from "./woodCentral.test-helpers.js";
import {
  buildStackedLayers,
  clippedArea,
  resolveDressingAllowance,
  resolveLayerThickness,
  woodCentralLayerId,
  woodCentralLayerMark,
  type StackedBeamShape,
  type StackedLayersResult,
} from "./woodCentralLayers.js";
import type { WoodCentralParams } from "./woodCentralParams.js";

const PROFILE = resolveWorkshopProfile();
const BEAM_ID = "wood-central-beam";
const BEAM_MARK = "LC1";

/** Trace synthétique en arc de cercle de rayon R (tournant à gauche), longueur L. */
function arcTrace(R: Mm, L: Mm): CentralTrace {
  const th = (s: Mm) => s / R;
  return {
    kind: "turning",
    curve: { segments: [] } as unknown as CentralTrace["curve"],
    length: L,
    point: (s) => V.vec(R * Math.sin(th(s)), R * (1 - Math.cos(th(s)))),
    tangent: (s) => V.vec(Math.cos(th(s)), Math.sin(th(s))),
    left: (s) => V.vec(-Math.sin(th(s)), Math.cos(th(s))),
    nosingSigma: [],
    nosingZ: () => 0,
    slope: 0,
    naissances: [],
    arcs: [{ radius: R, sigma0: -1e9, sigma1: 1e9, turnsLeft: true }],
    notes: [],
  };
}

interface Synthetic {
  readonly shape: StackedBeamShape;
  /** Volume exact de la poutre finie, mm³. */
  readonly volume: number;
}

/**
 * Forme synthétique : dessous rampant p·σ (au-dessus de la base 0), dessus en escalier de
 * `steps` assises de giron g et de hauteur h, la première à h0 au-dessus du sol.
 */
function synthetic(b: Mm, g: Mm, h: Mm, h0: Mm, p: number, steps: number): Synthetic {
  const L = g * steps;
  const topAt = (s: Mm) => h0 + h * Math.min(steps - 1, Math.max(0, Math.floor(s / g)));
  const bottomAt = (s: Mm) => p * s;
  let area = 0;
  for (let k = 0; k < steps; k++) {
    const x0 = k * g;
    const x1 = x0 + g;
    const T = h0 + h * k;
    // ∫ (T − p·σ)⁺ sur [x0 ; x1].
    const xc = p > 0 ? Math.min(x1, Math.max(x0, T / p)) : x1;
    area += T * (xc - x0) - (p * (xc * xc - x0 * x0)) / 2;
  }
  const nodes = Array.from({ length: steps + 1 }, (_, k) => k * g);
  return {
    shape: {
      beamId: BEAM_ID,
      beamMark: BEAM_MARK,
      b,
      sStart: 0,
      sEnd: L,
      bottomAt,
      topAt,
      nodes,
      baseZ: 0,
    },
    volume: b * area,
  };
}

function run(
  trace: CentralTrace,
  shape: StackedBeamShape,
  params: WoodCentralParams,
  profile: WorkshopProfile = PROFILE,
): { r: StackedLayersResult; checks: CheckCollector } {
  const ctx = woodCentralContext(createProject("quarter-left"));
  const checks = new CheckCollector(ctx.project, ctx.stepping);
  return { r: buildStackedLayers({ params, trace, profile, checks, beam: shape }), checks };
}

/** Forme tirée d'une trace réelle : assises sous les nez, sous-face parallèle, coupée au sol. */
function realShape(trace: CentralTrace, b: Mm): StackedBeamShape {
  const ns = trace.nosingSigma;
  const tread = 40;
  const sStart = ns[0]! - 30;
  const sEnd = ns[ns.length - 1]!;
  const topAt = (s: Mm): Mm => {
    for (let k = 1; k < ns.length; k++) if (s < ns[k]!) return trace.nosingZ(ns[k]!) - tread;
    return trace.nosingZ(ns[ns.length - 1]!) - tread;
  };
  return {
    beamId: BEAM_ID,
    beamMark: BEAM_MARK,
    b,
    sStart,
    sEnd,
    bottomAt: (s) => Math.max(0, trace.nosingZ(s) - 320),
    topAt,
    nodes: [...ns],
    baseZ: 0,
  };
}

const sectionHeights = (p: Part): number[] => {
  if (p.solid.kind !== "ruled") return [];
  const { a, b } = p.solid;
  return a.map((q, i) => b[i]!.z - q.z);
};

const flatVertices = (p: Part): readonly Vec2[] => p.flat!.outline.outer;

/**
 * Sommets des lignes « face finie » du gabarit (projection en plan de la part finie) : chaque
 * polyligne commence par un segment libellé, suivi de segments sans libellé.
 */
const faceEnds = (p: Part): Vec2[] => {
  const out: Vec2[] = [];
  let inFace = false;
  for (const l of p.flat!.lines) {
    if (l.label !== undefined) inFace = l.label.key === "structure.woodCentral.flatLine.layerFace";
    if (inFace && l.kind === "mark") out.push(l.a, l.b);
  }
  return out;
};

describe("couches empilées : réglages", () => {
  it("épaisseur et surcote auto lues dans le profil d'atelier, saisies conservées", () => {
    const auto = woodCentralParams();
    const w = PROFILE.wood;
    expect(resolveLayerThickness(auto, PROFILE)).toBe(
      Math.max(...w.thicknesses) - w.planingAllowance,
    );
    expect(resolveDressingAllowance(auto, PROFILE)).toBe(w.planingAllowance);
    const set = woodCentralParams({ section: { layerThickness: 33, dressingAllowance: 7 } });
    expect(resolveLayerThickness(set, PROFILE)).toBe(33);
    expect(resolveDressingAllowance(set, PROFILE)).toBe(7);
  });

  it("identifiants et repères", () => {
    expect(woodCentralLayerId(3)).toBe("wood-central-layer-3");
    expect(woodCentralLayerMark("LC1", 3)).toBe("LC1-3");
  });

  it("intégrale d'une tranche : cas élémentaires", () => {
    // Dessous sous la tranche : pleine hauteur.
    expect(clippedArea(10, -5, -5, 0, 4)).toBeCloseTo(40, 12);
    // Dessous au-dessus : rien.
    expect(clippedArea(10, 5, 6, 0, 4)).toBe(0);
    // Dessous de 0 à 4 sur 10 : triangle 10 × 4 / 2.
    expect(clippedArea(10, 0, 4, 0, 4)).toBeCloseTo(20, 12);
    // Dessous de −4 à 4 : moitié pleine (5 × 4) + triangle (5 × 4 / 2).
    expect(clippedArea(10, -4, 4, 0, 4)).toBeCloseTo(30, 12);
  });
});

describe("couches empilées sur une trace réelle", () => {
  for (const preset of ["quarter-left", "helical"] as const) {
    it(`${preset} : tranches contiguës, composantes, gabarits, débit, contrôles`, () => {
      const ctx = woodCentralContext(createProject(preset));
      const params = woodCentralParams({
        section: { width: 88, layerThickness: 40, dressingAllowance: 5 },
      });
      const trace = woodTraceOf(ctx, params);
      expect(trace.kind).not.toBe("straight");
      const shape = realShape(trace, 88);
      const checks = new CheckCollector(ctx.project, ctx.stepping);
      const r = buildStackedLayers({ params, trace, profile: PROFILE, checks, beam: shape });
      expect(r.errors).toEqual([]);
      expect(r.layerThickness).toBe(40);
      expect(r.dressingAllowance).toBe(5);
      // Nombre de couches : jusqu'au plus haut dessus.
      const zTop = Math.max(...trace.nosingSigma.slice(1).map((s) => trace.nosingZ(s) - 40));
      expect(r.layers).toHaveLength(Math.ceil(zTop / 40));
      expect(r.parts).toHaveLength(r.layers.length);
      r.layers.forEach((l, i) => {
        expect(l.index).toBe(i + 1);
        expect(l.partId).toBe(woodCentralLayerId(i + 1));
        expect(l.mark).toBe(`LC1-${i + 1}`);
        expect(l.z1 - l.z0).toBeCloseTo(40, 9);
        expect(l.z0).toBeCloseTo(i * 40, 9);
        if (i > 0) expect(l.z0).toBeCloseTo(r.layers[i - 1]!.z1, 9);
        expect(l.sigma1).toBeGreaterThan(l.sigma0);
        expect(l.sigma0).toBeGreaterThanOrEqual(shape.sStart - 1e-6);
        expect(l.sigma1).toBeLessThanOrEqual(shape.sEnd + 1e-6);
      });
      for (const p of r.parts) {
        expect(p.componentOf).toBe(BEAM_ID);
        expect(p.category).toBe("carriage");
        expect(p.assembledWith).toEqual([BEAM_ID]);
        expect(p.material).toBe(params.material);
        expect(p.name.key).toBe("structure.woodCentral.part.layer");
        expect(solidProblem(p.solid)).toBeUndefined();
        expect(Math.min(...sectionHeights(p))).toBeGreaterThan(0);
        const flat = p.flat!;
        expect(flat.thickness).toBe(40);
        expect(flat.reference?.description.key).toBe("structure.woodCentral.reference.layer");
        // Débit ≥ gabarit (rectangle minimal), épaisseur ≥ couche.
        const xs = flatVertices(p).map((q) => q.x);
        const ys = flatVertices(p).map((q) => q.y);
        expect(Math.min(...xs)).toBeGreaterThan(-1e-6);
        expect(Math.min(...ys)).toBeGreaterThan(-1e-6);
        expect(p.stock!.length).toBeGreaterThanOrEqual(Math.max(...xs) - 1e-6);
        expect(p.stock!.width).toBeGreaterThanOrEqual(Math.max(...ys) - 1e-6);
        expect(p.stock!.thickness).toBeGreaterThanOrEqual(40);
        expect(p.quantities[QUANTITY_STOCK_VOLUME_M3]).toBeGreaterThan(
          p.quantities[QUANTITY_VOLUME_M3]!,
        );
        // Gabarit plus large que b de 2 × surcote (bouts finis tracés d'une rive à l'autre).
        const ends = flat.lines.filter(
          (l) => l.label?.key === "structure.woodCentral.flatLine.layerEnd",
        );
        expect(ends).toHaveLength(2);
        for (const e of ends) expect(V.distance(e.a, e.b)).toBeCloseTo(88 + 2 * 5, 6);
        expect(flat.lines.some((l) => l.kind === "text")).toBe(true);
        // Grain horizontal.
        expect(p.grain!.z).toBe(0);
      }
      // Contrôles par couche.
      const ids = new Set(r.parts.map((p) => p.id));
      const stockResults = checks.results.filter((x) => x.ruleId === "FAB_DEBIT_DISPONIBLE");
      expect(stockResults).toHaveLength(r.parts.length);
      for (const x of stockResults) {
        expect(x.location.kind === "part" && ids.has(x.location.partId)).toBe(true);
      }
      expect(checks.results.some((x) => x.ruleId === "FAB_PLATEAU_LONGUEUR_MAX")).toBe(true);
      expect(r.notes[0]!.key).toBe("structure.woodCentral.note.stackedLayers");
    });
  }

  it("quart tournant : une naissance tracée sur le gabarit d'une couche qui la couvre", () => {
    const ctx = woodCentralContext(createProject("quarter-left"));
    const params = woodCentralParams({ section: { layerThickness: 40 } });
    const trace = woodTraceOf(ctx, params);
    const { r } = run(trace, realShape(trace, 88), params);
    const springing = r.parts.flatMap((p) =>
      p.flat!.lines.filter((l) => l.label?.key === "structure.steelCurved.flatLine.springing"),
    );
    expect(trace.naissances.length).toBeGreaterThan(0);
    expect(springing.length).toBeGreaterThan(0);
  });
});

describe("couches empilées : cas limites", () => {
  const params = woodCentralParams({ section: { layerThickness: 40, dressingAllowance: 5 } });
  const trace = arcTrace(1500, 2400);

  it("forme invalide (largeur nulle, étendue vide) : erreur, aucune couche", () => {
    const { shape } = synthetic(80, 250, 180, 200, 0.6, 8);
    for (const bad of [
      { ...shape, b: 0 },
      { ...shape, sEnd: shape.sStart },
      { ...shape, topAt: () => Number.NaN },
    ]) {
      const { r } = run(trace, bad, params);
      expect(r.parts).toEqual([]);
      expect(r.errors.map((e) => e.key)).toEqual(["structure.woodCentral.error.layerShape"]);
    }
  });

  it("trop de couches : erreur lisible", () => {
    const { shape } = synthetic(80, 250, 180, 200, 0.6, 8);
    const thin = woodCentralParams({ section: { layerThickness: 1 } });
    const { r } = run(trace, shape, thin);
    expect(r.parts).toEqual([]);
    expect(r.errors.map((e) => e.key)).toEqual(["structure.woodCentral.error.layerCount"]);
  });

  it("forme qui lève : erreur, jamais d'exception", () => {
    const { shape } = synthetic(80, 250, 180, 200, 0.6, 8);
    const { r } = run(
      trace,
      {
        ...shape,
        bottomAt: () => {
          throw new Error("boom");
        },
      },
      params,
    );
    expect(r.errors.map((e) => e.key)).toEqual(["structure.woodCentral.error.layers"]);
  });

  it("tranche coupant la poutre en deux parts : enveloppe et remarque", () => {
    // Dessus en creux au milieu : la couche haute est coupée en deux.
    const shape: StackedBeamShape = {
      beamId: BEAM_ID,
      beamMark: BEAM_MARK,
      b: 80,
      sStart: 0,
      sEnd: 900,
      bottomAt: () => 0,
      topAt: (s) => (s < 300 || s >= 600 ? 120 : 60),
      nodes: [300, 600],
      baseZ: 0,
    };
    const { r } = run(trace, shape, params);
    expect(r.layers).toHaveLength(3);
    const top = r.layers[2]!;
    expect(top.sigma0).toBeCloseTo(0, 6);
    expect(top.sigma1).toBeCloseTo(900, 6);
    expect(r.notes.map((n) => n.key)).toContain("structure.woodCentral.note.layerDisjoint");
  });

  it("tranches basses vides (sous-face au-dessus de la base) omises, numérotation continue", () => {
    const shape: StackedBeamShape = {
      beamId: BEAM_ID,
      beamMark: BEAM_MARK,
      b: 80,
      sStart: 0,
      sEnd: 900,
      bottomAt: () => 100,
      topAt: () => 200,
      nodes: [],
      baseZ: 0,
    };
    const { r } = run(trace, shape, params);
    expect(r.layers.map((l) => l.index)).toEqual([1, 2, 3]);
    expect(r.layers[0]!.z0).toBeCloseTo(80, 9);
  });
});

// ------------------------------------------------------------------ propriétés

const caseArb = fc.record({
  t: fc.integer({ min: 30, max: 80 }),
  s: fc.integer({ min: 1, max: 10 }),
  b: fc.integer({ min: 60, max: 140 }),
  g: fc.integer({ min: 200, max: 320 }),
  h: fc.integer({ min: 150, max: 200 }),
  h0: fc.integer({ min: 120, max: 400 }),
  ratio: fc.double({ min: 0.3, max: 1, noNaN: true }),
  steps: fc.integer({ min: 2, max: 14 }),
  extraRadius: fc.integer({ min: 300, max: 3000 }),
});

describe("couches empilées : propriétés", () => {
  it("Σ volumes des couches = volume de la poutre finie ; sections non plates ; gabarit qui contient la part finie", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { shape, volume } = synthetic(c.b, c.g, c.h, c.h0, (c.ratio * c.h) / c.g, c.steps);
        const R = c.b / 2 + c.s + c.extraRadius;
        const trace = arcTrace(R, shape.sEnd);
        const params = woodCentralParams({
          section: { width: c.b, layerThickness: c.t, dressingAllowance: c.s },
        });
        const { r } = run(trace, shape, params);
        expect(r.errors).toEqual([]);
        const sum = r.parts.reduce((acc, p) => acc + p.quantities[QUANTITY_VOLUME_M3]! * 1e9, 0);
        expect(Math.abs(sum - volume) / volume).toBeLessThan(1e-6);
        for (const p of r.parts) {
          expect(solidProblem(p.solid)).toBeUndefined();
          expect(Math.min(...sectionHeights(p))).toBeGreaterThan(0);
          const outline = flatVertices(p);
          const face = faceEnds(p);
          expect(face.length).toBeGreaterThan(0);
          for (const q of face) {
            expect(pointInPolygon(q, outline, 1e-6)).not.toBe("outside");
          }
        }
        // Tranches contiguës sans recouvrement.
        for (let i = 1; i < r.layers.length; i++) {
          expect(r.layers[i]!.z0).toBeGreaterThanOrEqual(r.layers[i - 1]!.z1 - 1e-9);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("ne lève jamais, même sur une forme quelconque", () => {
    const num = fc.double({ min: -5000, max: 5000 });
    fc.assert(
      fc.property(
        fc.record({
          b: num,
          sStart: num,
          sEnd: num,
          baseZ: num,
          a: num,
          k: num,
          top: num,
          t: fc.integer({ min: 1, max: 200 }),
          s: fc.integer({ min: 0, max: 50 }),
        }),
        (c) => {
          const shape: StackedBeamShape = {
            beamId: BEAM_ID,
            beamMark: BEAM_MARK,
            b: c.b,
            sStart: c.sStart,
            sEnd: c.sEnd,
            baseZ: c.baseZ,
            bottomAt: (x) => c.a + c.k * 1e-3 * x,
            topAt: (x) => c.top + (x > 0 ? 100 : 0),
            nodes: [0],
          };
          const params = woodCentralParams({
            section: { layerThickness: c.t, dressingAllowance: c.s },
          });
          let res: StackedLayersResult | undefined;
          expect(() => {
            res = run(arcTrace(2000, 1000), shape, params).r;
          }).not.toThrow();
          expect(res!.parts.length + res!.errors.length).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
