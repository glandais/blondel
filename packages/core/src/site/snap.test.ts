import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { segClosestPoint } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import type { CurveSeg } from "../model/primitives.js";
import type { DxfUnderlay } from "./schema.js";
import {
  buildSnapIndex,
  segmentIntersections,
  segmentSnapPoints,
  snapPoint,
  snapRightAngle,
} from "./snap.js";
import { underlaySegments } from "./underlay.js";

/** Calque : deux murs en croix, un rectangle (polyligne fermée), un arc et un poteau rond. */
const underlay: DxfUnderlay = {
  name: "test",
  unitScale: 1,
  placement: { origin: { x: 1000, y: 0 }, rotation: 0 },
  entities: [
    { kind: "line", a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
    { kind: "line", a: { x: 1000, y: -1000 }, b: { x: 1000, y: 1000 } },
    {
      kind: "polyline",
      points: [
        { x: 2000, y: 2000 },
        { x: 3000, y: 2000 },
        { x: 3000, y: 2600 },
        { x: 2000, y: 2600 },
      ],
      closed: true,
    },
    { kind: "arc", center: { x: 0, y: 3000 }, radius: 500, start: 0, end: 90 },
    { kind: "circle", center: { x: 5000, y: 5000 }, radius: 50 },
  ],
};
const index = buildSnapIndex(underlaySegments(underlay));

describe("snapPoint — accroches aux entités du calque DXF (repère du site)", () => {
  it("extrémité : sommet de la polyligne, placement appliqué", () => {
    const hit = snapPoint(index, { x: 3010, y: 1990 }, 50);
    expect(hit).toMatchObject({ kind: "endpoint", point: { x: 3000, y: 2000 } });
  });

  it("milieu d'un côté de polyligne et d'un arc", () => {
    expect(snapPoint(index, { x: 3490, y: 2005 }, 30)).toMatchObject({
      kind: "midpoint",
      point: { x: 3500, y: 2000 },
    });
    const mid = snapPoint(index, { x: 1000 + 354, y: 3000 + 354 }, 30);
    expect(mid?.kind).toBe("midpoint");
    expect(mid!.point.x).toBeCloseTo(1000 + 500 * Math.SQRT1_2, 9);
  });

  it("intersection de deux lignes en croix (hors extrémités)", () => {
    const hit = snapPoint(index, { x: 2012, y: -9 }, 40);
    expect(hit?.kind).toBe("intersection");
    expect(hit!.point.x).toBeCloseTo(2000, 9);
    expect(hit!.point.y).toBeCloseTo(0, 9);
  });

  it("centre d'un cercle ; hors rayon : aucune accroche", () => {
    expect(snapPoint(index, { x: 6010, y: 5010 }, 30)).toMatchObject({ kind: "center" });
    expect(snapPoint(index, { x: 9000, y: 9000 }, 30)).toBeNull();
  });

  it("types d'accroche filtrés", () => {
    const hit = snapPoint(index, { x: 2012, y: -9 }, 40, { kinds: ["endpoint"] });
    expect(hit).toBeNull();
  });

  it("points fournis (sommets en cours de saisie) prioritaires à distance égale", () => {
    const withPts = buildSnapIndex(underlaySegments(underlay), [
      { point: { x: 3000, y: 2000 }, kind: "point" },
    ]);
    expect(snapPoint(withPts, { x: 3001, y: 2001 }, 10)?.kind).toBe("point");
  });
});

describe("accroches — propriétés", () => {
  const coord = fc.double({ min: -5000, max: 5000, noNaN: true });
  const pt = fc.record({ x: coord, y: coord });
  const lineArb = fc
    .tuple(pt, pt)
    .filter(([a, b]) => V.distance(a, b) > 10)
    .map(([a, b]): CurveSeg => ({ kind: "line", a, b }));
  const arcArb = fc
    .tuple(
      pt,
      fc.double({ min: 10, max: 3000, noNaN: true }),
      fc.double({ min: -3, max: 3, noNaN: true }),
      fc.double({ min: 0.1, max: 6, noNaN: true }),
      fc.boolean(),
    )
    .map(([center, radius, start, sweep, ccw]): CurveSeg => ({
      kind: "arc",
      center,
      radius,
      startAngle: start,
      sweep: ccw ? sweep : -sweep,
    }));
  const segArb = fc.oneof(lineArb, arcArb);

  it("régression : droite quasi tangente au bout d'un long arc, point hors de l'arc refusé", () => {
    // Contre-exemple fast-check : l'intersection des supports tombe à ≈ 1e-6 mm avant le début
    // de l'arc ; une tolérance de 1e-9 en paramètre (× longueur ≈ 1 000 mm) l'acceptait.
    const arc: CurveSeg = {
      kind: "arc",
      center: { x: 0, y: 9.999999999999936e-7 },
      radius: 569.743017220093,
      startAngle: 0,
      sweep: 1.7551770901969632,
    };
    const line: CurveSeg = {
      kind: "line",
      a: { x: -1.1928534604521703e-8, y: 0 },
      b: { x: 2443.5804517908987, y: 0 },
    };
    for (const p of segmentIntersections(arc, line)) {
      expect(V.distance(segClosestPoint(arc, p).point, p)).toBeLessThan(1e-6);
    }
  });

  it("une intersection rendue est sur les deux segments", () => {
    fc.assert(
      fc.property(segArb, segArb, (a, b) => {
        for (const p of segmentIntersections(a, b)) {
          expect(V.distance(segClosestPoint(a, p).point, p)).toBeLessThan(1e-6);
          expect(V.distance(segClosestPoint(b, p).point, p)).toBeLessThan(1e-6);
        }
      }),
    );
  });

  it("l'accroche rendue est à moins du rayon et est un point caractéristique d'un segment", () => {
    fc.assert(
      fc.property(fc.array(segArb, { minLength: 1, maxLength: 12 }), pt, (segs, p) => {
        const idx = buildSnapIndex(segs);
        const hit = snapPoint(idx, p, 400);
        if (!hit) return;
        expect(hit.distance).toBeLessThanOrEqual(400);
        expect(V.distance(hit.point, p)).toBeCloseTo(hit.distance, 9);
        if (hit.kind === "center") {
          expect(segs.some((s) => s.kind === "arc" && V.distance(s.center, hit.point) === 0)).toBe(
            true,
          );
          return;
        }
        const on = segs.some(
          (s) => V.distance(segClosestPoint(s, hit.point).point, hit.point) < 1e-6,
        );
        expect(on).toBe(true);
        if (hit.kind !== "intersection") {
          const own = segs.some((s) =>
            segmentSnapPoints(s).some(
              (c) => c.kind === hit.kind && V.distance(c.point, hit.point) < 1e-9,
            ),
          );
          expect(own).toBe(true);
        }
      }),
    );
  });

  it("l'index en grille rend la même accroche qu'un examen de tous les segments", () => {
    fc.assert(
      fc.property(fc.array(segArb, { minLength: 1, maxLength: 20 }), pt, (segs, p) => {
        const fine = snapPoint(buildSnapIndex(segs, [], 50), p, 300);
        const coarse = snapPoint(buildSnapIndex(segs, [], 1e9), p, 300);
        expect(fine?.distance ?? null).toBe(coarse?.distance ?? null);
      }),
    );
  });
});

describe("snapRightAngle — équerre depuis l'extrémité fixe (sous-lot 5a)", () => {
  const axes = [{ x: 1, y: 0 }];
  it("ramène sur l'horizontale ou la verticale, rien au-delà du rayon", () => {
    expect(snapRightAngle({ x: 0, y: 0 }, { x: 1000, y: 8 }, axes, 10)).toMatchObject({
      point: { x: 1000, y: 0 },
    });
    const v = snapRightAngle({ x: 0, y: 0 }, { x: -6, y: 1000 }, axes, 10)!;
    expect(v.point.x).toBeCloseTo(0, 9);
    expect(v.point.y).toBeCloseTo(1000, 9);
    expect(snapRightAngle({ x: 0, y: 0 }, { x: 1000, y: 30 }, axes, 10)).toBeNull();
    expect(snapRightAngle({ x: 5, y: 5 }, { x: 5, y: 5 }, axes, 10)).toBeNull();
  });

  it("perpendiculaire à un mur oblique", () => {
    const d = { x: 1, y: 1 };
    const hit = snapRightAngle({ x: 0, y: 0 }, { x: -1000, y: 1010 }, [d], 20)!;
    expect(hit.point.x + hit.point.y).toBeCloseTo(0, 9);
  });

  it("propriété : droite la plus proche parmi les directions et leurs perpendiculaires", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), {
          minLength: 2,
          maxLength: 3,
        }),
        (x, y, angles) => {
          const p = { x, y };
          const dirs = angles.map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
          const hit = snapRightAngle({ x: 0, y: 0 }, p, dirs, 50);
          // Distance de `p` à chaque droite candidate (issue de l'origine).
          const lines = dirs.flatMap((d) => [d, V.perpLeft(d)]);
          const dists = lines.map((d) => Math.abs(V.cross(d, p)));
          const nearest = Math.min(...dists);
          if (!hit) {
            if (V.norm(p) > 0) expect(nearest).toBeGreaterThan(50 - 1e-9);
            return;
          }
          expect(hit.distance).toBeLessThanOrEqual(50 + 1e-9);
          expect(hit.distance).toBeLessThanOrEqual(nearest + 1e-9);
          expect(V.distance(hit.point, p)).toBeCloseTo(hit.distance, 9);
          // Point accroché sur la droite de la direction retenue.
          expect(Math.abs(V.cross(hit.direction, hit.point))).toBeLessThan(
            1e-6 * Math.max(1, V.norm(hit.point)),
          );
        },
      ),
    );
  });
});
