/**
 * Enveloppe convexe de `collide.ts` indépendante du bruit d'arrondi (chantier
 * `stable-tiebreaks`, S2, point 5) : mêmes sommets dans le même ordre et même premier sommet
 * malgré un bruit ≤ 1e-9 mm sur chaque coordonnée et un mélange de l'ordre d'entrée ; résultat
 * inchangé au bit près hors cas d'égalité (coordonnées entières).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import { convexHull } from "./collide.js";
import * as V from "./vec.js";

/** Copie figée de l'enveloppe d'avant S2 (tri exact, `cross ≤ 0` exact, départ du tri). */
function legacyConvexHull(points: readonly Vec2[]): Polygon2 {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return [];
  const half = (list: readonly Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (
        out.length >= 2 &&
        V.cross(
          V.sub(out[out.length - 1]!, out[out.length - 2]!),
          V.sub(p, out[out.length - 2]!),
        ) <= 0
      )
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  return hull.length >= 3 ? hull : [];
}

const NOISE = 1e-9;

const intPoint = fc
  .record({ x: fc.integer({ min: -5000, max: 5000 }), y: fc.integer({ min: -5000, max: 5000 }) })
  .map(({ x, y }) => V.vec(x, y));

/** Bruit uniforme ≤ `NOISE` sur chaque coordonnée (graines fast-check, reproductible). */
const noisy = (pts: readonly Vec2[], seeds: readonly number[]): Vec2[] =>
  pts.map((p, i) =>
    V.vec(
      p.x + NOISE * (seeds[(2 * i) % seeds.length]! * 2 - 1),
      p.y + NOISE * (seeds[(2 * i + 1) % seeds.length]! * 2 - 1),
    ),
  );

/** Mélange déterministe (permutation tirée par fast-check). */
const permuted = <T>(list: readonly T[], keys: readonly number[]): T[] =>
  list
    .map((v, i) => ({ v, k: keys[i % keys.length]! + i * 1e-12 }))
    .sort((a, b) => a.k - b.k)
    .map((e) => e.v);

/**
 * Nuage « à ex æquo » : points entiers, points posés sur les arêtes de leur enveloppe exacte
 * (paramètre réel quelconque : bruit d'arrondi du calcul), doublons de sommets et points d'un
 * bord gauche vertical (même abscisse minimale, ordonnées entières).
 */
const tiedCloud = fc
  .record({
    base: fc.array(intPoint, { minLength: 3, maxLength: 16 }),
    onEdge: fc.array(
      fc.record({ edge: fc.nat(), t: fc.double({ min: 0.01, max: 0.99, noNaN: true }) }),
      { maxLength: 8 },
    ),
    duplicates: fc.array(fc.nat(), { maxLength: 4 }),
    leftEdge: fc.array(fc.integer({ min: -5000, max: 5000 }), { maxLength: 3 }),
    seeds: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 8, maxLength: 64 }),
    order: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 8, maxLength: 64 }),
  })
  .map(({ base, onEdge, duplicates, leftEdge, seeds, order }) => {
    const xmin = Math.min(...base.map((p) => p.x));
    const exactPts = [...base, ...leftEdge.map((y) => V.vec(xmin, y))];
    const exact = legacyConvexHull(exactPts);
    const extra: Vec2[] = [];
    if (exact.length >= 3) {
      for (const { edge, t } of onEdge) {
        const a = exact[edge % exact.length]!;
        const b = exact[(edge + 1) % exact.length]!;
        extra.push(V.lerp(a, b, t));
      }
      for (const d of duplicates) extra.push(exact[d % exact.length]!);
    }
    return { exact, all: [...exactPts, ...extra], seeds, order };
  });

describe("convexHull (collide.ts) : départages indépendants du bruit", () => {
  it("hors égalité : identique au bit près à l'enveloppe d'avant S2 (coordonnées entières)", () => {
    fc.assert(
      fc.property(fc.array(intPoint, { minLength: 0, maxLength: 40 }), (pts) => {
        expect(convexHull(pts)).toEqual(legacyConvexHull(pts));
      }),
      { numRuns: 500 },
    );
  });

  it("bruit ≤ 1e-9 et ordre d'entrée : mêmes sommets, même ordre, même premier sommet", () => {
    fc.assert(
      fc.property(tiedCloud, ({ exact, all, seeds, order }) => {
        const hull = convexHull(permuted(noisy(all, seeds), order));
        if (exact.length < 3) {
          // Points entiers alignés : le nuage bruité est aplati à `GEOM_EPS` près.
          expect(hull).toEqual([]);
          return;
        }
        expect(hull.length).toBe(exact.length);
        for (let i = 0; i < exact.length; i++) {
          expect(V.distance(hull[i]!, exact[i]!)).toBeLessThanOrEqual(1e-6);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("bord gauche vertical bruité : départ au sommet bas, sommet aligné retiré", () => {
    const pts = [
      V.vec(1e-13, 10),
      V.vec(0, 0),
      V.vec(10, 0),
      V.vec(10, 10),
      V.vec(-1e-13, 5), // sur le bord gauche, au bruit près
      V.vec(5, 1e-13), // sur le bord bas, au bruit près
    ];
    const hull = convexHull(pts);
    expect(hull.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    // L'ancienne enveloppe gardait les sommets alignés au bruit près et partait du bruit.
    expect(legacyConvexHull(pts).length).toBeGreaterThan(4);
  });
});
