import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Curve2 } from "../model/primitives.js";
import {
  curveEnd,
  curveLength,
  curveStart,
  fromPolyline,
  isContinuous,
  makeCurve,
  sampleCurve,
} from "./curve.js";
import { distanceToCurve } from "./intersect.js";
import { offsetCurve, offsetSegment, type Side } from "./offset.js";
import { arcSeg, lineSeg } from "./segment.js";
import { monotonePolyline } from "./testArbs.js";
import * as V from "./vec.js";

const sideArb = fc.constantFrom<Side>("left", "right");

/** Tous les points échantillonnés de `off` sont à distance d (±tol) de `c`. */
function expectAtDistance(off: Curve2, c: Curve2, d: number, tol = 1e-6): void {
  for (const { p } of sampleCurve(off, 50)) {
    expect(Math.abs(distanceToCurve(p, c) - d)).toBeLessThan(tol);
  }
}

describe("offsetCurve — équerre (cas de la ligne de foulée, B §2.1)", () => {
  const corner = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)]); // tourne à gauche

  it("côté convexe : segments + quart de cercle de rayon d centré sur le sommet", () => {
    const d = 300;
    const off = offsetCurve(corner, d, "right");
    expect(off.segments.map((s) => s.kind)).toEqual(["line", "arc", "line"]);
    const [l1, arc, l2] = off.segments;
    if (l1?.kind !== "line" || arc?.kind !== "arc" || l2?.kind !== "line") throw new Error();
    expect(V.distance(l1.a, V.vec(0, -300))).toBeLessThan(1e-9);
    expect(V.distance(l1.b, V.vec(1000, -300))).toBeLessThan(1e-9);
    expect(V.distance(arc.center, V.vec(1000, 0))).toBeLessThan(1e-9);
    expect(arc.radius).toBe(d);
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(V.distance(l2.a, V.vec(1300, 0))).toBeLessThan(1e-9);
    expect(V.distance(l2.b, V.vec(1300, 1000))).toBeLessThan(1e-9);
    expect(curveLength(off)).toBeCloseTo(2000 + (Math.PI * d) / 2, 9);
    expect(isContinuous(off)).toBe(true);
    expectAtDistance(off, corner, d);
  });

  it("côté concave : segments coupés à l'intersection", () => {
    const off = offsetCurve(corner, 300, "left");
    expect(off.segments).toHaveLength(2);
    expect(V.distance(curveStart(off), V.vec(0, 300))).toBeLessThan(1e-9);
    expect(V.distance(curveEnd(off), V.vec(700, 1000))).toBeLessThan(1e-9);
    expect(curveLength(off)).toBeCloseTo(1400, 9);
    expectAtDistance(off, corner, 300);
  });

  it("d = 0 : identité", () => {
    expect(curveLength(offsetCurve(corner, 0, "left"))).toBeCloseTo(2000, 12);
    expect(() => offsetCurve(corner, -1, "left")).toThrow();
  });

  it("pivot (arc de rayon nul) : devient un arc de rayon d côté convexe", () => {
    const pivot = arcSeg(V.vec(1000, 0), 0, -Math.PI / 2, Math.PI / 2);
    const c = makeCurve([
      lineSeg(V.vec(0, 0), V.vec(1000, 0)),
      pivot,
      lineSeg(V.vec(1000, 0), V.vec(1000, 1000)),
    ]);
    const off = offsetCurve(c, 250, "right");
    expect(off.segments.map((s) => s.kind)).toEqual(["line", "arc", "line"]);
    expect(curveLength(off)).toBeCloseTo(2000 + 125 * Math.PI, 9);
    const inner = offsetCurve(c, 250, "left");
    expect(curveLength(inner)).toBeCloseTo(1500, 9);
  });
});

describe("offsetCurve — arcs", () => {
  it("arc CCW : gauche → R − d, droite → R + d", () => {
    const a = arcSeg(V.vec(0, 0), 1000, 0, Math.PI / 3);
    const l = offsetSegment(a, 200, "left");
    const r = offsetSegment(a, 200, "right");
    expect(l?.kind === "arc" && l.radius).toBe(800);
    expect(r?.kind === "arc" && r.radius).toBe(1200);
    const cw = arcSeg(V.vec(0, 0), 1000, 0, -Math.PI / 3);
    const lcw = offsetSegment(cw, 200, "left");
    expect(lcw?.kind === "arc" && lcw.radius).toBe(1200);
  });

  it("rayon qui s'annule : l'arc disparaît, raccord concave des voisins", () => {
    const filleted = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)], {
      radius: 100,
    });
    const sharp = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)]);
    const a = offsetCurve(filleted, 300, "left");
    const b = offsetCurve(sharp, 300, "left");
    expect(a.segments).toHaveLength(2);
    expect(curveLength(a)).toBeCloseTo(curveLength(b), 9);
    expect(V.distance(curveEnd(a), curveEnd(b))).toBeLessThan(1e-9);
    // Rayon exactement égal à d : pivot retiré, pas de raccord nécessaire.
    const c = offsetCurve(filleted, 100, "left");
    expect(c.segments).toHaveLength(2);
    expect(curveLength(c)).toBeCloseTo(1800, 9);
  });

  it("sommet anguleux arc → droite : coupe arc/droite (concave), arc de raccord (convexe)", () => {
    const c = makeCurve([
      arcSeg(V.vec(0, 0), 1000, -Math.PI / 2, Math.PI / 2),
      lineSeg(V.vec(1000, 0), V.vec(0, 1000)),
    ]);
    for (const side of ["left", "right"] as const) {
      const off = offsetCurve(c, 200, side);
      expect(isContinuous(off, 1e-6)).toBe(true);
      expectAtDistance(off, c, 200);
    }
    expect(offsetCurve(c, 200, "left").segments.map((s) => s.kind)).toEqual(["arc", "line"]);
    expect(offsetCurve(c, 200, "right").segments.map((s) => s.kind)).toEqual([
      "arc",
      "arc",
      "line",
    ]);
  });

  it("segment court consommé par deux coupes concaves", () => {
    // Deux virages à gauche de 45° : le segment central (141 mm) disparaît pour d = 300.
    const c = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1100, 100), V.vec(1100, 1100)]);
    const off = offsetCurve(c, 300, "left");
    expect(off.segments).toHaveLength(2);
    const l1 = off.segments[0]!;
    expect(l1.kind === "line" && V.distance(l1.b, V.vec(800, 300))).toBeLessThan(1e-9);
    expect(isContinuous(off, 1e-6)).toBe(true);
    expectAtDistance(off, c, 300);
  });

  it("arc isolé qui dégénère : erreur explicite", () => {
    const c = makeCurve([arcSeg(V.vec(0, 0), 100, 0, 1)]);
    expect(() => offsetCurve(c, 200, "left")).toThrow();
  });

  it("jour courbe de rayon r_j : ligne de foulée = arc de rayon r_j + d_f", () => {
    const rj = 200;
    const jour = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)], { radius: rj });
    const walk = offsetCurve(jour, 450, "right");
    const arc = walk.segments.find((s) => s.kind === "arc");
    expect(arc?.kind === "arc" && arc.radius).toBeCloseTo(rj + 450, 9);
    expect(walk.segments).toHaveLength(3);
  });
});

describe("offsetCurve — propriétés", () => {
  it("polyligne à angles vifs : tous les points du décalé sont à distance d", () => {
    fc.assert(
      fc.property(
        monotonePolyline(),
        fc.double({ min: 1, max: 150, noNaN: true }),
        sideArb,
        (pts, d, side) => {
          const c = fromPolyline(pts);
          const off = offsetCurve(c, d, side);
          expect(isContinuous(off, 1e-6)).toBe(true);
          expectAtDistance(off, c, d);
        },
      ),
    );
  });

  it("polyligne à angles vifs : longueur = L + Σ convexes d|φ| − Σ concaves 2d tan(|φ|/2)", () => {
    fc.assert(
      fc.property(
        monotonePolyline(),
        fc.double({ min: 1, max: 150, noNaN: true }),
        sideArb,
        (pts, d, side) => {
          const c = fromPolyline(pts);
          const sg = side === "left" ? 1 : -1;
          let expected = curveLength(c);
          for (let i = 1; i + 1 < pts.length; i++) {
            const phi = V.signedAngle(V.sub(pts[i]!, pts[i - 1]!), V.sub(pts[i + 1]!, pts[i]!));
            if (Math.abs(phi) * d <= 1e-6) continue;
            expected += sg * phi < 0 ? d * Math.abs(phi) : -2 * d * Math.tan(Math.abs(phi) / 2);
          }
          expect(Math.abs(curveLength(offsetCurve(c, d, side)) - expected)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("courbe G1 (raccords de rayon ≥ d) : décalé à distance d, longueur L ∓ d·Σφ", () => {
    fc.assert(
      fc.property(
        monotonePolyline(),
        fc.double({ min: 1, max: 150, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        sideArb,
        (pts, d, extra, side) => {
          const r = d + extra;
          const c = fromPolyline(pts, { radius: r });
          const off = offsetCurve(c, d, side);
          expect(isContinuous(off, 1e-6)).toBe(true);
          expectAtDistance(off, c, d);
          // Longueur : chaque arc de balayage φ passe de rφ à (r − σ d sgn φ)|φ|.
          const sg = side === "left" ? 1 : -1;
          let totalTurn = 0;
          for (const s of c.segments) if (s.kind === "arc") totalTurn += s.sweep;
          expect(Math.abs(curveLength(off) - (curveLength(c) - sg * d * totalTurn))).toBeLessThan(
            1e-6,
          );
        },
      ),
    );
  });

  it("aller-retour : décaler à gauche puis à droite rend la courbe G1", () => {
    fc.assert(
      fc.property(monotonePolyline(), fc.double({ min: 1, max: 100, noNaN: true }), (pts, d) => {
        const c = fromPolyline(pts, { radius: 150 + d });
        const back = offsetCurve(offsetCurve(c, d, "left"), d, "right");
        expect(Math.abs(curveLength(back) - curveLength(c))).toBeLessThan(1e-6);
        expect(V.distance(curveStart(back), curveStart(c))).toBeLessThan(1e-6);
        expect(V.distance(curveEnd(back), curveEnd(c))).toBeLessThan(1e-6);
      }),
    );
  });
});

describe("offsetCurve — relecture adverse", () => {
  it("raccords de rayons quelconques (y compris r < d côté concave) : continu, jamais à moins de d", () => {
    fc.assert(
      fc.property(
        monotonePolyline().chain((pts) =>
          fc.tuple(
            fc.constant(pts),
            fc.array(fc.oneof(fc.constant(0), fc.double({ min: 1, max: 200, noNaN: true })), {
              minLength: Math.max(0, pts.length - 2),
              maxLength: Math.max(0, pts.length - 2),
            }),
          ),
        ),
        fc.double({ min: 1, max: 150, noNaN: true }),
        sideArb,
        ([pts, radii], d, side) => {
          const c = fromPolyline(pts, { radius: radii });
          const off = offsetCurve(c, d, side);
          expect(isContinuous(off, 1e-6)).toBe(true);
          for (const { p } of sampleCurve(off, 50)) {
            expect(distanceToCurve(p, c)).toBeGreaterThan(d - 1e-6);
          }
          // Extrémités : décalées selon la normale (segments extrêmes ≥ 1 200 mm, jamais consommés).
          expect(Math.abs(distanceToCurve(curveStart(off), c) - d)).toBeLessThan(1e-6);
          expect(Math.abs(distanceToCurve(curveEnd(off), c) - d)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("arc retiré de balayage ≥ 180° (côté concave, R < d) : erreur explicite au lieu d'un faux raccord convexe", () => {
    // Ligne vers +x, arc CCW de rayon 50 sur 270°, puis ligne vers −y.
    const c = makeCurve([
      lineSeg(V.vec(-1000, 0), V.vec(0, 0)),
      arcSeg(V.vec(0, 50), 50, -Math.PI / 2, 1.5 * Math.PI),
      lineSeg(V.vec(-50, 50), V.vec(-50, -1000)),
    ]);
    expect(() => offsetCurve(c, 100, "left")).toThrow(/180°/);
    // Côté convexe, l'arc devient de rayon 150 : aucun problème.
    const off = offsetCurve(c, 100, "right");
    expect(isContinuous(off)).toBe(true);
    expect(off.segments.some((s) => s.kind === "arc" && Math.abs(s.radius - 150) < 1e-9)).toBe(
      true,
    );
  });

  it("arc retiré de balayage < 180° : raccord concave (pas d'arc parasite)", () => {
    // Quart tournant de rayon 50 < d = 100 du côté concave : les deux droites sont coupées.
    const c = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)], { radius: 50 });
    const off = offsetCurve(c, 100, "left");
    expect(off.segments.every((s) => s.kind === "line")).toBe(true);
    expect(V.distance(curveEnd({ segments: [off.segments[0]!] }), V.vec(900, 100))).toBeLessThan(
      1e-9,
    );
  });

  it("raccord concave droite → arc sans intersection (d < R < 2d) : erreur explicite", () => {
    const c = makeCurve([
      lineSeg(V.vec(-1000, 0), V.vec(0, 0)),
      arcSeg(V.vec(-150, 0), 150, 0, Math.PI / 2),
    ]);
    expect(() => offsetCurve(c, 100, "left")).toThrow(/sans intersection/);
  });
});
