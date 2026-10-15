/**
 * Règle d'identité des pièces repérées (décisions F10 Q1a, Q1b, chantier part-marks R2a) :
 * regroupement autour d'un représentant (`groupNearAnchor`) et comparaison des développés au
 * premier membre dans un ordre indépendant du modèle (`groupIdenticalFlats`).
 */
import { textMessage } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { Part } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import { groupIdenticalFlats, groupNearAnchor } from "./steelCommon.js";

interface Item {
  readonly id: string;
  readonly key: string;
  readonly m: readonly number[];
}

const opts = {
  key: (x: Item) => x.key,
  measures: (x: Item) => x.m,
  id: (x: Item) => x.id,
};

/** Pièces de clés « a » / « b », mesures autour de quelques valeurs (écarts voisins de T). */
const itemsArb = (dims: number) =>
  fc
    .array(
      fc.record({
        key: fc.constantFrom("a", "b"),
        m: fc.array(
          fc.oneof(
            fc.double({ min: 100, max: 104, noNaN: true }),
            fc.constantFrom(100, 100.5, 101, 101.25),
          ),
          { minLength: dims, maxLength: dims },
        ),
      }),
      { maxLength: 30 },
    )
    .map((xs) => xs.map((x, i): Item => ({ ...x, id: `p${i}` })));

/** Partition rendue sous forme canonique (identifiants triés), pour comparer deux ordres. */
const canonical = (groups: readonly (readonly { id: string }[])[] | readonly string[][]) =>
  groups
    .map((g) => g.map((x) => (typeof x === "string" ? x : x.id)).sort())
    .sort((a, b) => (a[0]! < b[0]! ? -1 : 1));

/**
 * Ancre d'un groupe : premier membre dans l'ordre de tri (clé, mesures — égales à `GEOM_EPS`
 * près —, identifiant).
 */
const anchorOf = (g: readonly Item[]): Item =>
  [...g].sort((a, b) => {
    for (let i = 0; i < a.m.length; i++)
      if (Math.abs(a.m[i]! - b.m[i]!) > GEOM_EPS) return a.m[i]! - b.m[i]!;
    return a.id < b.id ? -1 : 1;
  })[0]!;

describe("groupNearAnchor (F10 Q1a) : regroupement autour d'un représentant", () => {
  const tolArb = fc.double({ min: 0, max: 2, noNaN: true });
  const dimsArb = fc.integer({ min: 1, max: 3 });

  it("partition exacte, indépendante de l'ordre, groupes dans l'ordre de première apparition", () => {
    fc.assert(
      fc.property(
        dimsArb.chain((d) => itemsArb(d)),
        tolArb,
        fc.integer(),
        (items, tol, seed) => {
          const groups = groupNearAnchor(items, opts, tol);
          // Partition exacte.
          const ids = groups.flat().map((x) => x.id);
          expect([...ids].sort()).toEqual(items.map((x) => x.id).sort());
          expect(new Set(ids).size).toBe(ids.length);
          // Même partition après permutation de l'entrée.
          const shuffled = fc.sample(fc.shuffledSubarray(items, { minLength: items.length }), {
            seed,
            numRuns: 1,
          })[0]!;
          expect(canonical(groupNearAnchor(shuffled, opts, tol))).toEqual(canonical(groups));
          // Ordre de première apparition des groupes, membres dans l'ordre d'entrée.
          const first = groups.map((g) => items.indexOf(g[0]!));
          expect([...first].sort((a, b) => a - b)).toEqual(first);
          for (const g of groups) {
            const idx = g.map((x) => items.indexOf(x));
            expect([...idx].sort((a, b) => a - b)).toEqual(idx);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("chaque membre à au plus T + ε de l'ancre ; clés jamais mêlées ; groupes maximaux", () => {
    fc.assert(
      fc.property(
        dimsArb.chain((d) => itemsArb(d)),
        tolArb,
        (items, tol) => {
          const groups = groupNearAnchor(items, opts, tol);
          const near = (x: Item, a: Item): boolean =>
            x.m.every((v, i) => Math.abs(v - a.m[i]!) <= tol + GEOM_EPS);
          const groupOf = new Map<string, number>();
          groups.forEach((g, i) => g.forEach((x) => groupOf.set(x.id, i)));
          groups.forEach((g, gi) => {
            const anchor = anchorOf(g);
            expect(new Set(g.map((x) => x.key)).size).toBe(1);
            for (const x of g) expect(near(x, anchor)).toBe(true);
            // Maximalité : toute pièce de même clé, triée après l'ancre et proche d'elle, est
            // dans ce groupe ou dans un groupe ouvert plus tôt (ancre triée avant).
            for (const y of items) {
              if (y.key !== anchor.key || !near(y, anchor)) continue;
              const gy = groupOf.get(y.id)!;
              if (gy === gi) continue;
              const other = anchorOf(groups[gy]!);
              expect(anchorOf([other, anchor])).toBe(other);
            }
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("en une dimension : écart ≤ T + ε, nombre de groupes non croissant quand T croît", () => {
    fc.assert(
      fc.property(itemsArb(1), tolArb, tolArb, (items, t1, t2) => {
        const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1];
        const gLo = groupNearAnchor(items, opts, lo);
        const gHi = groupNearAnchor(items, opts, hi);
        for (const g of gLo) {
          const ls = g.map((x) => x.m[0]!);
          expect(Math.max(...ls) - Math.min(...ls)).toBeLessThanOrEqual(lo + GEOM_EPS);
          // L'ancre est la plus courte (au bruit d'arrondi près).
          expect(anchorOf(g).m[0]).toBeLessThanOrEqual(Math.min(...ls) + GEOM_EPS);
        }
        expect(gHi.length).toBeLessThanOrEqual(gLo.length);
      }),
      { numRuns: 300 },
    );
  });

  it("un bruit d'arrondi (≤ 1e-9 mm) sur les mesures ne change pas la partition", () => {
    fc.assert(
      fc.property(
        dimsArb.chain((d) =>
          itemsArb(d).chain((items) =>
            fc.tuple(
              fc.constant(items),
              fc.array(fc.double({ min: -1e-9, max: 1e-9, noNaN: true }), {
                minLength: items.length * d,
                maxLength: items.length * d,
              }),
            ),
          ),
        ),
        fc.constantFrom(0, 0.25, 0.5, 1),
        ([items, noise], tol) => {
          const noisy = items.map((x, i): Item => ({
            ...x,
            m: x.m.map((v, k) => v + noise[i * x.m.length + k]!),
          }));
          expect(canonical(groupNearAnchor(noisy, opts, tol))).toEqual(
            canonical(groupNearAnchor(items, opts, tol)),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("longueurs égales au bruit près : la largeur décide de l'ancre, pas le bruit", () => {
    const at = (ls: readonly number[]) =>
      groupNearAnchor(
        ["x", "y", "z"].map((id, i): Item => ({ id, key: "a", m: [ls[i]!, 100 + 0.4 * i] })),
        opts,
        0.5,
      ).map((g) => g.map((x) => x.id));
    expect(at([1000, 1000 + 1e-12, 1000 + 2e-12])).toEqual([["x", "y"], ["z"]]);
    expect(at([1000 + 2e-12, 1000 + 1e-12, 1000])).toEqual([["x", "y"], ["z"]]);
  });

  it("chaîne de pièces à 0,4 mm : groupe ouvert sur la plus courte, sans transitivité", () => {
    const items: Item[] = [100.8, 100, 100.4, 101.2].map((l, i) => ({
      id: `p${i}`,
      key: "a",
      m: [l],
    }));
    const groups = groupNearAnchor(items, opts, 0.5);
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([
      ["p0", "p3"],
      ["p1", "p2"],
    ]);
  });
});

// ------------------------------------------------------------------ développés

/** Pièce à développé rectangulaire L × W (percée d'un trou carré si `hole`), déplacée. */
function rectPart(id: string, L: number, W: number, rot: number, shift: Vec2, hole = false): Part {
  const T = (p: Vec2): Vec2 => V.add(V.rotate(p, rot), shift);
  const outer = [V.vec(0, 0), V.vec(L, 0), V.vec(L, W), V.vec(0, W)].map(T);
  const holes = hole ? [[V.vec(20, 20), V.vec(20, 30), V.vec(30, 30), V.vec(30, 20)].map(T)] : [];
  return {
    id,
    mark: "EC",
    category: "stringer",
    name: textMessage(id),
    material: "steel-painted",
    solid: { kind: "sweep", path: [], section: { outer: [], holes: [] } },
    flat: { outline: { outer, holes }, lines: [], thickness: 8 },
    quantities: {},
  };
}

describe("groupIdenticalFlats (F10 Q1b) : comparaison à l'ancre, ordre indépendant du modèle", () => {
  const partsArb = fc
    .array(
      fc.record({
        L: fc.oneof(
          fc.double({ min: 200, max: 202, noNaN: true }),
          fc.constantFrom(200, 200.4, 200.8),
        ),
        W: fc.constantFrom(80, 80.2),
        rot: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        sx: fc.double({ min: -500, max: 500, noNaN: true }),
        hole: fc.boolean(),
      }),
      { maxLength: 12 },
    )
    .map((xs) => xs.map((x, i) => rectPart(`d${i}`, x.L, x.W, x.rot, V.vec(x.sx, 0), x.hole)));

  it("même partition après permutation ; chaque membre identique à l'ancre (la plus petite)", () => {
    fc.assert(
      fc.property(partsArb, fc.integer(), (parts, seed) => {
        const tol = 0.5;
        const groups = groupIdenticalFlats(parts, tol);
        expect(groups.flat().sort()).toEqual(parts.map((p) => p.id).sort());
        const shuffled = fc.sample(fc.shuffledSubarray(parts, { minLength: parts.length }), {
          seed,
          numRuns: 1,
        })[0]!;
        expect(canonical(groupIdenticalFlats(shuffled, tol))).toEqual(canonical(groups));
        const byId = new Map(parts.map((p) => [p.id, p]));
        const area = (p: Part): number => {
          const o = p.flat!.outline.outer;
          return (
            V.distance(o[0]!, o[1]!) * V.distance(o[1]!, o[2]!) -
            (p.flat!.outline.holes.length ? 100 : 0)
          );
        };
        for (const g of groups) {
          const members = g.map((id) => byId.get(id)!);
          const anchor = [...members].sort(
            (a, b) => area(a) - area(b) || (a.id < b.id ? -1 : 1),
          )[0]!;
          for (const m of members) expect(groupIdenticalFlats([anchor, m], tol)).toHaveLength(1);
        }
        // Groupes dans l'ordre de première apparition.
        const first = groups.map((g) => parts.findIndex((p) => p.id === g[0]));
        expect([...first].sort((a, b) => a - b)).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });

  /** Plaque 200 × 80 percée d'un trou 10 × 10 en x = `hx`, déplacée. */
  const holedPlate = (id: string, hx: number, rot: number, shift: Vec2): Part => {
    const T = (p: Vec2): Vec2 => V.add(V.rotate(p, rot), shift);
    const outer = [V.vec(0, 0), V.vec(200, 0), V.vec(200, 80), V.vec(0, 80)].map(T);
    const hole = [V.vec(hx, 20), V.vec(hx, 30), V.vec(hx + 10, 30), V.vec(hx + 10, 20)].map(T);
    const base = rectPart(id, 200, 80, 0, V.ZERO);
    return { ...base, flat: { outline: { outer, holes: [hole] }, lines: [], thickness: 8 } };
  };

  it("même aire, trous déplacés : la partition ne dépend pas de la position des pièces dans le plan", () => {
    const ids = ["a", "b", "c"];
    const hx = [20, 20.4, 20.8];
    const reference = groupIdenticalFlats(
      ids.map((id, i) => holedPlate(id, hx[i]!, 0, V.ZERO)),
      0.5,
    );
    expect(reference).toEqual([["a", "b"], ["c"]]);
    const placement = fc.record({
      rot: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      x: fc.double({ min: -5000, max: 5000, noNaN: true }),
      y: fc.double({ min: -5000, max: 5000, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.tuple(placement, placement, placement), (pl) => {
        const parts = ids.map((id, i) =>
          holedPlate(id, hx[i]!, pl[i]!.rot, V.vec(pl[i]!.x, pl[i]!.y)),
        );
        expect(groupIdenticalFlats(parts, 0.5)).toEqual(reference);
      }),
      { numRuns: 300 },
    );
  });

  it("T = 0 : développés identiques au bruit d'arrondi près réunis (seuil continu en 0)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            rot: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
            sx: fc.double({ min: -5000, max: 5000, noNaN: true }),
          }),
          { minLength: 2, maxLength: 6 },
        ),
        (pl) => {
          const parts = pl.map((x, i) =>
            rectPart(`d${i}`, 223.271, 80, x.rot, V.vec(x.sx, 0), true),
          );
          expect(groupIdenticalFlats(parts, 0)).toHaveLength(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("chaîne 200 / 200,4 / 200,8 : l'ancre est la plus petite, quel que soit l'ordre", () => {
    const a = rectPart("a", 200.8, 80, 0, V.ZERO);
    const b = rectPart("b", 200, 80, 1, V.vec(10, 0));
    const c = rectPart("c", 200.4, 80, 2, V.vec(0, 10));
    expect(groupIdenticalFlats([a, b, c], 0.5)).toEqual([["a"], ["b", "c"]]);
    expect(groupIdenticalFlats([c, a, b], 0.5)).toEqual([["c", "b"], ["a"]]);
  });
});
