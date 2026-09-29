/**
 * Mesure du passage d'un préréglage à l'autre (bogue « Quart tournant à gauche » figé) et budget
 * ADR-0006 : cœur (`buildModel`) ≤ 15 ms, maillage d'aperçu ≤ 30 ms, médiane de 20 exécutions,
 * seuil ×3 (suite parallèle ; `PERF_STRICT=1` : budget strict). Les rendus SVG de l'écran
 * sont chronométrés et bornés au même titre (une image doit rester sous la seconde).
 */
import { PRESET_IDS, buildModel, createProject, type PresetId } from "@blondel/core";
import { renderElevationSvg, renderPlanSvg } from "@blondel/exports";
import { describe, expect, it } from "vitest";
import { createMeshCache } from "../model/meshCache.js";
import { upperSlabMesh } from "../three/geometry.js";

const CORE_BUDGET_MS = 15;
const MESH_BUDGET_MS = 30;
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const FACTOR = env?.["PERF_STRICT"] === "1" ? 1 : 3;
const RUNS = 20;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function time(f: () => unknown): number {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

interface Measure {
  core: number;
  meshCold: number;
  meshWarm: number;
  svg: number;
}

function measure(id: PresetId): Measure {
  const project = createProject(id);
  for (let i = 0; i < 5; i++) buildModel(project, { memo: false });
  const core: number[] = [];
  const meshCold: number[] = [];
  const meshWarm: number[] = [];
  const svg: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    let model = buildModel(project, { memo: false });
    core.push(time(() => (model = buildModel(project, { memo: false }))));
    // Maillage à froid : pièces recréées à l'identique (nouvelle identité, cache neuf).
    const parts = structuredClone(model.parts);
    const cache = createMeshCache();
    meshCold.push(time(() => cache.mesh(parts)));
    meshWarm.push(time(() => cache.mesh(structuredClone(model.parts))));
    svg.push(
      time(() => {
        renderPlanSvg(model, { project, background: false });
        renderElevationSvg(model, { project, background: false });
      }),
    );
  }
  return {
    core: median(core),
    meshCold: median(meshCold),
    meshWarm: median(meshWarm),
    svg: median(svg),
  };
}

describe("passage de préréglage : cœur, maillage, rendus (ADR-0006)", () => {
  it.each(PRESET_IDS)(
    "%s",
    (id) => {
      const m = measure(id);
      console.info(
        `${id} : cœur ${m.core.toFixed(2)} ms, maillage ${m.meshCold.toFixed(2)} ms (réutilisé ${m.meshWarm.toFixed(2)} ms), SVG ${m.svg.toFixed(2)} ms`,
      );
      expect(m.core).toBeLessThanOrEqual(CORE_BUDGET_MS * FACTOR);
      expect(m.meshCold).toBeLessThanOrEqual(MESH_BUDGET_MS * FACTOR);
      expect(m.svg).toBeLessThanOrEqual(100 * FACTOR);
    },
    60_000,
  );

  it("droit → quart tournant à gauche, à froid : très loin d'un gel de plusieurs secondes", () => {
    const straight = createProject("straight");
    const quarter = createProject("quarter-left");
    const cache = createMeshCache();
    cache.mesh(buildModel(straight).parts);
    const total = time(() => {
      const model = buildModel(quarter);
      cache.mesh(model.parts);
      // Dalle haute percée de la trémie, recalculée par la vue 3D à chaque projet.
      upperSlabMesh(quarter, model.layout.footprint);
      renderPlanSvg(model, { project: quarter });
      renderElevationSvg(model, { project: quarter });
    });
    console.info(`droit → quart tournant à gauche : ${total.toFixed(1)} ms`);
    expect(total).toBeLessThan(1000);
  });
});
