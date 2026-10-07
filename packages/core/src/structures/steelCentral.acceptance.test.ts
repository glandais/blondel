/**
 * Limon central métal (QUESTIONS A29) — exemples générés `examples/j5c-limon-central-*.blondel.json`,
 * un par géométrie de poutre : escalier droit sur tube, quart tournant balancé sur caisson
 * débillardé (marches en tôle pliée vissées, A31), hélicoïdal à jour central sur caisson
 * hélicoïdal. Ils sont couverts par l'instantané des cotes (`pipeline/build.test.ts`) et par tous
 * les exports (`packages/exports/src/examples.test.ts`).
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/structures/steelCentral.acceptance.test.ts`.
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
import { CENTRAL_RULES } from "./steelCentral.js";
import "./index.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

export const J5C_STRAIGHT = "j5c-limon-central-droit.blondel.json";
export const J5C_QUARTER = "j5c-limon-central-quart-tournant.blondel.json";
export const J5C_HELICAL = "j5c-limon-central-helicoidal.blondel.json";

/** Pose la structure `steel-central` (paramètres minimaux) sur un projet de préréglage. */
function withCentral(p: Project, params: Record<string, unknown>): Project {
  return deepMerge(p, { stair: { structure: { kind: "steel-central", params } } });
}

/**
 * Escalier droit du préréglage (H = 2 700, E = 900), limon central en tube rectangulaire
 * 200 × 100 × 5 (C §2.5 [42], à valider) sous des marches bois, consoles soudées.
 */
export function j5cStraight(): Project {
  return withCentral(
    createProject("straight", { name: "Jalon 5c — escalier droit sur limon central (tube)" }),
    { section: { kind: "tube" } },
  );
}

/**
 * Quart tournant balancé du préréglage (jour vif), limon central en caisson débillardé (âme et
 * flasques roulées par tronçons, joints bout à bout, EXC2 ; C §2.4 [20]), marches en tôle
 * pliée en Z vissées sur leurs consoles (A31, vissée par défaut).
 */
export function j5cQuarter(): Project {
  return withCentral(
    createProject("quarter-left", {
      name: "Jalon 5c — quart tournant balancé sur limon central débillardé (caisson)",
    }),
    { section: { kind: "box" }, treadKind: "folded-steel" },
  );
}

/**
 * Hélicoïdal à jour central (R_e = 1 200, jour de 350 mm, marches de 80 mm sans contremarche,
 * comme la démo « hélicoïdal à jour central »), limon central en caisson hélicoïdal à
 * mi-emmarchement : sans limon de jour ni fût porteur, la poutre porte seule les marches.
 */
export function j5cHelical(): Project {
  return withCentral(
    createHelicalProject({
      name: "Jalon 5c — hélicoïdal à jour central sur limon central (caisson)",
      floorToFloor: 2750,
      outerRadius: 1200,
      patch: {
        stair: {
          layout: { core: { kind: "well", radius: 350 } },
          treads: { risers: "none", thickness: 80 },
        },
      },
    }),
    { section: { kind: "box" } },
  );
}

const GENERATORS: readonly (readonly [string, () => Project])[] = [
  [J5C_STRAIGHT, j5cStraight],
  [J5C_QUARTER, j5cQuarter],
  [J5C_HELICAL, j5cHelical],
];

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const [file, make] of GENERATORS) {
    writeFileSync(join(EXAMPLES_DIR, file), serializeProject(make()));
  }
}

const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

/** Constats d'une règle en violation. */
const violations = (m: Model, id: string) =>
  m.compliance.results.filter((r) => r.ruleId === id && r.status === "violation");

describe("exemples j5c : limon central métal", () => {
  it.each(GENERATORS)("%s : à jour avec son générateur, sérialisation stable", (file, make) => {
    const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    expect(text).toBe(serializeProject(make()));
    expect(serializeProject(parseProjectText(text))).toBe(text);
  });

  it.each(GENERATORS)(
    "%s : modèle complet, aucune erreur ni bloquant, marches portées, porte-à-faux signalé",
    (file) => {
      const m = buildModel(load(file), { memo: false });
      expect(frList(m.errors)).toEqual([]);
      expect(m.compliance.summary.bloquant).toBe(0);
      expect(violations(m, "FAB_MARCHE_PORTEE")).toEqual([]);
      const cantilever = violations(m, CENTRAL_RULES.cantilever.id);
      expect(cantilever).toHaveLength(1);
      expect(fr(cantilever[0]!.message)).toMatch(/^Justification requise/);
      // Une console (âme + plat d'appui) sous chaque marche ; poutre prédimensionnée.
      for (const t of m.stepping.treads) {
        expect(m.parts.some((p) => p.id === `support-${t.number}-central`)).toBe(true);
      }
      expect(m.precheck?.beams).toHaveLength(1);
      for (const p of m.parts) {
        const mass = p.quantities["mass_kg"];
        expect(mass !== undefined && Number.isFinite(mass) && mass > 0, p.id).toBe(true);
      }
    },
  );

  it("droit : tube en une barre, EXC1", () => {
    const m = buildModel(load(J5C_STRAIGHT), { memo: false });
    expect(m.parts.filter((p) => p.id.startsWith("central-tube-")).length).toBeGreaterThan(0);
    expect(m.parts.some((p) => p.id.startsWith("central-web-"))).toBe(false);
    expect(m.executionClass).toBe("EXC1");
  });

  it("quart tournant : flasques débillardées par tronçons, marches en tôle percées (vissées)", () => {
    const m = buildModel(load(J5C_QUARTER), { memo: false });
    const webs = m.parts.filter((p) => p.id.startsWith("central-web-left-"));
    expect(webs.length).toBeGreaterThanOrEqual(2);
    expect(m.parts.filter((p) => p.id.startsWith("central-web-right-"))).toHaveLength(webs.length);
    // Tronçons soudés bout à bout : EXC2 (C §2.1).
    const butt = m.parts.reduce((s, p) => s + (p.quantities["butt_weld_mm"] ?? 0), 0);
    expect(butt).toBeGreaterThan(0);
    expect(m.executionClass).toBe("EXC2");
    const treads = m.parts.filter((p) => p.category === "tread");
    expect(treads.every((p) => p.material.startsWith("steel"))).toBe(true);
    // Consoles : plats d'appui percés pour les vis de la marche en tôle (A31).
    const bearings = m.parts.filter((p) => p.id.endsWith("-bearing"));
    expect(bearings.length).toBe(m.stepping.treads.length);
    for (const b of bearings) expect(b.flat?.outline.holes.length).toBeGreaterThan(0);
  });

  it("hélicoïdal : poutre hélicoïdale en caisson, aucun poteau ni fût généré", () => {
    const m = buildModel(load(J5C_HELICAL), { memo: false });
    expect(m.layout.helical?.core).toBe("well");
    expect(m.parts.some((p) => p.id.startsWith("central-web-"))).toBe(true);
    expect(m.parts.some((p) => p.category === "post")).toBe(false);
  });
});
