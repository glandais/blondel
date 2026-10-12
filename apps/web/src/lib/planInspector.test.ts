/**
 * Contrôleurs de l'inspecteur du plan (sous-lot 4d) : refus sans modification, une validation =
 * une entrée d'historique, remarque de passage en tracé libre, raccords et axes d'un autre type
 * conformes au schéma, valeurs lues dans la cage éditée (tracé à volées compris).
 */
import {
  WallJointSchema,
  WellJointSchema,
  convertToCage,
  createProject,
  setSectionWidth,
  insertSection,
  removeSection,
  setJunctionAngle,
  setSectionLength,
  circularOpening,
  openingVertices,
  withWall,
  type CageSection,
  type Project,
  type WallJoint,
  type WellJoint,
} from "@blondel/core";
import { msg } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { appStore } from "../store/appStore.js";
import {
  commitEdit,
  editOutcome,
  inspectedJunction,
  inspectedSection,
  isFlightsLayout,
  newSectionAfter,
  insertOpeningVertexInStore,
  removeOpeningVertexInStore,
  removeSectionInStore,
  removeWallInStore,
  splitWallInStore,
  trackedVertexMove,
  addObstacleInStore,
  insertRoomVertexInStore,
  obstaclePatch,
  removeObstacleInStore,
  removeRoomInStore,
  removeRoomVertexInStore,
  replaceRoomInStore,
  wallJointOfKind,
  wellJointOfKind,
} from "./planInspector.js";

const quarter = (): Project => createProject("quarter-left"); // volées 1440 / 3433, E = 900

describe("editOutcome", () => {
  it("refus : aucun projet, motif rendu ; sans effet : rien", () => {
    const p = quarter();
    const refused = editOutcome(p, (q) => setJunctionAngle(q, 0, 200));
    expect(refused.next).toBeNull();
    expect(refused.error?.key).toBe("layout.cage.angleOutOfRange");
    expect(editOutcome(p, (q) => setJunctionAngle(q, 0, 90))).toEqual({
      next: null,
      error: null,
      remark: null,
    });
  });

  it("volées gardées : pas de remarque ; passage en tracé libre : remarque", () => {
    const p = quarter();
    const right = editOutcome(p, (q) => setJunctionAngle(q, 0, -90));
    expect(right.next?.stair.layout.kind).toBeUndefined();
    expect(right.remark).toBeNull();
    const sixty = editOutcome(p, (q) => setJunctionAngle(q, 0, 60));
    expect(sixty.next?.stair.layout.kind).toBe("cage");
    expect(sixty.remark?.key).toBe("ui.plan.inspector.becameCage");
    const converted = editOutcome(p, convertToCage, msg("ui.plan.inspector.converted"));
    expect(converted.remark?.key).toBe("ui.plan.inspector.converted");
    // Une cage modifiée reste une cage : pas de remarque.
    const c = sixty.next!;
    expect(editOutcome(c, (q) => setJunctionAngle(q, 0, 45)).remark).toBeNull();
    expect(isFlightsLayout(p)).toBe(true);
    expect(isFlightsLayout(c)).toBe(false);
    expect(isFlightsLayout(createProject("helical"))).toBe(false);
  });
});

describe("commitEdit (store de l'application)", () => {
  it("une validation = une entrée d'historique ; un refus ne modifie rien", () => {
    appStore.getState().replaceProject(quarter());
    appStore.getState().endGroup();
    const start = appStore.getState().project;
    const past = appStore.getState().history.past.length;

    const refused = commitEdit((q) => setSectionLength(q, 0, -5));
    expect(refused.result.ok).toBe(false);
    if (!refused.result.ok) {
      expect(refused.result.issues[0]?.key).toBe("layout.cage.invalidSectionLength");
    }
    expect(appStore.getState().project).toBe(start);
    expect(appStore.getState().history.past).toHaveLength(past);

    const same = commitEdit((q) => setJunctionAngle(q, 0, 90));
    expect(same).toEqual({ result: { ok: true }, remark: null });
    expect(appStore.getState().history.past).toHaveLength(past);

    const sixty = commitEdit((q) => setJunctionAngle(q, 0, 60));
    expect(sixty.result.ok).toBe(true);
    expect(sixty.remark?.key).toBe("ui.plan.inspector.becameCage");
    expect(appStore.getState().project.stair.layout.kind).toBe("cage");
    expect(appStore.getState().history.past).toHaveLength(past + 1);
    expect(appStore.getState().history.group).toBeNull();

    const removed = commitEdit((q) => removeSection(q, 1));
    expect(removed.result.ok).toBe(true);
    expect(appStore.getState().history.past).toHaveLength(past + 2);
    appStore.getState().undo();
    appStore.getState().undo();
    expect(appStore.getState().project).toBe(start);
  });
});

describe("removeSectionInStore (bouton et touche Suppr)", () => {
  it("retrait : sélection à effacer, remarque de passage en tracé libre ; refus : rien", () => {
    appStore.getState().replaceProject(quarter());
    appStore.getState().endGroup();
    const past = appStore.getState().history.past.length;
    const r = removeSectionInStore(1);
    expect(r.removed).toBe(true);
    // Quart tournant sans son tournant : escalier droit, encore à volées, sans remarque.
    expect(r.note).toBeNull();
    const single = appStore.getState().project;
    expect(isFlightsLayout(single)).toBe(true);
    expect(single.stair.layout.legs).toHaveLength(1);
    expect(appStore.getState().history.past).toHaveLength(past + 1);
    // Dernier tronçon : refus, projet et historique inchangés, sélection gardée.
    const refused = removeSectionInStore(0);
    expect(refused.removed).toBe(false);
    expect(refused.note?.kind).toBe("error");
    expect(refused.note?.text.key).toBe("ui.plan.inspector.refused");
    expect((refused.note?.text.params?.error as { key?: string }).key).toBe(
      "layout.cage.sectionCount",
    );
    expect(appStore.getState().project).toBe(single);
    expect(appStore.getState().history.past).toHaveLength(past + 1);
  });
});

describe("lecture de la cage éditée", () => {
  it("tracé à volées : tronçons et jonctions équivalents (F11), hors domaine : null", () => {
    const p = quarter();
    expect(inspectedSection(p, 0)).toEqual({
      section: { axis: { kind: "straight", length: 540 }, width: 900 },
      count: 2,
    });
    expect(inspectedSection(p, 2)).toBeNull();
    const j = inspectedJunction(p, 0);
    expect(j?.junction.angle).toBe(90);
    expect(j?.before).toEqual({ axis: { kind: "straight", length: 540 }, width: 900 });
    // Tronçon d'entrée (et non de sortie) : largeurs d'arrivée différentes.
    const q = setSectionWidth(p, 0, { widthEnd: 800 }).project!;
    expect(q.stair.layout.kind).toBe("cage");
    expect(inspectedJunction(q, 0)?.before.widthEnd).toBe(800);
    expect(inspectedSection(q, 1)?.section.widthEnd).toBeUndefined();
    expect(inspectedJunction(p, 1)).toBeNull();
    expect(inspectedSection(createProject("helical"), 0)).toBeNull();
  });
});

const WELL_KINDS = ["sharp", "arc", "newel", "chamfer"] as const;
const WALL_KINDS = ["sharp", "arc"] as const;
const mm = fc.integer({ min: 1, max: 2000 });
const wellArb: fc.Arbitrary<WellJoint> = fc.oneof(
  fc.constant<WellJoint>({ kind: "sharp" }),
  mm.map((radius): WellJoint => ({ kind: "arc", radius })),
  fc
    .tuple(mm, fc.option(fc.integer({ min: 0, max: 300 }), { nil: undefined }))
    .map(([size, offset]): WellJoint =>
      offset === undefined ? { kind: "newel", size } : { kind: "newel", size, offset },
    ),
  fc.tuple(mm, mm).map(([a, b]): WellJoint => ({ kind: "chamfer", setbackIn: a, setbackOut: b })),
);
const wallArb: fc.Arbitrary<WallJoint> = fc.oneof(
  fc.constant<WallJoint>({ kind: "sharp" }),
  mm.map((radius): WallJoint => ({ kind: "arc", radius })),
);

describe("raccords et axes d'un autre type", () => {
  it("propriété : type demandé, au schéma, même objet si même type, cote reprise", () => {
    fc.assert(
      fc.property(
        wellArb,
        wallArb,
        fc.constantFrom(...WELL_KINDS),
        fc.constantFrom(...WALL_KINDS),
        (well, wall, wk, mk) => {
          const w = wellJointOfKind(wk, well);
          expect(w.kind).toBe(wk);
          expect(WellJointSchema.parse(w)).toStrictEqual(w);
          if (wk === well.kind) expect(w).toBe(well);
          const m = wallJointOfKind(mk, wall, well);
          expect(m.kind).toBe(mk);
          expect(WallJointSchema.parse(m)).toStrictEqual(m);
          if (mk === wall.kind) expect(m).toBe(wall);
          // Aller-retour par un autre type : la cote suit (arc → poteau → arc).
          if (well.kind === "arc" && wk === "newel") {
            expect(wellJointOfKind("arc", w)).toEqual(well);
          }
        },
      ),
      { numRuns: 200 },
    );
    expect(wellJointOfKind("arc", { kind: "chamfer", setbackIn: 80, setbackOut: 120 })).toEqual({
      kind: "arc",
      radius: 80,
    });
    expect(wallJointOfKind("arc", { kind: "sharp" }, { kind: "arc", radius: 150 })).toEqual({
      kind: "arc",
      radius: 150,
    });
  });

  it("newSectionAfter : valeurs de départ lues dans le tronçon", () => {
    const s: CageSection = { axis: { kind: "straight", length: 1200 }, width: 900, widthEnd: 800 };
    expect(newSectionAfter(s)).toEqual({ length: 1200, width: 800 });
    expect(newSectionAfter({ axis: { kind: "straight", length: "auto" }, width: 900 })).toEqual({
      length: 900,
      width: 900,
    });
    // Insertion après le dernier tronçon d'un tracé à volées : acceptée (palier droit, cage).
    const p = quarter();
    const last = inspectedSection(p, 1)!.section;
    const r = insertSection(p, 2, newSectionAfter(last));
    expect(r.error).toBeUndefined();
    expect(r.project?.stair.layout.kind).toBe("cage");
  });
});

describe("actions du site (sous-lot 5a) : une entrée d'historique, sélection suivante, refus", () => {
  function load(): Project {
    const p = withWall(quarter(), { x: -100, y: 0 }, { x: -100, y: 3000 }, 200);
    appStore.getState().replaceProject(p);
    appStore.getState().endGroup();
    return appStore.getState().project;
  }

  it("couper puis supprimer un mur", () => {
    const p = load();
    const id = p.site.walls[0]!.id;
    const past = appStore.getState().history.past.length;
    const cut = splitWallInStore(id, { x: -100, y: 1000 });
    expect(cut.done).toBe(true);
    expect(cut.selection).toEqual({ kind: "wall", id });
    expect(cut.note?.text.key).toBe("ui.plan.editor.wall.split");
    expect(appStore.getState().project.site.walls).toHaveLength(2);
    expect(appStore.getState().history.past).toHaveLength(past + 1);
    const refusedCut = splitWallInStore(id, { x: -100, y: 0 });
    expect(refusedCut.done).toBe(false);
    expect(refusedCut.note?.kind).toBe("error");
    const removed = removeWallInStore(id);
    expect(removed).toMatchObject({ done: true, selection: null });
    expect(appStore.getState().project.site.walls).toHaveLength(1);
    expect(appStore.getState().history.past).toHaveLength(past + 2);
    expect(removeWallInStore("nope").done).toBe(false);
    expect(appStore.getState().history.past).toHaveLength(past + 2);
  });

  it("insérer puis retirer un sommet de la trémie ; refus sous 3 sommets", () => {
    const p = load();
    const n = openingVertices(p.site.opening!).length;
    const ins = insertOpeningVertexInStore(0);
    expect(ins).toMatchObject({ done: true, selection: { kind: "openingVertex", index: 1 } });
    expect(openingVertices(appStore.getState().project.site.opening!)).toHaveLength(n + 1);
    const rem = removeOpeningVertexInStore(1);
    expect(rem).toMatchObject({ done: true, selection: { kind: "opening" } });
    expect(openingVertices(appStore.getState().project.site.opening!)).toEqual(
      openingVertices(p.site.opening!),
    );
    removeOpeningVertexInStore(0);
    const before = appStore.getState().project;
    const refused = removeOpeningVertexInStore(0);
    expect(refused.done).toBe(false);
    expect((refused.note?.text.params?.error as { key?: string }).key).toBe(
      "site.opening.tooFewPoints",
    );
    expect(appStore.getState().project).toBe(before);
  });

  it("champ x d'un sommet qui retourne le contour : le sommet déplacé est à resélectionner", () => {
    const p = load();
    const tri: Project = {
      ...p,
      site: {
        ...p.site,
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
    appStore.getState().replaceProject(tri);
    appStore.getState().endGroup();
    const m = trackedVertexMove(0, { x: 3000, y: 0 });
    expect(commitEdit(m.edit).result.ok).toBe(true);
    const sel = m.reselect();
    expect(sel?.kind).toBe("openingVertex");
    const index = sel?.kind === "openingVertex" ? sel.index : -1;
    const now = openingVertices(appStore.getState().project.site.opening!);
    expect(now[index]).toEqual({ x: 3000, y: 0 });
    // Sans retournement : rien à resélectionner.
    const same = trackedVertexMove(index, { x: 3100, y: 0 });
    expect(commitEdit(same.edit).result.ok).toBe(true);
    expect(same.reselect()).toBeNull();
  });

  it("trémie ronde : l'insertion d'un sommet annonce la perte du cercle", () => {
    const p = load();
    appStore
      .getState()
      .replaceProject({ ...p, site: { ...p.site, opening: circularOpening({ x: 0, y: 0 }, 800) } });
    appStore.getState().endGroup();
    const ins = insertOpeningVertexInStore(0);
    expect(ins.done).toBe(true);
    expect(ins.note?.text.key).toBe("ui.plan.editor.opening.circleLost");
    const o = appStore.getState().project.site.opening!;
    expect(o.kind === "polygon" && o.circle).toBeFalsy();
  });
});

describe("contour de pièce et obstacles (sous-lot 5b) : une entrée d'historique, refus", () => {
  const SQUARE = [
    { x: -2000, y: -1000 },
    { x: 3000, y: -1000 },
    { x: 3000, y: 5000 },
    { x: -2000, y: 5000 },
  ];

  function load(): Project {
    appStore.getState().replaceProject(quarter());
    appStore.getState().endGroup();
    return appStore.getState().project;
  }

  it("tracer, retracer (remplacement annulable), supprimer le contour", () => {
    const p = load();
    const past = appStore.getState().history.past.length;
    const saved = replaceRoomInStore(SQUARE);
    expect(saved).toMatchObject({ done: true });
    expect(saved.note?.text.key).toBe("ui.plan.editor.room.saved");
    const first = appStore.getState().project;
    const tri = SQUARE.slice(0, 3);
    const replaced = replaceRoomInStore(tri);
    expect(replaced.note?.text.key).toBe("ui.plan.editor.room.replaced");
    expect(appStore.getState().project.site.room!.points).toEqual(tri);
    expect(appStore.getState().history.past).toHaveLength(past + 2);
    appStore.getState().undo();
    expect(appStore.getState().project).toBe(first);
    // Contour invalide (aire nulle) : refus, projet inchangé.
    const flat = replaceRoomInStore([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 2000, y: 0 },
    ]);
    expect(flat.done).toBe(false);
    expect(appStore.getState().project).toBe(first);
    const removed = removeRoomInStore();
    expect(removed).toMatchObject({ done: true, selection: null });
    expect(appStore.getState().project.site.room).toBeUndefined();
    expect(removeRoomInStore().done).toBe(false);
    appStore.getState().undo();
    appStore.getState().undo();
    expect(appStore.getState().project).toBe(p);
  });

  it("insérer puis retirer un sommet du contour ; refus sous 3 sommets", () => {
    load();
    replaceRoomInStore(SQUARE.slice(0, 3));
    const ins = insertRoomVertexInStore(0);
    expect(ins).toMatchObject({ done: true, selection: { kind: "roomVertex", index: 1 } });
    expect(appStore.getState().project.site.room!.points[1]).toEqual({ x: 500, y: -1000 });
    const rem = removeRoomVertexInStore(1);
    expect(rem).toMatchObject({ done: true, selection: { kind: "room" } });
    const before = appStore.getState().project;
    const refused = removeRoomVertexInStore(0);
    expect(refused.done).toBe(false);
    expect((refused.note?.text.params?.error as { key?: string }).key).toBe(
      "site.room.tooFewPoints",
    );
    expect(appStore.getState().project).toBe(before);
  });

  it("ajouter, modifier un champ, supprimer un obstacle", () => {
    load();
    const past = appStore.getState().history.past.length;
    const added = addObstacleInStore({
      kind: "window",
      a: { x: 0, y: 0 },
      b: { x: 900, y: 0 },
      sill: 900,
      head: 2100,
    });
    expect(added).toMatchObject({ done: true, id: "obstacle-1" });
    expect(added.note?.text.key).toBe("ui.plan.editor.obstacle.added");
    // Linteau sous l'allège : refus du schéma, rien d'appliqué.
    const bad = commitEdit(obstaclePatch("obstacle-1", { head: 800 }));
    expect(bad.result.ok).toBe(false);
    const sill = commitEdit(obstaclePatch("obstacle-1", { sill: 1000 }));
    expect(sill.result.ok).toBe(true);
    expect(appStore.getState().project.site.obstacles![0]).toMatchObject({
      id: "obstacle-1",
      sill: 1000,
      head: 2100,
    });
    expect(commitEdit(obstaclePatch("nope", { sill: 1 })).result.ok).toBe(false);
    const removed = removeObstacleInStore("obstacle-1");
    expect(removed).toMatchObject({ done: true, selection: null });
    expect(appStore.getState().project.site.obstacles).toBeUndefined();
    expect(appStore.getState().history.past).toHaveLength(past + 3);
    expect(removeObstacleInStore("obstacle-1").done).toBe(false);
  });
});
