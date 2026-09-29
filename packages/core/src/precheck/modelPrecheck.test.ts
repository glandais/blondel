/**
 * `Model.precheck` : une seule source pour le prédimensionnement (panneau, comparateur et lignes
 * PRECHECK_* du contrôle de conception).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import "../structures/index.js";
import { PRECHECK_RULE_IDS, precheckResults } from "./checks.js";
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
