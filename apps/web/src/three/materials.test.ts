import type { MaterialId } from "@blondel/core";
import { FUNCTIONAL_COLORS, MATERIAL_PBR } from "@blondel/exports";
import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_COLOR,
  MATERIAL_LABELS,
  MATERIAL_LOOKS,
  SEVERITY_COLORS,
  materialLook,
  severityColors3d,
} from "./materials.js";

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

  it("sélection et sévérités : palette fonctionnelle unique (ADR-0009, point 10)", () => {
    const light = FUNCTIONAL_COLORS.light;
    expect(HIGHLIGHT_COLOR).toBe(light.selection);
    expect(SEVERITY_COLORS).toEqual({
      bloquant: light.blocking,
      avertissement: light.warning,
      conseil: light.advice,
    });
    const dark = FUNCTIONAL_COLORS.dark;
    expect(severityColors3d("dark")).toEqual({
      bloquant: dark.blocking,
      avertissement: dark.warning,
      conseil: dark.advice,
    });
  });
});
