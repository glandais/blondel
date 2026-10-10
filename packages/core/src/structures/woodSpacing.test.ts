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
  grainDirection,
  grainEndDistance,
  isBeamEndSide,
  lagAnchorageHolds,
  lagHoleClearance,
  lagRetained,
  lagSeatClearance,
  lagThreadInBeam,
  lagThreadLength,
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
    expect(ec5AxialScrewSpacing(10)).toEqual({
      a1: 70,
      a2: 50,
      a1CG: 100,
      a2CG: 40,
      penetration: 60,
    });
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

  it("tire-fonds `auto` (M10) : entraxe 70, avant 40 (a3,c), arrière 40, faces 40, a1,CG 100 (A36 (4))", () => {
    const { lag } = woodCentralBoltSpacing(auto, DEFAULT_FASTENER_PROFILE);
    expect(lag).toMatchObject({
      minSpacing: 70,
      frontEndDistance: 40,
      rearEndDistance: 40,
      faceDistance: 40,
      threadEndDistance: 100,
    });
    // Perçage de 13 : M12, pince latérale 48 mm, a1,CG 120 mm.
    const m12 = woodCentralBoltSpacing({ ...auto, holeDiameter: 13 }, DEFAULT_FASTENER_PROFILE);
    expect(m12.lag.frontEndDistance).toBe(48);
    expect(m12.lag.threadEndDistance).toBe(120);
  });

  it("a1,CG saisie : conservée ; absente ou `auto` : 10·d", () => {
    const set = woodCentralBoltSpacing(auto, DEFAULT_FASTENER_PROFILE, {
      minSpacing: "auto",
      endDistance: "auto",
      threadEndDistance: 80,
    });
    expect(set.lag.threadEndDistance).toBe(80);
    const a = woodCentralBoltSpacing(auto, DEFAULT_FASTENER_PROFILE, {
      minSpacing: "auto",
      endDistance: "auto",
      threadEndDistance: "auto",
    });
    expect(a.lag.threadEndDistance).toBe(100);
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
        // Pince latérale a3,c au bout avant (A36 (4)) ; a1,CG mesurée à part, le long du fil.
        expect(sp.lag.frontEndDistance).toBeCloseTo(4 * sp.d, 9);
        expect(sp.lag.threadEndDistance).toBeCloseTo(10 * sp.d, 9);
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

describe("lagHoleClearance avec le bois entre filet et perçage (A37 (17))", () => {
  it("bois de 0,5·d : boulon M12 du sabot (Ø13), tire-fond Ø10 dans un passage de 11", () => {
    // Jeu géométrique 13 mm (12 + 1) ; bois : 6,5 + 5 + 5 = 16,5 mm ; pointe : max(10 ; 5).
    expect(lagHoleClearance(13, 11, 1, 10, { d: 10, thickness: 5 })).toEqual({
      half: 16.5,
      above: 16.5,
    });
    // Bois nul : jeu géométrique seul.
    expect(lagHoleClearance(13, 11, 1, 10, { d: 10, thickness: 0 })).toEqual(
      lagHoleClearance(13, 11, 1, 10),
    );
    // Bois plus épais que le bois sous la pointe : la pointe s'arrête plus haut.
    expect(lagHoleClearance(13, 11, 1, 10, { d: 10, thickness: 12 }).above).toBe(6.5 + 12);
  });

  it("propriété : avec le bois, zone ≥ sans bois ; filet à `thickness` du perçage au moins", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 30 }),
        fc.integer({ min: 6, max: 20 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 6, max: 16 }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (hole, lagHole, c, tip, d, thickness) => {
          const bare = lagHoleClearance(hole, lagHole, c, tip);
          const g = lagHoleClearance(hole, lagHole, c, tip, { d, thickness });
          expect(g.half).toBeGreaterThanOrEqual(bare.half - 1e-9);
          expect(g.above).toBeGreaterThanOrEqual(bare.above - 1e-9);
          // Axe à `half` du centre : filet (Ø d) à `thickness` au moins du bord du perçage.
          expect(g.half - d / 2 - hole / 2).toBeGreaterThanOrEqual(thickness - 1e-9);
          expect(g.above - hole / 2).toBeGreaterThanOrEqual(Math.max(tip, thickness) - 1e-9);
        },
      ),
    );
  });
});

describe("lagThreadLength : longueur filetée des tire-fonds DIN 571 (A37 (5), C §1.11 [78])", () => {
  it("redonne les longueurs filetées des fiches Faynot Ø10 et Ø12", () => {
    const faynot: [number, number][] = [
      [60, 40],
      [70, 43],
      [80, 46],
      [100, 53],
      [120, 60],
      [140, 66],
      [160, 73],
      [90, 50],
      [180, 80],
      [200, 86],
      [220, 93],
    ];
    for (const [L, b] of faynot) expect(lagThreadLength(L), `L = ${L}`).toBe(b);
  });

  it("valeur saisie : même longueur filetée pour toutes les longueurs, bornée à L", () => {
    expect(lagThreadLength(140, 70)).toBe(70);
    expect(lagThreadLength(60, 70)).toBe(60);
    expect(lagThreadLength(0)).toBe(0);
  });

  it("propriété : 0 ≤ b ≤ L, croissante avec L", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 0, max: 100 }),
        fc.oneof(fc.constant("auto" as const), fc.integer({ min: 1, max: 300 })),
        (L, dL, entered) => {
          const b = lagThreadLength(L, entered);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(L);
          expect(lagThreadLength(L + dL, entered)).toBeGreaterThanOrEqual(b);
        },
      ),
    );
  });
});

describe("tire-fonds : ancrage minimal, partie filetée et place sous une assise (A37 (1) (5))", () => {
  const fasteners = DEFAULT_FASTENER_PROFILE;
  const bolts = { holeDiameter: 11, minSpacing: "auto" as const, edgeDistance: "auto" as const };
  const lagSpacing = (lag: {
    minAnchorage?: number | "auto";
    threadLength?: number | "auto";
    holeWood?: number | "auto";
  }) =>
    woodCentralBoltSpacing(bolts, fasteners, {
      minSpacing: "auto",
      endDistance: "auto",
      ...lag,
    }).lag;

  it("résolution : `auto` → 6·d et 0,5·d ; valeurs saisies gardées", () => {
    const auto = lagSpacing({});
    expect(auto.minAnchorage).toBe(60);
    expect(auto.minAnchorageAuto).toBe(true);
    expect(auto.holeWood).toBe(5);
    expect(auto.threadLengthOf(140)).toBe(66);
    const m12 = woodCentralBoltSpacing({ ...bolts, holeDiameter: 13 }, fasteners, {
      minSpacing: "auto",
      endDistance: "auto",
      minAnchorage: "auto",
      holeWood: "auto",
    }).lag;
    expect(m12.minAnchorage).toBe(72);
    expect(m12.holeWood).toBe(6);
    const set = lagSpacing({ minAnchorage: 50, threadLength: 70, holeWood: 2 });
    expect(set.minAnchorage).toBe(50);
    expect(set.minAnchorageAuto).toBe(false);
    expect(set.holeWood).toBe(2);
    expect(set.threadLengthOf(140)).toBe(70);
    expect(set.threadLengthOf(60)).toBe(60);
  });

  it("partie filetée dans la poutre : pénétration min(b ; ancrage), centre de gravité à ancrage − p / 2", () => {
    // 140 mm sous une marche de 80 : ancrage 60, b = 66 → p = 60, CG à 30 mm sous l'assise.
    expect(lagThreadInBeam(140, 60, lagThreadLength)).toEqual({ penetration: 60, cgDepth: 30 });
    // 160 mm sous une marche de 40 : ancrage 120, b = 73 → CG à 120 − 36,5 = 83,5 mm.
    expect(lagThreadInBeam(160, 120, lagThreadLength)).toEqual({
      penetration: 73,
      cgDepth: 83.5,
    });
  });

  it("rétention : pénétration filetée ≥ 6·d en `auto`, ancrage ≥ valeur saisie sinon", () => {
    const auto = lagSpacing({});
    // Marche de 80 : 130 mm → p = 50 refusé ; 140 → 60 admis.
    expect(lagAnchorageHolds(auto, 130, 80)).toBe(false);
    expect(lagRetained(auto, 130, 80)).toBe(50);
    expect(lagAnchorageHolds(auto, 140, 80)).toBe(true);
    // Marche de 40 : 110 mm → b = 56 < 60 refusé malgré 70 mm d'ancrage ; 120 → 60 admis.
    expect(lagAnchorageHolds(auto, 110, 40)).toBe(false);
    expect(lagAnchorageHolds(auto, 120, 40)).toBe(true);
    const set = lagSpacing({ minAnchorage: 50 });
    expect(lagAnchorageHolds(set, 130, 80)).toBe(true);
    expect(lagRetained(set, 130, 80)).toBe(50);
    expect(lagAnchorageHolds(set, 120, 80)).toBe(false);
  });

  it("place sous une assise : plus court tire-fond admissible + bois sous la pointe", () => {
    const options = { lengthStep: 10, maxLength: 160, tipCover: 10 };
    // `auto`, marche de 40 : 120 mm (ancrage 80) → 90 ; marche de 80 : 140 mm (ancrage 60) → 70.
    expect(lagSeatClearance(lagSpacing({}), { ...options, tm: 40 })).toBe(90);
    expect(lagSeatClearance(lagSpacing({}), { ...options, tm: 80 })).toBe(70);
    // Valeur saisie : ancrage minimal arrondi au pas (comportement antérieur) : 90 − 40 + 10.
    expect(lagSeatClearance(lagSpacing({ minAnchorage: 50 }), { ...options, tm: 40 })).toBe(60);
    // Aucun tire-fond admissible jusqu'à `maxLength` : repli sur l'ancrage minimal arrondi.
    expect(lagSeatClearance(lagSpacing({}), { ...options, tm: 40, maxLength: 100 })).toBe(70);
  });

  it("propriété : la place retenue est celle du plus court tire-fond admissible de la grille", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 100 }),
        fc.constantFrom(5, 10, 20),
        fc.integer({ min: 0, max: 30 }),
        fc.oneof(fc.constant("auto" as const), fc.integer({ min: 30, max: 120 })),
        (tm, step, tipCover, threadLength) => {
          const lag = lagSpacing({ threadLength });
          const maxLength = 300;
          const clearance = lagSeatClearance(lag, { tm, lengthStep: step, maxLength, tipCover });
          const L = clearance - tipCover + tm;
          if (L > maxLength) return;
          if (!lagAnchorageHolds(lag, L, tm)) {
            // Repli : aucune longueur admissible jusqu'à maxLength.
            for (let x = step; x <= maxLength; x += step)
              expect(lagAnchorageHolds(lag, x, tm)).toBe(false);
            return;
          }
          expect(Math.abs(L / step - Math.round(L / step))).toBeLessThan(1e-9);
          if (L - step >= tm) expect(lagAnchorageHolds(lag, L - step, tm)).toBe(false);
        },
      ),
    );
  });
});

describe("grainEndDistance : distance le long du fil à la plus proche surface de bout (A36 (4))", () => {
  /** Poutre droite développée : face avant à x = 0, coupe au sol à y = 0, assise à y = 100. */
  const step = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 200, y: 300 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];
  const along = (p: { x: number; y: number }, slope: number, method = "straight" as const) =>
    grainEndDistance(p, grainDirection(method, slope), step, isBeamEndSide);

  it("fil horizontal : distance à la face avant ou à la face de cran, la plus courte", () => {
    // Couches empilées : rayon horizontal ; la coupe au sol (parallèle) n'est jamais atteinte.
    const dir = grainDirection("stacked", 1);
    expect(dir).toEqual({ x: 1, y: 0 });
    expect(grainEndDistance({ x: 50, y: 50 }, dir, step, isBeamEndSide)).toBeCloseTo(50, 9);
    expect(grainEndDistance({ x: 150, y: 50 }, dir, step, isBeamEndSide)).toBeCloseTo(150, 9);
    // Au-dessus de l'assise (y = 200) : face de cran verticale à x = 200 devant, face de bout
    // à x = 400 derrière.
    expect(grainEndDistance({ x: 250, y: 200 }, dir, step, isBeamEndSide)).toBeCloseTo(50, 9);
  });

  it("fil à 45° : coupe au sol comptée, dessus d'assise non compté", () => {
    // Depuis (100, 50) : vers le bas à gauche, coupe au sol (y = 0) à 50·√2 ; vers le haut à
    // droite, dessus de l'assise (pas une surface de bout).
    expect(along({ x: 100, y: 50 }, 1)).toBeCloseTo(50 * Math.SQRT2, 9);
    // Depuis (30, 50) : la face avant (x = 0) est atteinte d'abord, à 30·√2.
    expect(along({ x: 30, y: 50 }, 1)).toBeCloseTo(30 * Math.SQRT2, 9);
    // Sur le développé d'une marche plus haute : la face de cran x = 200 vers le bas à gauche.
    expect(along({ x: 250, y: 250 }, 1)).toBeCloseTo(50 * Math.SQRT2, 9);
  });

  it("plafond d'une entaille (bois au-dessus) compté, dessus d'assise (bois au-dessous) non compté", () => {
    // Contour en sens trigonométrique : côté horizontal parcouru vers +x = bois au-dessus.
    expect(isBeamEndSide({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(true);
    expect(isBeamEndSide({ x: 10, y: 5 }, { x: 0, y: 5 })).toBe(false);
    expect(isBeamEndSide({ x: 3, y: 0 }, { x: 3, y: 10 })).toBe(true);
    expect(isBeamEndSide({ x: 0, y: 0 }, { x: 10, y: 4 })).toBe(false);
  });

  it("aucune surface de bout rencontrée : Infinity ; direction nulle : Infinity", () => {
    const flat = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: 0, y: 10 },
    ];
    // Prédicat sans surface de bout.
    expect(grainEndDistance({ x: 50, y: 5 }, { x: 1, y: 0 }, flat, () => false)).toBe(Infinity);
    expect(grainEndDistance({ x: 50, y: 5 }, { x: 0, y: 0 }, flat, isBeamEndSide)).toBe(Infinity);
  });

  it("propriété : distance = min des deux sens, invariante par translation et par le sens de dir", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 395, noNaN: true }),
        fc.double({ min: 5, max: 95, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (x, y, slope, shift) => {
          const dir = grainDirection("straight", slope);
          const d = grainEndDistance({ x, y }, dir, step, isBeamEndSide);
          const back = grainEndDistance({ x, y }, { x: -dir.x, y: -dir.y }, step, isBeamEndSide);
          expect(back).toBeCloseTo(d, 6);
          const moved = step.map((p) => ({ x: p.x + shift, y: p.y }));
          const dm = grainEndDistance({ x: x + shift, y }, dir, moved, isBeamEndSide);
          if (Number.isFinite(d)) expect(dm).toBeCloseTo(d, 6);
          else expect(dm).toBe(Infinity);
          // Sous l'assise basse, le rayon vers le bas atteint toujours la face avant ou la coupe
          // au sol : la distance est finie et au plus celle à la coupe au sol (y / sin α).
          const sin = dir.y;
          if (sin > 1e-6) expect(d).toBeLessThanOrEqual(y / sin + 1e-6);
          expect(d).toBeLessThanOrEqual(x / dir.x + 1e-6);
        },
      ),
    );
  });
});
