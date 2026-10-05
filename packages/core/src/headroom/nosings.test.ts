/**
 * Échappée au droit de chaque nez (`HeadroomAnalysis.atNosings`, `Model.headroomAtNosings`,
 * inspecteur Marche, ADR-0009) : plafond le plus bas au-dessus de P_k moins z_k, `null` sans
 * plafond ; même construction exacte que l'échappée sur Γ (décision Q4).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import { helicalShapeArb, makeHelicalProject } from "../layout/helical-test-helpers.js";
import { computeLayout } from "../layout/layout.js";
import type { Opening, Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { computeStepping } from "../stepping/stepping.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { ceilingOf, computeHeadroom, openingPolygon } from "./headroom.js";

const RUNS = Number(process.env["HEADROOM_RUNS"] ?? 40);
const EPS = 1e-6;

function withOpening(p: Project, opening: Opening | undefined): Project {
  const site = { ...p.site };
  if (opening) site.opening = opening;
  else delete site.opening;
  return { ...p, site };
}

function analyse(p: Project) {
  const layout = computeLayout(p);
  const stepping = computeStepping(p, layout);
  return { layout, stepping, headroom: computeHeadroom(p.site, layout, stepping) };
}

/** Escalier droit : H = 2 700, n = 15, g = 270, E = 900, Γ sur x = 450, y ∈ [0 ; 3 780]. */
const straight = makeSteppingProject({ width: 900, legs: ["auto"] });

describe("échappée au droit des nez — escalier droit (valeurs exactes)", () => {
  it("valeur = plafond − z_k sous la dalle, null dans la trémie", () => {
    const p = withOpening(straight, { kind: "rect", x: 0, y: 1000, sizeX: 900, sizeY: 2780 });
    const { stepping, headroom } = analyse(p);
    const ceiling = ceilingOf(p.site);
    const poly = openingPolygon(p.site.opening)!;
    expect(headroom!.atNosings).toHaveLength(stepping.nosings.length);
    let covered = 0;
    stepping.nosings.forEach((n, k) => {
      const v = headroom!.atNosings[k]!;
      if (pointInPolygon(n.p, poly) === "outside") {
        covered++;
        expect(v).toBeCloseTo(ceiling - n.z, 9);
      } else expect(v).toBeNull();
    });
    // Nez 0 à 3 (y = 0, 270, 540, 810) sous la dalle ; les suivants dans la trémie.
    expect(covered).toBe(4);
    expect(headroom!.atNosings[0]).toBeCloseTo(2500 - 180, 9);
  });

  it("trémie couvrante : tous les nez sans plafond (null)", () => {
    const p = withOpening(straight, { kind: "rect", x: -100, y: -100, sizeX: 1100, sizeY: 4100 });
    const { headroom } = analyse(p);
    expect(headroom!.atNosings.every((v) => v === null)).toBe(true);
    const m = buildModel(p);
    expect(m.headroomAtNosings).toHaveLength(m.stepping.nosings.length);
    expect(m.headroomAtNosings!.every((v) => v === null)).toBe(true);
  });

  it("sans trémie ni sous-face : Model.headroomAtNosings tout à null, identité stable", () => {
    const p = withOpening(straight, undefined);
    const a = buildModel(p);
    expect(a.headroomAtNosings).toHaveLength(a.stepping.nosings.length);
    expect(a.headroomAtNosings!.every((v) => v === null)).toBe(true);
    const b = buildModel({ ...p, name: "autre" });
    expect(b.headroomAtNosings).toBe(a.headroomAtNosings);
  });

  it("modèle partiel (découpage en échec) : champ absent", () => {
    const p: Project = {
      ...straight,
      stair: {
        ...straight.stair,
        stepping: { ...straight.stair.stepping, firstRiseOffset: -500 },
      },
    };
    const m = buildModel(p);
    expect(m.errors.length).toBeGreaterThan(0);
    expect(m.headroomAtNosings).toBeUndefined();
  });
});

describe("échappée au droit des nez — propriétés", () => {
  it("chaque valeur non nulle ≥ échappée minimale sur Γ ; null ⇔ P_k dans la trémie", () => {
    const opening = fc.record({
      x: fc.integer({ min: -2000, max: 2000 }),
      y: fc.integer({ min: -1000, max: 4000 }),
      sizeX: fc.integer({ min: 600, max: 4000 }),
      sizeY: fc.integer({ min: 600, max: 4000 }),
    });
    fc.assert(
      fc.property(stairArb(), opening, ({ project }, o) => {
        const p = withOpening(project, { kind: "rect", ...o });
        const m = buildModel(p, { memo: false });
        const values = m.headroomAtNosings;
        expect(values).toBeDefined();
        expect(values).toHaveLength(m.stepping.nosings.length);
        const poly = openingPolygon(p.site.opening)!;
        const ceiling = ceilingOf(p.site);
        m.stepping.nosings.forEach((n, k) => {
          const v = values![k]!;
          if (pointInPolygon(n.p, poly) === "outside") expect(v).toBeCloseTo(ceiling - n.z, 9);
          else expect(v).toBeNull();
          if (v !== null && m.headroom) expect(v).toBeGreaterThanOrEqual(m.headroom.min - EPS);
        });
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("hélicoïdal sous lui-même (sans dalle) : nez couverts par le tour supérieur, ≥ minimum sur Γ", () => {
    fc.assert(
      fc.property(
        helicalShapeArb.map((s) => ({ ...s, opening: undefined })),
        (shape) => {
          const p = makeHelicalProject(shape);
          const m = buildModel(p, { memo: false });
          const values = m.headroomAtNosings;
          expect(values).toHaveLength(m.stepping.nosings.length);
          const N = m.layout.helical!.treadsPerTurn;
          const n = m.stepping.nosings.length;
          values!.forEach((v, k) => {
            if (v !== null && m.headroom) expect(v).toBeGreaterThanOrEqual(m.headroom.min - EPS);
            // Plus d'un tour complet de marches au-dessus du nez : il est couvert.
            if (k + N + 2 < n) expect(v, `nez ${k}`).not.toBeNull();
          });
          // Nez d'arrivée : rien au-dessus (sans dalle).
          expect(values![n - 1]).toBeNull();
        },
      ),
      { numRuns: RUNS },
    );
  }, 600_000);
});
