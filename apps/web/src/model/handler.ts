/**
 * Traitement des calculs du worker, partagé avec le repli sur le fil principal (navigateur sans
 * Web Worker, tests sous Node) : même code, mêmes résultats.
 */
import type { Project } from "@blondel/core";
import { runVariants, type CompareOutcome } from "../lib/variants.js";
import { createMeshCache, type MeshCache } from "./meshCache.js";
import type { WorkerJob } from "./protocol.js";
import { computeSnapshot, type ModelSnapshot } from "./snapshot.js";
import { shareUnchanged } from "./structuralShare.js";

export interface JobRunner {
  build(job: Extract<WorkerJob, { type: "build" }>): ModelSnapshot;
  compare(job: Extract<WorkerJob, { type: "compare" }>): CompareOutcome;
}

/**
 * Exécutant de calculs avec son propre cache de maillage (un par worker). Le projet reçu (cloné
 * par `postMessage`) partage ses sous-arbres inchangés avec le précédent (`shareUnchanged`) :
 * sans cela, les caches par identité de `buildModel` ne serviraient jamais dans le worker.
 */
export function createJobRunner(meshCache: MeshCache = createMeshCache()): JobRunner {
  let lastBuild: Project | undefined;
  let lastCompare: Project | undefined;
  return {
    build: (job) => {
      const project = (lastBuild = shareUnchanged(lastBuild, job.project));
      return computeSnapshot(project, meshCache);
    },
    compare: (job) => {
      const project = (lastCompare = shareUnchanged(lastCompare, job.project));
      return runVariants(project, job.variants);
    },
  };
}
