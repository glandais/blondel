/**
 * Instantané de calcul d'un projet : `Model` du cœur (`buildModel`) **et** maillage d'aperçu de
 * ses pièces (`@blondel/geometry`), avec leurs durées. C'est l'unité de travail du Web Worker de
 * calcul (`model.worker.ts`) comme du repli sur le fil principal : la barre d'état affiche
 * ainsi le temps de maillage même quand la vue 3D n'est pas ouverte.
 *
 * Tout ce qui est rendu ici doit rester clonable (`structuredClone`, `postMessage`) : objets
 * simples et tableaux typés, aucune fonction.
 */
import type { Project } from "@blondel/core";
import type { PartMesh } from "@blondel/geometry";
import { computeModel, type BuildModelFn, type ModelResult } from "./buildModel.js";
import type { MeshCache } from "./meshCache.js";

/** Maillage d'une pièce et empreinte de son solide (clé de partage des géométries three.js). */
export interface MeshedPartData {
  readonly key: string;
  readonly mesh: PartMesh;
}

export interface MeshSnapshot {
  readonly parts: readonly MeshedPartData[];
  /** Durée du maillage (empreintes + pièces manquantes), ms. */
  readonly timeMs: number;
  /** Pièces maillées lors de ce calcul / réutilisées depuis le cache. */
  readonly misses: number;
  readonly hits: number;
}

export interface ModelSnapshot extends ModelResult {
  /** Maillage d'aperçu ; `null` sans modèle ou si le maillage a échoué. */
  readonly mesh: MeshSnapshot | null;
  /** Message d'un échec du maillage (le modèle reste affiché en 2D). */
  readonly meshError?: string;
}

/** Calcule le modèle puis maille ses pièces ; ne lève jamais. */
export function computeSnapshot(
  project: Project,
  meshCache: MeshCache,
  build?: BuildModelFn,
): ModelSnapshot {
  const result = computeModel(project, build);
  if (!result.model) return { ...result, mesh: null };
  try {
    const run = meshCache.mesh(result.model.parts);
    return {
      ...result,
      mesh: {
        parts: run.parts.map((p) => ({ key: p.key, mesh: p.mesh })),
        timeMs: run.timeMs,
        misses: run.misses,
        hits: run.hits,
      },
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ...result, mesh: null, meshError: `Maillage impossible : ${detail}` };
  }
}
