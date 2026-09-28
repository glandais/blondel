import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import { curveLength, fromPolyline } from "./curve.js";
import { offsetCurve } from "./offset.js";
import {
  bandPolygon,
  bbox,
  cutBand,
  ensureCCW,
  isConvex,
  offsetConvexPolygon,
  orientation,
  perimeter,
  pointInPolygon,
  shapeArea,
  signedArea,
} from "./polygon.js";
import * as V from "./vec.js";

const square: Polygon2 = [V.vec(0, 0), V.vec(10, 0), V.vec(10, 10), V.vec(0, 10)];
const lShape: Polygon2 = [
  V.vec(0, 0),
  V.vec(20, 0),
  V.vec(20, 10),
  V.vec(10, 10),
  V.vec(10, 20),
  V.vec(0, 20),
];

/** Polygone régulier à n côtés, d'apothème a, centré en c, tourné de rot. */
function regular(n: number, a: number, c: Vec2, rot: number): Vec2[] {
  const R = a / Math.cos(Math.PI / n);
  return Array.from({ length: n }, (_, k) =>
    V.add(c, V.scale(V.fromAngle(rot + (2 * Math.PI * k) / n), R)),
  );
}

const regularArb = fc.record({
  n: fc.integer({ min: 3, max: 12 }),
  a: fc.double({ min: 50, max: 2000, noNaN: true }),
  c: fc.record({
    x: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
    y: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
  }),
  rot: fc.double({ min: -4, max: 4, noNaN: true }),
});

describe("aire, orientation, périmètre", () => {
  it("carré et L", () => {
    expect(signedArea(square)).toBe(100);
    expect(signedArea([...square].reverse())).toBe(-100);
    expect(orientation(square)).toBe("ccw");
    expect(orientation([...square].reverse())).toBe("cw");
    expect(orientation([V.vec(0, 0), V.vec(1, 1), V.vec(2, 2)])).toBe("degenerate");
    expect(ensureCCW([...square].reverse())).toEqual([...square].reverse().reverse());
    expect(signedArea(lShape)).toBe(300);
    expect(perimeter(square)).toBe(40);
    expect(
      shapeArea({ outer: square, holes: [[V.vec(2, 2), V.vec(2, 4), V.vec(4, 4), V.vec(4, 2)]] }),
    ).toBe(96);
    expect(isConvex(square)).toBe(true);
    expect(isConvex(lShape)).toBe(false);
  });

  it("polygone régulier : aire = n a² tan(π/n), invariante par déplacement", () => {
    fc.assert(
      fc.property(regularArb, ({ n, a, c, rot }) => {
        const p = regular(n, a, c, rot);
        const expected = n * a * a * Math.tan(Math.PI / n);
        expect(Math.abs(signedArea(p) - expected) / expected).toBeLessThan(1e-9);
        expect(orientation(p)).toBe("ccw");
      }),
    );
  });
});

describe("point dans polygone, bbox", () => {
  it("cas simples", () => {
    expect(pointInPolygon(V.vec(5, 5), square)).toBe("inside");
    expect(pointInPolygon(V.vec(15, 5), square)).toBe("outside");
    expect(pointInPolygon(V.vec(10, 5), square)).toBe("boundary");
    expect(pointInPolygon(V.vec(0, 0), square)).toBe("boundary");
    expect(pointInPolygon(V.vec(15, 15), lShape)).toBe("outside");
    expect(pointInPolygon(V.vec(5, 15), lShape)).toBe("inside");
    expect(pointInPolygon(V.vec(5, 15), [...lShape].reverse())).toBe("inside");
    // Rayon horizontal passant par un sommet.
    expect(pointInPolygon(V.vec(-5, 10), lShape)).toBe("outside");
    expect(pointInPolygon(V.vec(5, 10), lShape)).toBe("inside");
  });

  it("le centre d'un polygone régulier est intérieur, un point hors bbox est extérieur", () => {
    fc.assert(
      fc.property(regularArb, ({ n, a, c, rot }) => {
        const p = regular(n, a, c, rot);
        expect(pointInPolygon(c, p)).toBe("inside");
        const b = bbox(p);
        expect(pointInPolygon(V.add(b.max, V.vec(1, 0)), p)).toBe("outside");
        for (const q of p) {
          expect(q.x).toBeGreaterThanOrEqual(b.min.x);
          expect(q.y).toBeLessThanOrEqual(b.max.y);
        }
      }),
    );
  });

  it("bbox", () => {
    expect(bbox(lShape)).toEqual({ min: { x: 0, y: 0 }, max: { x: 20, y: 20 } });
    expect(() => bbox([])).toThrow();
  });
});

describe("offsetConvexPolygon", () => {
  it("carré : (a + 2d)²", () => {
    expect(signedArea(offsetConvexPolygon(square, 5))).toBeCloseTo(400, 9);
    expect(signedArea(offsetConvexPolygon([...square].reverse(), -2))).toBeCloseTo(36, 9);
    expect(() => offsetConvexPolygon(square, -6)).toThrow();
    expect(() => offsetConvexPolygon(lShape, 1)).toThrow();
  });

  it("polygone régulier : décalé = polygone régulier d'apothème a + d", () => {
    fc.assert(
      fc.property(
        regularArb,
        fc.double({ min: -0.9, max: 3, noNaN: true }),
        ({ n, a, c, rot }, k) => {
          const d = k * a;
          const off = offsetConvexPolygon(regular(n, a, c, rot), d);
          const expected = n * (a + d) * (a + d) * Math.tan(Math.PI / n);
          expect(Math.abs(signedArea(off) - expected) / expected).toBeLessThan(1e-8);
        },
      ),
    );
  });
});

describe("bandes entre deux courbes", () => {
  it("bande droite coupée par deux perpendiculaires : rectangle", () => {
    const a = fromPolyline([V.vec(0, 0), V.vec(3000, 0)]);
    const b = fromPolyline([V.vec(0, 900), V.vec(3000, 900)]);
    const cut = cutBand(
      a,
      b,
      { origin: V.vec(1000, 450), dir: V.vec(0, 1) },
      { origin: V.vec(1250, 450), dir: V.vec(0, 1) },
    );
    expect(cut).not.toBeNull();
    expect(signedArea(cut!.polygon)).toBeCloseTo(250 * 900, 6);
    expect(cut!.sA).toEqual([1000, 1250]);
    expect(curveLength(cut!.curveB)).toBeCloseTo(250, 9);
    expect(
      cutBand(
        a,
        b,
        { origin: V.vec(5000, 0), dir: V.vec(0, 1) },
        { origin: V.vec(0, 0), dir: V.vec(0, 1) },
      ),
    ).toBeNull();
  });

  it("quart tournant : aire de la bande jour ↔ mur = 2 L E + π E²/4", () => {
    const E = 900;
    const jour = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)]);
    const mur = offsetCurve(jour, E, "right");
    const band = bandPolygon(jour, mur, 0.01);
    const expected = 2 * 1000 * E + (Math.PI * E * E) / 4;
    expect(Math.abs(signedArea(band) - expected) / expected).toBeLessThan(1e-5);
    expect(orientation(band)).toBe("ccw");
  });

  it("marche balancée : coupe par deux lignes rayonnant du coin du jour", () => {
    const jour = fromPolyline([V.vec(0, 0), V.vec(1000, 0), V.vec(1000, 1000)]);
    const mur = offsetCurve(jour, 900, "right");
    const corner = V.vec(1000, 0);
    // Deux rayons à −60° et −30° depuis le coin : secteur du quart de disque de rayon 900.
    const l0 = { origin: corner, dir: V.fromAngle(-Math.PI / 3) };
    const l1 = { origin: corner, dir: V.fromAngle(-Math.PI / 6) };
    const cut = cutBand(jour, mur, l0, l1, 0.01);
    expect(cut).not.toBeNull();
    const expected = (900 * 900 * (Math.PI / 6)) / 2;
    expect(Math.abs(Math.abs(signedArea(cut!.polygon)) - expected) / expected).toBeLessThan(1e-4);
    expect(curveLength(cut!.curveA)).toBeCloseTo(0, 9); // collet nul au coin vif
    expect(curveLength(cut!.curveB)).toBeCloseTo(900 * (Math.PI / 6), 9);
  });
});

describe("isConvex — relecture adverse", () => {
  const star = [0, 2, 4, 1, 3].map((k) => V.scale(V.fromAngle((2 * Math.PI * k) / 5), 1000));

  it("un pentagramme (virages de même signe, deux tours) n'est pas convexe", () => {
    expect(isConvex(star)).toBe(false);
    expect(() => offsetConvexPolygon(star, 10)).toThrow();
  });

  it("sommets alignés et points doublés tolérés", () => {
    expect(
      isConvex([
        V.vec(0, 0),
        V.vec(5, 0),
        V.vec(10, 0),
        V.vec(10, 10),
        V.vec(10, 10),
        V.vec(0, 10),
      ]),
    ).toBe(true);
  });

  it("polygone régulier CW ou CCW : convexe", () => {
    fc.assert(
      fc.property(regularArb, ({ n, a, c, rot }) => {
        const p = regular(n, a, c, rot);
        expect(isConvex(p)).toBe(true);
        expect(isConvex([...p].reverse())).toBe(true);
      }),
    );
  });
});
