/**
 * Départage des minima d'échappée ex æquo (décision F10 (3), `selfcover.ts`) : parmi les
 * candidats à `HEADROOM_TIE_TOL` près du minimum strict, le premier en montant, avec sa propre
 * valeur ; deux passes, sans cumul de tolérance. L'effet sur les escaliers qui se recouvrent est
 * vérifié par la parité hélicoïdal / cage (`layout/cage/helicalParity.test.ts`, anciens cas TIE).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { firstNearMinimum, HEADROOM_TIE_TOL } from "./selfcover.js";

const c = (min: number, id: number) => ({ min, id });

describe("firstNearMinimum (décision F10 (3))", () => {
  it("tolérance numérique de 1e-6 mm", () => {
    expect(HEADROOM_TIE_TOL).toBe(1e-6);
  });

  it("aucun candidat : indéfini", () => {
    expect(firstNearMinimum([])).toBeUndefined();
  });

  it("minimum unique : retenu, même s'il vient en dernier", () => {
    expect(firstNearMinimum([c(5, 0), c(3, 1), c(1, 2)])).toEqual(c(1, 2));
  });

  it("minima égaux : le premier en montant", () => {
    expect(firstNearMinimum([c(5, 0), c(1, 1), c(2, 2), c(1, 3)])).toEqual(c(1, 1));
  });

  it("minima égaux au bruit près : le premier, avec sa propre valeur", () => {
    const m = 2118.65;
    expect(firstNearMinimum([c(m + 9e-7, 0), c(m, 1)])).toEqual(c(m + 9e-7, 0));
    expect(firstNearMinimum([c(m + 2e-12, 0), c(m, 1)])).toEqual(c(m + 2e-12, 0));
  });

  it("au-delà de la tolérance : le minimum strict", () => {
    const m = 1000;
    expect(firstNearMinimum([c(m + 2e-6, 0), c(m, 1)])).toEqual(c(m, 1));
  });

  it("deux passes : la tolérance ne se cumule pas de proche en proche", () => {
    // Une comparaison en une passe « garder le premier sauf plus bas de plus de tol » glisserait
    // par paliers : 1,5e-6 → 0,8e-6 → 0. Ici, seul compte l'écart au minimum strict (0).
    expect(firstNearMinimum([c(1.5e-6, 0), c(0.8e-6, 1), c(0, 2)])).toEqual(c(0.8e-6, 1));
    expect(firstNearMinimum([c(0.6e-6, 0), c(1.2e-6, 1), c(0, 2)])).toEqual(c(0.6e-6, 0));
  });

  it("propriété : retenu à tol près du minimum strict, aucun candidat antérieur ne l'est", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.double({ min: -1e4, max: 1e4, noNaN: true }),
            fc.integer({ min: -3, max: 3 }).map((k) => 500 + k * 5e-7),
          ),
          { minLength: 1, maxLength: 40 },
        ),
        (values) => {
          const candidates = values.map(c);
          const m = Math.min(...values);
          const r = firstNearMinimum(candidates)!;
          expect(r.min).toBeLessThanOrEqual(m + HEADROOM_TIE_TOL);
          expect(candidates.slice(0, r.id).every((x) => x.min > m + HEADROOM_TIE_TOL)).toBe(true);
        },
      ),
    );
  });
});
