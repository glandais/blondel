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
  fastenerKindLabel,
  msg,
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
    // À plat : l'étape 7 range déjà ses réglages d'atelier sous son propre repli.
    expect(placementOf(workshop, { kind: "guided", step: 7 })).toBe("main");
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

  it("limon central (A29) : section en Essentiel, dimensions et justification sous « Plus », reste en Atelier", () => {
    const e = (p: string) => structureParamEntry("steel-central", p.split("."));
    expect(e("section.kind")).toMatchObject({
      tier: "essential",
      guided: [{ step: 5, more: false }],
    });
    for (const p of ["grade", "finish"]) expect(e(p).tier).toBe("essential");
    expect(e("treadKind")).toMatchObject({ tier: "essential", alsoIn: ["treads"] });
    for (const p of [
      "section.height",
      "section.width",
      "supports.kind",
      "trace.lateralOffset",
      "beam.topOffset",
      "cantileverJustification",
    ]) {
      expect(e(p), p).toMatchObject({ tier: "design", guided: [{ step: 5, more: true }] });
    }
    for (const p of [
      "section.wallThickness",
      "section.webThickness",
      "section.diaphragmSpacing",
      "section.ventDiameter",
      "beam.splice",
      "beam.jointOffset",
      "supports.consoleThickness",
      "supports.landingSpacing",
      "plates.thickness",
      "folded.noseHeight",
    ]) {
      expect(e(p).tier, p).toBe("workshop");
    }
    // ◆ déduits de paramLabels : dimensions sans source oui, choix et valeurs « auto » non.
    expect(e("section.height").toValidate).toBe(true);
    expect(e("supports.consoleThickness").toValidate).toBe(true);
    expect(e("section.kind").toValidate).toBeUndefined();
    expect(e("beam.topOffset").toValidate).toBeUndefined();
    // La section du catalogue des profilés garde son entrée commune.
    expect(structureParamEntry("steel-profile", ["section"]).tier).toBe("design");
  });

  it("limon central bois (A29, vague 2) : section, largeur, essence en Essentiel ; ◆ sans source", () => {
    const e = (p: string) => structureParamEntry("wood-central", p.split("."));
    for (const p of ["section.kind", "section.width", "material"]) {
      expect(e(p), p).toMatchObject({ tier: "essential" });
      expect(e(p).guided, p).toContainEqual({ step: 5, more: false });
    }
    for (const p of [
      "strengthClass",
      "trace.lateralOffset",
      "section.residual",
      "section.lamellaThickness",
      "notch.rearDepth",
      "bolts.perTread",
      "anchors.foot",
      "anchors.head",
      "cantileverJustification",
      "laminationJustification",
    ]) {
      expect(e(p), p).toMatchObject({ tier: "design", guided: [{ step: 5, more: true }] });
    }
    for (const p of [
      "section.residualFallback",
      "section.thinPlyMax",
      "bolts.holeDiameter",
      "bolts.edgeDistance",
      "bolts.protrusion",
      "bolts.lengthStep",
      "anchors.grade",
      "anchors.finish",
      "anchors.thickness",
      "anchors.cheekDepth",
      "anchors.length",
      "anchors.anchors",
      "anchors.anchorHoleDiameter",
      "anchors.bolts",
      "anchors.boltHoleDiameter",
      "anchors.holeEdgeDistance",
      "precheck.gammaMWood",
    ]) {
      expect(e(p).tier, p).toBe("workshop");
    }
    // ◆ : valeurs sans source oui ; choix, valeurs « auto » et justifications non.
    for (const p of [
      "section.width",
      "trace.lateralOffset",
      "section.residualFallback",
      "section.thinPlyMax",
      "bolts.perTread",
      "bolts.holeDiameter",
      "anchors.thickness",
      "anchors.grade",
      "anchors.holeEdgeDistance",
    ]) {
      expect(e(p).toValidate, p).toBe(true);
    }
    for (const p of [
      "section.kind",
      "material",
      "strengthClass",
      "section.residual",
      "section.lamellaThickness",
      "notch.rearDepth",
      "anchors.foot",
      "laminationJustification",
    ]) {
      expect(e(p).toValidate, p).toBeUndefined();
    }
    // Suites du 2026-10-09 (A33 e, f ; A34 a, b, c) : choix en Conception sous « Plus »,
    // dimensions en Atelier, ◆ sur toute valeur sans source (couches, tire-fonds, platine).
    for (const p of ["section.curvedMethod", "section.layerThickness", "anchors.kind"]) {
      expect(e(p), p).toMatchObject({ tier: "design", guided: [{ step: 5, more: true }] });
    }
    for (const p of [
      "section.mouldMaxWidth",
      "section.dressingAllowance",
      "lagScrews.pilotDiameter",
      "lagScrews.minAnchorage",
      "lagScrews.tipCover",
      "lagScrews.maxLength",
      "anchors.plate.thickness",
      "anchors.plate.width",
      "anchors.plate.webThickness",
      "anchors.plate.webDepth",
      "anchors.plate.webLength",
      "anchors.plate.pins",
      "anchors.plate.pinDiameter",
      "anchors.plate.pinHoleDiameter",
      "precheck.gammaMGlulam",
      "precheck.woodClass",
    ]) {
      expect(e(p).tier, p).toBe("workshop");
    }
    for (const p of [
      "section.mouldMaxWidth",
      "section.layerThickness",
      "section.dressingAllowance",
      "bolts.edgeDistance",
      "bolts.minSpacing",
      "lagScrews.maxLength",
      "anchors.plate.webDepth",
      "anchors.plate.pins",
      "precheck.gammaMGlulam",
    ]) {
      expect(e(p).toValidate, p).toBe(true);
    }
    expect(e("section.curvedMethod").toValidate).toBeUndefined();
    expect(e("anchors.kind").toValidate).toBeUndefined();
    // Chaque chemin du schéma a son entrée (aucun repli Atelier implicite).
    const plugin = availableStructures().find((k) => k.kind === "wood-central")!;
    const defaults = plugin.paramsSchema.parse({});
    for (const f of deriveParamFields(defaults, plugin.paramsSchema)) {
      expect(hasStructureParamEntry("wood-central", f.path), f.path.join(".")).toBe(true);
    }
  });

  it("A31 : fixation de la marche en Conception, perçage en Atelier, ◆", () => {
    for (const kind of ["steel-flat", "steel-curved", "steel-central"]) {
      expect(structureParamEntry(kind, ["supports", "treadFixing"])).toMatchObject({
        tier: "design",
        toValidate: true,
      });
      expect(structureParamEntry(kind, ["supports", "treadHoleDiameter"])).toMatchObject({
        tier: "workshop",
        toValidate: true,
      });
    }
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
    // La visserie (QUESTIONS A27) dépend des assemblages du modèle : absente sans modèle.
    expect(keysOf(saved)).toEqual(keysOf(p, m).filter((k) => !k.startsWith("workshop.fasteners.")));
  });

  it("visserie : réglages ◆ des assemblages du modèle seulement, section Structure (A27)", () => {
    const p = withStructure(base, "steel-flat");
    const m = buildModel(p);
    const none: Model = { ...m, fasteners: [] };
    expect(keysOf(p, none).filter((k) => k.startsWith("workshop."))).toEqual([]);
    const withFasteners: Model = {
      ...m,
      fasteners: [
        {
          id: "f",
          mark: "VS1",
          kind: "bolt",
          grade: "8.8",
          diameter: 12,
          length: 100,
          quantity: 4,
          joint: "plateBolted",
          name: fastenerKindLabel("bolt"),
          origin: msg("fastener.joint.plateBolted"),
          partIds: [m.parts[0]!.id],
          deduced: ["diameter", "quantity"],
        },
      ],
    };
    const items = toValidateItems(p, withFasteners).filter((i) =>
      i.key.startsWith("workshop.fasteners."),
    );
    expect(items.map((i) => i.key)).toEqual([
      "workshop.fasteners.holeClearance",
      "workshop.fasteners.nominalDiameters",
      "workshop.fasteners.joints.plateBolted.kind",
      "workshop.fasteners.joints.plateBolted.grade",
      "workshop.fasteners.joints.plateBolted.length",
      "workshop.fasteners.joints.plateBolted.perPoint",
    ]);
    expect(items.every((i) => i.section === "structure" && i.steps.length === 0)).toBe(true);
    for (const i of items) expect(isToValidate(i.key), i.key).toBe(true);
    expect(tierEntry("workshop.fasteners.joints.plateBolted.length")).toMatchObject({
      tier: "workshop",
      section: "structure",
      toValidate: true,
    });
    // Étape 7 du guidé : comptées comme les autres réglages d'atelier.
    expect(toValidateCountByStep(p, withFasteners)[7]).toBe(
      toValidateCountByStep(p, none)[7] + items.length,
    );
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

  it("paramètres conditionnels du limon central et de la fixation des marches (A31)", () => {
    const p = createProject("straight");
    const applies = (params: unknown, path: string) =>
      structureParamApplies(p, params, path.split("."));
    // Fixation de la marche : marches en tôle pliée seulement ; perçage si vissée.
    const wood = { treadKind: "wood", supports: { treadFixing: "screwed" } };
    const screwed = { treadKind: "folded-steel", supports: { treadFixing: "screwed" } };
    const welded = { treadKind: "folded-steel", supports: { treadFixing: "welded" } };
    expect(applies(wood, "supports.treadFixing")).toBe(false);
    expect(applies(wood, "supports.treadHoleDiameter")).toBe(false);
    expect(applies(screwed, "supports.treadFixing")).toBe(true);
    expect(applies(screwed, "supports.treadHoleDiameter")).toBe(true);
    expect(applies(welded, "supports.treadFixing")).toBe(true);
    expect(applies(welded, "supports.treadHoleDiameter")).toBe(false);
    // Section : paroi d'un tube, tôles d'un caisson, évents d'un galvanisé.
    const tube = { finish: "painted", section: { kind: "tube" } };
    const box = { finish: "galvanized", section: { kind: "box" } };
    expect(applies(tube, "section.wallThickness")).toBe(true);
    expect(applies(tube, "section.webThickness")).toBe(false);
    expect(applies(tube, "section.diaphragmSpacing")).toBe(false);
    expect(applies(tube, "section.ventDiameter")).toBe(false);
    expect(applies(box, "section.wallThickness")).toBe(false);
    expect(applies(box, "section.flangeThickness")).toBe(true);
    expect(applies(box, "section.ventDiameter")).toBe(true);
    expect(applies(tube, "section.height")).toBe(true);
    // Section du catalogue d'un profilé (chemin d'un seul segment) : toujours.
    expect(applies({ section: "auto" }, "section")).toBe(true);
    // Supports : console ou support plié.
    const bracket = { supports: { kind: "console" } };
    const folded = { supports: { kind: "folded-z" } };
    expect(applies(bracket, "supports.consoleThickness")).toBe(true);
    expect(applies(bracket, "supports.foldedThickness")).toBe(false);
    expect(applies(folded, "supports.foldedThickness")).toBe(true);
    expect(applies(folded, "supports.tipHeight")).toBe(false);
    expect(applies(folded, "supports.bearingThickness")).toBe(false);
    expect(applies(folded, "supports.bearingWidth")).toBe(true);
  });

  it("paramètres conditionnels du limon central bois : lamelles, plis minces, sabots", () => {
    const straight = createProject("straight");
    const quarter = createProject("quarter-left");
    const helical = createProject("helical");
    const at = (p: Project, params: unknown, path: string) =>
      structureParamApplies(p, params, path.split("."));
    const glulam = { section: { kind: "glulam" }, anchors: { foot: true, head: true } };
    const solid = { section: { kind: "solid" }, anchors: { foot: true, head: false } };
    // Lamelles : lamellé-collé seulement.
    expect(at(straight, glulam, "section.lamellaThickness")).toBe(true);
    expect(at(straight, solid, "section.lamellaThickness")).toBe(false);
    expect(at(straight, solid, "section.width")).toBe(true);
    // Plis minces et leur justification : lamelles cintrées (tournant, hélicoïdal).
    expect(at(straight, glulam, "section.thinPlyMax")).toBe(false);
    expect(at(straight, glulam, "laminationJustification")).toBe(false);
    for (const p of [quarter, helical]) {
      expect(at(p, glulam, "section.thinPlyMax")).toBe(true);
      expect(at(p, glulam, "laminationJustification")).toBe(true);
      expect(at(p, solid, "section.thinPlyMax")).toBe(false);
    }
    // Sabots : présence toujours ; réglages s'il y a au moins un sabot.
    const none = { anchors: { foot: false, head: false } };
    for (const leaf of ["foot", "head"]) expect(at(straight, none, `anchors.${leaf}`)).toBe(true);
    for (const leaf of ["thickness", "grade", "anchors", "boltHoleDiameter"]) {
      expect(at(straight, none, `anchors.${leaf}`), leaf).toBe(false);
      expect(at(straight, solid, `anchors.${leaf}`), leaf).toBe(true);
    }
    // Justification du porte-à-faux : toujours.
    expect(at(straight, glulam, "cantileverJustification")).toBe(true);
  });

  it("limon central bois, suites du 2026-10-09 : filière (A33 e) et ancrage retenus (A34 c)", () => {
    const plugin = availableStructures().find((k) => k.kind === "wood-central")!;
    const params = (input: Record<string, unknown> = {}) => plugin.paramsSchema.parse(input);
    const straight = createProject("straight");
    const quarter = createProject("quarter-left");
    const helical = createProject("helical");
    const at = (p: Project, v: unknown, path: string) =>
      structureParamApplies(p, v, path.split("."));
    // Défauts (b = 88 > 60 mm) : couches empilées sur une trace courbe.
    const auto = params();
    const mould = params({ section: { curvedMethod: "mould" } });
    const narrow = params({ section: { width: 50 } });
    const solid = params({ section: { kind: "solid" } });
    // Filière et seuil du moule : trace courbe en lamellé-collé seulement.
    for (const leaf of ["curvedMethod", "mouldMaxWidth"]) {
      expect(at(straight, auto, `section.${leaf}`), leaf).toBe(false);
      expect(at(quarter, auto, `section.${leaf}`), leaf).toBe(true);
      expect(at(helical, auto, `section.${leaf}`), leaf).toBe(true);
      expect(at(quarter, solid, `section.${leaf}`), leaf).toBe(false);
    }
    // Couches empilées : couches et surcote ; ni lamelles, ni plis minces, ni justification.
    for (const p of [quarter, helical]) {
      expect(at(p, auto, "section.layerThickness")).toBe(true);
      expect(at(p, auto, "section.dressingAllowance")).toBe(true);
      expect(at(p, auto, "section.lamellaThickness")).toBe(false);
      expect(at(p, auto, "section.thinPlyMax")).toBe(false);
      expect(at(p, auto, "laminationJustification")).toBe(false);
    }
    // Moule (imposé, ou automatique sous le seuil de largeur) : lamelles et plis minces.
    for (const v of [mould, narrow]) {
      expect(at(quarter, v, "section.layerThickness")).toBe(false);
      expect(at(quarter, v, "section.dressingAllowance")).toBe(false);
      expect(at(quarter, v, "section.lamellaThickness")).toBe(true);
      expect(at(quarter, v, "section.thinPlyMax")).toBe(true);
      expect(at(quarter, v, "laminationJustification")).toBe(true);
    }
    // Escalier droit : lamelles droites, aucune couche empilée.
    expect(at(straight, auto, "section.lamellaThickness")).toBe(true);
    expect(at(straight, auto, "section.layerThickness")).toBe(false);
    // Ancrage : sabot sur une poutre droite, platine à âme noyée sur une poutre cintrée.
    const shoeLeaves = ["thickness", "cheekDepth", "bolts", "boltHoleDiameter"];
    const plateLeaves = ["plate.thickness", "plate.width", "plate.pins", "plate.pinDiameter"];
    const common = ["kind", "grade", "finish", "length", "anchors", "holeEdgeDistance"];
    for (const leaf of shoeLeaves) {
      expect(at(straight, auto, `anchors.${leaf}`), leaf).toBe(true);
      expect(at(helical, auto, `anchors.${leaf}`), leaf).toBe(false);
    }
    for (const leaf of plateLeaves) {
      expect(at(straight, auto, `anchors.${leaf}`), leaf).toBe(false);
      expect(at(helical, auto, `anchors.${leaf}`), leaf).toBe(true);
      expect(at(quarter, auto, `anchors.${leaf}`), leaf).toBe(true);
    }
    for (const leaf of common) {
      expect(at(straight, auto, `anchors.${leaf}`), leaf).toBe(true);
      expect(at(helical, auto, `anchors.${leaf}`), leaf).toBe(true);
    }
    // Choix imposé : le sabot sur une poutre cintrée, la platine sur une poutre droite.
    const shoe = params({ anchors: { kind: "shoe" } });
    const plate = params({ anchors: { kind: "embeddedPlate" } });
    expect(at(helical, shoe, "anchors.cheekDepth")).toBe(true);
    expect(at(helical, shoe, "anchors.plate.webDepth")).toBe(false);
    expect(at(straight, plate, "anchors.plate.webDepth")).toBe(true);
    expect(at(straight, plate, "anchors.cheekDepth")).toBe(false);
    // Sans ancrage : aucun réglage hors présence.
    const none = params({ anchors: { foot: false, head: false } });
    expect(at(helical, none, "anchors.kind")).toBe(false);
    expect(at(helical, none, "anchors.plate.pins")).toBe(false);
    expect(at(helical, none, "anchors.foot")).toBe(true);
    // Tire-fonds : toujours (marches basses possibles sur tout tracé).
    expect(at(straight, auto, "lagScrews.minAnchorage")).toBe(true);
  });

  it("caisson du limon central métal : borne basse de l'entraxe des entretoises (A32 a)", () => {
    const p = createProject("straight");
    const at = (v: unknown) => structureParamApplies(p, v, ["section", "diaphragmMinSpacing"]);
    expect(at({ section: { kind: "box" } })).toBe(true);
    expect(at({ section: { kind: "tube" } })).toBe(false);
    expect(structureParamEntry("steel-central", ["section", "diaphragmMinSpacing"])).toMatchObject({
      tier: "workshop",
      toValidate: true,
    });
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
