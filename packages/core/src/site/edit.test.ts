/**
 * Mutateurs purs du site (sous-lot 3a, plan D d'ADR-0010) : murs, trémie, contour de pièce,
 * obstacles. Contrat `EditResult` : même projet si sans effet, refus typé si invalide, arrondi
 * au mm, partage structurel, projet relu à l'identique par `ProjectSchema`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EditResult } from "../model/edit.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { createProject } from "../project/presets.js";
import {
  dragWallFace,
  insertOpeningVertex,
  insertRoomVertex,
  openingEdgeNear,
  removeOpeningVertex,
  removeWall,
  setWallThicknessKeepingFace,
  moveOpeningVertex,
  moveRoomVertex,
  moveWallEnd,
  removeRoomVertex,
  setWallLoadBearing,
  setWallThickness,
  splitWall,
  translateOpening,
  translateWall,
  updateObstacle,
  withObstacle,
  withoutObstacle,
  withRoom,
  withWall,
  openingVertices,
} from "./edit.js";

function base(): Project {
  const p = createProject("quarter-left");
  const w = withWall(p, { x: -100, y: 0 }, { x: -100, y: 3000 }, 200);
  const room = withRoom(w, [
    { x: -1000, y: -1000 },
    { x: 4000, y: -1000 },
    { x: 4000, y: 5000 },
    { x: -1000, y: 5000 },
  ]);
  return ProjectSchema.parse(room.project!);
}

function ok<T extends object>(r: EditResult<T>): Project & {} {
  if (r.error) throw new Error(`refus inattendu : ${r.error.key}`);
  return r.project;
}

/** Relu à l'identique par le schéma. */
function expectSchemaStable(p: Project): void {
  expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p)))).toStrictEqual(p);
}

const wallId = (p: Project) => p.site.walls[0]!.id;

describe("murs", () => {
  it("moveWallEnd arrondit, partage le reste, refuse un axe nul", () => {
    const p = base();
    const q = ok(moveWallEnd(p, wallId(p), "b", { x: -100.4, y: 2500.6 }));
    expect(q.site.walls[0]!.b).toEqual({ x: -100, y: 2501 });
    expect(q.site.walls[0]!.a).toBe(p.site.walls[0]!.a);
    expect(q.stair).toBe(p.stair);
    expect(q.site.room).toBe(p.site.room);
    expectSchemaStable(q);
    expect(moveWallEnd(p, wallId(p), "b", p.site.walls[0]!.b).project).toBe(p);
    expect(moveWallEnd(p, wallId(p), "b", { x: -100.2, y: 0.3 }).error?.key).toBe(
      "site.wall.zeroLength",
    );
    expect(moveWallEnd(p, "nope", "a", { x: 0, y: 0 }).error?.key).toBe("site.edit.unknownWall");
  });

  it("translateWall, épaisseur, porteur", () => {
    const p = base();
    const q = ok(translateWall(p, wallId(p), { x: 10.4, y: -5 }));
    expect(q.site.walls[0]!.a).toEqual({ x: -90, y: -5 });
    expect(translateWall(p, wallId(p), { x: 0.2, y: -0.4 }).project).toBe(p);
    expect(ok(setWallThickness(p, wallId(p), 149.6)).site.walls[0]!.thickness).toBe(150);
    expect(setWallThickness(p, wallId(p), 0.4).error?.key).toBe("site.wall.invalidThickness");
    expect(setWallThickness(p, wallId(p), 200).project).toBe(p);
    expect(ok(setWallLoadBearing(p, wallId(p), true)).site.walls[0]!.loadBearing).toBe(true);
    expect(setWallLoadBearing(p, wallId(p), false).project).toBe(p);
  });

  it("splitWall coupe au projeté, nouvel identifiant, refuse aux extrémités", () => {
    const p = base();
    const r = splitWall(p, wallId(p), { x: 300, y: 1200.4 });
    const q = ok(r);
    expect(r.error ? null : r.id).toBe("wall-2");
    expect(q.site.walls.map((w) => [w.id, w.a, w.b])).toEqual([
      ["wall-1", { x: -100, y: 0 }, { x: -100, y: 1200 }],
      ["wall-2", { x: -100, y: 1200 }, { x: -100, y: 3000 }],
    ]);
    expectSchemaStable(q);
    expect(splitWall(p, wallId(p), { x: 0, y: -50 }).error?.key).toBe("site.edit.wallSplitOutside");
  });
});

describe("murs (sous-lot 5a)", () => {
  it("removeWall retire le mur, refuse un mur inconnu", () => {
    const p = base();
    const q = ok(removeWall(p, wallId(p)));
    expect(q.site.walls).toEqual([]);
    expect(q.stair).toBe(p.stair);
    expectSchemaStable(q);
    expect(removeWall(p, "nope").error?.key).toBe("site.edit.unknownWall");
  });

  it("setWallThicknessKeepingFace garde le nu choisi, l'axe se décale", () => {
    // Axe vertical de (−100, 0) à (−100, 3000), 200 mm : nu gauche x = −200, nu droit x = 0.
    const p = base();
    const q = ok(setWallThicknessKeepingFace(p, wallId(p), 300, "right"));
    const w = q.site.walls[0]!;
    expect(w.thickness).toBe(300);
    expect(w.a).toEqual({ x: -150, y: 0 });
    expect(w.b).toEqual({ x: -150, y: 3000 });
    const k = ok(setWallThicknessKeepingFace(p, wallId(p), 100, "left"));
    expect(k.site.walls[0]!.a).toEqual({ x: -150, y: 0 });
    expect(setWallThicknessKeepingFace(p, wallId(p), 200, "left").project).toBe(p);
    expect(setWallThicknessKeepingFace(p, wallId(p), 0.3, "left").error?.key).toBe(
      "site.wall.invalidThickness",
    );
    expectSchemaStable(q);
  });

  it("dragWallFace : épaisseur mesurée depuis le nu opposé, refus au-delà", () => {
    const p = base();
    // Nu gauche (x = −200) tiré à x = −350.4 : 350 mm, nu droit (x = 0) conservé.
    const q = ok(dragWallFace(p, wallId(p), "left", { x: -350.4, y: 1500 }));
    expect(q.site.walls[0]!.thickness).toBe(350);
    expect(q.site.walls[0]!.a.x).toBeCloseTo(-175, 9);
    expect(dragWallFace(p, wallId(p), "left", { x: 10, y: 0 }).error?.key).toBe(
      "site.wall.invalidThickness",
    );
    expect(dragWallFace(p, "nope", "left", { x: 0, y: 0 }).error?.key).toBe(
      "site.edit.unknownWall",
    );
  });

  it("propriété : le nu tiré suit le pointeur, le nu opposé reste en place", () => {
    fc.assert(
      fc.property(
        fc.record({
          ax: fc.integer({ min: -3000, max: 3000 }),
          ay: fc.integer({ min: -3000, max: 3000 }),
          dx: fc.integer({ min: -3000, max: 3000 }),
          dy: fc.integer({ min: -3000, max: 3000 }),
          t: fc.integer({ min: 1, max: 600 }),
          px: fc.integer({ min: -5000, max: 5000 }),
          py: fc.integer({ min: -5000, max: 5000 }),
          left: fc.boolean(),
        }),
        ({ ax, ay, dx, dy, t, px, py, left }) => {
          fc.pre(Math.hypot(dx, dy) >= 10);
          const p0 = createProject("quarter-left");
          const p = withWall(p0, { x: ax, y: ay }, { x: ax + dx, y: ay + dy }, t);
          const id = p.site.walls.at(-1)!.id;
          const side = left ? "left" : "right";
          const r = dragWallFace(p, id, side, { x: px, y: py });
          // Épaisseur attendue : distance signée du pointeur au nu opposé, selon la normale
          // sortante du nu tiré.
          const w0 = p.site.walls.at(-1)!;
          const L0 = Math.hypot(w0.b.x - w0.a.x, w0.b.y - w0.a.y);
          const sgn = left ? 1 : -1;
          const nx = (-(w0.b.y - w0.a.y) / L0) * sgn;
          const ny = ((w0.b.x - w0.a.x) / L0) * sgn;
          const ox = w0.a.x - (nx * w0.thickness) / 2;
          const oy = w0.a.y - (ny * w0.thickness) / 2;
          const projected = (px - ox) * nx + (py - oy) * ny;
          if (r.error) {
            expect(r.error.key).toBe("site.wall.invalidThickness");
            expect(Math.round(projected)).toBeLessThanOrEqual(0);
            return;
          }
          const moved = r.project.site.walls.at(-1)!;
          expect(Math.abs(moved.thickness - projected)).toBeLessThanOrEqual(0.5 + 1e-9);
          // Axe en mm entiers (décalage arrondi comme une translation).
          for (const q of [moved.a, moved.b]) {
            expect(Number.isInteger(q.x) && Number.isInteger(q.y)).toBe(true);
          }
          // Nu opposé : axe ± t/2 selon la normale ; mesuré avant et après.
          const face = (w: {
            a: { x: number; y: number };
            b: { x: number; y: number };
            thickness: number;
          }) => {
            const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
            const n = { x: -(w.b.y - w.a.y) / L, y: (w.b.x - w.a.x) / L };
            const s = left ? -1 : 1; // nu opposé : droit si l'on tire le gauche
            return {
              x: w.a.x + (n.x * s * w.thickness) / 2,
              y: w.a.y + (n.y * s * w.thickness) / 2,
            };
          };
          const before = face(p.site.walls.at(-1)!);
          const after = face(r.project.site.walls.at(-1)!);
          // Nu opposé conservé à l'arrondi de l'axe au mm près (au plus √2/2 mm).
          expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(
            Math.SQRT1_2 + 1e-9,
          );
          expect(Number.isInteger(r.project.site.walls.at(-1)!.thickness)).toBe(true);
        },
      ),
    );
  });
});

describe("trémie", () => {
  it("moveOpeningVertex : rectangle devenu polygone, refus d'un contour invalide", () => {
    const p = base();
    expect(p.site.opening?.kind).toBe("rect");
    const v = openingVertices(p.site.opening!);
    const q = ok(moveOpeningVertex(p, 2, { x: v[2]!.x + 100.3, y: v[2]!.y }));
    expect(q.site.opening?.kind).toBe("polygon");
    expectSchemaStable(q);
    expect(moveOpeningVertex(p, 2, v[2]!).project).toBe(p);
    expect(moveOpeningVertex(p, 2, v[1]!).error?.key).toBe("site.opening.duplicateVertex");
    // Croisement : le sommet 2 passe de l'autre côté du côté 0-1.
    expect(moveOpeningVertex(p, 2, { x: v[2]!.x, y: v[0]!.y - 500 }).error?.key).toBe(
      "site.opening.selfIntersecting",
    );
    expect(moveOpeningVertex(p, 7, v[0]!).error?.key).toBe("site.edit.vertexIndex");
    const { opening: _o, ...site } = p.site;
    expect(moveOpeningVertex({ ...p, site }, 0, v[0]!).error?.key).toBe("site.edit.noOpening");
  });

  it("moveOpeningVertex rend l'indice du sommet déplacé, contour retourné compris", () => {
    const tri = ProjectSchema.parse({
      ...base(),
      site: {
        ...base().site,
        opening: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 2000, y: 0 },
            { x: 0, y: 1000 },
          ],
        },
      },
    });
    const indexOf = (r: EditResult<{ index: number }>): number => {
      if (r.error) throw new Error(`refus inattendu : ${r.error.key}`);
      return r.index;
    };
    expect(indexOf(moveOpeningVertex(tri, 1, { x: 2100, y: 0 }))).toBe(1);
    // Sommet 0 tiré au-delà du côté opposé : contour retourné, remis en sens trigonométrique.
    const flipped = moveOpeningVertex(tri, 0, { x: 3000, y: 2000 });
    const q = ok(flipped);
    const at = indexOf(flipped);
    const pts = (q.site.opening as { points: { x: number; y: number }[] }).points;
    expect(pts[at]).toEqual({ x: 3000, y: 2000 });
    expect(at).not.toBe(0);
    // Le glisser se poursuit sur le même sommet avec l'indice rendu.
    const next = ok(moveOpeningVertex(q, at, { x: 3000, y: 2200 }));
    expect((next.site.opening as { points: unknown[] }).points).toContainEqual({
      x: 3000,
      y: 2200,
    });
    expect((next.site.opening as { points: unknown[] }).points).toContainEqual({ x: 0, y: 1000 });
    expect(indexOf(moveOpeningVertex(tri, 2, { x: 0, y: 1000 }))).toBe(2);
  });

  it("translateOpening translate rectangle et polygone (cercle compris)", () => {
    const p = base();
    const q = ok(translateOpening(p, { x: 10.2, y: -20.7 }));
    const o = p.site.opening as Extract<typeof p.site.opening, { kind: "rect" }>;
    expect(q.site.opening).toEqual({ ...o, x: o.x + 10, y: o.y - 21 });
    expect(translateOpening(p, { x: 0.3, y: 0 }).project).toBe(p);
    const round: Project = {
      ...p,
      site: {
        ...p.site,
        opening: {
          kind: "polygon",
          points: [
            { x: 0.1, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100.3 },
          ],
          circle: { center: { x: 50, y: 50 }, radius: 10 },
        },
      },
    };
    const r = ok(translateOpening(round, { x: 1, y: 2 }));
    expect(r.site.opening).toEqual({
      kind: "polygon",
      points: [
        { x: 1.1, y: 2 },
        { x: 101, y: 2 },
        { x: 101, y: 102.3 },
      ],
      circle: { center: { x: 51, y: 52 }, radius: 10 },
    });
  });
});

describe("sommets de la trémie (sous-lot 5a)", () => {
  it("insertOpeningVertex : milieu ou projeté sur le côté, indice rendu, refus d'un doublon", () => {
    const p = base();
    const v = openingVertices(p.site.opening!);
    const r = insertOpeningVertex(p, 0);
    const q = ok(r);
    const pts = (q.site.opening as { points: { x: number; y: number }[] }).points;
    expect(pts).toHaveLength(5);
    expect(r.error ? null : r.index).toBe(1);
    expect(pts[1]).toEqual({ x: (v[0]!.x + v[1]!.x) / 2, y: v[0]!.y });
    expectSchemaStable(q);
    // Point hors du côté : projeté sur le côté.
    const r2 = ok(insertOpeningVertex(p, 1, { x: v[1]!.x + 500, y: v[1]!.y + 100.4 }));
    expect((r2.site.opening as { points: unknown[] }).points).toContainEqual({
      x: v[1]!.x,
      y: v[1]!.y + 100,
    });
    expect(insertOpeningVertex(p, 0, v[0]!).error?.key).toBe("site.opening.duplicateVertex");
    expect(insertOpeningVertex(p, 9).error?.key).toBe("site.edit.vertexIndex");
  });

  it("removeOpeningVertex : refusé sous 3 sommets", () => {
    const p = base();
    const tri = ok(removeOpeningVertex(p, 3));
    expect((tri.site.opening as { points: unknown[] }).points).toHaveLength(3);
    expectSchemaStable(tri);
    expect(removeOpeningVertex(tri, 0).error?.key).toBe("site.opening.tooFewPoints");
    expect(removeOpeningVertex(p, -1).error?.key).toBe("site.edit.vertexIndex");
  });

  it("openingEdgeNear : côté le plus proche", () => {
    const p = base();
    const v = openingVertices(p.site.opening!);
    expect(openingEdgeNear(p, { x: (v[1]!.x + v[2]!.x) / 2 + 5, y: (v[1]!.y + v[2]!.y) / 2 })).toBe(
      1,
    );
    expect(openingEdgeNear(p, { x: v[3]!.x - 5, y: (v[3]!.y + v[0]!.y) / 2 })).toBe(3);
    const { opening: _o, ...site } = p.site;
    expect(openingEdgeNear({ ...p, site }, { x: 0, y: 0 })).toBeNull();
  });

  it("propriété : insérer puis retirer le sommet inséré rend le même contour", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        (edge, t) => {
          const p = base();
          const v = openingVertices(p.site.opening!);
          const a = v[edge]!;
          const b = v[(edge + 1) % 4]!;
          const r = insertOpeningVertex(p, edge, {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
          });
          if (r.error) return;
          const back = ok(removeOpeningVertex(r.project, r.index));
          expect(openingVertices(back.site.opening!)).toEqual(v);
        },
      ),
    );
  });
});

describe("contour de pièce", () => {
  it("withRoom arrondit, refuse un contour invalide, se retire", () => {
    const p = base();
    expect(p.site.room?.points[0]).toEqual({ x: -1000, y: -1000 });
    const bad = withRoom(p, [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 30 },
    ]);
    expect(bad.error?.key).toBe("site.room.selfIntersecting");
    const removed = ok(withRoom(p, undefined));
    expect("room" in removed.site).toBe(false);
    expect(withRoom(removed, undefined).project).toBe(removed);
    expectSchemaStable(removed);
  });

  it("déplacer, insérer, retirer un sommet", () => {
    const p = base();
    const moved = ok(moveRoomVertex(p, 1, { x: 4200.4, y: -1000 }));
    expect(moved.site.room!.points[1]).toEqual({ x: 4200, y: -1000 });
    expect(moveRoomVertex(p, 1, { x: 4000, y: -1000 }).project).toBe(p);
    expect(moveRoomVertex(p, 1, { x: -1000, y: -1000 }).error?.key).toBe(
      "site.room.duplicateVertex",
    );
    const inserted = ok(insertRoomVertex(p, 0, { x: 1500, y: -1200 }));
    expect(inserted.site.room!.points).toHaveLength(5);
    expect(inserted.site.room!.points[1]).toEqual({ x: 1500, y: -1200 });
    expect(ok(removeRoomVertex(inserted, 1))).toStrictEqual(p);
    const tri = ok(removeRoomVertex(p, 3));
    expect(removeRoomVertex(tri, 0).error?.key).toBe("site.room.tooFewPoints");
    expect(removeRoomVertex(p, 9).error?.key).toBe("site.edit.vertexIndex");
    const { room: _r, ...site } = p.site;
    expect(moveRoomVertex({ ...p, site }, 0, { x: 0, y: 0 }).error?.key).toBe("site.edit.noRoom");
  });
});

describe("obstacles", () => {
  it("ajout, mise à jour, retrait ; arrondi et refus du schéma", () => {
    const p = base();
    const r = withObstacle(p, {
      kind: "post",
      center: { x: 100.4, y: 200.6 },
      sizeX: 99.6,
      sizeY: 100,
      rotation: 12.4,
    });
    const q = ok(r);
    expect(r.error ? null : r.id).toBe("obstacle-1");
    expect(q.site.obstacles).toEqual([
      {
        kind: "post",
        id: "obstacle-1",
        center: { x: 100, y: 201 },
        sizeX: 100,
        sizeY: 100,
        rotation: 12,
      },
    ]);
    expectSchemaStable(q);
    expect(q.site.walls).toBe(p.site.walls);
    const zone = withObstacle(q, {
      kind: "zone",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0.2 },
        { x: 100, y: 100 },
      ],
    });
    expect(zone.error?.key).toBe("site.obstacle.zone.duplicateVertex");
    const win = withObstacle(q, {
      kind: "window",
      a: { x: 0, y: 0 },
      b: { x: 900, y: 0 },
      sill: 1000,
      head: 900,
    });
    expect(win.error?.key).toBe("site.obstacle.window.headNotAboveSill");
    const u = ok(
      updateObstacle(q, "obstacle-1", { kind: "circularPost", center: { x: 0, y: 0 }, radius: 50 }),
    );
    expect(u.site.obstacles![0]).toEqual({
      kind: "circularPost",
      id: "obstacle-1",
      center: { x: 0, y: 0 },
      radius: 50,
    });
    expect(
      updateObstacle(q, "obstacle-1", {
        kind: "post",
        center: { x: 100, y: 201 },
        sizeX: 100,
        sizeY: 100,
        rotation: 12,
      }).project,
    ).toBe(q);
    expect(
      updateObstacle(q, "x", { kind: "circularPost", center: { x: 0, y: 0 }, radius: 50 }).error
        ?.key,
    ).toBe("site.edit.unknownObstacle");
    const back = ok(withoutObstacle(q, "obstacle-1"));
    expect(back).toStrictEqual(p);
    expect(withoutObstacle(p, "obstacle-1").error?.key).toBe("site.edit.unknownObstacle");
  });
});

describe("propriétés", () => {
  const pt = fc.record({
    x: fc.double({ min: -5000, max: 5000, noNaN: true }),
    y: fc.double({ min: -5000, max: 5000, noNaN: true }),
  });
  const isInt = (v: number) => Number.isInteger(v) && !Object.is(v, -0);

  it("tout résultat est relu à l'identique, arrondi au mm et partage le reste", () => {
    const p = base();
    const id = wallId(p);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), pt, (op, point) => {
        const r =
          op === 0
            ? moveWallEnd(p, id, "a", point)
            : op === 1
              ? translateWall(p, id, point)
              : op === 2
                ? splitWall(p, id, point)
                : op === 3
                  ? moveRoomVertex(p, 2, point)
                  : op === 4
                    ? insertRoomVertex(p, 1, point)
                    : op === 5
                      ? moveOpeningVertex(p, 0, point)
                      : withObstacle(p, { kind: "circularPost", center: point, radius: 30 });
        if (r.error) return;
        const q = r.project;
        expectSchemaStable(q);
        expect(q.stair).toBe(p.stair);
        if (op <= 2) {
          for (const w of q.site.walls)
            for (const v of [w.a, w.b]) expect(isInt(v.x) && isInt(v.y)).toBe(true);
          expect(q.site.room).toBe(p.site.room);
        }
        if (op === 3 || op === 4) {
          for (const v of q.site.room!.points) expect(isInt(v.x) && isInt(v.y)).toBe(true);
          expect(q.site.walls).toBe(p.site.walls);
        }
        if (op === 6)
          expect(
            q.site.obstacles![0]!.kind === "circularPost" && isInt(q.site.obstacles![0]!.center.x),
          ).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
