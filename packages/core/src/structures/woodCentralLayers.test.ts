/**
 * Couches empilées du limon central bois (`woodCentralLayers.ts`, QUESTIONS A33 (e), A35 (g)
 * (h)) : tranches, joints calés sur les assises, planches aboutées ou collées sur chant,
 * identifiants et repères, pièces composantes, gabarits en plan, débit, solides, contrôles ;
 * propriétés sur générateurs contraints (assises aux joints, volume conservé, fil borné par la
 * pente, planches jointives, gabarit qui contient la part finie, sections non plates, aucune
 * exception).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Part } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import { fabricatedParts, rootAssemblyId } from "../parts/components.js";
import { solidProblem } from "../parts/solidChecks.js";
import { createProject } from "../project/presets.js";
import { resolveWorkshopProfile, type WorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import { CheckCollector } from "./checks.js";
import { QUANTITY_STOCK_VOLUME_M3, QUANTITY_VOLUME_M3 } from "./quantities.js";
import {
  woodBeamOf,
  woodCentralContext,
  woodCentralParams,
  woodTraceOf,
} from "./woodCentral.test-helpers.js";
import {
  buildStackedLayers,
  clippedArea,
  grainDeviationOf,
  layerBounds,
  MAX_BOARDS,
  resolveDressingAllowance,
  resolveLayerThickness,
  woodCentralBoardId,
  woodCentralBoardMark,
  woodCentralLayerId,
  woodCentralLayerMark,
  type StackedBeamShape,
  type StackedLayersResult,
} from "./woodCentralLayers.js";
import { WoodCentralParamsSchema, type WoodCentralParams } from "./woodCentralParams.js";

const PROFILE = resolveWorkshopProfile();
/** Pente de fil maximale par défaut (`section.maxGrainSlope`, %), lue sur le schéma. */
const DEFAULT_SLOPE = WoodCentralParamsSchema.parse({}).section.maxGrainSlope;
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
      // Nombre de couches : jusqu'au plus haut dessus (sans assises : tranches régulières).
      const zTop = Math.max(...trace.nosingSigma.slice(1).map((s) => trace.nosingZ(s) - 40));
      expect(r.layers).toHaveLength(Math.ceil(zTop / 40));
      const byId = new Map(r.parts.map((p) => [p.id, p]));
      // Une pièce par planche, plus une par couche composée (A36 (9)).
      const composedCount = r.layers.filter((l) => l.boards!.length > 1).length;
      expect(r.parts).toHaveLength(
        r.layers.reduce((n, l) => n + l.boards!.length, 0) + composedCount,
      );
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
        const boards = l.boards!;
        if (boards.length === 1) {
          expect(boards[0]!.partId).toBe(l.partId);
          expect(boards[0]!.mark).toBe(l.mark);
          expect(byId.get(l.partId)!.name.key).toBe("structure.woodCentral.part.layer");
        } else {
          // Couche composée (A36 (9)) : pièce sans gabarit ni débit ni grandeurs, avant ses planches.
          const layer = byId.get(l.partId)!;
          expect(layer.name.key).toBe("structure.woodCentral.part.layer");
          expect(layer.componentOf).toBe(BEAM_ID);
          expect(layer.flat).toBeUndefined();
          expect(layer.stock).toBeUndefined();
          expect(layer.quantities).toEqual({});
          expect(solidProblem(layer.solid)).toBeUndefined();
          const at = r.parts.indexOf(layer);
          expect(r.parts[at + 1]!.id).toBe(boards[0]!.partId);
          boards.forEach((bd, j) => {
            expect(bd.partId).toBe(woodCentralBoardId(i + 1, j + 1));
            expect(bd.mark).toBe(woodCentralBoardMark("LC1", i + 1, j + 1));
            expect(bd.mark).toBe(`LC1-${i + 1}.${j + 1}`);
            expect(byId.get(bd.partId)!.name.key).toBe("structure.woodCentral.part.layerBoard");
          });
        }
      });
      for (const l of r.layers) {
        const boards = l.boards!;
        boards.forEach((bd, j) => {
          const p = byId.get(bd.partId)!;
          expect(p.componentOf).toBe(boards.length === 1 ? BEAM_ID : l.partId);
          expect(rootAssemblyId([...r.parts, { id: BEAM_ID }], p.id)).toBe(BEAM_ID);
          expect(p.category).toBe("carriage");
          expect(p.assembledWith).toEqual([BEAM_ID]);
          expect(p.material).toBe(params.material);
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
          // Bouts finis aux seuls bouts de la couche, tracés d'une rive à l'autre (b + 2 × surcote).
          const ends = flat.lines.filter(
            (x) => x.label?.key === "structure.woodCentral.flatLine.layerEnd",
          );
          const expected = (j === 0 ? 1 : 0) + (j === boards.length - 1 ? 1 : 0);
          expect(ends).toHaveLength(expected);
          for (const e of ends) expect(V.distance(e.a, e.b)).toBeCloseTo(88 + 2 * 5, 6);
          expect(flat.lines.some((x) => x.kind === "text")).toBe(true);
          // Fil horizontal, selon la corde de la planche ; écart borné par la pente de fil.
          expect(p.grain!.z).toBe(0);
          expect(bd.grainDeviation).toBeLessThanOrEqual(Math.atan(DEFAULT_SLOPE / 100) + 1e-9);
        });
      }
      expect(r.maxGrainDeviation).toBeLessThanOrEqual(Math.atan(DEFAULT_SLOPE / 100) + 1e-9);
      // Contrôles par pièce, débit partout disponible.
      const ids = new Set(fabricatedParts(r.parts).map((p) => p.id));
      const stockResults = checks.results.filter((x) => x.ruleId === "FAB_DEBIT_DISPONIBLE");
      expect(stockResults).toHaveLength(ids.size);
      for (const x of stockResults) {
        expect(x.location.kind === "part" && ids.has(x.location.partId)).toBe(true);
        expect(x.status).toBe("ok");
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
      (p.flat?.lines ?? []).filter(
        (l) => l.label?.key === "structure.steelCurved.flatLine.springing",
      ),
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

/** Trace synthétique droite le long de x, longueur L. */
function straightTrace(L: Mm): CentralTrace {
  return {
    kind: "straight",
    curve: { segments: [] } as unknown as CentralTrace["curve"],
    length: L,
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
}

/** Altitudes des assises de la forme synthétique (h0 + k·h). */
const seatsOf = (h: Mm, h0: Mm, steps: number): Mm[] =>
  Array.from({ length: steps }, (_, k) => h0 + h * k);

/** Volume fini cumulé des pièces fabriquées (planches et couches d'une planche), mm³. */
const volumeOf = (r: StackedLayersResult): number =>
  fabricatedParts(r.parts).reduce((acc, p) => acc + p.quantities[QUANTITY_VOLUME_M3]! * 1e9, 0);

describe("couches empilées : joints calés sur les assises (A35 (g))", () => {
  it("tranches : intervalles entre niveaux partagés en couches égales ≤ t_max, puis t_max", () => {
    const { count, bounds } = layerBounds(0, 500, 75, [180, 360, 360 + 1e-9, -20, 700]);
    // [0 ; 180] : 3 × 60 ; [180 ; 360] : 3 × 60 ; [360 ; 500] : 2 × 75 (au-dessus du dernier niveau).
    expect(count).toBe(8);
    expect(bounds.map((x) => x.z1 - x.z0)).toEqual(
      [60, 60, 60, 60, 60, 60, 75, 75].map((v) => expect.closeTo(v, 9)),
    );
    expect(bounds[2]!.z1).toBe(180);
    expect(bounds[5]!.z1).toBe(360);
    for (let i = 1; i < bounds.length; i++) expect(bounds[i]!.z0).toBe(bounds[i - 1]!.z1);
    // Sans assise : tranches régulières depuis la base.
    const flat = layerBounds(10, 100, 40);
    expect(flat.bounds.map((x) => [x.z0, x.z1])).toEqual([
      [10, 50],
      [50, 90],
      [90, 130],
    ]);
    // Garde-fou.
    expect(layerBounds(0, 1e6, 1, [], 1000)).toEqual({ count: 1e6, bounds: [] });
  });

  it("forme synthétique : chaque assise est un joint, épaisseurs ≤ t_max, remarque calée", () => {
    const h = 180;
    const h0 = 200;
    const { shape, volume } = synthetic(80, 250, h, h0, 0.5, 8);
    const seats = seatsOf(h, h0, 8);
    const params = woodCentralParams({ section: { layerThickness: 75, dressingAllowance: 5 } });
    const { r } = run(arcTrace(2500, shape.sEnd), { ...shape, seatLevels: seats }, params);
    expect(r.errors).toEqual([]);
    expect(r.layerThickness).toBe(75);
    const zs = r.layers.flatMap((l) => [l.z0, l.z1]);
    for (const seat of seats) expect(zs.some((z) => Math.abs(z - seat) < 1e-6)).toBe(true);
    for (const l of r.layers) expect(l.z1 - l.z0).toBeLessThanOrEqual(75 + 1e-9);
    // [0 ; 200] : 3 couches de 66,7 ; puis 3 couches de 60 par assise.
    expect(r.layers[0]!.z1).toBeCloseTo(200 / 3, 9);
    expect(r.layers[3]!.z1 - r.layers[3]!.z0).toBeCloseTo(60, 9);
    // Gabarits et débit à l'épaisseur de chaque couche.
    for (const p of fabricatedParts(r.parts)) {
      const l = r.layers.find((x) => x.boards!.some((bd) => bd.partId === p.id))!;
      expect(p.flat!.thickness).toBeCloseTo(l.z1 - l.z0, 9);
      expect(p.stock!.thickness).toBeGreaterThanOrEqual(l.z1 - l.z0);
    }
    expect(Math.abs(volumeOf(r) - volume) / volume).toBeLessThan(1e-6);
    const note = r.notes[0]!;
    expect(note.key).toBe("structure.woodCentral.note.stackedLayersSeated");
    expect(note.params?.["min"]).toMatchObject({ num: 60 });
    expect(note.params?.["max"]).toMatchObject({ num: 66.7 });
  });

  it("hélicoïdal : joints aux niveaux des assises", () => {
    const ctx = woodCentralContext(createProject("helical"));
    const params = woodCentralParams({ section: { width: 88, dressingAllowance: 5 } });
    const trace = woodTraceOf(ctx, params);
    const shape = realShape(trace, 88);
    const seats = trace.nosingSigma.slice(1).map((s) => trace.nosingZ(s) - 40);
    const { r } = run(trace, { ...shape, seatLevels: seats }, params);
    expect(r.errors).toEqual([]);
    const tMax = resolveLayerThickness(params, PROFILE);
    const zs = r.layers.flatMap((l) => [l.z0, l.z1]);
    for (const seat of seats) expect(zs.some((z) => Math.abs(z - seat) < 1e-6)).toBe(true);
    for (const l of r.layers) expect(l.z1 - l.z0).toBeLessThanOrEqual(tMax + 1e-9);
  });
});

describe("couches empilées : planches (A35 (h))", () => {
  it("trace droite : une planche par couche, pièce inchangée (identifiant, repère, nom, bouts)", () => {
    const { shape, volume } = synthetic(80, 250, 180, 200, 0.6, 8);
    const params = woodCentralParams({ section: { layerThickness: 40, dressingAllowance: 5 } });
    const { r } = run(straightTrace(shape.sEnd), shape, params);
    expect(r.parts).toHaveLength(r.layers.length);
    expect(r.maxGrainDeviation).toBe(0);
    r.layers.forEach((l, i) => {
      const p = r.parts[i]!;
      expect(l.boards).toEqual([
        {
          index: 1,
          partId: l.partId,
          mark: l.mark,
          sigma0: l.sigma0,
          sigma1: l.sigma1,
          grainDeviation: 0,
        },
      ]);
      expect(p.id).toBe(woodCentralLayerId(i + 1));
      expect(p.mark).toBe(woodCentralLayerMark("LC1", i + 1));
      expect(p.name.key).toBe("structure.woodCentral.part.layer");
      expect(p.grain).toEqual({ x: 1, y: 0, z: 0 });
      const ends = p.flat!.lines.filter(
        (x) => x.label?.key === "structure.woodCentral.flatLine.layerEnd",
      );
      expect(ends).toHaveLength(2);
      // Bande droite : gabarit (σ1 − σ0 + 2s) × (b + 2s).
      const ys = flatVertices(p).map((q) => q.y);
      const xs = flatVertices(p).map((q) => q.x);
      const dims = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].sort(
        (a, b) => a - b,
      );
      const want = [90, l.sigma1 - l.sigma0 + 10].sort((a, b) => a - b);
      expect(dims[0]).toBeCloseTo(want[0]!, 6);
      expect(dims[1]).toBeCloseTo(want[1]!, 6);
    });
    expect(Math.abs(volumeOf(r) - volume) / volume).toBeLessThan(1e-6);
    expect(r.notes.map((n) => n.key)).not.toContain("structure.woodCentral.note.layerBoards");
  });

  it("tournant : couches aboutées, fil borné par la pente, remarque", () => {
    const { shape, volume } = synthetic(80, 250, 180, 200, 0.6, 8);
    // Sans décalage imposé (A36 (6)) : planches égales, le plus petit nombre.
    const params = woodCentralParams({
      section: { layerThickness: 40, dressingAllowance: 5, maxGrainSlope: 5, jointOffset: 0 },
    });
    const { r, checks } = run(arcTrace(900, shape.sEnd), shape, params);
    const beta = Math.atan(0.05);
    const composed = r.layers.filter((l) => l.boards!.length > 1);
    expect(composed.length).toBeGreaterThan(0);
    for (const l of composed) {
      expect(r.parts.find((p) => p.id === l.partId)?.flat).toBeUndefined();
      for (const bd of l.boards!) {
        expect(bd.grainDeviation).toBeLessThanOrEqual(beta + 1e-9);
        expect(bd.across).toBeUndefined();
        const p = r.parts.find((x) => x.id === bd.partId)!;
        expect(p.mark).toBe(bd.mark);
        expect(p.componentOf).toBe(l.partId);
        expect(p.name.params?.["board"]).toBe(bd.index);
        // Fil selon la corde de la planche.
        const c = V.normalize(
          V.sub(arcTrace(900, 1).point(bd.sigma1), arcTrace(900, 1).point(bd.sigma0)),
        );
        expect(p.grain!.x).toBeCloseTo(c.x, 9);
        expect(p.grain!.y).toBeCloseTo(c.y, 9);
      }
      // Le plus petit nombre : une planche de moins dépasserait la pente.
      const n = l.boards!.length;
      const L = (l.sigma1 - l.sigma0) / (n - 1);
      expect(grainDeviationOf(arcTrace(900, 1), l.sigma0, l.sigma0 + L)).toBeGreaterThan(beta);
    }
    expect(r.maxGrainDeviation).toBeLessThanOrEqual(beta + 1e-9);
    expect(r.maxGrainDeviation).toBeGreaterThan(0);
    expect(Math.abs(volumeOf(r) - volume) / volume).toBeLessThan(1e-6);
    const note = r.notes.find((x) => x.key === "structure.woodCentral.note.layerBoards")!;
    expect(note.params?.["layers"]).toBe(composed.length);
    expect(note.params?.["boards"]).toBe(composed.reduce((acc, l) => acc + l.boards!.length, 0));
    // Un contrôle de débit et de longueur par planche.
    const stock = checks.results.filter((x) => x.ruleId === "FAB_DEBIT_DISPONIBLE");
    expect(stock).toHaveLength(fabricatedParts(r.parts).length);
  });

  it("hélicoïdal, défauts, couches empilées : planches LC1-k.j au débit", () => {
    const ctx = woodCentralContext(createProject("helical"));
    const params = woodCentralParams({ section: { curvedMethod: "stacked" } });
    const { beam, checks } = woodBeamOf(ctx, params);
    const boards = beam.parts.filter((p) => /^LC1-\d+\.\d+$/.test(p.mark));
    expect(boards.length).toBeGreaterThan(0);
    for (const p of boards) {
      // Planche composante de sa couche, elle-même composante de la poutre (A36 (9)).
      expect(p.componentOf).toBe(p.id.replace(/-\d+$/, ""));
      expect(rootAssemblyId(beam.parts, p.id)).toBe("wood-central-beam");
      expect(p.stock).toBeDefined();
      expect(p.flat).toBeDefined();
    }
    const ids = new Set(boards.map((p) => p.id));
    const violations = checks.results.filter(
      (x) =>
        x.ruleId === "FAB_DEBIT_DISPONIBLE" &&
        x.status === "violation" &&
        x.location.kind === "part" &&
        x.location.partId.startsWith("wood-central-layer-"),
    );
    expect(violations).toEqual([]);
    expect(
      checks.results.filter((x) => x.location.kind === "part" && ids.has(x.location.partId)).length,
    ).toBeGreaterThan(0);
    expect(beam.stacked?.maxGrainDeviation ?? 0).toBeLessThanOrEqual(
      Math.atan(DEFAULT_SLOPE / 100) + 1e-9,
    );
  });

  it("plateaux étroits : découpage en long imposé par la largeur du gabarit", () => {
    const narrow = resolveWorkshopProfile({ wood: { widths: [100] } });
    const { shape, volume } = synthetic(80, 250, 180, 200, 0.6, 8);
    const params = woodCentralParams({
      section: { width: 80, layerThickness: 40, dressingAllowance: 5, maxGrainSlope: 40 },
    });
    const trace = arcTrace(600, shape.sEnd);
    const { r, checks } = run(trace, shape, params, narrow);
    // Une seule planche par couche respecterait la pente (40 %) mais pas la largeur (95 mm).
    const wide = run(trace, shape, params).r;
    expect(wide.parts.length).toBeLessThan(r.parts.length);
    expect(r.layers.some((l) => l.boards!.length > 1)).toBe(true);
    for (const p of fabricatedParts(r.parts)) expect(p.stock!.width).toBe(100);
    const stock = checks.results.filter((x) => x.ruleId === "FAB_DEBIT_DISPONIBLE");
    expect(stock.every((x) => x.status === "ok")).toBe(true);
    expect(Math.abs(volumeOf(r) - volume) / volume).toBeLessThan(1e-6);
  });

  it("poutre plus large que les plateaux : planches collées sur chant", () => {
    const narrow = resolveWorkshopProfile({ wood: { widths: [100] } });
    const { shape, volume } = synthetic(200, 250, 180, 200, 0.6, 8);
    const params = woodCentralParams({
      section: { width: 200, layerThickness: 40, dressingAllowance: 5 },
    });
    const { r, checks } = run(straightTrace(shape.sEnd), shape, params, narrow);
    expect(r.errors).toEqual([]);
    for (const l of r.layers) {
      const boards = l.boards!;
      // k = ⌈200 / (95 − 5)⌉ = 3 bandes de 66,7 mm en travers, sur une trace droite.
      expect(boards).toHaveLength(3);
      const across = boards.map((bd) => bd.across!).sort((a, b) => a.d0 - b.d0);
      expect(across[0]!.d0).toBe(-100);
      expect(across[2]!.d1).toBe(100);
      for (let i = 1; i < 3; i++) expect(across[i]!.d0).toBeCloseTo(across[i - 1]!.d1, 9);
      for (const bd of boards) {
        const p = r.parts.find((x) => x.id === bd.partId)!;
        expect(p.componentOf).toBe(l.partId);
        expect(p.solid.kind === "ruled" && p.solid.thickness).toBeCloseTo(200 / 3, 9);
        const faces = p.flat!.lines.filter(
          (x) => x.label?.key === "structure.woodCentral.flatLine.layerFace",
        );
        // Une face finie sur les bandes de rive, aucune sur la bande du milieu.
        expect(faces.length).toBe(bd.across!.d0 === -100 || bd.across!.d1 === 100 ? 1 : 0);
      }
    }
    const stock = checks.results.filter((x) => x.ruleId === "FAB_DEBIT_DISPONIBLE");
    expect(stock.every((x) => x.status === "ok")).toBe(true);
    expect(Math.abs(volumeOf(r) - volume) / volume).toBeLessThan(1e-6);
  });

  it("garde-fou : couche gardée d'une pièce, remarque", () => {
    const { shape } = synthetic(80, 250, 180, 200, 0.6, 8);
    const params = woodCentralParams({
      section: { layerThickness: 40, dressingAllowance: 5, maxGrainSlope: 1 },
    });
    // R = 100 mm : une planche tourne d'au plus 2 × atan(1 %), soit moins de 2 mm de long.
    const { r } = run(arcTrace(100, shape.sEnd), shape, params);
    expect(r.errors).toEqual([]);
    const guarded = r.notes.filter((x) => x.key === "structure.woodCentral.note.layerBoardGuard");
    expect(guarded.length).toBeGreaterThan(0);
    for (const n of guarded) {
      expect(n.params?.["max"]).toBe(MAX_BOARDS);
      const l = r.layers.find((x) => x.mark === n.params?.["mark"])!;
      expect(l.boards).toHaveLength(1);
      expect(r.parts.some((p) => p.id === l.partId)).toBe(true);
    }
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
        const sum = volumeOf(r);
        expect(Math.abs(sum - volume) / volume).toBeLessThan(1e-6);
        for (const p of fabricatedParts(r.parts)) {
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

  it("assises et planches : joints aux assises, volume conservé, fil borné, planches jointives", () => {
    const arb = fc.record({
      t: fc.integer({ min: 20, max: 100 }),
      s: fc.integer({ min: 1, max: 10 }),
      b: fc.integer({ min: 60, max: 140 }),
      g: fc.integer({ min: 200, max: 320 }),
      h: fc.integer({ min: 150, max: 200 }),
      h0: fc.integer({ min: 120, max: 400 }),
      ratio: fc.double({ min: 0.3, max: 1, noNaN: true }),
      steps: fc.integer({ min: 2, max: 10 }),
      extraRadius: fc.integer({ min: 300, max: 3000 }),
      slope: fc.integer({ min: 2, max: 40 }),
      // Sous-ensemble des assises retenues comme niveaux (toujours croissants).
      keep: fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
      narrow: fc.boolean(),
    });
    fc.assert(
      fc.property(arb, (c) => {
        const { shape, volume } = synthetic(c.b, c.g, c.h, c.h0, (c.ratio * c.h) / c.g, c.steps);
        const seats = seatsOf(c.h, c.h0, c.steps).filter((_, k) => c.keep[k]);
        const R = c.b / 2 + c.s + c.extraRadius;
        const trace = arcTrace(R, shape.sEnd);
        const params = woodCentralParams({
          section: {
            width: c.b,
            layerThickness: c.t,
            dressingAllowance: c.s,
            maxGrainSlope: c.slope,
          },
        });
        const profile = c.narrow ? resolveWorkshopProfile({ wood: { widths: [120] } }) : PROFILE;
        let r: StackedLayersResult | undefined;
        let checks: CheckCollector | undefined;
        expect(() => {
          ({ r, checks } = run(trace, { ...shape, seatLevels: seats }, params, profile));
        }).not.toThrow();
        const res = r!;
        expect(res.errors).toEqual([]);
        // (i) chaque assise comprise entre la base et le plus haut dessus est un joint.
        const zTop = c.h0 + c.h * (c.steps - 1);
        const zs = res.layers.flatMap((l) => [l.z0, l.z1]);
        for (const seat of seats) {
          if (seat > 0 && seat <= zTop)
            expect(zs.some((z) => Math.abs(z - seat) < 1e-6)).toBe(true);
        }
        for (const l of res.layers) expect(l.z1 - l.z0).toBeLessThanOrEqual(c.t + 1e-9);
        // (ii) Σ volumes des pièces (couches et planches) = volume de la poutre.
        expect(Math.abs(volumeOf(res) - volume) / volume).toBeLessThan(1e-6);
        const beta = Math.atan(c.slope / 100);
        const guarded = new Set(
          res.notes
            .filter((n) => n.key === "structure.woodCentral.note.layerBoardGuard")
            .map((n) => n.params?.["mark"]),
        );
        const ids = new Set(res.parts.map((p) => p.id));
        const byId = new Map(res.parts.map((p) => [p.id, p]));
        let maxDev = 0;
        for (const l of res.layers) {
          const boards = l.boards!;
          expect(boards.length).toBeGreaterThan(0);
          for (const bd of boards) {
            maxDev = Math.max(maxDev, bd.grainDeviation);
            expect(ids.has(bd.partId)).toBe(true);
            // (iii) fil borné, ou garde-fou signalé.
            if (bd.grainDeviation > beta + 1e-9) expect(guarded.has(l.mark)).toBe(true);
          }
          // (iv) les planches recouvrent exactement [σ0 ; σ1] (et la largeur b), sans chevauchement.
          const along = [...new Set(boards.map((bd) => `${bd.sigma0}|${bd.sigma1}`))]
            .map((k) => k.split("|").map(Number) as [number, number])
            .sort((p, q) => p[0] - q[0]);
          expect(along[0]![0]).toBe(l.sigma0);
          expect(along[along.length - 1]![1]).toBe(l.sigma1);
          for (let i = 1; i < along.length; i++) expect(along[i]![0]).toBe(along[i - 1]![1]);
          for (const [a, e] of along) {
            const strips = boards
              .filter((bd) => bd.sigma0 === a && bd.sigma1 === e)
              .map((bd) => bd.across ?? { d0: -c.b / 2, d1: c.b / 2 })
              .sort((p, q) => p.d0 - q.d0);
            expect(strips[0]!.d0).toBeCloseTo(-c.b / 2, 9);
            expect(strips[strips.length - 1]!.d1).toBeCloseTo(c.b / 2, 9);
            for (let i = 1; i < strips.length; i++) {
              expect(strips[i]!.d0).toBeCloseTo(strips[i - 1]!.d1, 9);
            }
          }
          // Une couche d'une planche reste une pièce fabriquée ; une couche composée est une pièce
          // sans gabarit, dont les planches sont les composantes (A36 (9)).
          expect(ids.has(l.partId)).toBe(true);
          expect(byId.get(l.partId)!.flat === undefined).toBe(boards.length > 1);
          for (const bd of boards) {
            if (boards.length > 1) expect(byId.get(bd.partId)!.componentOf).toBe(l.partId);
          }
        }
        // (v) but de la décision (h) : hors garde-fou, chaque pièce tient dans la largeur du
        // plus large plateau du profil (aucun `FAB_DEBIT_DISPONIBLE` dû à la largeur).
        const widest = Math.max(...profile.wood.widths);
        const layerOf = new Map(
          res.layers.flatMap((l) =>
            [l.partId, ...l.boards!.map((bd) => bd.partId)].map((id) => [id, l.mark]),
          ),
        );
        for (const f of checks!.results.filter((x) => x.ruleId === "FAB_DEBIT_DISPONIBLE")) {
          const id = f.location?.kind === "part" ? f.location.partId : undefined;
          if (id === undefined || guarded.has(layerOf.get(id))) continue;
          expect(f.measured, id).toBeLessThanOrEqual(widest + 1e-9);
        }
        expect(res.maxGrainDeviation).toBeCloseTo(maxDev, 12);
        for (const p of res.parts) {
          expect(solidProblem(p.solid)).toBeUndefined();
          expect(Math.min(...sectionHeights(p))).toBeGreaterThan(0);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("ne lève jamais, même sur une forme quelconque (assises quelconques comprises)", () => {
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
          seats: fc.option(fc.array(num, { maxLength: 8 })),
          slope: fc.integer({ min: 1, max: 100 }),
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
            ...(c.seats ? { seatLevels: c.seats } : {}),
          };
          const params = woodCentralParams({
            section: { layerThickness: c.t, dressingAllowance: c.s, maxGrainSlope: c.slope },
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
