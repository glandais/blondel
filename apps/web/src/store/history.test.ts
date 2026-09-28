import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  commit,
  endGroup,
  initHistory,
  redo,
  undo,
  type History,
} from "./history.js";

const opts = { limit: 1000, groupWindowMs: 1000 };

describe("historique par snapshots", () => {
  it("annule et rétablit dans l'ordre", () => {
    let h = initHistory("a");
    h = commit(h, "b", { now: 0 }, opts);
    h = commit(h, "c", { now: 10 }, opts);
    expect(h.present).toBe("c");
    h = undo(h);
    expect(h.present).toBe("b");
    h = undo(h);
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
    h = undo(h);
    expect(h.present).toBe("a");
    h = redo(redo(h));
    expect(h.present).toBe("c");
    expect(canRedo(h)).toBe(false);
  });

  it("une nouvelle modification après annulation efface le futur", () => {
    let h = commit(commit(initHistory(1), 2, { now: 0 }, opts), 3, { now: 1 }, opts);
    h = commit(undo(h), 4, { now: 2 }, opts);
    expect(h.present).toBe(4);
    expect(h.future).toEqual([]);
    expect(undo(h).present).toBe(2);
  });

  it("regroupe les modifications continues d'un même champ", () => {
    let h = initHistory(0);
    for (let i = 1; i <= 5; i++) h = commit(h, i, { groupKey: "H", now: i * 100 }, opts);
    expect(h.present).toBe(5);
    expect(h.past).toEqual([0]);
    // Autre champ : nouvelle entrée.
    h = commit(h, 6, { groupKey: "E", now: 600 }, opts);
    expect(h.past).toEqual([0, 5]);
    // Même champ mais délai dépassé : nouvelle entrée.
    h = commit(h, 7, { groupKey: "E", now: 5000 }, opts);
    expect(h.past).toEqual([0, 5, 6]);
    // Groupe clos explicitement : nouvelle entrée.
    h = commit(endGroup(h), 8, { groupKey: "E", now: 5001 }, opts);
    expect(h.past).toEqual([0, 5, 6, 7]);
    // Après une annulation, pas de regroupement avec l'état annulé.
    h = commit(undo(h), 9, { groupKey: "E", now: 5002 }, opts);
    expect(h.past).toEqual([0, 5, 6, 7]);
  });

  it("borne la taille de la pile", () => {
    let h = initHistory(0);
    for (let i = 1; i <= 10; i++) h = commit(h, i, { now: i }, { limit: 3, groupWindowMs: 0 });
    expect(h.past).toEqual([7, 8, 9]);
  });

  it("n'enregistre pas un état identique", () => {
    const h = initHistory({ a: 1 });
    expect(commit(h, h.present, { now: 0 }, opts)).toBe(h);
  });

  it("propriété : équivalence avec un modèle de référence (liste + curseur)", () => {
    type Op = { k: "commit"; v: number; key?: string; dt: number } | { k: "undo" } | { k: "redo" };
    const op: fc.Arbitrary<Op> = fc.oneof(
      fc.record({
        k: fc.constant("commit" as const),
        v: fc.integer(),
        key: fc.option(fc.constantFrom("a", "b"), { nil: undefined }),
        dt: fc.integer({ min: 0, max: 2000 }),
      }),
      fc.constant({ k: "undo" as const }),
      fc.constant({ k: "redo" as const }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        let h: History<number> = initHistory(-1);
        // Référence : liste des états et curseur, regroupement recalculé indépendamment.
        let states = [-1];
        let cursor = 0;
        let group: { key: string; at: number } | null = null;
        let t = 0;
        for (const o of ops) {
          if (o.k === "commit") {
            t += o.dt;
            h = commit(
              h,
              o.v,
              o.key === undefined ? { now: t } : { groupKey: o.key, now: t },
              opts,
            );
            if (o.v === states[cursor]) continue;
            const same = o.key !== undefined && group?.key === o.key && t - group.at <= 1000;
            states = states.slice(0, cursor + 1);
            if (same) states[cursor] = o.v;
            else {
              states.push(o.v);
              cursor++;
            }
            group = o.key === undefined ? null : { key: o.key, at: t };
          } else if (o.k === "undo") {
            h = undo(h);
            if (cursor > 0) {
              cursor--;
              group = null;
            }
          } else {
            h = redo(h);
            if (cursor < states.length - 1) {
              cursor++;
              group = null;
            }
          }
          if (h.present !== states[cursor]) return false;
          if (h.past.length !== cursor || h.future.length !== states.length - 1 - cursor)
            return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });
});
