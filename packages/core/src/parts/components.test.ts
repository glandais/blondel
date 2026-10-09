import { describe, expect, it } from "vitest";
import { fabricatedParts } from "./components.js";

describe("fabricatedParts", () => {
  it("sans composante : le lot inchangé (même objet)", () => {
    const parts = [{ id: "a" }, { id: "b" }];
    expect(fabricatedParts(parts)).toBe(parts);
  });

  it("pièce finie faite de composantes : retirée, composantes et autres pièces gardées", () => {
    const parts = [
      { id: "beam" },
      { id: "tread-1" },
      { id: "layer-1", componentOf: "beam" },
      { id: "layer-2", componentOf: "beam" },
    ];
    expect(fabricatedParts(parts).map((p) => p.id)).toEqual(["tread-1", "layer-1", "layer-2"]);
  });

  it("composante d'une pièce absente du lot : rien n'est retiré", () => {
    const parts = [{ id: "a" }, { id: "layer-1", componentOf: "beam" }];
    expect(fabricatedParts(parts).map((p) => p.id)).toEqual(["a", "layer-1"]);
  });
});
