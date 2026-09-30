import type { MaterialId } from "@blondel/core";
import { MATERIAL_PBR } from "@blondel/exports";
import { describe, expect, it } from "vitest";
import { MATERIAL_LABELS, MATERIAL_LOOKS, SEVERITY_COLORS, materialLook } from "./materials.js";

const ALL: readonly MaterialId[] = [
  "wood-oak",
  "wood-beech",
  "wood-ash",
  "wood-pine",
  "wood-glulam",
  "steel-raw",
  "steel-painted",
  "steel-galvanized",
  "stainless-brushed",
  "glass",
  "concrete",
];

describe("apparence des matériaux", () => {
  it("chaque matériau du cœur a une apparence et un libellé français", () => {
    for (const id of ALL) {
      const look = materialLook(id);
      expect(look.color, id).toMatch(/^#[0-9a-f]{6}$/);
      expect(look.roughness).toBeGreaterThanOrEqual(0);
      expect(look.roughness).toBeLessThanOrEqual(1);
      expect(look.metalness).toBeGreaterThanOrEqual(0);
      expect(look.metalness).toBeLessThanOrEqual(1);
      expect(MATERIAL_LABELS[id], id).toBeTruthy();
    }
    expect(Object.keys(MATERIAL_LOOKS).sort()).toEqual([...ALL].sort());
  });

  it("table PBR unique : la vue 3D reprend celle du glTF (QUESTIONS D6)", () => {
    for (const id of ALL) {
      const { color, roughness, metalness, opacity } = MATERIAL_LOOKS[id];
      expect({ color, roughness, metalness, opacity }, id).toEqual({
        opacity: undefined,
        ...MATERIAL_PBR[id],
      });
    }
  });

  it("acier : brut, peint et galvanisé distincts ; inox et acier métalliques ; seul le verre est translucide", () => {
    const steel = ["steel-raw", "steel-painted", "steel-galvanized"] as const;
    expect(new Set(steel.map((s) => MATERIAL_LOOKS[s].color)).size).toBe(3);
    expect(MATERIAL_LOOKS["stainless-brushed"].metalness).toBeGreaterThan(0.5);
    for (const id of ALL) {
      const translucent = MATERIAL_LOOKS[id].opacity !== undefined;
      expect(translucent, id).toBe(id === "glass");
    }
    expect(MATERIAL_LOOKS.glass.opacity).toBeLessThan(1);
    expect(Object.keys(SEVERITY_COLORS)).toEqual(["bloquant", "avertissement", "conseil"]);
  });
});
