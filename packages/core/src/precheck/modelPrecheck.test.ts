/**
 * `Model.precheck` : une seule source pour le prédimensionnement (panneau, comparateur et lignes
 * PRECHECK_* du contrôle de conception).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import { ruleDescription } from "../model/messages.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createDemoProject } from "../project/presetDemo.js";
import "../structures/index.js";
import { PRECHECK_LABEL, PRECHECK_RULE_IDS, precheckResults } from "./checks.js";
import { precheckModel, structurePrecheckSettings } from "./stringers.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const load = (file: string): Project =>
  parseProjectText(readFileSync(resolve(EXAMPLES_DIR, file), "utf8"));

const withStructure = (p: Project, kind: string): Project => ({
  ...p,
  stair: { ...p.stair, structure: { kind, params: {} } },
});

const keyOf = (r: { ruleId: string; location: unknown; measured?: number; status: string }) =>
  `${r.ruleId}|${JSON.stringify(r.location)}|${r.status}|${r.measured?.toFixed(6)}`;

describe("Model.precheck", () => {
  it("steel-profile : le prédimensionnement du modèle est celui des lignes PRECHECK_*", () => {
    const project = load("j3c-acceptance-01-upn.blondel.json");
    const model = buildModel(project);
    const pc = model.precheck;
    expect(pc).toBeDefined();
    expect(pc!.beams.length).toBeGreaterThan(0);
    const fromModel = precheckResults(project, model.stepping, pc!.beams).map(keyOf).sort();
    const fromCompliance = model.compliance.results
      .filter((r) => PRECHECK_RULE_IDS.has(r.ruleId))
      .map(keyOf)
      .sort();
    expect(fromModel).toEqual(fromCompliance);
    for (const b of pc!.beams) expect(model.parts.some((p) => p.id === b.partId)).toBe(true);
  });

  it("plats et bois : repli sur precheckStringers (mêmes valeurs que precheckModel)", () => {
    const base = load("quarter-left.blondel.json");
    for (const kind of ["steel-flat", "wood-housed"]) {
      const p = withStructure(base, kind);
      const model = buildModel(p);
      const expected = precheckModel(p, model, structurePrecheckSettings(p.stair.structure.params));
      expect(model.precheck, kind).toBeDefined();
      expect(model.precheck!.beams.length, kind).toBeGreaterThan(0);
      expect(model.precheck!.beams).toEqual(expected.beams);
      expect(model.precheck!.loads).toEqual(expected.loads);
      expect(model.precheck!.permanentArea).toBeCloseTo(expected.permanentArea, 9);
    }
  });

  it("sans structure : pas de prédimensionnement", () => {
    expect(
      buildModel(withStructure(load("quarter-left.blondel.json"), "none")).precheck,
    ).toBeUndefined();
  });
});

describe("structurePrecheckSettings", () => {
  it("lit params.precheck s'il est valide, `{}` sinon", () => {
    expect(structurePrecheckSettings({ precheck: { category: "D2" } }).category).toBe("D2");
    expect(structurePrecheckSettings({ precheck: { category: 12 } })).toEqual({});
    expect(structurePrecheckSettings(undefined)).toEqual({});
    expect(structurePrecheckSettings({})).toEqual({});
  });
});

describe("prédimensionnement : messages traduits (ADR-0007)", () => {
  it("libellés, remarques et constats : français d'avant, anglais sans reste de français", () => {
    const EN = translatorFor("en");
    const p = withStructure(load("quarter-left.blondel.json"), "steel-flat");
    const pc = precheckModel(p, buildModel(p));
    expect(pc.beams.length).toBeGreaterThan(0);
    for (const b of pc.beams) {
      expect(fr(b.label)).toMatch(/^[A-Z]+\d*, section brute \d+ × \d+ S235$/);
      expect(EN.t(b.label)).toMatch(/^[A-Z]+\d*, rough section \d+ × \d+ S235$/);
    }
    expect(frList(pc.notes)[0]).toMatch(
      /^Prédimensionnement indicatif \(ne remplace pas une note de calcul\) : q_k [\d,]+ kN\/m², /,
    );
    expect(frList(pc.notes)[1]).toMatch(/^Limons en plat : déversement et torsion/);
    for (const r of pc.results) {
      expect(fr(r.message)).toMatch(new RegExp(`^${fr(PRECHECK_LABEL)} — `));
      expect(EN.t(r.message)).toMatch(/^Preliminary sizing for guidance only, /);
      expect(EN.t(r.message)).not.toMatch(/flèche|taux|section brute/);
      expect(EN.t(ruleDescription(r.ruleId))).toMatch(
        /^Preliminary sizing for guidance only, does not replace a structural calculation: /,
      );
    }
    for (const n of pc.notes) expect(EN.t(n)).not.toMatch(/limon|poutres|permanentes/);
  });
});

describe("classe `auto` D30 des feuillus dans la chaîne (QUESTIONS A36 (1))", () => {
  /** Même projet, classe de prédimensionnement saisie (`precheck.woodClass`). */
  const withClass = (p: Project, woodClass: string): Project => ({
    ...p,
    stair: {
      ...p.stair,
      structure: {
        ...p.stair.structure,
        params: { ...(p.stair.structure.params as object), precheck: { woodClass } },
      },
    },
  });
  /** Ratio des résistances de calcul `auto` / classe saisie, poutre par poutre. */
  const designRatio = (p: Project, woodClass: string): number[] => {
    const auto = buildModel(p).precheck!.beams;
    const set = buildModel(withClass(p, woodClass)).precheck!.beams;
    expect(set.map((b) => b.partId)).toEqual(auto.map((b) => b.partId));
    return auto.map((b, i) => b.result.design / set[i]!.result.design);
  };
  const cases: [string, () => Project][] = [
    // Limons à la française de chêne (`wood-housed`) : C24 → D30 (f_m,k 24 → 30 MPa).
    ["demo-u-oak (wood-housed, chêne)", () => createDemoProject("demo-u-oak")],
    ["j3a-acceptance-01-bois (wood-housed)", () => load("j3a-acceptance-01-bois.blondel.json")],
    // Frêne (`wood-housed`) : D30 par analogie, à valider (QUESTIONS A37 (3)). Les crémaillères
    // de `wood-cut` ne sont pas prédimensionnées : leur classe `auto` ne sert qu'au tableau FCBA
    // (colonne C30, `woodCut.test.ts`).
    [
      "demo-quarter-landing-ash (wood-housed, frêne)",
      () => createDemoProject("demo-quarter-landing-ash"),
    ],
  ];

  it.each(cases)("%s : prédimensionnement en D30, comme une classe D30 saisie", (_, make) => {
    const p = make();
    const m = buildModel(p);
    expect(frList(m.errors)).toEqual([]);
    const beams = m.precheck!.beams;
    expect(beams.length).toBeGreaterThan(0);
    for (const b of beams) expect(fr(b.label)).toMatch(/\bD30\b/);
    // Même résultat qu'avec D30 saisie ; résistance de calcul dans le rapport 30 / 24 de C24.
    for (const r of designRatio(p, "D30")) expect(r).toBeCloseTo(1, 12);
    for (const r of designRatio(p, "C24")) expect(r).toBeCloseTo(30 / 24, 12);
  });
});
