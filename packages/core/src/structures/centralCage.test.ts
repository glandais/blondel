/**
 * Limons centraux bois (`wood-central`) et acier (`steel-central`) sur une cage saisie
 * (ADR-0010, sous-lot 6c). Trace de la poutre lue sur les tronçons et les jonctions
 * (`centralTrace.ts`, `cageCurve`) : une fonction de cage par bloc (`CENTRAL_CAGE`), égalité avec
 * la parallèle au bord du jour des volées à largeur uniforme, égalité avec la trace des volées
 * pour une cage issue de volées (exemples et préréglages), puis une propriété fast-check par
 * plugin sur des cages tirées parmi les seules fonctions déclarées.
 *
 * Convention de l'axe à largeur variable (à valider, QUESTIONS F18) : axe d'équerre sur les
 * lignes de départ et d'arrivée, tangent au premier et au dernier jour, rotation autour de chaque
 * jour à la moitié de la plus petite largeur de la jonction, tangente commune droite entre deux
 * pivots ; sans jonction tournante, droite d'équerre à mi-chemin des milieux, ramenée dans
 * l'emmarchement si elle en sort.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { cumulativeLengths, curvePointAt, curveTangentAt } from "../geom2d/curve.js";
import { distanceToCurve } from "../geom2d/intersect.js";
import { offsetCurve } from "../geom2d/offset.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { CAGE_FEATURES, cageFeatures, type CageFeature } from "../model/cageFeatures.js";
import type { Model, SolidDesc } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import type { Curve2, Polygon2, Vec2 } from "../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { suggestFixes } from "../project/fixes.js";
import { toCageLayout, toFlightsLayout } from "../project/layoutConversion.js";
import { parseProjectText } from "../project/parse.js";
import { createDemoProject, DEMO_PRESET_IDS } from "../project/presetDemo.js";
import { createProject, OPPOSITE_TURNS_PRESET_IDS, PRESET_IDS } from "../project/presets.js";
import { centralContext } from "./central.test-helpers.js";
import {
  buildCentralTrace,
  CENTRAL_CAGE,
  centralStairWidth,
  type CentralTrace,
} from "./centralTrace.js";
import { getStructure, structureCageFeatures } from "./registry.js";
import { buildSteelCentral } from "./steelCentral.js";
import { SteelCentralParamsSchema } from "./steelCentralParams.js";
import { woodBeamOf, woodCentralParams } from "./woodCentral.test-helpers.js";
import "./index.js";
import { expectFittedNotLarger, expectMarksUnified, sharedMarks } from "./marks.testing.js";

const FR = translatorFor("fr");
const KINDS = ["wood-central", "steel-central"] as const;
type Kind = (typeof KINDS)[number];

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

function cageProject(
  layout: CageLayoutSpecInput,
  kind: string = "steel-central",
  params: Record<string, unknown> = {},
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      structure: { kind, params },
    },
  });
}

/** Paramètres de trace d'un plugin (section et décalage), défauts du plugin. */
function traceParams(kind: Kind, over: Record<string, unknown> = {}) {
  return kind === "wood-central" ? woodCentralParams(over) : SteelCentralParamsSchema.parse(over);
}

function traceOf(
  project: Project,
  over: Record<string, unknown> = {},
): { ctx: StructureContext; trace: CentralTrace } {
  const ctx = centralContext(project);
  const r = buildCentralTrace(ctx, traceParams("steel-central", over));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { ctx, trace: r.trace };
}

/** Plus grand écart entre deux courbes, échantillonnées à abscisses proportionnelles. */
function pathGap(a: Curve2, b: Curve2): number {
  const la = cumulativeLengths(a).at(-1)!;
  const lb = cumulativeLengths(b).at(-1)!;
  let gap = Math.abs(la - lb);
  const n = 400;
  for (let i = 0; i <= n; i++) {
    gap = Math.max(gap, V.distance(curvePointAt(a, (la * i) / n), curvePointAt(b, (lb * i) / n)));
  }
  return gap;
}

/** Continuité en tangente de la trace (G1) à chaque raccord. */
function expectG1(trace: CentralTrace): void {
  const cum = cumulativeLengths(trace.curve);
  for (let i = 1; i + 1 < cum.length; i++) {
    const a = curveTangentAt(trace.curve, cum[i]! - 1e-6);
    const b = curveTangentAt(trace.curve, cum[i]! + 1e-6);
    expect(Math.abs(V.signedAngle(a, b)), `σ = ${cum[i]}`).toBeLessThan(1e-6);
  }
}

/** Plus petite distance de la trace aux bords du tracé (échantillons tous les 10 mm). */
function edgeClearance(trace: CentralTrace, m: { layout: Model["layout"] }): number {
  let min = Infinity;
  for (let s = 0; s <= trace.length; s += 10) {
    const p = trace.point(s);
    min = Math.min(min, distanceToCurve(p, m.layout.inner), distanceToCurve(p, m.layout.outer));
  }
  return min;
}

const featuresOf = (p: Project): CageFeature[] => cageFeatures(p.stair.layout as CageLayoutSpec);

// ------------------------------------------------------------------ cages représentatives

const CAGES = {
  "60° balancé": {
    kind: "cage",
    sections: [straight(1650), straight(1650)],
    junctions: [{ angle: 60, mode: "winders" }],
  },
  "palier droit": {
    kind: "cage",
    sections: [straight(1890), straight(1620)],
    junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
  },
  trapèze: {
    kind: "cage",
    sections: [straight(1450, 900, 1200), straight(1400, 1200)],
    junctions: [{ angle: 90, mode: "winders" }],
  },
  "rayonnant à 75°, jour en arc": {
    kind: "cage",
    sections: [straight(1640), straight(1640)],
    junctions: [{ angle: 75, mode: "radiating", well: { kind: "arc", radius: 400 } }],
  },
  "congé côté mur à −120°": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: -120, mode: "winders", wall: { kind: "arc", radius: 300 } }],
  },
  "pan coupé à 120°": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [
      { angle: 120, mode: "winders", well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 } },
    ],
  },
  "S (sens opposés)": {
    kind: "cage",
    sections: [straight(1200), straight(1500), straight(1200)],
    junctions: [
      { angle: 90, mode: "landing" },
      { angle: -90, mode: "landing" },
    ],
  },
  "trapèze, palier droit et 45° à pan coupé": {
    kind: "cage",
    sections: [straight(1300, 900, 1100), straight(900, 1000), straight(1400, 1000, 850)],
    junctions: [
      { angle: 0, mode: "landing", depth: 950 },
      { angle: -45, mode: "winders", well: { kind: "chamfer", setbackIn: 200, setbackOut: 200 } },
    ],
  },
} satisfies Record<string, CageLayoutSpecInput>;

// ------------------------------------------------------------------ capacités

describe("capacités : fonctions de cage des limons centraux (sous-lot 6c)", () => {
  it.each(KINDS)("%s : toutes sauf l'axe en arc (lot « acier cintré »)", (kind) => {
    expect(structureCageFeatures(kind)).toEqual(CENTRAL_CAGE);
    expect(CENTRAL_CAGE).not.toContain("arcAxis");
    expect(CAGE_FEATURES.filter((f) => !CENTRAL_CAGE.includes(f))).toEqual(["arcAxis"]);
  });

  it("les cages du jeu couvrent chaque fonction déclarée", () => {
    const seen = new Set(Object.values(CAGES).flatMap((s) => featuresOf(cageProject(s))));
    expect([...seen].sort()).toEqual([...CENTRAL_CAGE].sort());
  });
});

// ------------------------------------------------------------------ trace, fonction par fonction

describe("trace de la poutre sur une cage, fonction par fonction", () => {
  it("anyAngle : arc de rayon E/2 centré au coin du jour, balayage de 60°, parallèle au jour", () => {
    const p = cageProject(CAGES["60° balancé"]);
    const { ctx, trace } = traceOf(p);
    expect(trace.kind).toBe("turning");
    expect(trace.arcs).toHaveLength(1);
    const arc = trace.arcs[0]!;
    expect(arc.radius).toBeCloseTo(450, 9);
    expect(arc.turnsLeft).toBe(true);
    expect(arc.sigma1 - arc.sigma0).toBeCloseTo((450 * Math.PI) / 3, 6);
    const mid = trace.point((arc.sigma0 + arc.sigma1) / 2);
    expect(V.distance(mid, ctx.layout.turns[0]!.innerCorner)).toBeCloseTo(450, 6);
    expect(pathGap(trace.curve, offsetCurve(ctx.layout.inner, 450, "right"))).toBeLessThan(1e-6);
    expectG1(trace);
  });

  it("chamfer : deux arcs autour des extrémités du pan coupé, droite parallèle au pan entre eux", () => {
    const p = cageProject(CAGES["pan coupé à 120°"]);
    const { ctx, trace } = traceOf(p);
    expect(trace.arcs).toHaveLength(2);
    for (const a of trace.arcs) expect(a.radius).toBeCloseTo(450, 9);
    const total = trace.arcs.reduce((s, a) => s + (a.sigma1 - a.sigma0), 0);
    expect(total).toBeCloseTo((450 * 2 * Math.PI) / 3, 6);
    expect(pathGap(trace.curve, offsetCurve(ctx.layout.inner, 450, "right"))).toBeLessThan(1e-6);
    expectG1(trace);
  });

  it("radiating, jour en arc : arc de rayon r + E/2 autour du centre du jour", () => {
    const p = cageProject(CAGES["rayonnant à 75°, jour en arc"]);
    const { ctx, trace } = traceOf(p);
    expect(trace.arcs).toHaveLength(1);
    expect(trace.arcs[0]!.radius).toBeCloseTo(850, 9);
    const wellArc = ctx.layout.inner.segments.find((s) => s.kind === "arc");
    expect(wellArc?.kind).toBe("arc");
    const mid = trace.point((trace.arcs[0]!.sigma0 + trace.arcs[0]!.sigma1) / 2);
    if (wellArc?.kind === "arc") expect(V.distance(mid, wellArc.center)).toBeCloseTo(850, 6);
    expect(pathGap(trace.curve, offsetCurve(ctx.layout.inner, 450, "right"))).toBeLessThan(1e-6);
  });

  it("wallArc : le congé côté mur ne change pas la trace (poutre sous les marches)", () => {
    const withArc = cageProject(CAGES["congé côté mur à −120°"]);
    const sharp = cageProject({
      ...CAGES["congé côté mur à −120°"],
      junctions: [{ angle: -120, mode: "winders" }],
    });
    const a = traceOf(withArc).trace;
    const b = traceOf(sharp).trace;
    expect(a.arcs[0]!.turnsLeft).toBe(false);
    expect(pathGap(a.curve, b.curve)).toBeLessThan(1e-9);
  });

  it("straightLanding : trace droite au milieu, courbe des nez de niveau sur le palier", () => {
    const p = cageProject(CAGES["palier droit"]);
    const { ctx, trace } = traceOf(p);
    expect(trace.kind).toBe("straight");
    expect(trace.curve.segments).toHaveLength(1);
    const start = ctx.layout.sections![0]!.start;
    expect(V.distance(trace.point(0), V.lerp(start.left, start.right, 0.5))).toBeLessThan(1e-9);
    const landing = ctx.stepping.treads.find((t) => t.kind === "landing");
    expect(landing).toBeDefined();
    const k = landing!.number;
    const s0 = trace.nosingSigma[k - 1]!;
    const s1 = trace.nosingSigma[k]!;
    // De niveau sur le palier (jusqu'à un giron avant le nez suivant).
    const z = ctx.stepping.nosings[k - 1]!.z;
    expect(trace.nosingZ(s0 + (s1 - s0) * 0.25)).toBeCloseTo(z, 6);
    expectG1(trace);
  });

  it("oppositeTurns : S saisi en cage = trace du S en volées (tangente croisée au milieu)", () => {
    const cage = cageProject(CAGES["S (sens opposés)"]);
    expect(featuresOf(cage)).toEqual(["oppositeTurns"]);
    const flights = toFlightsLayout(cage);
    expect(flights).not.toBeNull();
    const a = traceOf(cage).trace;
    const b = traceOf(flights!).trace;
    expect(a.arcs.map((x) => x.turnsLeft)).toEqual([true, false]);
    expect(pathGap(a.curve, b.curve)).toBeLessThan(1e-6);
    expectG1(a);
  });

  it("variableWidth, ancrage centré : milieu des lignes d'extrémité (largeur de la jonction voisine), remarque F18", () => {
    const p = cageProject(CAGES["trapèze"]);
    const { ctx, trace } = traceOf(p);
    const secs = ctx.layout.sections!;
    const mid = (l: { left: Vec2; right: Vec2 }) => V.lerp(l.left, l.right, 0.5);
    expect(V.distance(trace.point(0), mid(secs[0]!.start))).toBeLessThan(1e-9);
    expect(V.distance(trace.point(trace.length), mid(secs[1]!.end))).toBeLessThan(1e-6);
    expect(trace.arcs).toHaveLength(1);
    expect(trace.arcs[0]!.radius).toBeCloseTo(600, 9);
    const arcMid = trace.point((trace.arcs[0]!.sigma0 + trace.arcs[0]!.sigma1) / 2);
    expect(V.distance(arcMid, ctx.layout.turns[0]!.innerCorner)).toBeCloseTo(600, 6);
    expect(trace.notes.map((n) => n.key)).toContain("structure.steelCentral.note.cageAxis");
    expectG1(trace);
    // Section 100 mm : la poutre reste à au moins 50 mm des deux bords.
    expect(edgeClearance(trace, ctx)).toBeGreaterThan(50);
  });

  it("variableWidth autour d'un palier droit et d'un pan coupé : trace continue en tangente, dans l'emmarchement", () => {
    const p = cageProject(CAGES["trapèze, palier droit et 45° à pan coupé"]);
    const { ctx, trace } = traceOf(p);
    expect(trace.arcs).toHaveLength(2);
    // Pan coupé entre 1 000 (fin du palier) et 1 000 (départ du trapèze 1 000 → 850).
    for (const a of trace.arcs) expect(a.radius).toBeCloseTo(500, 9);
    expectG1(trace);
    expect(edgeClearance(trace, ctx)).toBeGreaterThan(50);
  });

  it("décalage latéral : le rayon d'axe devient E/2 − décalage du côté du jour", () => {
    const p = cageProject(CAGES["60° balancé"]);
    const toward = traceOf(p, { trace: { lateralOffset: 100 } }).trace;
    expect(toward.arcs[0]!.radius).toBeCloseTo(350, 9);
    const away = traceOf(p, { trace: { lateralOffset: -100 } }).trace;
    expect(away.arcs[0]!.radius).toBeCloseTo(550, 9);
    const right = traceOf(cageProject(CAGES["congé côté mur à −120°"]), {
      trace: { lateralOffset: 100 },
    }).trace;
    expect(right.arcs[0]!.radius).toBeCloseTo(550, 9);
  });

  it("largeurs différentes à une jonction tournante : rayon = moitié de la plus petite", () => {
    for (const [w0, w1] of [
      [900, 1200],
      [1200, 900],
    ] as const) {
      const p = cageProject({
        kind: "cage",
        sections: [straight(1600, w0), straight(1600, w1)],
        junctions: [{ angle: 90, mode: "winders" }],
      });
      const { ctx, trace } = traceOf(p);
      expect(trace.arcs, `${w0} → ${w1}`).toHaveLength(1);
      expect(trace.arcs[0]!.radius, `${w0} → ${w1}`).toBeCloseTo(450, 9);
      const arcMid = trace.point((trace.arcs[0]!.sigma0 + trace.arcs[0]!.sigma1) / 2);
      expect(V.distance(arcMid, ctx.layout.turns[0]!.innerCorner)).toBeCloseTo(450, 6);
      expectG1(trace);
    }
  });

  it("variableWidth ancré côté mur avant un tournant : axe d'équerre décalé du milieu, erreur de la convention s'il sort", () => {
    // Trapèze 800 → 1 300 ancré à droite (côté mur d'un tournant à gauche) : la droite
    // d'équerre tangente au jour (ρ = 500) longe le bord du jour au départ.
    const layout: CageLayoutSpecInput = {
      kind: "cage",
      sections: [
        { axis: { kind: "straight", length: 1800 }, width: 800, widthEnd: 1300, anchor: "right" },
        straight(1800, 1000),
      ],
      junctions: [{ angle: 90, mode: "winders" }],
    };
    const p = cageProject(layout);
    const ctx = centralContext(p);
    const box = { section: { kind: "box", width: 100 } };
    const r = buildCentralTrace(ctx, traceParams("steel-central", box));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.key)).toEqual([
        "structure.steelCentral.error.cageAxisOutsideWidth",
      ]);
      expect(FR.t(r.errors[0]!)).toContain("largeur variable");
    }
    // Décalé vers le mur : la poutre tient, sa tête n'est pas au milieu de la ligne de départ.
    const shifted = buildCentralTrace(
      ctx,
      traceParams("steel-central", { ...box, trace: { lateralOffset: -100 } }),
    );
    expect(shifted.ok).toBe(true);
    if (shifted.ok) {
      const start = ctx.layout.sections![0]!.start;
      expect(
        V.distance(shifted.trace.point(0), V.lerp(start.left, start.right, 0.5)),
      ).toBeGreaterThan(100);
      expect(edgeClearance(shifted.trace, ctx)).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(shifted.trace.notes.map((n) => n.key)).toContain(
        "structure.steelCentral.note.cageAxis",
      );
    }
  });

  it("tronçon unique de largeur variable ancré d'un côté : axe droit ramené dans l'emmarchement", () => {
    const p = cageProject({
      kind: "cage",
      sections: [
        { axis: { kind: "straight", length: 3000 }, width: 500, widthEnd: 1500, anchor: "left" },
      ],
      junctions: [],
    });
    const ctx = centralContext(p);
    const r = buildCentralTrace(
      ctx,
      traceParams("steel-central", { section: { kind: "box", width: 100 } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trace.kind).toBe("straight");
      expect(edgeClearance(r.trace, ctx)).toBeGreaterThanOrEqual(50 - 1e-6);
      // Tête sur la ligne de départ (large de 500 mm), à au moins 50 mm de ses extrémités.
      const start = ctx.layout.sections![0]!.start;
      const q = r.trace.point(0);
      expect(V.distance(q, start.left)).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(V.distance(q, start.right)).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(Math.abs(V.cross(V.sub(start.right, start.left), V.sub(q, start.left)))).toBeLessThan(
        1e-6,
      );
    }
    const m = buildModel(p, { memo: false });
    expect(m.errors.filter((e) => e.key.startsWith("structure."))).toEqual([]);
  });

  it("largeur uniforme : aucune remarque de convention d'axe", () => {
    for (const name of ["60° balancé", "S (sens opposés)", "palier droit"] as const) {
      const { trace } = traceOf(cageProject(CAGES[name]));
      expect(
        trace.notes.map((n) => n.key),
        name,
      ).not.toContain("structure.steelCentral.note.cageAxis");
      const m = buildModel(cageProject(CAGES[name]), { memo: false });
      expect(
        (m.notes ?? []).map((n) => n.key),
        name,
      ).not.toContain("structure.steelCentral.note.cageAxis");
    }
  });

  it("poutre hors de l'emmarchement : erreur, aucune exception", () => {
    const p = cageProject(CAGES["trapèze"]);
    const ctx = centralContext(p);
    const r = buildCentralTrace(
      ctx,
      traceParams("steel-central", { trace: { lateralOffset: 420 } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.key)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^structure\.steelCentral\.error\./)]),
      );
    }
  });

  it("pivots qui se recoupent (jonctions trop proches) : erreur explicite, aucune exception", () => {
    // Le moteur de cage refuse en amont les tracés aussi serrés : tracé retouché pour le
    // garde-fou de la trace (jours des deux tournants opposés à 100 mm l'un de l'autre).
    const ctx = centralContext(cageProject(CAGES["S (sens opposés)"]));
    const [t0, t1] = ctx.layout.turns;
    const layout = {
      ...ctx.layout,
      turns: [t0!, { ...t1!, innerCorner: V.add(t0!.innerCorner, V.vec(100, 0)) }],
    };
    const r = buildCentralTrace({ ...ctx, layout }, traceParams("steel-central"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.key)).toEqual([
        "structure.steelCentral.error.cageTraceJunction",
      ]);
      expect(r.errors[0]!.params).toEqual({ junction: 2 });
      expect(FR.t(r.errors[0]!)).toContain("jonction 2");
    }
  });
});

// ------------------------------------------------------------------ largeur uniforme = volées

/** Cages de largeur uniforme, tournants de même sens (jour vif, en arc, pan coupé), paliers. */
const uniformCageArb = fc
  .record({
    width: fc.integer({ min: 800, max: 1200 }),
    sections: fc.array(fc.integer({ min: 700, max: 2000 }), { minLength: 1, maxLength: 3 }),
    junctions: fc.array(
      fc.record({
        landing: fc.boolean(),
        angle: fc.integer({ min: 20, max: 135 }),
        mode: fc.constantFrom("winders" as const, "landing" as const, "radiating" as const),
        well: fc.oneof(
          fc.constant({ kind: "sharp" as const }),
          fc.integer({ min: 50, max: 500 }).map((radius) => ({ kind: "arc" as const, radius })),
          fc
            .integer({ min: 50, max: 300 })
            .map((d) => ({ kind: "chamfer" as const, setbackIn: d, setbackOut: d })),
        ),
        depth: fc.integer({ min: 800, max: 1200 }),
      }),
      { minLength: 2, maxLength: 2 },
    ),
    sign: fc.constantFrom(1, -1),
    offset: fc.integer({ min: -150, max: 150 }),
  })
  .map((r) => ({
    offset: r.offset,
    sign: r.sign,
    width: r.width,
    layout: {
      kind: "cage" as const,
      sections: r.sections.map((l) => straight(l, r.width)),
      junctions: r.junctions
        .slice(0, r.sections.length - 1)
        .map((j) =>
          j.landing
            ? { angle: 0, mode: "landing" as const, depth: j.depth }
            : { angle: r.sign * j.angle, mode: j.mode, well: j.well },
        ),
    },
  }));

describe("largeur uniforme : trace de la cage = parallèle au bord du jour (construction des volées)", () => {
  it("propriété : écart ≤ 1e-6 mm, quelle que soit la jonction", () => {
    let compared = 0;
    fc.assert(
      fc.property(uniformCageArb, ({ layout, offset, sign, width }) => {
        const p = cageProject(layout);
        const m = buildModel(cageProject(layout, "none"), { memo: false });
        if (m.errors.length > 0 || m.stepping.treads.length < 2) return;
        const params = traceParams("steel-central", { trace: { lateralOffset: offset } });
        const r = buildCentralTrace(centralContext(p), params);
        if (!r.ok) return;
        const turning = layout.junctions.some((j) => j.angle !== 0);
        // Volées : parallèle à `inner` à E/2 ∓ décalage, côté mur (sans tournant : bord gauche).
        const innerLeft = turning ? sign > 0 : true;
        const dA = width / 2 - (innerLeft ? 1 : -1) * offset;
        const expected = offsetCurve(m.layout.inner, dA, innerLeft ? "right" : "left");
        expect(pathGap(r.trace.curve, expected)).toBeLessThan(1e-6);
        compared++;
      }),
      { numRuns: 150, seed: 63 },
    );
    expect(compared).toBeGreaterThan(75);
  });
});

// ------------------------------------------------------------------ cage issue de volées

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

const isFlights = (p: Project): boolean =>
  p.stair.layout.kind !== "helical" && p.stair.layout.kind !== "cage";

/** Exemples à volées, démonstrations et préréglages (placement tourné compris). */
function flightsProjects(): [string, Project][] {
  const out: [string, Project][] = [];
  for (const f of readdirSync(EXAMPLES_DIR).filter((x) => x.endsWith(".blondel.json"))) {
    const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, f), "utf8"));
    if (!isFlights(project)) continue;
    out.push([f, project]);
  }
  for (const id of DEMO_PRESET_IDS) {
    const p = createDemoProject(id);
    if (isFlights(p)) out.push([id, p]);
  }
  for (const id of [...PRESET_IDS, ...OPPOSITE_TURNS_PRESET_IDS]) {
    const p = createProject(id);
    if (!isFlights(p)) continue;
    out.push([id, p]);
    out.push([
      `${id} tourné`,
      { ...p, stair: { ...p.stair, placement: { origin: { x: 1234, y: -567 }, rotation: 37 } } },
    ]);
  }
  return out;
}

describe("cage issue de volées : même trace, mêmes pièces que les volées", () => {
  const cases = flightsProjects();

  it("le jeu compte des exemples et des préréglages", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(KINDS)("%s : trace égale à 1e-6 mm, mêmes repères de pièces et mêmes erreurs", (kind) => {
    let compared = 0;
    for (const [name, base] of cases) {
      const flights: Project = {
        ...base,
        stair: { ...base.stair, structure: { kind, params: {} } },
      };
      const cage = toCageLayout(flights);
      if (cage === null) continue;
      const a = buildCentralTrace(centralContext(flights), traceParams(kind));
      const b = buildCentralTrace(centralContext(cage), traceParams(kind));
      expect(b.ok, name).toBe(a.ok);
      if (!a.ok || !b.ok) {
        if (!a.ok && !b.ok)
          expect(
            b.errors.map((e) => e.key),
            name,
          ).toEqual(a.errors.map((e) => e.key));
        continue;
      }
      expect(pathGap(a.trace.curve, b.trace.curve), name).toBeLessThan(1e-6);
      expect(b.trace.kind, name).toBe(a.trace.kind);
      const ma = buildModel(flights, { memo: false });
      const mb = buildModel(cage, { memo: false });
      expect(
        mb.errors.map((e) => e.key),
        name,
      ).toEqual(ma.errors.map((e) => e.key));
      expect(
        mb.parts.map((p) => p.mark),
        name,
      ).toEqual(ma.parts.map((p) => p.mark));
      expect(
        (mb.notes ?? []).map((n) => n.key),
        name,
      ).toEqual((ma.notes ?? []).map((n) => n.key));
      // Pièces de structure : quantités et longueur de débit (à 1e-6 près).
      const structural = (m: Model) => m.parts.filter((p) => p.family === "structure");
      const sa = structural(ma);
      const sb = structural(mb);
      for (let i = 0; i < sa.length; i++) {
        const pa = sa[i]!;
        const pb = sb[i]!;
        expect(Object.keys(pb.quantities).sort(), `${name} ${pa.mark}`).toEqual(
          Object.keys(pa.quantities).sort(),
        );
        for (const [q, v] of Object.entries(pa.quantities)) {
          expect(pb.quantities[q]!, `${name} ${pa.mark}.${q}`).toBeCloseTo(v, 6);
        }
        expect(pb.stock?.length ?? 0, `${name} ${pa.mark}`).toBeCloseTo(pa.stock?.length ?? 0, 6);
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });
});

// ------------------------------------------------------------------ plugins sur les cages

/** Points en plan (repère monde) d'un solide. */
function planPoints(s: SolidDesc): Vec2[] {
  if (s.kind === "extrusion") {
    const f = s.frame;
    const out: Vec2[] = [];
    for (const ring of [s.profile.outer, ...s.profile.holes]) {
      for (const p of ring) {
        for (const d of [0, s.depth]) {
          out.push(
            V.vec(
              f.origin.x + f.xAxis.x * p.x + f.yAxis.x * p.y + f.zAxis.x * d,
              f.origin.y + f.xAxis.y * p.x + f.yAxis.y * p.y + f.zAxis.y * d,
            ),
          );
        }
      }
    }
    return out;
  }
  if (s.kind === "ruled") {
    return [...s.a, ...s.b].flatMap((p, i) => {
      const n = s.normals[i % s.normals.length]!;
      return [V.vec(p.x, p.y), V.vec(p.x + n.x * s.thickness, p.y + n.y * s.thickness)];
    });
  }
  return s.path.map((p) => V.vec(p.x, p.y));
}

/** Distance d'un point hors du polygone (0 dedans). */
function outsideBy(p: Vec2, poly: Polygon2): number {
  if (pointInPolygon(p, poly, 1e-6) !== "outside") return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ab = V.sub(b, a);
    const t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / V.dot(ab, ab)));
    d = Math.min(d, V.distance(p, V.addScaled(a, ab, t)));
  }
  return d;
}

/**
 * Construction saine d'un limon central sur une cage : aucune erreur de structure, poutre et
 * pièces de structure non vides, longueurs et aires positives, chaque marche portée (assise de
 * la poutre bois, support de la poutre acier, sous la marche), poutre dans l'emprise.
 */
function expectSound(kind: Kind, project: Project, m: Model, label: string): void {
  const structureErrors = m.errors.filter((e) => e.key.startsWith("structure."));
  expect(
    structureErrors.map((e) => e.key),
    label,
  ).toEqual([]);
  const structural = m.parts.filter((p) => p.family === "structure");
  expect(structural.length, label).toBeGreaterThan(0);
  for (const p of structural) {
    if (p.stock) expect(p.stock.length, `${label} ${p.mark}`).toBeGreaterThan(0);
    if (p.flat) {
      const ring = p.flat.outline.outer;
      let a = 0;
      for (let i = 0; i < ring.length; i++) a += V.cross(ring[i]!, ring[(i + 1) % ring.length]!);
      expect(Math.abs(a), `${label} ${p.mark}`).toBeGreaterThan(0);
    }
    for (const [q, v] of Object.entries(p.quantities)) {
      expect(Number.isFinite(v) && v >= 0, `${label} ${p.mark}.${q} = ${v}`).toBe(true);
    }
  }
  const ctx = centralContext(project);
  const treads = m.stepping.treads;
  // Axe à au moins une demi-largeur de section des deux bords, sur toute la trace (contrôle
  // indépendant de celui du plugin ; la tolérance du nez ne vaut qu'aux extrémités).
  const traceParamsOf =
    kind === "wood-central"
      ? woodCentralParams(project.stair.structure.params as Record<string, unknown>)
      : SteelCentralParamsSchema.parse(project.stair.structure.params ?? {});
  const tr = buildCentralTrace(ctx, traceParamsOf);
  expect(tr.ok, label).toBe(true);
  if (tr.ok) {
    expect(edgeClearance(tr.trace, m), label).toBeGreaterThanOrEqual(
      traceParamsOf.section.width / 2 - 1e-6,
    );
  }
  const overhang =
    project.stair.treads.nosing +
    (project.stair.treads.risers === "full" ? project.stair.treads.riserThickness : 0);
  if (kind === "wood-central") {
    const params = woodCentralParams(project.stair.structure.params as Record<string, unknown>);
    const { beam } = woodBeamOf(ctx, params);
    expect(beam.beamPartId, label).toBeDefined();
    const seated = new Set(beam.seats.map((s) => s.tread));
    for (const t of treads) expect(seated.has(t.number), `${label} M${t.number}`).toBe(true);
    const beamPart = m.parts.find((p) => p.id === beam.beamPartId)!;
    for (const q of planPoints(beamPart.solid)) {
      expect(outsideBy(q, m.layout.footprint), label).toBeLessThan(1 + overhang);
    }
  } else {
    const params = SteelCentralParamsSchema.parse(project.stair.structure.params ?? {});
    const r = buildSteelCentral(ctx, params);
    expect(r.beam, label).not.toBeNull();
    // Marche sans support : contrôle FAB_MARCHE_PORTEE en violation qui la nomme (contrat du
    // plugin, volées comprises : girons très courts) ; au plus une marche sur dix.
    const unsupported = m.compliance.results
      .filter((x) => x.ruleId === "FAB_MARCHE_PORTEE" && x.status === "violation")
      .map((x) => FR.t(x.message));
    let missing = 0;
    for (const t of treads) {
      const under = r.supports.filter((s) => s.tread === t.number);
      if (under.length === 0) {
        missing++;
        const mark = m.parts.find((p) => p.treadNumber === t.number)?.mark ?? "";
        expect(
          unsupported.some((x) => x.startsWith(`${mark} `)),
          `${label} ${mark}`,
        ).toBe(true);
      }
      // Support au droit de la poutre, sous la marche (à 1 mm près).
      for (const s of under) {
        expect(outsideBy(s.center, t.outline), `${label} M${t.number}`).toBeLessThan(1);
      }
    }
    expect(missing, label).toBeLessThanOrEqual(Math.floor(treads.length / 10));
    for (const p of m.parts.filter((x) => x.category === "stringer")) {
      for (const q of planPoints(p.solid)) {
        expect(outsideBy(q, m.layout.footprint), `${label} ${p.mark}`).toBeLessThan(1 + overhang);
      }
    }
  }
}

describe.each(KINDS)("%s sur une cage saisie : une fonction par cas", (kind) => {
  it.each(Object.entries(CAGES))("%s : construit, marches portées, aucune erreur", (name, s) => {
    const p = cageProject(s, kind);
    let m!: Model;
    expect(() => (m = buildModel(p, { memo: false }))).not.toThrow();
    expect(m.errors.map((e) => e.key)).not.toContain("structure.cageUnsupported");
    expectSound(kind, p, m, name);
  });

  it("axe en arc : refusé par le garde-fou, qui ne nomme que lui", () => {
    const p = cageProject(
      {
        kind: "cage",
        sections: [{ axis: { kind: "arc", radius: 2150, sweep: 100 }, width: 900 }],
        junctions: [],
      },
      kind,
    );
    const m = buildModel(p, { memo: false });
    const refusal = m.errors.filter((e) => e.key === "structure.cageUnsupported");
    expect(refusal).toHaveLength(1);
    expect(JSON.stringify(refusal[0]!.params)).toContain("layout.cage.feature.arcAxis");
    for (const f of CENTRAL_CAGE) {
      expect(JSON.stringify(refusal[0]!.params)).not.toContain(`layout.cage.feature.${f}"`);
    }
  });
});

describe("emmarchement repris par la poutre (prédimensionnement, domaine des règles)", () => {
  it("cage : plus grande largeur des tronçons ; volées : largeur du tracé", () => {
    expect(centralStairWidth(centralContext(cageProject(CAGES["trapèze"])))).toBe(1200);
    const mixed = CAGES["trapèze, palier droit et 45° à pan coupé"];
    expect(centralStairWidth(centralContext(cageProject(mixed)))).toBe(1100);
    expect(centralStairWidth(centralContext(cageProject(CAGES["60° balancé"])))).toBe(900);
    const flights = createProject("quarter-left");
    expect(centralStairWidth(centralContext(flights))).toBe(flights.stair.layout.width);
  });
});

describe("corrections : aucune reconversion en volées quand la cage est construite", () => {
  it.each(KINDS)("%s : cage sans fonction (quart tournant) et cage à 60°", (kind) => {
    for (const layout of [
      {
        kind: "cage" as const,
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 90, mode: "winders" as const }],
      },
      CAGES["60° balancé"],
    ]) {
      const p = cageProject(layout, kind);
      const m = buildModel(p, { memo: false });
      expect(m.errors).toEqual([]);
      expect(suggestFixes(p, m).map((f) => f.id)).not.toContain("cage-to-flights");
    }
  });
});

describe("steel-central sur une cage : section par défaut selon la trace", () => {
  const sectionKind = (layout: CageLayoutSpecInput): unknown => {
    const p = cageProject(layout, "steel-central");
    const defaults = getStructure("steel-central")!.defaults(centralContext(p)) as {
      section: { kind: string };
    };
    return defaults.section.kind;
  };

  it("cage tournante : caisson (le tube n'est pas pris en charge sur une trace courbe)", () => {
    expect(sectionKind(CAGES["60° balancé"])).toBe("box");
    expect(sectionKind(CAGES["S (sens opposés)"])).toBe("box");
    const m = buildModel(cageProject(CAGES["60° balancé"], "steel-central"), { memo: false });
    expect(m.errors).toEqual([]);
  });

  it("cage droite à palier droit : tube, trace droite", () => {
    expect(sectionKind(CAGES["palier droit"])).toBe("tube");
    const m = buildModel(cageProject(CAGES["palier droit"], "steel-central"), { memo: false });
    expect(m.errors).toEqual([]);
  });
});

// ------------------------------------------------------------------ propriétés

/** Cages tirées parmi les fonctions déclarées par les limons centraux (`CENTRAL_CAGE`). */
const centralCageArb = fc
  .record({
    sections: fc.array(
      fc.record({
        length: fc.integer({ min: 1100, max: 2200 }),
        width: fc.integer({ min: 800, max: 1200 }),
        widthEnd: fc.option(fc.integer({ min: 800, max: 1200 }), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    junctions: fc.array(
      fc.record({
        landing: fc.boolean(),
        angle: fc.integer({ min: 20, max: 135 }),
        sign: fc.constantFrom(1, -1),
        mode: fc.constantFrom("winders" as const, "landing" as const, "radiating" as const),
        well: fc.oneof(
          fc.constant({ kind: "sharp" as const }),
          fc.integer({ min: 50, max: 500 }).map((radius) => ({ kind: "arc" as const, radius })),
          fc
            .integer({ min: 50, max: 300 })
            .map((d) => ({ kind: "chamfer" as const, setbackIn: d, setbackOut: d })),
        ),
        wall: fc.oneof(
          fc.constant({ kind: "sharp" as const }),
          fc.integer({ min: 100, max: 500 }).map((radius) => ({ kind: "arc" as const, radius })),
        ),
        depth: fc.integer({ min: 800, max: 1200 }),
      }),
      { minLength: 2, maxLength: 2 },
    ),
  })
  .map((r): CageLayoutSpecInput => ({
    kind: "cage",
    // Un seul tronçon : assez long pour un escalier droit (girons d'au moins 150 mm).
    sections: r.sections.map((s, _i, all) =>
      straight(all.length === 1 ? s.length + 1500 : s.length, s.width, s.widthEnd),
    ),
    junctions: r.junctions
      .slice(0, r.sections.length - 1)
      .map((j) =>
        j.landing
          ? { angle: 0, mode: "landing" as const, depth: j.depth }
          : { angle: j.sign * j.angle, mode: j.mode, well: j.well, wall: j.wall },
      ),
  }));

/** Décalage latéral de l'axe tiré (mm, positif vers la gauche). */
const LATERAL_OFFSET_ARB = fc.oneof(fc.constant(0), fc.integer({ min: -100, max: 100 }));

/** Part maximale de tirages à trace impossible (0 mesuré sur les graines fixées, marge). */
const TRACE_FAILURE_MAX = 0.05;

/** Part minimale de tirages construits (≈ 0,83 mesuré ; le reste : tracés hors du domaine). */
const BUILT_MIN = 0.75;

/**
 * Variantes de paramètres : lamellé cintré sur moule ou couches empilées (`woodCentralLayers`),
 * platines à âme noyée (`woodCentralPlates`), sabots (défaut) ; marches bois sur consoles, tôle
 * pliée vissée (`treadFixing`), supports en tôle pliée, joints éclissés.
 */
const VARIANTS: readonly (readonly [Kind, Record<string, unknown>, number])[] = [
  ["wood-central", {}, 120],
  ["wood-central", { section: { curvedMethod: "stacked" } }, 40],
  ["wood-central", { anchors: { kind: "embeddedPlate" } }, 40],
  ["steel-central", {}, 120],
  ["steel-central", { treadKind: "folded-steel" }, 40],
  ["steel-central", { supports: { kind: "folded-u" } }, 40],
  ["steel-central", { section: { kind: "box" }, beam: { splice: "bolted" } }, 40],
];

describe("propriétés : cages tirées parmi les fonctions déclarées", () => {
  it.each(VARIANTS)(
    "%s %j : ne lève jamais, aucun refus, pièces, marches portées, longueurs > 0",
    (kind, params, numRuns) => {
      let built = 0;
      let runs = 0;
      let traceFailures = 0;
      let ecChecked = 0;
      const seen = new Set<CageFeature>();
      fc.assert(
        fc.property(centralCageArb, LATERAL_OFFSET_ARB, (layout, lateralOffset) => {
          runs++;
          const p = cageProject(layout, kind, { ...params, trace: { lateralOffset } });
          let m!: Model;
          expect(() => (m = buildModel(p, { memo: false }))).not.toThrow();
          const keys = m.errors.map((e) => e.key);
          expect(keys).not.toContain("structure.cageUnsupported");
          expect(keys).not.toContain("pipeline.internalError");
          for (const f of featuresOf(p)) expect(CENTRAL_CAGE).toContain(f);
          // Tracé ou découpage impossible (tronçons qui se recouvrent, etc.) : hors du domaine.
          if (m.stepping.treads.length === 0 || keys.some((k) => k.startsWith("layout."))) return;
          // Trace impossible : seulement les erreurs explicites de la trace.
          const traceErrors = keys.filter(
            (k) =>
              k === "structure.steelCentral.error.cageTraceJunction" ||
              k === "structure.steelCentral.error.beamOutsideWidth" ||
              k === "structure.steelCentral.error.cageAxisOutsideWidth" ||
              k === "structure.steelCentral.error.axisRadiusTooSmall",
          );
          if (traceErrors.length > 0) {
            expect(keys.filter((k) => k.startsWith("structure.")).sort()).toEqual(
              [...traceErrors].sort(),
            );
            traceFailures++;
            return;
          }
          for (const f of featuresOf(p)) seen.add(f);
          built++;
          expectSound(kind, p, m, JSON.stringify(layout));
          expectMarksUnified(m);
          // Entretoises EC (logées entre deux faces) : débit jamais plus grand que la pièce
          // réelle (même projet à T = 0), cote par cote (F10 Q3).
          if ([...sharedMarks(m.parts).keys()].some((k) => k.startsWith("EC"))) {
            const exact = { ...p, workshop: { ...p.workshop, identicalPartTolerance: 0 } };
            ecChecked += expectFittedNotLarger(m, buildModel(exact, { memo: false }), GEOM_EPS);
          }
        }),
        { numRuns, seed: 67 },
      );
      // Trace impossible : rare (largeur variable côté jour, décalage tiré) ; une régression de
      // la trace (tangentes refusées à tort) ferait monter ce taux.
      expect(traceFailures / runs).toBeLessThanOrEqual(TRACE_FAILURE_MAX);
      expect(built / runs).toBeGreaterThan(BUILT_MIN);
      if (numRuns >= 120) expect([...seen].sort()).toEqual([...CENTRAL_CAGE].sort());
      if (kind === "steel-central" && numRuns >= 120) expect(ecChecked).toBeGreaterThan(0);
    },
  );
});
