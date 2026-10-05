import { translatorFor } from "@blondel/i18n";
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
  controlCounts,
  findSelectedResult,
  groupResults,
  highestSeverity,
  isExactTreadSelection,
  isPartSelected,
  linkedTreadNumber,
  locationShort,
  modelNotes,
  orderedViolations,
  partSelection,
  resultsForElement,
  ruleGauge,
  sameLocation,
  whereTargets,
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
    // Nez k : marche k + 1 (comme l'inspecteur Marche, vague 3).
    expect(selectedTreadNumber({ kind: "nosing", index: 1 }, parts)).toBe(2);
    expect(selectedTreadNumber({ kind: "stair" }, parts)).toBeUndefined();
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
    const [a, b, c, d] = ["a", "b", "c", "d"].map(textMessage);
    const model = {
      stepping: { notes: [a, b] },
      notes: [textMessage("b"), c],
      compliance: { notes: [d] },
    } as unknown as Model;
    expect(modelNotes(model)).toEqual([a, b, c, d]);
    expect(modelNotes(null)).toEqual([]);
  });

  it("signale un modèle partiel rendu par le pipeline réel", () => {
    const p = createProject("straight");
    const model = buildModel({
      ...p,
      stair: { ...p.stair, layout: { ...p.stair.layout, width: -1 } },
    });
    expect(model.errors.length).toBeGreaterThan(0);
    const fr = translatorFor("fr");
    expect(modelNotes(model).some((n) => /partiel/i.test(fr.t(n)))).toBe(true);
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

describe("comptes du contrôle", () => {
  const report = (results: RuleResult[]): ComplianceReport => ({
    rulesVersion: 1,
    contexts: [],
    profile: "strict",
    results,
    summary: { bloquant: 0, avertissement: 0, conseil: 0 },
  });

  it("dénombre chaque statut et ordonne les violations bloquant → conseil", () => {
    const g = groupResults(
      report([
        result({ ruleId: "A", severity: "conseil" }),
        result({ ruleId: "B", severity: "avertissement" }),
        result({ ruleId: "C", status: "ok" }),
        result({ ruleId: "D", status: "non-evaluee" }),
        result({ ruleId: "E", severity: "bloquant" }),
        result({ ruleId: "F", status: "ok" }),
      ]),
    );
    expect(controlCounts(g)).toEqual({
      bloquant: 1,
      avertissement: 1,
      conseil: 1,
      ok: 2,
      notEvaluated: 1,
    });
    expect(orderedViolations(g).map((r) => r.ruleId)).toEqual(["E", "B", "A"]);
    expect(highestSeverity(g)).toBe("bloquant");
  });

  it("sévérité la plus haute : premier groupe non vide, null sans violation", () => {
    expect(highestSeverity(groupResults(report([result({ severity: "conseil" })])))).toBe(
      "conseil",
    );
    expect(highestSeverity(groupResults(report([result({ status: "ok" })])))).toBeNull();
    expect(highestSeverity(groupResults(undefined))).toBeNull();
    expect(controlCounts(groupResults(undefined))).toEqual({
      bloquant: 0,
      avertissement: 0,
      conseil: 0,
      ok: 0,
      notEvaluated: 0,
    });
  });
});

const FR = translatorFor("fr");
const EN = translatorFor("en");

const reportOf = (results: RuleResult[]): ComplianceReport => ({
  rulesVersion: 1,
  contexts: [],
  profile: "strict",
  results,
  summary: { bloquant: 0, avertissement: 0, conseil: 0 },
});

/** Pièces fabriquées à la main (champ `assembledWith` du cœur, éventuellement absent). */
const PARTS = [
  { id: "tread-6", mark: "M6", treadNumber: 6 },
  { id: "support-6", mark: "CR6", assembledWith: ["tread-6", "stringer-outer"] },
  { id: "stringer-outer", mark: "LE1", assembledWith: ["support-6"] },
  { id: "stringer-inner", mark: "LI1" },
];

describe("localisation courte des cartes", () => {
  it("pièce liée à une marche : « repère · M<n> » (marche portée ou pièce assemblée)", () => {
    expect(FR.t(locationShort({ kind: "part", partId: "tread-6" }, PARTS))).toBe("M6 · M6");
    expect(FR.t(locationShort({ kind: "part", partId: "support-6" }, PARTS))).toBe("CR6 · M6");
    // Limon : assemblé au support seulement, lequel n'est pas une marche.
    expect(FR.t(locationShort({ kind: "part", partId: "stringer-outer" }, PARTS))).toBe("LE1");
    expect(FR.t(locationShort({ kind: "part", partId: "stringer-inner" }, PARTS))).toBe("LI1");
    expect(EN.t(locationShort({ kind: "part", partId: "support-6" }, PARTS))).toBe("CR6 · T6");
    // Pièce absente du modèle : identifiant brut, jamais d'exception.
    expect(FR.t(locationShort({ kind: "part", partId: "x" }, PARTS))).toBe("x");
  });

  it("marche, nez, escalier, point", () => {
    expect(FR.t(locationShort({ kind: "tread", number: 6 }, PARTS))).toBe("M6");
    expect(EN.t(locationShort({ kind: "tread", number: 6 }, PARTS))).toBe("T6");
    expect(FR.t(locationShort({ kind: "nosing", index: 3 }, PARTS))).toBe("Nez 3");
    expect(FR.t(locationShort({ kind: "stair" }, PARTS))).toBe("Escalier");
    expect(FR.t(locationShort({ kind: "point", at: { x: 0, y: 0, z: 0 } }, PARTS))).toBe("Point");
  });

  it("marche liée : la sienne d'abord, puis celle d'une pièce assemblée", () => {
    expect(linkedTreadNumber(PARTS[0]!, PARTS)).toBe(6);
    expect(linkedTreadNumber(PARTS[1]!, PARTS)).toBe(6);
    expect(linkedTreadNumber(PARTS[3]!, PARTS)).toBeUndefined();
  });
});

describe("résultat de la sélection d'une règle", () => {
  const a = result({ ruleId: "A", location: { kind: "tread", number: 2 } });
  const a3 = result({ ruleId: "A", location: { kind: "tread", number: 3 } });
  const b = result({ ruleId: "B" });
  const rep = reportOf([a, a3, b]);

  it("même règle et même localisation, sinon la première de la règle", () => {
    expect(findSelectedResult(rep, { location: { kind: "tread", number: 3 }, ruleId: "A" })).toBe(
      a3,
    );
    expect(findSelectedResult(rep, { location: { kind: "tread", number: 9 }, ruleId: "A" })).toBe(
      a,
    );
    expect(findSelectedResult(rep, { location: { kind: "stair" }, ruleId: "B" })).toBe(b);
  });

  it("règle disparue, sélection sans règle, pas de rapport : undefined", () => {
    expect(findSelectedResult(rep, { location: { kind: "stair" }, ruleId: "Z" })).toBeUndefined();
    expect(findSelectedResult(rep, { location: { kind: "stair" } })).toBeUndefined();
    expect(findSelectedResult(rep, null)).toBeUndefined();
    expect(findSelectedResult(undefined, { location: b.location, ruleId: "B" })).toBeUndefined();
  });
});

describe("règles d'un élément", () => {
  const rs = [
    result({ ruleId: "T6", severity: "conseil", location: { kind: "tread", number: 6 } }),
    result({ ruleId: "N5", severity: "bloquant", location: { kind: "nosing", index: 5 } }),
    result({ ruleId: "P6", location: { kind: "part", partId: "tread-6" } }),
    result({ ruleId: "S6", location: { kind: "part", partId: "support-6" } }),
    result({ ruleId: "T6ok", status: "ok", location: { kind: "tread", number: 6 } }),
    result({ ruleId: "T6na", status: "non-evaluee", location: { kind: "tread", number: 6 } }),
    result({ ruleId: "T7", location: { kind: "tread", number: 7 } }),
    result({ ruleId: "N6", location: { kind: "nosing", index: 6 } }),
    result({ ruleId: "STAIR" }),
  ];
  const rep = reportOf(rs);
  const ids = (l: readonly RuleResult[]) => l.map((r) => r.ruleId);

  it("marche n : marche n, nez n − 1, pièce de la marche ; violations par sévérité", () => {
    const e = resultsForElement(rep, { kind: "tread", number: 6 }, PARTS);
    expect(ids(e.violations)).toEqual(["N5", "P6", "T6"]);
    expect(ids(e.passed)).toEqual(["T6ok"]);
    expect(ids(e.notEvaluated)).toEqual(["T6na"]);
  });

  it("pièce : la pièce, et la marche qu'elle matérialise", () => {
    const e = resultsForElement(rep, { kind: "part", partId: "tread-6" }, PARTS);
    expect(ids(e.violations)).toEqual(["P6", "T6"]);
    expect(ids(e.passed)).toEqual(["T6ok"]);
    const s = resultsForElement(rep, { kind: "part", partId: "support-6" }, PARTS);
    expect(ids(s.violations)).toEqual(["S6"]);
    expect(ids(s.passed)).toEqual([]);
  });

  it("aucun rapport : listes vides", () => {
    expect(resultsForElement(undefined, { kind: "tread", number: 1 }, [])).toEqual({
      violations: [],
      passed: [],
      notEvaluated: [],
    });
  });
});

describe("« Où » de l'inspecteur Règle", () => {
  const kinds = (loc: Parameters<typeof whereTargets>[0]) =>
    whereTargets(loc, PARTS).map((w) =>
      w.kind === "part"
        ? `part:${w.part.mark}`
        : w.kind === "tread"
          ? `tread:${w.number}`
          : w.kind === "nosing"
            ? `nosing:${w.index}`
            : `static:${FR.t(w.label)}`,
    );

  it("pièce : la pièce, la marche liée, puis les pièces assemblées (hors pièce de la marche)", () => {
    expect(kinds({ kind: "part", partId: "support-6" })).toEqual([
      "part:CR6",
      "tread:6",
      "part:LE1",
    ]);
    expect(kinds({ kind: "part", partId: "stringer-outer" })).toEqual(["part:LE1", "part:CR6"]);
    expect(kinds({ kind: "part", partId: "stringer-inner" })).toEqual(["part:LI1"]);
    expect(kinds({ kind: "part", partId: "x" })).toEqual(["static:x"]);
  });

  it("marche, nez : l'élément ; escalier et point : libellé seul", () => {
    expect(kinds({ kind: "tread", number: 2 })).toEqual(["tread:2"]);
    expect(kinds({ kind: "nosing", index: 4 })).toEqual(["nosing:4"]);
    expect(kinds({ kind: "stair" })).toEqual(["static:Escalier"]);
    expect(kinds({ kind: "point", at: { x: 1, y: 2, z: 3 } })).toEqual(["static:Point"]);
    const t = whereTargets({ kind: "tread", number: 2 }, PARTS)[0]!;
    expect(t.kind === "tread" && t.location).toEqual({ kind: "tread", number: 2 });
  });

  it("appui d'une marche sur une pièce (« LE1 · M6 ») : pièce, marche, support de cette marche", () => {
    const loc = { kind: "part", partId: "stringer-outer", treadNumber: 6 } as const;
    expect(kinds(loc)).toEqual(["part:LE1", "tread:6", "part:CR6"]);
    expect(FR.t(locationShort(loc, PARTS))).toBe("LE1 · M6");
    // Autre marche sur le même limon : pas le support de M6.
    expect(kinds({ ...loc, treadNumber: 7 })).toEqual(["part:LE1", "tread:7"]);
  });

  it("point rattaché à un nez (échappée) : « Nez k », étiquette du nez sélectionnable", () => {
    const loc = { kind: "point", at: { x: 1, y: 2, z: 3 }, nosingIndex: 2 } as const;
    expect(FR.t(locationShort(loc, PARTS))).toBe("Nez 2");
    expect(kinds(loc)).toEqual(["nosing:2"]);
  });
});

describe("localisations précises : comparaison et règles d'un élément", () => {
  it("même pièce, marches différentes : localisations distinctes", () => {
    const a = { kind: "part", partId: "LE1", treadNumber: 6 } as const;
    expect(sameLocation(a, { ...a })).toBe(true);
    expect(sameLocation(a, { ...a, treadNumber: 7 })).toBe(false);
    expect(sameLocation(a, { kind: "part", partId: "LE1" })).toBe(false);
  });

  it("marche n : appui de n sur un limon, échappée rattachée au nez n − 1", () => {
    const rep = reportOf([
      result({
        ruleId: "A6",
        location: { kind: "part", partId: "stringer-outer", treadNumber: 6 },
      }),
      result({
        ruleId: "A7",
        location: { kind: "part", partId: "stringer-outer", treadNumber: 7 },
      }),
      result({
        ruleId: "H",
        location: { kind: "point", at: { x: 0, y: 0, z: 0 }, nosingIndex: 5 },
      }),
    ]);
    const ids = (l: readonly RuleResult[]) => l.map((r) => r.ruleId);
    expect(ids(resultsForElement(rep, { kind: "tread", number: 6 }, PARTS).violations)).toEqual([
      "A6",
      "H",
    ]);
    // Le limon porte les deux constats.
    expect(
      ids(resultsForElement(rep, { kind: "part", partId: "stringer-outer" }, PARTS).violations),
    ).toEqual(["A6", "A7"]);
  });
});

describe("sélection depuis les vues", () => {
  it("pièce cliquée en 3D : une marche ouvre la marche, une autre pièce la pièce", () => {
    expect(partSelection("tread-6", PARTS)).toEqual({ location: { kind: "tread", number: 6 } });
    expect(partSelection("support-6", PARTS)).toEqual({
      location: { kind: "part", partId: "support-6" },
    });
    expect(partSelection(null, PARTS)).toBeNull();
  });

  it("second clic sur la marche inspectée seulement : efface la sélection", () => {
    const tread6 = { location: { kind: "tread", number: 6 } } as const;
    expect(isExactTreadSelection(tread6, 6)).toBe(true);
    expect(isExactTreadSelection(tread6, 7)).toBe(false);
    expect(isExactTreadSelection({ ...tread6, ruleId: "R" }, 6)).toBe(false);
    expect(isExactTreadSelection({ location: { kind: "part", partId: "tread-6" } }, 6)).toBe(false);
    expect(isExactTreadSelection(null, 6)).toBe(false);
  });

  it("nez k sélectionné : la marche k + 1 est surlignée (comme l'inspecteur Marche)", () => {
    expect(selectedTreadNumber({ kind: "nosing", index: 5 }, PARTS)).toBe(6);
    expect(
      selectedTreadNumber({ kind: "part", partId: "stringer-outer", treadNumber: 6 }, PARTS),
    ).toBe(6);
  });
});

describe("jauge mesuré / attendu", () => {
  it("borne basse franchie (maquette 2c : 37,2 mesuré, attendu ≥ 50)", () => {
    const g = ruleGauge({ measured: 37.2, min: 50, max: null })!;
    expect(g.fill).toBeCloseTo(0.62, 3);
    expect(g.marker).toBeCloseTo(50 / 60, 6);
    expect(g.min).toBe(50);
    expect(g.max).toBeNull();
  });

  it("deux bornes : repère sur la borne franchie, sinon la borne haute", () => {
    const over = ruleGauge({ measured: 700, min: 600, max: 640 })!;
    expect(over.marker).toBeCloseTo(640 / 768, 6);
    expect(over.fill).toBeCloseTo(700 / 768, 6);
    const under = ruleGauge({ measured: 500, min: 600, max: 640 })!;
    expect(under.marker).toBeCloseTo(600 / 768, 6);
    const inside = ruleGauge({ measured: 620, min: 600, max: 640 })!;
    expect(inside.marker).toBeCloseTo(640 / 768, 6);
  });

  it("positions bornées à [0, 1] ; null sans mesure, sans borne ou à échelle nulle", () => {
    expect(ruleGauge({ measured: 1000, min: null, max: 10 })!.fill).toBe(1);
    expect(ruleGauge({ measured: -5, min: 10, max: null })!.fill).toBe(0);
    expect(ruleGauge({ min: 10, max: 20 })).toBeNull();
    expect(ruleGauge({ measured: 10 })).toBeNull();
    expect(ruleGauge({ measured: 10, min: null, max: null })).toBeNull();
    expect(ruleGauge({ measured: 0, min: 0, max: null })).toBeNull();
  });
});
