import fc from "fast-check";
import { PRESET_IDS, buildModel, createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { bomSummary, selectedPart } from "./parts.js";

describe("nomenclature", () => {
  it.each(PRESET_IDS)("%s : chaque pièce apparaît une fois, totaux = somme des lignes", (id) => {
    const model = buildModel(createProject(id));
    const bom = bomSummary(model.parts);
    expect(bom.count).toBe(model.parts.length);
    const ids = bom.lines.flatMap((l) => l.partIds);
    expect(new Set(ids).size).toBe(model.parts.length);
    expect(ids.sort()).toEqual(model.parts.map((p) => p.id).sort());
    for (const l of bom.lines) expect(l.partIds).toHaveLength(l.quantity);
    const vol = bom.lines.reduce((s, l) => s + (l.totalVolume ?? Number.NaN), 0);
    if (bom.volume !== undefined) expect(bom.volume).toBeCloseTo(vol, 12);
    // Aucune masse inventée : les pièces de base n'en portent pas.
    expect(bom.mass).toBeUndefined();
  });

  it("sous-ensemble quelconque de pièces : comptes cohérents", () => {
    const model = buildModel(createProject("quarter-left"));
    fc.assert(
      fc.property(fc.subarray([...model.parts]), (parts) => {
        const bom = bomSummary(parts);
        expect(bom.count).toBe(parts.length);
        expect(bom.lines.reduce((s, l) => s + l.quantity, 0)).toBe(parts.length);
      }),
    );
  });

  it("repère en double avec débits différents : chaque pièce sur la ligne de son débit", () => {
    const model = buildModel(createProject("straight"));
    const base = model.parts.find((p) => p.stock !== undefined)!;
    const withLength = (id: string, length: number) => ({
      ...base,
      id,
      mark: "X",
      stock: { ...base.stock!, length },
    });
    // Ordre du modèle : 1000, 900, 1000 → lignes « X 1000 × 2 » puis « X 900 × 1 ».
    const parts = [withLength("a", 1000), withLength("b", 900), withLength("c", 1000)];
    const bom = bomSummary(parts);
    expect(bom.lines).toHaveLength(2);
    for (const l of bom.lines) {
      for (const id of l.partIds) {
        expect(parts.find((p) => p.id === id)!.stock!.length).toBe(l.length);
      }
    }
    expect(bom.lines.find((l) => l.length === 900)!.partIds).toEqual(["b"]);
  });

  it("modèle vide : aucune ligne, totaux absents", () => {
    expect(bomSummary([])).toEqual({ lines: [], count: 0, withFlat: 0 });
  });
});

describe("pièce sélectionnée", () => {
  const model = buildModel(createProject("straight"));
  it("par identifiant de pièce, ou par marche (tread-N)", () => {
    const p = model.parts[0]!;
    expect(selectedPart(model, { kind: "part", partId: p.id })).toBe(p);
    expect(selectedPart(model, { kind: "tread", number: 1 })?.id).toBe("tread-1");
    expect(selectedPart(model, { kind: "stair" })).toBeUndefined();
    expect(selectedPart(model, null)).toBeUndefined();
    expect(selectedPart(model, { kind: "part", partId: "inconnue" })).toBeUndefined();
  });
});
