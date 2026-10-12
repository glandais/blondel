/**
 * Contrôleurs des poignées du site (sous-lot 5a) : extrémité de mur (accroches aux autres murs,
 * à l'équerre), mur entier, nu (épaisseur, nu opposé conservé), trémie entière, sommet de trémie
 * (réindexé par la forme canonique) ; clavier ; un geste = une entrée d'historique, Échap
 * restaure ; positions des poignées lues dans le site du projet courant.
 */
import {
  buildModel,
  circularOpening,
  createProject,
  openingVertices,
  withWall,
  type Model,
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

/**
 * Quart tournant et deux murs : M1 vertical (axe x = −100, de y = 0 à 3000, 200 mm), M2
 * horizontal (axe y = 4000, de x = 2000 à 5000).
 */
function siteProject(): Project {
  const p0 = createProject("quarter-left");
  const p1 = withWall(p0, { x: -100, y: 0 }, { x: -100, y: 3000 }, 200);
  return withWall(p1, { x: 2000, y: 4000 }, { x: 5000, y: 4000 }, 200);
}

const P = siteProject();
const MODEL: Model = buildModel(P);
const M1 = P.site.walls[0]!.id;
const M2 = P.site.walls[1]!.id;
const SNAP = { free: false, snapRadius: 30 } as const;
const FREE = { free: true, snapRadius: 30 } as const;

function step(h: PlanHandle, from: Vec2, to: Vec2, opts: DragStepOptions = FREE, project = P) {
  return dragStep(beginDrag(h, project, MODEL, from, from, 1), to, opts);
}

describe("poignées du site : clés, sélection, valeurs", () => {
  it("clés, nature, élément désigné", () => {
    const end = { kind: "wallEnd", id: M1, end: "b" } as const;
    expect(handleKey(end)).toBe(`wallEnd:b:${M1}`);
    expect(handleKey({ kind: "wallFace", id: M1, side: "left" })).toBe(`wallFace:left:${M1}`);
    expect(handleKey({ kind: "openingVertex", index: 2 })).toBe("openingVertex:2");
    expect(isSiteHandle(end)).toBe(true);
    expect(isSiteHandle({ kind: "move" })).toBe(false);
    expect(gestureMode(end)).toBe("preview");
    expect(gestureMode({ kind: "openingMove" })).toBe("preview");
    expect(siteHandleSelection(end)).toEqual({ kind: "wallEnd", id: M1, end: "b" });
    expect(siteHandleSelection({ kind: "wallMove", id: M1 })).toBeNull();
    expect(siteSelectionHandle({ kind: "wall", id: M1 })).toEqual({ kind: "wallMove", id: M1 });
    expect(siteSelectionHandle({ kind: "opening" })).toEqual({ kind: "openingMove" });
    expect(siteSelectionHandle({ kind: "stair" })).toBeNull();
  });

  it("valeurs des curseurs lues dans le site", () => {
    expect(handleValue(P, { kind: "wallEnd", id: M1, end: "b" }, 1e5)).toMatchObject({
      unit: "position",
      position: { x: -100, y: 3000 },
    });
    expect(handleValue(P, { kind: "wallFace", id: M1, side: "right" }, 1e5)).toMatchObject({
      unit: "mm",
      now: 200,
    });
    expect(handleValue(P, { kind: "wallMove", id: "nope" }, 1e5)).toBeNull();
    const v = openingVertices(P.site.opening!);
    expect(handleValue(P, { kind: "openingVertex", index: 1 }, 1e5)?.position).toEqual(v[1]);
  });

  it("positions : mur (nus, milieu, extrémités), trémie (centre et sommets)", () => {
    const wall = siteHandles({ kind: "wall", id: M1 }, P);
    expect(wall.map((s) => handleKey(s.handle))).toEqual([
      `wallFace:left:${M1}`,
      `wallFace:right:${M1}`,
      `wallMove:${M1}`,
      `wallEnd:a:${M1}`,
      `wallEnd:b:${M1}`,
    ]);
    // Axe vers +y : nu gauche à x = −200, nu droit à x = 0.
    expect(wall[0]!.at).toEqual({ x: -200, y: 1500 });
    expect(wall[1]!.at).toEqual({ x: 0, y: 1500 });
    expect(wall[2]!.at).toEqual({ x: -100, y: 1500 });
    expect(siteHandles({ kind: "wallEnd", id: M1, end: "a" }, P)).toHaveLength(5);
    const n = openingVertices(P.site.opening!).length;
    expect(siteHandles({ kind: "opening" }, P)).toHaveLength(n + 1);
    expect(siteHandles({ kind: "openingVertex", index: 0 }, P)).toHaveLength(n);
    expect(siteHandles({ kind: "stair" }, P)).toEqual([]);
    expect(siteHandles({ kind: "wall", id: "nope" }, P)).toEqual([]);
  });
});

describe("glisser des poignées du site", () => {
  it("pointeur au point de prise : projet du début (même objet)", () => {
    const handles: PlanHandle[] = [
      { kind: "wallEnd", id: M1, end: "a" },
      { kind: "wallMove", id: M1 },
      { kind: "wallFace", id: M1, side: "left" },
      { kind: "openingMove" },
      { kind: "openingVertex", index: 1 },
    ];
    for (const h of handles) {
      const at = siteHandles(
        h.kind.startsWith("opening") ? { kind: "opening" } : { kind: "wall", id: M1 },
        P,
      ).find((s) => handleKey(s.handle) === handleKey(h))!.at;
      const r = step(h, at, at);
      expect(r.error, handleKey(h)).toBeUndefined();
      expect(r.project, handleKey(h)).toBe(P);
    }
  });

  it("extrémité : accroche à l'extrémité d'un autre mur, sinon à l'équerre, Maj libre", () => {
    const end = { kind: "wallEnd", id: M1, end: "b" } as const;
    const from = { x: -100, y: 3000 };
    // Près de l'extrémité a de M2 (2000, 4000).
    const near = step(end, from, { x: 2010, y: 3985 }, SNAP);
    expect(near.project?.site.walls[0]!.b).toEqual({ x: 2000, y: 4000 });
    expect(near.snap).toMatchObject({ kind: "point", snap: "point" });
    // Presque vertical depuis a (−100, 0) : ramené à x = −100.
    const square = step(end, from, { x: -88, y: 3500 }, SNAP);
    expect(square.project?.site.walls[0]!.b).toEqual({ x: -100, y: 3500 });
    expect(square.snap?.kind).toBe("square");
    const free = step(end, from, { x: -88, y: 3500 }, FREE);
    expect(free.project?.site.walls[0]!.b).toEqual({ x: -88, y: 3500 });
    expect(free.snap).toBeNull();
    // Extrémité confondue avec l'autre : refus du mutateur.
    expect(step(end, from, { x: -100, y: 0 }, FREE).error?.key).toBe("site.wall.zeroLength");
  });

  it("mur entier : translation, accroche par l'extrémité la plus proche", () => {
    const h = { kind: "wallMove", id: M1 } as const;
    const grab = { x: -100, y: 1500 };
    const r = step(h, grab, { x: 300.4, y: 1500 }, FREE);
    expect(r.project?.site.walls[0]!.a).toEqual({ x: 300, y: 0 });
    expect(r.project?.site.walls[1]).toBe(P.site.walls[1]);
    // b (−100, 3000) amené près de (2000, 4000) : accroché.
    const s = step(h, grab, { x: 1990, y: 2510 }, SNAP);
    expect(s.project?.site.walls[0]!.b).toEqual({ x: 2000, y: 4000 });
    expect(s.snap?.kind).toBe("point");
  });

  it("nu : épaisseur, nu opposé conservé", () => {
    const h = { kind: "wallFace", id: M1, side: "left" } as const;
    const r = step(h, { x: -200, y: 1500 }, { x: -300, y: 1500 }, FREE);
    const w = r.project!.site.walls[0]!;
    expect(w.thickness).toBe(300);
    expect(w.a.x - w.thickness / 2 + w.thickness).toBeCloseTo(0, 9); // nu droit à x = 0
    expect(step(h, { x: -200, y: 1500 }, { x: 50, y: 1500 }, FREE).error?.key).toBe(
      "site.wall.invalidThickness",
    );
  });

  it("trémie : translation ; sommet : déplacement, réindexation au retournement", () => {
    const v = openingVertices(P.site.opening!);
    const moved = step({ kind: "openingMove" }, v[0]!, { x: v[0]!.x + 50, y: v[0]!.y }, FREE);
    expect(openingVertices(moved.project!.site.opening!)[0]).toEqual({
      x: v[0]!.x + 50,
      y: v[0]!.y,
    });
    const r = step({ kind: "openingVertex", index: 2 }, v[2]!, { x: v[2]!.x + 100, y: v[2]!.y });
    expect(openingVertices(r.project!.site.opening!)[2]).toEqual({
      x: v[2]!.x + 100,
      y: v[2]!.y,
    });
    expect(r.project ? "selection" in r && r.selection : null).toBeFalsy();
    // Sommet confondu avec un voisin : refus.
    expect(step({ kind: "openingVertex", index: 2 }, v[2]!, v[1]!).error?.key).toBe(
      "site.opening.duplicateVertex",
    );
  });

  it("propriété : un pas de sommet de trémie rend un projet valide ou un refus, jamais d'exception", () => {
    const v = openingVertices(P.site.opening!);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: v.length - 1 }),
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -5000, max: 5000 }),
        (i, x, y) => {
          const r = step({ kind: "openingVertex", index: i }, v[i]!, { x, y });
          if (r.error) return;
          const pts = openingVertices(r.project.site.opening!);
          const at = r.selection?.kind === "openingVertex" ? r.selection.index : i;
          expect(pts[at]).toEqual({ x, y });
        },
      ),
    );
  });
});

describe("clavier des poignées du site", () => {
  it("flèches : extrémité, mur, trémie, sommet ; épaisseur d'un nu", () => {
    const end = nudgeSite(P, { kind: "wallEnd", id: M1, end: "b" }, 10, "y");
    expect(end.project?.site.walls[0]!.b).toEqual({ x: -100, y: 3010 });
    const wall = nudgeSite(P, { kind: "wallMove", id: M2 }, -100, "x");
    expect(wall.project?.site.walls[1]!.a).toEqual({ x: 1900, y: 4000 });
    const face = nudgeHandle(P, MODEL, P, { kind: "wallFace", id: M1, side: "right" }, 1, false);
    expect(face.project?.site.walls[0]!.thickness).toBe(210);
    // Nu gauche (x = −200) conservé : axe à −95.
    expect(face.project?.site.walls[0]!.a.x).toBeCloseTo(-95, 9);
    const opening = nudgeHandle(P, MODEL, P, { kind: "openingMove" }, -1, true, "y");
    const v = openingVertices(P.site.opening!);
    expect(openingVertices(opening.project!.site.opening!)[0]).toEqual({
      x: v[0]!.x,
      y: v[0]!.y - 100,
    });
    const vertex = nudgeSite(P, { kind: "openingVertex", index: 1 }, 10, "x");
    expect(openingVertices(vertex.project!.site.opening!)[1]).toEqual({
      x: v[1]!.x + 10,
      y: v[1]!.y,
    });
    expect(nudgeSite(P, { kind: "wallEnd", id: "nope", end: "a" }, 10, "x").error?.key).toBe(
      "site.edit.unknownWall",
    );
  });
});

describe("session : un geste du site = une annulation, Échap restaure, sommet réindexé", () => {
  function setup(project: Project) {
    const store = createProjectStore();
    store.getState().replaceProject(project);
    store.getState().endGroup();
    const frames: (() => void)[] = [];
    const steps: { selection?: unknown }[] = [];
    const session = createDragSession({
      update: (recipe, key, opts) => store.getState().update(recipe, key, opts),
      endGroup: () => store.getState().endGroup(),
      revertGroup: (key) => store.getState().revertGroup(key),
      current: () => store.getState().project,
      requestFrame: (cb) => frames.push(cb),
      cancelFrame: () => undefined,
      onStep: (s) => void steps.push(s),
    });
    const tick = (): void => frames.splice(0).forEach((cb) => cb());
    return { store, session, tick, steps };
  }

  it("glisser d'une extrémité : une entrée d'historique ; Échap : retour au départ", () => {
    const t = setup(P);
    const p0 = t.store.getState().project;
    const past = t.store.getState().history.past.length;
    const h = { kind: "wallEnd", id: M1, end: "b" } as const;
    const at = { x: -100, y: 3000 };
    t.session.begin(beginDrag(h, p0, MODEL, at, at, 1));
    for (let k = 1; k <= 4; k++) {
      t.session.move({ x: -100, y: 3000 + 100 * k }, FREE);
      t.tick();
    }
    t.session.end();
    expect(t.store.getState().project.site.walls[0]!.b).toEqual({ x: -100, y: 3400 });
    expect(t.store.getState().history.past).toHaveLength(past + 1);

    const p1 = t.store.getState().project;
    t.session.begin(beginDrag(h, p1, MODEL, { x: -100, y: 3400 }, { x: -100, y: 3400 }, 2));
    t.session.move({ x: 500, y: 3400 }, FREE);
    t.tick();
    expect(t.store.getState().project).not.toBe(p1);
    t.session.cancel();
    expect(t.store.getState().project).toBe(p1);
  });

  it("sommet retourné : la sélection à rétablir est transmise", () => {
    const tri: Project = {
      ...P,
      site: {
        ...P.site,
        opening: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 2000, y: 0 },
            { x: 0, y: 1000 },
          ],
        },
      },
    };
    const t = setup(tri);
    const h = { kind: "openingVertex", index: 0 } as const;
    t.session.begin(beginDrag(h, tri, MODEL, { x: 0, y: 0 }, { x: 0, y: 0 }, 1));
    t.session.move({ x: 3000, y: 2000 }, FREE);
    t.tick();
    const last = t.steps.at(-1) as { selection?: { kind: string; index: number } | null };
    expect(last.selection?.kind).toBe("openingVertex");
    t.session.end();
    // L'indice rendu désigne bien le sommet déplacé dans le projet de fin de geste.
    const end = t.store.getState().project;
    expect(openingVertices(end.site.opening!)[last.selection!.index]).toEqual({ x: 3000, y: 2000 });
  });

  it("clavier : un pas qui retourne le contour rend le sommet réindexé", () => {
    // Triangle mince : (0,0) (2000,0) (0,10) ; le sommet 3 descendu de 100 mm passe sous la
    // base, le contour se retourne.
    const tri: Project = {
      ...P,
      site: {
        ...P.site,
        opening: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 2000, y: 0 },
            { x: 0, y: 10 },
          ],
        },
      },
    };
    const r = nudgeSite(tri, { kind: "openingVertex", index: 2 }, -100, "y");
    if (r.error) throw new Error("refus inattendu");
    expect(r.selection?.kind).toBe("openingVertex");
    const index = r.selection?.kind === "openingVertex" ? r.selection.index : -1;
    expect(openingVertices(r.project.site.opening!)[index]).toEqual({ x: 0, y: -90 });
    // Sans retournement : pas de sélection rendue.
    const same = nudgeSite(tri, { kind: "openingVertex", index: 2 }, 10, "y");
    expect(same.error ? null : same.selection).toBeUndefined();
  });

  it("trémie ronde : pas de poignée par sommet, sauf le sommet sélectionné", () => {
    const round: Project = {
      ...P,
      site: { ...P.site, opening: circularOpening({ x: 0, y: 0 }, 800) },
    };
    const whole = siteHandles({ kind: "opening" }, round).map((s) => s.handle.kind);
    expect(whole).toEqual(["openingMove"]);
    const one = siteHandles({ kind: "openingVertex", index: 3 }, round).map((s) => s.handle);
    expect(one).toEqual([{ kind: "openingVertex", index: 3 }]);
  });
});
