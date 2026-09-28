import { arcSeg, curveLength, fromPolyline, makeCurve, lineSeg, vec2 } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arcFromBulge, bandContour, curvePath, polygonPath } from "./path.js";

describe("chemins à renflements", () => {
  it("arcFromBulge retrouve l'arc (propriété)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0.05, max: 1.95 * Math.PI, noNaN: true }),
        fc.boolean(),
        (cx, cy, r, a0, sw, ccw) => {
          const sweep = ccw ? sw : -sw;
          const a = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
          const b = { x: cx + r * Math.cos(a0 + sweep), y: cy + r * Math.sin(a0 + sweep) };
          const arc = arcFromBulge(a, b, Math.tan(sweep / 4));
          expect(arc.radius).toBeCloseTo(r, 6);
          expect(vec2.distance(arc.center, { x: cx, y: cy })).toBeLessThan(1e-6 * Math.max(1, r));
          expect(arc.sweep).toBeCloseTo(sweep, 9);
        },
      ),
    );
  });

  it("contour d'un quart tournant : fermé, arc conservé", () => {
    const inner = makeCurve([
      lineSeg({ x: 0, y: 0 }, { x: 0, y: 1000 }),
      arcSeg({ x: -200, y: 1000 }, 200, 0, Math.PI / 2),
      lineSeg({ x: -200, y: 1200 }, { x: -1000, y: 1200 }),
    ]);
    const outer = fromPolyline([
      { x: 900, y: 0 },
      { x: 900, y: 2100 },
      { x: -1000, y: 2100 },
    ]);
    const c = bandContour(inner, outer);
    expect(c.closed).toBe(true);
    expect(c.vertices.filter((v) => v.bulge !== 0)).toHaveLength(1);
    expect(c.vertices[1]!.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    // Sommets : 4 du jour (dont 2 extrémités d'arc) + 3 du mur.
    expect(c.vertices).toHaveLength(7);
    expect(curveLength(inner)).toBeGreaterThan(0);
  });

  it("un arc de plus de 180° est découpé", () => {
    const p = curvePath({ segments: [arcSeg({ x: 0, y: 0 }, 100, 0, 1.5 * Math.PI)] });
    expect(p.vertices).toHaveLength(3);
    for (const v of p.vertices.slice(0, -1)) expect(Math.abs(v.bulge)).toBeLessThanOrEqual(1);
  });

  it("polygonPath retire le sommet de fermeture répété", () => {
    const p = polygonPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ]);
    expect(p.vertices).toHaveLength(3);
  });
});
