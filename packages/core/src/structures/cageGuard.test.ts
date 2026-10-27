/**
 * Garde-fou des structures pour une cage saisie (tracé libre, ADR-0010, plan C.8, sous-lot 2f) :
 * `capabilities.cage` et `structureAcceptsCage` ; dans `buildModel`, chaque plugin du registre
 * (crémaillères, acier plat, profilés, débillardé, limons centraux bois et acier, qui lisent le
 * tracé par `centralTrace.ts`) est sauté sur une cage avec une erreur lisible qui nomme les
 * fonctions non prises en charge, sans exception, marches produites ; un plugin qui déclare les
 * fonctions de la cage est appelé ; un tracé à volées n'est pas concerné. Depuis le sous-lot 6a,
 * les limons à la française (`wood-housed`) déclarent `WOOD_HOUSED_CAGE` : ils construisent une
 * cage qui n'utilise que ces fonctions et refusent les autres en ne nommant que celles-là. Depuis
 * le sous-lot 6b, les limons acier en plat (`steel-flat`) déclarent les mêmes fonctions, les
 * profilés (`steel-profile`) les mêmes sauf le palier droit, les crémaillères (`wood-cut`) la seule largeur variable (un
 * tronçon droit : un tournant reste refusé par le plugin, comme en volées). Depuis le sous-lot
 * 6c, les limons centraux bois et acier (`wood-central`, `steel-central`) déclarent
 * `CENTRAL_CAGE` : toutes les fonctions sauf l'axe en arc (lot « acier cintré »). Depuis le
 * sous-lot 6d, le limon débillardé acier (`steel-curved`) déclare `STEEL_CURVED_CAGE` : axe en
 * arc (limons cintrés des deux côtés) et palier droit ; l'hélicoïdal à fût (`helical-core`,
 * tracé hélicoïdal seulement) reste le seul plugin qui ne lit aucune cage saisie.
 */
import fc from "fast-check";
import { msg, translatorFor, type Message } from "@blondel/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CAGE_FEATURE_LABELS,
  CAGE_FEATURES,
  cageFeatures,
  type CageFeature,
} from "../model/cageFeatures.js";
import type { Model } from "../model/derived.js";
import type { StructureKind } from "../model/plugins.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { createProject } from "../project/presets.js";
import { applyStructureChoice } from "../project/structureChoice.js";
import { isDebillardeStructure } from "../stepping/stepping.js";
import {
  listStructures,
  registerStructure,
  structureAcceptsCage,
  structureCageFeatures,
  structureRequiresNewel,
  structureUnsupportedCageFeatures,
  unregisterStructure,
  WOOD_HOUSED,
} from "./index.js";

const FR = translatorFor("fr");
const EN = translatorFor("en");

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

/** Cages représentatives : une par fonction, plus une cage sans fonction (quart tournant). */
const CAGES: Record<string, CageLayoutSpecInput> = {
  "quart tournant (sans fonction)": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: 90, mode: "winders" }],
  },
  "60° balancé": {
    kind: "cage",
    sections: [straight(1650), straight(1650)],
    junctions: [{ angle: 60, mode: "winders" }],
  },
  "palier droit": {
    kind: "cage",
    sections: [straight(1890), straight(1620)],
    junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
  },
  trapèze: {
    kind: "cage",
    sections: [straight(1450, 900, 1200), straight(1400, 1200)],
    junctions: [{ angle: 90, mode: "winders" }],
  },
  "axe en arc": {
    kind: "cage",
    sections: [{ axis: { kind: "arc", radius: 2150, sweep: 100 }, width: 900 }],
    junctions: [],
  },
  "rayonnant à 75°": {
    kind: "cage",
    sections: [straight(1640), straight(1640)],
    junctions: [{ angle: 75, mode: "radiating", well: { kind: "arc", radius: 400 } }],
  },
  "congé côté mur à −120°": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [{ angle: -120, mode: "winders", wall: { kind: "arc", radius: 300 } }],
  },
  "pan coupé à 120°": {
    kind: "cage",
    sections: [straight(1500), straight(1500)],
    junctions: [
      { angle: 120, mode: "winders", well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 } },
    ],
  },
  "S (sens opposés)": {
    kind: "cage",
    sections: [straight(1200), straight(1500), straight(1200)],
    junctions: [
      { angle: 90, mode: "landing" },
      { angle: -90, mode: "landing" },
    ],
  },
};

function cageProject(layout: CageLayoutSpecInput, structure = "none"): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      structure: { kind: structure },
    },
  });
}

const keys = (m: Model): string[] => m.errors.map((e) => e.key);
const featuresOf = (p: Project): ReturnType<typeof cageFeatures> =>
  cageFeatures(p.stair.layout as CageLayoutSpec);

/** Erreur du garde-fou dans le modèle (une seule attendue). */
function refusal(m: Model): Message {
  const found = m.errors.filter((e) => e.key === "structure.cageUnsupported");
  expect(found).toHaveLength(1);
  return found[0]!;
}

const STRUCTURES = listStructures().map((s) => s.kind);
/** Fonctions de cage des limons à la française (sous-lot 6a). */
const WOOD_HOUSED_CAGE: readonly CageFeature[] = [
  "anyAngle",
  "variableWidth",
  "straightLanding",
  "chamfer",
];
/** Fonctions de cage des limons acier en plat (sous-lot 6b) : celles des limons à la française. */
const STEEL_CAGE: readonly CageFeature[] = WOOD_HOUSED_CAGE;
/** Fonctions de cage des limons en profilés (sous-lot 6b) : sans le palier droit (F17 (3)). */
const STEEL_PROFILE_CAGE: readonly CageFeature[] = ["anyAngle", "variableWidth", "chamfer"];
/** Fonctions de cage des crémaillères (sous-lot 6b) : un tronçon droit, largeur variable. */
const WOOD_CUT_CAGE: readonly CageFeature[] = ["variableWidth"];
/** Fonctions de cage des limons centraux bois et acier (sous-lot 6c) : toutes sauf l'axe en arc. */
const CENTRAL_CAGE: readonly CageFeature[] = [
  "anyAngle",
  "variableWidth",
  "straightLanding",
  "wallArc",
  "chamfer",
  "radiating",
  "oppositeTurns",
];
/** Fonctions de cage du limon débillardé acier (sous-lot 6d) : axe en arc, palier droit. */
const STEEL_CURVED_CAGE: readonly CageFeature[] = ["arcAxis", "straightLanding"];
/** Structures qui lisent une cage saisie, et les fonctions qu'elles déclarent. */
const CAGE_STRUCTURES: Readonly<Record<string, readonly CageFeature[]>> = {
  "wood-housed": WOOD_HOUSED_CAGE,
  "steel-flat": STEEL_CAGE,
  "steel-profile": STEEL_PROFILE_CAGE,
  "wood-cut": WOOD_CUT_CAGE,
  "wood-central": CENTRAL_CAGE,
  "steel-central": CENTRAL_CAGE,
  "steel-curved": STEEL_CURVED_CAGE,
};
/** Catégorie des pièces de structure attendues sur une cage construite. */
const STRUCTURE_CATEGORY: Readonly<Record<string, string>> = {
  "wood-cut": "carriage",
  "wood-central": "carriage",
};
/** Structures qui ne lisent encore aucune cage saisie. */
const FLIGHTS_ONLY = STRUCTURES.filter((k) => !(k in CAGE_STRUCTURES));

/**
 * Raison attendue du refus de `kind` pour une cage de fonctions `features` (même jonction que
 * `build.ts`) : plugin sans `capabilities.cage`, toutes les fonctions (ou « lit encore un tracé à
 * volées ») ; sinon les seules fonctions non déclarées ; `null` si la cage est construite.
 * `params` : paramètres de la structure du projet (fonctions selon les paramètres, K2f).
 */
function expectedRefusal(
  kind: string,
  features: readonly CageFeature[],
  params?: unknown,
): Message | null {
  const missing = structureUnsupportedCageFeatures(kind, features, params);
  if (missing !== null && missing.length === 0) return null;
  return expectedReason(missing ?? features);
}

/** Raison attendue du refus d'un plugin qui ne déclare rien (même jonction que `build.ts`). */
function expectedReason(features: readonly CageFeature[]): Message {
  if (features.length === 0) return msg("structure.cageUnsupported.plain");
  const list = features
    .map((f) => msg(CAGE_FEATURE_LABELS[f]))
    .reduceRight<Message | null>(
      (rest, first) => (rest === null ? first : msg("common.list", { first, rest })),
      null,
    )!;
  return msg("structure.cageUnsupported.features", { features: list });
}

describe("capacités : structureCageFeatures / structureAcceptsCage", () => {
  it("le registre compte les plugins intégrés, limons centraux bois et acier compris", () => {
    expect(STRUCTURES).toEqual(
      expect.arrayContaining([
        "wood-housed",
        "wood-cut",
        "steel-flat",
        "steel-profile",
        "steel-curved",
        "steel-central",
        "wood-central",
      ]),
    );
  });

  it("« aucune » accepte toutes les fonctions", () => {
    expect(structureCageFeatures("none")).toEqual(CAGE_FEATURES);
    expect(structureAcceptsCage("none", [])).toBe(true);
    expect(structureAcceptsCage("none", CAGE_FEATURES)).toBe(true);
    expect(structureUnsupportedCageFeatures("none", CAGE_FEATURES)).toEqual([]);
  });

  it("seul l'hélicoïdal à fût ne lit aucune cage saisie (sous-lot 6d)", () => {
    expect(FLIGHTS_ONLY).toEqual(["helical-core"]);
  });

  it.each(FLIGHTS_ONLY)("%s : aucune cage saisie, même sans fonction", (kind) => {
    expect(structureCageFeatures(kind)).toBeNull();
    expect(structureAcceptsCage(kind, [])).toBe(false);
    expect(structureAcceptsCage(kind, ["anyAngle"])).toBe(false);
    expect(structureUnsupportedCageFeatures(kind, ["anyAngle"])).toBeNull();
  });

  it.each(Object.entries(CAGE_STRUCTURES))(
    "%s : fonctions déclarées (sous-lots 6a à 6d), les autres refusées une à une",
    (kind, declared) => {
      expect(structureCageFeatures(kind)).toEqual(declared);
      expect(structureAcceptsCage(kind, [])).toBe(true);
      expect(structureAcceptsCage(kind, declared)).toBe(true);
      // Axe en arc : lot « acier cintré », déclaré par le seul limon débillardé (limons cintrés).
      expect(declared.includes("arcAxis")).toBe(kind === "steel-curved");
      for (const f of CAGE_FEATURES.filter((x) => !declared.includes(x))) {
        expect(structureAcceptsCage(kind, [f]), f).toBe(false);
        expect(structureAcceptsCage(kind, [...declared, f]), f).toBe(false);
        expect(structureUnsupportedCageFeatures(kind, [...declared, f]), f).toEqual([f]);
      }
    },
  );

  it("fonctions selon les paramètres (`cageWith`, K2f) : palier droit des profilés en limon coudé seulement", () => {
    expect(structureCageFeatures("steel-profile", { stringerLine: "nosing" })).toContain(
      "straightLanding",
    );
    expect(structureCageFeatures("steel-profile", { stringerLine: "chord" })).toEqual(
      structureCageFeatures("steel-profile"),
    );
    // Paramètres vides : limon coudé par défaut (K-Q11, sous-lot K2d), palier droit accepté.
    expect(structureCageFeatures("steel-profile", {})).toContain("straightLanding");
    expect(structureCageFeatures("steel-profile", { stringerLine: "chord" })).not.toContain(
      "straightLanding",
    );
    expect(
      structureAcceptsCage("steel-profile", ["straightLanding"], { stringerLine: "nosing" }),
    ).toBe(true);
    // Sans paramètres (capacité statique) : fonctions de la barre droite.
    expect(structureAcceptsCage("steel-profile", ["straightLanding"])).toBe(false);
    expect(structureUnsupportedCageFeatures("steel-profile", ["straightLanding"], {})).toEqual([]);
    expect(
      structureUnsupportedCageFeatures("steel-profile", ["straightLanding"], {
        stringerLine: "chord",
      }),
    ).toEqual(["straightLanding"]);
    // Paramètres invalides : fonctions statiques (`capabilities.cage`), jamais d'exception.
    expect(structureCageFeatures("steel-profile", { stringerLine: "arc" })).toEqual(
      structureCageFeatures("steel-profile"),
    );
    expect(structureCageFeatures("steel-profile", { family: 3 })).toEqual(
      structureCageFeatures("steel-profile"),
    );
    // Plugins sans `cageWith` : paramètres sans effet.
    expect(structureCageFeatures("steel-flat", { stringerLine: "nosing" })).toEqual(
      structureCageFeatures("steel-flat"),
    );
  });

  it("plugin inconnu : aucune cage", () => {
    expect(structureCageFeatures("inconnu")).toBeNull();
    expect(structureAcceptsCage("inconnu", [])).toBe(false);
  });

  it("chaque fonction a un libellé traduit, distinct, en français et en anglais", () => {
    for (const t of [FR, EN]) {
      const labels = CAGE_FEATURES.map((f) => t.t(msg(CAGE_FEATURE_LABELS[f])));
      for (const l of labels) expect(l.length).toBeGreaterThan(0);
      expect(new Set(labels).size).toBe(CAGE_FEATURES.length);
    }
  });

  it("les cages du jeu couvrent toutes les fonctions et une cage sans fonction", () => {
    const seen = new Set<string>();
    let plain = 0;
    for (const s of Object.values(CAGES)) {
      const f = featuresOf(cageProject(s));
      if (f.length === 0) plain++;
      for (const x of f) seen.add(x);
    }
    expect(plain).toBeGreaterThan(0);
    expect([...seen].sort()).toEqual([...CAGE_FEATURES].sort());
  });
});

describe("buildModel : garde-fou sur chaque plugin du registre", () => {
  it.each(Object.entries(CAGES))("%s : sans structure, modèle sans erreur", (_n, s) => {
    const model = buildModel(cageProject(s), { memo: false });
    expect(keys(model)).toEqual([]);
    expect(model.stepping.treads.length).toBeGreaterThan(0);
  });

  it.each(STRUCTURES)(
    "%s : plugin sauté sur toute cage non prise en charge, erreur lisible, aucune exception, marches produites",
    (kind) => {
      for (const [name, s] of Object.entries(CAGES)) {
        const project = cageProject(s, kind);
        let model: Model | undefined;
        expect(() => (model = buildModel(project, { memo: false })), name).not.toThrow();
        const all = featuresOf(project);
        const params = project.stair.structure.params;
        if (expectedRefusal(kind, all, params) === null) {
          // Cage construite (limons à la française, limons acier, limons centraux) : jamais de
          // refus, pièces de structure ; crémaillères : escalier droit seulement (tournant
          // refusé par le plugin).
          expect(keys(model!), name).not.toContain("structure.cageUnsupported");
          expect(keys(model!), name).not.toContain("pipeline.internalError");
          const turning = (s.junctions ?? []).length > 0;
          if (kind === "wood-cut" && turning) {
            expect(keys(model!), name).toEqual(["structure.woodCut.turningUnsupported"]);
            continue;
          }
          expect(
            model!.parts.some((p) => p.category === (STRUCTURE_CATEGORY[kind] ?? "stringer")),
            name,
          ).toBe(true);
          continue;
        }
        expect(keys(model!), name).toEqual(["structure.cageUnsupported"]);
        const e = refusal(model!);
        // Fonctions nommées : toutes celles de la cage pour un plugin sans `capabilities.cage`,
        // les seules non déclarées sinon.
        const features = structureUnsupportedCageFeatures(kind, all, params) ?? all;
        const fr = FR.t(e);
        const en = EN.t(e);
        expect(fr).toContain(FR.t(msg(getLabel(kind))));
        expect(en).toContain(EN.t(msg(getLabel(kind))));
        for (const text of [fr, en]) expect(text).not.toMatch(/\{|\}|undefined/);
        // Paramètres exacts : la structure, et la raison qui nomme les fonctions de la cage,
        // toutes et seulement elles (ou « lit encore un tracé à volées » sans fonction).
        expect(e.params?.structure, name).toEqual(msg(getLabel(kind)));
        expect(e.params?.reason, name).toEqual(expectedRefusal(kind, all, params));
        for (const [t, text] of [
          [FR, fr],
          [EN, en],
        ] as const) {
          const plain = t.t(msg("structure.cageUnsupported.plain"));
          if (features.length === 0) expect(text, name).toContain(plain);
          else expect(text, name).not.toContain(plain);
          for (const f of CAGE_FEATURES) {
            const label = t.t(msg(CAGE_FEATURE_LABELS[f]));
            if (features.includes(f)) expect(text, `${name} ${f}`).toContain(label);
            else expect(text, `${name} ${f}`).not.toContain(label);
          }
        }
        // Pièces de base seules : mêmes pièces (contenu compris) et mêmes marches que sans
        // structure, sauf pour une structure débillardée : la variante M3 quintique, choisie par
        // le `kind`, change le découpage, donc la géométrie des marches (mêmes repères).
        const bare = buildModel(cageProject(s), { memo: false });
        expect(model!.stepping.treads).toHaveLength(bare.stepping.treads.length);
        if (isDebillardeStructure(kind)) {
          expect(model!.parts.map((p) => p.id)).toEqual(bare.parts.map((p) => p.id));
        } else {
          expect(model!.stepping).toStrictEqual(bare.stepping);
          expect(model!.parts).toStrictEqual(bare.parts);
        }
      }
    },
  );

  it.each(STRUCTURES)("%s : un tracé à volées n'est pas concerné par le garde-fou", (kind) => {
    const model = buildModel(
      {
        ...createProject("quarter-left"),
        stair: { ...createProject("quarter-left").stair, structure: { kind, params: {} } },
      },
      { memo: false },
    );
    expect(keys(model)).not.toContain("structure.cageUnsupported");
  });

  it("propriété : jamais d'exception ni d'erreur interne, refus exact, quelle que soit la cage", () => {
    // Tronçon : axe droit (largeur éventuellement variable) ou en arc ; jonction : angle signé,
    // mode, jour vif / arc / pan coupé, mur vif / arc (angle 0 : palier droit à raccords vifs).
    const section = fc.oneof(
      fc.record({
        kind: fc.constant("straight" as const),
        length: fc.integer({ min: 1200, max: 2600 }),
        width: fc.integer({ min: 750, max: 1100 }),
        widthEnd: fc.option(fc.integer({ min: 750, max: 1100 }), { nil: undefined }),
      }),
      fc.record({
        kind: fc.constant("arc" as const),
        radius: fc.integer({ min: 1600, max: 3200 }),
        sweep: fc.integer({ min: 30, max: 120 }).chain((a) => fc.constantFrom(a, -a)),
        width: fc.integer({ min: 750, max: 1100 }),
      }),
    );
    const junction = fc.record({
      angle: fc.integer({ min: -150, max: 150 }),
      mode: fc.constantFrom("winders" as const, "landing" as const, "radiating" as const),
      well: fc.oneof(
        fc.constant({ kind: "sharp" as const }),
        fc.record({
          kind: fc.constant("arc" as const),
          radius: fc.integer({ min: 100, max: 400 }),
        }),
        fc
          .integer({ min: 50, max: 200 })
          .map((d) => ({ kind: "chamfer" as const, setbackIn: d, setbackOut: d })),
      ),
      wall: fc.oneof(
        fc.constant({ kind: "sharp" as const }),
        fc.record({
          kind: fc.constant("arc" as const),
          radius: fc.integer({ min: 100, max: 400 }),
        }),
      ),
    });
    const arb = fc.record({
      sections: fc.array(section, { minLength: 1, maxLength: 3 }),
      junctions: fc.array(junction, { minLength: 2, maxLength: 2 }),
      structure: fc.constantFrom(...STRUCTURES),
    });
    let built = 0;
    let runs = 0;
    const seen = new Set<CageFeature>();
    fc.assert(
      fc.property(arb, (r) => {
        const sections = r.sections.map((x) =>
          x.kind === "straight"
            ? straight(x.length, x.width, x.widthEnd)
            : { axis: { kind: "arc" as const, radius: x.radius, sweep: x.sweep }, width: x.width },
        );
        const junctions = r.junctions
          .slice(0, sections.length - 1)
          .map((j) =>
            j.angle === 0
              ? { angle: 0, mode: "landing" as const }
              : { angle: j.angle, mode: j.mode, well: j.well, wall: j.wall },
          );
        const project = cageProject({ kind: "cage", sections, junctions }, r.structure);
        runs++;
        const model = buildModel(project, { memo: false });
        const k = keys(model);
        expect(k).not.toContain("pipeline.internalError");
        // Tracé ou découpage impossible : le plugin n'est jamais atteint ; sinon refus exact,
        // qui nomme les fonctions de la cage tirée, toutes et seulement elles.
        if (model.stepping.treads.length === 0) return;
        built++;
        const features = featuresOf(project);
        for (const f of features) seen.add(f);
        const expected = expectedRefusal(r.structure, features, project.stair.structure.params);
        if (expected === null) expect(k).not.toContain("structure.cageUnsupported");
        else expect(refusal(model).params?.reason).toEqual(expected);
      }),
      { numRuns: 200, seed: 42 },
    );
    // Le générateur atteint vraiment le plugin, avec toutes les fonctions.
    expect(built / runs).toBeGreaterThan(0.3);
    expect([...seen].sort()).toEqual([...CAGE_FEATURES].sort());
  });
});

function getLabel(kind: string) {
  return listStructures().find((s) => s.kind === kind)!.labelKey;
}

describe("buildModel : plugin qui déclare des fonctions de cage", () => {
  const built: string[] = [];
  const plugin = (cage: StructureKind<unknown>["capabilities"]): StructureKind<{ a: number }> => ({
    kind: "test-cage",
    labelKey: WOOD_HOUSED.labelKey,
    family: "bois",
    paramsSchema: z.object({ a: z.number().default(1) }),
    defaults: () => ({ a: 1 }),
    build: (ctx) => {
      built.push(ctx.project.stair.layout.kind ?? "flights");
      return { parts: [], checks: [], notes: [] };
    },
    ...(cage !== undefined ? { capabilities: cage } : {}),
  });

  afterEach(() => {
    unregisterStructure("test-cage");
    built.length = 0;
  });

  it("toutes les fonctions déclarées : plugin appelé, aucune erreur", () => {
    registerStructure(plugin({ cage: ["anyAngle"] }));
    expect(structureAcceptsCage("test-cage", ["anyAngle"])).toBe(true);
    const model = buildModel(cageProject(CAGES["60° balancé"]!, "test-cage"), { memo: false });
    expect(keys(model)).toEqual([]);
    expect(built).toEqual(["cage"]);
  });

  it("choix de structure : même règle que le pipeline, pas de remarque si la cage est construite", () => {
    registerStructure(plugin({ cage: ["anyAngle"] }));
    const sixty = cageProject(CAGES["60° balancé"]!);
    expect(applyStructureChoice(sixty, "test-cage").notes).toEqual([]);
    expect(keys(buildModel(cageProject(CAGES["60° balancé"]!, "test-cage")))).toEqual([]);
    // Fonction non déclarée (pan coupé) : refus du pipeline et remarque du choix de structure.
    const chamfer = cageProject(CAGES["pan coupé à 120°"]!);
    expect(keys(buildModel(cageProject(CAGES["pan coupé à 120°"]!, "test-cage")))).toEqual([
      "structure.cageUnsupported",
    ]);
    expect(applyStructureChoice(chamfer, "test-cage").notes.map((n) => n.key)).toEqual([
      "project.structureChoice.cage",
    ]);
    unregisterStructure("test-cage");
    registerStructure(plugin({ cage: [] }));
    const plain = cageProject(CAGES["quart tournant (sans fonction)"]!);
    expect(applyStructureChoice(plain, "test-cage").notes).toEqual([]);
    const plainBuilt = cageProject(CAGES["quart tournant (sans fonction)"]!, "test-cage");
    expect(keys(buildModel(plainBuilt))).toEqual([]);
  });

  it("choix de structure : chaque plugin intégré reçoit la remarque, comme le refus du pipeline", () => {
    for (const s of Object.values(CAGES)) {
      const p = cageProject(s);
      expect(applyStructureChoice(p, "none").notes).toEqual([]);
      for (const kind of STRUCTURES) {
        const notes = applyStructureChoice(p, kind).notes.map((n) => n.key);
        if (expectedRefusal(kind, featuresOf(p), p.stair.structure.params) === null) {
          // Cage construite (limons à la française, limons acier, crémaillères, limons
          // centraux) : seule remarque
          // possible, pour une structure à poteau, un jour vif ou en arc qu'aucun limon droit ne
          // suit (pas de poteau sur une cage saisie).
          const layout = p.stair.layout as CageLayoutSpec;
          const open = layout.junctions.some(
            (j) => j.angle !== 0 && (j.well.kind === "sharp" || j.well.kind === "arc"),
          );
          expect(notes.length).toBe(open && structureRequiresNewel(kind) ? 1 : 0);
          for (const n of notes) {
            expect([
              "project.structureChoice.cageJour",
              "project.structureChoice.cageJourConvertible",
            ]).toContain(n);
          }
          continue;
        }
        expect(notes).toHaveLength(1);
        expect([
          "project.structureChoice.cage",
          "project.structureChoice.cageConvertible",
        ]).toContain(notes[0]);
      }
    }
  });

  it("`cage: []` : cage sans fonction acceptée, cage à 60° refusée", () => {
    registerStructure(plugin({ cage: [] }));
    const plain = buildModel(cageProject(CAGES["quart tournant (sans fonction)"]!, "test-cage"), {
      memo: false,
    });
    expect(keys(plain)).toEqual([]);
    const sixty = buildModel(cageProject(CAGES["60° balancé"]!, "test-cage"), { memo: false });
    expect(keys(sixty)).toEqual(["structure.cageUnsupported"]);
    expect(built).toEqual(["cage"]);
  });

  it("fonctions en partie déclarées : seules les manquantes sont nommées", () => {
    registerStructure(plugin({ cage: ["variableWidth"] }));
    const layout: CageLayoutSpecInput = {
      kind: "cage",
      sections: [straight(1500, 900, 1100), straight(1500, 1100)],
      junctions: [{ angle: 60, mode: "winders" }],
    };
    expect(featuresOf(cageProject(layout))).toEqual(["anyAngle", "variableWidth"]);
    expect(structureUnsupportedCageFeatures("test-cage", ["anyAngle", "variableWidth"])).toEqual([
      "anyAngle",
    ]);
    const model = buildModel(cageProject(layout, "test-cage"), { memo: false });
    const text = FR.t(refusal(model));
    expect(text).toContain(FR.t(msg(CAGE_FEATURE_LABELS.anyAngle)));
    expect(text).not.toContain(FR.t(msg(CAGE_FEATURE_LABELS.variableWidth)));
    expect(built).toEqual([]);
  });

  it("sans `capabilities.cage` : plugin non appelé sur une cage, appelé sur des volées", () => {
    registerStructure(plugin(undefined));
    const cage = buildModel(cageProject(CAGES["quart tournant (sans fonction)"]!, "test-cage"), {
      memo: false,
    });
    expect(keys(cage)).toEqual(["structure.cageUnsupported"]);
    const base = createProject("quarter-left");
    const flights = buildModel(
      { ...base, stair: { ...base.stair, structure: { kind: "test-cage", params: {} } } },
      { memo: false },
    );
    expect(keys(flights)).toEqual([]);
    expect(built).toEqual(["flights"]);
  });
});

describe("buildModel : paramètres invalides d'un plugin à fonctions selon les paramètres (relecture K2f)", () => {
  const landingCage = (params: Record<string, unknown>): Project =>
    ProjectSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      site: { floorToFloor: 2700, upperSlabThickness: 200 },
      stair: {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout: {
          kind: "cage",
          sections: [straight(1800, 900), straight(1800, 900)],
          junctions: [{ angle: 0, mode: "landing", depth: 900 }],
        },
        structure: { kind: "steel-profile", params },
      },
    });
  const errorKeys = (m: Model): string[] => m.errors.map((e) => e.key);

  it("palier droit : erreur de paramètres rendue (et non un refus « palier droit » trompeur), sans exception", () => {
    for (const params of [
      { family: "XYZ", stringerLine: "nosing" },
      { stringerLine: "nosing", supports: { minLength: -5 } },
    ]) {
      let m!: Model;
      expect(() => (m = buildModel(landingCage(params), { memo: false }))).not.toThrow();
      const why = JSON.stringify(params);
      expect(errorKeys(m), why).toContain("pipeline.structureParamsInvalid");
      expect(errorKeys(m), why).not.toContain("structure.cageUnsupported");
      expect(m.parts.some((p) => p.category === "stringer")).toBe(false);
    }
  });

  it("paramètres valides : refus en barre droite, construit en limon coudé (inchangé ; défaut coudé depuis K2d)", () => {
    expect(
      errorKeys(buildModel(landingCage({ family: "UPN", stringerLine: "chord" }), { memo: false })),
    ).toContain("structure.cageUnsupported");
    expect(errorKeys(buildModel(landingCage({ family: "UPN" }), { memo: false }))).not.toContain(
      "structure.cageUnsupported",
    );
    const m = buildModel(landingCage({ family: "UPN", stringerLine: "nosing" }), { memo: false });
    expect(errorKeys(m)).not.toContain("structure.cageUnsupported");
    expect(errorKeys(m)).not.toContain("pipeline.structureParamsInvalid");
    expect(m.parts.some((p) => p.category === "stringer")).toBe(true);
  });
});
