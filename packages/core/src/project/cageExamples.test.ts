/**
 * Exemples de cage saisie (tracé libre, ADR-0010, sous-lot 2f) : `examples/cage-*.blondel.json`,
 * sans structure (seule « aucune » acceptait une cage saisie au lot 2). Une fonction de cage par
 * exemple : jonction à 60° balancée, palier droit, trapèze (largeur variable), axe en arc, marches
 * rayonnantes. Sous-lot 6a : `cage-60-palier-limon`, limons à la française (`wood-housed`) sur
 * une jonction à 60° balancée à jour en pan coupé suivie d'un palier droit. Sous-lot 6b :
 * `cage-45-palier-acier`, limons acier en plat (`steel-flat`) sur une jonction à 45° balancée à
 * jour en pan coupé suivie d'un palier droit. Sous-lot 6c : `cage-60-palier-central`, limon
 * central acier (`steel-central`, caisson débillardé) sur une jonction à 60° balancée à jour en
 * pan coupé, un palier droit et une dernière volée élargie de 900 à 1 100 mm. Sous-lot 6d :
 * `cage-arc-palier-cintre`, limon débillardé acier (`steel-curved`) sur un tronçon droit, un
 * palier droit et un tronçon à axe en arc de 60° (limons cintrés des deux côtés). Site des préréglages (H = 2 700, dalle de 200 mm, nez `PRESET_NOSING`), trémie du
 * calcul des préréglages (`defaultOpening`, échappée `PRESET_HEADROOM_MIN` sur la ligne de
 * foulée). Longueurs choisies pour un giron voisin de 270 mm et aucune violation bloquante.
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/cageExamples.test.ts`.
 * Les exports de bout en bout de ces exemples sont vérifiés par
 * `packages/exports/src/examples.test.ts`, leurs cotes par `pipeline/build.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cageFeatures, type CageFeature } from "../model/cageFeatures.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { defaultOpening } from "./defaultOpening.js";
import { parseProjectText } from "./parse.js";
import { PRESET_NOSING } from "./presets.js";
import { serializeProject } from "./serialize.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

/**
 * Projet de cage (sans structure par défaut), avec la trémie calculée comme pour les
 * préréglages.
 */
function cageExample(name: string, layout: CageLayoutSpecInput, structure?: string): Project {
  const base = ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      treads: { nosing: PRESET_NOSING },
      ...(structure !== undefined ? { structure: { kind: structure } } : {}),
    },
  });
  const opening = defaultOpening(base);
  return opening ? ProjectSchema.parse({ ...base, site: { ...base.site, opening } }) : base;
}

interface CageExample {
  readonly build: () => Project;
  /** Fonctions de cage attendues (`cageFeatures`). */
  readonly features: readonly CageFeature[];
  /** Structure de l'exemple ; absente : « aucune ». */
  readonly structure?: string;
}

export const CAGE_EXAMPLES: Readonly<Record<string, CageExample>> = {
  "cage-60.blondel.json": {
    features: ["anyAngle"],
    build: () =>
      cageExample("Tracé libre — jonction à 60° balancée", {
        kind: "cage",
        sections: [straight(1650), straight(1650)],
        junctions: [{ angle: 60, mode: "winders" }],
      }),
  },
  "cage-palier-droit.blondel.json": {
    features: ["straightLanding"],
    build: () =>
      // 7 girons de 270 mm, palier droit de 1 000 mm, 6 girons de 270 mm.
      cageExample("Tracé libre — palier droit intermédiaire", {
        kind: "cage",
        sections: [straight(1890), straight(1620)],
        junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
      }),
  },
  "cage-trapeze.blondel.json": {
    features: ["variableWidth"],
    build: () =>
      cageExample("Tracé libre — volée en trapèze élargie à 1 200 mm, quart tournant", {
        kind: "cage",
        sections: [straight(1450, 900, 1200), straight(1400, 1200)],
        junctions: [{ angle: 90, mode: "winders" }],
      }),
  },
  "cage-arc.blondel.json": {
    features: ["arcAxis"],
    build: () =>
      cageExample("Tracé libre — volée courbe, axe en arc de 100°", {
        kind: "cage",
        sections: [{ axis: { kind: "arc", radius: 2150, sweep: 100 }, width: 900 }],
        junctions: [],
      }),
  },
  "cage-rayonnant.blondel.json": {
    features: ["anyAngle", "radiating"],
    build: () =>
      cageExample("Tracé libre — marches rayonnantes à 75°, jour en arc", {
        kind: "cage",
        sections: [straight(1640), straight(1640)],
        junctions: [{ angle: 75, mode: "radiating", well: { kind: "arc", radius: 400 } }],
      }),
  },
  "cage-60-palier-limon.blondel.json": {
    features: ["anyAngle", "straightLanding", "chamfer"],
    structure: "wood-housed",
    build: () =>
      // Limons à la française (sous-lot 6a) : jour en pan coupé (pas de poteau sur une cage
      // saisie), assemblages à queues aux angles, raccord des limons au milieu du palier droit.
      cageExample(
        "Tracé libre — limons à la française, jonction à 60° balancée et palier droit",
        {
          kind: "cage",
          sections: [straight(1100), straight(500), straight(1300)],
          junctions: [
            {
              angle: 60,
              mode: "winders",
              well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 },
            },
            { angle: 0, mode: "landing", depth: 900 },
          ],
        },
        "wood-housed",
      ),
  },
  "cage-45-palier-acier.blondel.json": {
    features: ["anyAngle", "straightLanding", "chamfer"],
    structure: "steel-flat",
    build: () =>
      // Limons acier en plat (sous-lot 6b) : jour en pan coupé de 250 mm (pas de poteau sur une
      // cage saisie ; à 150 mm, les marches balancées du jour n'ont plus 50 mm d'appui), coupes
      // d'équerre aux angles (F17), aboutage soudé des limons au milieu du palier droit.
      cageExample(
        "Tracé libre — limons acier en plat, jonction à 45° balancée et palier droit",
        {
          kind: "cage",
          sections: [straight(1200), straight(500), straight(1300)],
          junctions: [
            {
              angle: 45,
              mode: "winders",
              well: { kind: "chamfer", setbackIn: 250, setbackOut: 250 },
            },
            { angle: 0, mode: "landing", depth: 900 },
          ],
        },
        "steel-flat",
      ),
  },
  "cage-60-palier-central.blondel.json": {
    features: ["anyAngle", "variableWidth", "straightLanding", "chamfer"],
    structure: "steel-central",
    build: () =>
      // Limon central acier (sous-lot 6c) : trace autour des extrémités du pan coupé à la
      // demi-largeur, droite à travers le palier droit, puis vers le milieu de la ligne
      // d'arrivée de la volée élargie (convention à valider, F18) ; caisson débillardé par
      // défaut sur une trace courbe.
      cageExample(
        "Tracé libre — limon central acier, jonction à 60° balancée, palier droit, volée élargie",
        {
          kind: "cage",
          sections: [straight(1100), straight(500), straight(1300, 900, 1100)],
          junctions: [
            {
              angle: 60,
              mode: "winders",
              well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 },
            },
            { angle: 0, mode: "landing", depth: 900 },
          ],
        },
        "steel-central",
      ),
  },
  "cage-arc-palier-cintre.blondel.json": {
    features: ["arcAxis", "straightLanding"],
    structure: "steel-curved",
    build: () =>
      // Limons cintrés acier (sous-lot 6d) : un limon débillardé de chaque côté (C_i et C_e),
      // continu du départ à l'arrivée à travers la partie droite, le palier droit et l'arc
      // (raccords tangents, coupes aux naissances décalées dans la partie droite ; à valider,
      // F19).
      cageExample(
        "Tracé libre — limons cintrés acier, volée droite, palier droit et volée courbe à 60°",
        {
          kind: "cage",
          sections: [
            straight(1620),
            { axis: { kind: "arc", radius: 1800, sweep: 60 }, width: 900 },
          ],
          junctions: [{ angle: 0, mode: "landing", depth: 900 }],
        },
        "steel-curved",
      ),
  },
};

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const [file, { build }] of Object.entries(CAGE_EXAMPLES)) {
    writeFileSync(join(EXAMPLES_DIR, file), serializeProject(build()));
  }
}

describe("examples/cage-*", () => {
  it.each(Object.keys(CAGE_EXAMPLES))("%s est à jour avec son générateur", (file) => {
    const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    expect(text).toBe(serializeProject(CAGE_EXAMPLES[file]!.build()));
  });

  it.each(Object.entries(CAGE_EXAMPLES))(
    "%s : cage saisie, fonctions attendues, structure, trémie, modèle sans erreur ni violation bloquante",
    (file, { features, structure }) => {
      const p = parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
      expect(p.stair.layout.kind).toBe("cage");
      if (p.stair.layout.kind !== "cage") return;
      expect(cageFeatures(p.stair.layout)).toEqual(features);
      expect(p.stair.structure.kind).toBe(structure ?? "none");
      expect(p.site.opening).toBeDefined();
      const m = buildModel(p, { memo: false });
      expect(m.errors).toEqual([]);
      expect(m.compliance.summary.bloquant).toBe(0);
      expect(m.stepping.going).toBeGreaterThan(255);
      expect(m.stepping.going).toBeLessThan(285);
    },
  );
});

describe("examples/cage-60-palier-limon : limons à la française sur une cage", () => {
  it("limons de jour et muraux, pan coupé, raccords au milieu du palier, aucune violation", () => {
    const p = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, "cage-60-palier-limon.blondel.json"), "utf8"),
    );
    const m = buildModel(p, { memo: false });
    const stringers = m.parts.filter((x) => x.category === "stringer").map((x) => x.mark);
    expect(stringers).toEqual(["LI1", "LE1", "LIC1", "LI2", "LE2", "LI3", "LE3"]);
    expect(
      m.compliance.results.filter((r) => r.status === "violation").map((r) => r.ruleId),
    ).toEqual(["ECHAPPEE_RECO_PRIVATIF"]);
  });
});

describe("examples/cage-45-palier-acier : limons acier en plat sur une cage", () => {
  it("limons de jour et muraux, pan coupé, aboutages au milieu du palier, aucune violation", () => {
    const p = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, "cage-45-palier-acier.blondel.json"), "utf8"),
    );
    const m = buildModel(p, { memo: false });
    const stringers = m.parts.filter((x) => x.category === "stringer").map((x) => x.mark);
    expect(stringers).toEqual(["LI1", "LE1", "LIC1", "LI2", "LE2", "LI3", "LE3"]);
    expect(
      m.compliance.results.filter((r) => r.status === "violation").map((r) => r.ruleId),
    ).toEqual(["ECHAPPEE_RECO_PRIVATIF"]);
    // Aboutage soudé bout à bout au milieu du palier droit : EXC2 (C §2.1).
    expect(m.executionClass).toBe("EXC2");
    // Platines de pied sous les limons de départ, de tête sur les limons d'arrivée.
    const plates = m.parts.filter((x) => x.id.startsWith("plate-")).map((x) => x.id);
    expect(plates).toEqual(
      expect.arrayContaining([
        "plate-foot-stringer-inner-1",
        "plate-foot-stringer-outer-1",
        "plate-head-stringer-inner-3",
        "plate-head-stringer-outer-3",
      ]),
    );
  });
});

describe("examples/cage-60-palier-central : limon central acier sur une cage", () => {
  it("caisson débillardé, chaque marche sur son support, aucune violation propre à la cage", () => {
    const p = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, "cage-60-palier-central.blondel.json"), "utf8"),
    );
    const m = buildModel(p, { memo: false });
    expect(m.errors).toEqual([]);
    // Poutre en caisson (pas de tube sur une trace courbe) : tronçons de la poutre.
    const beam = m.parts.filter((x) => x.category === "stringer");
    expect(beam.length).toBeGreaterThan(0);
    // Un support au moins par marche (palier compris).
    const supported = new Set(
      m.parts.filter((x) => x.category === "support").flatMap((x) => x.assembledWith ?? []),
    );
    for (const t of m.parts.filter((x) => x.category === "tread" || x.category === "landing")) {
      expect(supported.has(t.id), t.mark).toBe(true);
    }
    // Remarque de la convention de l'axe à largeur variable (F18).
    expect((m.notes ?? []).map((n) => n.key)).toContain("structure.steelCentral.note.cageAxis");
    expect(
      m.compliance.results.filter((r) => r.status === "violation").map((r) => r.ruleId),
    ).toEqual(["ECHAPPEE_RECO_PRIVATIF", "LIMON_CENTRAL_PORTE_A_FAUX"]);
  });
});

describe("examples/cage-arc-palier-cintre : limons cintrés acier sur une cage à axe en arc", () => {
  it("limons débillardés des deux côtés, chaque marche portée, aucune violation propre à la cage", () => {
    const p = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, "cage-arc-palier-cintre.blondel.json"), "utf8"),
    );
    const m = buildModel(p, { memo: false });
    expect(m.errors).toEqual([]);
    const stringers = m.parts.filter((x) => x.category === "stringer").map((x) => x.mark);
    // Tronçons du limon de jour (LD) puis du limon mural cintré (LDM), joints aux naissances.
    expect(stringers.filter((x) => /^LD\d/.test(x)).length).toBeGreaterThan(1);
    expect(stringers.filter((x) => /^LDM\d/.test(x)).length).toBeGreaterThan(1);
    expect(stringers.every((x) => /^LDM?\d+$/.test(x))).toBe(true);
    // Chaque marche (palier compris) portée des deux côtés ; soudures bout à bout : EXC2.
    const carried = m.compliance.results.filter((r) => r.ruleId === "FAB_MARCHE_PORTEE");
    expect(carried.length).toBe(m.stepping.treads.length);
    expect(carried.every((r) => r.status === "ok")).toBe(true);
    expect(m.executionClass).toBe("EXC2");
    // Platines de pied et de tête sous chaque limon.
    const plates = m.parts.filter((x) => x.id.startsWith("plate-")).map((x) => x.id);
    expect(plates).toEqual(
      expect.arrayContaining([
        "plate-foot-stringer-inner-curved-1",
        "plate-foot-stringer-outer-curved-1",
      ]),
    );
    expect(
      m.compliance.results.filter((r) => r.status === "violation").map((r) => r.ruleId),
    ).toEqual(["ECHAPPEE_RECO_PRIVATIF"]);
  });
});
