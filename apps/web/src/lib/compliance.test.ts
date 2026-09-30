import {
  textMessage,
  buildModel,
  createProject,
  type ComplianceReport,
  type Model,
  type RuleResult,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  groupResults,
  isPartSelected,
  modelNotes,
  sameLocation,
  selectedTreadNumber,
  treadNumberFromAttribute,
  treadPartId,
} from "./compliance.js";

function result(partial: Partial<RuleResult>): RuleResult {
  return {
    ruleId: "R",
    status: "violation",
    severity: "avertissement",
    declaredSeverity: "avertissement",
    location: { kind: "stair" },
    nature: "normatif",
    confidence: "eleve",
    source: "",
    secondarySource: false,
    message: textMessage(""),
    ...partial,
  };
}

describe("regroupement du contrôle de conception", () => {
  it("classe par statut puis par sévérité effective, sans rien perdre", () => {
    const results = [
      result({ ruleId: "A", severity: "conseil" }),
      result({ ruleId: "B", severity: "bloquant" }),
      result({ ruleId: "C", status: "ok" }),
      result({ ruleId: "D", status: "non-evaluee" }),
      result({ ruleId: "E", severity: "bloquant" }),
    ];
    const report: ComplianceReport = {
      rulesVersion: 1,
      contexts: [],
      profile: "strict",
      results,
      summary: { bloquant: 2, avertissement: 0, conseil: 1 },
    };
    const g = groupResults(report);
    expect(g.violations.map((v) => [v.severity, v.results.map((r) => r.ruleId)])).toEqual([
      ["bloquant", ["B", "E"]],
      ["avertissement", []],
      ["conseil", ["A"]],
    ]);
    expect(g.notEvaluated.map((r) => r.ruleId)).toEqual(["D"]);
    expect(g.passed.map((r) => r.ruleId)).toEqual(["C"]);
    expect(groupResults(undefined).passed).toEqual([]);
  });

  it("relie localisations et pièces", () => {
    const t3 = { partId: "tread-3", treadNumber: 3 };
    expect(isPartSelected(t3, { kind: "tread", number: 3 })).toBe(true);
    expect(isPartSelected(t3, { kind: "tread", number: 4 })).toBe(false);
    expect(isPartSelected({ partId: "LI1" }, { kind: "part", partId: "LI1" })).toBe(true);
    expect(isPartSelected({ partId: "x" }, null)).toBe(false);
    // Champ explicite du cœur (QUESTIONS D6) : l'identifiant ne sert plus à trouver la marche.
    expect(isPartSelected({ partId: "tread-4" }, { kind: "tread", number: 4 })).toBe(false);
    expect(isPartSelected({ partId: "Z7", treadNumber: 7 }, { kind: "tread", number: 7 })).toBe(
      true,
    );
    const parts = [
      { id: "tread-12", treadNumber: 12 },
      { id: "tread-13" },
      { id: "Z5", treadNumber: 5 },
    ];
    expect(selectedTreadNumber({ kind: "part", partId: "tread-12" }, parts)).toBe(12);
    expect(selectedTreadNumber({ kind: "part", partId: "tread-13" }, parts)).toBeUndefined();
    expect(selectedTreadNumber({ kind: "part", partId: "Z5" }, parts)).toBe(5);
    expect(selectedTreadNumber({ kind: "nosing", index: 1 }, parts)).toBeUndefined();
    expect(sameLocation({ kind: "tread", number: 2 }, { kind: "tread", number: 2 })).toBe(true);
    expect(sameLocation({ kind: "tread", number: 2 }, { kind: "nosing", index: 2 })).toBe(false);
  });

  it("lit le numéro de marche d'un attribut data-tread sans inventer la marche 0", () => {
    expect(treadNumberFromAttribute("7")).toBe(7);
    expect(treadNumberFromAttribute(" 12 ")).toBe(12);
    // Avant correction : Number("") = 0 sélectionnait une marche 0 inexistante.
    expect(treadNumberFromAttribute("")).toBeUndefined();
    expect(treadNumberFromAttribute(null)).toBeUndefined();
    expect(treadNumberFromAttribute(undefined)).toBeUndefined();
    expect(treadNumberFromAttribute("0")).toBeUndefined();
    expect(treadNumberFromAttribute("-2")).toBeUndefined();
    expect(treadNumberFromAttribute("2.5")).toBeUndefined();
    expect(treadNumberFromAttribute("1e3")).toBeUndefined();
  });
});

describe("modelNotes", () => {
  it("réunit les remarques du découpage, du pipeline et du contrôle, sans doublon", () => {
    const model = {
      stepping: { notes: ["a", "b"] },
      notes: ["b", "c"],
      compliance: { notes: ["d"] },
    } as unknown as Model;
    expect(modelNotes(model)).toEqual(["a", "b", "c", "d"]);
    expect(modelNotes(null)).toEqual([]);
  });

  it("signale un modèle partiel rendu par le pipeline réel", () => {
    const p = createProject("straight");
    const model = buildModel({
      ...p,
      stair: { ...p.stair, layout: { ...p.stair.layout, width: -1 } },
    });
    expect(model.errors.length).toBeGreaterThan(0);
    expect(modelNotes(model).some((n) => /partiel/i.test(n))).toBe(true);
  });
});

describe("treadPartId", () => {
  it("désigne une pièce réelle du pipeline pour chaque marche", () => {
    const model = buildModel(createProject("quarter-left"));
    const ids = new Set(model.parts.map((p) => p.id));
    for (const t of model.stepping.treads) {
      const id = treadPartId(model.parts, t.number);
      expect(id !== undefined && ids.has(id)).toBe(true);
    }
  });
});
