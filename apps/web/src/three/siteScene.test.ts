import { ProjectSchema, createProject, type Project } from "@blondel/core";
import type { Mesh } from "@blondel/geometry";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DOOR_DISPLAY_HEIGHT_MM,
  WINDOW_PANE_MM,
  siteSceneMeshes,
  subtractIntervals,
} from "./siteScene.js";

/** Volume d'un maillage fermé (théorème de flux). */
function volume(m: Mesh | undefined): number {
  if (!m) return 0;
  const p = m.positions;
  let v = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = 3 * m.indices[i]!;
    const b = 3 * m.indices[i + 1]!;
    const c = 3 * m.indices[i + 2]!;
    v +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v / 6;
}

function withSite(site: Partial<Project["site"]>): Project {
  const base = createProject("straight");
  return ProjectSchema.parse({ ...base, site: { ...base.site, ...site } });
}

describe("site dans la vue 3D", () => {
  it("intervalles : [0, top] privé des ouvertures, réunies et bornées", () => {
    expect(subtractIntervals(2500, [])).toEqual([[0, 2500]]);
    expect(subtractIntervals(2500, [[900, 2150]])).toEqual([
      [0, 900],
      [2150, 2500],
    ]);
    expect(
      subtractIntervals(2500, [
        [0, 2040],
        [1000, 2600],
      ]),
    ).toEqual([]);
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: -500, max: 3000 }), fc.integer({ min: -500, max: 3000 })),
        ),
        (holes) => {
          const out = subtractIntervals(2500, holes);
          for (const [a, b] of out) {
            expect(b).toBeGreaterThan(a);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(2500);
            const mid = (a + b) / 2;
            for (const [h0, h1] of holes)
              expect(mid > Math.min(h0, h1) && mid < Math.max(h0, h1)).toBe(false);
          }
        },
      ),
    );
  });

  it("mur percé d'une fenêtre : volume du mur moins la baie, vitrage entre allège et linteau", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 6000 }),
        fc.integer({ min: 100, max: 400 }),
        fc.integer({ min: 0, max: 1500 }),
        fc.integer({ min: 300, max: 1500 }),
        fc.integer({ min: 0, max: 1200 }),
        fc.integer({ min: 200, max: 1200 }),
        (L, t, x0, w, sill, h) => {
          const p = withSite({
            walls: [
              { id: "m", a: { x: 0, y: 0 }, b: { x: L, y: 0 }, thickness: t, loadBearing: false },
            ],
            obstacles: [
              {
                kind: "window",
                id: "f",
                a: { x: x0, y: t / 4 },
                b: { x: Math.min(x0 + w, L), y: t / 4 },
                sill,
                head: sill + h,
              },
            ],
          });
          const top = p.site.floorToFloor - p.site.upperSlabThickness;
          const s = siteSceneMeshes(p.site);
          const bay = Math.min(x0 + w, L) - x0;
          const hole = Math.max(0, Math.min(sill + h, top) - Math.min(sill, top));
          expect(volume(s.solids)).toBeCloseTo(L * t * top - bay * t * hole, -1);
          expect(volume(s.panes)).toBeCloseTo(bay * WINDOW_PANE_MM * hole, -1);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("porte : mur ouvert sur la hauteur d'affichage, vantail ; poteaux et zones", () => {
    const p = withSite({
      walls: [
        { id: "m", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 200, loadBearing: true },
      ],
      obstacles: [
        {
          kind: "door",
          id: "d",
          a: { x: 1000, y: 0 },
          b: { x: 1900, y: 0 },
          hinge: "a",
          swing: "left",
        },
        { kind: "post", id: "p", center: { x: 0, y: 2000 }, sizeX: 200, sizeY: 300, rotation: 30 },
        { kind: "circularPost", id: "c", center: { x: 1000, y: 2000 }, radius: 100 },
        {
          kind: "zone",
          id: "z",
          points: [
            { x: 0, y: 0 },
            { x: 500, y: 0 },
            { x: 0, y: 500 },
          ],
        },
      ],
      room: {
        points: [
          { x: 0, y: 0 },
          { x: 3000, y: 0 },
          { x: 0, y: 3000 },
        ],
      },
    });
    const top = p.site.floorToFloor - p.site.upperSlabThickness;
    const s = siteSceneMeshes(p.site);
    const door = Math.min(DOOR_DISPLAY_HEIGHT_MM, top);
    const disc = 0.5 * 32 * 100 * 100 * Math.sin((2 * Math.PI) / 32);
    expect(volume(s.solids)).toBeCloseTo(
      3000 * 200 * top - 900 * 200 * door + 200 * 300 * top + disc * top,
      -1,
    );
    expect(s.doors).toBeDefined();
    expect(s.panes).toBeUndefined();
    expect(volume(s.zones)).toBeGreaterThan(0);
    expect(s.room).toHaveLength(3);
  });

  it("site vide : aucun maillage", () => {
    const s = siteSceneMeshes(withSite({ walls: [], obstacles: undefined, room: undefined }).site);
    expect(s).toEqual({
      solids: undefined,
      doors: undefined,
      panes: undefined,
      zones: undefined,
      room: [],
    });
  });
});
