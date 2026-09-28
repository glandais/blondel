/** Générateurs fast-check partagés par les tests de geom2d (non exporté par le paquet). */
import fc from "fast-check";
import type { Vec2 } from "../model/primitives.js";

/**
 * Polyligne x-monotone : caps absolus dans ]−70°, 70°[, segments de 1 200 à 3 000 mm.
 * Deux segments non adjacents restent éloignés (> 400 mm), ce qui rend les décalés
 * sans auto-intersection globale pour d ≤ 150 mm.
 */
export const monotonePolyline = (maxPts = 6): fc.Arbitrary<Vec2[]> =>
  fc
    .record({
      x0: fc.double({ min: -5000, max: 5000, noNaN: true }),
      y0: fc.double({ min: -5000, max: 5000, noNaN: true }),
      legs: fc.array(
        fc.record({
          heading: fc.double({ min: -70, max: 70, noNaN: true }),
          len: fc.double({ min: 1200, max: 3000, noNaN: true }),
        }),
        { minLength: 1, maxLength: maxPts - 1 },
      ),
    })
    .map(({ x0, y0, legs }) => {
      const pts: Vec2[] = [{ x: x0, y: y0 }];
      let p = pts[0]!;
      for (const l of legs) {
        const a = (l.heading * Math.PI) / 180;
        p = { x: p.x + l.len * Math.cos(a), y: p.y + l.len * Math.sin(a) };
        pts.push(p);
      }
      return pts;
    });
