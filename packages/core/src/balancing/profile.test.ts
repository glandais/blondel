import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildProfile,
  evalProfile,
  invertProfile,
  isStrictlyIncreasing,
  maxSlope,
  sampledSlopeExtrema,
  slopeExtrema,
  type EndCondition,
  type M3Variant,
} from "./profile.js";

/** Collets (mm) d'une zone de B §3.5 : Δ de jour, hauteurs h, pente m, variante. */
function exampleCollets(variant: M3Variant, h = 180, g = 250, count = 6, delta = 900): number[] {
  const m = h / g;
  const S = (count * h) / delta;
  const profile = buildProfile({
    variant,
    ends: ["tangent", "tangent"],
    meanSlope: S,
    startSlope: m,
    endSlope: m,
  });
  const sigma = [0];
  for (let k = 1; k < count; k++) sigma.push(invertProfile(profile, (k * h) / delta) * delta);
  sigma.push(delta);
  return sigma.slice(1).map((s, i) => s - sigma[i]!);
}

describe("courbe de développement M3 (B §3.5)", () => {
  it("exemple cubique : collets 184,6 / 138,7 / 126,7 / 126,7 / 138,7 / 184,6", () => {
    const c = exampleCollets("cubic");
    [184.6, 138.7, 126.7, 126.7, 138.7, 184.6].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 1));
    expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(900, 9);
  });

  it("exemple quintique : collets 202,6 / 133,7 / 113,8 / 113,8 / 133,7 / 202,6", () => {
    const c = exampleCollets("quintic");
    [202.6, 133.7, 113.8, 113.8, 133.7, 202.6].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 1));
  });

  it("pente maximale et collet estimé : 1,44 → 125 mm (cubique), 1,62 → 111 mm (quintique)", () => {
    const spec = {
      ends: ["tangent", "tangent"] as const,
      meanSlope: 1.2,
      startSlope: 0.72,
      endSlope: 0.72,
    };
    const cubic = buildProfile({ ...spec, variant: "cubic" });
    const quintic = buildProfile({ ...spec, variant: "quintic" });
    expect(maxSlope(cubic)).toBeCloseTo(1.44, 12);
    expect(maxSlope(quintic)).toBeCloseTo(1.62, 12);
    expect(180 / maxSlope(cubic)).toBeCloseTo(125, 9);
    expect(180 / maxSlope(quintic)).toBeCloseTo(111.1, 1);
    // L'échantillonnage retrouve la valeur analytique.
    expect(sampledSlopeExtrema(cubic).max).toBeCloseTo(1.44, 9);
    expect(sampledSlopeExtrema(quintic).max).toBeCloseTo(1.62, 9);
  });

  it("deux extrémités tangentes : formules fermées de B §3.5", () => {
    const m = 0.7;
    const S = 1.3;
    const cubic = buildProfile({
      variant: "cubic",
      ends: ["tangent", "tangent"],
      meanSlope: S,
      startSlope: m,
      endSlope: m,
    });
    const quintic = buildProfile({ ...cubic.spec, variant: "quintic" });
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const fc3 =
        m * (t - 2 * t * t + t ** 3) + S * (3 * t * t - 2 * t ** 3) + m * (t ** 3 - t * t);
      const fc5 = m * t + (S - m) * (10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5);
      expect(evalProfile(cubic, t)).toBeCloseTo(fc3, 12);
      expect(evalProfile(quintic, t)).toBeCloseTo(fc5, 12);
    }
  });

  it("extrémités libres : conditions naturelles (F'' = 0 ; F''' = F'''' = 0) ; deux libres = droite", () => {
    const base = { meanSlope: 1.2, startSlope: 0.72, endSlope: 0.72 };
    const c = buildProfile({ ...base, variant: "cubic", ends: ["tangent", "free"] });
    expect(evalProfile(c, 0, 1)).toBeCloseTo(0.72, 12);
    expect(evalProfile(c, 1, 2)).toBeCloseTo(0, 12);
    expect(evalProfile(c, 1)).toBeCloseTo(1.2, 12);
    // F'(1) = (3S − m)/2 (spline naturelle).
    expect(evalProfile(c, 1, 1)).toBeCloseTo((3 * 1.2 - 0.72) / 2, 12);

    const q = buildProfile({ ...base, variant: "quintic", ends: ["free", "tangent"] });
    expect(evalProfile(q, 1, 1)).toBeCloseTo(0.72, 12);
    expect(evalProfile(q, 1, 2)).toBeCloseTo(0, 12);
    expect(evalProfile(q, 0, 3)).toBeCloseTo(0, 10);
    expect(evalProfile(q, 0, 4)).toBeCloseTo(0, 10);
    expect(evalProfile(q, 1)).toBeCloseTo(1.2, 12);

    for (const variant of ["cubic", "quintic"] as const) {
      const lin = buildProfile({ ...base, variant, ends: ["free", "free"] });
      expect(evalProfile(lin, 0.3, 1)).toBeCloseTo(1.2, 12);
      expect(evalProfile(lin, 0.3)).toBeCloseTo(0.36, 12);
    }
  });

  it("cubique non monotone quand le jour est trop long (S < m/3)", () => {
    const p = buildProfile({
      variant: "cubic",
      ends: ["tangent", "tangent"],
      meanSlope: 0.2,
      startSlope: 0.72,
      endSlope: 0.72,
    });
    expect(isStrictlyIncreasing(p)).toBe(false);
  });

  it("creux de f' entre deux points de grille : détecté (extrema exacts), manqué par l'échantillonnage", () => {
    // f'(t) = 1000·(t − c)² − ε, minimum −ε en c = 0,50125, entre les points 0,5 et 0,5025.
    const c = 0.50125;
    const eps = 1e-4;
    const p = {
      spec: {
        variant: "cubic" as const,
        ends: ["tangent", "tangent"] as const,
        meanSlope: 1,
        startSlope: 1,
        endSlope: 2,
      },
      coeffs: [0, 1000 * c * c - eps, -1000 * c, 1000 / 3],
    };
    expect(sampledSlopeExtrema(p).min).toBeGreaterThan(0);
    expect(slopeExtrema(p).min).toBeCloseTo(-eps, 9);
    expect(isStrictlyIncreasing(p)).toBe(false);
    // Extrema exacts = échantillonnage fin sur un profil régulier.
    const q = buildProfile({
      variant: "quintic",
      ends: ["free", "tangent"],
      meanSlope: 1.3,
      startSlope: 0.7,
      endSlope: 0.6,
    });
    const fine = sampledSlopeExtrema(q, 200_000);
    expect(slopeExtrema(q).min).toBeCloseTo(fine.min, 8);
    expect(slopeExtrema(q).max).toBeCloseTo(fine.max, 8);
  });

  it("propriété : F strictement croissante et inversion exacte (S ≥ m, extrémités quelconques)", () => {
    const end = fc.constantFrom<EndCondition>("tangent", "free");
    fc.assert(
      fc.property(
        fc.constantFrom<M3Variant>("cubic", "quintic"),
        end,
        end,
        fc.double({ min: 0.4, max: 1.2, noNaN: true }),
        fc.double({ min: 0.4, max: 1.2, noNaN: true }),
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (variant, e0, e1, m0, m1, ratio, t) => {
          const S = Math.max(m0, m1) * ratio;
          const p = buildProfile({
            variant,
            ends: [e0, e1],
            meanSlope: S,
            startSlope: m0,
            endSlope: m1,
          });
          expect(evalProfile(p, 0)).toBeCloseTo(0, 12);
          expect(evalProfile(p, 1)).toBeCloseTo(S, 10);
          expect(isStrictlyIncreasing(p)).toBe(true);
          expect(invertProfile(p, evalProfile(p, t))).toBeCloseTo(t, 9);
          if (e0 === "tangent") expect(evalProfile(p, 0, 1)).toBeCloseTo(m0, 10);
          if (e1 === "tangent") expect(evalProfile(p, 1, 1)).toBeCloseTo(m1, 10);
        },
      ),
      { numRuns: 300 },
    );
  });
});
