import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CAGE_FEATURES, cageFeatures, type CageFeature } from "./cageFeatures.js";
import { CageLayoutSpecSchema, type CageLayoutSpecInput } from "./project.js";

const straight = (
  length: number,
  width = 900,
  widthEnd?: number,
): CageLayoutSpecInput["sections"][number] => ({
  axis: { kind: "straight", length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

function features(input: CageLayoutSpecInput): CageFeature[] {
  return cageFeatures(CageLayoutSpecSchema.parse(input));
}

describe("cageFeatures", () => {
  it("cage équivalente à des volées (droit, quart tournant, U à poteau, palier d'angle) : []", () => {
    expect(features({ kind: "cage", sections: [straight(3000)], junctions: [] })).toEqual([]);
    expect(
      features({
        kind: "cage",
        sections: [straight(2400), straight(1200)],
        junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 100 } }],
      }),
    ).toEqual([]);
    expect(
      features({
        kind: "cage",
        sections: [straight(2400), straight(1900), straight(1500)],
        junctions: [
          { angle: -90, mode: "landing", well: { kind: "newel", size: 100 } },
          { angle: -90, mode: "winders" },
        ],
      }),
    ).toEqual([]);
    // widthEnd égal à width : pas de largeur variable.
    expect(features({ kind: "cage", sections: [straight(3000, 900, 900)], junctions: [] })).toEqual(
      [],
    );
  });

  it.each<[string, CageLayoutSpecInput, CageFeature[]]>([
    [
      "angle de 60°",
      {
        kind: "cage",
        sections: [straight(2000), straight(2000)],
        junctions: [{ angle: 60, mode: "winders" }],
      },
      ["anyAngle"],
    ],
    [
      "trapèze",
      { kind: "cage", sections: [straight(3000, 900, 1100)], junctions: [] },
      ["variableWidth"],
    ],
    [
      "largeurs différentes d'un tronçon à l'autre",
      {
        kind: "cage",
        sections: [straight(2000, 900), straight(2000, 1000)],
        junctions: [{ angle: 90, mode: "landing" }],
      },
      ["variableWidth"],
    ],
    [
      "axe en arc",
      {
        kind: "cage",
        sections: [straight(2000), { axis: { kind: "arc", radius: 1500, sweep: 90 }, width: 900 }],
        junctions: [{ angle: 0, mode: "landing" }],
      },
      ["arcAxis", "straightLanding"],
    ],
    [
      "palier droit",
      {
        kind: "cage",
        sections: [straight(2000), straight(2000)],
        junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
      },
      ["straightLanding"],
    ],
    [
      "mur en arc",
      {
        kind: "cage",
        sections: [straight(2000), straight(2000)],
        junctions: [{ angle: 90, mode: "winders", wall: { kind: "arc", radius: 600 } }],
      },
      ["wallArc"],
    ],
    [
      "pan coupé",
      {
        kind: "cage",
        sections: [straight(2000), straight(2000)],
        junctions: [
          {
            angle: -90,
            mode: "winders",
            well: { kind: "chamfer", setbackIn: 100, setbackOut: 150 },
          },
        ],
      },
      ["chamfer"],
    ],
    [
      "rayonnant",
      {
        kind: "cage",
        sections: [straight(2000), straight(2000)],
        junctions: [{ angle: 90, mode: "radiating" }],
      },
      ["radiating"],
    ],
    [
      "S / Z, même séparé par un palier droit",
      {
        kind: "cage",
        sections: [straight(2000), straight(2000), straight(2000), straight(2000)],
        junctions: [
          { angle: 90, mode: "winders" },
          { angle: 0, mode: "landing" },
          { angle: -90, mode: "winders" },
        ],
      },
      ["straightLanding", "oppositeTurns"],
    ],
    [
      "toutes les fonctions",
      {
        kind: "cage",
        sections: [
          straight(2000, 900, 1000),
          { axis: { kind: "arc", radius: 1500, sweep: -30 }, width: 900 },
          straight(2000),
          straight(2000),
        ],
        junctions: [
          {
            angle: 45,
            mode: "radiating",
            well: { kind: "chamfer", setbackIn: 50, setbackOut: 50 },
          },
          { angle: 0, mode: "landing" },
          { angle: -90, mode: "winders", wall: { kind: "arc", radius: 300 } },
        ],
      },
      [...CAGE_FEATURES],
    ],
  ])("%s", (_name, input, expected) => {
    expect(features(input)).toEqual(expected);
  });

  it("propriété : sous-ensemble ordonné de CAGE_FEATURES, sans doublon", () => {
    const arb = fc.integer({ min: 1, max: 6 }).chain((n) =>
      fc.record({
        sections: fc.array(
          fc.record({
            width: fc.integer({ min: 700, max: 1200 }),
            length: fc.integer({ min: 0, max: 4000 }),
          }),
          { minLength: n, maxLength: n },
        ),
        angles: fc.array(fc.constantFrom(0, 90, -90, 30, -150), {
          minLength: n - 1,
          maxLength: n - 1,
        }),
      }),
    );
    fc.assert(
      fc.property(arb, ({ sections, angles }) => {
        const f = features({
          kind: "cage",
          sections: sections.map((s) => straight(s.length, s.width)),
          junctions: angles.map((angle) => ({ angle, mode: angle === 0 ? "landing" : "winders" })),
        });
        expect(f).toEqual(CAGE_FEATURES.filter((x) => f.includes(x)));
        expect(f.includes("anyAngle")).toBe(angles.some((a) => a !== 0 && Math.abs(a) !== 90));
        expect(f.includes("straightLanding")).toBe(angles.includes(0));
      }),
      { numRuns: 100 },
    );
  });
});
