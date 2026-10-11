/**
 * Moteur de cage, sous-lot 1b (ADR-0010) : repères exacts, conversion volées ↔ cage, tronçons
 * (`Layout.sections`), refus clairs des fonctions du sous-lot 2b (angles quelconques et raccords
 * du sous-lot 2a : `junction.test.ts`, `free.property.test.ts`). La parité avec le moteur à volées
 * est dans `parity.test.ts`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageError, msg, type Message, type MessageKey } from "@blondel/i18n";
import { curveLength } from "../../geom2d/curve.js";
import * as V from "../../geom2d/vec.js";
import type { Layout } from "../../model/derived.js";
import { cageFeatures } from "../../model/cageFeatures.js";
import {
  CAGE_MAX_SECTIONS,
  CageLayoutSpecSchema,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type FlightsLayoutSpec,
  type InnerCorner,
  type Project,
} from "../../model/project.js";
import { computeCageLayout } from "./cage.js";
import {
  isExactAngle,
  junctionSweep,
  rotateBasis,
  START_BASIS,
  tanHalf,
  type Basis,
} from "./frames.js";
import { cageToFlights, checkFlightsTopology, flightsToCage } from "./fromFlights.js";

/** Projet à cage minimal (repère monde = repère local). */
function cageProject(layout: CageLayoutSpecInput): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: { placement: { origin: { x: 0, y: 0 } }, layout },
  });
}

const cageOf = (p: Project): CageLayoutSpec => p.stair.layout as CageLayoutSpec;

function errorKey(run: () => unknown): MessageKey | undefined {
  return errorMsg(run)?.key as MessageKey | undefined;
}

function errorMsg(run: () => unknown): Message | undefined {
  try {
    run();
  } catch (e) {
    if (e instanceof MessageError) return e.msg;
    throw e;
  }
  return undefined;
}

/** Tracé d'une cage saisie (vocabulaire `layout.cage.*`). */
function nativeLayout(spec: CageLayoutSpecInput): Layout {
  const project = cageProject(spec);
  return computeCageLayout(project, cageOf(project));
}

/** Retrait de Γ de part et d'autre du coin K (rayon d'un jour en arc, 0 sinon). */
const walkSetbackOf = (well: InnerCorner): number => (well.kind === "arc" ? well.radius : 0);

/** Retrait du bord du jour de part et d'autre de K (arc : rayon ; poteau : a/2 + δ). */
const wellSetbackOf = (well: InnerCorner): number =>
  well.kind === "arc"
    ? well.radius
    : well.kind === "newel"
      ? well.size / 2 + (well.offset ?? 0)
      : 0;

const QUARTER: CageLayoutSpecInput = {
  kind: "cage",
  sections: [
    { axis: { kind: "straight", length: 1000 }, width: 1000 },
    { axis: { kind: "straight", length: 500 }, width: 1000 },
  ],
  junctions: [{ angle: 90, mode: "winders" }],
};

describe("repères (frames.ts)", () => {
  const turn = (b: Basis, angle: number): Basis => rotateBasis(b, angle);

  it("rotations exactes : quatre quarts de tour reviennent au départ, ±90° inverses", () => {
    let b = START_BASIS;
    for (let k = 0; k < 4; k++) b = turn(b, 90);
    // Composantes exactes (au signe de zéro près, que la parité reproduit à l'identique).
    const plain = (v: { x: number; y: number }) => [v.x + 0, v.y + 0];
    expect([plain(b.u), plain(b.r)]).toEqual([plain(START_BASIS.u), plain(START_BASIS.r)]);
    const back = turn(turn(START_BASIS, 90), -90);
    expect([plain(back.u), plain(back.r)]).toEqual([plain(START_BASIS.u), plain(START_BASIS.r)]);
    expect(turn(START_BASIS, 90)).toEqual({ u: V.vec(-1, -0), r: V.vec(0, 1) });
    expect(turn(START_BASIS, -90)).toEqual({ u: V.vec(1, 0), r: V.vec(-0, -1) });
    expect(rotateBasis(START_BASIS, 0)).toBe(START_BASIS);
  });

  it("autres angles : rotation trigonométrique ; tan(θ/2) et balayage exacts à 0 et ±90°", () => {
    const b = rotateBasis(START_BASIS, 45);
    expect(b.u.x).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(b.u.y).toBeCloseTo(Math.SQRT1_2, 12);
    expect(b.r.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(b.r.y).toBeCloseTo(Math.SQRT1_2, 12);
    expect(isExactAngle(90)).toBe(true);
    expect(isExactAngle(-90)).toBe(true);
    expect(isExactAngle(0)).toBe(true);
    expect(isExactAngle(135)).toBe(false);
    // Math.tan(π/4) vaut 0,9999999999999999 : la branche exacte garde la parité.
    expect(tanHalf(90)).toBe(1);
    expect(tanHalf(-90)).toBe(1);
    expect(tanHalf(0)).toBe(0);
    expect(tanHalf(60)).toBeCloseTo(Math.tan(Math.PI / 6), 15);
    expect(junctionSweep(90)).toBe(Math.PI / 2);
    expect(junctionSweep(-90)).toBe(-Math.PI / 2);
    expect(junctionSweep(-30)).toBeCloseTo(-Math.PI / 6, 15);
  });
});

describe("conversion volées ↔ cage (fromFlights.ts)", () => {
  const quarter: FlightsLayoutSpec = {
    width: 900,
    legs: [{ length: 2000 }, { length: 1500 }],
    turns: [{ direction: "left", mode: "winders", inner: { kind: "sharp" } }],
  };

  it("longueur d'un tronçon : partie droite hors carrés d'angle (L − k·E)", () => {
    const cage = flightsToCage(quarter, [2000, 1500]);
    expect(cage.sections.map((s) => s.axis)).toEqual([
      { kind: "straight", length: 1100 },
      { kind: "straight", length: 600 },
    ]);
    expect(cage.junctions).toEqual([
      { angle: 90, mode: "winders", well: { kind: "sharp" }, wall: { kind: "sharp" } },
    ]);
    expect(cage.width).toBe(900);
    expect(cageFeatures(cage)).toEqual([]);
    // La cage produite est une entrée valide du schéma (relue à l'identique).
    expect(CageLayoutSpecSchema.parse(cage)).toEqual(cage);
  });

  it("U à demi-palier nul : tronçon intermédiaire de longueur 0 ; S : tournants opposés", () => {
    const u = flightsToCage(
      {
        width: 800,
        turns: [
          { direction: "right", mode: "landing", inner: { kind: "sharp" } },
          { direction: "right", mode: "winders", inner: { kind: "sharp" } },
        ],
      },
      [1800, 1600, 1800],
    );
    expect(u.sections.map((s) => s.axis)).toEqual([
      { kind: "straight", length: 1000 },
      { kind: "straight", length: 0 },
      { kind: "straight", length: 1000 },
    ]);
    expect(u.junctions.map((j) => j.angle)).toEqual([-90, -90]);
    const s = flightsToCage(
      {
        width: 800,
        turns: [
          { direction: "left", mode: "winders", inner: { kind: "sharp" } },
          { direction: "right", mode: "winders", inner: { kind: "sharp" } },
        ],
      },
      [1800, 2600, 1800],
    );
    expect(cageFeatures(s)).toEqual(["oppositeTurns"]);
    expect(cageToFlights(s)?.turns.map((t) => t.direction)).toEqual(["left", "right"]);
  });

  it("contrôles préalables : mêmes messages que le moteur à volées", () => {
    expect(errorKey(() => flightsToCage(quarter, [2000]))).toBe("layout.legLengthCountMismatch");
    expect(errorKey(() => flightsToCage(quarter, [2000, 0]))).toBe("layout.invalidLegLength");
    expect(errorKey(() => flightsToCage(quarter, [2000, Number.NaN]))).toBe(
      "layout.invalidLegLength",
    );
    expect(errorKey(() => checkFlightsTopology({ ...quarter, turns: [] }))).toBe(
      "layout.turnCountMismatch",
    );
    expect(errorKey(() => checkFlightsTopology(quarter))).toBeUndefined();
  });

  it("volée plus courte que ses carrés d'angle : partie droite négative, hors schéma", () => {
    // Adaptateur du moteur : la partie droite négative reproduit `layout.legTooShort` (parité),
    // mais la cage n'est pas une entrée valide et ne se reconvertit pas.
    const cage = flightsToCage(quarter, [500, 3000]);
    expect(cage.sections[0]!.axis).toEqual({ kind: "straight", length: -400 });
    expect(CageLayoutSpecSchema.safeParse(cage).success).toBe(false);
    expect(cageToFlights(cage)).toBeNull();
  });

  it("propriété : volées d'au moins k·E, cage valide au schéma et relue à l'identique", () => {
    const arb = fc
      .record({
        width: fc.integer({ min: 600, max: 1500 }),
        turns: fc.array(
          fc.record({
            direction: fc.constantFrom("left" as const, "right" as const),
            mode: fc.constantFrom("winders" as const, "landing" as const),
            inner: fc.constant({ kind: "sharp" as const }),
          }),
          { maxLength: 3 },
        ),
        extra: fc.array(fc.integer({ min: 0, max: 4000 }), { minLength: 4, maxLength: 4 }),
      })
      .map((r) => ({
        spec: { width: r.width, turns: r.turns },
        lengths: r.extra.slice(0, r.turns.length + 1).map((e, i) => {
          const k = (i > 0 ? 1 : 0) + (i < r.turns.length ? 1 : 0);
          // Escalier droit : longueur strictement positive.
          return k * r.width + (k === 0 ? Math.max(e, 1) : e);
        }),
      }));
    fc.assert(
      fc.property(arb, ({ spec, lengths }) => {
        const cage = flightsToCage(spec, lengths);
        expect(CageLayoutSpecSchema.parse(cage)).toEqual(cage);
      }),
    );
  });

  it("propriété : cageToFlights(flightsToCage(x)) ≡ x (null si une volée < k·E)", () => {
    const inner: fc.Arbitrary<InnerCorner> = fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 400 }) }),
      fc.record({
        kind: fc.constant("newel" as const),
        size: fc.integer({ min: 60, max: 200 }),
        offset: fc.integer({ min: 0, max: 20 }),
      }),
    );
    const flights = fc
      .record({
        width: fc.integer({ min: 600, max: 1500 }),
        turns: fc.array(
          fc.record({
            direction: fc.constantFrom("left" as const, "right" as const),
            mode: fc.constantFrom("winders" as const, "landing" as const),
            inner,
          }),
          { maxLength: 3 },
        ),
        lengths: fc.array(fc.integer({ min: 1, max: 6000 }), { minLength: 4, maxLength: 4 }),
      })
      .map((r) => ({
        width: r.width,
        legs: r.lengths.slice(0, r.turns.length + 1).map((length) => ({ length })),
        turns: r.turns,
      }));
    fc.assert(
      fc.property(flights, (spec) => {
        const lengths = spec.legs.map((l) => l.length);
        const back = cageToFlights(flightsToCage(spec, lengths));
        // Volée plus courte que ses carrés d'angle : partie droite négative, pas de retour.
        const infeasible = lengths.some(
          (l, i) => l < ((i > 0 ? 1 : 0) + (i < spec.turns.length ? 1 : 0)) * spec.width,
        );
        if (infeasible) {
          expect(back).toBeNull();
          return;
        }
        // `toEqual` : les objets de fast-check n'ont pas de prototype ; clés comparées par JSON.
        expect(back).toEqual(spec);
        expect(JSON.stringify(back)).toBe(JSON.stringify(spec));
      }),
    );
  });

  it("cageToFlights : null dès qu'une fonction de cage ne s'écrit pas en volées", () => {
    const base = cageOf(cageProject(QUARTER));
    expect(cageToFlights(base)).toEqual({
      width: 1000,
      legs: [{ length: 2000 }, { length: 1500 }],
      turns: [{ direction: "left", mode: "winders", inner: { kind: "sharp" } }],
    });
    const variants: CageLayoutSpecInput[] = [
      { ...QUARTER, junctions: [{ angle: 60, mode: "winders" }] },
      { ...QUARTER, junctions: [{ angle: 90, mode: "radiating" }] },
      {
        ...QUARTER,
        junctions: [{ angle: 90, mode: "winders", wall: { kind: "arc", radius: 50 } }],
      },
      {
        ...QUARTER,
        junctions: [
          { angle: 90, mode: "winders", well: { kind: "chamfer", setbackIn: 50, setbackOut: 50 } },
        ],
      },
      {
        ...QUARTER,
        sections: [QUARTER.sections[0]!, { ...QUARTER.sections[1]!, widthEnd: 1200 }],
      },
      {
        ...QUARTER,
        sections: [
          QUARTER.sections[0]!,
          { axis: { kind: "arc", radius: 900, sweep: 90 }, width: 1000 },
        ],
      },
      {
        kind: "cage",
        sections: [{ axis: { kind: "straight", length: 0 }, width: 900 }],
        junctions: [],
      },
    ];
    for (const v of variants) expect(cageToFlights(cageOf(cageProject(v)))).toBeNull();
    // Longueur `auto` (un seul tronçon) gardée telle quelle.
    expect(
      cageToFlights(
        cageOf(
          cageProject({
            kind: "cage",
            sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }],
            junctions: [],
          }),
        ),
      ),
    ).toEqual({ width: 900, legs: [{ length: "auto" }], turns: [] });
  });
});

describe("computeCageLayout : cage native", () => {
  it("quart tournant : tronçons (lignes de départ et d'arrivée, largeurs, côtés du jour, abscisses)", () => {
    const project = cageProject(QUARTER);
    const layout = computeCageLayout(project, cageOf(project));
    const sections = layout.sections!;
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      index: 0,
      kind: "straight",
      start: { left: { x: 0, y: 0 }, right: { x: 1000, y: 0 } },
      end: { left: { x: 0, y: 1000 }, right: { x: 1000, y: 1000 } },
      widthStart: 1000,
      widthEnd: 1000,
      endWellSide: "left",
      sStart: 0,
    });
    expect(sections[0]!.startWellSide).toBeUndefined();
    expect(sections[1]).toMatchObject({
      index: 1,
      start: { left: { x: 0, y: 1000 }, right: { x: 0, y: 2000 } },
      end: { left: { x: -500, y: 1000 }, right: { x: -500, y: 2000 } },
      startWellSide: "left",
    });
    expect(sections[1]!.endWellSide).toBeUndefined();
    // Γ : partie droite (1 000), quart de cercle de rayon d_f = 500, partie droite (500).
    expect(sections[0]!.sEnd).toBe(1000);
    expect(layout.turns[0]).toMatchObject({
      sStart: 1000,
      angle: Math.PI / 2,
      well: { kind: "sharp" },
      wall: { kind: "sharp" },
      innerCorner: { x: 0, y: 1000 },
      outerCorner: { x: 1000, y: 2000 },
    });
    expect(sections[1]!.sStart).toBe(layout.turns[0]!.sEnd);
    expect(sections[1]!.sEnd).toBeCloseTo(curveLength(layout.walkline), 9);
  });

  it("tournant à droite, jour en arc : angle −π/2, raccords recopiés", () => {
    const layout = nativeLayout({
      ...QUARTER,
      junctions: [{ angle: -90, mode: "landing", well: { kind: "arc", radius: 200 } }],
    });
    expect(layout.turns[0]).toMatchObject({
      direction: "right",
      mode: "landing",
      collarSide: "right",
      angle: -Math.PI / 2,
      well: { kind: "arc", radius: 200 },
      wall: { kind: "sharp" },
    });
    // Γ : partie droite 1 000 − 200, quart de cercle de rayon 200 + 500, partie droite 500 − 200.
    const [a, b] = layout.sections!;
    expect(a!.sEnd - a!.sStart).toBeCloseTo(800, 9);
    expect(layout.turns[0]!.sEnd - layout.turns[0]!.sStart).toBeCloseTo((700 * Math.PI) / 2, 9);
    expect(b!.sEnd - b!.sStart).toBeCloseTo(300, 9);
    expect(curveLength(layout.walkline)).toBeCloseTo(800 + (700 * Math.PI) / 2 + 300, 6);
  });

  it("propriété : tronçons et zones tournantes se succèdent sur Γ, lignes de largeur E", () => {
    const wellArb: fc.Arbitrary<InnerCorner> = fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 300 }) }),
      fc.record({
        kind: fc.constant("newel" as const),
        // Côté pair : retrait a/2 + δ entier, parties droites saisies en mm entiers.
        size: fc.integer({ min: 30, max: 100 }).map((h) => 2 * h),
        offset: fc.integer({ min: 0, max: 20 }),
      }),
    );
    const arb = fc
      .record({
        width: fc.integer({ min: 600, max: 1500 }),
        junctions: fc.array(
          fc.record({
            angle: fc.constantFrom(90, -90),
            mode: fc.constantFrom("winders" as const, "landing" as const),
            well: wellArb,
          }),
          { maxLength: 3 },
        ),
        extra: fc.array(fc.integer({ min: 1, max: 3000 }), { minLength: 4, maxLength: 4 }),
      })
      .map((r) => {
        // Partie droite faisable : retraits des raccords de jour voisins + une marge ≥ 1 mm
        // (Γ garde alors une partie droite, y compris dans un S / Z).
        const sections = r.extra.slice(0, r.junctions.length + 1).map((e, i) => {
          const prev = r.junctions[i - 1];
          const next = r.junctions[i];
          const length =
            e + (prev ? wellSetbackOf(prev.well) : 0) + (next ? wellSetbackOf(next.well) : 0);
          return { axis: { kind: "straight" as const, length }, width: r.width };
        });
        return { kind: "cage" as const, sections, junctions: r.junctions };
      });
    fc.assert(
      fc.property(arb, (spec) => {
        const layout = nativeLayout(spec);
        const df = layout.walklineOffset;
        const width = spec.sections[0]!.width;
        // Jonctions : sens, angle signé, mode et raccords recopiés.
        expect(layout.turns).toHaveLength(spec.junctions.length);
        spec.junctions.forEach((j, k) => {
          const t = layout.turns[k]!;
          expect(t.direction).toBe(j.angle > 0 ? "left" : "right");
          expect(t.angle).toBe((Math.sign(j.angle) * Math.PI) / 2);
          expect(t.mode).toBe(j.mode);
          expect(t.well).toEqual(j.well);
          expect(t.wall).toEqual({ kind: "sharp" });
          // Arc de Γ : rayon d_f + rayon du jour en arc, balayage π/2.
          expect(t.sEnd - t.sStart).toBeCloseTo(((df + walkSetbackOf(j.well)) * Math.PI) / 2, 6);
        });
        // Distance de Γ au bord gauche au droit d'une jonction.
        const offsetAt = (k: number): number => (spec.junctions[k]!.angle > 0 ? df : width - df);
        const sections = layout.sections!;
        expect(sections).toHaveLength(spec.sections.length);
        let s = 0;
        sections.forEach((sec, i) => {
          expect(V.distance(sec.start.left, sec.start.right)).toBeCloseTo(sec.widthStart, 6);
          expect(V.distance(sec.end.left, sec.end.right)).toBeCloseTo(sec.widthEnd, 6);
          // Longueur de la partie droite = axis.length.
          const axis = spec.sections[i]!.axis;
          expect(V.distance(sec.start.left, sec.end.left)).toBeCloseTo(axis.length, 6);
          // Partie droite de Γ : axis.length moins les rayons des jours en arc voisins, en biais
          // dans un S / Z quand d_f ≠ E/2 (transition).
          const prev = spec.junctions[i - 1];
          const next = spec.junctions[i];
          const along =
            axis.length -
            (prev ? walkSetbackOf(prev.well) : 0) -
            (next ? walkSetbackOf(next.well) : 0);
          const shift = prev && next ? Math.abs(offsetAt(i - 1) - offsetAt(i)) : 0;
          expect(sec.sStart).toBeCloseTo(s, 6);
          expect(sec.sEnd - sec.sStart).toBeCloseTo(Math.hypot(along, shift), 6);
          s = sec.sEnd;
          const turn = layout.turns[i];
          if (turn) {
            expect(turn.sStart).toBeCloseTo(s, 6);
            s = turn.sEnd;
          }
          // Côtés du jour des jonctions voisines.
          expect(sec.startWellSide).toBe(prev && (prev.angle > 0 ? "left" : "right"));
          expect(sec.endWellSide).toBe(next && (next.angle > 0 ? "left" : "right"));
        });
        expect(s).toBeCloseTo(curveLength(layout.walkline), 6);
      }),
    );
  });

  it("erreurs d'une cage saisie : tronçons et parties droites, pas volées au mur", () => {
    // Partie droite de 100 mm, jour en arc de 300 : minimum de la partie droite 300 mm.
    expect(
      errorMsg(() =>
        nativeLayout({
          kind: "cage",
          sections: [
            { axis: { kind: "straight", length: 100 }, width: 900 },
            { axis: { kind: "straight", length: 2000 }, width: 900 },
          ],
          junctions: [{ angle: 90, mode: "winders", well: { kind: "arc", radius: 300 } }],
        }),
      ),
    ).toEqual(msg("layout.cage.sectionTooShort", { section: 1, length: "100", required: "300" }));
    expect(
      errorMsg(() =>
        nativeLayout({
          kind: "cage",
          sections: [{ axis: { kind: "straight", length: 0 }, width: 900 }],
          junctions: [],
        }),
      ),
    ).toEqual(msg("layout.cage.invalidSectionLength", { section: 1, length: "0" }));
    // S sans partie droite intermédiaire, E = 1 400 (d_f = 600 ≠ E/2) : transition impossible.
    const s3 = (middle: number, angles: [number, number], width = 1400): CageLayoutSpecInput => ({
      kind: "cage",
      sections: [
        { axis: { kind: "straight", length: 1000 }, width },
        { axis: { kind: "straight", length: middle }, width },
        { axis: { kind: "straight", length: 1000 }, width },
      ],
      junctions: angles.map((angle) => ({ angle, mode: "landing" as const })),
    });
    expect(errorMsg(() => nativeLayout(s3(0, [90, -90])))).toEqual(
      msg("layout.cage.sectionTooShortForTransition", {
        section: 2,
        junctionA: 1,
        junctionB: 2,
        offset: "600",
      }),
    );
    // U à jour nul : tronçons qui se font face, signalés sans bloquer.
    expect(nativeLayout(s3(0, [90, 90], 900)).errors).toEqual([
      msg("layout.cage.sectionsTouch", {
        junctionA: 1,
        junctionB: 2,
        section: 2,
        length: "0",
        before: 1,
        after: 3,
      }),
    ]);
    // Colimaçon carré : le tronçon 4 revient sur le tronçon 1 (900 × 500 mm).
    const spiral = nativeLayout({
      kind: "cage",
      sections: [1000, 500, 500, 2000].map((length) => ({
        axis: { kind: "straight" as const, length },
        width: 900,
      })),
      junctions: [90, 90, 90].map((angle) => ({ angle, mode: "landing" as const })),
    });
    expect(spiral.errors).toEqual([
      msg("layout.cage.sectionsOverlap", { sectionA: 1, sectionB: 4, x: "900", y: "500" }),
    ]);
  });

  it("borne de calcul (F8) : cage saisie seulement, pas cage issue de volées", () => {
    const project = cageProject(QUARTER);
    const flights = {
      width: 900,
      turns: Array.from({ length: 16 }, (_, i) => ({
        direction: i % 2 === 0 ? ("right" as const) : ("left" as const),
        mode: "landing" as const,
        inner: { kind: "sharp" as const },
      })),
    };
    const cage = flightsToCage(
      flights,
      Array.from({ length: 17 }, () => 2000),
    );
    expect(errorMsg(() => computeCageLayout(project, cage))).toEqual(
      msg("layout.cage.sectionCount", { count: 17, max: CAGE_MAX_SECTIONS }),
    );
    expect(computeCageLayout(project, cage, { origin: "flights" }).sections).toHaveLength(17);
  });

  it("fonctions du sous-lot 2b : refus clairs ; celles du 2a calculées", () => {
    const key = (spec: CageLayoutSpecInput): MessageKey | undefined => {
      const project = cageProject(spec);
      return errorKey(() => computeCageLayout(project, cageOf(project)));
    };
    // Sous-lot 2a : angle quelconque, palier droit, marches rayonnantes, mur en arc, pan coupé.
    expect(key({ ...QUARTER, junctions: [{ angle: 60, mode: "winders" }] })).toBeUndefined();
    expect(key({ ...QUARTER, junctions: [{ angle: 0, mode: "landing" }] })).toBeUndefined();
    expect(key({ ...QUARTER, junctions: [{ angle: 90, mode: "radiating" }] })).toBeUndefined();
    expect(
      key({
        ...QUARTER,
        junctions: [{ angle: 90, mode: "winders", wall: { kind: "arc", radius: 50 } }],
      }),
    ).toBeUndefined();
    expect(
      key({
        ...QUARTER,
        junctions: [
          { angle: -90, mode: "winders", well: { kind: "chamfer", setbackIn: 9, setbackOut: 9 } },
        ],
      }),
    ).toBeUndefined();
    // Poteau hors de ±90° : refus définitif (F5).
    expect(
      key({
        ...QUARTER,
        junctions: [{ angle: 60, mode: "winders", well: { kind: "newel", size: 90 } }],
      }),
    ).toBe("layout.cage.newelAngle");
    expect(
      key({
        ...QUARTER,
        sections: [QUARTER.sections[0]!, { ...QUARTER.sections[1]!, width: 900 }],
      }),
    ).toBe("layout.cage.variableWidthNotYetSupported");
    expect(
      key({
        ...QUARTER,
        sections: [QUARTER.sections[0]!, { ...QUARTER.sections[1]!, widthEnd: 1100 }],
      }),
    ).toBe("layout.cage.variableWidthNotYetSupported");
    expect(
      key({
        ...QUARTER,
        sections: [
          QUARTER.sections[0]!,
          { axis: { kind: "arc", radius: 900, sweep: 90 }, width: 1000 },
        ],
      }),
    ).toBe("layout.cage.arcAxisNotYetSupported");
    // Longueur `auto` d'un tronçon unique : reculement, comme une volée droite.
    expect(
      key({
        kind: "cage",
        sections: [{ axis: { kind: "straight", length: "auto" }, width: 900 }],
        junctions: [],
      }),
    ).toBeUndefined();
    // Cage non validée par le schéma : topologie incohérente.
    const project = cageProject(QUARTER);
    expect(errorKey(() => computeCageLayout(project, { ...cageOf(project), junctions: [] }))).toBe(
      "layout.cage.junctionCountMismatch",
    );
    expect(
      errorKey(() =>
        computeCageLayout(project, {
          ...cageOf(project),
          sections: cageOf(project).sections.map((s) => ({
            ...s,
            axis: { kind: "straight" as const, length: "auto" as const },
          })),
        }),
      ),
    ).toBe("layout.cage.autoLengthSingleSection");
  });
});
