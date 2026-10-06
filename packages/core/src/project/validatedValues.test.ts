import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ValidatedValue } from "../model/project.js";
import { createProject } from "./presets.js";
import { serializeProject } from "./serialize.js";
import {
  isValueValidated,
  withValidatedValues,
  withoutValidatedValues,
} from "./validatedValues.js";

describe("valeurs ◆ validées (ADR-0009 point 9)", () => {
  const base = createProject("quarter-left");

  it("ajout, remplacement à la même place, retrait", () => {
    let p = withValidatedValues(base, [
      { path: "guards.posts.size", value: 40 },
      { path: "stair.structure.params.supports.pinch", value: 15, structureKind: "steel-plate" },
    ]);
    p = withValidatedValues(p, [{ path: "guards.posts.size", value: 50 }]);
    expect(p.validatedValues).toEqual([
      { path: "guards.posts.size", value: 50 },
      { path: "stair.structure.params.supports.pinch", value: 15, structureKind: "steel-plate" },
    ]);
    expect(isValueValidated(p, "guards.posts.size", 50)).toBe(true);
    const q = withoutValidatedValues(p, [{ path: "guards.posts.size" }]);
    expect(q.validatedValues?.map((v) => v.path)).toEqual([
      "stair.structure.params.supports.pinch",
    ]);
    // Rien à retirer ou à ajouter : même objet.
    expect(withoutValidatedValues(q, [{ path: "guards.material" }])).toBe(q);
    expect(withValidatedValues(q, [])).toBe(q);
  });

  it("liste vidée : le champ est retiré, le fichier redevient celui d'avant", () => {
    const p = withValidatedValues(base, [{ path: "guards.material", value: "steel" }]);
    const q = withoutValidatedValues(p, [{ path: "guards.material" }]);
    expect("validatedValues" in q).toBe(false);
    expect(serializeProject(q)).toBe(serializeProject(base));
  });

  it("valeur changée : la validation est caduque (l'entrée reste)", () => {
    const p = withValidatedValues(base, [{ path: "guards.posts.size", value: 40 }]);
    expect(isValueValidated(p, "guards.posts.size", 40)).toBe(true);
    expect(isValueValidated(p, "guards.posts.size", 41)).toBe(false);
    expect(isValueValidated(p, "guards.posts.size", "40")).toBe(false);
    expect(isValueValidated(base, "guards.posts.size", 40)).toBe(false);
  });

  it("plugin de structure différent : la validation est caduque", () => {
    const path = "stair.structure.params.supports.pinch";
    const p = withValidatedValues(base, [{ path, value: 15, structureKind: "steel-plate" }]);
    expect(isValueValidated(p, path, 15, "steel-plate")).toBe(true);
    expect(isValueValidated(p, path, 15, "steel-upn")).toBe(false);
    expect(isValueValidated(p, path, 15)).toBe(false);
    // Même chemin, autre plugin : deux entrées distinctes.
    const q = withValidatedValues(p, [{ path, value: 15, structureKind: "steel-upn" }]);
    expect(q.validatedValues).toHaveLength(2);
    expect(
      withoutValidatedValues(q, [{ path, structureKind: "steel-upn" }]).validatedValues,
    ).toEqual([{ path, value: 15, structureKind: "steel-plate" }]);
  });

  it("propriété : retirer ce qu'on vient d'ajouter rend le projet d'origine", () => {
    const arbEntry: fc.Arbitrary<ValidatedValue> = fc.record(
      {
        path: fc.constantFrom("guards.posts.size", "guards.material", "stair.structure.params.x"),
        value: fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        structureKind: fc.constantFrom("steel-plate", "wood-housed"),
      },
      { requiredKeys: ["path", "value"] },
    );
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 6 }), (entries) => {
        const p = withoutValidatedValues(withValidatedValues(base, entries), entries);
        expect(p).toEqual(base);
        expect(serializeProject(p)).toBe(serializeProject(base));
      }),
      { numRuns: 100 },
    );
  });
});
