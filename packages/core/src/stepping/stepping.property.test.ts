import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveLength, curvePointAt } from "../geom2d/curve.js";
import { distanceToCurve } from "../geom2d/intersect.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import { computeLayout } from "../layout/layout.js";
import { findCrossings, monotonyBreaks } from "../balancing/postprocess.js";
import { computeStepping } from "./stepping.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { stairArb } from "./test-helpers.js";

/** Même projet, tournants en sens inverse (escalier miroir). */
function mirrored(project: Project): Project {
  const layout = project.stair.layout;
  return ProjectSchema.parse({
    ...project,
    stair: {
      ...project.stair,
      layout: {
        ...layout,
        turns: layout.turns.map((t) => ({
          ...t,
          direction: t.direction === "left" ? "right" : "left",
        })),
      },
    },
  });
}

const RUNS = Number(process.env["STEPPING_RUNS"] ?? 200);

describe("découpage — propriétés (générateur contraint : quart tournant, U, demi-tournant)", () => {
  it("Σh = H à 1e-6, hauteurs positives, dernier nez au plancher", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const st = computeStepping(project, computeLayout(project));
        const H = project.site.floorToFloor;
        expect(Math.abs(st.rises.reduce((a, b) => a + b, 0) - H)).toBeLessThan(1e-6);
        expect(st.rises.every((h) => h > 0)).toBe(true);
        expect(st.nosings[st.nosings.length - 1]!.z).toBe(H);
        expect(st.nosings.length).toBe(st.riserCount);
        expect(st.treads.length).toBe(st.riserCount - 1);
        expect(st.blondel).toBeCloseTo(2 * st.rise + st.going, 9);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("girons égaux sur Γ à 1e-6 ; nez sur Γ ; reculement = |Γ|", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const layout = computeLayout(project);
        const st = computeStepping(project, layout);
        for (const t of st.treads) expect(Math.abs(t.going - st.going)).toBeLessThan(1e-6);
        for (const n of st.nosings) {
          expect(distanceToCurve(n.p, layout.walkline)).toBeLessThan(1e-6);
          expect(
            Math.hypot(
              n.p.x - curvePointAt(layout.walkline, n.s).x,
              n.p.y - curvePointAt(layout.walkline, n.s).y,
            ),
          ).toBeLessThan(1e-9);
        }
        expect(Math.abs(st.run - curveLength(layout.walkline))).toBeLessThan(1e-6);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("K5 des deux côtés, collets > 0, collets monotones vers l'angle (K3), σ croissants", () => {
    fc.assert(
      fc.property(stairArb(), ({ project, typology }) => {
        const st = computeStepping(project, computeLayout(project));
        const ctx = `${typology} ${JSON.stringify(project.stair.layout)} H=${project.site.floorToFloor} ${project.stair.balancing.method}/${project.stair.balancing.variant}\n${st.notes.join("\n")}`;
        // M1 (option « tracé traditionnel ») peut n'avoir aucune solution admissible sur un
        // demi-tournant large à jour étroit : cas signalé dans les notes (voir le ledger).
        const none = st.notes.some((n) => n.includes("aucun balancement admissible"));
        if (project.stair.balancing.method === "M3") expect(none, ctx).toBe(false);
        fc.pre(!none);
        expect(findCrossings(st.nosings), ctx).toEqual([]);
        for (let k = 0; k + 1 < st.nosings.length; k++) {
          expect(st.nosings[k + 1]!.sigmaInner, ctx).toBeGreaterThanOrEqual(
            st.nosings[k]!.sigmaInner - 1e-6,
          );
          expect(st.nosings[k + 1]!.sigmaOuter, ctx).toBeGreaterThan(st.nosings[k]!.sigmaOuter);
        }
        expect(st.balancedZones.length, ctx).toBeGreaterThan(0);
        for (const t of st.treads.filter((t) => t.kind === "winder")) {
          expect(t.colletChord, ctx).toBeGreaterThan(0);
          expect(t.colletArc, ctx).toBeGreaterThan(0);
        }
        // K3 en arc et en corde. Non garanti (signalé dans les notes, voir le ledger) :
        // - poteau : le bord réel contourne le poteau (développement sur le jour virtuel) et la
        //   corde de la marche d'angle le coupe ;
        // - M1 sur une zone unique de 180° (U serré, demi-tournant) : parfois aucun candidat
        //   régulier (profil en V inadapté à deux angles).
        const turns = project.stair.layout.turns;
        const m1HalfTurn =
          project.stair.balancing.method === "M1" &&
          st.notes.some((n) => n.includes("zone unique"));
        if (turns.every((t) => t.inner.kind !== "newel") && !m1HalfTurn) {
          for (const z of st.balancedZones) {
            const zt = st.treads.filter((t) => t.number - 1 >= z.from && t.number <= z.to);
            expect(monotonyBreaks(zt.map((t) => t.colletArc)), ctx).toEqual([]);
            expect(monotonyBreaks(zt.map((t) => t.colletChord)), ctx).toEqual([]);
          }
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("miroir gauche/droite : mêmes zones et mêmes collets ; recalcul identique après JSON", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const st = computeStepping(project, computeLayout(project));
        const mp = mirrored(project);
        const sm = computeStepping(mp, computeLayout(mp));
        expect(sm.balancedZones).toEqual(st.balancedZones);
        st.treads.forEach((t, i) => {
          expect(Math.abs(sm.treads[i]!.colletChord - t.colletChord)).toBeLessThan(1e-6);
          expect(Math.abs(sm.treads[i]!.goingOuter - t.goingOuter)).toBeLessThan(1e-6);
        });
        const back = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
        expect(computeStepping(back, computeLayout(back))).toEqual(st);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("stabilité : H + 1 mm à n fixé ne change pas le nombre de nez balancés de plus d'une unité", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const st = computeStepping(project, computeLayout(project));
        const bumped = ProjectSchema.parse({
          ...project,
          site: { ...project.site, floorToFloor: project.site.floorToFloor + 1 },
          stair: {
            ...project.stair,
            stepping: { ...project.stair.stepping, riserCount: st.riserCount },
          },
        });
        const sb = computeStepping(bumped, computeLayout(bumped));
        const count = (s: typeof st) => s.nosings.filter((n) => n.balanced).length;
        expect(Math.abs(count(sb) - count(st))).toBeLessThanOrEqual(1);
      }),
      { numRuns: Math.ceil(RUNS / 2) },
    );
  }, 600_000);

  it("marches : polygones CCW d'aire positive, contour ⊇ surface (aire)", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const st = computeStepping(project, computeLayout(project));
        for (const t of st.treads) {
          expect(signedArea(t.walkingSurface)).toBeGreaterThan(0);
          expect(signedArea(t.outline)).toBeGreaterThanOrEqual(signedArea(t.walkingSurface) - 1e-6);
        }
      }),
      { numRuns: Math.ceil(RUNS / 2) },
    );
  }, 600_000);

  it("contour de marche dans sa surface ∪ celle de la marche suivante (débord sous le nez)", () => {
    fc.assert(
      fc.property(stairArb(), ({ project }) => {
        const st = computeStepping(project, computeLayout(project));
        st.treads.forEach((t, i) => {
          const next = st.treads[i + 1];
          if (!next) return; // dernière marche : débord prolongé au-delà des bords
          for (const v of t.outline) {
            const inside = [t.walkingSurface, next.walkingSurface].some(
              (poly) => pointInPolygon(v, poly, 1e-2) !== "outside",
            );
            expect(inside, `M${t.number} : sommet (${v.x} ; ${v.y})`).toBe(true);
          }
        });
      }),
      { numRuns: Math.ceil(RUNS / 2) },
    );
  }, 600_000);
});
