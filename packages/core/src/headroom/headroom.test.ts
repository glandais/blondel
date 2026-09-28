import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveLength, curvePointAt } from "../geom2d/curve.js";
import { bbox, pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { computeLayout } from "../layout/layout.js";
import type { Opening, Project } from "../model/project.js";
import { computeStepping } from "../stepping/stepping.js";
import { makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { computeHeadroom, coveredIntervals, openingPolygon } from "./headroom.js";
import { slopeProfileOf, slopeZ } from "./profile.js";

const RUNS = Number(process.env["HEADROOM_RUNS"] ?? 60);

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

/** Escalier droit : H = 2 700, n = 15, g = 270 (auto), E = 900, Γ sur x = 450, y ∈ [0 ; 3 780]. */
const straight = makeSteppingProject({ width: 900, legs: ["auto"] });

describe("computeHeadroom — escalier droit (valeurs exactes)", () => {
  it("sans trémie : null (échappée sans objet)", () => {
    expect(analyse(withOpening(straight, undefined)).headroom).toBeNull();
  });

  it("minimum exact au point où Γ entre dans la trémie", () => {
    const p = withOpening(straight, { kind: "rect", x: 0, y: 1000, sizeX: 900, sizeY: 2780 });
    const { headroom } = analyse(p);
    // z(1 000) = 180 + 1 000 × 180 / 270 ; plafond = 2 700 − 200.
    const z = 180 + (1000 * 180) / 270;
    expect(headroom!.ceiling).toBe(2500);
    expect(headroom!.walkline!.min).toBeCloseTo(2500 - z, 9);
    expect(headroom!.walkline!.s).toBeCloseTo(1000, 9);
    expect(headroom!.walkline!.at.x).toBeCloseTo(450, 9);
    expect(headroom!.walkline!.at.y).toBeCloseTo(1000, 9);
    expect(headroom!.walkline!.at.z).toBeCloseTo(z, 9);
    expect(headroom!.covered).toEqual([{ s0: 0, s1: expect.closeTo(1000, 9) as number }]);
    // Largeur : nez 3 (y = 810, z = 720) est le dernier sous la dalle.
    expect(headroom!.width).toEqual({
      min: 2500 - 720,
      // Nez entièrement sous la dalle : milieu du segment.
      at: { x: expect.closeTo(450, 9) as number, y: expect.closeTo(810, 9) as number, z: 720 },
      nosing: 3,
    });
  });

  it("trémie étroite : Γ sous la dalle, mais la trémie ne couvre qu'une partie de la largeur", () => {
    // Trémie de x = 200 à 700 : Γ (x = 450) dedans, les rives du nez sous la dalle.
    const p = withOpening(straight, { kind: "rect", x: 200, y: 1000, sizeX: 500, sizeY: 2780 });
    const { headroom } = analyse(p);
    expect(headroom!.walkline!.min).toBeCloseTo(2500 - (180 + (1000 * 180) / 270), 9);
    // Tous les nez sont en partie sous la dalle : le nez d'arrivée (z = H) donne −ep.
    expect(headroom!.width!.min).toBe(-200);
    expect(headroom!.width!.nosing).toBe(14);
  });

  it("arrivée sous la dalle (trémie trop courte) : échappée négative (−ep)", () => {
    const p = withOpening(straight, { kind: "rect", x: 0, y: 1000, sizeX: 900, sizeY: 2000 });
    const { headroom } = analyse(p);
    expect(headroom!.walkline!.min).toBeCloseTo(-200, 9);
    expect(headroom!.walkline!.s).toBeCloseTo(3780, 9);
  });

  it("trémie couvrant toute la ligne de foulée : aucune mesure (plafond absent)", () => {
    const p = withOpening(straight, { kind: "rect", x: -100, y: -100, sizeX: 1100, sizeY: 4000 });
    const { headroom } = analyse(p);
    expect(headroom!.covered).toEqual([]);
    expect(headroom!.walkline).toBeUndefined();
    expect(headroom!.width).toBeUndefined();
  });

  it("trémie polygonale équivalente au rectangle : même résultat", () => {
    const rect = withOpening(straight, { kind: "rect", x: 0, y: 1000, sizeX: 900, sizeY: 2780 });
    const poly = withOpening(straight, {
      kind: "polygon",
      // Sens horaire et point intermédiaire aligné : normalisés.
      points: [
        { x: 0, y: 1000 },
        { x: 0, y: 3780 },
        { x: 900, y: 3780 },
        { x: 900, y: 2000 },
        { x: 900, y: 1000 },
      ],
    });
    expect(analyse(poly).headroom!.walkline!.min).toBeCloseTo(
      analyse(rect).headroom!.walkline!.min,
      9,
    );
  });

  it("trémie en L : plusieurs intervalles sous la dalle, minimum au dernier", () => {
    const p = withOpening(straight, {
      kind: "polygon",
      points: [
        { x: 0, y: 500 },
        { x: 900, y: 500 },
        { x: 900, y: 1500 },
        { x: 600, y: 1500 },
        { x: 600, y: 2000 },
        { x: 400, y: 2000 },
        { x: 400, y: 3780 },
        { x: 0, y: 3780 },
      ],
    });
    // Γ (x = 450) : dalle sur [0 ; 500], trémie sur [500 ; 2 000], dalle sur [2 000 ; 3 780].
    const { headroom } = analyse(p);
    expect(headroom!.covered).toHaveLength(2);
    expect(headroom!.walkline!.min).toBeCloseTo(-200, 9);
  });
});

describe("computeHeadroom — le placement de l'escalier compte (trémie en repère site)", () => {
  const base = withOpening(straight, { kind: "rect", x: 0, y: 1000, sizeX: 900, sizeY: 3500 });

  it("déplacer l'escalier seul change l'échappée", () => {
    expect(analyse(base).headroom!.walkline!.s).toBeCloseTo(1000, 9);
    const moved: Project = {
      ...base,
      stair: { ...base.stair, placement: { origin: { x: 0, y: 300 }, rotation: 0 } },
    };
    // Γ commence en y = 300 : il entre dans la trémie à s = 700.
    expect(analyse(moved).headroom!.walkline!.min).toBeCloseTo(2500 - (180 + (700 * 180) / 270), 9);
  });
});

/** Trémie rectangulaire aléatoire dans la boîte englobante de l'emprise (fractions). */
const fractions = fc.record({
  x0: fc.double({ min: -0.1, max: 0.9, noNaN: true }),
  x1: fc.double({ min: 0.1, max: 1.1, noNaN: true }),
  y0: fc.double({ min: -0.1, max: 0.9, noNaN: true }),
  y1: fc.double({ min: 0.1, max: 1.1, noNaN: true }),
});

function randomOpening(p: Project, f: typeof fractions extends fc.Arbitrary<infer T> ? T : never) {
  const b = bbox(computeLayout(p).footprint);
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  const [xa, xb] = [Math.min(f.x0, f.x1), Math.max(f.x0, f.x1)];
  const [ya, yb] = [Math.min(f.y0, f.y1), Math.max(f.y0, f.y1)];
  const x = Math.round(b.min.x + xa * w);
  const y = Math.round(b.min.y + ya * h);
  return {
    kind: "rect" as const,
    x,
    y,
    sizeX: Math.max(1, Math.round(b.min.x + xb * w) - x),
    sizeY: Math.max(1, Math.round(b.min.y + yb * h) - y),
  };
}

describe("computeHeadroom — propriétés (générateur contraint)", { timeout: 300_000 }, () => {
  it("Γ : aucun point sous la dalle n'a une échappée inférieure au minimum, atteint au bord", () => {
    fc.assert(
      fc.property(stairArb(), fractions, ({ project }, f) => {
        const p = withOpening(project, randomOpening(project, f));
        const { layout, stepping, headroom } = analyse(p);
        const opening = openingPolygon(p.site.opening)!;
        const profile = slopeProfileOf(stepping);
        const L = curveLength(layout.walkline);
        let bruteMin = Infinity;
        const steps = 800;
        for (let i = 0; i <= steps; i++) {
          const s = (L * i) / steps;
          if (pointInPolygon(curvePointAt(layout.walkline, s), opening) !== "outside") continue;
          bruteMin = Math.min(bruteMin, headroom!.ceiling - slopeZ(profile, s));
        }
        if (!headroom!.walkline) {
          expect(bruteMin).toBe(Infinity);
          return;
        }
        expect(bruteMin).toBeGreaterThanOrEqual(headroom!.walkline.min - 1e-6);
        // Le minimum est pris au bord de la trémie (entrée de Γ) ou à l'arrivée.
        const at = { x: headroom!.walkline.at.x, y: headroom!.walkline.at.y };
        const onEdge = pointInPolygon(at, opening, 1e-6) === "boundary";
        expect(onEdge || Math.abs(headroom!.walkline.s - L) < 1e-6).toBe(true);
        // Chaque intervalle couvert est bien sous la dalle.
        for (const c of headroom!.covered) {
          const mid = curvePointAt(layout.walkline, (c.s0 + c.s1) / 2);
          expect(pointInPolygon(mid, opening)).toBe("outside");
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("largeur des marches : minimum sur les nez dont un point est sous la dalle", () => {
    fc.assert(
      fc.property(stairArb(), fractions, ({ project }, f) => {
        const p = withOpening(project, randomOpening(project, f));
        const { stepping, headroom } = analyse(p);
        const opening = openingPolygon(p.site.opening)!;
        let brute = Infinity;
        for (const n of stepping.nosings) {
          for (let i = 0; i <= 50; i++) {
            if (pointInPolygon(V.lerp(n.q, n.r, i / 50), opening) === "outside") {
              brute = Math.min(brute, headroom!.ceiling - n.z);
              break;
            }
          }
        }
        if (brute < Infinity) expect(headroom!.width).toBeDefined();
        if (headroom!.width) {
          expect(headroom!.width.min).toBeLessThanOrEqual(brute + 1e-9);
          const n = stepping.nosings[headroom!.width.nosing]!;
          expect(headroom!.width.min).toBe(headroom!.ceiling - n.z);
          const at = { x: headroom!.width.at.x, y: headroom!.width.at.y };
          expect(pointInPolygon(at, opening, 1e-6)).not.toBe("inside");
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("invariance par déplacement rigide de l'escalier et de la trémie ensemble", () => {
    fc.assert(
      fc.property(
        stairArb(),
        fractions,
        fc.integer({ min: -180, max: 180 }),
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -5000, max: 5000 }),
        ({ project }, f, rotation, ox, oy) => {
          const rect = randomOpening(project, f);
          const p = withOpening(project, rect);
          const angle = (rotation * Math.PI) / 180;
          const move = (q: { x: number; y: number }) => V.add(V.rotate(q, angle), { x: ox, y: oy });
          const corners = openingPolygon(rect)!;
          const moved: Project = withOpening(
            {
              ...project,
              stair: { ...project.stair, placement: { origin: { x: ox, y: oy }, rotation } },
            },
            { kind: "polygon", points: corners.map(move) },
          );
          const a = analyse(p).headroom!;
          const b = analyse(moved).headroom!;
          expect(b.walkline === undefined).toBe(a.walkline === undefined);
          if (a.walkline && b.walkline) {
            expect(b.walkline.min).toBeCloseTo(a.walkline.min, 6);
            const at = move(a.walkline.at);
            expect(V.distance(at, b.walkline.at)).toBeLessThan(1e-6);
          }
          expect(b.width?.min).toBe(a.width?.min);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("coveredIntervals : complémentaires de la trémie sur Γ (bornes triées, disjointes)", () => {
    fc.assert(
      fc.property(stairArb(), fractions, ({ project }, f) => {
        const p = withOpening(project, randomOpening(project, f));
        const layout = computeLayout(p);
        const cov = coveredIntervals(layout.walkline, openingPolygon(p.site.opening)!);
        for (let i = 0; i < cov.length; i++) {
          expect(cov[i]!.s1).toBeGreaterThan(cov[i]!.s0);
          if (i > 0) expect(cov[i]!.s0).toBeGreaterThan(cov[i - 1]!.s1);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
