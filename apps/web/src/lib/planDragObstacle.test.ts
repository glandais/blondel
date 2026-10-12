/**
 * Contrôleurs des poignées du contour de pièce et des obstacles (sous-lot 5b) : clés, valeurs,
 * positions lues dans le site du projet courant ; pas d'un glisser (sommet du contour, obstacle
 * entier, baie le long de son mur, coin, rotation et rayon d'un poteau, sommet d'une zone) ;
 * clavier ; un geste = une entrée d'historique, Échap restaure.
 */
import {
  buildModel,
  createProject,
  withObstacle,
  withRoom,
  withWall,
  type Model,
  type Obstacle,
  type ObstacleDraft,
  type Project,
  type Vec2,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createProjectStore } from "../store/projectStore.js";
import { siteHandles } from "../views/plan/planHandles.js";
import {
  beginDrag,
  dragStep,
  handleKey,
  handleValue,
  isSiteHandle,
  nudgeHandle,
  nudgeSite,
  siteHandleSelection,
  siteSelectionHandle,
  type DragStepOptions,
  type PlanHandle,
} from "./planDrag.js";
import { createDragSession, gestureMode } from "./planDragSession.js";

function ok(r: { project?: Project; error?: unknown }): Project {
  if (!r.project) throw new Error("refus inattendu");
  return r.project;
}

/**
 * Quart tournant, mur M1 vertical (axe x = −100, de y = 0 à 3000, 200 mm), contour de pièce
 * rectangulaire, et cinq obstacles : porte et fenêtre sur M1, poteau, poteau rond, zone.
 */
function siteProject(): Project {
  let p = withWall(createProject("quarter-left"), { x: -100, y: 0 }, { x: -100, y: 3000 }, 200);
  p = ok(
    withRoom(p, [
      { x: -1000, y: -1000 },
      { x: 4000, y: -1000 },
      { x: 4000, y: 5000 },
      { x: -1000, y: 5000 },
    ]),
  );
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

const P = siteProject();
const MODEL: Model = buildModel(P);
const FREE = { free: true, snapRadius: 30 } as const;
const SNAP = { free: false, snapRadius: 30 } as const;
const DOOR = "obstacle-1";
const WINDOW = "obstacle-2";
const POST = "obstacle-3";
const ROUND = "obstacle-4";
const ZONE = "obstacle-5";

const obstacle = (p: Project, id: string): Obstacle => p.site.obstacles!.find((o) => o.id === id)!;

function step(h: PlanHandle, from: Vec2, to: Vec2, opts: DragStepOptions = FREE, project = P) {
  return dragStep(beginDrag(h, project, MODEL, from, from, 1), to, opts);
}

describe("poignées du contour et des obstacles : clés, sélection, valeurs, positions", () => {
  it("clés, nature, élément désigné", () => {
    expect(handleKey({ kind: "roomVertex", index: 2 })).toBe("roomVertex:2");
    expect(handleKey({ kind: "obstacleMove", id: POST })).toBe(`obstacleMove:${POST}`);
    expect(handleKey({ kind: "bayEnd", id: DOOR, end: "b" })).toBe(`bayEnd:b:${DOOR}`);
    expect(handleKey({ kind: "zoneVertex", id: ZONE, index: 1 })).toBe(`zoneVertex:1:${ZONE}`);
    for (const h of [
      { kind: "roomVertex", index: 0 },
      { kind: "obstacleMove", id: POST },
      { kind: "postSize", id: POST },
      { kind: "postRotate", id: POST },
      { kind: "postRadius", id: ROUND },
      { kind: "bayEnd", id: DOOR, end: "a" },
      { kind: "zoneVertex", id: ZONE, index: 0 },
    ] as const) {
      expect(isSiteHandle(h)).toBe(true);
      // Conflits du contour et des obstacles recalculés par le worker pendant le geste.
      expect(gestureMode(h)).toBe("preview");
    }
    expect(siteHandleSelection({ kind: "roomVertex", index: 1 })).toEqual({
      kind: "roomVertex",
      index: 1,
    });
    expect(siteHandleSelection({ kind: "obstacleMove", id: POST })).toBeNull();
    expect(siteSelectionHandle({ kind: "obstacle", id: POST })).toEqual({
      kind: "obstacleMove",
      id: POST,
    });
    expect(siteSelectionHandle({ kind: "roomVertex", index: 3 })).toEqual({
      kind: "roomVertex",
      index: 3,
    });
    expect(siteSelectionHandle({ kind: "room" })).toBeNull();
  });

  it("valeurs des curseurs lues dans le site", () => {
    expect(handleValue(P, { kind: "roomVertex", index: 2 }, 1e5)).toMatchObject({
      unit: "position",
      position: { x: 4000, y: 5000 },
    });
    expect(handleValue(P, { kind: "postSize", id: POST }, 1e5)).toMatchObject({
      unit: "size",
      now: 200,
      size: { x: 200, y: 100 },
    });
    expect(handleValue(P, { kind: "postRotate", id: POST }, 1e5)).toMatchObject({
      unit: "deg",
      now: 0,
    });
    expect(handleValue(P, { kind: "postRadius", id: ROUND }, 1e5)).toMatchObject({ now: 100 });
    expect(handleValue(P, { kind: "bayEnd", id: WINDOW, end: "b" }, 1e5)).toMatchObject({
      position: { x: -100, y: 2800 },
    });
    expect(handleValue(P, { kind: "postRadius", id: POST }, 1e5)).toBeNull();
    expect(handleValue(P, { kind: "obstacleMove", id: "nope" }, 1e5)).toBeNull();
  });

  it("positions : sommets du contour, poignées propres à chaque type d'obstacle", () => {
    expect(siteHandles({ kind: "room" }, P)).toHaveLength(4);
    expect(siteHandles({ kind: "roomVertex", index: 1 }, P).map((s) => s.at)[1]).toEqual({
      x: 4000,
      y: -1000,
    });
    const post = siteHandles({ kind: "obstacle", id: POST }, P, 2);
    expect(post.map((s) => s.handle.kind)).toEqual(["obstacleMove", "postSize", "postRotate"]);
    expect(post[0]!.at).toEqual({ x: 2000, y: 2000 });
    expect(post[1]!.at).toEqual({ x: 2100, y: 2050 });
    // Rotation : au-delà du milieu du côté x+, à 32 px (2 mm par pixel).
    expect(post[2]!.at.x).toBeCloseTo(2100 + 64, 9);
    expect(post[2]!.at.y).toBeCloseTo(2000, 9);
    expect(siteHandles({ kind: "obstacle", id: ROUND }, P)[1]!.at).toEqual({ x: 3100, y: 500 });
    expect(siteHandles({ kind: "obstacle", id: DOOR }, P).map((s) => s.at)).toEqual([
      { x: -100, y: 950 },
      { x: -100, y: 500 },
      { x: -100, y: 1400 },
    ]);
    expect(siteHandles({ kind: "obstacle", id: ZONE }, P)).toHaveLength(4);
    expect(siteHandles({ kind: "obstacle", id: "nope" }, P)).toEqual([]);
  });
});

describe("glisser des poignées du contour et des obstacles", () => {
  it("sommet du contour : au point (arrondi), accroché à une extrémité de mur", () => {
    const h = { kind: "roomVertex", index: 0 } as const;
    const free = step(h, { x: -1000, y: -1000 }, { x: -1200.4, y: -900 });
    expect(free.project?.site.room!.points[0]).toEqual({ x: -1200, y: -900 });
    const snapped = step(h, { x: -1000, y: -1000 }, { x: -110, y: 10 }, SNAP);
    expect(snapped.snap?.kind).toBe("point");
    expect(snapped.project?.site.room!.points[0]).toEqual({ x: -100, y: 0 });
    // Contour retourné sur lui-même : refus rendu tel quel.
    expect(step(h, { x: -1000, y: -1000 }, { x: 4000, y: -1000 }).error).toBeDefined();
  });

  it("obstacle entier : poteau libre, baie le long de son mur", () => {
    const post = step(
      { kind: "obstacleMove", id: POST },
      { x: 2000, y: 2000 },
      { x: 2300, y: 1900 },
    );
    expect(obstacle(post.project!, POST)).toMatchObject({ center: { x: 2300, y: 1900 } });
    const door = step({ kind: "obstacleMove", id: DOOR }, { x: -100, y: 950 }, { x: 400, y: 1150 });
    expect(obstacle(door.project!, DOOR)).toMatchObject({
      a: { x: -100, y: 700 },
      b: { x: -100, y: 1600 },
    });
    expect(door.snap).toBeNull();
  });

  it("extrémité d'une baie projetée sur le mur ; poignée prise à côté sans saut", () => {
    const h = { kind: "bayEnd", id: WINDOW, end: "a" } as const;
    const r = step(h, { x: -100, y: 2000 }, { x: 300, y: 1500 });
    expect(obstacle(r.project!, WINDOW)).toMatchObject({ a: { x: -100, y: 1500 } });
    // Pointeur pris à 30 mm de la poignée : la poignée suit le déplacement, sans saut.
    const g = beginDrag(h, P, MODEL, { x: -70, y: 2000 }, { x: -100, y: 2000 }, 1);
    expect(dragStep(g, { x: -70, y: 2000 }, FREE).project).toBe(P);
  });

  it("coin et rotation d'un poteau, rayon d'un poteau rond, sommet d'une zone", () => {
    const size = step({ kind: "postSize", id: POST }, { x: 2100, y: 2050 }, { x: 2200, y: 2100 });
    expect(obstacle(size.project!, POST)).toMatchObject({ sizeX: 400, sizeY: 200 });
    const rot = { kind: "postRotate", id: POST } as const;
    // Poignée sur l'axe x+ ; pointeur amené à 40° : accroche à 45° (pas de 15°), libre au degré.
    const at40 = { x: 2000 + 500 * Math.cos(0.698), y: 2000 + 500 * Math.sin(0.698) };
    const snapped = step(rot, { x: 2500, y: 2000 }, at40, SNAP);
    expect(snapped.snap).toEqual({ kind: "angle", angle: 45 });
    expect(obstacle(snapped.project!, POST)).toMatchObject({ rotation: 45 });
    expect(obstacle(step(rot, { x: 2500, y: 2000 }, at40).project!, POST)).toMatchObject({
      rotation: 40,
    });
    const radius = step(
      { kind: "postRadius", id: ROUND },
      { x: 3100, y: 500 },
      { x: 3250, y: 500 },
    );
    expect(obstacle(radius.project!, ROUND)).toMatchObject({ radius: 250 });
    const zone = step(
      { kind: "zoneVertex", id: ZONE, index: 2 },
      { x: 1500, y: 3800 },
      { x: 1600, y: 4200 },
    );
    expect((obstacle(zone.project!, ZONE) as { points: Vec2[] }).points[2]).toEqual({
      x: 1600,
      y: 4200,
    });
  });

  it("propriété : pointeur ramené au départ = projet de départ (même objet)", () => {
    const handles: { h: PlanHandle; at: Vec2 }[] = [
      { h: { kind: "roomVertex", index: 1 }, at: { x: 4000, y: -1000 } },
      { h: { kind: "obstacleMove", id: POST }, at: { x: 2000, y: 2000 } },
      { h: { kind: "obstacleMove", id: DOOR }, at: { x: -100, y: 950 } },
      { h: { kind: "postSize", id: POST }, at: { x: 2100, y: 2050 } },
      { h: { kind: "postRadius", id: ROUND }, at: { x: 3100, y: 500 } },
      { h: { kind: "bayEnd", id: DOOR, end: "b" }, at: { x: -100, y: 1400 } },
      { h: { kind: "zoneVertex", id: ZONE, index: 0 }, at: { x: 1000, y: 3000 } },
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...handles),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        ({ h, at }, dx, dy) => {
          const g = beginDrag(h, P, MODEL, at, at, 1);
          const moved = dragStep(g, { x: at.x + dx, y: at.y + dy }, FREE);
          if (moved.project) {
            // Toute coordonnée saisie reste au mm entier.
            for (const o of moved.project.site.obstacles ?? []) {
              const pts =
                o.kind === "zone"
                  ? o.points
                  : o.kind === "door" || o.kind === "window"
                    ? [o.a, o.b]
                    : [o.center];
              for (const p of pts)
                expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
            }
          }
          expect(dragStep(g, at, FREE).project).toBe(P);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("clavier", () => {
  it("flèches : sommet, obstacle, côtés et rotation d'un poteau, rayon, extrémité de baie", () => {
    const vertex = nudgeSite(P, { kind: "roomVertex", index: 0 }, 10, "x");
    expect(vertex.project?.site.room!.points[0]).toEqual({ x: -990, y: -1000 });
    const post = nudgeSite(P, { kind: "obstacleMove", id: POST }, -100, "y");
    expect(obstacle(post.project!, POST)).toMatchObject({ center: { x: 2000, y: 1900 } });
    const sizeY = nudgeSite(P, { kind: "postSize", id: POST }, 10, "y");
    expect(obstacle(sizeY.project!, POST)).toMatchObject({ sizeX: 200, sizeY: 110 });
    // Poignée de rotation : pas en degrés (1°, Maj : 15°).
    const rot = nudgeHandle(P, MODEL, P, { kind: "postRotate", id: POST }, 1, true);
    expect(obstacle(rot.project!, POST)).toMatchObject({ rotation: 15 });
    const radius = nudgeHandle(P, MODEL, P, { kind: "postRadius", id: ROUND }, -1, false);
    expect(obstacle(radius.project!, ROUND)).toMatchObject({ radius: 90 });
    const end = nudgeHandle(P, MODEL, P, { kind: "bayEnd", id: DOOR, end: "b" }, 1, true, "y");
    expect(obstacle(end.project!, DOOR)).toMatchObject({ b: { x: -100, y: 1500 } });
    // Pas perpendiculaire au mur d'une baie : sans effet (projeté sur le mur).
    expect(nudgeSite(P, { kind: "obstacleMove", id: DOOR }, 10, "x").project).toBe(P);
    expect(nudgeSite(P, { kind: "postRadius", id: POST }, 10, "x").error?.key).toBe(
      "site.edit.obstacleKind",
    );
    expect(nudgeSite(P, { kind: "postSize", id: "nope" }, 10, "x").error?.key).toBe(
      "site.edit.unknownObstacle",
    );
  });
});

describe("session : un geste = une entrée d'historique, Échap restaure", () => {
  function setup() {
    const store = createProjectStore();
    store.getState().replaceProject(P);
    store.getState().endGroup();
    const frames: (() => void)[] = [];
    const session = createDragSession({
      update: (recipe, key, opts) => store.getState().update(recipe, key, opts),
      endGroup: () => store.getState().endGroup(),
      revertGroup: (key) => store.getState().revertGroup(key),
      current: () => store.getState().project,
      requestFrame: (cb) => frames.push(cb),
      cancelFrame: () => undefined,
    });
    const tick = (): void => frames.splice(0).forEach((cb) => cb());
    return { store, session, tick };
  }

  it("sommet du contour glissé en plusieurs pas, puis annulé en une fois", () => {
    const t = setup();
    const p0 = t.store.getState().project;
    const past = t.store.getState().history.past.length;
    const at = { x: 4000, y: 5000 };
    t.session.begin(beginDrag({ kind: "roomVertex", index: 2 }, p0, MODEL, at, at, 1));
    for (let k = 1; k <= 4; k++) {
      t.session.move({ x: 4000 - 100 * k, y: 5000 }, FREE);
      t.tick();
    }
    t.session.end();
    expect(t.store.getState().project.site.room!.points[2]).toEqual({ x: 3600, y: 5000 });
    expect(t.store.getState().history.past).toHaveLength(past + 1);
    t.store.getState().undo();
    expect(t.store.getState().project).toBe(p0);
  });

  it("Échap pendant le glisser d'un obstacle : retour au projet de départ, aucune entrée", () => {
    const t = setup();
    const p0 = t.store.getState().project;
    const past = t.store.getState().history.past.length;
    const at = { x: 2000, y: 2000 };
    t.session.begin(beginDrag({ kind: "obstacleMove", id: POST }, p0, MODEL, at, at, 1));
    t.session.move({ x: 2500, y: 2500 }, FREE);
    t.tick();
    expect(t.store.getState().project).not.toBe(p0);
    t.session.cancel();
    expect(t.store.getState().project).toBe(p0);
    expect(t.store.getState().history.past).toHaveLength(past);
  });
});
