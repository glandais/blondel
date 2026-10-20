/**
 * Départ canonique et élagage d'un contour (`canonical.ts`, chantier `stable-tiebreaks`) :
 * cas fixes, et propriétés d'invariance au bruit ≤ 1e-9 mm et à la rotation de l'ordre des
 * sommets.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Vec2 } from "../model/primitives.js";
import { lowestVertexIndex, pruneFlatVertices, rotateToStart } from "./canonical.js";
import { GEOM_EPS } from "./tolerance.js";
import * as V from "./vec.js";

const NOISE = 1e-9;

const noisy = (pts: readonly Vec2[], seeds: readonly number[]): Vec2[] =>
  pts.map((p, i) =>
    V.vec(
      p.x + NOISE * (seeds[(2 * i) % seeds.length]! * 2 - 1),
      p.y + NOISE * (seeds[(2 * i + 1) % seeds.length]! * 2 - 1),
    ),
  );

/** Enveloppe convexe exacte (chaîne monotone, sommets alignés exclus). */
function exactHull(points: readonly Vec2[]): Vec2[] {
  const p = [...points].sort((u, v) => u.x - v.x || u.y - v.y);
  const half = (list: readonly Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const q of list) {
      while (
        out.length >= 2 &&
        V.cross(
          V.sub(out[out.length - 1]!, out[out.length - 2]!),
          V.sub(q, out[out.length - 2]!),
        ) <= 0
      )
        out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

const magnitude = fc.double({ min: 1e-8, max: 4e-7, noNaN: true });

/**
 * Contour convexe à coordonnées entières (abscisses multiples de 60 : bords verticaux
 * fréquents), avec, à leur place dans l'ordre cyclique, des sommets quasi alignés (paramètre
 * réel sur une arête) et des sommets quasi confondus avec un coin (décalage de 1e-8 à 4e-7 mm
 * sur chaque coordonnée : à moins de `GEOM_EPS` du coin, à bien plus que le bruit ; deux décalages
 * opposés sur un bord vertical restent à au plus 8e-7 en x, loin du seuil `xmin + eps` du départ). Deux sommets
 * quasi confondus avec un même coin diffèrent en y d'au moins 1e-8 : sinon le bruit seul les
 * départage comme sommet canonique (limite documentée de `pruneFlatVertices`).
 */
const ringWithFlats = fc
  .record({
    pts: fc.array(
      fc
        .record({ x: fc.integer({ min: -50, max: 50 }), y: fc.integer({ min: -3000, max: 3000 }) })
        .map(({ x, y }) => V.vec(x * 60, y)),
      { minLength: 3, maxLength: 14 },
    ),
    inserts: fc.array(
      fc.record({
        edge: fc.nat(),
        kind: fc.constantFrom("onEdge", "nearStart", "nearEnd"),
        t: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        dx: magnitude,
        dy: magnitude,
        sx: fc.boolean(),
        sy: fc.boolean(),
      }),
      { maxLength: 6 },
    ),
  })
  .map(({ pts, inserts }) => {
    const hull = exactHull(pts);
    if (hull.length < 3) return null;
    const nearStart: Vec2[][] = hull.map(() => []);
    const onEdge: { t: number; p: Vec2 }[][] = hull.map(() => []);
    const nearEnd: Vec2[][] = hull.map(() => []);
    const nearYs: number[][] = hull.map(() => []);
    const freeY = (corner: number, dy: number): boolean => {
      if (nearYs[corner]!.some((y) => Math.abs(y - dy) < 1e-8)) return false;
      nearYs[corner]!.push(dy);
      return true;
    };
    for (const { edge, kind, t, dx, dy, sx, sy } of inserts) {
      const i = edge % hull.length;
      const a = hull[i]!;
      const b = hull[(i + 1) % hull.length]!;
      const off = V.vec(sx ? dx : -dx, sy ? dy : -dy);
      if (kind === "onEdge") onEdge[i]!.push({ t, p: V.lerp(a, b, t) });
      else if (kind === "nearStart" && nearStart[i]!.length === 0 && freeY(i, off.y))
        nearStart[i]!.push(V.add(a, off));
      else if (
        kind === "nearEnd" &&
        nearEnd[i]!.length === 0 &&
        freeY((i + 1) % hull.length, off.y)
      )
        nearEnd[i]!.push(V.add(b, off));
    }
    const ring: Vec2[] = [];
    hull.forEach((p, i) => {
      ring.push(p, ...nearStart[i]!);
      ring.push(...onEdge[i]!.sort((u, v) => u.t - v.t).map((e) => e.p));
      ring.push(...nearEnd[i]!);
    });
    return { hull, ring };
  })
  .filter((v): v is { hull: Vec2[]; ring: Vec2[] } => v !== null);

const seedsArb = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
  minLength: 8,
  maxLength: 64,
});

const canonicalRing = (ring: readonly Vec2[]): Vec2[] => {
  const pruned = pruneFlatVertices(ring, GEOM_EPS);
  return rotateToStart(pruned, lowestVertexIndex(pruned, GEOM_EPS));
};

describe("canonical.ts : cas fixes", () => {
  it("lowestVertexIndex : plus petit y parmi les x minimaux à eps près", () => {
    expect(lowestVertexIndex([], 1e-6)).toBe(-1);
    expect(
      lowestVertexIndex([V.vec(1e-9, 10), V.vec(0, 5), V.vec(1e-9, 0), V.vec(3, -1)], 1e-6),
    ).toBe(2);
    expect(lowestVertexIndex([V.vec(1e-3, 0), V.vec(0, 5)], 1e-6)).toBe(1);
  });

  it("rotateToStart : rotation cyclique, copie hors bornes", () => {
    expect(rotateToStart([1, 2, 3, 4], 2)).toEqual([3, 4, 1, 2]);
    expect(rotateToStart([1, 2, 3], -1)).toEqual([1, 2, 3]);
    expect(rotateToStart([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("pruneFlatVertices : sommets quasi alignés ou quasi confondus retirés, coins gardés", () => {
    const ring = [
      V.vec(0, 0),
      V.vec(5, 1e-9),
      V.vec(10, 0),
      V.vec(10, 0 + 1e-10),
      V.vec(10, 10),
      V.vec(0, 10),
    ];
    expect(pruneFlatVertices(ring, 1e-6)).toEqual([
      V.vec(0, 0),
      V.vec(10, 0 + 1e-10),
      V.vec(10, 10),
      V.vec(0, 10),
    ]);
    // Coin franc gardé même à 1e-5 mm de la corde de ses voisins.
    expect(pruneFlatVertices([V.vec(0, 0), V.vec(5, 1e-5), V.vec(10, 0)], 1e-6)).toHaveLength(3);
  });

  it("pruneFlatVertices : survivant d'une paire quasi confondue indépendant du départ reçu", () => {
    // Paire (0, 0) / (0, 5e-7) (contre-exemple de relecture S2) : le premier sommet reçu (départ
    // de la chaîne monotone, choisi par un bruit de 1e-12 sur une abscisse) ne décide plus du
    // sommet gardé.
    const a = [V.vec(0, 5e-7), V.vec(500, 0), V.vec(2000, 300), V.vec(0.001, 300), V.vec(0, 0)];
    const b = [
      V.vec(0, 0),
      V.vec(500, 0),
      V.vec(2000, 300),
      V.vec(0.001, 300),
      V.vec(-1e-12, 5e-7),
    ];
    const ca = canonicalRing(a);
    const cb = canonicalRing(b);
    expect(cb.length).toBe(ca.length);
    ca.forEach((p, i) => expect(V.distance(p, cb[i]!)).toBeLessThanOrEqual(1e-11));
  });

  it("pruneFlatVertices : survivant d'un trio quasi confondu indépendant du départ reçu", () => {
    // Coin (−60, 1) entre deux copies d'un même sommet à 1,4e-8 mm (contre-exemple CI, graine
    // −303113739) : le départ canonique tombe sur l'une ou l'autre copie selon le bruit ; partant
    // de la seconde dans l'ordre cyclique, la cascade retirait aussi le coin.
    const near = V.vec(-60.00000001, 0.99999999);
    const ring = [V.vec(-60, 1), near, V.vec(0, 0), V.vec(0, 1), near];
    const ref = canonicalRing(ring);
    for (const k of [0, 1, 2, 3, 4])
      for (const s of [0, 1]) {
        const seeds = [s, s, 1 - s, 1 - s, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
        const got = canonicalRing(rotateToStart(noisy(ring, seeds), k));
        expect(got.length).toBe(ref.length);
        ref.forEach((p, i) => expect(V.distance(got[i]!, p)).toBeLessThanOrEqual(1e-8));
      }
  });
});

describe("canonical.ts : propriétés (bruit ≤ 1e-9, rotation de l'ordre)", () => {
  it("lowestVertexIndex : même sommet", () => {
    fc.assert(
      fc.property(ringWithFlats, seedsArb, fc.nat(), ({ hull }, seeds, k) => {
        const ref = hull[lowestVertexIndex(hull, GEOM_EPS)]!;
        const got = rotateToStart(noisy(hull, seeds), k % hull.length);
        expect(V.distance(got[lowestVertexIndex(got, GEOM_EPS)]!, ref)).toBeLessThanOrEqual(1e-8);
      }),
      { numRuns: 1000 },
    );
  });

  it("pruneFlatVertices : mêmes sommets élagués (même survivant), même départ canonique", () => {
    fc.assert(
      fc.property(ringWithFlats, seedsArb, fc.nat(), ({ hull, ring }, seeds, k) => {
        const ref = canonicalRing(ring);
        const got = canonicalRing(rotateToStart(noisy(ring, seeds), k % ring.length));
        // Élagué : les coins de l'enveloppe exacte, à `GEOM_EPS` près, depuis son départ.
        const start = lowestVertexIndex(hull, GEOM_EPS);
        expect(ref.length).toBe(hull.length);
        expect(got.length).toBe(ref.length);
        ref.forEach((p, i) => {
          expect(V.distance(p, hull[(i + start) % hull.length]!)).toBeLessThanOrEqual(GEOM_EPS);
          // Même survivant de chaque paire quasi confondue : égal au bruit près.
          expect(V.distance(got[i]!, p)).toBeLessThanOrEqual(1e-8);
        });
      }),
      { numRuns: 1000 },
    );
  });
});
