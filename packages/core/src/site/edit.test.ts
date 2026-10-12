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
  circularPostDraftFromEdge,
  dragWallFace,
  insertOpeningVertex,
  insertRoomVertex,
  moveBayEnd,
  moveOpeningVertex,
  moveRoomVertex,
  moveWallEnd,
  moveZoneVertex,
  openingEdgeNear,
  openingVertices,
  postAngleAt,
  postDraftFromCorner,
  removeOpeningVertex,
  removeRoomVertex,
  removeWall,
  resizePostToCorner,
  roomEdgeNear,
  setCircularPostRadiusAt,
  setWallLoadBearing,
  setWallThickness,
  setWallThicknessKeepingFace,
  splitWall,
  translateObstacle,
  translateOpening,
  translateWall,
  updateObstacle,
  withObstacle,
  withoutObstacle,
  withRoom,
  withWall,
  type ObstacleDraft,
} from "./edit.js";
import { bayCarrier } from "./siteSnap.js";

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

describe("gestes sur le contour de pièce et les obstacles (sous-lot 5b)", () => {
  /** Base, plus une porte et une fenêtre sur le mur vertical (axe x = −100), un poteau, une zone. */
  function withObstacles(): Project {
    let p = base();
    const drafts: ObstacleDraft[] = [
      { kind: "door", a: { x: -100, y: 500 }, b: { x: -100, y: 1400 }, hinge: "a", swing: "left" },
      { kind: "window", a: { x: -100, y: 2000 }, b: { x: -100, y: 2800 }, sill: 900, head: 2100 },
      { kind: "post", center: { x: 2000, y: 2000 }, sizeX: 200, sizeY: 100, rotation: 0 },
      { kind: "circularPost", center: { x: 3000, y: 500 }, radius: 100 },
      {
        kind: "zone",
        points: [
          { x: 1000, y: 3000 },
          { x: 2000, y: 3000 },
          { x: 1500, y: 3800 },
        ],
      },
    ];
    for (const d of drafts) p = ok(withObstacle(p, d));
    return p;
  }
  const P5 = withObstacles();
  const ob = (p: Project, id: string) => p.site.obstacles!.find((o) => o.id === id)!;

  it("brouillons d'un poteau et d'un poteau rond (centre, coin ou bord ; arrondis)", () => {
    expect(postDraftFromCorner({ x: 100.4, y: 0 }, { x: 250.2, y: -60.3 })).toEqual({
      kind: "post",
      center: { x: 100, y: 0 },
      sizeX: 300,
      sizeY: 121,
      rotation: 0,
    });
    expect(circularPostDraftFromEdge({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({
      kind: "circularPost",
      center: { x: 0, y: 0 },
      radius: 50,
    });
    // Côté nul : refusé par le schéma à l'ajout.
    expect(
      withObstacle(P5, postDraftFromCorner({ x: 0, y: 0 }, { x: 0, y: 40 })).error,
    ).toBeDefined();
  });

  it("translation : poteau libre, baie le long de son mur, zone ; sans effet = même projet", () => {
    const post = ok(translateObstacle(P5, "obstacle-3", { x: 10.4, y: -20.6 }));
    expect(ob(post, "obstacle-3")).toMatchObject({ center: { x: 2010, y: 1979 } });
    expect(post.site.walls).toBe(P5.site.walls);
    // Porte sur le mur vertical : seule la composante selon y est retenue.
    const door = ok(translateObstacle(P5, "obstacle-1", { x: 300, y: 100 }));
    expect(ob(door, "obstacle-1")).toMatchObject({
      a: { x: -100, y: 600 },
      b: { x: -100, y: 1500 },
    });
    expect(translateObstacle(P5, "obstacle-1", { x: 300, y: 0 }).project).toBe(P5);
    const zone = ok(translateObstacle(P5, "obstacle-5", { x: 0, y: -100 }));
    expect((ob(zone, "obstacle-5") as { points: unknown }).points).toEqual([
      { x: 1000, y: 2900 },
      { x: 2000, y: 2900 },
      { x: 1500, y: 3700 },
    ]);
    expect(translateObstacle(P5, "nope", { x: 1, y: 1 }).error?.key).toBe(
      "site.edit.unknownObstacle",
    );
  });

  it("extrémité d'une baie projetée sur son mur ; baie nulle refusée ; autre obstacle refusé", () => {
    const moved = ok(moveBayEnd(P5, "obstacle-2", "b", { x: 250, y: 3100.4 }));
    expect(ob(moved, "obstacle-2")).toMatchObject({ b: { x: -100, y: 3000 } });
    expect(moveBayEnd(P5, "obstacle-2", "b", { x: -100, y: 2000 }).error?.key).toBe(
      "site.obstacle.window.sameEnds",
    );
    expect(moveBayEnd(P5, "obstacle-3", "a", { x: 0, y: 0 }).error?.key).toBe(
      "site.edit.obstacleKind",
    );
    // Baie sans mur : extrémité au point (arrondi).
    const { walls: _w, ...site } = P5.site;
    const free = { ...P5, site: { ...site, walls: [] } };
    expect(
      ob(ok(moveBayEnd(free, "obstacle-1", "a", { x: 50.4, y: 60 })), "obstacle-1"),
    ).toMatchObject({ a: { x: 50, y: 60 } });
  });

  it("coin et rotation d'un poteau, rayon d'un poteau rond, sommet d'une zone", () => {
    // Poteau tourné de 90° : son axe propre x est l'axe y du site.
    const turned = ok(
      updateObstacle(P5, "obstacle-3", {
        kind: "post",
        center: { x: 2000, y: 2000 },
        sizeX: 200,
        sizeY: 100,
        rotation: 90,
      }),
    );
    const resized = ok(resizePostToCorner(turned, "obstacle-3", { x: 1900, y: 2150 }));
    expect(ob(resized, "obstacle-3")).toMatchObject({ sizeX: 300, sizeY: 200, rotation: 90 });
    expect(resizePostToCorner(P5, "obstacle-3", { x: 2100, y: 2050 }).project).toBe(P5);
    expect(postAngleAt(P5, "obstacle-3", { x: 2000, y: 2500 })).toBeCloseTo(90, 9);
    expect(postAngleAt(P5, "obstacle-3", { x: 2000, y: 2000 })).toBeNull();
    expect(postAngleAt(P5, "obstacle-4", { x: 0, y: 0 })).toBeNull();
    const r = ok(setCircularPostRadiusAt(P5, "obstacle-4", { x: 3000, y: 650.4 }));
    expect(ob(r, "obstacle-4")).toMatchObject({ radius: 150 });
    expect(setCircularPostRadiusAt(P5, "obstacle-4", { x: 3000, y: 500.2 }).error).toBeDefined();
    const z = ok(moveZoneVertex(P5, "obstacle-5", 2, { x: 1500.4, y: 4000 }));
    expect((ob(z, "obstacle-5") as { points: unknown[] }).points[2]).toEqual({ x: 1500, y: 4000 });
    expect(moveZoneVertex(P5, "obstacle-5", 2, { x: 1000, y: 3000 }).error?.key).toBe(
      "site.obstacle.zone.duplicateVertex",
    );
    expect(moveZoneVertex(P5, "obstacle-5", 3, { x: 0, y: 0 }).error?.key).toBe(
      "site.edit.vertexIndex",
    );
    expect(moveZoneVertex(P5, "obstacle-3", 0, { x: 0, y: 0 }).error?.key).toBe(
      "site.edit.obstacleKind",
    );
    expectSchemaStable(z);
  });

  it("contour de pièce : côté le plus proche et projeté ; sommet inséré au milieu sans point", () => {
    const p = base();
    expect(roomEdgeNear(p, { x: 1500, y: -1100 })).toEqual({
      edge: 0,
      point: { x: 1500, y: -1000 },
    });
    expect(roomEdgeNear(p, { x: 4100, y: 2000 })?.edge).toBe(1);
    const { room: _r, ...site } = p.site;
    expect(roomEdgeNear({ ...p, site }, { x: 0, y: 0 })).toBeNull();
    const mid = ok(insertRoomVertex(p, 3));
    expect(mid.site.room!.points[4]).toEqual({ x: -1000, y: 2000 });
  });

  it("translation d'une baie bornée au segment de son mur", () => {
    const beyond = ok(translateObstacle(P5, "obstacle-1", { x: 0, y: 5000 }));
    expect(ob(beyond, "obstacle-1")).toMatchObject({
      a: { x: -100, y: 2100 },
      b: { x: -100, y: 3000 },
    });
    const before = ok(translateObstacle(P5, "obstacle-1", { x: 0, y: -5000 }));
    expect(ob(before, "obstacle-1")).toMatchObject({
      a: { x: -100, y: 0 },
      b: { x: -100, y: 900 },
    });
    // Déjà en butée : sans effet.
    expect(translateObstacle(beyond, "obstacle-1", { x: 0, y: 100 }).project).toBe(beyond);
  });

  it("mur coupé par splitWall : la baie reste portée par le tronçon qui la contient", () => {
    const w = withWall(base(), { x: 0, y: -2000 }, { x: 5000, y: -2000 }, 200);
    const long = w.site.walls[1]!;
    const split = splitWall(w, long.id, { x: 2000, y: -2000 });
    if (split.error) throw new Error(split.error.key);
    const cut = split.project;
    const second = split.id;
    const p = ok(
      withObstacle(cut, {
        kind: "door",
        a: { x: 3000, y: -2000 },
        b: { x: 3900, y: -2000 },
        hinge: "a",
        swing: "left",
      }),
    );
    const id = p.site.obstacles!.at(-1)!.id;
    const door0 = ob(p, id) as { a: { x: number; y: number }; b: { x: number; y: number } };
    expect(bayCarrier(p.site.walls, door0.a, door0.b)?.id).toBe(second);
    expect(ob(ok(moveBayEnd(p, id, "b", { x: 4200, y: -2000 })), id)).toMatchObject({
      b: { x: 4200, y: -2000 },
    });
    expect(ob(ok(moveBayEnd(p, id, "b", { x: 3700, y: -1950 })), id)).toMatchObject({
      b: { x: 3700, y: -2000 },
    });
    // Glissée au-delà de l'extrémité du tronçon : bornée à 5000.
    expect(ob(ok(translateObstacle(p, id, { x: 3000, y: 0 })), id)).toMatchObject({
      a: { x: 4100, y: -2000 },
      b: { x: 5000, y: -2000 },
    });
    // Sur le prolongement du mur, loin de son segment : baie libre.
    expect(bayCarrier(p.site.walls, { x: 7000, y: -2000 }, { x: 7900, y: -2000 })).toBeUndefined();
  });

  it("propriété : sur un mur oblique, des glissements répétés gardent la baie sur l'axe", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.array(
          fc.record({
            x: fc.double({ min: -600, max: 600, noNaN: true }),
            y: fc.double({ min: -600, max: 600, noNaN: true }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (angle, deltas) => {
          const u = { x: Math.cos(angle), y: Math.sin(angle) };
          const at = (t: number) => ({
            x: Math.round(-3000 + t * u.x),
            y: Math.round(-6000 + t * u.y),
          });
          const a0 = at(0);
          const b0 = at(4000);
          let p = withWall(base(), a0, b0, 200);
          const wall = p.site.walls[1]!;
          p = ok(
            withObstacle(p, {
              kind: "window",
              a: at(1000),
              b: at(1900),
              sill: 900,
              head: 2100,
            }),
          );
          const id = p.site.obstacles!.at(-1)!.id;
          const L = Math.hypot(b0.x - a0.x, b0.y - a0.y);
          const w = { x: (b0.x - a0.x) / L, y: (b0.y - a0.y) / L };
          const offAxis = (q: { x: number; y: number }) =>
            Math.abs(w.x * (q.y - a0.y) - w.y * (q.x - a0.x));
          const along = (q: { x: number; y: number }) => w.x * (q.x - a0.x) + w.y * (q.y - a0.y);
          const width = (o: { a: { x: number; y: number }; b: { x: number; y: number } }) =>
            Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
          const first = ob(p, id) as { a: { x: number; y: number }; b: { x: number; y: number } };
          for (const d of deltas) {
            const r = translateObstacle(p, id, d);
            if (r.error) throw new Error(r.error.key);
            p = r.project;
            const o = ob(p, id);
            if (o.kind !== "window") throw new Error("fenêtre attendue");
            expect(bayCarrier(p.site.walls, o.a, o.b)?.id).toBe(wall.id);
            expect(offAxis(o.a)).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
            expect(offAxis(o.b)).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
            expect(width(o)).toBeCloseTo(width(first), 9);
            for (const q of [o.a, o.b]) {
              expect(along(q)).toBeGreaterThanOrEqual(-1);
              expect(along(q)).toBeLessThanOrEqual(L + 1);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it("propriété : une baie déplacée par ses gestes reste sur l'axe de son mur", () => {
    const pt = fc.record({
      x: fc.double({ min: -5000, max: 5000, noNaN: true }),
      y: fc.double({ min: -5000, max: 5000, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom("a" as const, "b" as const), pt, (move, end, q) => {
        const r = move
          ? translateObstacle(P5, "obstacle-1", q)
          : moveBayEnd(P5, "obstacle-1", end, q);
        if (r.error) return;
        const door = ob(r.project, "obstacle-1");
        if (door.kind !== "door") throw new Error("porte attendue");
        // Mur vertical d'axe x = −100, de y = 0 à 3000 : extrémités sur l'axe (x exact).
        expect(door.a.x).toBe(-100);
        expect(door.b.x).toBe(-100);
        // Dans le segment du mur (y de 0 à 3000), entier, et toujours portée par ce mur.
        for (const y of [door.a.y, door.b.y]) {
          expect(y >= 0 && y <= 3000 && Number.isInteger(y)).toBe(true);
        }
        expect(bayCarrier(r.project.site.walls, door.a, door.b)?.id).toBe(P5.site.walls[0]!.id);
        expectSchemaStable(r.project);
      }),
      { numRuns: 300 },
    );
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
