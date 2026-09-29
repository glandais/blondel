/**
 * Propriétés de l'assistant sur des sites tirés dans des domaines réalistes (générateurs
 * contraints, CHALLENGE A7) : tout candidat rendu est sans erreur ni bloquant, arrive sur un
 * côté de la trémie, ses marches au-dessus de la sous-face de la dalle sont dans la trémie et
 * il ne heurte aucun mur.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import { ceilingOf, openingPolygon } from "../headroom/headroom.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import type { Wall } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { proposeDesigns } from "./propose.js";

/** Rectangle d'un mur, calculé indépendamment de `placement.ts`. */
function wallRect(w: Wall): Polygon2 {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const l = Math.hypot(dx, dy);
  const nx = (-dy / l) * (w.thickness / 2);
  const ny = (dx / l) * (w.thickness / 2);
  return [
    { x: w.a.x + nx, y: w.a.y + ny },
    { x: w.b.x + nx, y: w.b.y + ny },
    { x: w.b.x - nx, y: w.b.y - ny },
    { x: w.a.x - nx, y: w.a.y - ny },
  ];
}

/** Rétrécit un polygone convexe vers son centre (contact au nu toléré). */
function shrink(poly: Polygon2, d: number): Polygon2 {
  const c = poly.reduce(
    (acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }),
    {
      x: 0,
      y: 0,
    } as Vec2,
  );
  return poly.map((p) => {
    const vx = c.x - p.x;
    const vy = c.y - p.y;
    const l = Math.hypot(vx, vy);
    return { x: p.x + (vx / l) * d, y: p.y + (vy / l) * d };
  });
}

const site = fc.record({
  floorToFloor: fc.integer({ min: 2400, max: 3000 }),
  upperSlabThickness: fc.integer({ min: 150, max: 300 }),
  sizeX: fc.integer({ min: 2000, max: 3600 }),
  sizeY: fc.integer({ min: 800, max: 1400 }),
  wall: fc.constantFrom<"none" | "north" | "east">("none", "north", "east"),
});

describe("propriétés de proposeDesigns", () => {
  it("candidats sans bloquant, arrivée sur la trémie, dalle et murs respectés", () => {
    fc.assert(
      fc.property(site, (s) => {
        const opening = { kind: "rect", x: 0, y: 0, sizeX: s.sizeX, sizeY: s.sizeY } as const;
        const walls: Wall[] =
          s.wall === "north"
            ? [
                {
                  id: "N",
                  a: { x: -5000, y: s.sizeY + 100 },
                  b: { x: 5000, y: s.sizeY + 100 },
                  thickness: 200,
                  loadBearing: true,
                },
              ]
            : s.wall === "east"
              ? [
                  {
                    id: "E",
                    a: { x: s.sizeX + 100, y: -5000 },
                    b: { x: s.sizeX + 100, y: 5000 },
                    thickness: 200,
                    loadBearing: true,
                  },
                ]
              : [];
        const r = proposeDesigns({
          site: {
            floorToFloor: s.floorToFloor,
            upperSlabThickness: s.upperSlabThickness,
            opening,
            walls,
          },
          limits: { maxBuilds: 40, maxCandidates: 6, timeBudgetMs: Number.POSITIVE_INFINITY },
        });
        if (r.candidates.length === 0) {
          expect(r.diagnostics[0]).toMatch(/^Aucune proposition/);
        }
        const poly = openingPolygon(opening)!;
        const wallPolys = walls.map((w) => shrink(wallRect(w), 0.5));
        // Liste principale et variantes : mêmes garanties.
        for (const c of r.candidates.flatMap((h) => [h, ...h.variants])) {
          const model = buildModel(c.project, { memo: false });
          expect(model.errors).toEqual([]);
          expect(model.compliance.summary.bloquant).toBe(0);
          const ceiling = ceilingOf(c.project.site);
          // Marches au-dessus de la sous-face de la dalle : dans la trémie.
          for (const t of model.stepping.treads) {
            if (t.z <= ceiling) continue;
            for (const p of t.walkingSurface)
              expect(pointInPolygon(p, poly, 0.5)).not.toBe("outside");
          }
          // Arrivée (volées) sur le bord de la trémie.
          if (c.typology !== "helical") {
            const last = model.stepping.nosings[model.stepping.nosings.length - 1]!;
            expect(pointInPolygon(last.q, poly, 1e-3)).toBe("boundary");
            expect(pointInPolygon(last.r, poly, 1e-3)).toBe("boundary");
            // Au-delà de l'arrivée, sur la profondeur E : aucun mur (on ne débouche pas dans
            // un mur).
            const mid = { x: (last.q.x + last.r.x) / 2, y: (last.q.y + last.r.y) / 2 };
            const len = Math.hypot(last.r.x - last.q.x, last.r.y - last.q.y);
            let nx = -(last.r.y - last.q.y) / len;
            let ny = (last.r.x - last.q.x) / len;
            if (pointInPolygon({ x: mid.x + nx, y: mid.y + ny }, poly, 0) === "inside") {
              nx = -nx;
              ny = -ny;
            }
            const width = c.project.stair.layout.width;
            for (const k of [0.05, 0.2, 0.5, 0.9]) {
              const p = { x: mid.x + nx * width * k, y: mid.y + ny * width * k };
              for (const wp of wallPolys) expect(pointInPolygon(p, wp, 0)).not.toBe("inside");
            }
            // Giron réel : le giron visé, arrondi des volées au mm par excès (jamais en dessous).
            const g = Number(/-g(\d+)-/.exec(c.id)![1]);
            expect(model.stepping.going).toBeGreaterThanOrEqual(g - 1e-6);
            expect(model.stepping.going).toBeLessThan(g + 1);
          }
          // Aucune marche dans un mur (au nu toléré).
          for (const wp of wallPolys) {
            for (const t of model.stepping.treads) {
              for (const p of t.walkingSurface) expect(pointInPolygon(p, wp, 0)).not.toBe("inside");
              for (const q of wp) expect(pointInPolygon(q, t.walkingSurface, 0)).not.toBe("inside");
            }
          }
        }
      }),
      { numRuns: 10 },
    );
  }, 60_000);
});
