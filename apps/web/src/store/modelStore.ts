/**
 * Modèle dérivé du projet courant, calculé hors du fil principal (ADR-0006) : chaque nouveau
 * projet du store est soumis au worker de calcul ; seule la dernière demande est calculée et
 * publiée (`latestRunner.ts`). Pendant un calcul, le dernier modèle publié reste affiché
 * (`pending` = vrai) : l'interface ne se fige jamais.
 *
 * Glisser de l'éditeur de plan (ADR-0010, sous-lot 4c, `beginGesture` / `endGesture`) : pendant
 * le geste, aucun modèle complet n'est demandé. Un déplacement ou une rotation de l'escalier
 * (`transform`) ne calcule rien : l'éditeur transforme l'affichage du dernier modèle. Les autres
 * glissers (`preview`) demandent un **aperçu** (`preview` : tracé, découpage léger, conflits
 * géométriques) par la voie rapide du worker, publié dans `preview` (dernier aperçu reçu, même
 * en retard d'une demande, `publishStale`). Au relâchement, un seul modèle complet est demandé
 * (le dernier projet) ; l'aperçu reste affiché jusqu'à sa publication.
 *
 * Le comparateur de variantes a son propre worker (un calcul long de comparaison ne retarde
 * pas le modèle) et n'est calculé qu'à la demande (onglet « Comparateur » affiché).
 */
import { errorMessageOf, type Project } from "@blondel/core";
import { msg, type Locale } from "@blondel/i18n";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PdfJobOptions } from "../lib/optionalApi.js";
import type { CompareOutcome } from "../lib/variants.js";
import { createLatestRunner } from "../model/latestRunner.js";
import type { JobExec } from "../model/workerClient.js";
import type { ModelSnapshot } from "../model/snapshot.js";
import type { PreviewResult } from "../model/protocol.js";
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

/** Aperçu de l'éditeur de plan publié pendant un glisser (dernier reçu). */
export interface PreviewView {
  /** Projet dont l'aperçu est issu. */
  readonly project: Project;
  readonly result: PreviewResult;
}

/**
 * Geste en cours de l'éditeur de plan : `transform` (déplacement, rotation : affichage
 * transformé, aucun calcul), `preview` (autres poignées : aperçu du worker), `null` hors geste.
 */
export type GestureMode = "transform" | "preview" | null;

export interface ModelState {
  readonly model: ModelView;
  readonly compare: CompareView;
  /** Dernier aperçu reçu ; effacé à la publication du modèle complet après le geste. */
  readonly preview: PreviewView | null;
  readonly gesture: GestureMode;
}

/** Compteurs des calculs (diagnostic, mesure e2e de la voie d'aperçu). */
export interface ModelStats {
  /** Modèles complets lancés (`buildModel` + maillage). */
  readonly builds: number;
  /** Aperçus lancés, et publiés. */
  readonly previews: number;
  readonly previewsPublished: number;
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
  /**
   * Demande le modèle d'un projet (publication dans `store`) ; pendant un geste, un aperçu
   * (`preview`) ou rien (`transform`).
   */
  request(project: Project): void;
  /** Début d'un glisser de l'éditeur de plan (voir l'en-tête). */
  beginGesture(mode: "transform" | "preview"): void;
  /** Fin du glisser : le modèle complet du dernier projet demandé est calculé (une fois). */
  endGesture(): void;
  stats(): ModelStats;
  /** Demande la comparaison des variantes d'un projet. */
  requestCompare(project: Project): void;
  /**
   * Dossier PDF d'un projet dans la langue `locale`, mis en page dans le worker de calcul (hors
   * du fil principal).
   */
  exportPdf(
    project: Project,
    options: PdfJobOptions | undefined,
    locale: Locale,
  ): Promise<Uint8Array>;
  /** Modèle 3D glTF binaire d'un projet (noms dans la langue `locale`), dans le worker de calcul. */
  exportGlb(project: Project, locale: Locale): Promise<Uint8Array>;
}

export interface ModelServiceOptions {
  readonly exec: JobExec;
  /** Exécutant du comparateur (défaut : `exec`). */
  readonly compareExec?: JobExec;
  /** Variantes comparées pour un projet (déterministe : le résultat est mis en cache). */
  readonly variantsOf: (project: Project) => readonly Variant[];
}

export function createModelService(options: ModelServiceOptions): ModelService {
  const { exec, variantsOf } = options;
  const compareExec = options.compareExec ?? exec;
  const store = createStore<ModelState>()(() => ({
    model: EMPTY_MODEL_VIEW,
    compare: { project: null, outcome: null, pending: false },
    preview: null,
    gesture: null,
  }));
  /** Dernier projet demandé (pendant un geste : le modèle complet à calculer au relâchement). */
  let latest: Project | undefined;

  const build = createLatestRunner<Project, ModelSnapshot>({
    exec: (p) => exec.build(p),
    onError: (_p, e) => ({
      model: null,
      errors: [msg("ui.worker.buildFailed", { detail: errorMessageOf(e) })],
      timeMs: 0,
      mesh: null,
    }),
    onResult: (project, result) =>
      store.setState((s) => ({
        model: { ...result, project, pending: s.model.pending },
        // Hors geste, le modèle complet remplace l'aperçu.
        ...(s.gesture === null ? { preview: null } : {}),
      })),
    onPending: (pending) => store.setState((s) => ({ model: { ...s.model, pending } })),
  });

  const preview = createLatestRunner<Project, PreviewResult>({
    exec: (p) => exec.preview(p),
    onError: (_p, e) => ({
      siteFit: [],
      errors: [msg("ui.worker.buildFailed", { detail: errorMessageOf(e) })],
      timeMs: 0,
    }),
    onResult: (project, result) => {
      // Un aperçu reçu après la fin du geste n'est plus affiché (le modèle complet arrive).
      if (store.getState().gesture === null) return;
      store.setState({ preview: { project, result } });
    },
    publishStale: true,
    cacheSize: 4,
  });

  const compare = createLatestRunner<Project, CompareOutcome>({
    exec: (p) => compareExec.compare(p, variantsOf(p)),
    onError: (_p, e) => ({
      rows: [],
      timeMs: 0,
      error: msg("ui.worker.compareFailed", { detail: errorMessageOf(e) }),
    }),
    onResult: (project, outcome) =>
      store.setState((s) => ({ compare: { ...s.compare, project, outcome } })),
    onPending: (pending) => store.setState((s) => ({ compare: { ...s.compare, pending } })),
    cacheSize: 4,
  });

  return {
    store,
    request: (project) => {
      latest = project;
      const gesture = store.getState().gesture;
      if (gesture === null) build.submit(project);
      else if (gesture === "preview") preview.submit(project);
    },
    beginGesture: (mode) => {
      if (store.getState().gesture === mode) return;
      store.setState({ gesture: mode, preview: null });
    },
    endGesture: () => {
      if (store.getState().gesture === null) return;
      preview.cancel();
      store.setState({ gesture: null });
      // Modèle complet du dernier projet (en cache s'il n'a pas changé : publié aussitôt, ce
      // qui efface l'aperçu).
      if (latest !== undefined) build.submit(latest);
      else store.setState({ preview: null });
    },
    stats: () => ({
      builds: build.started,
      previews: preview.started,
      previewsPublished: preview.published,
    }),
    requestCompare: (project) => compare.submit(project),
    exportPdf: (project, pdfOptions, locale) => exec.pdf(project, pdfOptions, locale),
    exportGlb: (project, locale) => exec.glb(project, locale),
  };
}
