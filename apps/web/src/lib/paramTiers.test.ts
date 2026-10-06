/**
 * Dictionnaire des niveaux (ADR-0009) : placement selon le mode d'affichage, clés, recherche
 * par préfixe, couverture de tous les chemins éditables des préréglages et démos, cohérence des
 * ◆ des plugins avec `paramLabels`, valeurs ◆ d'un projet et leurs comptes.
 */
import {
  ALL_PRESET_IDS,
  DEMO_PRESET_IDS,
  buildModel,
  createDemoProject,
  createProject,
  withValidatedValues,
  type Model,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { defaultGuards } from "./guardsForm.js";
import { availableStructures } from "./optionalApi.js";
import { fieldText } from "./paramLabels.js";
import {
  hasStructureParamEntry,
  isToValidate,
  paramKey,
  placementOf,
  structureParamApplies,
  structureParamEntry,
  tierEntry,
  tierEntryKey,
  toValidateCountBySection,
  toValidateCountByStep,
  toValidateItems,
  toValidateStates,
  treadsMaterialApplies,
  type ParamTierEntry,
} from "./paramTiers.js";
import { GUIDED_STEPS, SECTION_IDS } from "./sectionIds.js";
import { deriveParamFields, safeDefaults, structureContext } from "./structureForm.js";

const projects: readonly Project[] = [
  ...ALL_PRESET_IDS.map((id) => createProject(id)),
  ...DEMO_PRESET_IDS.map((id) => createDemoProject(id)),
];

const withStructure = (p: Project, kind: string): Project => ({
  ...p,
  stair: { ...p.stair, structure: { kind, params: {} } },
});

describe("placementOf", () => {
  const e = (x: Partial<ParamTierEntry>): ParamTierEntry => ({
    tier: "essential",
    section: "site",
    guided: [],
    ...x,
  });
  const essential = e({ guided: [{ step: 1, more: false }] });
  const designMore = e({ tier: "design", guided: [{ step: 1, more: true }] });
  const designAbsent = e({ tier: "design" });
  const workshop = e({ tier: "workshop" });

  it("all : tout à la suite", () => {
    for (const x of [essential, designMore, designAbsent, workshop]) {
      expect(placementOf(x, { kind: "all" })).toBe("main");
    }
  });

  it("free : Atelier replié, le reste visible", () => {
    expect(placementOf(essential, { kind: "free" })).toBe("main");
    expect(placementOf(designMore, { kind: "free" })).toBe("main");
    expect(placementOf(designAbsent, { kind: "free" })).toBe("main");
    expect(placementOf(workshop, { kind: "free" })).toBe("workshop");
  });

  it("guided : étape, « Plus », absent ; l'étape 7 reprend l'Atelier", () => {
    expect(placementOf(essential, { kind: "guided", step: 1 })).toBe("main");
    expect(placementOf(essential, { kind: "guided", step: 2 })).toBe("hidden");
    expect(placementOf(designMore, { kind: "guided", step: 1 })).toBe("more");
    expect(placementOf(designAbsent, { kind: "guided", step: 1 })).toBe("hidden");
    expect(placementOf(workshop, { kind: "guided", step: 5 })).toBe("hidden");
    expect(placementOf(workshop, { kind: "guided", step: 7 })).toBe("more");
    expect(placementOf(designAbsent, { kind: "guided", step: 7 })).toBe("hidden");
  });
});

describe("clés", () => {
  it("indices remplacés par *", () => {
    expect(paramKey(["stair", "layout", "legs", 2, "length"])).toBe("stair.layout.legs.*.length");
    expect(paramKey(["guards"])).toBe("guards");
  });

  it("recherche par le préfixe le plus long", () => {
    expect(tierEntryKey("guards.infill.section.diameter")).toBe("guards.infill.section");
    expect(tierEntryKey("stair.layout.turns.*.inner.radius")).toBe("stair.layout.turns.*.inner");
    expect(tierEntryKey("stair.layout.turns.*.inner.offset")).toBe(
      "stair.layout.turns.*.inner.offset",
    );
    expect(tierEntry("stair.layout.turns.*.inner.offset")?.tier).toBe("design");
    expect(tierEntry("site.opening.points.*.x")).toBe(tierEntry("site.opening"));
    expect(tierEntry("inconnu.chemin")).toBeUndefined();
  });

  it("paramètres de plugin : variantes, préfixes, repli Atelier", () => {
    expect(structureParamEntry("helical-core", ["treads", "material"]).tier).toBe("essential");
    expect(structureParamEntry("steel-flat", ["newel", "bolts"]).tier).toBe("workshop");
    expect(structureParamEntry("steel-flat", ["newel", "joint"]).tier).toBe("design");
    expect(structureParamEntry("x", ["inconnu"])).toMatchObject({
      tier: "workshop",
      section: "structure",
    });
    expect(hasStructureParamEntry("x", ["inconnu"])).toBe(false);
    expect(tierEntry("stair.structure.params.grade")?.tier).toBe("essential");
  });

  it("ADR-0009 : longueur d'appui mini des supports au niveau Conception", () => {
    for (const kind of ["steel-flat", "steel-profile", "steel-curved"]) {
      expect(structureParamEntry(kind, ["supports", "minLength"]).tier).toBe("design");
    }
    expect(structureParamEntry("steel-profile", ["supports", "minBearing"]).tier).toBe("workshop");
    expect(structureParamEntry("steel-profile", ["supports", "angleLeg"]).tier).toBe("workshop");
  });

  it("essence et rayon de nez : aussi dans « Marches »", () => {
    for (const p of [["material"], ["noseRadius"], ["treadKind"]]) {
      expect(structureParamEntry("wood-housed", p).alsoIn).toEqual(["treads"]);
    }
    expect(structureParamEntry("helical-core", ["treads", "material"]).alsoIn).toEqual(["treads"]);
  });
});

/** Feuilles d'un projet (chemins joints, indices en `*`), hors paramètres de plugin. */
function leaves(v: unknown, path: string[] = [], out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => leaves(x, [...path, "*"], out));
  else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v)) leaves(x, [...path, k], out);
  } else out.add(path.join("."));
  return out;
}

/**
 * Chemins non édités par les sections de paramètres : identité et versions du fichier,
 * placement (plan), murs et calque de fond (plan Site ; entrées `ui:`), surcharges de nez et de
 * règles (inspecteurs, contrôle), apparence (vue 3D), réglages des garde-corps sans champ
 * (rehausse sur palier, dépassement du poteau : défauts du cœur).
 */
const NOT_EDITABLE = [
  /^name$/,
  /^schemaVersion$/,
  /^rulesVersion$/,
  /^appearance\./,
  /^stair\.placement\./,
  /^site\.walls\./,
  /^site\.underlay\./,
  /^stair\.nosingOverrides\./,
  /^compliance\.overrides\./,
  /^guards\.flight\.landing\./,
  /^guards\.posts\.newelOverrun$/,
  /^stair\.structure\.params\./,
];

/** Entrées qui couvrent un sous-objet (recherche par préfixe admise). */
const SUBTREES = new Set([
  "site.opening",
  "stair.layout.turns.*.inner",
  "stair.layout.core",
  "stair.layout.sweep",
  "stair.layout.landing",
  "guards.infill.section",
  "guards.handrail.section",
  "compliance.contexts",
]);

/** Champs facultatifs absents des préréglages, édités par les sections. */
const OPTIONAL_PATHS = [
  "stair.walkline.distance",
  "stair.walkline.side",
  "stair.layout.turns.*.inner.offset",
  "stair.layout.sweep.degrees",
  "stair.balancing.herseAngle",
  "stair.balancing.rotationReach",
  "stair.balancing.rotationSteepness",
  "compliance.referenceDate",
  "guards.infill.spacing",
  "guards.infill.count",
  "guards.infill.diameter",
  "guards.infill.thickness",
  "guards.infill.panelGap",
  "guards.infill.holeDiameter",
];

describe("couverture du dictionnaire", () => {
  it("tout chemin éditable des préréglages et démos a une entrée", () => {
    const keys = new Set<string>(OPTIONAL_PATHS);
    for (const p of [...projects, { ...projects[0]!, guards: defaultGuards() }])
      leaves(p, [], keys);
    const missing: string[] = [];
    for (const k of keys) {
      if (NOT_EDITABLE.some((re) => re.test(k))) continue;
      const hit = tierEntryKey(k);
      if (hit === undefined || (hit !== k && !SUBTREES.has(hit))) missing.push(`${k} → ${hit}`);
    }
    expect(missing).toEqual([]);
  });

  it("chaque paramètre de chaque plugin a une entrée explicite, ◆ cohérent avec paramLabels", () => {
    const missing: string[] = [];
    const incoherent: string[] = [];
    let checked = 0;
    for (const plugin of availableStructures()) {
      for (const base of projects) {
        const p = withStructure(base, plugin.kind);
        const defaults = safeDefaults(plugin, structureContext(p, buildModel(p)));
        if (defaults === undefined) continue;
        for (const f of deriveParamFields(defaults, plugin.paramsSchema)) {
          checked++;
          const at = `${plugin.kind}:${f.path.join(".")}`;
          if (!hasStructureParamEntry(plugin.kind, f.path)) missing.push(at);
          const tv = fieldText(plugin.kind, f.path)?.hint === "ui.param.toValidate";
          if ((structureParamEntry(plugin.kind, f.path).toValidate === true) !== tv) {
            incoherent.push(at);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
    expect(incoherent).toEqual([]);
  });

  it("toute entrée a une section connue et des étapes valides", () => {
    for (const k of [...OPTIONAL_PATHS, "guards", "ui:site.walls", "ui:layout.realign"]) {
      const e = tierEntry(k)!;
      expect(SECTION_IDS).toContain(e.section);
      for (const g of e.guided) expect(GUIDED_STEPS).toContain(g.step);
    }
  });

  it("◆ des garde-corps et de M6 déclarés dans le dictionnaire", () => {
    for (const k of [
      "guards.material",
      "guards.infill.spacing",
      "guards.infill.thickness",
      "guards.flight.edgeOffset",
      "guards.opening.setback",
      "guards.posts.size",
      "guards.posts.maxSpacing",
      "guards.posts.cornerAngle",
      "guards.wallTolerance",
      "stair.balancing.rotationReach",
      "stair.balancing.rotationSteepness",
    ]) {
      expect(isToValidate(k)).toBe(true);
    }
    for (const k of ["guards.flight.height", "guards.infill.panelGap", "site.floorToFloor"]) {
      expect(isToValidate(k)).toBe(false);
    }
  });
});

describe("valeurs ◆ d'un projet", () => {
  const base = createProject(ALL_PRESET_IDS[0]);
  const keysOf = (p: Project, m?: Model | null): string[] =>
    toValidateItems(p, m).map((i) => i.key);

  it("sans garde-corps : aucun ◆ de garde-corps", () => {
    const p = { ...base, guards: undefined } as Project;
    expect(keysOf(p).filter((k) => k.startsWith("guards"))).toEqual([]);
  });

  it("garde-corps verre : épaisseur ◆, pas d'entraxe de balustres", () => {
    const g = defaultGuards();
    const p: Project = {
      ...base,
      guards: { ...g, infill: { kind: "glass", thickness: 18, panelGap: 20, bottomGap: 50 } },
    };
    const keys = keysOf(p);
    expect(keys).toContain("guards.infill.thickness");
    expect(keys).toContain("guards.material");
    expect(keys).not.toContain("guards.infill.spacing");
    const item = toValidateItems(p).find((i) => i.key === "guards.infill.thickness")!;
    expect(item).toMatchObject({ section: "guards", steps: [6] });
  });

  it("acier plat : épaisseur des limons ◆ (avec ou sans modèle)", () => {
    const p = withStructure(base, "steel-flat");
    const m = buildModel(p);
    expect(keysOf(p, m)).toContain("stair.structure.params.thickness");
    // Sans modèle : paramètres enregistrés au choix de la structure (défauts complets).
    const plugin = availableStructures().find((k) => k.kind === "steel-flat")!;
    const params = safeDefaults(plugin, structureContext(p, m)) as Record<string, unknown>;
    const saved: Project = {
      ...p,
      stair: { ...p.stair, structure: { kind: "steel-flat", params } },
    };
    expect(keysOf(saved)).toEqual(keysOf(p, m));
  });

  it("paramètres de plugin conditionnels : tôle pliée et poteau seulement s'ils s'appliquent", () => {
    const p = createDemoProject("demo-quarter-curved");
    const m = buildModel(p);
    const keys = keysOf(p, m);
    // Jour en arc, marches bois : ni poteau ni tôle pliée.
    expect(keys.filter((k) => /params\.(newel|folded)\./.test(k))).toEqual([]);
    const items = toValidateItems(p, m);
    expect(toValidateCountBySection(p, m).structure).toBe(
      items.filter((i) => i.section === "structure").length,
    );
    expect(structureParamApplies(p, { treadKind: "wood" }, ["folded", "thickness"])).toBe(false);
    expect(structureParamApplies(p, { treadKind: "folded-steel" }, ["folded", "thickness"])).toBe(
      true,
    );
    expect(structureParamApplies(p, {}, ["newel", "bolts"])).toBe(false);
    expect(structureParamApplies(p, {}, ["thickness"])).toBe(true);
    // Dimensions du plat ou de la cornière selon le type de support.
    const angle = { supports: { kind: "angle" } };
    const plate = { supports: { kind: "plate" } };
    expect(structureParamApplies(p, angle, ["supports", "plateWidth"])).toBe(false);
    expect(structureParamApplies(p, angle, ["supports", "angleLeg"])).toBe(true);
    expect(structureParamApplies(p, plate, ["supports", "angleThickness"])).toBe(false);
    expect(structureParamApplies(p, plate, ["supports", "plateThickness"])).toBe(true);
    expect(structureParamApplies(p, plate, ["supports", "minLength"])).toBe(true);
    const turns = (p.stair.layout.turns ?? []).map((t) => ({
      ...t,
      inner: { kind: "newel" as const, size: 100 },
    }));
    const withNewel: Project = {
      ...p,
      stair: { ...p.stair, layout: { ...p.stair.layout, turns } } as Project["stair"],
    };
    expect(structureParamApplies(withNewel, {}, ["newel", "bolts"])).toBe(true);
  });

  it("essence des marches du projet : marches bois sans essence propre au plugin", () => {
    expect(treadsMaterialApplies(undefined)).toBe(true);
    expect(treadsMaterialApplies({ treadKind: "wood" })).toBe(true);
    expect(treadsMaterialApplies({ treadKind: "folded-steel" })).toBe(false);
    expect(treadsMaterialApplies({ material: "wood-oak" })).toBe(false);
    expect(treadsMaterialApplies({ treads: { material: "wood" } })).toBe(true);
    expect(treadsMaterialApplies({ treads: { material: "steel" } })).toBe(false);
  });

  it("M6 : portée et raideur ◆", () => {
    const p: Project = {
      ...base,
      stair: { ...base.stair, balancing: { ...base.stair.balancing, method: "M6" } },
    };
    const keys = keysOf(p);
    expect(keys).toContain("stair.balancing.rotationReach");
    expect(keys).toContain("stair.balancing.rotationSteepness");
    expect(keysOf(base)).not.toContain("stair.balancing.rotationReach");
  });

  it("comptes par section et par étape", () => {
    const p: Project = { ...withStructure(base, "steel-flat"), guards: defaultGuards() };
    const m = buildModel(p);
    const items = toValidateItems(p, m);
    const bySection = toValidateCountBySection(p, m);
    const byStep = toValidateCountByStep(p, m);
    expect(Object.keys(bySection)).toEqual([...SECTION_IDS]);
    expect(Object.values(bySection).reduce((a, b) => a + b, 0)).toBe(items.length);
    expect(byStep[7]).toBe(items.length);
    // Balustres : matériau (étape 6), entraxe (étape 6, « Plus ») ; le reste en Atelier.
    expect(byStep[6]).toBe(2);
    expect(bySection.guards).toBe(8);
    expect(bySection.structure).toBe(items.filter((i) => i.section === "structure").length);
    expect(bySection.structure).toBeGreaterThan(0);
  });

  it("les compteurs (rail, étapes) ne comptent que les valeurs restantes", () => {
    const p: Project = { ...withStructure(base, "steel-flat"), guards: defaultGuards() };
    const m = buildModel(p);
    const states = toValidateStates(p, m);
    expect(states.map((s) => s.key)).toEqual(toValidateItems(p, m).map((i) => i.key));
    const before = toValidateCountBySection(p, m);
    const stepsBefore = toValidateCountByStep(p, m);
    // Valider le matériau (étape 6) et l'épaisseur des limons (plugin).
    const material = states.find((s) => s.key === "guards.material")!;
    const thickness = states.find((s) => s.key === "stair.structure.params.thickness")!;
    expect(material.value).toBe(p.guards!.material);
    expect(thickness.structureKind).toBe("steel-flat");
    const validated = withValidatedValues(p, [
      { path: material.key, value: material.value! },
      { path: thickness.key, value: thickness.value!, structureKind: "steel-flat" },
    ]);
    const after = toValidateCountBySection(validated, m);
    expect(after.guards).toBe(before.guards - 1);
    expect(after.structure).toBe(before.structure - 1);
    const stepsAfter = toValidateCountByStep(validated, m);
    expect(stepsAfter[6]).toBe(stepsBefore[6] - 1);
    expect(stepsAfter[7]).toBe(stepsBefore[7] - 2);
    // Les éléments restent listés (validés compris).
    expect(toValidateItems(validated, m)).toHaveLength(states.length);
    // Valeur changée : la validation est caduque, le compteur remonte.
    const changed: Project = {
      ...validated,
      guards: { ...validated.guards!, material: "steel-raw" },
    };
    expect(toValidateCountBySection(changed, m).guards).toBe(before.guards);
    // Autre plugin : la validation du paramètre de plugin ne vaut plus.
    const other = withStructure(validated, "steel-curved");
    const s = toValidateStates(other, buildModel(other)).find(
      (x) => x.key === "stair.structure.params.thickness",
    );
    if (s !== undefined) expect(s.validated).toBe(false);
  });
});
