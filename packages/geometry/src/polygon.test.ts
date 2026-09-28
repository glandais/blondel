import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cleanRing, polygonArea, prepareShape, ringArea, shapeArea } from "./polygon.js";
import { GeometryError } from "./errors.js";
import { rect, shapeWithHoles } from "./testing.js";

describe("cleanRing", () => {
  it("retire le point de fermeture, les doublons et les points alignés", () => {
    const r = cleanRing([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
    expect(r && Array.from(r)).toEqual([10, 0, 10, 10, 0, 10, 0, 0]);
  });
  it("retourne null pour un polygone dégénéré", () => {
    expect(cleanRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toBeNull();
    expect(cleanRing([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe("prepareShape", () => {
  it("oriente le contour CCW et les trous CW quel que soit le sens fourni", () => {
    const s = prepareShape({ outer: [...rect(0, 0, 100, 100)].reverse(), holes: [rect(0, 0, 10, 10)] });
    expect(ringArea(s.rings[0]!)).toBeGreaterThan(0);
    expect(ringArea(s.rings[1]!)).toBeLessThan(0);
    expect(s.area).toBeCloseTo(10000 - 100, 9);
  });
  it("rejette un profil auto-intersectant (nœud papillon)", () => {
    expect(() =>
      prepareShape({ outer: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }], holes: [] }),
    ).toThrow(GeometryError);
  });
  it("propriété : triangles CCW dont l'aire totale égale l'aire du profil", () => {
    fc.assert(
      fc.property(shapeWithHoles, (shape) => {
        const s = prepareShape(shape);
        let a = 0;
        const c = s.coords;
        for (let t = 0; t < s.triangles.length; t += 3) {
          const [i, j, k] = [s.triangles[t]!, s.triangles[t + 1]!, s.triangles[t + 2]!];
          const area = ((c[2 * j]! - c[2 * i]!) * (c[2 * k + 1]! - c[2 * i + 1]!) - (c[2 * k]! - c[2 * i]!) * (c[2 * j + 1]! - c[2 * i + 1]!)) / 2;
          expect(area).toBeGreaterThanOrEqual(0);
          a += area;
        }
        expect(Math.abs(a - shapeArea(shape))).toBeLessThan(1e-6 * a);
        expect(Math.abs(s.area - Math.abs(polygonArea(shape.outer)) + shape.holes.reduce((x, h) => x + Math.abs(polygonArea(h)), 0))).toBeLessThan(1e-6);
      }),
    );
  });
});
