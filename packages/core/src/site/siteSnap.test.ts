import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createProject } from "../project/presets.js";
import { withWall } from "./edit.js";
import {
  bayCarrier,
  onWallAxis,
  siteSnapContext,
  snapTranslation,
  snapWallEnd,
  wallBayPoint,
} from "./siteSnap.js";

/** Projet sans trémie, deux murs : M1 vertical (x = −100), M2 horizontal (y = 4000). */
function twoWalls() {
  const p0 = createProject("quarter-left");
  const { opening: _o, ...site } = p0.site;
  const p1 = withWall({ ...p0, site }, { x: -100, y: 0 }, { x: -100, y: 3000 }, 200);
  return withWall(p1, { x: 1000, y: 4000 }, { x: 4000, y: 4000 }, 200);
}

describe("accroches des gestes sur le site (sous-lot 5a)", () => {
  it("le contexte exclut l'élément glissé", () => {
    const p = twoWalls();
    const [m1, m2] = p.site.walls;
    const ctx = siteSnapContext(p, { kind: "wall", id: m1!.id });
    // Extrémité de M1 : plus une accroche ; extrémité de M2 : accroche.
    expect(snapWallEnd(ctx, { x: 5000, y: 5000 }, { x: -100, y: 3002 }, 10)).toBeNull();
    expect(snapWallEnd(ctx, { x: 0, y: 0 }, { x: 1003, y: 4002 }, 10)).toMatchObject({
      kind: "point",
      point: { x: 1000, y: 4000 },
    });
    // Directions : axe du site et M2 (M1 exclu).
    expect(ctx.directions).toHaveLength(2);
    expect(siteSnapContext(p, { kind: "wall", id: m2!.id }).directions).toHaveLength(2);
    expect(siteSnapContext(p, { kind: "opening" }).directions).toHaveLength(3);
  });

  it("snapWallEnd : point d'accroche prioritaire, sinon équerre de l'autre bout", () => {
    const p = twoWalls();
    const ctx = siteSnapContext(p, { kind: "wall", id: p.site.walls[0]!.id });
    const sq = snapWallEnd(ctx, { x: 0, y: 0 }, { x: 2000, y: 7 }, 10);
    expect(sq?.kind).toBe("square");
    expect(sq?.point.y).toBeCloseTo(0, 9);
    expect(snapWallEnd(ctx, { x: 0, y: 0 }, { x: 2000, y: 300 }, 10)).toBeNull();
  });

  it("snapTranslation : sommet translaté le plus proche d'une accroche", () => {
    const p = twoWalls();
    const ctx = siteSnapContext(p, { kind: "wall", id: p.site.walls[0]!.id });
    const verts = [
      { x: 0, y: 0 },
      { x: 0, y: 500 },
    ];
    // Le second sommet tombe à 3 mm de (1000, 4000) : vecteur corrigé pour l'y amener.
    const t = snapTranslation(ctx, verts, { x: 1002, y: 3502 }, 10);
    expect(t.delta).toEqual({ x: 1000, y: 3500 });
    expect(t.hit?.point).toEqual({ x: 1000, y: 4000 });
    const far = snapTranslation(ctx, verts, { x: 20000, y: 0 }, 10);
    expect(far).toEqual({ delta: { x: 20000, y: 0 }, hit: null });
  });

  it("propriété : la translation accrochée amène un sommet sur l'accroche, dans le rayon", () => {
    const p = twoWalls();
    const ctx = siteSnapContext(p, { kind: "wall", id: p.site.walls[0]!.id });
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -500, max: 500 }),
            y: fc.integer({ min: -500, max: 500 }),
          }),
          {
            minLength: 1,
            maxLength: 4,
          },
        ),
        fc.record({
          x: fc.double({ min: -6000, max: 6000, noNaN: true }),
          y: fc.double({ min: -6000, max: 6000, noNaN: true }),
        }),
        (verts, delta) => {
          const t = snapTranslation(ctx, verts, delta, 25);
          if (!t.hit) {
            expect(t.delta).toBe(delta);
            return;
          }
          const moved = verts.map((v) => ({ x: v.x + t.delta.x, y: v.y + t.delta.y }));
          expect(
            moved.some((m) => Math.hypot(m.x - t.hit!.point.x, m.y - t.hit!.point.y) < 1e-6),
          ).toBe(true);
          expect(Math.hypot(t.delta.x - delta.x, t.delta.y - delta.y)).toBeLessThanOrEqual(
            25 + 1e-9,
          );
        },
      ),
    );
  });
});

describe("baies posées sur un mur (sous-lot 5b)", () => {
  it("wallBayPoint : mur sous le pointeur, projeté sur son axe ; second point sur le même mur", () => {
    const p = twoWalls();
    const [m1, m2] = p.site.walls;
    expect(wallBayPoint(p.site.walls, { x: -40, y: 1200 }, 10)).toEqual({
      wallId: m1!.id,
      point: { x: -100, y: 1200 },
    });
    // Hors de l'épaisseur (100 mm) plus la tolérance : aucun mur.
    expect(wallBayPoint(p.site.walls, { x: 20, y: 1200 }, 10)).toBeNull();
    // Avec le mur imposé : projeté borné, sans limite de distance.
    expect(wallBayPoint(p.site.walls, { x: 2000, y: 9000 }, 10, m1!.id)).toEqual({
      wallId: m1!.id,
      point: { x: -100, y: 3000 },
    });
    expect(wallBayPoint(p.site.walls, { x: 2000, y: 4050 }, 10)?.wallId).toBe(m2!.id);
    expect(wallBayPoint(p.site.walls, { x: 0, y: 0 }, 10, "nope")).toBeNull();
  });

  it("bayCarrier : mur dont l'axe passe à moins d'une demi-épaisseur des deux extrémités", () => {
    const p = twoWalls();
    const [m1] = p.site.walls;
    expect(bayCarrier(p.site.walls, { x: -100, y: 0 }, { x: -60, y: 900 })?.id).toBe(m1!.id);
    expect(bayCarrier(p.site.walls, { x: -100, y: 0 }, { x: 100, y: 900 })).toBeUndefined();
    expect(onWallAxis(m1!, { x: 500, y: -50 })).toEqual({ x: -100, y: 0 });
  });

  it("bayCarrier : sur deux murs alignés, le tronçon qui contient la baie ; loin du segment, libre", () => {
    const p = twoWalls();
    // M3 prolonge M2 (y = 4000) de 4000 à 7000.
    const p3 = withWall(p, { x: 4000, y: 4000 }, { x: 7000, y: 4000 }, 200);
    const [, m2, m3] = p3.site.walls;
    expect(bayCarrier(p3.site.walls, { x: 5000, y: 4000 }, { x: 5900, y: 4000 })?.id).toBe(m3!.id);
    expect(bayCarrier(p3.site.walls, { x: 2000, y: 4000 }, { x: 2900, y: 4000 })?.id).toBe(m2!.id);
    // À cheval sur la jonction : le tronçon qui en dépasse le moins.
    expect(bayCarrier(p3.site.walls, { x: 3800, y: 4000 }, { x: 4300, y: 4000 })?.id).toBe(m3!.id);
    // Sur le prolongement, au-delà des deux segments : baie libre.
    expect(bayCarrier(p3.site.walls, { x: 8000, y: 4000 }, { x: 8900, y: 4000 })).toBeUndefined();
  });

  it("propriété : le point posé est sur l'axe du mur, dans le segment", () => {
    const p = twoWalls();
    fc.assert(
      fc.property(
        fc.double({ min: -6000, max: 6000, noNaN: true }),
        fc.double({ min: -6000, max: 6000, noNaN: true }),
        (x, y) => {
          const hit = wallBayPoint(p.site.walls, { x, y }, 50);
          if (!hit) return;
          const w = p.site.walls.find((m) => m.id === hit.wallId)!;
          // Sur l'axe (écart nul) et dans le segment (paramètre t dans [0, 1]).
          const ux = w.b.x - w.a.x;
          const uy = w.b.y - w.a.y;
          const L2 = ux * ux + uy * uy;
          const t = ((hit.point.x - w.a.x) * ux + (hit.point.y - w.a.y) * uy) / L2;
          const cross = (ux * (hit.point.y - w.a.y) - uy * (hit.point.x - w.a.x)) / Math.sqrt(L2);
          expect(Math.abs(cross)).toBeLessThanOrEqual(1e-9);
          expect(t).toBeGreaterThanOrEqual(-1e-12);
          expect(t).toBeLessThanOrEqual(1 + 1e-12);
          expect(Math.hypot(x - hit.point.x, y - hit.point.y)).toBeLessThanOrEqual(150 + 1e-9);
        },
      ),
      { numRuns: 500 },
    );
  });
});
