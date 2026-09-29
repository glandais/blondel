/**
 * Budget de performance (ADR-0006) : `buildModel` ≤ 15 ms (médiane de 20 exécutions) sur
 * l'escalier de référence quart tournant, seuil ×3 en CI pour absorber la variance.
 * Mesure sans mémoïsation (recalcul complet), après échauffement du JIT. Détail par étape :
 * banc `bench.test.ts` (`BLONDEL_BENCH=1`).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { buildModel } from "./build.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const BUDGET_MS = 15;
/**
 * Facteur ×3 (ADR-0006) : la suite complète tourne en parallèle et la variance est forte
 * (≈ 5 ms isolé, jusqu'à ≈ 19 ms sous charge). `PERF_STRICT=1` : budget strict.
 */
const FACTOR = process.env["PERF_STRICT"] === "1" ? 1 : 3;
const RUNS = 20;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function load(file: string): Project {
  return parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}

function medianBuildTime(project: Project): number {
  for (let i = 0; i < 5; i++) buildModel(project, { memo: false });
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    buildModel(project, { memo: false });
    times.push(performance.now() - t0);
  }
  return median(times);
}

/** Préréglage quart tournant avec limons bois à la française (`wood-housed`). */
function quarterWood(): Project {
  const p = load("quarter-left.blondel.json");
  return { ...p, stair: { ...p.stair, structure: { kind: "wood-housed", params: {} } } };
}

const CASES: readonly [string, () => Project][] = [
  ["quarter-left.blondel.json", () => load("quarter-left.blondel.json")],
  ["quarter-left.blondel.json + limons bois", quarterWood],
  [
    "acceptance-01-quart-tournant.blondel.json",
    () => load("acceptance-01-quart-tournant.blondel.json"),
  ],
  ["j3a-acceptance-01-bois.blondel.json", () => load("j3a-acceptance-01-bois.blondel.json")],
];

describe("performance de buildModel (ADR-0006)", () => {
  it.each(CASES)(
    "%s : médiane ≤ 15 ms (×3 en CI)",
    (label, make) => {
      const t = medianBuildTime(make());
      console.info(`buildModel ${label} : médiane ${t.toFixed(2)} ms (budget ${BUDGET_MS} ms)`);
      expect(t).toBeLessThanOrEqual(BUDGET_MS * FACTOR);
    },
    60_000,
  );
});
