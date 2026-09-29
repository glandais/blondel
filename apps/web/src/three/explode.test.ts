import type { PartCategory } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EXPLODE_DISTANCE, EXPLODE_FACTORS, explodeOffsets } from "./explode.js";

const CATEGORIES = Object.keys(EXPLODE_FACTORS) as PartCategory[];
const coord = fc.double({ min: -5000, max: 5000, noNaN: true });

describe("vue éclatée", () => {
  it("propriété : 0 = assemblé ; déplacement proportionnel au curseur, borné, radial horizontal", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORIES),
        coord,
        coord,
        coord,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (category, x, y, z, amount) => {
          const center = { x: 0, y: 0, z: 0 };
          const parts = [{ partId: "p", category, center: { x, y, z } }];
          expect(explodeOffsets(parts, center, 0).get("p")).toEqual({ x: 0, y: 0, z: 0 });
          const o = explodeOffsets(parts, center, amount).get("p")!;
          const f = EXPLODE_FACTORS[category];
          expect(o.z).toBeCloseTo(f.up * amount * EXPLODE_DISTANCE, 6);
          const h = Math.hypot(o.x, o.y);
          if (Math.hypot(x, y) > 1e-3) {
            expect(h).toBeCloseTo(f.out * amount * EXPLODE_DISTANCE, 6);
            // Vers l'extérieur : même sens que (pièce − centre).
            if (h > 1e-9) expect(o.x * x + o.y * y).toBeGreaterThan(0);
          }
          // Curseur hors bornes : ramené dans [0, 1].
          expect(explodeOffsets(parts, center, 7).get("p")).toEqual(
            explodeOffsets(parts, center, 1).get("p"),
          );
        },
      ),
    );
  });

  it("limons d'un escalier droit : s'écartent de part et d'autre ; marches : montent", () => {
    const center = { x: 0, y: 1500, z: 1400 };
    const o = explodeOffsets(
      [
        { partId: "li", category: "stringer", center: { x: -450, y: 1500, z: 1400 } },
        { partId: "le", category: "stringer", center: { x: 450, y: 1500, z: 1400 } },
        { partId: "m1", category: "tread", center: { x: 0, y: 200, z: 180 } },
      ],
      center,
      1,
    );
    expect(o.get("li")!.x).toBeLessThan(0);
    expect(o.get("le")!.x).toBeGreaterThan(0);
    expect(o.get("m1")).toEqual({ x: 0, y: 0, z: EXPLODE_DISTANCE });
  });
});
