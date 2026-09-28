import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseProject, parseProjectText } from "./parse.js";
import { createProject, PRESET_IDS } from "./presets.js";
import { serializeProject, stableStringify } from "./serialize.js";

/** Recopie un objet en mélangeant l'ordre des clés (récursivement). */
function shuffleKeys(value: unknown, rnd: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rnd));
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [entries[i], entries[j]] = [entries[j]!, entries[i]!];
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(v, rnd)]));
  }
  return value;
}

const arbProject = fc
  .record({
    preset: fc.constantFrom(...PRESET_IDS),
    floorToFloor: fc.integer({ min: 2500, max: 3200 }),
    width: fc.integer({ min: 700, max: 1000 }),
    upperSlabThickness: fc.integer({ min: 150, max: 300 }),
    name: fc.string(),
  })
  .map(({ preset, ...options }) => createProject(preset, options));

describe("stableStringify", () => {
  it("trie les clés récursivement et omet les undefined", () => {
    expect(stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } }, 0)).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });
});

describe("serializeProject", () => {
  it("se termine par un saut de ligne et commence par les clés triées", () => {
    const text = serializeProject(createProject("straight"));
    expect(text.endsWith("}\n")).toBe(true);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys).toEqual([...keys].sort());
  });

  it("propriété : aller-retour parse ∘ serialize = identité", () => {
    fc.assert(
      fc.property(arbProject, (p) => {
        expect(parseProjectText(serializeProject(p))).toEqual(p);
      }),
      { numRuns: 60 },
    );
  });

  it("propriété : le texte ne dépend pas de l'ordre des clés", () => {
    fc.assert(
      fc.property(arbProject, fc.integer(), (p, seed) => {
        let s = seed >>> 0;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        const shuffled = parseProject(shuffleKeys(p, rnd));
        expect(serializeProject(shuffled)).toBe(serializeProject(p));
      }),
      { numRuns: 60 },
    );
  });
});
