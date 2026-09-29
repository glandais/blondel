/**
 * Web Worker **dédié** de l'assistant d'initialisation : un worker par recherche, terminé par
 * l'interface pour l'annuler (l'énumération est synchrone : un message d'annulation ne serait
 * lu qu'à la fin). Chargé par `new Worker(new URL("./assistant.worker.ts", import.meta.url))`.
 */
import type { AssistantInput } from "@blondel/core";
import { runAssistantJob, type AssistantOutcome } from "./assistantJob.js";

interface Scope {
  onmessage: ((e: MessageEvent<{ readonly input: AssistantInput }>) => void) | null;
  postMessage(message: { readonly outcome: AssistantOutcome } | { readonly error: string }): void;
}

const scope = self as unknown as Scope;
scope.onmessage = (e) => {
  try {
    scope.postMessage({ outcome: runAssistantJob(e.data.input) });
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
