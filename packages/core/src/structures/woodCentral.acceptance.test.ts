/**
 * Limon central bois (QUESTIONS A29, vague 2) — exemples générés
 * `examples/j5c-limon-central-bois-*.blondel.json`, un par géométrie de poutre : escalier droit
 * en couches collées droites, quart tournant balancé en lamellé-collé cintré sur moule,
 * hélicoïdal à jour central en lamellé-collé cintré. Marches sans contremarche (l'arrière de
 * chaque marche se loge dans la dent suivante : entaille arrière, C §1.5 [54]), de 80 mm comme
 * les démos hélicoïdales. Ils sont couverts par l'instantané des cotes (`pipeline/build.test.ts`)
 * et par tous les exports (`packages/exports/src/examples.test.ts`).
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/structures/woodCentral.acceptance.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import type { Model } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createHelicalProject } from "../project/presetHelical.js";
import { createProject, deepMerge } from "../project/presets.js";
import { serializeProject } from "../project/serialize.js";
import { fcbaTable, requiredCentralResidual } from "./fcba.js";
import { CENTRAL_RULES } from "./steelCentral.js";
import { WOOD_CENTRAL_RULES } from "./woodCentral.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

export const J5C_WOOD_STRAIGHT = "j5c-limon-central-bois-droit.blondel.json";
export const J5C_WOOD_QUARTER = "j5c-limon-central-bois-quart-tournant.blondel.json";
export const J5C_WOOD_HELICAL = "j5c-limon-central-bois-helicoidal.blondel.json";

/** Marches sans contremarche, 80 mm (vide entre marches sous la sphère de 100 mm). */
const OPEN_TREADS = { risers: "none", thickness: 80 } as const;

/** Pose la structure `wood-central` (paramètres minimaux) et des marches sans contremarche. */
function withWoodCentral(p: Project, params: Record<string, unknown>): Project {
  return deepMerge(p, {
    stair: { treads: OPEN_TREADS, structure: { kind: "wood-central", params } },
  });
}

/**
 * Escalier droit (E = 900, H = 2 600, volée de 3 400 mm) dans le domaine de l'exemple FCBA
 * (hauteur ≤ 2 700, projection ≤ 2 700 / tan 38°) : le reste sous entaille `auto` est lu dans le
 * tableau à b / 2. Crémaillère centrale en lamellé-collé de 88 mm (couches collées droites),
 * marches chêne entaillées et boulonnées, sabots de pied et de tête.
 */
export function j5cWoodStraight(): Project {
  return withWoodCentral(
    createProject("straight", {
      name: "Jalon 5c — escalier droit sur limon central bois (lamellé-collé)",
      floorToFloor: 2600,
      patch: { stair: { layout: { legs: [{ length: 3400 }] } } },
    }),
    { section: { kind: "glulam" } },
  );
}

/**
 * Quart tournant balancé du préréglage (jour vif), limon central bois en lamellé-collé cintré
 * sur moule autour du jour (lamelles verticales, épaisseur `auto` : k_r = 1).
 */
export function j5cWoodQuarter(): Project {
  return withWoodCentral(
    createProject("quarter-left", {
      name: "Jalon 5c — quart tournant balancé sur limon central bois (lamellé-collé cintré)",
    }),
    { section: { kind: "glulam" } },
  );
}

/**
 * Hélicoïdal à jour central (R_e = 1 200, jour de 350 mm, comme l'exemple du limon central
 * métal), limon central bois en lamellé-collé cintré sur moule cylindrique (C §1.6 [7] ;
 * B §4.3 [16] ne traite que de la main courante hélicoïdale) à mi-emmarchement. Reste sous entaille imposé à 260 mm (poutre plus haute que le
 * repli de 180 mm) pour que le prédimensionnement indicatif en flexion passe sur la portée
 * développée de l'hélice (choix de présentation, à valider).
 */
export function j5cWoodHelical(): Project {
  return withWoodCentral(
    createHelicalProject({
      name: "Jalon 5c — hélicoïdal à jour central sur limon central bois (lamellé-collé cintré)",
      floorToFloor: 2750,
      outerRadius: 1200,
      patch: {
        stair: { layout: { core: { kind: "well", radius: 350 } }, treads: OPEN_TREADS },
      },
    }),
    { section: { kind: "glulam", residual: 260 } },
  );
}

const GENERATORS: readonly (readonly [string, () => Project])[] = [
  [J5C_WOOD_STRAIGHT, j5cWoodStraight],
  [J5C_WOOD_QUARTER, j5cWoodQuarter],
  [J5C_WOOD_HELICAL, j5cWoodHelical],
];

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const [file, make] of GENERATORS) {
    writeFileSync(join(EXAMPLES_DIR, file), serializeProject(make()));
  }
}

const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

const results = (m: Model, id: string) => m.compliance.results.filter((r) => r.ruleId === id);
const violations = (m: Model, id: string) => results(m, id).filter((r) => r.status === "violation");

describe("exemples j5c : limon central bois", () => {
  it.each(GENERATORS)("%s : à jour avec son générateur, sérialisation stable", (file, make) => {
    const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    expect(text).toBe(serializeProject(make()));
    expect(serializeProject(parseProjectText(text))).toBe(text);
  });

  it.each(GENERATORS)(
    "%s : modèle complet, poutre LC1, sabots, k_r conforme, porte-à-faux signalé",
    (file) => {
      const m = buildModel(load(file), { memo: false });
      expect(frList(m.errors)).toEqual([]);
      expect(m.compliance.summary.bloquant).toBe(0);
      const beam = m.parts.find((p) => p.id === "wood-central-beam");
      expect(beam?.mark).toBe("LC1");
      expect(beam?.category).toBe("carriage");
      expect(m.parts.find((p) => p.id === "wood-central-shoe-foot")?.mark).toBe("SP1");
      expect(m.parts.find((p) => p.id === "wood-central-shoe-head")?.mark).toBe("ST1");
      expect(results(m, "LAMELLE_CINTRE_KR").map((r) => r.status)).toEqual(["ok"]);
      // Entaille arrière de chaque marche (sans contremarche) : au moins 14 mm.
      expect(violations(m, "LIMON_ENTAILLE_MIN")).toEqual([]);
      expect(results(m, "LIMON_ENTAILLE_MIN").length).toBeGreaterThan(0);
      const cantilever = violations(m, CENTRAL_RULES.cantilever.id);
      expect(cantilever).toHaveLength(1);
      expect(fr(cantilever[0]!.message)).toMatch(/^Justification requise/);
      expect(m.precheck?.beams).toHaveLength(1);
      for (const p of m.parts) {
        const mass = p.quantities["mass_kg"];
        expect(mass !== undefined && Number.isFinite(mass) && mass > 0, p.id).toBe(true);
      }
      // Visserie : marches boulonnées au travers de la poutre, sabots boulonnés et chevillés.
      const joints = new Set((m.fasteners ?? []).map((f) => f.joint));
      for (const j of ["treadBeamBolted", "shoeBolted", "plateFloor", "plateTrimmer"]) {
        expect(joints.has(j as never), j).toBe(true);
      }
      expect(joints.has("treadScrewed")).toBe(false);
    },
  );

  it("droit : couches collées droites, tableau FCBA lu à b / 2, sans plis minces, EXC1", () => {
    const m = buildModel(load(J5C_WOOD_STRAIGHT), { memo: false });
    const cr = results(m, "CREMAILLERE_REGLE_MOYENS");
    expect(cr.length).toBeGreaterThan(0);
    expect(cr.every((r) => r.status === "ok")).toBe(true);
    expect(m.autoValues?.["stair.structure.params.section.residual"]).toBe(
      requiredCentralResidual(fcbaTable(), "D40", 88),
    );
    expect(results(m, WOOD_CENTRAL_RULES.thinPlies.id)).toEqual([]);
    expect(m.executionClass).toBe("EXC1");
  });

  it.each([J5C_WOOD_QUARTER, J5C_WOOD_HELICAL])(
    "%s : lamelles cintrées, tableau FCBA hors domaine (trace courbe), plis minces contrôlés",
    (file) => {
      const m = buildModel(load(file), { memo: false });
      expect(results(m, "CREMAILLERE_REGLE_MOYENS").map((r) => r.status)).toEqual(["non-evaluee"]);
      expect(results(m, WOOD_CENTRAL_RULES.thinPlies.id)).toHaveLength(1);
      expect(fr(results(m, "LAMELLE_CINTRE_KR")[0]!.message)).toMatch(/^Lamelles cintrées/);
    },
  );
});
