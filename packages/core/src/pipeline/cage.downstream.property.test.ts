/**
 * Aval complet sur des cages générées (sous-lot 2d, ADR-0010) : angles quelconques (dont 0 =
 * palier droit et ±90°), modes balancé / palier / rayonnant, raccords de jour vif, en arc ou en
 * pan coupé, congé côté mur, largeur variable, axes en arc, avec garde-corps et trémie.
 *
 * Propriétés : `buildModel` ne lève jamais ; aucune erreur interne ; contrôle de conception
 * évalué sur le découpage calculé (pas de modèle partiel) ; axes des garde-corps de volée au
 * bord de l'emprise, à l'extérieur (hors du polygone d'emprise ; distance au bord de leur côté
 * entre `edgeOffset` / 4, effet d'onglet sur un mur en arc de petit rayon, et 4 × `edgeOffset`,
 * onglets), une seule ligne et une main courante continue sur
 * tout côté entièrement vide (hors jour étroit) ; échappée calculée cohérente (plafond moins
 * ligne de pente, bornée par le plafond et le plafond moins H ; au droit des nez, plafond de la
 * dalle moins z_k hors auto-recouvrement). Une échappée négative n'est pas une erreur : la dalle
 * coupe l'escalier (cage qui revient sous la dalle haute), et la règle le signale.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { distanceToCurve } from "../geom2d/intersect.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import { computeGuards } from "../guards/compute.js";
import { cageSelfCovers } from "../headroom/cage.js";
import { computeLayout } from "../layout/layout.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type BalancingMethod,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "./build.js";

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

/** Projet avec garde-corps et trémie couvrant l'emprise hors d'une bande au départ. */
function project(
  layout: CageLayoutSpecInput,
  method: BalancingMethod,
  floorToFloor: number,
  band: number,
): Project {
  const base = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      balancing: { method },
    },
    guards: {},
  };
  const p0 = ProjectSchema.parse(base);
  let fp;
  try {
    fp = computeLayout(p0).footprint;
  } catch {
    return p0;
  }
  if (fp.length < 3) return p0;
  const xs = fp.map((p) => p.x);
  const ys = fp.map((p) => p.y);
  const x = Math.round(Math.min(...xs)) - 300;
  const y = Math.round(Math.min(...ys)) + band;
  const sizeX = Math.round(Math.max(...xs)) + 300 - x;
  const sizeY = Math.round(Math.max(...ys)) + 300 - y;
  if (!(sizeX > 0 && sizeY > 0)) return p0;
  return ProjectSchema.parse({
    ...base,
    site: { ...base.site, opening: { kind: "rect", x, y, sizeX, sizeY } },
  });
}

describe("aval complet sur des cages générées — propriétés", () => {
  it("buildModel ne lève jamais ; garde-corps, échappée et règles calculés et cohérents", () => {
    let full = 0;
    let withGuards = 0;
    let withHeadroom = 0;
    fc.assert(
      fc.property(
        cageArb,
        methodArb,
        fc.integer({ min: 2200, max: 3400 }),
        fc.integer({ min: 200, max: 1500 }),
        (spec, method, floorToFloor, band) => {
          const p = project(spec, method, floorToFloor, band);
          const model = buildModel(p, { memo: false });
          expect(model.errors.map((e) => e.key)).not.toContain("pipeline.internalError");
          if (model.stepping.treads.length === 0) return;
          full++;
          // Contrôle sur le découpage calculé : plus de « modèle partiel ».
          expect(
            model.compliance.notes?.some((n) => n.key === "compliance.engine.partialModel"),
          ).not.toBe(true);
          for (const id of ["G_MIN_DTU", "BLONDEL_DTU", "VOLEE_MAX_DTU"]) {
            const rs = model.compliance.results.filter((r) => r.ruleId === id);
            expect(rs.length).toBeGreaterThan(0);
            expect(rs.every((r) => r.status !== "non-evaluee")).toBe(true);
          }
          // Échappée : plafond moins ligne de pente, bornée.
          const ceiling = p.site.floorToFloor - p.site.upperSlabThickness;
          if (model.headroom) {
            withHeadroom++;
            expect(Number.isFinite(model.headroom.min)).toBe(true);
            expect(model.headroom.min).toBeLessThanOrEqual(ceiling + 1e-9);
            expect(model.headroom.min).toBeGreaterThanOrEqual(ceiling - floorToFloor - 1e-9);
          }
          // Sans auto-recouvrement, seule la dalle forme plafond au droit des nez.
          const selfCovered = cageSelfCovers(p.stair.layout as CageLayoutSpec, model.layout);
          model.headroomAtNosings?.forEach((v, k) => {
            if (v !== null && !selfCovered)
              expect(v).toBeCloseTo(ceiling - model.stepping.nosings[k]!.z, 9);
          });
          // Garde-corps (tracé non dégénéré, aucune ligne refusée).
          if (model.layout.errors || model.layout.zeroLengthInner) return;
          const guards = computeGuards(p, model.layout, model.stepping);
          if ((guards.errors ?? []).length > 0) return;
          withGuards++;
          const offset = guards.spec.flight.edgeOffset;
          for (const run of guards.runs) {
            if (run.kind !== "rake" || run.side === undefined) continue;
            const curve = run.side === "inner" ? model.layout.inner : model.layout.outer;
            for (const q of run.path) {
              const d = distanceToCurve(q, curve);
              expect(d).toBeLessThanOrEqual(4 * offset + 1e-6);
              expect(d).toBeGreaterThan(offset / 4);
              expect(pointInPolygon(q, model.layout.footprint)).toBe("outside");
            }
          }
          for (const side of guards.sides) {
            if (side.side === "inner" && guards.narrowJour) continue;
            const allVoid =
              side.intervals.length === 1 && side.intervals[0]!.kind === "void" && side.length > 0;
            if (!allVoid) continue;
            const runs = guards.runs.filter((r) => r.kind === "rake" && r.side === side.side);
            expect(runs).toHaveLength(1);
            const hr = guards.handrails.filter((h) => h.side === side.side && h.onGuard);
            expect(hr).toHaveLength(1);
            expect(hr[0]!.from).toBeLessThanOrEqual(1e-6);
            expect(hr[0]!.to).toBeGreaterThanOrEqual(side.length - 1e-6);
          }
          expect(model.parts.some((part) => part.family === "guards")).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
    expect(full).toBeGreaterThan(RUNS / 4);
    expect(withGuards).toBeGreaterThan(0);
    expect(withHeadroom).toBeGreaterThan(0);
  });
});
