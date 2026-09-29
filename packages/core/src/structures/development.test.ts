import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nosingPitchLine } from "./development.js";

const nose = (s: number, z: number) => ({ sigmaInner: s, sigmaOuter: s, z });

describe("nosingPitchLine — ligne des nez des limons", () => {
  it("volée droite : polyligne des nez", () => {
    const line = nosingPitchLine(
      [nose(0, 180), nose(250, 360), nose(500, 540)],
      [
        { number: 1, kind: "straight" },
        { number: 2, kind: "straight" },
      ],
      "inner",
    );
    expect(line.xs).toEqual([0, 250, 500]);
    expect(line.at(125)).toBeCloseTo(270, 9);
  });

  it("palier : de niveau jusqu'à un giron avant le nez de sortie, puis montée sur un giron", () => {
    // Nez 1 (σ 250, z 360), palier jusqu'au nez 2 (σ 1 500, z 540), giron suivant 250.
    const line = nosingPitchLine(
      [nose(0, 180), nose(250, 360), nose(1500, 540), nose(1750, 720)],
      [
        { number: 1, kind: "straight" },
        { number: 2, kind: "landing" },
        { number: 3, kind: "straight" },
      ],
      "outer",
    );
    expect(line.xs).toEqual([0, 250, 1250, 1500, 1750]);
    expect(line.at(800)).toBe(360);
    expect(line.at(1250)).toBe(360);
    expect(line.at(1375)).toBeCloseTo(450, 9);
  });

  it("propriété : de niveau sur chaque palier, par les nez, croissante", () => {
    const arb = fc
      .array(
        fc.record({
          going: fc.integer({ min: 200, max: 350 }),
          landing: fc.boolean(),
          extra: fc.integer({ min: 0, max: 2000 }),
        }),
        { minLength: 2, maxLength: 12 },
      )
      .map((steps) => {
        const nosings = [nose(0, 0)];
        const treads: { number: number; kind: "straight" | "landing" }[] = [];
        steps.forEach((st, i) => {
          const prev = nosings[i]!;
          const len = st.going + (st.landing ? st.extra : 0);
          nosings.push(nose(prev.sigmaInner + len, prev.z + 175));
          treads.push({ number: i + 1, kind: st.landing ? "landing" : "straight" });
        });
        return { nosings, treads };
      });
    fc.assert(
      fc.property(arb, ({ nosings, treads }) => {
        const line = nosingPitchLine(nosings, treads, "inner");
        for (const k of nosings) expect(line.at(k.sigmaInner)).toBeCloseTo(k.z, 9);
        for (let i = 1; i < line.ys.length; i++) {
          expect(line.ys[i]!).toBeGreaterThanOrEqual(line.ys[i - 1]!);
        }
        for (const t of treads) {
          if (t.kind !== "landing") continue;
          const a = nosings[t.number - 1]!;
          const b = nosings[t.number]!;
          const after = nosings[t.number + 1];
          // Palier sous le nez d'arrivée : pas de giron suivant, pas de partie plate (une
          // marche verticale n'est pas représentable par la ligne des nez).
          if (!after) continue;
          const going = after.sigmaInner - b.sigmaInner;
          const flatEnd = Math.max(a.sigmaInner, b.sigmaInner - going);
          for (let j = 0; j <= 4; j++) {
            const x = a.sigmaInner + ((flatEnd - a.sigmaInner) * j) / 4;
            expect(line.at(x)).toBeCloseTo(a.z, 9);
          }
        }
      }),
    );
  });
});
