import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { getIn, setIn } from "./setIn.js";

describe("setIn", () => {
  it("copie seulement le chemin traversé", () => {
    const o = { a: { b: 1 }, c: { d: [1, 2, 3] } };
    const n = setIn(o, ["c", "d", 1], 9);
    expect(n.c.d).toEqual([1, 9, 3]);
    expect(o.c.d).toEqual([1, 2, 3]);
    expect(n.a).toBe(o.a);
    expect(n).not.toBe(o);
  });

  it("rend la même référence si rien ne change", () => {
    const o = { a: { b: 1 } };
    expect(setIn(o, ["a", "b"], 1)).toBe(o);
  });

  it("supprime une clé avec undefined et crée les objets manquants", () => {
    const o: Record<string, unknown> = { a: 1, b: 2 };
    expect(setIn(o, ["b"], undefined)).toEqual({ a: 1 });
    expect(setIn(o, ["x", "y"], 3)).toEqual({ a: 1, b: 2, x: { y: 3 } });
    expect(() => setIn(o, ["__proto__", "x"], 1)).toThrow();
  });

  it("propriété : getIn(setIn(o, p, v), p) === v et l'entrée n'est pas mutée", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom("a", "b", "c", "d"),
          fc.oneof(
            fc.integer(),
            fc.string(),
            fc.dictionary(fc.constantFrom("a", "b"), fc.integer()),
          ),
        ),
        fc.array(fc.constantFrom("a", "b", "c"), { minLength: 1, maxLength: 4 }),
        fc.integer(),
        (o, path, v) => {
          const before = JSON.stringify(o);
          const n = setIn(o, path, v);
          return getIn(n, path) === v && JSON.stringify(o) === before;
        },
      ),
    );
  });
});
