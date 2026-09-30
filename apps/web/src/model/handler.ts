/**
 * Traitement des calculs du worker, partagé avec le repli sur le fil principal (navigateur sans
 * Web Worker, tests sous Node) : même code, mêmes résultats.
 */
import { errorMessageOf, type Project } from "@blondel/core";
import { DEFAULT_LOCALE, MessageError, msg, type Message } from "@blondel/i18n";
import { exportGlb } from "@blondel/exports";
import { loadExportPdf, type ExportPdfFn } from "../lib/optionalApi.js";
import { runVariants, type CompareOutcome } from "../lib/variants.js";
import { computeModel } from "./buildModel.js";
import { createMeshCache, type MeshCache } from "./meshCache.js";
import type { GlbResult, PdfResult, WorkerJob, WorkerRequest, WorkerResponse } from "./protocol.js";
import { computeSnapshot, type ModelSnapshot } from "./snapshot.js";
import { shareUnchanged } from "./structuralShare.js";

export interface JobRunner {
  build(job: Extract<WorkerJob, { type: "build" }>): ModelSnapshot;
  compare(job: Extract<WorkerJob, { type: "compare" }>): CompareOutcome;
  /**
   * Dossier PDF du projet (`@blondel/exports/pdf`, chargé à la première demande). La mise en
   * page du dossier (cotation, textes, développés) prend plusieurs centaines de millisecondes :
   * dans le worker, elle ne fige plus l'interface. Ne lève jamais.
   */
  pdf(job: Extract<WorkerJob, { type: "pdf" }>): Promise<PdfResult>;
  /**
   * Modèle 3D glTF binaire (`exportGlb` de `@blondel/exports` : maillage de toutes les pièces,
   * plusieurs dizaines de millisecondes) ; ne lève jamais.
   */
  glb(job: Extract<WorkerJob, { type: "glb" }>): GlbResult;
}

/** Motif d'un export sans modèle (`Message`, traduit à l'affichage). */
function noModel(errors: readonly Message[]): Message {
  return errors[0] ?? msg("ui.label.export.noModel");
}

/**
 * Motif d'un export en échec (`Message`, traduit à l'affichage : exception métier du cœur ou
 * des exports : son `Message` ; autre exception : son texte brut).
 */
function failureText(e: unknown): Message {
  return errorMessageOf(e);
}

export interface JobRunnerOptions {
  readonly meshCache?: MeshCache;
  /** Chargement de `exportPdf` (injectable dans les tests). */
  readonly loadPdf?: () => Promise<ExportPdfFn>;
}

/** Octets d'un contenu de fichier (`FileContent` : octets, tampon, texte ou `Blob`). */
export async function toBytes(content: unknown): Promise<Uint8Array> {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (typeof Blob !== "undefined" && content instanceof Blob) {
    return new Uint8Array(await content.arrayBuffer());
  }
  throw new MessageError(msg("ui.worker.unexpectedPdf"));
}

/**
 * Exécutant de calculs avec son propre cache de maillage (un par worker). Le projet reçu (cloné
 * par `postMessage`) partage ses sous-arbres inchangés avec le précédent (`shareUnchanged`) :
 * sans cela, les caches par identité de `buildModel` ne serviraient jamais dans le worker.
 */
export function createJobRunner(options: JobRunnerOptions = {}): JobRunner {
  const meshCache = options.meshCache ?? createMeshCache();
  const loadPdf = options.loadPdf ?? loadExportPdf;
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
    pdf: async (job) => {
      try {
        // Le projet exporté est en général celui du dernier modèle calculé : le partage
        // structurel retrouve les identités, et `buildModel` (mémoïsé) rend son modèle.
        const project = shareUnchanged(lastBuild, job.project);
        const locale = job.locale ?? DEFAULT_LOCALE;
        const { model, errors } = computeModel(project);
        if (!model) return { error: noModel(errors) };
        const exportPdf = await loadPdf();
        const content = await exportPdf(model, {
          project,
          title: project.name,
          locale,
          ...(job.options?.pages ? { pages: job.options.pages } : {}),
          ...(job.options?.format ? { format: job.options.format } : {}),
          ...(job.options?.templateFamilies
            ? { templateFamilies: job.options.templateFamilies }
            : {}),
        });
        return { bytes: await toBytes(content) };
      } catch (e) {
        return { error: failureText(e) };
      }
    },
    glb: (job) => {
      try {
        const project = shareUnchanged(lastBuild, job.project);
        const locale = job.locale ?? DEFAULT_LOCALE;
        const { model, errors } = computeModel(project);
        if (!model) return { error: noModel(errors) };
        return { bytes: exportGlb(model, { project, title: project.name, locale }) };
      } catch (e) {
        return { error: failureText(e) };
      }
    },
  };
}

/** Envoi d'une réponse du worker (`postMessage`, avec les tampons transférés). */
export type PostResponse = (message: WorkerResponse, transfer: Transferable[]) => void;

function failure(id: number, err: unknown): WorkerResponse {
  return { id, type: "error", message: err instanceof Error ? err.message : String(err) };
}

/**
 * Traite une requête du worker et poste sa réponse. Toute erreur — calcul, ou `postMessage`
 * impossible (sortie non clonable, tampon non transférable) — est rendue en réponse « error »,
 * y compris pour le PDF asynchrone : sans cela, la demande resterait en attente pour toujours
 * côté client (menu « Exporter » occupé indéfiniment). Le client se replie alors sur le fil
 * principal.
 */
export function handleWorkerRequest(
  runner: JobRunner,
  req: WorkerRequest,
  post: PostResponse,
): void {
  const fail = (err: unknown): void => post(failure(req.id, err), []);
  try {
    if (req.type === "pdf") {
      // Octets transférés (pas de copie) ; un échec de l'export est rendu dans le résultat.
      runner
        .pdf(req)
        .then((result) =>
          post(
            { id: req.id, type: "pdf", result },
            "bytes" in result ? [result.bytes.buffer as ArrayBuffer] : [],
          ),
        )
        .catch(fail);
    } else if (req.type === "glb") {
      const result = runner.glb(req);
      post(
        { id: req.id, type: "glb", result },
        "bytes" in result ? [result.bytes.buffer as ArrayBuffer] : [],
      );
    } else if (req.type === "build") {
      post({ id: req.id, type: "build", result: runner.build(req) }, []);
    } else {
      post({ id: req.id, type: "compare", result: runner.compare(req) }, []);
    }
  } catch (err) {
    fail(err);
  }
}
