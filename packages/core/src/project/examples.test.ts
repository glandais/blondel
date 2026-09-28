/**
 * Exemples `examples/*.blondel.json` : un par préréglage + cas d'acceptation n° 1.
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/examples.test.ts`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { parseProjectText } from "./parse.js";
import { buildFrames, rectContains, requiredOpeningLength, sampleFromArrival, walklineLength } from "./preset-geometry.js";
import { createProject, PRESET_HEADROOM_MIN, PRESET_IDS } from "./presets.js";
import { serializeProject } from "./serialize.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const ACCEPTANCE_01 = "acceptance-01-quart-tournant.blondel.json";

/**
 * Cas d'acceptation n° 1 (prompt 2 §6, précisé par docs/CHALLENGE.md P1) : quart tournant bas,
 * limon à la française avec poteau d'angle, H = 2 700, trémie 2 800 × 900, E = 800,
 * contextes bois_dtu + logement_interieur.
 *
 * Avec une dalle de 200 mm et l'échappée de 1 900 mm, une trémie de 2 800 mm impose
 * g ≤ 2 800 × h / 2 100 = 240 mm (h = 180) : volées 1 280 / 3 051 → g ≈ 239,95, 2h + g ≈ 600.
 * Trémie alignée sur le bord extérieur (côté mur) de la seconde volée, les 100 mm de plus que
 * E étant côté jour. Poteau d'angle de 100 mm (C §1.9 : 90 à 100 mm, confiance faible).
 */
export const ACCEPTANCE_01_OPENING = { kind: "rect", x: -2251, y: 380, sizeX: 2800, sizeY: 900 } as const;
export const ACCEPTANCE_01_LEGS = [1280, 3051] as const;

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

const expected: Readonly<Record<string, () => Project>> = {
  ...Object.fromEntries(PRESET_IDS.map((id) => [`${id}.blondel.json`, () => createProject(id)])),
  [ACCEPTANCE_01]: acceptance01,
};

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const [file, build] of Object.entries(expected)) {
    writeFileSync(join(EXAMPLES_DIR, file), serializeProject(build()));
  }
}

describe("examples/", () => {
  const files = existsSync(EXAMPLES_DIR) ? readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json")) : [];

  it("contient un exemple par préréglage et le cas d'acceptation n° 1", () => {
    expect([...files].sort()).toEqual(expect.arrayContaining(Object.keys(expected).sort()));
  });

  it.each(files)("%s se parse et est sérialisé de façon stable", (file) => {
    const text = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    const project = parseProjectText(text);
    expect(serializeProject(project)).toBe(text);
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
    expect(p.stair.layout.turns).toEqual([{ direction: "left", mode: "winders", inner: { kind: "newel", size: 100 } }]);
    expect(p.compliance.contexts).toEqual(["bois_dtu", "logement_interieur"]);
    const frames = buildFrames(800, ACCEPTANCE_01_LEGS, ["left"]);
    // Quart tournant « bas » : au plus 3 girons droits avant le tournant.
    const n = 15;
    const rise = 2700 / n;
    const going = walklineLength(frames) / (n - 1);
    expect((ACCEPTANCE_01_LEGS[0] - 800) / going).toBeLessThanOrEqual(3);
    const blondel = 2 * rise + going;
    expect(blondel).toBeGreaterThanOrEqual(580); // BLONDEL_DTU
    expect(blondel).toBeLessThanOrEqual(660);
    expect(rise).toBeLessThanOrEqual(180); // H_MAX_LOGEMENT
    const needed = requiredOpeningLength(PRESET_HEADROOM_MIN, 200, going, rise);
    expect(needed).toBeLessThanOrEqual(2800);
    const samples = sampleFromArrival(frames, needed);
    expect(samples[samples.length - 1]!.fromArrival).toBeCloseTo(needed, 6);
    for (const s of samples) expect(rectContains(ACCEPTANCE_01_OPENING, s.point)).toBe(true);
    // Trémie dans l'emprise de la seconde volée côté mur (bord extérieur y = L1).
    expect(ACCEPTANCE_01_OPENING.y + ACCEPTANCE_01_OPENING.sizeY).toBe(ACCEPTANCE_01_LEGS[0]);
    expect(ACCEPTANCE_01_OPENING.x).toBe(800 - ACCEPTANCE_01_LEGS[1]);
  });
});
