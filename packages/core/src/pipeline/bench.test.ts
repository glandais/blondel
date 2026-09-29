/**
 * Banc de performance reproductible de `buildModel` (ADR-0006), détaillé par étape.
 *
 * Désactivé par défaut (il ne vérifie rien et prend quelques secondes) ; lancement :
 *
 *   BLONDEL_BENCH=1 pnpm vitest run packages/core/src/pipeline/bench.test.ts
 *
 * Escaliers mesurés : préréglage quart tournant gauche sans structure, le même avec limons
 * bois à la française (`wood-housed`), et le cas d'acceptation n° 1 bois. Pour chaque étape
 * (tracé, découpage — dont l'énumération des zones de balancement —, pièces de base,
 * structure, échappée, contrôle de conception) : médiane de `RUNS` exécutions après
 * échauffement du JIT, puis médiane de `buildModel` complet sans mémoïsation, et durée du tout
 * premier appel de `buildModel` (avant échauffement).
 * `BLONDEL_BENCH_RUNS` change le nombre d'exécutions.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { computeHeadroom } from "../headroom/headroom.js";
import { computeLayout } from "../layout/layout.js";
import type { Project } from "../model/project.js";
import { buildBasicParts } from "../parts/basic.js";
import { createProject } from "../project/presets.js";
import { parseProjectText } from "../project/parse.js";
import { evaluateComplianceDetailed } from "../rules/engine.js";
import { computeStepping } from "../stepping/stepping.js";
import { getStructure } from "../structures/index.js";
import { buildModel, deepMerge } from "./build.js";

const ENABLED = process.env["BLONDEL_BENCH"] === "1";
const RUNS = Number(process.env["BLONDEL_BENCH_RUNS"] ?? 40);
const WARMUP = 10;
const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Médiane (ms) de `fn` après échauffement. */
function time(fn: () => unknown): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  return median(t);
}

function withStructure(project: Project, kind: string): Project {
  return { ...project, stair: { ...project.stair, structure: { kind, params: {} } } };
}

/** Temps par étape, chaque étape recevant les résultats (précalculés) des étapes amont. */
export function benchStages(project: Project): Record<string, number> {
  // Premier appel, avant tout échauffement (JIT froid pour le premier cas du fichier) : ordre
  // de grandeur du premier calcul dans le navigateur.
  const t0 = performance.now();
  buildModel(project, { memo: false });
  const cold = performance.now() - t0;
  const layout = computeLayout(project);
  const stepping = computeStepping(project, layout);
  const base = buildBasicParts(project, layout, stepping).parts;
  const plugin =
    project.stair.structure.kind !== "none" ? getStructure(project.stair.structure.kind) : null;
  const ctx = { project, layout, stepping, baseParts: base };
  const params = plugin
    ? plugin.paramsSchema.parse(
        deepMerge(plugin.defaults(ctx) as Record<string, unknown>, project.stair.structure.params),
      )
    : null;
  const headroom = computeHeadroom(project.site, layout, stepping);
  const walk = headroom?.walkline;
  const out: Record<string, number> = {
    layout: time(() => computeLayout(project)),
    stepping: time(() => computeStepping(project, layout)),
    parts: time(() => buildBasicParts(project, layout, stepping)),
  };
  if (plugin) out["structure"] = time(() => plugin.build(ctx, params));
  out["headroom"] = time(() => computeHeadroom(project.site, layout, stepping));
  out["compliance"] = time(() =>
    evaluateComplianceDetailed({
      project,
      layout,
      stepping,
      ...(walk ? { headroom: { min: walk.min, at: walk.at } } : {}),
    }),
  );
  out["buildModel"] = time(() => buildModel(project, { memo: false }));
  out["premier appel"] = cold;
  return out;
}

const CASES: readonly [string, () => Project][] = [
  ["quart tournant (préréglage)", () => createProject("quarter-left")],
  [
    "quart tournant + limons bois",
    () => withStructure(createProject("quarter-left"), "wood-housed"),
  ],
  [
    "acceptance-01 bois",
    () =>
      parseProjectText(
        readFileSync(join(EXAMPLES_DIR, "j3a-acceptance-01-bois.blondel.json"), "utf8"),
      ),
  ],
];

describe.skipIf(!ENABLED)("banc de performance de buildModel (ADR-0006)", () => {
  it.each(CASES)(
    "%s",
    (label, make) => {
      const r = benchStages(make());
      const line = Object.entries(r)
        .map(([k, v]) => `${k} ${v.toFixed(2)}`)
        .join(" | ");
      console.info(`[banc] ${label} (médianes en ms, ${RUNS} exécutions) : ${line}`);
    },
    120_000,
  );
});
