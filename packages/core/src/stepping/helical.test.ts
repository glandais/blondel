import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findCrossings } from "../balancing/postprocess.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { helicalShapeArb, makeHelicalProject } from "../layout/helical-test-helpers.js";
import { computeLayout } from "../layout/layout.js";
import { SteppingError } from "./errors.js";
import { computeStepping } from "./stepping.js";

const TOL = 1e-6;

describe("computeStepping — hélicoïdal", () => {
  it("propriétés : Σh = H, girons égaux sur Γ, collet = r_i·Δθ, nez rayonnants", () => {
    fc.assert(
      fc.property(helicalShapeArb, (shape) => {
        const project = makeHelicalProject(shape);
        const layout = computeLayout(project);
        const h = layout.helical!;
        const st = computeStepping(project, layout);
        const n = st.riserCount;
        // Σh = H exactement (à 1e-6).
        expect(Math.abs(st.rises.reduce((a, b) => a + b, 0) - shape.floorToFloor)).toBeLessThan(
          TOL,
        );
        expect(st.treads).toHaveLength(n - 1);
        expect(st.balancedZones).toEqual([]);
        // Girons égaux sur Γ : r_w·Δθ.
        const g = h.walklineRadius * h.stepAngle;
        expect(st.going).toBeCloseTo(g, 9);
        for (let k = 0; k + 1 < n; k++) {
          const a = st.nosings[k]!;
          const b = st.nosings[k + 1]!;
          expect(b.s - a.s).toBeCloseTo(g, 6);
          expect(V.distance(a.p, b.p)).toBeCloseTo(
            2 * h.walklineRadius * Math.sin(h.stepAngle / 2),
            6,
          );
          const t = st.treads[k]!;
          expect(t.going).toBeCloseTo(g, 9);
          // Collet en arc r_i·Δθ, en corde 2·r_i·sin(Δθ/2) = |Q_{k+1} − Q_k|.
          expect(t.colletArc).toBeCloseTo(h.innerRadius * h.stepAngle, 9);
          expect(t.colletChord).toBeCloseTo(V.distance(a.q, b.q), 6);
          expect(t.goingOuter).toBeCloseTo(h.outerRadius * h.stepAngle, 9);
          expect(t.kind).toBe("winder");
          // Surface de marche : secteur de couronne (polygone inscrit, flèche 0,1 mm).
          const ring = ((h.outerRadius ** 2 - h.innerRadius ** 2) * h.stepAngle) / 2;
          const area = Math.abs(signedArea(t.walkingSurface));
          expect(area).toBeLessThanOrEqual(ring + TOL);
          expect(area).toBeGreaterThan(ring * 0.999);
          // Le contour de pièce contient la surface de marche.
          const mid = V.lerp(V.lerp(a.q, a.r, 0.5), V.lerp(b.q, b.r, 0.5), 0.5);
          expect(pointInPolygon(mid, t.outline)).toBe("inside");
        }
        for (const nosing of st.nosings) {
          // Q, P, R sur les cercles, alignés sur le rayon (direction radiale sortante).
          expect(V.distance(nosing.q, h.center)).toBeCloseTo(h.innerRadius, 6);
          expect(V.distance(nosing.p, h.center)).toBeCloseTo(h.walklineRadius, 6);
          expect(V.distance(nosing.r, h.center)).toBeCloseTo(h.outerRadius, 6);
          expect(V.cross(nosing.dir, V.sub(nosing.r, h.center))).toBeCloseTo(0, 6);
          expect(V.dot(nosing.dir, V.sub(nosing.r, nosing.q))).toBeGreaterThan(0);
          expect(nosing.balanced).toBe(false);
        }
        expect(st.nosings[n - 1]!.z).toBe(shape.floorToFloor);
        // Sous-faces : une par marche (+ palier), à z_k − épaisseur.
        expect(st.soffits).toHaveLength(n - 1);
        st.soffits!.forEach((sf, k) => {
          expect(sf.z).toBeCloseTo(st.nosings[k]!.z - shape.treadThickness!, 9);
          expect(sf.sStart).toBeCloseTo(st.nosings[k]!.s, 9);
        });
        // Moins d'un tour : aucune ligne de nez ne se croise.
        if (h.totalAngle < 2 * Math.PI - 1e-9) expect(findCrossings(st.nosings)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("miroir gauche / droite : mêmes girons, collets et altitudes", () => {
    const base = {
      outerRadius: 900,
      coreRadius: 70,
      treadsPerTurn: 12,
      floorToFloor: 2700,
      riserCount: 15,
    };
    const l = makeHelicalProject({ ...base, direction: "left" });
    const r = makeHelicalProject({ ...base, direction: "right" });
    const sl = computeStepping(l, computeLayout(l));
    const sr = computeStepping(r, computeLayout(r));
    sl.nosings.forEach((a, k) => {
      const b = sr.nosings[k]!;
      expect(b.p.x).toBeCloseTo(a.p.x, 9);
      expect(b.p.y).toBeCloseTo(-a.p.y, 9);
      expect(b.z).toBe(a.z);
    });
    expect(sr.treads.map((t) => t.colletArc)).toEqual(sl.treads.map((t) => t.colletArc));
  });

  it("propriété : débord de nez du côté de la montée, à gauche comme à droite", () => {
    fc.assert(
      fc.property(
        helicalShapeArb.map((s) => ({ ...s, nosing: 30 })),
        (shape) => {
          const project = makeHelicalProject(shape);
          const layout = computeLayout(project);
          const h = layout.helical!;
          const st = computeStepping(project, layout);
          const sign = h.direction === "left" ? 1 : -1;
          const at = (u: number, r: number) =>
            V.addScaled(h.center, V.fromAngle(h.startAngle + sign * u), r);
          const r = h.walklineRadius;
          const delta = Math.asin(30 / r);
          st.treads.forEach((t, k) => {
            const u1 = (k + 1) * h.stepAngle;
            // Sous le nez supérieur (débord) : dans la pièce ; juste avant le nez avant : dehors.
            expect(pointInPolygon(at(u1 + delta / 2, r), t.outline)).toBe("inside");
            expect(pointInPolygon(at(u1 + delta * 1.5, r), t.outline)).toBe("outside");
            expect(pointInPolygon(at(k * h.stepAngle - 0.01, r), t.outline)).toBe("outside");
            // Surface de marche : sans débord.
            expect(pointInPolygon(at(u1 + delta / 2, r), t.walkingSurface)).toBe("outside");
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  it("réglages des volées (giron cible, surcharges de nez) : signalés, jamais ignorés en silence", () => {
    const p = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      treadsPerTurn: 12,
      floorToFloor: 2700,
      riserCount: 15,
    });
    const q = {
      ...p,
      stair: {
        ...p.stair,
        stepping: { ...p.stair.stepping, targetGoing: 250 },
        nosingOverrides: [{ kind: "fixed" as const, index: 3 }],
      },
    };
    const plain = computeStepping(p, computeLayout(p));
    expect(plain.notes).toHaveLength(1);
    const st = computeStepping(q, computeLayout(q));
    expect(st.notes.some((n) => /Giron cible \(250 mm\) sans effet/.test(n))).toBe(true);
    expect(st.notes.some((n) => /nez 3 non appliquée/.test(n))).toBe(true);
    expect(st.nosings.map((n) => n.p)).toEqual(plain.nosings.map((n) => n.p));
  });

  it("palier d'arrivée : sous-face supplémentaire au niveau H − épaisseur", () => {
    const p = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 70,
      direction: "left",
      treadsPerTurn: 12,
      floorToFloor: 2700,
      riserCount: 15,
      landingAngle: 45,
    });
    const st = computeStepping(p, computeLayout(p));
    expect(st.soffits).toHaveLength(15);
    const landing = st.soffits![14]!;
    expect(landing.tread).toBeUndefined();
    expect(landing.z).toBe(2700 - 40);
  });

  it("débord de nez ≥ rayon du jour : erreur explicite", () => {
    const p = makeHelicalProject({
      outerRadius: 900,
      coreRadius: 20,
      core: "well",
      direction: "left",
      floorToFloor: 2700,
      nosing: 30,
    });
    expect(() => computeStepping(p, computeLayout(p))).toThrow(SteppingError);
  });
});
