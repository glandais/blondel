/**
 * Valeurs retenues des paramètres laissés en `auto` (`Model.autoValues`, ADR-0009) : chaque
 * plugin concerné expose la valeur qu'utilise sa géométrie ; une valeur imposée n'apparaît pas.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { Model } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { buildBasicParts } from "../parts/basic.js";
import { parseProjectText } from "../project/parse.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { getStructure } from "../structures/index.js";
import { buildSteelCurved, type SteelCurvedParams } from "../structures/steelCurved.js";
import { buildSteelFlat, type SteelFlatParams } from "../structures/steelFlat.js";
import {
  buildSteelProfile,
  profileNewel,
  type SteelProfileParams,
} from "../structures/steelProfile.js";
import { buildWoodCut, type WoodCutParams } from "../structures/woodCut.js";
import { buildWoodHoused, type WoodHousedParams } from "../structures/woodHoused.js";
import { buildModel, clearModelCache, deepMerge } from "./build.js";

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES, file), "utf8"));

const P = "stair.structure.params.";

const withParams = (p: Project, params: Record<string, unknown>): Project => ({
  ...p,
  stair: {
    ...p.stair,
    structure: { ...p.stair.structure, params: deepMerge(p.stair.structure.params, params) },
  },
});

/** Contexte et paramètres résolus du plugin, comme le pipeline les construit. */
function pluginInput<T>(project: Project, m: Model): { ctx: StructureContext; params: T } {
  const plugin = getStructure(project.stair.structure.kind)!;
  const ctx: StructureContext = {
    project,
    layout: m.layout,
    stepping: m.stepping,
    baseParts: buildBasicParts(project, m.layout, m.stepping).parts,
  };
  const defaults = plugin.defaults(ctx) as Record<string, unknown>;
  const params = plugin.paramsSchema.parse(
    deepMerge(defaults, project.stair.structure.params),
  ) as T;
  return { ctx, params };
}

/** Clés de `autoValues` sous les paramètres de structure. */
const structureKeys = (m: Model): string[] =>
  Object.keys(m.autoValues ?? {})
    .filter((k) => k.startsWith(P))
    .map((k) => k.slice(P.length))
    .sort();

beforeEach(() => clearModelCache());

/**
 * Valeur retenue attendue d'un paramètre résolu par limon : la valeur commune, absente si les
 * limons diffèrent (l'imposer d'un clic changerait un limon).
 */
const common = (values: readonly number[]): number | undefined =>
  Math.max(...values) - Math.min(...values) <= 1e-6 ? values[0] : undefined;

describe("Model.autoValues — plugins de structure", () => {
  it("wood-housed : d_h, d_b, prolongements, encastrement, tenon = valeurs résolues", () => {
    const p = load("j3a-acceptance-01-bois.blondel.json");
    const m = buildModel(p);
    expect(m.errors).toEqual([]);
    const { ctx, params } = pluginInput<WoodHousedParams>(p, m);
    const r = buildWoodHoused(ctx, params);
    const sides = [...new Set(r.stringers.map((s) => s.face.side))];
    const a = m.autoValues!;
    expect(a[`${P}housingDepth`]).toBe(r.resolved.housingDepth);
    expect(a[`${P}newel.tenonThickness`]).toBe(r.resolved.tenonThickness);
    expect(a[`${P}upperOffset`]).toBe(common(sides.map((s) => r.resolved.upperOffset[s])));
    expect(a[`${P}lowerOffset`]).toBe(common(sides.map((s) => r.resolved.lowerOffset[s])));
    expect(a[`${P}startExtension`]).toBe(r.resolved.startExtension);
    expect(a[`${P}endExtension`]).toBe(r.resolved.endExtension);
    // Valeurs imposées : clés absentes, les autres restent.
    const q = withParams(p, { lowerOffset: 80, newel: { tenonThickness: 12 } });
    const mq = buildModel(q);
    // d_h n'est exposé que s'il est le même sur les deux limons (ici, il diffère).
    const upper = common(sides.map((s) => r.resolved.upperOffset[s]));
    expect(upper).toBeUndefined();
    expect(structureKeys(mq)).toEqual(["endExtension", "housingDepth", "startExtension"].sort());
  });

  it("wood-housed : la valeur retenue, imposée, redonne la même géométrie (d_h, d_b égaux des deux côtés)", () => {
    const p = load("j3a-acceptance-01-bois.blondel.json");
    const m = buildModel(p);
    const a = m.autoValues!;
    const fixedParams = {
      housingDepth: a[`${P}housingDepth`],
      startExtension: a[`${P}startExtension`],
      endExtension: a[`${P}endExtension`],
      newel: { tenonThickness: a[`${P}newel.tenonThickness`] },
    };
    const mq = buildModel(withParams(p, fixedParams));
    expect(mq.parts.map((x) => x.solid)).toEqual(m.parts.map((x) => x.solid));
  });

  it("steel-flat : d_b retenu = valeur commune des limons ; imposé → absent", () => {
    const p = load("j3b-acceptance-01-acier-plat.blondel.json");
    const m = buildModel(p);
    const { ctx, params } = pluginInput<SteelFlatParams>(p, m);
    const r = buildSteelFlat(ctx, params);
    const sides = [...new Set(r.stringers.map((s) => s.face.side))];
    const value = common(sides.map((s) => r.lowerOffset[s]));
    expect(m.autoValues![`${P}lowerOffset`]).toBe(value);
    expect(structureKeys(m)).toEqual(value === undefined ? [] : ["lowerOffset"]);
    expect(structureKeys(buildModel(withParams(p, { lowerOffset: 120 })))).toEqual([]);
  });

  it("steel-curved : d_b retenu (limons droits et débillardé)", () => {
    const p = load("j5b-debillarde-soude.blondel.json");
    const m = buildModel(p);
    const { ctx, params } = pluginInput<SteelCurvedParams>(p, m);
    const r = buildSteelCurved(ctx, params);
    expect(r.curved).not.toBeNull();
    const values = [
      ...r.flat.stringers.map((s) => r.flat.lowerOffset[s.face.side]),
      r.curved!.lowerOffset,
    ];
    expect(m.autoValues?.[`${P}lowerOffset`]).toBe(common(values));
    expect(structureKeys(buildModel(withParams(p, { lowerOffset: 150 })))).toEqual([]);
  });

  it("steel-profile : côté de poteau `auto` = poteau attendu pour la section retenue", () => {
    const p = load("j3c-acceptance-01-upn.blondel.json");
    const m = buildModel(p);
    const { ctx, params } = pluginInput<SteelProfileParams>(p, m);
    const r = buildSteelProfile(ctx, params);
    expect(r.section).not.toBeNull();
    expect(m.autoValues![`${P}newel.size`]).toBe(profileNewel(r.section!.b, params.newel).size);
    // `section` (nom de profilé) n'est pas un nombre : jamais exposé.
    expect(structureKeys(m)).toEqual(["newel.size"]);
    expect(structureKeys(buildModel(withParams(p, { newel: { size: 120 } })))).toEqual([]);
  });

  it("wood-cut : reste sous entaille retenu ; imposé → absent", () => {
    const p = makeSteppingProject({
      width: 900,
      legs: [3780],
      structure: { kind: "wood-cut", params: {} },
    });
    const m = buildModel(p);
    const { ctx, params } = pluginInput<WoodCutParams>(p, m);
    const r = buildWoodCut(ctx, params);
    expect(m.autoValues![`${P}residual`]).toBe(r.residual);
    expect(structureKeys(buildModel(withParams(p, { residual: 150 })))).toEqual([]);
  });

  it("sans structure ni paramètre `auto` : champ absent", () => {
    const p = makeSteppingProject({
      width: 900,
      legs: [3780],
      stepping: { riserCount: 15, targetGoing: 270 },
    });
    expect(buildModel(p).autoValues).toBeUndefined();
  });
});

describe("Model.autoValues — tracé et découpage", () => {
  it("escalier droit `auto` : longueur de volée, nombre de hauteurs, giron cible", () => {
    const p = makeSteppingProject({ width: 900, legs: ["auto"] });
    const m = buildModel(p);
    const a = m.autoValues!;
    // H = 2 700, n = 15, g = 630 − 2 × 180 = 270, R = 14 × 270.
    expect(a["stair.stepping.riserCount"]).toBe(m.stepping.riserCount);
    expect(a["stair.stepping.riserCount"]).toBe(15);
    expect(a["stair.stepping.targetGoing"]).toBeCloseTo(270, 9);
    expect(a["stair.layout.legs.0.length"]).toBeCloseTo(3780, 9);
    expect(a["stair.layout.legs.0.length"]).toBeCloseTo(m.stepping.run, 6);
    // Longueur imposée : ni longueur ni giron cible (inutilisé).
    const q = makeSteppingProject({ width: 900, legs: [3500] });
    const aq = buildModel(q).autoValues ?? {};
    expect(aq["stair.layout.legs.0.length"]).toBeUndefined();
    expect(aq["stair.stepping.targetGoing"]).toBeUndefined();
    expect(aq["stair.stepping.riserCount"]).toBe(15);
  });

  it("identité stable pour un même résultat (mémoïsation)", () => {
    const p = load("j3a-acceptance-01-bois.blondel.json");
    const a = buildModel(p);
    const b = buildModel({ ...p, name: "autre" });
    expect(b.autoValues).toBe(a.autoValues);
  });
});
