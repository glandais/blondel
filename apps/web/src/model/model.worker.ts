/**
 * Web Worker de calcul (ADR-0006) : `buildModel` du cœur, maillage d'aperçu des pièces et
 * comparateur de variantes, hors du fil principal. Le fil principal ne garde que l'affichage ;
 * les demandes obsolètes sont écartées par le client (`workerClient.ts`, `latestRunner.ts`).
 *
 * Chargé par `new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" })`
 * (Vite l'empaquette dans son propre morceau).
 */
import { createJobRunner } from "./handler.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const scope = self as unknown as WorkerScope;
const runner = createJobRunner();

scope.onmessage = (e) => {
  const req = e.data;
  try {
    if (req.type === "build") {
      scope.postMessage({ id: req.id, type: "build", result: runner.build(req) });
    } else {
      scope.postMessage({ id: req.id, type: "compare", result: runner.compare(req) });
    }
  } catch (err) {
    // Sortie non clonable ou erreur inattendue : le client se replie sur le fil principal.
    scope.postMessage({
      id: req.id,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
