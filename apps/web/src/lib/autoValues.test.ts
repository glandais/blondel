/** Lecture des valeurs retenues des paramètres auto (`Model.autoValues`), modèles fabriqués. */
import { describe, expect, it } from "vitest";
import { autoValueKey, autoValueOf } from "./autoValues.js";

describe("autoValueOf", () => {
  const model = {
    autoValues: {
      "stair.layout.legs.0.length": 2410.5,
      "stair.structure.params.lowerOffset": 275,
      "stair.structure.params.newel.size": 100,
      "stair.bad": Number.NaN,
    },
  };

  it("clé = chemin joint par des points, indices en clair", () => {
    expect(autoValueKey(["stair", "layout", "legs", 0, "length"])).toBe(
      "stair.layout.legs.0.length",
    );
    expect(autoValueOf(model, ["stair", "layout", "legs", 0, "length"])).toBe(2410.5);
    expect(autoValueOf(model, ["stair", "structure", "params", "lowerOffset"])).toBe(275);
    expect(autoValueOf(model, ["stair", "structure", "params", "newel", "size"])).toBe(100);
  });

  it("absente, non finie, sans modèle ou modèle sans autoValues : undefined", () => {
    expect(autoValueOf(model, ["stair", "layout", "legs", 1, "length"])).toBeUndefined();
    expect(autoValueOf(model, ["stair", "bad"])).toBeUndefined();
    expect(autoValueOf(null, ["stair"])).toBeUndefined();
    expect(autoValueOf({}, ["stair", "layout", "legs", 0, "length"])).toBeUndefined();
  });
});
