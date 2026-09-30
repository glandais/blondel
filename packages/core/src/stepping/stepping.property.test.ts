import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { curveLength, curvePointAt } from "../geom2d/curve.js";
import { distanceToCurve } from "../geom2d/intersect.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Vec2 } from "../model/primitives.js";
import { computeLayout } from "../layout/layout.js";
import { cornerMonotonyBreaks, cornerPositions } from "../balancing/postprocess.js";
import { findCrossingsOnSides } from "./sides.js";
import { computeStepping } from "./stepping.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { ALL_TYPOLOGIES, stairArb } from "./test-helpers.js";
import { MAX_BALANCED_EXTENT } from "./zones.js";
import { frList } from "../i18n.test-helpers.js";

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

describe("découpage — propriétés (générateur contraint : quart tournant, U, demi-tournant, S / Z)", () => {
  it("Σh = H à 1e-6, hauteurs positives, dernier nez au plancher", () => {
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
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
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
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
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project, typology }) => {
        const layout = computeLayout(project);
        const st = computeStepping(project, layout);
        const ctx = `${typology} ${JSON.stringify(project.stair.layout)} H=${project.site.floorToFloor} ${project.stair.balancing.method}/${project.stair.balancing.variant}\n${frList(st.notes).join("\n")}`;
        // M1 (option « tracé traditionnel ») peut n'avoir aucune solution admissible sur un
        // demi-tournant large à jour étroit : cas signalé dans les notes (voir le ledger).
        const none = frList(st.notes).some((n) => n.includes("aucun balancement admissible"));
        if (project.stair.balancing.method === "M3") expect(none, ctx).toBe(false);
        fc.pre(!none);
        expect(findCrossingsOnSides(layout, st.nosings), ctx).toEqual([]);
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
        // K3 (collets monotones vers l'angle) : depuis CHALLENGE G3 corrigé, c'est une
        // préférence du choix automatique (parmi les zones qui atteignent la cible, ou à
        // `colletTieTolerance` du collet maximal), plus un filtre : une zone irrégulière est
        // retenue quand aucune zone régulière n'atteint la cible (ou le collet maximal). Les
        // cas sans candidat régulier existent (poteau, zone unique de 180° à deux angles vifs,
        // départ libre). Propriété : toute rupture K3 en corde dans une zone est signalée ; K3
        // est évalué **par angle** (une vallée autour de chaque angle du jour de la zone).
        const cornerS = layout.turns
          .filter((t) => t.mode === "winders")
          .map((t) => (t.sStart + t.sEnd) / 2);
        for (const z of st.balancedZones) {
          const zt = st.treads.filter((t) => t.number - 1 >= z.from && t.number <= z.to);
          const corners = cornerPositions(
            st.nosings.slice(z.from, z.to + 1).map((n) => n.s),
            cornerS,
          );
          if (
            cornerMonotonyBreaks(
              zt.map((t) => t.colletChord),
              corners,
            ).length > 0
          ) {
            expect(
              frList(st.notes).some((n) => n.startsWith("K3 :")),
              ctx,
            ).toBe(true);
          }
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("étendue K7 : zones automatiques à au plus 3,5 girons de l'angle ; cible atteinte ou signalée", () => {
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
        const layout = computeLayout(project);
        const st = computeStepping(project, layout);
        const reach = MAX_BALANCED_EXTENT * st.going + 1e-6;
        const target = project.stair.balancing.targetCollet;
        const beyond = frList(st.notes).some((n) => n.includes("étendue dépassée"));
        for (const z of st.balancedZones) {
          const sTo = st.nosings[z.to]!.s;
          const sEnd = Math.max(...layout.turns.filter((t) => t.sStart < sTo).map((t) => t.sEnd));
          // Repli signalé quand aucune zone admissible ne tient dans l'étendue.
          if (beyond) continue;
          expect(layout.turns[z.turn]!.sStart - st.nosings[z.from]!.s).toBeLessThanOrEqual(reach);
          expect(sTo - sEnd).toBeLessThanOrEqual(reach);
        }
        const reached = st.treads.every((t) => t.colletChord >= target - 1e-6);
        if (!reached && st.balancedZones.length > 0) {
          // Collet sous la cible : soit une zone le signale, soit une marche hors zone (nez
          // perpendiculaires encadrant la zone) porte le minimum.
          const signalled = frList(st.notes).some((n) => n.includes("non atteint"));
          const zoneTreads = st.treads.filter((t) =>
            st.balancedZones.some((z) => t.number - 1 >= z.from && t.number <= z.to),
          );
          const inZones = zoneTreads.every((t) => t.colletChord >= target - 1e-6);
          expect(signalled || inZones).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("choix automatique : arrêt anticipé de l'énumération = énumération complète (cible et étendue variées)", () => {
    // Optimisation ADR-0006 : même découpage que l'évaluation de tous les candidats, y compris
    // pour une cible exigeante (aucun arrêt), faible (arrêt précoce) et une étendue courte (repli).
    fc.assert(
      fc.property(
        stairArb(undefined, ALL_TYPOLOGIES),
        fc.integer({ min: 20, max: 250 }),
        fc.constantFrom(0.5, 1, 2, 3.5, 6),
        ({ project }, targetCollet, maxBalancedExtent) => {
          const p = ProjectSchema.parse({
            ...project,
            stair: {
              ...project.stair,
              balancing: { ...project.stair.balancing, targetCollet, maxBalancedExtent },
            },
          });
          const layout = computeLayout(p);
          expect(computeStepping(p, layout)).toEqual(
            computeStepping(p, layout, { exhaustiveZoneSearch: true }),
          );
        },
      ),
      { numRuns: Math.max(20, Math.round(RUNS / 4)) },
    );
  }, 600_000);

  it("miroir gauche/droite : mêmes zones et mêmes collets ; recalcul identique après JSON", () => {
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
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
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
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
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
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
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
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
  it("contour de marche inclus dans l'emprise (à 0,2 mm près ; dernière marche : débord au-delà de l'arrivée)", () => {
    // Emprise = `layout.footprint` (arcs discrétisés à 0,1 mm de flèche, d'où la tolérance).
    // La dernière marche se prolonge de `treads.nosing` sous le plancher d'arrivée : ses sommets
    // hors emprise doivent rester à moins du débord du dernier nez Q_{n−1} R_{n−1}.
    const TOL = 0.2;
    const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
      const ab = V.sub(b, a);
      const t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), ab) / V.dot(ab, ab)));
      return V.distance(p, V.addScaled(a, ab, t));
    };
    fc.assert(
      fc.property(stairArb(undefined, ALL_TYPOLOGIES), ({ project }) => {
        const layout = computeLayout(project);
        const st = computeStepping(project, layout);
        const last = st.nosings[st.nosings.length - 1]!;
        const depth = project.stair.treads.nosing;
        st.treads.forEach((t, i) => {
          for (const v of t.outline) {
            if (pointInPolygon(v, layout.footprint, TOL) !== "outside") continue;
            const isLast = i === st.treads.length - 1;
            expect(
              isLast && distToSegment(v, last.q, last.r) <= depth + TOL,
              `M${t.number} : sommet (${v.x} ; ${v.y}) hors de l'emprise`,
            ).toBe(true);
          }
        });
      }),
      { numRuns: Math.ceil(RUNS / 2) },
    );
  }, 600_000);

  it("windersPerSide imposé (1 à 8) : miroir gauche/droite, croisements K5 signalés", () => {
    // Relecture : les zones imposées n'étaient couvertes par aucune propriété. Avec l'ancienne
    // extrémité `tangent` pour une borne tombant dans la partie tournante, cette propriété
    // échouait (zone trouvée d'un côté, aucune zone admissible de l'autre).
    fc.assert(
      fc.property(
        stairArb(undefined, ALL_TYPOLOGIES),
        fc.integer({ min: 1, max: 8 }),
        ({ project }, w) => {
          const p = ProjectSchema.parse({
            ...project,
            stair: {
              ...project.stair,
              balancing: { ...project.stair.balancing, windersPerSide: w },
            },
          });
          const layout = computeLayout(p);
          const st = computeStepping(p, layout);
          const mp = mirrored(p);
          const sm = computeStepping(mp, computeLayout(mp));
          const ctx = `${JSON.stringify(p.stair.layout)} H=${p.site.floorToFloor} w=${w} ${p.stair.balancing.method}`;
          expect(sm.balancedZones, ctx).toEqual(st.balancedZones);
          // Zone imposée : appliquée même si des lignes se croisent, mais toujours signalée (K5).
          for (const c of findCrossingsOnSides(layout, st.nosings)) {
            expect(
              frList(st.notes).some((n) =>
                n.startsWith(`K5 : les lignes de nez ${c.i} et ${c.j} `),
              ),
              ctx,
            ).toBe(true);
          }
        },
      ),
      { numRuns: Math.ceil(RUNS / 2) },
    );
  }, 600_000);
});
