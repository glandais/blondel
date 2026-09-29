/**
 * Web Worker de calcul (ADR-0006) : `buildModel` du cœur, maillage d'aperçu des pièces,
 * comparateur de variantes et dossier PDF, hors du fil principal. Le fil principal ne garde
 * que l'affichage ; les demandes obsolètes sont écartées par le client (`workerClient.ts`,
 * `latestRunner.ts`).
 *
 * Chargé par `new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" })`
 * (Vite l'empaquette dans son propre morceau).
 */
import { createJobRunner, handleWorkerRequest } from "./handler.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const runner = createJobRunner();

// Réponses et erreurs (sortie non clonable comprise) : `handleWorkerRequest` ; une réponse
// « error » fait replier le client sur le fil principal.
scope.onmessage = (e) =>
  handleWorkerRequest(runner, e.data, (message, transfer) => scope.postMessage(message, transfer));
