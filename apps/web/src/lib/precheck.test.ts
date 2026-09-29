import { ProjectSchema, buildModel, parseProjectText, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import j3aText from "../../../../examples/j3a-acceptance-01-bois.blondel.json?raw";
import { executionClassOf, precheckSummary, projectPrecheckSettings } from "./precheck.js";

const base = parseProjectText(j3aText);
const withStructure = (kind: string, params: Record<string, unknown> = {}): Project =>
  ProjectSchema.parse({ ...base, stair: { ...base.stair, structure: { kind, params } } });

describe("prédimensionnement indicatif et classe d'exécution", () => {
  it("steel-flat : classe d'exécution lue dans le contrôle de conception (EXC1 en S235, EXC2 en S355)", () => {
    const m1 = buildModel(withStructure("steel-flat"));
    expect(executionClassOf(m1)?.value).toBe("EXC1");
    const m2 = buildModel(withStructure("steel-flat", { grade: "S355" }));
    const exc = executionClassOf(m2);
    expect(exc?.value).toBe("EXC2");
    expect(exc?.detail).toMatch(/S355/);
    // Bois : pas de classe d'exécution.
    expect(executionClassOf(buildModel(withStructure("wood-housed")))).toBeNull();
    // Classe portée par le modèle prioritaire.
    expect(executionClassOf({ ...m1, executionClass: "EXC2" })?.value).toBe("EXC2");
  });

  it("limons en profilés : une ligne par limon, bornes L/200 et L/300 du cœur", () => {
    const project = withStructure("steel-profile", { precheck: { category: "D1" } });
    expect(projectPrecheckSettings(project)).toMatchObject({ category: "D1" });
    const model = buildModel(project);
    const s = precheckSummary(project, model)!;
    expect(s.rows.length).toBeGreaterThan(0);
    expect(s.loads.category).toBe("D1");
    for (const r of s.rows) {
      expect(model.parts.find((p) => p.id === r.partId)?.category).toBe("stringer");
      expect(r.limit).toBeCloseTo((r.lengthM * 1000) / 200, 6);
      expect(r.adviceLimit).toBeCloseTo((r.lengthM * 1000) / 300, 6);
      expect(r.ok.deflection).toBe(r.deflection <= r.limit + 1e-9);
      expect(r.ratio).toBeCloseTo((100 * r.stress) / r.design, 6);
    }
    expect(s.notes.some((n) => /indicatif/.test(n))).toBe(true);
  });

  it("sans modèle ou réglages invalides : rien, ou réglages par défaut", () => {
    expect(precheckSummary(base, null)).toBeNull();
    expect(projectPrecheckSettings(withStructure("steel-profile"))).toBeTypeOf("object");
    const bad = {
      ...base,
      stair: { ...base.stair, structure: { kind: "x", params: { precheck: { kmod: -1 } } } },
    };
    expect(projectPrecheckSettings(bad as Project)).toEqual({});
  });
});
