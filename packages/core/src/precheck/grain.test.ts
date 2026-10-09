/**
 * Réduction selon l'angle du fil (`grain.ts`, QUESTIONS A35 (j)) : formule de type Hankinson
 * du Wood Handbook (C §1.11 [81]) et angle du fil d'une poutre en couches empilées.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { grainAngle, hankinsonFactor } from "./grain.js";

const ratioArb = fc.double({ min: 0.01, max: 1, noNaN: true });
const exponentArb = fc.double({ min: 0.5, max: 3, noNaN: true });
const thetaArb = fc.double({ min: 0, max: Math.PI / 2, noNaN: true });
const slopeArb = fc.double({ min: 0, max: 3, noNaN: true });
const deviationArb = fc.double({ min: -Math.PI / 2, max: Math.PI / 2, noNaN: true });

describe("hankinsonFactor", () => {
  it("valeurs de [81] : 1 le long du fil, Q/P en travers ; MOR à la pente 1:10 proche de 0,81", () => {
    expect(hankinsonFactor(0.04, 1.5, 0)).toBe(1);
    expect(hankinsonFactor(0.04, 1.5, Math.PI / 2)).toBeCloseTo(0.04, 12);
    // Tableau 5-12 de [81] : pente 1:10 → 81 % du MOR, « très proche de Q/P = 0,1, n = 1,5 ».
    expect(hankinsonFactor(0.1, 1.5, Math.atan(0.1))).toBeCloseTo(0.81, 1);
    // C §1.11 [CALCUL] : à 33°, flexion ≈ 0,09 (Q/P 0,04, n 1,5), module ≈ 0,12 (Q/P 0,04, n 2).
    const a33 = (33 * Math.PI) / 180;
    expect(hankinsonFactor(0.04, 1.5, a33)).toBeCloseTo(0.09, 2);
    expect(hankinsonFactor(0.04, 2, a33)).toBeCloseTo(0.12, 2);
  });

  it("entrées non finies : NaN (le plugin rend alors « non évalué »)", () => {
    expect(hankinsonFactor(Number.NaN, 1.5, 0.3)).toBeNaN();
    expect(hankinsonFactor(0.04, 1.5, Number.NaN)).toBeNaN();
  });

  it("propriété : facteur dans [Q/P ; 1], 1 en 0 et Q/P en π/2", () => {
    fc.assert(
      fc.property(ratioArb, exponentArb, thetaArb, (r, n, theta) => {
        const k = hankinsonFactor(r, n, theta);
        expect(k).toBeGreaterThanOrEqual(r);
        expect(k).toBeLessThanOrEqual(1);
        expect(hankinsonFactor(r, n, 0)).toBeCloseTo(1, 12);
        expect(hankinsonFactor(r, n, Math.PI / 2)).toBeCloseTo(r, 6);
      }),
    );
  });

  it("propriété : décroissant sur [0 ; π/2]", () => {
    fc.assert(
      fc.property(ratioArb, exponentArb, thetaArb, thetaArb, (r, n, t1, t2) => {
        const [a, b] = t1 <= t2 ? [t1, t2] : [t2, t1];
        expect(hankinsonFactor(r, n, b)).toBeLessThanOrEqual(hankinsonFactor(r, n, a) + 1e-9);
      }),
    );
  });
});

describe("grainAngle", () => {
  it("fil dans l'axe en plan : θ = α = atan(pente) ; poutre horizontale : θ = |β|", () => {
    expect(grainAngle(0, 0)).toBe(0);
    expect(grainAngle(Math.tan(0.6), 0)).toBeCloseTo(0.6, 12);
    expect(grainAngle(0, 0.2)).toBeCloseTo(0.2, 12);
    expect(grainAngle(0, -0.2)).toBeCloseTo(0.2, 12);
    expect(grainAngle(Number.NaN, 0)).toBeNaN();
  });

  it("propriété : θ dans [0 ; π/2], au moins α et au moins |β|", () => {
    fc.assert(
      fc.property(slopeArb, deviationArb, (slope, beta) => {
        const theta = grainAngle(slope, beta);
        expect(theta).toBeGreaterThanOrEqual(0);
        expect(theta).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
        expect(theta).toBeGreaterThanOrEqual(Math.atan(slope) - 1e-7);
        expect(theta).toBeGreaterThanOrEqual(Math.abs(beta) - 1e-7);
      }),
    );
  });
});
