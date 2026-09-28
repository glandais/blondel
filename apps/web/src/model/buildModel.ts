/**
 * Accès de l'UI au pipeline du cœur (`buildModel`, ADR-0002). L'UI n'effectue aucun calcul
 * métier : elle appelle `buildModel` et affiche le `Model` rendu. Cette couche ajoute seulement
 * la mesure du temps de calcul et la capture d'une exception inattendue (l'application reste
 * utilisable pour éditer, sauvegarder et exporter le projet).
 */
import { buildModel, type Model, type Project } from "@blondel/core";

export type BuildModelFn = (project: Project) => Model;

export interface ModelResult {
  /** Modèle dérivé, ou `null` si le pipeline a levé une exception. */
  readonly model: Model | null;
  /** Erreurs à afficher (erreurs du modèle + exception éventuelle). */
  readonly errors: readonly string[];
  /** Durée de calcul de `buildModel` (ms). */
  readonly timeMs: number;
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/** Calcule le modèle d'un projet ; ne lève jamais. */
export function computeModel(project: Project, build: BuildModelFn = buildModel): ModelResult {
  const t0 = now();
  try {
    const model = build(project);
    return { model, errors: model.errors, timeMs: now() - t0 };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { model: null, errors: [`Erreur du calcul : ${detail}`], timeMs: now() - t0 };
  }
}

/**
 * Mémoïsation sur l'identité du projet (immuable) : un même snapshot, par exemple après
 * annuler/rétablir, n'est pas recalculé et garde son temps de calcul d'origine.
 */
export function createModelCache(
  build: BuildModelFn = buildModel,
  size = 8,
): (project: Project) => ModelResult {
  const cache = new Map<Project, ModelResult>();
  return (project) => {
    const hit = cache.get(project);
    if (hit) {
      cache.delete(project);
      cache.set(project, hit);
      return hit;
    }
    const result = computeModel(project, build);
    cache.set(project, result);
    while (cache.size > size) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return result;
  };
}
