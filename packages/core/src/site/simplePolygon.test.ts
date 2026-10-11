import fc from "fast-check";
import { msg, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { signedArea } from "../geom2d/polygon.js";
import type { Vec2 } from "../model/primitives.js";
import { polygonOpening, validateOpeningPolygon } from "./opening.js";
import { isSelfIntersecting, polygonDefect, storedPolygonDefect } from "./simplePolygon.js";

describe("contrôle commun d'un contour polygonal", () => {
  it("premier défaut, dans l'ordre : sommets, nombres, aire, recoupement", () => {
    expect(polygonDefect([{ x: 0, y: 0 }])).toEqual({ kind: "tooFewPoints", count: 1 });
    expect(
      polygonDefect([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toEqual({ kind: "notNumeric" });
    expect(
      polygonDefect([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toEqual({ kind: "zeroArea" });
    expect(
      polygonDefect([
        { x: 0, y: 0 },
        { x: 2000, y: 2000 },
        { x: 2000, y: 0 },
        { x: 0, y: 1000 },
      ]),
    ).toEqual({ kind: "selfIntersecting" });
    expect(
      polygonDefect([
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 500 },
        { x: 500, y: 500 },
        { x: 500, y: 1000 },
        { x: 0, y: 1000 },
      ]),
    ).toBeNull();
  });

  it("contour enregistré : sommet répété ou contour refermé refusés comme doublon, pas comme recoupement", () => {
    const A = { x: 0, y: 0 };
    const B = { x: 1000, y: 0 };
    const C = { x: 1000, y: 1000 };
    const D = { x: 0, y: 1000 };
    // Sans ce contrôle, ces trois saisies d'un carré simple sortaient en « selfIntersecting ».
    expect(storedPolygonDefect([A, B, C, D, A])).toEqual({
      kind: "duplicateVertex",
      index: 5,
      other: 1,
    });
    expect(storedPolygonDefect([A, A, B, C, D])).toEqual({
      kind: "duplicateVertex",
      index: 2,
      other: 1,
    });
    expect(storedPolygonDefect([A, B, B, C, D])).toEqual({
      kind: "duplicateVertex",
      index: 3,
      other: 2,
    });
    expect(storedPolygonDefect([A, B])).toEqual({ kind: "tooFewPoints", count: 2 });
    expect(storedPolygonDefect([A, B, C, D])).toBeNull();
    // Sommets voisins distincts, même très proches : pas un doublon (contour simple).
    expect(storedPolygonDefect([A, { x: 0.001, y: 0 }, B, C, D])).toBeNull();
    // La trémie normalise avant de contrôler : le contour refermé y est accepté.
    expect(polygonOpening([A, B, C, D, A]).points).toHaveLength(4);
  });

  it("la trémie garde son comportement : identique à l'implémentation d'avant le déplacement", () => {
    // Oracle indépendant : corps de `validateOpeningPolygon` avant le sous-lot 0c, recopié tel
    // quel (seul `isSelfIntersecting`, déplacé sans modification, est partagé).
    const before = (points: readonly Vec2[]): Message[] => {
      const issues: Message[] = [];
      if (points.length < 3) {
        issues.push(msg("site.opening.tooFewPoints", { count: String(points.length) }));
        return issues;
      }
      if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
        issues.push(msg("site.opening.notNumeric"));
        return issues;
      }
      if (!(Math.abs(signedArea(points)) > 1)) issues.push(msg("site.opening.zeroArea"));
      else if (isSelfIntersecting(points)) issues.push(msg("site.opening.selfIntersecting"));
      return issues;
    };
    const c = fc.oneof(
      { weight: 6, arbitrary: fc.integer({ min: -50, max: 50 }) },
      { weight: 6, arbitrary: fc.double({ min: -50, max: 50, noNaN: true }) },
      { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY) },
    );
    const pt = fc.record({ x: c, y: c });
    // Polygones concaves simples à coordonnées réelles (étoilés autour d'un centre).
    const star = fc
      .record({
        n: fc.integer({ min: 3, max: 9 }),
        weights: fc.array(fc.double({ min: 1, max: 1.9, noNaN: true }), {
          minLength: 9,
          maxLength: 9,
        }),
        radii: fc.array(fc.double({ min: 0.5, max: 40, noNaN: true }), {
          minLength: 9,
          maxLength: 9,
        }),
      })
      .map(({ n, weights, radii }) => {
        const w = weights.slice(0, n);
        const total = w.reduce((a, b) => a + b, 0);
        let t = 0;
        return w.map((wi, k) => {
          const p = { x: radii[k]! * Math.cos(t), y: radii[k]! * Math.sin(t) };
          t += (2 * Math.PI * wi) / total;
          return p;
        });
      });
    fc.assert(
      fc.property(fc.oneof(fc.array(pt, { maxLength: 6 }), star), (points) => {
        expect(validateOpeningPolygon(points)).toEqual(before(points));
      }),
      { numRuns: 500 },
    );
  });
});
