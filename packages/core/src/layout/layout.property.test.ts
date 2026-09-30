/**
 * Propriétés du tracé sur générateurs CONTRAINTS (`stairShapeArb`) : continuité, tangence,
 * distance d_f au jour, emmarchement E dans les parties droites, orientation, longueur exacte
 * de Γ, emprise, invariance par placement.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  curveEnd,
  curveLength,
  curvePointAt,
  curveStart,
  curveTangentAt,
  isContinuous,
  sampleCurve,
} from "../geom2d/curve.js";
import { distanceToCurve } from "../geom2d/intersect.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import { segLength, segTangentAt } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import type { Layout } from "../model/derived.js";
import type { Curve2 } from "../model/primitives.js";
import type { InnerCorner } from "../model/project.js";
import { computeLayout } from "./layout.js";
import { makeProject, setbackOf, stairShapeArb, type StairShape } from "./test-helpers.js";

const TOL = 1e-6;
const RUNS = { numRuns: 200 };

const turnInners = (shape: StairShape): InnerCorner[] => {
  const n = shape.legs.length - 1;
  const inner = shape.inner;
  return Array.from({ length: n }, (_, j) =>
    Array.isArray(inner)
      ? (inner[j] as InnerCorner)
      : ((inner ?? { kind: "sharp" }) as InnerCorner),
  );
};

/** Sens du tournant j. */
const dirOf = (shape: StairShape, j: number): "left" | "right" =>
  shape.directions?.[j] ?? shape.direction ?? "left";

/** Tournant le plus proche de l'abscisse s sur Γ (distance à [sStart ; sEnd]). */
function nearestTurn(layout: Layout, s: number): Layout["turns"][number] | undefined {
  let best: Layout["turns"][number] | undefined;
  let bestD = Infinity;
  for (const z of layout.turns) {
    const d = Math.max(0, z.sStart - s, s - z.sEnd);
    if (d < bestD) {
      best = z;
      bestD = d;
    }
  }
  return best;
}

/** Côté du jour au droit de s (S / Z : côté du tournant le plus proche). */
const collarSideAt = (layout: Layout, s: number): "left" | "right" =>
  nearestTurn(layout, s)?.collarSide ?? layout.innerSide;

/** Bord du jour au droit de s : `inner`, ou `outer` près d'un tournant de sens opposé. */
const collarCurveAt = (layout: Layout, s: number): Curve2 =>
  collarSideAt(layout, s) === layout.innerSide ? layout.inner : layout.outer;
const wallCurveAt = (layout: Layout, s: number): Curve2 =>
  collarSideAt(layout, s) === layout.innerSide ? layout.outer : layout.inner;

/** s dans une transition de la ligne de foulée (S / Z), à `margin` près. */
const inTransition = (layout: Layout, s: number, margin = 0): boolean =>
  (layout.walklineTransitions ?? []).some((t) => s > t.sStart - margin && s < t.sEnd + margin);

describe("computeLayout — propriétés", () => {
  it("tracés valides du générateur (≤ 2 tournants, marge) : aucune emprise dégénérée signalée", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        const jourNul =
          shape.legs.length === 3 &&
          (shape.directions?.[0] ?? shape.direction) ===
            (shape.directions?.[1] ?? shape.direction) &&
          shape.legs[1] === 2 * shape.width;
        if (!jourNul) expect(layout.errors).toBeUndefined();
      }),
      { numRuns: 300 },
    );
  });

  it("C_i, C_e et Γ sont continues (G0) ; Γ est tangente-continue (G1) hors transitions S / Z", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        expect(isContinuous(layout.inner, TOL)).toBe(true);
        expect(isContinuous(layout.outer, TOL)).toBe(true);
        expect(isContinuous(layout.walkline, TOL)).toBe(true);
        const segs = layout.walkline.segments.filter((s) => segLength(s) > 0);
        const transitions = layout.walklineTransitions ?? [];
        let s = 0;
        for (let i = 0; i + 1 < segs.length; i++) {
          s += segLength(segs[i]!);
          const t1 = segTangentAt(segs[i]!, 1);
          const t2 = segTangentAt(segs[i + 1]!, 0);
          // Raccord linéaire de d_f (S / Z) : Γ anguleuse aux bornes de la partie oblique,
          // d'un angle égal à l'angle de la transition.
          const kink = transitions.find(
            (t) => Math.abs(t.sStart - s) < TOL || Math.abs(t.sEnd - s) < TOL,
          );
          const angle = Math.acos(Math.max(-1, Math.min(1, V.dot(t1, t2))));
          if (kink) expect(Math.abs(angle - kink.angle)).toBeLessThan(1e-6);
          else expect(V.distance(t1, t2)).toBeLessThan(1e-9);
        }
      }),
      RUNS,
    );
  });

  it("distance de Γ au jour = d_f (poteau : ≥ d_f − a·√2/2, et d_f au coin dans le tournant)", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        const df = layout.walklineOffset;
        const inners = turnInners(shape);
        const hasNewel = inners.some((t) => t.kind === "newel");
        const minReach = Math.max(
          0,
          ...inners.map((t) => (t.kind === "newel" ? (t.size * Math.SQRT2) / 2 : 0)),
        );
        for (const { s, p } of sampleCurve(layout.walkline, 37)) {
          if (inTransition(layout, s)) continue;
          const d = distanceToCurve(p, collarCurveAt(layout, s));
          if (!hasNewel) {
            expect(Math.abs(d - df)).toBeLessThan(TOL);
          } else {
            expect(d).toBeGreaterThan(df - minReach - TOL);
            expect(d).toBeLessThan(df + TOL);
          }
          layout.turns.forEach((z, j) => {
            if (s >= z.sStart && s <= z.sEnd && inners[j]!.kind !== "arc") {
              expect(Math.abs(V.distance(p, z.innerCorner) - df)).toBeLessThan(TOL);
            }
          });
        }
      }),
      RUNS,
    );
  });

  it("parties droites : C_i à d_f et C_e à E − d_f de Γ, du bon côté (orientation)", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        const df = layout.walklineOffset;
        const E = shape.width;
        const inners = turnInners(shape);
        const margin = Math.max(0, ...inners.map(setbackOf)) + 1;
        const inTurn = (s: number): boolean =>
          layout.turns.some((z) => s > z.sStart - margin && s < z.sEnd + margin);
        for (const { s, p } of sampleCurve(layout.walkline, 53)) {
          if (inTurn(s) || inTransition(layout, s, margin)) continue;
          const t = curveTangentAt(layout.walkline, s);
          const nIn = collarSideAt(layout, s) === "left" ? V.perpLeft(t) : V.perpRight(t);
          expect(distanceToCurve(V.addScaled(p, nIn, df), collarCurveAt(layout, s))).toBeLessThan(
            TOL,
          );
          expect(distanceToCurve(V.addScaled(p, nIn, df - E), wallCurveAt(layout, s))).toBeLessThan(
            TOL,
          );
        }
      }),
      RUNS,
    );
  });

  it("orientation cohérente : mêmes directions de départ et d'arrivée, virage total ±90° par tournant", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        const a = ((shape.rotation ?? 0) * Math.PI) / 180;
        const up = V.rotate(V.vec(0, 1), a);
        const start = (c: typeof layout.inner) => curveTangentAt(c, 0);
        expect(V.distance(start(layout.walkline), up)).toBeLessThan(1e-9);
        expect(V.distance(start(layout.outer), up)).toBeLessThan(1e-9);
        const endDir = curveTangentAt(layout.walkline, curveLength(layout.walkline));
        // Bord du mur du dernier tournant (S / Z : `inner` si ce tournant est de sens opposé).
        const wallEnd = wallCurveAt(layout, curveLength(layout.walkline));
        expect(V.distance(curveTangentAt(wallEnd, curveLength(wallEnd)), endDir)).toBeLessThan(
          1e-9,
        );
        // Virage total de Γ (arcs ; les obliques d'une transition S / Z se compensent).
        const total = layout.walkline.segments.reduce(
          (acc, seg) => acc + (seg.kind === "arc" ? seg.sweep : 0),
          0,
        );
        const expectedTurn = layout.turns.reduce(
          (acc, z) => acc + ((z.direction === "left" ? 1 : -1) * Math.PI) / 2,
          0,
        );
        expect(total).toBeCloseTo(expectedTurn, 9);
        expect(V.distance(V.rotate(up, total), endDir)).toBeLessThan(1e-9);
        // Départ : Γ sur la ligne de départ, à d_f du bord intérieur.
        expect(
          Math.abs(
            V.distance(curveStart(layout.walkline), curveStart(layout.inner)) -
              layout.walklineOffset,
          ),
        ).toBeLessThan(TOL);
        expect(
          Math.abs(V.distance(curveStart(layout.inner), curveStart(layout.outer)) - shape.width),
        ).toBeLessThan(TOL);
        // Arrivée : Γ, C_i et C_e alignés sur la ligne d'arrivée.
        const ci = curveEnd(layout.inner);
        const ce = curveEnd(layout.outer);
        const g = curveEnd(layout.walkline);
        expect(Math.abs(V.distance(ci, ce) - shape.width)).toBeLessThan(TOL);
        expect(Math.abs(V.cross(V.sub(ce, ci), V.sub(g, ci)))).toBeLessThan(TOL * shape.width);
      }),
      RUNS,
    );
  });

  it("longueur exacte : |Γ| = ΣL − 2E·(N − 1) + Σ_j [(π/2)(r_j + d_f) − 2 r_j] (+ obliques S / Z)", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        const df = layout.walklineOffset;
        const legs = shape.legs as number[];
        const inners = turnInners(shape);
        const rOf = (t: InnerCorner): number => (t.kind === "arc" ? t.radius : 0);
        // S / Z avec d_f ≠ E/2 : la partie droite intermédiaire (longueur l) devient une oblique
        // de longueur √(l² + (E − 2·d_f)²).
        const skew = legs.reduce((acc, L, i) => {
          if (i === 0 || i >= inners.length || dirOf(shape, i - 1) === dirOf(shape, i)) return acc;
          const l = L - 2 * shape.width - rOf(inners[i - 1]!) - rOf(inners[i]!);
          const d = shape.width - 2 * df;
          return acc + Math.hypot(l, d) - l;
        }, 0);
        const expected =
          skew +
          legs.reduce((a, b) => a + b, 0) -
          2 * shape.width * inners.length +
          inners.reduce((acc, t) => {
            const r = rOf(t);
            return acc + (Math.PI / 2) * (r + df) - 2 * r;
          }, 0);
        expect(Math.abs(curveLength(layout.walkline) - expected)).toBeLessThan(1e-6);
        // Zones de tournant : longueur de l'arc, dans l'ordre, dans [0, |Γ|].
        layout.turns.forEach((z, j) => {
          const t = inners[j]!;
          const r = t.kind === "arc" ? t.radius : 0;
          expect(z.sEnd - z.sStart).toBeCloseTo((Math.PI / 2) * (r + df), 9);
          expect(z.index).toBe(j);
          expect(z.sStart).toBeGreaterThanOrEqual(j === 0 ? -TOL : layout.turns[j - 1]!.sEnd - TOL);
          expect(z.sEnd).toBeLessThanOrEqual(curveLength(layout.walkline) + TOL);
          expect(z.mode).toBe(shape.mode);
          expect(z.direction).toBe(dirOf(shape, j));
          expect(z.collarSide).toBe(dirOf(shape, j));
          expect(
            Math.abs(V.distance(z.innerCorner, z.outerCorner) - shape.width * Math.SQRT2),
          ).toBeLessThan(TOL);
        });
      }),
      RUNS,
    );
  });

  it("emprise CCW contenant Γ (hors extrémités)", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        expect(signedArea(layout.footprint)).toBeGreaterThan(0);
        const L = curveLength(layout.walkline);
        for (const { s, p } of sampleCurve(layout.walkline, 97)) {
          if (s < 1 || s > L - 1) continue;
          expect(pointInPolygon(p, layout.footprint, 1e-3)).toBe("inside");
        }
      }),
      RUNS,
    );
  });

  it("aire exacte de l'emprise : E·ΣL − E²·(N − 1) + Σ (1 − π/4)·r² (arc) − Σ 3·(a/2)² (poteau)", () => {
    // Relecture : vérifie la forme de C_i et C_e (recouvrement du carré d'angle, gain du
    // raccord en arc côté jour, trois quarts du poteau pris sur l'escalier). Tolérance : arcs
    // de C_i discrétisés à 0,1 mm de flèche.
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const layout = computeLayout(makeProject(shape));
        const E = shape.width;
        const legs = shape.legs as number[];
        const inners = turnInners(shape);
        const expected =
          E * legs.reduce((a, b) => a + b, 0) -
          E * E * inners.length +
          inners.reduce(
            (acc, t) =>
              acc +
              (t.kind === "arc" ? (1 - Math.PI / 4) * t.radius ** 2 : 0) -
              (t.kind === "newel" ? 3 * (t.size / 2) ** 2 : 0),
            0,
          );
        expect(Math.abs(signedArea(layout.footprint) - expected)).toBeLessThan(100);
      }),
      RUNS,
    );
  });

  it("invariance par placement : le tracé monde est l'image rigide du tracé local", () => {
    fc.assert(
      fc.property(stairShapeArb, (shape) => {
        const world = computeLayout(makeProject(shape));
        const local = computeLayout(makeProject({ ...shape, origin: { x: 0, y: 0 }, rotation: 0 }));
        const a = ((shape.rotation ?? 0) * Math.PI) / 180;
        const o = shape.origin ?? { x: 0, y: 0 };
        const map = (p: { x: number; y: number }) => V.add(V.rotate(p, a), o);
        expect(curveLength(world.walkline)).toBeCloseTo(curveLength(local.walkline), 6);
        for (const f of [0, 0.3, 0.77, 1]) {
          const sw = f * curveLength(world.walkline);
          expect(
            V.distance(curvePointAt(world.walkline, sw), map(curvePointAt(local.walkline, sw))),
          ).toBeLessThan(1e-6);
        }
        expect(Math.abs(signedArea(world.footprint) - signedArea(local.footprint))).toBeLessThan(
          1e-3,
        );
        world.turns.forEach((z, j) => {
          expect(V.distance(z.innerCorner, map(local.turns[j]!.innerCorner))).toBeLessThan(1e-6);
          expect(z.sStart).toBeCloseTo(local.turns[j]!.sStart, 6);
        });
      }),
      RUNS,
    );
  });
});
