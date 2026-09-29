import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clipPath, clipRing, clipSegment, flattenPath, type Rect } from "./clip.js";

const inRect = (p: { x: number; y: number }, r: Rect, eps = 1e-9): boolean =>
  p.x >= r.x - eps && p.x <= r.x + r.w + eps && p.y >= r.y - eps && p.y <= r.y + r.h + eps;

const area = (pts: readonly { x: number; y: number }[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};

const rectArb = fc.record({
  x: fc.double({ min: -500, max: 500, noNaN: true }),
  y: fc.double({ min: -500, max: 500, noNaN: true }),
  w: fc.double({ min: 1, max: 800, noNaN: true }),
  h: fc.double({ min: 1, max: 800, noNaN: true }),
});
const ptArb = fc.record({
  x: fc.double({ min: -1000, max: 1000, noNaN: true }),
  y: fc.double({ min: -1000, max: 1000, noNaN: true }),
});

describe("découpage par un rectangle", () => {
  it("propriété : anneau découpé dans le rectangle ; rectangle ∩ rectangle = aire exacte", () => {
    fc.assert(
      fc.property(rectArb, rectArb, (a, r) => {
        const ring = [
          { x: a.x, y: a.y },
          { x: a.x + a.w, y: a.y },
          { x: a.x + a.w, y: a.y + a.h },
          { x: a.x, y: a.y + a.h },
        ];
        const out = clipRing(ring, r);
        for (const p of out) expect(inRect(p, r)).toBe(true);
        const iw = Math.max(0, Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x));
        const ih = Math.max(0, Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y));
        expect(out.length === 0 ? 0 : area(out)).toBeCloseTo(iw * ih, 6);
      }),
    );
  });

  it("propriété : segment découpé dans le rectangle et sur le segment d'origine", () => {
    fc.assert(
      fc.property(ptArb, ptArb, rectArb, (a, b, r) => {
        const s = clipSegment(a, b, r);
        if (!s) {
          // Aucun point échantillonné du segment n'est strictement dans le rectangle.
          for (let i = 0; i <= 50; i++) {
            const t = i / 50;
            const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            expect(
              inRect(p, { x: r.x + 1e-6, y: r.y + 1e-6, w: r.w - 2e-6, h: r.h - 2e-6 }, 0),
            ).toBe(false);
          }
          return;
        }
        for (const p of s) {
          expect(inRect(p, r, 1e-6)).toBe(true);
          const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
          expect(Math.abs(cross)).toBeLessThan(1e-6 * (1 + Math.hypot(b.x - a.x, b.y - a.y) ** 2));
        }
      }),
    );
  });

  it("tracé rempli et épais : remplissage découpé sans trait, trait sans les bords de découpe", () => {
    const ops = [
      { op: "M" as const, x: 0, y: 0 },
      { op: "L" as const, x: 100, y: 0 },
      { op: "L" as const, x: 100, y: 100 },
      { op: "L" as const, x: 0, y: 100 },
      { op: "Z" as const },
    ];
    const out = clipPath(
      ops,
      { fill: [1, 2, 3], stroke: [0, 0, 0], lineWidth: 0.5 },
      { x: 50, y: -10, w: 100, h: 60 },
    );
    expect(out).toHaveLength(2);
    const [fill, stroke] = out;
    expect(fill!.style.stroke).toBeUndefined();
    expect(stroke!.style.fill).toBeUndefined();
    // Trait : bord droit x = 100 de y = 0 à 50, et bord bas y = 0 de x = 50 à 100.
    const pts = stroke!.ops.filter((o) => o.op !== "Z") as { x: number; y: number }[];
    for (const p of pts) expect(p.x === 100 || p.y === 0).toBe(true);
    expect(clipPath(ops, { stroke: [0, 0, 0] }, { x: 200, y: 200, w: 10, h: 10 })).toEqual([]);
  });

  it("Bézier aplaties : extrémités conservées, points sur la courbe", () => {
    const subs = flattenPath([
      { op: "M", x: 0, y: 0 },
      { op: "C", x1: 0, y1: 55.2284749831, x2: 44.7715250169, y2: 100, x: 100, y: 100 },
    ]);
    const pts = subs[0]!.pts;
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 100 });
    // Quart de cercle de rayon 100 centré en (100, 0).
    for (const p of pts) expect(Math.abs(Math.hypot(p.x - 100, p.y) - 100)).toBeLessThan(0.1);
  });
});
