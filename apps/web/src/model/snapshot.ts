/**
 * Instantané de calcul d'un projet : `Model` du cœur (`buildModel`) **et** maillage d'aperçu de
 * ses pièces (`@blondel/geometry`), avec leurs durées. C'est l'unité de travail du Web Worker de
 * calcul (`model.worker.ts`) comme du repli sur le fil principal : la barre d'état affiche
 * ainsi le temps de maillage même quand la vue 3D n'est pas ouverte.
 *
 * Pièces de la scène : toutes sauf les composantes (`Part.componentOf`, couches d'une poutre en
 * couches empilées, QUESTIONS A33 (e), et planches d'une couche composée, A36 (9)), que la pièce
 * racine (`rootAssemblyId`) dessine déjà ; elles restent dans le `Model` (listes, nomenclature,
 * gabarits en Fabrication).
 *
 * Tout ce qui est rendu ici doit rester clonable (`structuredClone`, `postMessage`) : objets
 * simples et tableaux typés, aucune fonction.
 */
import { errorMessageOf, type Part, type Project } from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
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
  readonly meshError?: Message;
}

/** Pièces dessinées dans la scène 3D : sans les composantes (`Part.componentOf`). */
export function sceneParts(parts: readonly Part[]): readonly Part[] {
  return parts.some((p) => p.componentOf !== undefined)
    ? parts.filter((p) => p.componentOf === undefined)
    : parts;
}

/** Calcule le modèle puis maille ses pièces de la scène ; ne lève jamais. */
export function computeSnapshot(
  project: Project,
  meshCache: MeshCache,
  build?: BuildModelFn,
): ModelSnapshot {
  const result = computeModel(project, build);
  if (!result.model) return { ...result, mesh: null };
  try {
    const run = meshCache.mesh(sceneParts(result.model.parts));
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
    return {
      ...result,
      mesh: null,
      meshError: msg("ui.worker.meshFailed", { detail: errorMessageOf(e) }),
    };
  }
}
