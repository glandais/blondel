/**
 * `firstHit` : départage final par l'abscisse attendue (`nearS`, F10 sous-lot P1) quand le bord
 * repasse exactement au même point en plan (cercle parcouru deux fois, comme le bord d'une cage
 * issue d'un hélicoïdal de plus d'un tour) : distance et tangente sont alors à égalité.
 */
import { describe, expect, it } from "vitest";
import { splitArc } from "../geom2d/arc.js";
import { makeCurve } from "../geom2d/curve.js";
import { firstHit } from "./postprocess.js";

describe("firstHit — bord qui repasse au même point", () => {
  const r = 100;
  // Deux tours d'un cercle de centre (0, 0), découpés en arcs de 90° au plus.
  const curve = makeCurve(splitArc({ x: 0, y: 0 }, r, 0, 4 * Math.PI));
  const y = r * Math.sin(Math.PI / 4);
  const origin = { x: 200, y };
  const dir = { x: 1, y: 0 };
  const along = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  const firstTurn = (r * Math.PI) / 4;
  const secondTurn = r * (2 * Math.PI + Math.PI / 4);

  it("deux intersections à égalité de distance et de tangente, une par tour", () => {
    const hit = firstHit(origin, dir, curve, "back", along)!;
    expect(hit.point.x).toBeCloseTo(r * Math.cos(Math.PI / 4), 9);
    expect([firstTurn, secondTurn].some((s) => Math.abs(hit.s - s) < 1e-6)).toBe(true);
  });

  it("`nearS` retient l'intersection la plus proche de l'abscisse attendue", () => {
    expect(firstHit(origin, dir, curve, "back", along, 0)!.s).toBeCloseTo(firstTurn, 6);
    expect(firstHit(origin, dir, curve, "back", along, 700)!.s).toBeCloseTo(secondTurn, 6);
  });

  it("`nearS` ne départage qu'à égalité de distance : l'intersection la plus proche prime", () => {
    // Côté opposé du cercle (t plus grand) : jamais retenu, quel que soit `nearS`.
    const hit = firstHit(origin, dir, curve, "back", along, 4 * Math.PI * r)!;
    expect(hit.point.x).toBeGreaterThan(0);
  });
});
