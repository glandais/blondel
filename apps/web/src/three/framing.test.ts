import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEMO_TARGET_HEIGHT, DEMO_VIEW, flatteringView } from "./framing.js";

const box = {
  min: { x: -2000, y: 0, z: 0 },
  max: { x: 900, y: 3000, z: 2700 },
};

describe("cadrage de démo", () => {
  it("vise le centre de la boîte (repère three.js), caméra devant, au-dessus et de côté", () => {
    const { target, position } = flatteringView(box, { fovDeg: 40, aspect: 16 / 9 });
    expect(target[0]).toBeCloseTo(-0.55, 6);
    expect(target[1]).toBeCloseTo(2.7 * DEMO_TARGET_HEIGHT, 6);
    expect(target[2]).toBeCloseTo(-1.5, 6);
    expect(position[1]).toBeGreaterThan(target[1]); // plongée
    expect(position[2]).toBeGreaterThan(target[2]); // devant le départ (−y du cœur)
    expect(position[0]).toBeGreaterThan(target[0]); // trois quarts (azimut > 0)
    const d = position.map((p, i) => p - target[i]!);
    const elevation = Math.asin(d[1]! / Math.hypot(...d)) / (Math.PI / 180);
    expect(elevation).toBeCloseTo(DEMO_VIEW.elevationDeg, 6);
  });

  it("toute la sphère englobante tient dans le champ, quels que soient la boîte et le format", () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -5000, max: 5000, noNaN: true }),
          y: fc.double({ min: -5000, max: 5000, noNaN: true }),
          dx: fc.double({ min: 10, max: 8000, noNaN: true }),
          dy: fc.double({ min: 10, max: 8000, noNaN: true }),
          dz: fc.double({ min: 10, max: 6000, noNaN: true }),
          aspect: fc.double({ min: 0.3, max: 4, noNaN: true }),
        }),
        ({ x, y, dx, dy, dz, aspect }) => {
          const b = { min: { x, y, z: 0 }, max: { x: x + dx, y: y + dy, z: dz } };
          const { target, position } = flatteringView(b, { fovDeg: 40, aspect });
          const dist = Math.hypot(...position.map((p, i) => p - target[i]!));
          // Chaque coin de la boîte est vu sous un angle ≤ au demi-champ le plus petit.
          const half = Math.min(
            20,
            (Math.atan(Math.tan((20 * Math.PI) / 180) * aspect) * 180) / Math.PI,
          );
          const axis = target.map((t, i) => (t - position[i]!) / dist);
          for (const cx of [x, x + dx])
            for (const cy of [y, y + dy])
              for (const cz of [0, dz]) {
                const c = [cx / 1000, cz / 1000, -cy / 1000];
                const v = c.map((q, i) => q - position[i]!);
                const cos = v.reduce((a, q, i) => a + q * axis[i]!, 0) / Math.hypot(...v);
                expect((Math.acos(Math.min(1, cos)) * 180) / Math.PI).toBeLessThanOrEqual(
                  half + 1e-6,
                );
              }
          for (const v of [...target, ...position]) expect(Number.isFinite(v)).toBe(true);
        },
      ),
    );
  });
});
