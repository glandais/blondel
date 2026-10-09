/**
 * Entraxes et pinces des organes de type tige dans le bois (`woodSpacing.ts`, QUESTIONS A34 (b)) :
 * valeurs des tableaux 8.4 (boulons) et 8.5 (broches) de l'EN 1995-1-1 rapportés par C §1.11
 * [71] (tableaux 10.4 et 10.5, p. 45 ; norme non lue), enveloppe « tous angles » retenue par
 * Blondel, résolution des réglages `bolts.*` du limon central bois.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FASTENER_PROFILE } from "../workshop/fasteners.js";
import {
  ec5AxialScrewSpacing,
  ec5EndDistance,
  ec5Spacing,
  footPinFloorDistance,
  lagHoleClearance,
  woodCentralBoltSpacing,
  type Ec5Spacing,
} from "./woodSpacing.js";

const DEG = Math.PI / 180;

/** Comparaison à 1e-9 près de toutes les grandeurs. */
function expectSpacing(actual: Ec5Spacing, expected: Ec5Spacing): void {
  for (const k of Object.keys(expected) as (keyof Ec5Spacing)[]) {
    expect(actual[k], k).toBeCloseTo(expected[k], 9);
  }
}

describe("ec5Spacing : boulons (EN 1995-1-1 tableau 8.4 via C §1.11 [71])", () => {
  const d = 12;
  const a3t = Math.max(7 * d, 80);

  it("α = 0° : effort parallèle au fil, extrémité chargée", () => {
    expectSpacing(ec5Spacing("bolt", d, 0), {
      a1: 5 * d,
      a2: 4 * d,
      a3t,
      a3c: a3t,
      a4t: 3 * d,
      a4c: 3 * d,
    });
  });

  it("α = 90° : effort perpendiculaire au fil, rive chargée", () => {
    expectSpacing(ec5Spacing("bolt", d, 90 * DEG), {
      a1: 4 * d,
      a2: 4 * d,
      a3t,
      a3c: 7 * d,
      a4t: 4 * d,
      a4c: 3 * d,
    });
  });

  it("α = 180° : extrémité non chargée (4·d)", () => {
    expectSpacing(ec5Spacing("bolt", d, 180 * DEG), {
      a1: 5 * d,
      a2: 4 * d,
      a3t,
      a3c: 4 * d,
      a4t: 3 * d,
      a4c: 3 * d,
    });
  });

  it("α = 270° : rive non chargée (a4,t ramené à 3·d)", () => {
    expectSpacing(ec5Spacing("bolt", d, 270 * DEG), {
      a1: 4 * d,
      a2: 4 * d,
      a3t,
      a3c: 7 * d,
      a4t: 3 * d,
      a4c: 3 * d,
    });
  });

  it("a3,t vaut 80 mm au moins (petits diamètres)", () => {
    expect(ec5Spacing("bolt", 8, 0).a3t).toBe(80);
    expect(ec5Spacing("bolt", 16, 0).a3t).toBe(112);
  });

  it("enveloppe sans angle : a1 = 5d, a2 = 4d, a3,c = 4d, a4,t = 4d, a4,c = 3d", () => {
    expectSpacing(ec5Spacing("bolt", 10), {
      a1: 50,
      a2: 40,
      a3t: 80,
      a3c: 40,
      a4t: 40,
      a4c: 30,
    });
  });
});

describe("ec5Spacing : broches (EN 1995-1-1 tableau 8.5 via C §1.11 [71])", () => {
  const d = 12;
  const a3t = Math.max(7 * d, 80);

  it("α = 0°", () => {
    expectSpacing(ec5Spacing("dowel", d, 0), {
      a1: 5 * d,
      a2: 3 * d,
      a3t,
      a3c: a3t,
      a4t: 3 * d,
      a4c: 3 * d,
    });
  });

  it("α = 90°", () => {
    expectSpacing(ec5Spacing("dowel", d, 90 * DEG), {
      a1: 3 * d,
      a2: 3 * d,
      a3t,
      a3c: a3t,
      a4t: 4 * d,
      a4c: 3 * d,
    });
  });

  it("α = 180° : extrémité non chargée max(3,5·d ; 40 mm)", () => {
    expectSpacing(ec5Spacing("dowel", d, 180 * DEG), {
      a1: 5 * d,
      a2: 3 * d,
      a3t,
      a3c: Math.max(3.5 * d, 40),
      a4t: 3 * d,
      a4c: 3 * d,
    });
    expect(ec5Spacing("dowel", 8, 180 * DEG).a3c).toBe(40);
  });

  it("α = 270°", () => {
    expectSpacing(ec5Spacing("dowel", d, 270 * DEG), {
      a1: 3 * d,
      a2: 3 * d,
      a3t,
      a3c: a3t,
      a4t: 3 * d,
      a4c: 3 * d,
    });
  });

  it("enveloppe sans angle (Ø12) : a1 = 60, a2 = 36, a3,t = 84, a3,c = 42, a4,t = 48, a4,c = 36", () => {
    expectSpacing(ec5Spacing("dowel", 12), {
      a1: 60,
      a2: 36,
      a3t: 84,
      a3c: 42,
      a4t: 48,
      a4c: 36,
    });
  });
});

describe("ec5Spacing : propriétés", () => {
  const typeArb = fc.constantFrom("bolt" as const, "dowel" as const);
  const dArb = fc.double({ min: 4, max: 30, noNaN: true });
  const alphaArb = fc.double({ min: -4 * Math.PI, max: 4 * Math.PI, noNaN: true });

  it("l'enveloppe sans angle majore a1, a2, a3,t, a4,t et a4,c à tout angle", () => {
    fc.assert(
      fc.property(typeArb, dArb, alphaArb, (type, d, alpha) => {
        const env = ec5Spacing(type, d);
        const at = ec5Spacing(type, d, alpha);
        for (const k of ["a1", "a2", "a3t", "a4t", "a4c"] as const) {
          expect(env[k]).toBeGreaterThanOrEqual(at[k] - 1e-9);
        }
      }),
    );
  });

  it("a3,c de l'enveloppe : extrémité non chargée la plus courante (α = 180°), à valider", () => {
    // Convention Blondel (en-tête de woodSpacing.ts) : a3,c n'est pas majoré sur tous les
    // angles (7·d à 90° pour un boulon) mais pris pour un effort dirigé vers l'intérieur.
    fc.assert(
      fc.property(typeArb, dArb, (type, d) => {
        expect(ec5Spacing(type, d).a3c).toBeCloseTo(ec5Spacing(type, d, Math.PI).a3c, 9);
      }),
    );
  });

  it("périodicité de 360° et grandeurs positives", () => {
    fc.assert(
      fc.property(typeArb, dArb, alphaArb, (type, d, alpha) => {
        const a = ec5Spacing(type, d, alpha);
        const b = ec5Spacing(type, d, alpha + 2 * Math.PI);
        for (const k of Object.keys(a) as (keyof Ec5Spacing)[]) {
          expect(a[k]).toBeGreaterThan(0);
          expect(b[k]).toBeCloseTo(a[k], 6);
        }
      }),
    );
  });
});

describe("woodCentralBoltSpacing", () => {
  const fasteners = DEFAULT_FASTENER_PROFILE;

  it("M10 dans un perçage de 11 mm : d = 10, a1 = 50, a3,c = 40", () => {
    const r = woodCentralBoltSpacing(
      { holeDiameter: 11, minSpacing: "auto", edgeDistance: "auto" },
      fasteners,
    );
    expect(r.d).toBe(10);
    expect(r.minSpacing).toBe(50);
    expect(r.edgeDistance).toBe(40);
    expectSpacing(r.ec5, ec5Spacing("bolt", 10));
  });

  it("M12 dans un perçage de 13 mm : d = 12", () => {
    const r = woodCentralBoltSpacing(
      { holeDiameter: 13, minSpacing: "auto", edgeDistance: "auto" },
      fasteners,
    );
    expect(r.d).toBe(12);
    expect(r.minSpacing).toBe(60);
    expect(r.edgeDistance).toBe(48);
  });

  it("valeurs saisies conservées", () => {
    const r = woodCentralBoltSpacing(
      { holeDiameter: 11, minSpacing: 35, edgeDistance: 22 },
      fasteners,
    );
    expect(r.minSpacing).toBe(35);
    expect(r.edgeDistance).toBe(22);
    expect(r.d).toBe(10);
  });

  it("série vide (ou perçage trop petit) : d = perçage − jeu", () => {
    const r = woodCentralBoltSpacing(
      { holeDiameter: 11, minSpacing: "auto", edgeDistance: "auto" },
      { nominalDiameters: [], holeClearance: 1 },
    );
    expect(r.d).toBe(10);
    expect(r.minSpacing).toBe(50);
    const small = woodCentralBoltSpacing(
      { holeDiameter: 2, minSpacing: "auto", edgeDistance: "auto" },
      { nominalDiameters: [10, 12], holeClearance: 1 },
    );
    expect(small.d).toBe(1);
  });
});

describe("convention de gravité (A35 (b), (e)) et vis chargées axialement (A35 (l))", () => {
  it("ec5EndDistance : a3,c (non chargée) et a3,t (chargée), boulon M10 et broche Ø12", () => {
    expect(ec5EndDistance("bolt", 10, "unloaded")).toBe(40);
    expect(ec5EndDistance("bolt", 10, "loaded")).toBe(80);
    expect(ec5EndDistance("dowel", 12, "unloaded")).toBe(42);
    expect(ec5EndDistance("dowel", 12, "loaded")).toBe(84);
  });

  it("ec5AxialScrewSpacing ([71] tableau 10.6) : 7d, 5d, 10d, 4d", () => {
    expect(ec5AxialScrewSpacing(10)).toEqual({ a1: 70, a2: 50, a1CG: 100, a2CG: 40 });
  });

  it("footPinFloorDistance : rive a4,t en couches empilées, a3,c sinon", () => {
    expect(footPinFloorDistance("stacked", 12)).toEqual({ distance: 48, kind: "a4t" });
    for (const m of ["solid", "straight", "mould"] as const) {
      expect(footPinFloorDistance(m, 12)).toEqual({ distance: 42, kind: "a3c" });
    }
    // Petit diamètre : a3,c d'une broche au moins 40 mm.
    expect(footPinFloorDistance("mould", 8).distance).toBe(40);
  });

  const auto = { holeDiameter: 11, minSpacing: "auto", edgeDistance: "auto" } as const;

  it("tire-fonds `auto` (M10) : entraxe 70, avant 100, arrière 40, faces 40", () => {
    const { lag } = woodCentralBoltSpacing(auto, DEFAULT_FASTENER_PROFILE);
    expect(lag).toMatchObject({
      minSpacing: 70,
      frontEndDistance: 100,
      rearEndDistance: 40,
      faceDistance: 40,
    });
  });

  it("tire-fonds saisis : entraxe et pince avant conservés ; arrière = pince des boulons", () => {
    const { lag } = woodCentralBoltSpacing(
      { ...auto, edgeDistance: 55 },
      DEFAULT_FASTENER_PROFILE,
      { minSpacing: 80, endDistance: 120 },
    );
    expect(lag).toMatchObject({
      minSpacing: 80,
      frontEndDistance: 120,
      rearEndDistance: 55,
      faceDistance: 40,
    });
  });

  it("propriété : en `auto`, les règles des tire-fonds majorent celles des boulons", () => {
    fc.assert(
      fc.property(fc.integer({ min: 7, max: 30 }), (hole) => {
        const sp = woodCentralBoltSpacing(
          { ...auto, holeDiameter: hole },
          DEFAULT_FASTENER_PROFILE,
        );
        expect(sp.lag.minSpacing).toBeGreaterThanOrEqual(sp.minSpacing);
        expect(sp.lag.frontEndDistance).toBeGreaterThanOrEqual(sp.edgeDistance);
        expect(sp.lag.rearEndDistance).toBe(sp.edgeDistance);
        expect(sp.lag.faceDistance).toBeGreaterThanOrEqual(sp.ec5.a4c);
        expect(sp.lag.minSpacing).toBeCloseTo(7 * sp.d, 9);
        expect(sp.lag.frontEndDistance).toBeCloseTo(10 * sp.d, 9);
        expect(sp.lag.faceDistance).toBeCloseTo(4 * sp.d, 9);
      }),
    );
  });
});

describe("lagHoleClearance : tire-fond vertical et perçage horizontal (relecture A35, A36 (10))", () => {
  it("jeu géométrique seulement : demi-somme des perçages + jeu, pointe à tipCover du perçage", () => {
    expect(lagHoleClearance(13, 11, 2, 10)).toEqual({ half: 14, above: 16.5 });
  });

  it("le tire-fond hors de la zone ne coupe jamais le perçage (propriété)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 30 }),
        fc.integer({ min: 6, max: 20 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 30 }),
        (hole, lag, c, tip) => {
          const g = lagHoleClearance(hole, lag, c, tip);
          // Axe du tire-fond à `half` du centre : sa paroi reste à c au moins du perçage.
          expect(g.half - lag / 2 - hole / 2).toBeGreaterThanOrEqual(c - 1e-9);
          // Pointe arrêtée à `above` du centre : à tip au moins au-dessus du perçage.
          expect(g.above - hole / 2).toBeGreaterThanOrEqual(tip - 1e-9);
        },
      ),
    );
  });
});
