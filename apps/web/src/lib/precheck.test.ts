import { translatorFor } from "@blondel/i18n";
import {
  PRECHECK_RULE_IDS,
  ProjectSchema,
  buildModel,
  parseProjectText,
  precheckResults,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import j3aText from "../../../../examples/j3a-acceptance-01-bois.blondel.json?raw";
import upnText from "../../../../examples/j3c-acceptance-01-upn.blondel.json?raw";
import { executionClassInfo, precheckSummary } from "./precheck.js";

const base = parseProjectText(j3aText);
const withStructure = (kind: string, params: Record<string, unknown> = {}): Project =>
  ProjectSchema.parse({ ...base, stair: { ...base.stair, structure: { kind, params } } });

const FR = translatorFor("fr");

describe("prédimensionnement indicatif et classe d'exécution", () => {
  it("steel-flat : classe d'exécution lue dans le contrôle de conception (EXC1 en S235, EXC2 en S355)", () => {
    const m1 = buildModel(withStructure("steel-flat"));
    expect(executionClassInfo(m1)?.value).toBe("EXC1");
    const m2 = buildModel(withStructure("steel-flat", { grade: "S355" }));
    const exc = executionClassInfo(m2);
    expect(exc?.value).toBe("EXC2");
    expect(FR.t(exc!.detail!)).toMatch(/S355/);
    // Bois : pas de classe d'exécution.
    expect(executionClassInfo(buildModel(withStructure("wood-housed")))).toBeNull();
    // Classe portée par le modèle prioritaire.
    expect(executionClassInfo({ ...m1, executionClass: "EXC2" })?.value).toBe("EXC2");
  });

  it("limons en profilés : une ligne par limon, bornes L/200 et L/300 du cœur", () => {
    const project = withStructure("steel-profile", { precheck: { category: "D1" } });
    const model = buildModel(project);
    const s = precheckSummary(model)!;
    expect(s.rows.length).toBeGreaterThan(0);
    expect(s.loads.category).toBe("D1");
    for (const r of s.rows) {
      expect(model.parts.find((p) => p.id === r.partId)?.category).toBe("stringer");
      expect(r.limit).toBeCloseTo((r.lengthM * 1000) / 200, 6);
      expect(r.adviceLimit).toBeCloseTo((r.lengthM * 1000) / 300, 6);
      expect(r.ok.deflection).toBe(r.deflection <= r.limit + 1e-9);
      expect(r.ratio).toBeCloseTo((100 * r.stress) / r.design, 6);
    }
    expect(s.notes.some((n) => /indicatif/.test(translatorFor("fr").t(n)))).toBe(true);
  });

  it("panneau et contrôle de conception : mêmes valeurs (une seule source, Model.precheck)", () => {
    const upn = parseProjectText(upnText);
    const model = buildModel(upn);
    const s = precheckSummary(model)!;
    expect(s.rows.length).toBeGreaterThan(0);
    const stress = new Map(
      model.compliance.results
        .filter((r) => r.ruleId === "PRECHECK_CONTRAINTE" && r.location.kind === "part")
        .map((r) => [r.location.kind === "part" ? r.location.partId : "", r.measured]),
    );
    let matched = 0;
    for (const r of s.rows) {
      const measured = stress.get(r.partId);
      if (measured === undefined) continue;
      matched++;
      expect(r.stress).toBeCloseTo(measured, 6);
    }
    expect(matched).toBeGreaterThan(0);
    // Les lignes PRECHECK_* se déduisent des poutres du panneau.
    const fromPanel = precheckResults(upn, model.stepping, model.precheck!.beams);
    expect(fromPanel.map((r) => r.ruleId).sort()).toEqual(
      model.compliance.results
        .filter((r) => PRECHECK_RULE_IDS.has(r.ruleId))
        .map((r) => r.ruleId)
        .sort(),
    );
  });

  it("sans modèle ou sans prédimensionnement : rien", () => {
    expect(precheckSummary(null)).toBeNull();
    expect(precheckSummary(buildModel(withStructure("none")))).toBeNull();
  });
});
