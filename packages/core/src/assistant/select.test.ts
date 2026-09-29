/**
 * Sélection diversifiée de la liste principale (`select.ts`) : invariants sur des candidats
 * factices (seuls l'identifiant, la forme et le score comptent).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { selectDiverse, shapeKey } from "./select.js";
import type { DesignCandidate, TypologyId } from "./types.js";

type Pos = DesignCandidate["turnPosition"];

function fake(id: string, typology: TypologyId, turnPosition: Pos, total: number): DesignCandidate {
  return {
    id,
    typology,
    direction: null,
    turnPosition,
    label: id,
    score: { total, terms: [] },
    shape: shapeKey(typology, turnPosition),
    variants: [],
  } as unknown as DesignCandidate;
}

const flatten = (list: readonly DesignCandidate[]): DesignCandidate[] =>
  list.flatMap((c) => [c, ...c.variants]);

const candidates = fc
  .array(
    fc.record({
      typology: fc.constantFrom<TypologyId>("straight", "quarter", "quarter-landing", "half-turn"),
      turnPosition: fc.constantFrom<Pos>("bas", "médian", "haut", null),
      // Scores entiers : égalités fréquentes (départage par identifiant).
      total: fc.integer({ min: 0, max: 30 }),
    }),
    { maxLength: 40 },
  )
  .map((rows) =>
    rows.map((r, i) => fake(`c${String(i).padStart(2, "0")}`, r.typology, r.turnPosition, r.total)),
  );

const options = fc.record({
  perShapeLimit: fc.integer({ min: 1, max: 3 }),
  maxCandidates: fc.integer({ min: 0, max: 12 }),
  showAllVariants: fc.constant(false),
});

const ordered = (a: DesignCandidate, b: DesignCandidate): boolean =>
  a.score.total < b.score.total || (a.score.total === b.score.total && a.id < b.id);

describe("selectDiverse", () => {
  it("constat en ligne : six variantes d'une même forme ne remplissent plus la liste", () => {
    const list = [
      fake("ql-l-800", "quarter-landing", "bas", 6),
      fake("ql-r-800", "quarter-landing", "bas", 6),
      fake("ql-l-1000", "quarter-landing", "bas", 7),
      fake("ql-r-1000", "quarter-landing", "bas", 7),
      fake("ql-l-900", "quarter-landing", "bas", 7),
      fake("ql-r-900", "quarter-landing", "bas", 7),
      fake("straight", "straight", null, 10),
      fake("q-bas", "quarter", "bas", 14),
      fake("q-haut", "quarter", "haut", 19),
    ];
    const out = selectDiverse(list, {
      perShapeLimit: 1,
      maxCandidates: 10,
      showAllVariants: false,
    });
    expect(out.map((c) => c.id)).toEqual(["ql-l-800", "straight", "q-bas", "q-haut"]);
    expect(out[0]!.variants.map((c) => c.id)).toEqual([
      "ql-r-800",
      "ql-l-1000",
      "ql-l-900",
      "ql-r-1000",
      "ql-r-900",
    ]);
    // Deux par forme : le second reste en tête, sans variantes ; les autres sous le meilleur.
    const two = selectDiverse(list, {
      perShapeLimit: 2,
      maxCandidates: 10,
      showAllVariants: false,
    });
    expect(two.map((c) => c.id)).toEqual(["ql-l-800", "ql-r-800", "straight", "q-bas", "q-haut"]);
    expect(two[0]!.variants).toHaveLength(4);
    expect(two[1]!.variants).toEqual([]);
    // Toutes les variantes : liste à plat, triée, sans regroupement ni troncature.
    const all = selectDiverse(list, { perShapeLimit: 1, maxCandidates: 2, showAllVariants: true });
    expect(all.map((c) => c.id)).toEqual([
      "ql-l-800",
      "ql-r-800",
      "ql-l-1000",
      "ql-l-900",
      "ql-r-1000",
      "ql-r-900",
      "straight",
      "q-bas",
      "q-haut",
    ]);
    expect(all.every((c) => c.variants.length === 0)).toBe(true);
  });

  it("liste principale : triée, au plus N par forme et maxCandidates ; aucun doublon", () => {
    fc.assert(
      fc.property(candidates, options, (list, opt) => {
        const out = selectDiverse(list, opt);
        expect(out.length).toBeLessThanOrEqual(opt.maxCandidates);
        for (let i = 1; i < out.length; i++) expect(ordered(out[i - 1]!, out[i]!)).toBe(true);
        const perShape = new Map<string, number>();
        for (const c of out) perShape.set(c.shape, (perShape.get(c.shape) ?? 0) + 1);
        for (const n of perShape.values()) expect(n).toBeLessThanOrEqual(opt.perShapeLimit);
        const ids = flatten(out).map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        // En tête : le meilleur de tous.
        if (out.length > 0) {
          for (const c of list) expect(ordered(c, out[0]!)).toBe(false);
        }
      }),
    );
  });

  it("variantes : même forme, sous le meilleur de la forme, triées, plus mauvaises que lui", () => {
    fc.assert(
      fc.property(candidates, options, (list, opt) => {
        const out = selectDiverse(list, opt);
        const seenShapes = new Set<string>();
        for (const head of out) {
          const best = !seenShapes.has(head.shape);
          seenShapes.add(head.shape);
          if (!best) expect(head.variants).toEqual([]);
          let prev = head;
          for (const v of head.variants) {
            expect(v.shape).toBe(head.shape);
            expect(v.variants).toEqual([]);
            expect(ordered(prev, v)).toBe(true);
            prev = v;
          }
        }
      }),
    );
  });

  it("rien n'est perdu d'une forme présente ; tout est rendu quand la liste a la place", () => {
    fc.assert(
      fc.property(candidates, options, (list, opt) => {
        const out = selectDiverse(list, opt);
        const kept = new Set(flatten(out).map((c) => c.id));
        const shapes = new Set(out.map((c) => c.shape));
        for (const c of list) expect(kept.has(c.id)).toBe(shapes.has(c.shape));
        const shapeCount = new Set(list.map((c) => c.shape)).size;
        if (opt.maxCandidates >= shapeCount * opt.perShapeLimit)
          expect(kept.size).toBe(list.length);
      }),
    );
  });

  it("têtes d'une forme meilleures que toutes ses variantes ; forme écartée seulement si liste pleine", () => {
    fc.assert(
      fc.property(candidates, options, (list, opt) => {
        const out = selectDiverse(list, opt);
        for (const head of out) {
          for (const other of out) {
            if (other.shape !== head.shape) continue;
            for (const v of other.variants) expect(ordered(head, v)).toBe(true);
          }
        }
        const shapes = new Set(out.map((c) => c.shape));
        if (list.some((c) => !shapes.has(c.shape))) expect(out.length).toBe(opt.maxCandidates);
      }),
    );
  });

  it("à plat : même contenu que regroupé sans limite, classé par score", () => {
    fc.assert(
      fc.property(candidates, (list) => {
        const flat = selectDiverse(list, {
          perShapeLimit: 1,
          maxCandidates: 0,
          showAllVariants: true,
        });
        expect(flat.map((c) => c.id).sort()).toEqual(list.map((c) => c.id).sort());
        for (let i = 1; i < flat.length; i++) expect(ordered(flat[i - 1]!, flat[i]!)).toBe(true);
      }),
    );
  });
});
