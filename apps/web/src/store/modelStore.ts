/**
 * Modèle dérivé du projet courant, calculé hors du fil principal (ADR-0006) : chaque nouveau
 * projet du store est soumis au worker de calcul ; seule la dernière demande est calculée et
 * publiée (`latestRunner.ts`). Pendant un calcul, le dernier modèle publié reste affiché
 * (`pending` = vrai) : l'interface ne se fige jamais.
 *
 * Le comparateur de variantes a son propre worker (un calcul long de comparaison ne retarde
 * pas le modèle) et n'est calculé qu'à la demande (onglet « Comparateur » affiché).
 */
import type { Project } from "@blondel/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CompareOutcome } from "../lib/variants.js";
import { createLatestRunner } from "../model/latestRunner.js";
import type { JobExec } from "../model/workerClient.js";
import type { ModelSnapshot } from "../model/snapshot.js";
import type { Variant } from "../lib/variants.js";

export interface ModelView extends ModelSnapshot {
  /** Projet dont ce modèle est issu (peut précéder le projet courant pendant un calcul). */
  readonly project: Project | null;
  /** Un calcul est en cours pour le projet courant. */
  readonly pending: boolean;
}

export interface CompareView {
  readonly project: Project | null;
  readonly outcome: CompareOutcome | null;
  readonly pending: boolean;
}

export interface ModelState {
  readonly model: ModelView;
  readonly compare: CompareView;
}

export const EMPTY_MODEL_VIEW: ModelView = {
  model: null,
  errors: [],
  timeMs: 0,
  mesh: null,
  project: null,
  pending: true,
};

export interface ModelService {
  readonly store: StoreApi<ModelState>;
  /** Demande le modèle d'un projet (publication dans `store`). */
  request(project: Project): void;
  /** Demande la comparaison des variantes d'un projet. */
  requestCompare(project: Project): void;
  /** Dossier PDF d'un projet, mis en page dans le worker de calcul (hors du fil principal). */
  exportPdf(project: Project): Promise<Uint8Array>;
}

export interface ModelServiceOptions {
  readonly exec: JobExec;
  /** Exécutant du comparateur (défaut : `exec`). */
  readonly compareExec?: JobExec;
  /** Variantes comparées pour un projet (déterministe : le résultat est mis en cache). */
  readonly variantsOf: (project: Project) => readonly Variant[];
}

function failure(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createModelService(options: ModelServiceOptions): ModelService {
  const { exec, variantsOf } = options;
  const compareExec = options.compareExec ?? exec;
  const store = createStore<ModelState>()(() => ({
    model: EMPTY_MODEL_VIEW,
    compare: { project: null, outcome: null, pending: false },
  }));

  const build = createLatestRunner<Project, ModelSnapshot>({
    exec: (p) => exec.build(p),
    onError: (_p, e) => ({
      model: null,
      errors: [`Erreur du calcul : ${failure(e)}`],
      timeMs: 0,
      mesh: null,
    }),
    onResult: (project, result) =>
      store.setState((s) => ({ model: { ...result, project, pending: s.model.pending } })),
    onPending: (pending) => store.setState((s) => ({ model: { ...s.model, pending } })),
  });

  const compare = createLatestRunner<Project, CompareOutcome>({
    exec: (p) => compareExec.compare(p, variantsOf(p)),
    onError: (_p, e) => ({
      rows: [],
      timeMs: 0,
      error: `Erreur de la comparaison : ${failure(e)}`,
    }),
    onResult: (project, outcome) =>
      store.setState((s) => ({ compare: { ...s.compare, project, outcome } })),
    onPending: (pending) => store.setState((s) => ({ compare: { ...s.compare, pending } })),
    cacheSize: 4,
  });

  return {
    store,
    request: (project) => build.submit(project),
    requestCompare: (project) => compare.submit(project),
    exportPdf: (project) => exec.pdf(project),
  };
}
