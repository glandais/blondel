import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MaterialId, Part } from "../model/derived.js";
import { DEFAULT_WORKSHOP_PROFILE, materialDensity } from "../workshop/profile.js";
import { ensureMass, QUANTITY_MASS_KG, QUANTITY_VOLUME_M3, woodQuantities } from "./quantities.js";

const MATERIALS: readonly MaterialId[] = [
  "wood-oak",
  "wood-beech",
  "wood-ash",
  "wood-pine",
  "wood-glulam",
  "steel-raw",
  "steel-painted",
  "steel-galvanized",
  "stainless-brushed",
  "glass",
  "concrete",
];

const part = (material: MaterialId, quantities: Record<string, number>): Part => ({
  id: "p",
  mark: "P1",
  category: "infill",
  name: "Pièce",
  material,
  solid: { kind: "sweep", path: [], section: { outer: [], holes: [] } },
  quantities,
});

describe("masse de toutes les pièces (QUESTIONS A6)", () => {
  it("woodQuantities : masse = volume × masse volumique du matériau, quel qu'il soit", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MATERIALS),
        fc.double({ min: 1, max: 1e9, noNaN: true }),
        (m, v) => {
          const q = woodQuantities(
            { volumeMm3: v, surfaceMm2: 0, length: 0 },
            m,
            DEFAULT_WORKSHOP_PROFILE,
          );
          expect(q[QUANTITY_MASS_KG]).toBeCloseTo(
            (v / 1e9) * materialDensity(m, DEFAULT_WORKSHOP_PROFILE),
            9,
          );
        },
      ),
    );
  });

  it("ensureMass : complète une pièce qui a un volume, ne touche pas une masse existante", () => {
    const p = ensureMass(part("glass", { [QUANTITY_VOLUME_M3]: 0.01 }), DEFAULT_WORKSHOP_PROFILE);
    expect(p.quantities[QUANTITY_MASS_KG]).toBeCloseTo(25, 9);
    const legacy = ensureMass(part("steel-raw", { volume: 0.001 }), DEFAULT_WORKSHOP_PROFILE);
    expect(legacy.quantities[QUANTITY_MASS_KG]).toBeCloseTo(7.85, 9);
    const kept = part("wood-oak", { [QUANTITY_VOLUME_M3]: 1, [QUANTITY_MASS_KG]: 3 });
    expect(ensureMass(kept, DEFAULT_WORKSHOP_PROFILE)).toBe(kept);
    const none = part("wood-oak", {});
    expect(ensureMass(none, DEFAULT_WORKSHOP_PROFILE)).toBe(none);
  });
});
