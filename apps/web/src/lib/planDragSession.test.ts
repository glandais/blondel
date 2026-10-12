import cage60Text from "../../../../examples/cage-60.blondel.json?raw";
import { buildModel, parseProjectText, type Project, type Vec2 } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createProjectStore } from "../store/projectStore.js";
import { beginDrag, type PlanHandle } from "./planDrag.js";
import { createDragSession, type DragHost } from "./planDragSession.js";

const cage60: Project = parseProjectText(cage60Text);
const model60 = buildModel(cage60);
const MOVE: PlanHandle = { kind: "move" };
const FREE = { free: true, snapRadius: 0 } as const;
const AT: Vec2 = { x: 0, y: 0 };

/** Hôte relié à un vrai store de projet, avec une horloge d'images manuelle. */
function setup() {
  const store = createProjectStore();
  store.getState().replaceProject(cage60);
  store.getState().endGroup();
  const frames = new Map<number, () => void>();
  let nextId = 1;
  let updates = 0;
  const steps: { snap: unknown; error: unknown }[] = [];
  const host: DragHost = {
    update: (recipe, key, opts) => {
      updates += 1;
      return store.getState().update(recipe, key, opts);
    },
    endGroup: () => store.getState().endGroup(),
    revertGroup: (key) => store.getState().revertGroup(key),
    current: () => store.getState().project,
    requestFrame: (cb) => {
      frames.set(nextId, cb);
      return nextId++;
    },
    cancelFrame: (id) => void frames.delete(id),
    onStep: (s) => void steps.push(s),
  };
  const tick = (): void => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb());
  };
  const session = createDragSession(host);
  const start = (seq = 1) => {
    const p = store.getState().project;
    session.begin(beginDrag(MOVE, p, model60, AT, AT, seq));
    return p;
  };
  return {
    store,
    session,
    tick,
    start,
    steps,
    frames,
    updates: () => updates,
    origin: () => store.getState().project.stair.placement.origin,
  };
}

describe("session de glisser : cadence et historique", () => {
  it("au plus un pas par image, avec le dernier pointeur", () => {
    const t = setup();
    const o = t.origin();
    t.start();
    t.session.move({ x: 10, y: 0 }, FREE);
    t.session.move({ x: 20, y: 0 }, FREE);
    t.session.move({ x: 30, y: 5 }, FREE);
    expect(t.frames.size).toBe(1);
    expect(t.updates()).toBe(0);
    t.tick();
    expect(t.updates()).toBe(1);
    expect(t.origin()).toEqual({ x: o.x + 30, y: o.y + 5 });
  });

  it("un geste = une entrée d'historique ; fin : le dernier pointeur en attente est appliqué", () => {
    const t = setup();
    const before = t.store.getState().project;
    const past = t.store.getState().history.past.length;
    t.start();
    for (let k = 1; k <= 5; k++) {
      t.session.move({ x: 100 * k, y: 0 }, FREE);
      t.tick();
    }
    t.session.move({ x: 777, y: 0 }, FREE);
    expect(t.session.end()).toBe(true);
    expect(t.session.gesture()).toBeNull();
    expect(t.origin().x).toBe(before.stair.placement.origin.x + 777);
    expect(t.store.getState().history.past).toHaveLength(past + 1);
    expect(t.store.getState().history.group).toBeNull();
    t.store.getState().undo();
    expect(t.store.getState().project).toBe(before);
  });

  it("annulation (Échap) : retour au projet du début, aucune entrée, image abandonnée", () => {
    const t = setup();
    const before = t.store.getState().project;
    const past = t.store.getState().history.past.length;
    t.start();
    t.session.move({ x: 300, y: 0 }, FREE);
    t.tick();
    t.session.move({ x: 400, y: 0 }, FREE);
    expect(t.session.cancel()).toBe(true);
    expect(t.frames.size).toBe(0);
    expect(t.store.getState().project).toBe(before);
    expect(t.store.getState().history.past).toHaveLength(past);
    expect(t.store.getState().canRedo()).toBe(false);
    expect(t.session.cancel()).toBe(false);
    expect(t.session.end()).toBe(false);
  });

  it("annulation après une modification étrangère au geste : retour au projet du début", () => {
    const t = setup();
    const before = t.store.getState().project;
    t.start();
    t.session.move({ x: 300, y: 0 }, FREE);
    t.tick();
    // Modification hors du groupe du geste (ex. une touche), puis nouveau pas du geste.
    t.store.getState().update((p) => ({
      ...p,
      stair: { ...p.stair, placement: { ...p.stair.placement, rotation: 15 } },
    }));
    t.store.getState().endGroup();
    t.session.move({ x: 600, y: 0 }, FREE);
    t.tick();
    expect(t.session.cancel()).toBe(true);
    expect(t.store.getState().project.stair.placement).toEqual(before.stair.placement);
    expect(t.store.getState().history.group).toBeNull();
  });

  it("annulation : la pile « à refaire » d'avant le geste est conservée", () => {
    const t = setup();
    t.store.getState().update((p) => ({
      ...p,
      stair: { ...p.stair, placement: { ...p.stair.placement, rotation: 30 } },
    }));
    t.store.getState().endGroup();
    t.store.getState().undo();
    const before = t.store.getState().project;
    expect(t.store.getState().canRedo()).toBe(true);
    t.start();
    t.session.move({ x: 300, y: 0 }, FREE);
    t.tick();
    expect(t.store.getState().canRedo()).toBe(false);
    t.session.cancel();
    expect(t.store.getState().project).toBe(before);
    expect(t.store.getState().canRedo()).toBe(true);
  });

  it("geste revenu au départ : aucune entrée d'historique", () => {
    const t = setup();
    const before = t.store.getState().project;
    const past = t.store.getState().history.past.length;
    t.start();
    t.session.move({ x: 300, y: 0 }, FREE);
    t.tick();
    t.session.move(AT, FREE);
    t.session.end();
    expect(t.store.getState().project).toBe(before);
    expect(t.store.getState().history.past).toHaveLength(past);
  });

  it("deux gestes successifs : deux entrées, annulées une à une", () => {
    const t = setup();
    const p0 = t.store.getState().project;
    t.start(1);
    t.session.move({ x: 50, y: 0 }, FREE);
    t.session.end();
    const p1 = t.store.getState().project;
    t.start(2);
    t.session.move({ x: 0, y: 80 }, FREE);
    t.session.end();
    t.store.getState().undo();
    expect(t.store.getState().project).toBe(p1);
    t.store.getState().undo();
    expect(t.store.getState().project).toBe(p0);
  });

  it("refus d'un mutateur : rien n'est appliqué, l'état reste au dernier pas valide", () => {
    const t = setup();
    const p = t.store.getState().project;
    // Jonction inexistante : refus typé du mutateur, sans exception.
    t.session.begin(beginDrag({ kind: "junctionAngle", junction: 7 }, p, model60, AT, AT, 3));
    t.session.move({ x: 10, y: 10 }, FREE);
    t.tick();
    expect(t.updates()).toBe(0);
    expect(t.steps.at(-1)?.error).toMatchObject({ key: "layout.edit.junctionIndex" });
    t.session.end();
    expect(t.store.getState().project).toBe(p);
  });

  it("propriété : quelle que soit la suite de pointeurs, fin = une entrée au plus, annulation = aucune", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -500, max: 500 }),
            y: fc.integer({ min: -500, max: 500 }),
            tick: fc.boolean(),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.boolean(),
        (moves, cancel) => {
          const t = setup();
          const before = t.store.getState().project;
          const past = t.store.getState().history.past.length;
          t.start();
          for (const m of moves) {
            t.session.move({ x: m.x, y: m.y }, FREE);
            if (m.tick) t.tick();
          }
          if (cancel) t.session.cancel();
          else t.session.end();
          const h = t.store.getState().history;
          if (cancel) return t.store.getState().project === before && h.past.length === past;
          const last = moves[moves.length - 1]!;
          const o = t.origin();
          const expected = {
            x: before.stair.placement.origin.x + last.x,
            y: before.stair.placement.origin.y + last.y,
          };
          const moved = last.x !== 0 || last.y !== 0;
          return (
            o.x === expected.x &&
            o.y === expected.y &&
            h.past.length === past + (moved ? 1 : 0) &&
            h.group === null
          );
        },
      ),
      { numRuns: 40 },
    );
  });
});
