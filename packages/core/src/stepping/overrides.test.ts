/**
 * Angles des lignes de nez exposés par le découpage (`NosingLine.angle` / `computedAngle`,
 * inspecteur Marche, ADR-0009) : même convention que la retouche « angle » (écart à la
 * perpendiculaire à Γ en P_k, positif dans le sens du tournant voisin).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveTangentAt } from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import { makeHelicalProject } from "../layout/helical-test-helpers.js";
import { computeLayout } from "../layout/layout.js";
import type { Layout, Stepping } from "../model/derived.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { ALL_TYPOLOGIES, SAME_SIDE_TYPOLOGIES, stairArb } from "./test-helpers.js";
import { computeStepping } from "./stepping.js";

const RUNS = Math.min(Number(process.env["STEPPING_RUNS"] ?? 60), 200);

const run = (project: Project): { layout: Layout; stepping: Stepping } => {
  const layout = computeLayout(project);
  return { layout, stepping: computeStepping(project, layout) };
};

const withOverrides = (
  project: Project,
  nosingOverrides: Project["stair"]["nosingOverrides"],
): Project => ProjectSchema.parse({ ...project, stair: { ...project.stair, nosingOverrides } });

/** Le découpage a-t-il refusé la retouche d'angle du nez k (note « inapplicable ») ? */
const refused = (st: Stepping, k: number): boolean =>
  st.notes.some(
    (n) => n.key === "stepping.override.angleInapplicable" && n.params?.["nosing"] === k,
  );

/**
 * Référence de convention indépendante (même construction que l'ancien mode expert de
 * l'interface, `apps/web/src/lib/expert.ts`, `nosingAngleDeg`) : perpendiculaire à la tangente
 * de Γ orientée du jour vers le mur, signe du jour de `layout.innerSide`. Valable pour les
 * tracés dont tous les tournants ont le jour du même côté.
 */
function referenceAngle(layout: Layout, st: Stepping, k: number): number {
  const n = st.nosings[k]!;
  const t = curveTangentAt(layout.walkline, n.s);
  const perp = layout.innerSide === "left" ? V.perpRight(t) : V.perpLeft(t);
  const sign = layout.innerSide === "left" ? 1 : -1;
  return (sign * Math.atan2(V.cross(perp, n.dir), V.dot(perp, n.dir)) * 180) / Math.PI;
}

describe("angles des lignes de nez (NosingLine.angle / computedAngle)", () => {
  it("chaque nez porte un angle ; nez non balancé (perpendiculaire) → 0 ; sans retouche, pas de computedAngle", () => {
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
        const { stepping } = run(project);
        for (const n of stepping.nosings) {
          expect(n.angle, `nez ${n.index}`).toBeDefined();
          expect(Number.isFinite(n.angle)).toBe(true);
          expect(n.computedAngle).toBeUndefined();
          if (!n.balanced) expect(Math.abs(n.angle!)).toBeLessThan(1e-6);
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("convention identique à la référence de l'interface (tournants de même sens)", () => {
    fc.assert(
      fc.property(stairArb(undefined, SAME_SIDE_TYPOLOGIES), ({ project }) => {
        const { layout, stepping } = run(project);
        // Hors transitions de la ligne de foulée (nez perpendiculaires à la volée, pas à Γ).
        if ((layout.walklineTransitions ?? []).length > 0) return;
        stepping.nosings.forEach((n, k) => {
          expect(n.angle!).toBeCloseTo(referenceAngle(layout, stepping, k), 6);
        });
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("retouche d'angle appliquée : angle ≈ valeur imposée, computedAngle = angle calculé sans elle", () => {
    fc.assert(
      fc.property(
        stairArb(undefined, ALL_TYPOLOGIES),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: -150, max: 150 }).map((a) => a / 10),
        ({ project }, pick, angle) => {
          const free = run(project).stepping;
          const k = Math.min(free.nosings.length - 1, Math.floor(pick * free.nosings.length));
          const st = run(withOverrides(project, [{ kind: "angle", index: k, angle }])).stepping;
          if (refused(st, k)) {
            expect(st.nosings[k]!.computedAngle).toBeUndefined();
            return;
          }
          expect(st.nosings[k]!.angle!).toBeCloseTo(angle, 6);
          expect(st.nosings[k]!.computedAngle).toBeDefined();
          // La retouche d'angle est appliquée après le balancement : l'angle calculé est celui
          // du découpage sans retouche.
          expect(st.nosings[k]!.computedAngle!).toBeCloseTo(free.nosings[k]!.angle!, 6);
          st.nosings.forEach((n, j) => {
            if (j !== k) expect(n.computedAngle, `nez ${j}`).toBeUndefined();
          });
        },
      ),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("escalier miroir : mêmes angles (sens du tournant)", () => {
    fc.assert(
      fc.property(stairArb(undefined, SAME_SIDE_TYPOLOGIES), ({ project }) => {
        const mirror = ProjectSchema.parse({
          ...project,
          stair: {
            ...project.stair,
            layout: {
              ...project.stair.layout,
              turns: project.stair.layout.turns.map((t) => ({
                ...t,
                direction: t.direction === "left" ? "right" : "left",
              })),
            },
          },
        });
        const a = run(project).stepping;
        const b = run(mirror).stepping;
        a.nosings.forEach((n, k) => expect(b.nosings[k]!.angle!).toBeCloseTo(n.angle!, 6));
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("hélicoïdal : aucun angle exposé", () => {
    const p = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      treadsPerTurn: 12,
      floorToFloor: 2700,
      riserCount: 15,
      direction: "left",
    });
    const { stepping } = run(p);
    expect(stepping.nosings.length).toBeGreaterThan(0);
    for (const n of stepping.nosings) {
      expect(n.angle).toBeUndefined();
      expect(n.computedAngle).toBeUndefined();
    }
  });
});
