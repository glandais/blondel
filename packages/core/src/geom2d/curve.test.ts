import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Curve2 } from "../model/primitives.js";
import {
  continuityGaps,
  curveEnd,
  curveLength,
  curvePointAt,
  curveStart,
  curveTangentAt,
  curveNormalAt,
  flattenCurve,
  fromPolyline,
  isContinuous,
  locate,
  makeCurve,
  reverseCurve,
  rotateCurve,
  sampleCurve,
  segmentAt,
  subCurve,
  translateCurve,
} from "./curve.js";
import { arcSeg, lineSeg, segLength, segTangentAt } from "./segment.js";
import { monotonePolyline } from "./testArbs.js";
import * as V from "./vec.js";

const EPS = 1e-6;

const polylineLength = (pts: readonly { x: number; y: number }[]): number =>
  pts.slice(1).reduce((s, p, i) => s + V.distance(pts[i]!, p), 0);

const radiusArb = fc.oneof(fc.constant(0), fc.double({ min: 1, max: 200, noNaN: true }));

const curveArb = fc
  .tuple(monotonePolyline(), radiusArb)
  .map(([pts, r]) => fromPolyline(pts, { radius: r }));

describe("fromPolyline", () => {
  it("angle vif : longueur = somme des segments", () => {
    fc.assert(
      fc.property(monotonePolyline(), (pts) => {
        const c = fromPolyline(pts);
        expect(Math.abs(curveLength(c) - polylineLength(pts))).toBeLessThan(EPS);
        expect(isContinuous(c)).toBe(true);
      }),
    );
  });

  it("raccord en arc : longueur = Σ segments − Σ (2 r tan(φ/2) − r φ)", () => {
    fc.assert(
      fc.property(monotonePolyline(), radiusArb, (pts, r) => {
        const c = fromPolyline(pts, { radius: r });
        let expected = polylineLength(pts);
        for (let i = 1; i + 1 < pts.length; i++) {
          const phi = Math.abs(
            V.signedAngle(V.sub(pts[i]!, pts[i - 1]!), V.sub(pts[i + 1]!, pts[i]!)),
          );
          expected -= 2 * r * Math.tan(phi / 2) - r * phi;
        }
        expect(Math.abs(curveLength(c) - expected)).toBeLessThan(1e-6);
        expect(continuityGaps(c, 1e-6)).toEqual([]);
        // Continuité G1 : tangentes égales aux jonctions (raccords non nuls).
        if (r > 0) {
          for (let i = 0; i + 1 < c.segments.length; i++) {
            const ta = segTangentAt(c.segments[i]!, 1);
            const tb = segTangentAt(c.segments[i + 1]!, 0);
            expect(V.distance(ta, tb)).toBeLessThan(2e-6);
          }
        }
      }),
    );
  });

  it("équerre avec raccord : segment, quart de cercle, segment", () => {
    const c = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)], { radius: 200 });
    expect(c.segments.map((s) => s.kind)).toEqual(["line", "arc", "line"]);
    const arc = c.segments[1]!;
    if (arc.kind !== "arc") throw new Error();
    expect(arc.center.x).toBeCloseTo(800, 9);
    expect(arc.center.y).toBeCloseTo(200, 9);
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(curveLength(c)).toBeCloseTo(1600 + 100 * Math.PI, 9);
  });

  it("rayons par sommet, erreurs", () => {
    const pts = [V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000), V.vec(0, 1000)];
    const c = fromPolyline(pts, { radius: [0, 100] });
    expect(c.segments.map((s) => s.kind)).toEqual(["line", "line", "arc", "line"]);
    expect(() => fromPolyline(pts, { radius: 600 })).toThrow();
    expect(() => fromPolyline([V.vec(0, 0), V.vec(1, 0), V.vec(0, 0)])).toThrow();
    expect(() => fromPolyline([V.vec(0, 0)])).toThrow();
    // Tableau de rayons de mauvaise longueur : erreur (pas de 0 silencieux).
    expect(() => fromPolyline(pts, { radius: [100] })).toThrow(/rayons/);
    // Points confondus fusionnés.
    expect(fromPolyline([V.vec(0, 0), V.vec(0, 0), V.vec(10, 0)]).segments).toHaveLength(1);
  });
});

describe("paramétrage curviligne", () => {
  it("pointAt est 1-lipschitzien (continuité) et tangente unitaire", () => {
    fc.assert(
      fc.property(curveArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (c, u, w) => {
        const L = curveLength(c);
        const s1 = u * L;
        const s2 = w * L;
        const d = V.distance(curvePointAt(c, s1), curvePointAt(c, s2));
        expect(d).toBeLessThanOrEqual(Math.abs(s1 - s2) + EPS);
        expect(Math.abs(V.norm(curveTangentAt(c, s1)) - 1)).toBeLessThan(1e-9);
        expect(V.dot(curveTangentAt(c, s1), curveNormalAt(c, s1))).toBeCloseTo(0, 9);
      }),
    );
  });

  it("extrémités, bornage, localisation", () => {
    const c = fromPolyline([V.vec(0, 0), V.vec(100, 0), V.vec(100, 50)]);
    expect(curvePointAt(c, 0)).toEqual(curveStart(c));
    expect(curvePointAt(c, 150)).toEqual(curveEnd(c));
    expect(curvePointAt(c, -10)).toEqual(V.vec(0, 0));
    expect(curvePointAt(c, 1e9)).toEqual(V.vec(100, 50));
    expect(segmentAt(c, 99.9)).toBe(0);
    expect(segmentAt(c, 100)).toBe(1);
    expect(locate(c, 150)).toEqual({ index: 1, t: 1, s: 150 });
    // Tangente à droite de la jonction.
    expect(curveTangentAt(c, 100)).toEqual({ x: 0, y: 1 });
  });

  it("segments de longueur nulle ignorés (pivot)", () => {
    const pivot = arcSeg(V.vec(100, 0), 0, -Math.PI / 2, Math.PI / 2);
    const c = makeCurve([lineSeg(V.vec(0, 0), V.vec(100, 0)), pivot, lineSeg(V.vec(100, 0), V.vec(100, 50))]);
    expect(curveLength(c)).toBe(150);
    expect(segmentAt(c, 100)).toBe(2);
    expect(curveTangentAt(c, 100)).toEqual({ x: 0, y: 1 });
  });

  it("makeCurve refuse une discontinuité", () => {
    expect(() => makeCurve([lineSeg(V.vec(0, 0), V.vec(1, 0)), lineSeg(V.vec(2, 0), V.vec(3, 0))])).toThrow();
    expect(() => makeCurve([])).toThrow();
  });
});

describe("subCurve / reverseCurve", () => {
  it("longueur = s1 − s0 et extrémités exactes", () => {
    fc.assert(
      fc.property(curveArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (c, u, w) => {
        const L = curveLength(c);
        const s0 = u * L;
        const s1 = w * L;
        const sub = subCurve(c, s0, s1);
        expect(Math.abs(curveLength(sub) - Math.abs(s1 - s0))).toBeLessThan(1e-6);
        expect(V.distance(curveStart(sub), curvePointAt(c, s0))).toBeLessThan(1e-6);
        expect(V.distance(curveEnd(sub), curvePointAt(c, s1))).toBeLessThan(1e-6);
        expect(isContinuous(sub)).toBe(true);
      }),
    );
  });

  it("reverseCurve : même longueur, point(s) = point_inv(L − s)", () => {
    fc.assert(
      fc.property(curveArb, fc.double({ min: 0, max: 1, noNaN: true }), (c, u) => {
        const r = reverseCurve(c);
        const L = curveLength(c);
        expect(Math.abs(curveLength(r) - L)).toBeLessThan(1e-6);
        expect(V.distance(curvePointAt(c, u * L), curvePointAt(r, L - u * L))).toBeLessThan(1e-6);
      }),
    );
  });

  it("sous-courbe se terminant sur une jonction", () => {
    const c = fromPolyline([V.vec(0, 0), V.vec(100, 0), V.vec(100, 50)]);
    const sub = subCurve(c, 20, 100);
    expect(sub.segments).toHaveLength(1);
    expect(curveEnd(sub)).toEqual(V.vec(100, 0));
  });
});

describe("transformations et échantillonnage", () => {
  it("translation / rotation conservent la longueur", () => {
    fc.assert(
      fc.property(curveArb, fc.double({ min: -7, max: 7, noNaN: true }), (c, a) => {
        const L = curveLength(c);
        const r = rotateCurve(translateCurve(c, V.vec(10, -20)), a, V.vec(3, 4));
        expect(Math.abs(curveLength(r) - L)).toBeLessThan(1e-6);
        expect(isContinuous(r, 1e-6)).toBe(true);
        const p = curvePointAt(c, L / 3);
        const q = curvePointAt(r, L / 3);
        expect(V.distance(V.rotate(V.add(p, V.vec(10, -20)), a, V.vec(3, 4)), q)).toBeLessThan(1e-6);
      }),
    );
  });

  it("sampleCurve inclut extrémités et jonctions, pas ≤ step", () => {
    fc.assert(
      fc.property(curveArb, fc.double({ min: 10, max: 500, noNaN: true }), (c: Curve2, step) => {
        const samples = sampleCurve(c, step);
        const L = curveLength(c);
        expect(samples[0]!.s).toBe(0);
        expect(Math.abs(samples[samples.length - 1]!.s - L)).toBeLessThan(1e-9);
        for (let i = 1; i < samples.length; i++) {
          expect(samples[i]!.s - samples[i - 1]!.s).toBeLessThanOrEqual(step + 1e-9);
        }
      }),
    );
  });

  it("flattenCurve respecte la flèche", () => {
    const arc = arcSeg(V.vec(0, 0), 1000, 0, Math.PI);
    const c = makeCurve([arc]);
    const pts = flattenCurve(c, 0.5);
    for (let i = 1; i < pts.length; i++) {
      const mid = V.lerp(pts[i - 1]!, pts[i]!, 0.5);
      expect(1000 - V.norm(mid)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(V.norm(pts[i]!) - 1000)).toBeLessThan(1e-9);
    }
    expect(segLength(arc)).toBeCloseTo(1000 * Math.PI, 9);
  });
});

describe("relecture adverse — bornes", () => {
  it("sampleCurve : un pas tombant à moins de GEOM_EPS de la fin n'évince pas s = L", () => {
    const c = fromPolyline([V.vec(0, 0), V.vec(1000.0000005, 0)]);
    const s = sampleCurve(c, 1000);
    expect(s[s.length - 1]!.s).toBe(curveLength(c));
    expect(s.map((x) => x.s)).toEqual([0, curveLength(c)]);
  });

  it("sampleCurve : un pas proche d'une jonction est absorbé par la jonction", () => {
    const c = fromPolyline([V.vec(0, 0), V.vec(1000.0000005, 0), V.vec(1000.0000005, 1000)]);
    const s = sampleCurve(c, 1000).map((x) => x.s);
    expect(s).toContain(1000.0000005);
    expect(s).not.toContain(1000);
  });

  it("locate refuse NaN", () => {
    const c = fromPolyline([V.vec(0, 0), V.vec(10, 0)]);
    expect(() => locate(c, Number.NaN)).toThrow(/NaN/);
  });
});
