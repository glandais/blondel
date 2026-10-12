import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createProject } from "../project/presets.js";
import { withWall } from "./edit.js";
import { siteSnapContext, snapTranslation, snapWallEnd } from "./siteSnap.js";

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
