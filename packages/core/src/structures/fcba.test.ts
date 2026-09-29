import { describe, expect, it } from "vitest";
import { getRule } from "../rules/table.js";
import { CREMAILLERE_RULE_ID, fcbaTable, parseFcbaTable, requiredResidual } from "./fcba.js";

describe("tableau FCBA des crémaillères (rules.yaml)", () => {
  it("extrait les six couples et le domaine publié de la description de la règle", () => {
    const t = fcbaTable();
    expect(t.rows.C30).toEqual([
      { thickness: 33, residual: 179 },
      { thickness: 44, residual: 163 },
      { thickness: 70, residual: 141 },
    ]);
    expect(t.rows.D40).toEqual([
      { thickness: 35, residual: 177 },
      { thickness: 44, residual: 162 },
      { thickness: 70, residual: 139 },
    ]);
    expect(t.floorToFloor).toBe(2700);
    expect(t.pitchDeg).toBe(38);
    // Cohérence avec le `min` de la règle (plus petite valeur du tableau).
    const all = [...t.rows.C30, ...t.rows.D40].map((r) => r.residual);
    expect(Math.min(...all)).toBe(getRule(CREMAILLERE_RULE_ID).min);
  });

  it("valeur exigée du côté de la sécurité (pas d'interpolation)", () => {
    const t = fcbaTable();
    expect(requiredResidual(t, "D40", 45)).toBe(162);
    expect(requiredResidual(t, "D40", 70)).toBe(139);
    expect(requiredResidual(t, "C30", 60)).toBe(163);
    expect(requiredResidual(t, "C30", 30)).toBeNull();
  });

  it("lève une erreur si le format de la description change", () => {
    expect(() => parseFcbaTable("sans tableau")).toThrow(/C30/);
  });
});
