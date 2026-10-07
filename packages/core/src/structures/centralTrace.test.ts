import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import { segTangentAt } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import type { StructureContext } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { createProject } from "../project/presets.js";
import { ALL_TYPOLOGIES, makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { centralContext, centralParams, traceOf } from "./central.test-helpers.js";
import { beamTopAt, buildCentralTrace, type CentralTrace } from "./centralTrace.js";

const keysOf = (r: ReturnType<typeof buildCentralTrace>): string[] =>
  r.ok ? [] : r.errors.map((e) => e.key);

/** Contexte calculé, `null` si le tracé ou le découpage du projet généré lève. */
function contextOrNull(project: Project): StructureContext | null {
  try {
    return centralContext(project);
  } catch {
    return null;
  }
}

/** Propriétés générales d'une trace (G1, nez, courbe des nez, emprise). */
function checkTrace(ctx: StructureContext, trace: CentralTrace, width: number): void {
  const { stepping, layout } = ctx;
  // Continuité et tangence aux jonctions.
  const segs = trace.curve.segments;
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]!;
    const b = segs[i]!;
    const end =
      a.kind === "line"
        ? a.b
        : V.addScaled(a.center, V.fromAngle(a.startAngle + a.sweep), a.radius);
    const start =
      b.kind === "line" ? b.a : V.addScaled(b.center, V.fromAngle(b.startAngle), b.radius);
    expect(V.distance(end, start)).toBeLessThan(1e-3);
    expect(Math.abs(V.signedAngle(segTangentAt(a, 1), segTangentAt(b, 0)))).toBeLessThan(1e-6);
  }
  // Nez : abscisses strictement croissantes, courbe des nez passant par (σ_k, z_k).
  const sig = trace.nosingSigma;
  expect(sig.length).toBe(stepping.nosings.length);
  for (let k = 1; k < sig.length; k++) expect(sig[k]!).toBeGreaterThan(sig[k - 1]!);
  stepping.nosings.forEach((n, k) => {
    expect(Math.abs(trace.nosingZ(sig[k]!) - n.z)).toBeLessThan(1e-6);
    // Le point de la trace en σ_k est sur la ligne de nez k.
    const p = trace.point(sig[k]!);
    const d = Math.abs(V.cross(V.normalize(V.sub(n.r, n.q)), V.sub(p, n.q)));
    expect(d).toBeLessThan(1e-3);
  });
  // Monotonie de la courbe des nez (échantillonnée, prolongements compris).
  const lo = sig[0]! - 200;
  const hi = sig[sig.length - 1]! + 200;
  let prev = -Infinity;
  for (let s = lo; s <= hi; s += 7) {
    const z = trace.nosingZ(s);
    expect(z).toBeGreaterThanOrEqual(prev - 1e-9);
    prev = z;
  }
  // Trace et projection en plan de la poutre (± b/2) dans l'emprise (tolérance 0,5 mm : emprise
  // polygonale des arcs, flèche ≤ 0,1 mm).
  for (let s = sig[0]!; s <= sig[sig.length - 1]!; s += 10) {
    for (const off of [0, width / 2, -width / 2]) {
      const p = V.addScaled(trace.point(s), trace.left(s), off);
      expect(pointInPolygon(p, layout.footprint, 0.5)).not.toBe("outside");
    }
  }
}

describe("trace du limon central : exemples", () => {
  it("escalier droit : droite à E/2, nez espacés du giron, pente h/g", () => {
    const ctx = centralContext(createProject("straight"));
    const trace = traceOf(ctx, centralParams());
    expect(trace.kind).toBe("straight");
    expect(trace.arcs).toEqual([]);
    expect(trace.naissances).toEqual([]);
    const E = ctx.project.stair.layout.width;
    // Repère local : bord gauche x = 0, montée +Y.
    expect(trace.point(0).x).toBeCloseTo(E / 2, 9);
    expect(trace.point(1000).x).toBeCloseTo(E / 2, 9);
    const g = ctx.stepping.going;
    trace.nosingSigma.forEach((s, k) => expect(s).toBeCloseTo(k * g, 6));
    expect(trace.slope).toBeCloseTo(ctx.stepping.rise / g, 9);
    // Pente h/g entre deux nez (droite exacte entre les nez d'une partie droite).
    expect(trace.nosingZ(g * 2.5)).toBeCloseTo(
      ctx.stepping.nosings[2]!.z + ctx.stepping.rise / 2,
      6,
    );
    expect(beamTopAt(trace, 200, g)).toBeCloseTo(ctx.stepping.nosings[1]!.z - 200, 9);
    checkTrace(ctx, trace, 100);
  });

  it("décalage latéral positif : vers la gauche de la montée", () => {
    const ctx = centralContext(createProject("straight"));
    const trace = traceOf(ctx, centralParams({ trace: { lateralOffset: 100 } }));
    expect(trace.point(500).x).toBeCloseTo(ctx.project.stair.layout.width / 2 - 100, 9);
  });

  it("quart tournant à jour vif : un arc de rayon E/2 centré au coin", () => {
    for (const id of ["quarter-left", "quarter-right"] as const) {
      const ctx = centralContext(createProject(id));
      const trace = traceOf(ctx, centralParams());
      expect(trace.kind).toBe("turning");
      expect(trace.arcs).toHaveLength(1);
      const arc = trace.arcs[0]!;
      expect(arc.radius).toBeCloseTo(ctx.project.stair.layout.width / 2, 9);
      expect(arc.turnsLeft).toBe(id === "quarter-left");
      const center = ctx.layout.turns[0]!.innerCorner;
      const mid = trace.point((arc.sigma0 + arc.sigma1) / 2);
      expect(V.distance(mid, center)).toBeCloseTo(arc.radius, 6);
      expect(arc.sigma1 - arc.sigma0).toBeCloseTo((arc.radius * Math.PI) / 2, 6);
      expect(trace.naissances.map((n) => n.sigma)).toEqual([arc.sigma0, arc.sigma1]);
      checkTrace(ctx, trace, 100);
    }
  });

  it("jour en arc r_j : arc de rayon r_j + E/2", () => {
    const project = makeSteppingProject({
      width: 900,
      legs: [1800, 2830],
      inner: { kind: "arc", radius: 250 },
    });
    const ctx = centralContext(project);
    const trace = traceOf(ctx, centralParams());
    expect(trace.arcs).toHaveLength(1);
    expect(trace.arcs[0]!.radius).toBeCloseTo(250 + 450, 9);
    checkTrace(ctx, trace, 100);
  });

  it("poteau d'angle : remarque, arc centré au coin K comme un jour vif", () => {
    const project = makeSteppingProject({
      width: 900,
      legs: [1800, 2830],
      inner: { kind: "newel", size: 100 },
    });
    const ctx = centralContext(project);
    const trace = traceOf(ctx, centralParams());
    expect(trace.notes.map((n) => n.key)).toContain(
      "structure.steelCentral.note.newelNotGenerated",
    );
    expect(trace.arcs).toHaveLength(1);
    expect(trace.arcs[0]!.radius).toBeCloseTo(450, 9);
    const arc = trace.arcs[0]!;
    const mid = trace.point((arc.sigma0 + arc.sigma1) / 2);
    expect(V.distance(mid, ctx.layout.turns[0]!.innerCorner)).toBeCloseTo(450, 6);
    checkTrace(ctx, trace, 100);
  });

  it("escalier en S : chaque tournant du côté de son jour, trace G1", () => {
    const ctx = centralContext(createProject("two-quarters-s"));
    const trace = traceOf(ctx, centralParams());
    expect(trace.arcs.map((a) => a.turnsLeft)).toEqual([true, false]);
    for (const [j, arc] of trace.arcs.entries()) {
      const mid = trace.point((arc.sigma0 + arc.sigma1) / 2);
      expect(V.distance(mid, ctx.layout.turns[j]!.innerCorner)).toBeCloseTo(arc.radius, 6);
    }
    checkTrace(ctx, trace, 100);
  });

  it("palier : courbe des nez de niveau sur le palier puis montée sur un giron", () => {
    const ctx = centralContext(createProject("quarter-landing"));
    const trace = traceOf(ctx, centralParams());
    const landing = ctx.stepping.treads.find((t) => t.kind === "landing")!;
    const k = landing.number - 1;
    const s = trace.nosingSigma;
    const going = s[k + 2]! - s[k + 1]!;
    const z = ctx.stepping.nosings[k]!.z;
    for (let x = s[k]!; x <= s[k + 1]! - going; x += 10) {
      expect(trace.nosingZ(x)).toBeCloseTo(z, 6);
    }
    expect(trace.nosingZ(s[k + 1]! - going / 2)).toBeGreaterThan(z);
    checkTrace(ctx, trace, 100);
  });

  it("hélicoïdal : arc de rayon (R_i + R_e)/2, pente constante, fût non porteur", () => {
    const ctx = centralContext(createProject("helical"));
    const trace = traceOf(ctx, centralParams({ section: { kind: "box" } }));
    const h = ctx.layout.helical!;
    expect(trace.kind).toBe("helical");
    expect(trace.arcs).toHaveLength(1);
    expect(trace.arcs[0]!.radius).toBeCloseTo((h.innerRadius + h.outerRadius) / 2, 9);
    expect(trace.arcs[0]!.turnsLeft).toBe(h.direction === "left");
    expect(trace.naissances).toEqual([]);
    expect(trace.notes.map((n) => n.key)).toEqual([
      "structure.steelCentral.note.columnNotCarrying",
    ]);
    const R = trace.arcs[0]!.radius;
    expect(trace.slope).toBeCloseTo(ctx.stepping.rise / (R * h.stepAngle), 9);
    // Courbe des nez affine (pas constant) : milieu de deux nez à mi-hauteur.
    const s = trace.nosingSigma;
    expect(trace.nosingZ((s[3]! + s[4]!) / 2)).toBeCloseTo(
      (ctx.stepping.nosings[3]!.z + ctx.stepping.nosings[4]!.z) / 2,
      6,
    );
    checkTrace(ctx, trace, 100);
  });
});

describe("trace du limon central : erreurs", () => {
  it("poutre hors de l'emmarchement", () => {
    const ctx = centralContext(createProject("straight"));
    const r = buildCentralTrace(ctx, centralParams({ trace: { lateralOffset: 420 } }));
    expect(keysOf(r)).toEqual(["structure.steelCentral.error.beamOutsideWidth"]);
    const h = centralContext(createProject("helical"));
    const rh = buildCentralTrace(h, centralParams({ trace: { lateralOffset: 420 } }));
    expect(keysOf(rh)).toEqual(["structure.steelCentral.error.beamOutsideWidth"]);
  });

  it("rayon d'axe ≤ b/2 (flasque intérieure au-delà du centre)", () => {
    const ctx = centralContext(createProject("quarter-left"));
    // Jour à gauche : décalage de 300 vers le jour, rayon d'axe 150, section de 300.
    const r = buildCentralTrace(
      ctx,
      centralParams({ trace: { lateralOffset: 300 }, section: { width: 300 } }),
    );
    expect(keysOf(r)).toEqual(["structure.steelCentral.error.axisRadiusTooSmall"]);
  });
});

describe("trace du limon central : propriétés", () => {
  it("tracés à volées générés : trace G1, nez croissants, courbe des nez, emprise ; ne lève jamais", () => {
    fc.assert(
      fc.property(
        stairArb(["M1", "M3"], ALL_TYPOLOGIES),
        fc.integer({ min: -150, max: 150 }),
        fc.integer({ min: 60, max: 200 }),
        ({ project }, offset, width) => {
          const ctx = contextOrNull(project);
          fc.pre(ctx !== null);
          const params = centralParams({ trace: { lateralOffset: offset }, section: { width } });
          let r: ReturnType<typeof buildCentralTrace> | undefined;
          expect(() => (r = buildCentralTrace(ctx!, params))).not.toThrow();
          if (!r!.ok) {
            // Seules erreurs attendues sur des tracés réalistes : poutre hors emmarchement,
            // rayon d'axe trop petit (décalage vers un jour vif).
            for (const k of keysOf(r!)) {
              expect([
                "structure.steelCentral.error.beamOutsideWidth",
                "structure.steelCentral.error.axisRadiusTooSmall",
              ]).toContain(k);
            }
            return;
          }
          checkTrace(ctx!, r!.trace, width);
          expect(r!.trace.kind).toBe(ctx!.layout.turns.length > 0 ? "turning" : "straight");
        },
      ),
      { numRuns: 60 },
    );
  });

  it("hélicoïdaux générés : arc unique, courbe des nez affine", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 700, max: 1200 }),
        fc.integer({ min: 50, max: 250 }),
        fc.constantFrom("left" as const, "right" as const),
        fc.integer({ min: -100, max: 100 }),
        (outerRadius, coreRadius, direction, offset) => {
          let project: Project;
          try {
            project = createProject("helical", { outerRadius, coreRadius, direction });
          } catch {
            fc.pre(false);
            return;
          }
          const ctx = contextOrNull(project);
          fc.pre(ctx !== null);
          const r = buildCentralTrace(
            ctx!,
            centralParams({ trace: { lateralOffset: offset }, section: { kind: "box" } }),
          );
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.trace.arcs).toHaveLength(1);
          const h = ctx!.layout.helical!;
          const sign = h.direction === "left" ? 1 : -1;
          expect(r.trace.arcs[0]!.radius).toBeCloseTo(
            (h.innerRadius + h.outerRadius) / 2 - sign * offset,
            9,
          );
          checkTrace(ctx!, r.trace, 100);
        },
      ),
      { numRuns: 25 },
    );
  });
});
