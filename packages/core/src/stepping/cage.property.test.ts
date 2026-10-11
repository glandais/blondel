/**
 * Découpage et balancement sur des cages générées (sous-lot 2c, ADR-0010) : angles quelconques
 * (dont 0 = palier droit et ±90°), modes balancé / palier / rayonnant, raccords de jour vif, en
 * arc ou en pan coupé, congé côté mur, largeur variable (ancrages), axes en arc ; méthodes M0,
 * M1, M3 et M6 (M2 : refus hors de ±90° vérifié à part).
 *
 * Propriétés : Σh = H, nombre de contremarches cohérent, girons sur Γ positifs et nez ordonnés,
 * extrémités des nez sur C_i / C_e et P sur Γ, nez dans l'emprise, aucun nez dans un palier
 * droit (une seule marche palière entre ses bords), zones rayonnantes calculées en M0, zones de
 * balancement disjointes, croisements K5 bornés, `buildModel` sans exception (découpage produit).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { distanceToCurve } from "../geom2d/intersect.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import { cageToFlights } from "../layout/cage/fromFlights.js";
import type { Layout, Stepping } from "../model/derived.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type BalancingMethod,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { SteppingError } from "./errors.js";
import { computeStepping } from "./stepping.js";

type SectionInput = CageLayoutSpecInput["sections"][number];
type JunctionInput = CageLayoutSpecInput["junctions"][number];

const RUNS = Number(process.env["STEPPING_RUNS"] ?? 200);

const angleArb = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: -160, max: 160 }).filter((a) => a !== 0) },
  { weight: 2, arbitrary: fc.constantFrom(90, -90) },
  { weight: 2, arbitrary: fc.constant(0) },
);

const junctionArb: fc.Arbitrary<JunctionInput> = fc
  .record({
    angle: angleArb,
    mode: fc.constantFrom("winders" as const, "landing" as const, "radiating" as const),
    well: fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 300 }) }),
      fc.record({
        kind: fc.constant("chamfer" as const),
        setbackIn: fc.integer({ min: 1, max: 200 }),
        setbackOut: fc.integer({ min: 1, max: 200 }),
      }),
    ),
    wall: fc.oneof(
      { weight: 3, arbitrary: fc.constant({ kind: "sharp" as const }) },
      {
        weight: 1,
        arbitrary: fc.record({
          kind: fc.constant("arc" as const),
          radius: fc.integer({ min: 1, max: 600 }),
        }),
      },
    ),
    depth: fc.option(fc.integer({ min: 300, max: 1500 }), { nil: undefined }),
  })
  .map((j): JunctionInput => {
    if (j.angle === 0) {
      return { angle: 0, mode: "landing", ...(j.depth !== undefined ? { depth: j.depth } : {}) };
    }
    return { angle: j.angle, mode: j.mode, well: j.well, wall: j.wall };
  });

const anchorArb = fc.option(fc.constantFrom("left" as const, "right" as const, "center" as const), {
  nil: undefined,
});

const sectionArb: fc.Arbitrary<SectionInput> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .record({
        length: fc.integer({ min: 300, max: 3000 }),
        width: fc.integer({ min: 700, max: 1400 }),
        widthEnd: fc.option(fc.integer({ min: 700, max: 1400 }), { nil: undefined }),
        anchor: anchorArb,
      })
      .map((s): SectionInput => ({
        axis: { kind: "straight", length: s.length },
        width: s.width,
        ...(s.widthEnd !== undefined ? { widthEnd: s.widthEnd } : {}),
        ...(s.anchor !== undefined ? { anchor: s.anchor } : {}),
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({
        radius: fc.integer({ min: 1200, max: 4000 }),
        sweep: fc.integer({ min: 15, max: 150 }),
        sign: fc.constantFrom(1, -1),
        width: fc.integer({ min: 700, max: 1200 }),
      })
      .map((s): SectionInput => ({
        axis: { kind: "arc", radius: s.radius, sweep: s.sign * s.sweep },
        width: s.width,
      })),
  },
);

const cageArb: fc.Arbitrary<CageLayoutSpecInput> = fc
  .record({
    sections: fc.array(sectionArb, { minLength: 1, maxLength: 4 }),
    junctions: fc.array(junctionArb, { minLength: 3, maxLength: 3 }),
  })
  .map((r) => ({
    kind: "cage" as const,
    sections: r.sections,
    junctions: r.junctions.slice(0, r.sections.length - 1),
  }));

const methodArb = fc.constantFrom<BalancingMethod>("M0", "M1", "M3", "M6");

function project(
  layout: CageLayoutSpecInput,
  method: BalancingMethod,
  floorToFloor: number,
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      balancing: { method },
    },
  });
}

type Outcome =
  | { kind: "layout"; error: LayoutError }
  | { kind: "stepping"; layout: Layout; error: SteppingError }
  | { kind: "ok"; layout: Layout; stepping: Stepping };

/** Tracé et découpage ; seules `LayoutError` et `SteppingError` sont admises comme refus. */
function attempt(p: Project): Outcome {
  let layout: Layout;
  try {
    layout = computeLayout(p);
  } catch (e) {
    if (e instanceof LayoutError) return { kind: "layout", error: e };
    throw e;
  }
  try {
    return { kind: "ok", layout, stepping: computeStepping(p, layout) };
  } catch (e) {
    if (e instanceof SteppingError) return { kind: "stepping", layout, error: e };
    throw e;
  }
}

const TOL = 1e-6;

describe("découpage de cages générées — propriétés", () => {
  it("invariants du découpage sur toute cage calculée", () => {
    let computed = 0;
    let withLanding = 0;
    let withArc = 0;
    let withAnyAngle = 0;
    let withRadiating = 0;
    let withCrossing = 0;
    const steppingRefusals = new Map<string, number>();
    fc.assert(
      fc.property(
        cageArb,
        methodArb,
        fc.integer({ min: 2200, max: 3400 }),
        (spec, method, floorToFloor) => {
          const p = project(spec, method, floorToFloor);
          const out = attempt(p);
          if (out.kind === "layout") return;
          if (out.kind === "stepping") {
            const key = out.error.msg.key;
            steppingRefusals.set(key, (steppingRefusals.get(key) ?? 0) + 1);
            return;
          }
          computed++;
          const { layout, stepping: st } = out;
          const H = floorToFloor;
          // Hauteurs.
          expect(Math.abs(st.rises.reduce((a, b) => a + b, 0) - H)).toBeLessThan(1e-6);
          expect(st.rises.every((h) => h > 0)).toBe(true);
          // Nombre de contremarches cohérent.
          expect(st.rises.length).toBe(st.riserCount);
          expect(st.nosings.length).toBe(st.riserCount);
          expect(st.treads.length).toBe(st.riserCount - 1);
          expect(st.nosings[st.nosings.length - 1]!.z).toBe(H);
          // Girons sur Γ positifs, nez ordonnés, départ et arrivée aux extrémités de Γ.
          expect(st.nosings[0]!.s).toBe(0);
          for (let k = 0; k + 1 < st.nosings.length; k++) {
            expect(st.nosings[k + 1]!.s).toBeGreaterThan(st.nosings[k]!.s);
            expect(st.treads[k]!.going).toBeGreaterThan(0);
          }
          expect(st.going).toBeGreaterThan(0);
          // Nez : P sur Γ, Q sur C_i, R sur C_e, dans l'emprise.
          for (const nl of st.nosings) {
            expect(distanceToCurve(nl.p, layout.walkline)).toBeLessThan(TOL);
            expect(distanceToCurve(nl.q, layout.inner)).toBeLessThan(TOL);
            expect(distanceToCurve(nl.r, layout.outer)).toBeLessThan(TOL);
            if (!layout.errors) {
              expect(pointInPolygon(nl.p, layout.footprint, 1e-6)).not.toBe("outside");
            }
          }
          // Aucun nez dans un palier droit ; marche palière unique entre ses bords.
          for (const t of layout.turns) {
            if (t.mode !== "landing" || t.angle !== 0) continue;
            withLanding++;
            const inside = st.nosings.filter((n) => n.s > t.sStart + TOL && n.s < t.sEnd - TOL);
            expect(inside).toEqual([]);
            // Une seule marche palière couvre le palier (paliers contigus : une marche commune).
            const k = st.nosings.findLastIndex((n) => n.s <= t.sStart + TOL);
            expect(k).toBeGreaterThanOrEqual(0);
            expect(st.nosings[k + 1]!.s).toBeGreaterThanOrEqual(t.sEnd - TOL);
            expect(st.treads[k]!.kind).toBe("landing");
          }
          for (const t of layout.turns) {
            if (
              t.angle !== undefined &&
              t.angle !== 0 &&
              Math.abs(Math.abs(t.angle) - Math.PI / 2) > 1e-9
            ) {
              withAnyAngle++;
            }
          }
          if (layout.sections?.some((s) => s.kind === "arc")) withArc++;
          // Marches rayonnantes : M0 forcé ; autres zones : méthode choisie.
          for (const z of st.balancedZones) {
            const turn = layout.turns[z.turn]!;
            if (turn.mode === "radiating") {
              withRadiating++;
              expect(z.method).toBe("M0");
            } else expect(z.method.startsWith(method)).toBe(true);
          }
          // Zones disjointes (bornes partagées admises) : aucun nez recalculé par deux zones.
          const zones = [...st.balancedZones].sort((x, y) => x.from - y.from);
          for (let i = 0; i + 1 < zones.length; i++) {
            expect(zones[i]!.to).toBeLessThanOrEqual(zones[i + 1]!.from);
          }
          if (st.notes.some((n) => n.key === "stepping.k5Crossing")) withCrossing++;
        },
      ),
      { numRuns: RUNS },
    );
    // Le générateur couvre effectivement les cas visés.
    expect(computed).toBeGreaterThan(RUNS / 4);
    expect(withLanding).toBeGreaterThan(0);
    expect(withArc).toBeGreaterThan(0);
    expect(withAnyAngle).toBeGreaterThan(0);
    expect(withRadiating).toBeGreaterThan(0);
    // Refus du découpage : seulement des refus lisibles connus. Une ligne de nez perpendiculaire
    // impossible reste un cas dégénéré rare (tronçon court très évasé dont la ligne sort par
    // l'arrivée, pan coupé au-delà de 90° sans sommet atteignable) : borné.
    const known = new Set([
      "stepping.oppositeTurnsTooClose",
      "stepping.tooFewRisersForLandings",
      "stepping.perpendicularNosingImpossible",
      "stepping.chamferLandingNotSupported",
      "stepping.chamferRadiatingNotSupported",
    ]);
    expect([...steppingRefusals.keys()].filter((k) => !known.has(k))).toEqual([]);
    const impossible = steppingRefusals.get("stepping.perpendicularNosingImpossible") ?? 0;
    expect(impossible).toBeLessThanOrEqual(Math.max(2, computed * 0.02));
    // Lignes de nez croisées (K5) : signalées dans les notes, jamais silencieuses ; cas résiduels
    // variés (zone sans candidat admissible, palier droit voisin d'un arc ou d'un trapèze,
    // marches rayonnantes près d'un tronçon court), environ 3,5 % des cages calculées : borné.
    // Les combinaisons qui croisent toujours (pan coupé avec palier d'angle, marches rayonnantes
    // ou M0) sont refusées par le découpage.
    expect(withCrossing).toBeLessThanOrEqual(Math.max(2, computed * 0.06));
  }, 600_000);

  it("herse (M2) : refusée exactement quand une jonction balancée n'est pas à ±90°", () => {
    fc.assert(
      fc.property(cageArb, (spec) => {
        const p = project(spec, "M2", 2700);
        const out = attempt(p);
        if (out.kind === "layout") return;
        const offRight = out.layout.turns.some(
          (t) =>
            t.mode === "winders" &&
            t.angle !== undefined &&
            Math.abs(Math.abs(t.angle) - Math.PI / 2) > 1e-9,
        );
        if (offRight) {
          expect(out.kind).toBe("stepping");
          if (out.kind === "stepping") {
            expect(out.error.msg.key).toBe("balancing.m2.angleNotSupported");
          }
        } else if (out.kind === "stepping") {
          expect(out.error.msg.key).not.toBe("balancing.m2.angleNotSupported");
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("buildModel ne lève jamais ; tracé calculé ⇒ découpage produit ou erreur claire", () => {
    fc.assert(
      fc.property(cageArb, methodArb, (spec, method) => {
        const p = project(spec, method, 2700);
        const model = buildModel(p, { memo: false });
        const keys = model.errors.map((e) => e.key);
        expect(keys).not.toContain("pipeline.internalError");
        if (model.layout.walkline.segments.length > 0 && model.stepping.treads.length === 0) {
          expect(keys.some((k) => k.startsWith("stepping.") || k.startsWith("balancing."))).toBe(
            true,
          );
        }
      }),
      { numRuns: Math.max(20, Math.floor(RUNS / 4)) },
    );
  }, 600_000);

  it("non-régression : cage saisie exprimable en volées (±90°, largeur constante) ⇒ même découpage", () => {
    const arb = fc.record({
      width: fc.integer({ min: 700, max: 1400 }),
      lengths: fc.array(fc.integer({ min: 900, max: 3000 }), { minLength: 1, maxLength: 3 }),
      junctions: fc.array(
        fc.record({
          angle: fc.constantFrom(90, -90),
          mode: fc.constantFrom("winders" as const, "landing" as const),
          well: fc.oneof(
            fc.constant({ kind: "sharp" as const }),
            fc.record({
              kind: fc.constant("arc" as const),
              radius: fc.integer({ min: 1, max: 300 }),
            }),
          ),
        }),
        { minLength: 2, maxLength: 2 },
      ),
      method: fc.constantFrom<BalancingMethod>("M0", "M1", "M2", "M3", "M6"),
    });
    let compared = 0;
    fc.assert(
      fc.property(arb, (r) => {
        const spec: CageLayoutSpecInput = {
          kind: "cage",
          sections: r.lengths.map((length) => ({
            axis: { kind: "straight", length },
            width: r.width,
          })),
          junctions: r.junctions.slice(0, r.lengths.length - 1),
        };
        const cage = project(spec, r.method, 2700);
        const flightsSpec = cageToFlights(cage.stair.layout as CageLayoutSpec);
        if (flightsSpec === null) return;
        const flights: Project = { ...cage, stair: { ...cage.stair, layout: flightsSpec } };
        const a = attempt(cage);
        const b = attempt(flights);
        expect(a.kind).toBe(b.kind);
        if (a.kind === "ok" && b.kind === "ok") {
          compared++;
          expect(a.stepping).toStrictEqual(b.stepping);
        }
      }),
      { numRuns: Math.max(30, Math.floor(RUNS / 2)) },
    );
    expect(compared).toBeGreaterThan(0);
  }, 600_000);
});
