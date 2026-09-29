/**
 * Rehausse sur palier (QUESTIONS A1) : propriétés de `landingRaise` sur des profils générés
 * (rampant – palier – rampant, palier en tête ou en pied de ligne).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { landingRaise } from "./compute.js";
import { cumulative, interp } from "./polyline.js";

/** Chemin rectiligne en x, profil : montée `a`, palier `f`, montée `b` (pente p). */
const profile = fc.record({
  a: fc.integer({ min: 0, max: 2000 }),
  f: fc.integer({ min: 50, max: 1500 }),
  b: fc.integer({ min: 0, max: 2000 }),
  slope: fc.double({ min: 0.3, max: 1, noNaN: true }),
  H: fc.integer({ min: 800, max: 1000 }),
  dh: fc.integer({ min: 1, max: 300 }),
  ramp: fc.integer({ min: 1, max: 400 }),
});

describe("landingRaise", () => {
  it("palier à la hauteur de palier, raccords bornés, hauteur de volée au-delà", () => {
    fc.assert(
      fc.property(profile, ({ a, f, b, slope, H, dh, ramp }) => {
        const xs = [0, ...(a > 0 ? [a] : []), a + f, ...(b > 0 ? [a + f + b] : [])];
        const zAt = (x: number): number =>
          x <= a ? x * slope : x <= a + f ? a * slope : a * slope + (x - a - f) * slope;
        const path = xs.map((x) => ({ x, y: 0 }));
        const ref = xs.map(zAt);
        const u = xs.map((x) => x);
        const r = landingRaise(path, ref, u, H, H + dh, ramp)!;
        expect(r).not.toBeNull();
        // Sommets d'origine conservés, dans l'ordre.
        r.vertexOf.forEach((v, i) => {
          expect(r.path[v]).toEqual(path[i]);
          if (i > 0) expect(v).toBeGreaterThan(r.vertexOf[i - 1]!);
        });
        const w = cumulative(r.path);
        for (let i = 0; i + 1 < w.length; i++) expect(w[i + 1]!).toBeGreaterThan(w[i]!);
        // Profil de hauteur : échantillonné au millimètre.
        for (let x = 0; x <= w[w.length - 1]!; x += 1) {
          const h = interp(w, r.heights, x);
          expect(h).toBeGreaterThanOrEqual(H - 1e-9);
          expect(h).toBeLessThanOrEqual(H + dh + 1e-9);
          const d = x < a ? a - x : x > a + f ? x - a - f : 0;
          if (d === 0) expect(h).toBeCloseTo(H + dh, 9);
          if (d >= ramp) expect(h).toBeCloseTo(H, 9);
          // Raccord linéaire : exact grâce aux sommets insérés.
          if (d > 0 && d < ramp) expect(h).toBeCloseTo(H + dh * (1 - d / ramp), 6);
          // La référence n'est pas modifiée par l'insertion de sommets.
          expect(interp(w, r.ref, x)).toBeCloseTo(zAt(x), 6);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("sans palier, ou hauteur de palier non supérieure : null", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ];
    expect(landingRaise(path, [0, 600], [0, 1000], 900, 1000, 250)).toBeNull();
    const flat = [0, 0];
    expect(landingRaise(path, flat, [0, 1000], 1000, 1000, 250)).toBeNull();
    expect(landingRaise(path, flat, [0, 1000], 900, 1000, 250)!.heights).toEqual([1000, 1000]);
  });
});
