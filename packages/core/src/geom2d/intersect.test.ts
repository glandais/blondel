import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  curveLength,
  curveNormalAt,
  curvePointAt,
  curveTangentAt,
  fromPolyline,
  makeCurve,
} from "./curve.js";
import {
  distanceToCurve,
  intersectCircles,
  intersectLineCircle,
  intersectLineCurve,
  intersectLines,
  intersectSupports,
  projectOnCurve,
  segmentIntersect,
} from "./intersect.js";
import { arcSeg, lineSeg } from "./segment.js";
import { monotonePolyline } from "./testArbs.js";
import * as V from "./vec.js";
import type { Vec2 } from "../model/primitives.js";

const coord = fc.double({ min: -1000, max: 1000, noNaN: true });
const pt = fc.record({ x: coord, y: coord });
const curveArb = fc
  .tuple(monotonePolyline(), fc.oneof(fc.constant(0), fc.double({ min: 1, max: 200, noNaN: true })))
  .map(([pts, r]) => fromPolyline(pts, { radius: r }));

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = V.sub(b, a);
  const t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / V.normSq(ab)));
  return V.distance(p, V.addScaled(a, ab, t));
}

describe("droites et segments", () => {
  it("intersectLines", () => {
    const h = intersectLines(
      { origin: V.vec(0, 0), dir: V.vec(1, 0) },
      { origin: V.vec(5, -5), dir: V.vec(0, 2) },
    );
    expect(h).toEqual({ t1: 5, t2: 2.5, point: { x: 5, y: 0 } });
    expect(
      intersectLines(
        { origin: V.vec(0, 0), dir: V.vec(1, 1) },
        { origin: V.vec(0, 1), dir: V.vec(2, 2) },
      ),
    ).toBeNull();
  });

  it("segmentIntersect : X, T, disjoints, parallèles", () => {
    const x = segmentIntersect(V.vec(0, 0), V.vec(10, 10), V.vec(0, 10), V.vec(10, 0));
    expect(x?.point.x).toBeCloseTo(5, 12);
    expect(x?.t).toBeCloseTo(0.5, 12);
    const t = segmentIntersect(V.vec(0, 0), V.vec(10, 0), V.vec(10, -5), V.vec(10, 5));
    expect(t?.t).toBe(1);
    expect(segmentIntersect(V.vec(0, 0), V.vec(1, 0), V.vec(2, -1), V.vec(2, 1))).toBeNull();
    expect(segmentIntersect(V.vec(0, 0), V.vec(1, 0), V.vec(0, 1), V.vec(1, 1))).toBeNull();
  });

  it("segmentIntersect : le point trouvé est sur les deux segments", () => {
    fc.assert(
      fc.property(pt, pt, pt, pt, (a1, a2, b1, b2) => {
        fc.pre(V.distance(a1, a2) > 1 && V.distance(b1, b2) > 1);
        const h = segmentIntersect(a1, a2, b1, b2);
        if (h) {
          expect(distToSegment(h.point, a1, a2)).toBeLessThan(1e-6);
          expect(distToSegment(h.point, b1, b2)).toBeLessThan(1e-6);
          expect(V.distance(V.lerp(a1, a2, h.t), h.point)).toBeLessThan(1e-6);
        }
      }),
    );
  });

  it("segmentIntersect : deux segments se croisant en un point connu", () => {
    const frac = fc.double({ min: 0.05, max: 0.95, noNaN: true });
    const len = fc.double({ min: 1, max: 2000, noNaN: true });
    fc.assert(
      fc.property(
        pt,
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0.05, max: Math.PI - 0.05, noNaN: true }),
        len,
        len,
        frac,
        frac,
        (c, a0, da, la, lb, ta, tb) => {
          const u = V.scale(V.fromAngle(a0), la);
          const w = V.scale(V.fromAngle(a0 + da), lb);
          const h = segmentIntersect(
            V.addScaled(c, u, -ta),
            V.addScaled(c, u, 1 - ta),
            V.addScaled(c, w, -tb),
            V.addScaled(c, w, 1 - tb),
          );
          expect(h).not.toBeNull();
          expect(V.distance(h!.point, c)).toBeLessThan(1e-6);
          expect(h!.t).toBeCloseTo(ta, 6);
        },
      ),
    );
  });
});

describe("cercles", () => {
  it("droite ∩ cercle", () => {
    expect(
      intersectLineCircle({ origin: V.vec(-10, 0), dir: V.vec(1, 0) }, V.vec(0, 0), 5),
    ).toEqual([5, 15]);
    expect(
      intersectLineCircle({ origin: V.vec(-10, 5), dir: V.vec(1, 0) }, V.vec(0, 0), 5),
    ).toEqual([10]);
    expect(
      intersectLineCircle({ origin: V.vec(-10, 6), dir: V.vec(1, 0) }, V.vec(0, 0), 5),
    ).toEqual([]);
  });

  it("cercle ∩ cercle", () => {
    const pts = intersectCircles(V.vec(0, 0), 5, V.vec(8, 0), 5);
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      expect(V.norm(p)).toBeCloseTo(5, 9);
      expect(V.distance(p, V.vec(8, 0))).toBeCloseTo(5, 9);
    }
    expect(intersectCircles(V.vec(0, 0), 5, V.vec(10, 0), 5)).toHaveLength(1);
    expect(intersectCircles(V.vec(0, 0), 5, V.vec(20, 0), 5)).toHaveLength(0);
    expect(intersectCircles(V.vec(0, 0), 5, V.vec(0, 0), 5)).toHaveLength(0);
  });

  it("supports : fractions hors [0, 1] sur le prolongement", () => {
    const a = lineSeg(V.vec(0, 0), V.vec(10, 0));
    const b = arcSeg(V.vec(20, 0), 5, Math.PI / 2, Math.PI / 4);
    const hits = intersectSupports(a, b);
    expect(hits).toHaveLength(2);
    const near = hits.find((h) => h.point.x < 20)!;
    expect(near.ta).toBeCloseTo(1.5, 12);
    expect(near.tb).toBeCloseTo(2, 12); // θ = π, balayage π/4 depuis π/2
  });
});

describe("droite ∩ courbe", () => {
  it("équerre avec raccord : intersections triées, doublons fusionnés", () => {
    const c = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)], { radius: 200 });
    // Diagonale passant par le sommet : coupe l'arc en son milieu.
    const hits = intersectLineCurve({ origin: V.vec(0, 1000), dir: V.vec(1, -1) }, c);
    expect(hits).toHaveLength(1);
    const mid = V.vec(800 + 200 * Math.SQRT1_2, 200 - 200 * Math.SQRT1_2);
    expect(V.distance(hits[0]!.point, mid)).toBeLessThan(1e-9);
    expect(hits[0]!.s).toBeCloseTo(800 + 50 * Math.PI, 9);
    // Horizontale y = 500 : un seul point sur la seconde branche.
    const h2 = intersectLineCurve({ origin: V.vec(0, 500), dir: V.vec(1, 0) }, c);
    expect(h2.map((h) => h.point)).toEqual([{ x: 1000, y: 500 }]);
    // Passage par une jonction ligne/ligne : un seul résultat.
    const sharp = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)]);
    expect(intersectLineCurve({ origin: V.vec(0, 1000), dir: V.vec(1, -1) }, sharp)).toHaveLength(
      1,
    );
  });

  it("une droite passant par pointAt(s) le retrouve ; chaque hit est sur la droite et la courbe", () => {
    fc.assert(
      fc.property(
        curveArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.3, max: Math.PI - 0.3, noNaN: true }),
        (c, u, a) => {
          const L = curveLength(c);
          const s = u * L;
          const p = curvePointAt(c, s);
          const dir = V.rotate(curveTangentAt(c, s), a); // non tangente
          const hits = intersectLineCurve({ origin: p, dir }, c);
          expect(hits.some((h) => Math.abs(h.s - s) < 1e-6)).toBe(true);
          for (let i = 0; i < hits.length; i++) {
            const h = hits[i]!;
            expect(V.distance(curvePointAt(c, h.s), h.point)).toBeLessThan(1e-6);
            expect(V.distance(V.addScaled(p, dir, h.t), h.point)).toBeLessThan(1e-6);
            if (i > 0) expect(h.s).toBeGreaterThan(hits[i - 1]!.s);
          }
        },
      ),
    );
  });
});

describe("projection", () => {
  it("pointAt(s) se projette sur lui-même", () => {
    fc.assert(
      fc.property(curveArb, fc.double({ min: 0, max: 1, noNaN: true }), (c, u) => {
        const s = u * curveLength(c);
        const pr = projectOnCurve(curvePointAt(c, s), c);
        expect(pr.distance).toBeLessThan(1e-6);
        expect(Math.abs(pr.s - s)).toBeLessThan(1e-6);
      }),
    );
  });

  it("point décalé de δ selon la normale : distance ≤ |δ|, = |δ| sur un raccord G1 de rayon > δ", () => {
    fc.assert(
      fc.property(
        monotonePolyline(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (pts, u, delta) => {
          const c = fromPolyline(pts, { radius: 150 });
          const s = u * curveLength(c);
          const q = V.addScaled(curvePointAt(c, s), curveNormalAt(c, s), delta);
          expect(Math.abs(distanceToCurve(q, c) - Math.abs(delta))).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("projection sur un arc et ses extrémités", () => {
    const c = makeCurve([arcSeg(V.vec(0, 0), 100, 0, Math.PI / 2)]);
    const p1 = projectOnCurve(V.vec(200, 200), c);
    expect(p1.distance).toBeCloseTo(200 * Math.SQRT2 - 100, 9);
    expect(p1.s).toBeCloseTo(25 * Math.PI, 9);
    const p2 = projectOnCurve(V.vec(100, -50), c);
    expect(p2.s).toBe(0);
    expect(p2.distance).toBeCloseTo(50, 12);
  });
});
