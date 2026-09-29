/**
 * Exemples `examples/*.blondel.json` : un par préréglage (S / Z compris) + cas d'acceptation n° 1 (sans
 * structure, avec la structure bois `wood-housed` du jalon 3a, en limons acier des jalons 3b et
 * 3c) + demi-tournant métal avec garde-corps (jalon 4, interactions entre étapes). L'exemple
 * `j4-acceptance-01-garde-corps` a son générateur dans `guards/acceptance.test.ts`.
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/examples.test.ts`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeHeadroom } from "../headroom/headroom.js";
import { computeLayout } from "../layout/layout.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { computeStepping } from "../stepping/stepping.js";
import { parseProjectText } from "./parse.js";
import {
  createProject,
  OPPOSITE_TURNS_PRESET_IDS,
  PRESET_HEADROOM_MIN,
  PRESET_IDS,
} from "./presets.js";
import { serializeProject } from "./serialize.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const ACCEPTANCE_01 = "acceptance-01-quart-tournant.blondel.json";
const ACCEPTANCE_01_WOOD = "j3a-acceptance-01-bois.blondel.json";
const ACCEPTANCE_01_STEEL_FLAT = "j3b-acceptance-01-acier-plat.blondel.json";
const ACCEPTANCE_01_FOLDED = "j3b-acceptance-01-tole-pliee.blondel.json";
const ACCEPTANCE_01_PROFILE = "j3c-acceptance-01-upn.blondel.json";
const HALF_TURN_STEEL_GUARDS = "j4-demi-tournant-acier-garde-corps.blondel.json";

/**
 * Cas d'acceptation n° 1 (prompt 2 §6, précisé par docs/CHALLENGE.md P1) : quart tournant bas,
 * limon à la française avec poteau d'angle, H = 2 700, trémie 2 800 × 900, E = 800,
 * contextes bois_dtu + logement_interieur.
 *
 * Avec une dalle de 200 mm et l'échappée de 1 900 mm, une trémie de 2 800 mm impose
 * g ≤ 2 800 × h / 2 100 = 240 mm (h = 180) pour une volée droite ; G_MIN_LOGEMENT impose g ≥ 240.
 * Volées 1 280 / 3 052 → g ≈ 240,02 sur la ligne de foulée (tracé réel), 2h + g ≈ 600.
 * (Les volées 1 280 / 3 051 de la géométrie simplifiée donnaient g ≈ 239,95 < 240 : violation
 * bloquante de G_MIN_LOGEMENT révélée par le pipeline complet.)
 * Trémie alignée sur le bord extérieur (côté mur) de la seconde volée, les 100 mm de plus que
 * E étant côté jour. Poteau d'angle de 100 mm (C §1.9 : 90 à 100 mm, confiance faible).
 */
export const ACCEPTANCE_01_OPENING = {
  kind: "rect",
  x: -2252,
  y: 380,
  sizeX: 2800,
  sizeY: 900,
} as const;
export const ACCEPTANCE_01_LEGS = [1280, 3052] as const;

export function acceptance01(): Project {
  return createProject("quarter-left", {
    name: "Cas d'acceptation n° 1 — quart tournant bas bois, poteau d'angle",
    width: 800,
    patch: {
      site: { opening: ACCEPTANCE_01_OPENING },
      stair: {
        layout: {
          legs: ACCEPTANCE_01_LEGS.map((length) => ({ length })),
          turns: [{ direction: "left", mode: "winders", inner: { kind: "newel", size: 100 } }],
        },
      },
    },
  });
}

/**
 * Jalon 3a : cas d'acceptation n° 1 avec sa structure bois (`wood-housed` : limons à la
 * française et poteau d'angle). Paramètres vides : défauts du plugin et du profil d'atelier
 * (à valider), fusionnés par le pipeline.
 */
export function acceptance01Wood(): Project {
  const p = acceptance01();
  return {
    ...p,
    name: "Jalon 3a — cas d'acceptation n° 1, limons à la française",
    stair: { ...p.stair, structure: { kind: "wood-housed", params: {} } },
  };
}

/** Cas d'acceptation n° 1 avec une autre structure (paramètres partiels, défauts à valider). */
function acceptance01With(name: string, kind: string, params: Record<string, unknown>): Project {
  const p = acceptance01();
  return { ...p, name, stair: { ...p.stair, structure: { kind, params } } };
}

/** Jalon 3b : limons acier en plat découpé laser, marches bois (mixte). */
export function acceptance01SteelFlat(): Project {
  return acceptance01With(
    "Jalon 3b — cas d'acceptation n° 1, limons en plat acier",
    "steel-flat",
    {},
  );
}

/**
 * Jalon 3b, critère d'acceptation n° 3 : limons en plat acier et marches en tôle pliée en Z
 * (contremarches pliées : les contremarches bois de base sont supprimées par le pipeline).
 */
export function acceptance01Folded(): Project {
  return acceptance01With(
    "Jalon 3b — cas d'acceptation n° 1, marches en tôle pliée",
    "steel-flat",
    { treadKind: "folded-steel", folded: { profile: "Z" } },
  );
}

/** Jalon 3c : limons en profilés UPN (section `auto` : la plus légère qui passe le precheck). */
export function acceptance01Profile(): Project {
  return acceptance01With("Jalon 3c — cas d'acceptation n° 1, limons UPN", "steel-profile", {
    family: "UPN",
  });
}

/**
 * Jalon 4, interactions entre étapes : demi-tournant balancé (deux quarts, poteaux d'angle de
 * 100 mm au lieu du jour vif du préréglage, sans lequel les limons de jour ne se rencontrent
 * pas), limons en plat acier, marches en tôle pliée en Z, garde-corps barreaudé.
 *
 * Jour porté de 240 à 340 mm (volée centrale 2E + 340, dernière volée raccourcie de 100 mm :
 * même giron de 270 mm) [choix Blondel, 2026-09-30] : entre deux poteaux de 100 mm, un jour de
 * 240 mm ne laisse que 140 mm de limon ; avec les zones par angle (balancement régulier K3
 * autour des poteaux), le collet tombait à 80 mm (G_COLLET_MIN). Avec 340 mm : collet ≥ 100 mm
 * et collets monotones vers chaque poteau.
 */
export const HALF_TURN_NEWEL_JOUR = 340;

export function halfTurnSteelGuards(): Project {
  const base = createProject("half-turn");
  const legs = base.stair.layout.legs.map((l) => l.length as number);
  const width = base.stair.layout.width;
  const p = createProject("half-turn", {
    patch: {
      stair: {
        layout: {
          legs: [legs[0]!, 2 * width + HALF_TURN_NEWEL_JOUR, legs[2]! - 100].map((length) => ({
            length,
          })),
          turns: base.stair.layout.turns.map((t) => ({
            ...t,
            inner: { kind: "newel" as const, size: 100 },
          })),
        },
      },
    },
  });
  return ProjectSchema.parse({
    ...p,
    name: "Jalon 4 — demi-tournant acier et tôle pliée, garde-corps barreaudé",
    stair: {
      ...p.stair,
      structure: { kind: "steel-flat", params: { treadKind: "folded-steel" } },
    },
    compliance: { ...p.compliance, referenceDate: "2026-01-15" },
    guards: { infill: { kind: "balusters" } },
  });
}

const expected: Readonly<Record<string, () => Project>> = {
  ...Object.fromEntries(
    [...PRESET_IDS, ...OPPOSITE_TURNS_PRESET_IDS].map((id) => [
      `${id}.blondel.json`,
      () => createProject(id),
    ]),
  ),
  [ACCEPTANCE_01]: acceptance01,
  [ACCEPTANCE_01_WOOD]: acceptance01Wood,
  [ACCEPTANCE_01_STEEL_FLAT]: acceptance01SteelFlat,
  [ACCEPTANCE_01_FOLDED]: acceptance01Folded,
  [ACCEPTANCE_01_PROFILE]: acceptance01Profile,
  [HALF_TURN_STEEL_GUARDS]: halfTurnSteelGuards,
};

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const [file, build] of Object.entries(expected)) {
    writeFileSync(join(EXAMPLES_DIR, file), serializeProject(build()));
  }
}

describe("examples/", () => {
  const files = existsSync(EXAMPLES_DIR)
    ? readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json"))
    : [];

  it("contient un exemple par préréglage et le cas d'acceptation n° 1", () => {
    expect([...files].sort()).toEqual(expect.arrayContaining(Object.keys(expected).sort()));
  });

  it.each(files)("%s se parse et est sérialisé de façon stable", (file) => {
    const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    const project = parseProjectText(text);
    expect(serializeProject(project)).toBe(text);
  });

  it.each(files)("%s : masse renseignée pour toutes les pièces (QUESTIONS A6)", (file) => {
    const p = parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
    const model = buildModel(p, { memo: false });
    expect(model.parts.length).toBeGreaterThan(0);
    for (const part of model.parts) {
      const m = part.quantities["mass_kg"];
      expect(m !== undefined && Number.isFinite(m) && m > 0, `${file} ${part.id}`).toBe(true);
    }
  });

  it.each(Object.keys(expected))("%s est à jour avec son générateur", (file) => {
    const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    expect(text).toBe(serializeProject(expected[file]!()));
  });

  it("cas d'acceptation n° 1 : cotes et échappée sur la ligne de foulée", () => {
    const p = parseProjectText(readFileSync(join(EXAMPLES_DIR, ACCEPTANCE_01), "utf8"));
    expect(p.site.floorToFloor).toBe(2700);
    expect(p.site.upperSlabThickness).toBe(200);
    expect(p.site.opening).toEqual(ACCEPTANCE_01_OPENING);
    expect(p.stair.layout.width).toBe(800);
    expect(p.stair.layout.turns).toEqual([
      { direction: "left", mode: "winders", inner: { kind: "newel", size: 100 } },
    ]);
    expect(p.compliance.contexts).toEqual(["bois_dtu", "logement_interieur"]);
    const layout = computeLayout(p);
    const stepping = computeStepping(p, layout);
    // Quart tournant « bas » : au plus 3 girons droits avant le tournant.
    expect(stepping.riserCount).toBe(15);
    const { rise, going } = stepping;
    expect((ACCEPTANCE_01_LEGS[0] - 800) / going).toBeLessThanOrEqual(3);
    expect(going).toBeGreaterThanOrEqual(240); // G_MIN_LOGEMENT
    const blondel = 2 * rise + going;
    expect(blondel).toBeGreaterThanOrEqual(580); // BLONDEL_DTU
    expect(blondel).toBeLessThanOrEqual(660);
    expect(rise).toBeLessThanOrEqual(180); // H_MAX_LOGEMENT
    // Échappée exacte sur la ligne de foulée (sorties de trémie) ≥ ECHAPPEE_MIN_DTU.
    const headroom = computeHeadroom(p.site, layout, stepping);
    expect(headroom?.walkline?.min).toBeGreaterThanOrEqual(PRESET_HEADROOM_MIN);
    // Trémie dans l'emprise de la seconde volée côté mur (bord extérieur y = L1).
    expect(ACCEPTANCE_01_OPENING.y + ACCEPTANCE_01_OPENING.sizeY).toBe(ACCEPTANCE_01_LEGS[0]);
    expect(ACCEPTANCE_01_OPENING.x).toBe(800 - ACCEPTANCE_01_LEGS[1]);
  });
});
