/**
 * Web Worker **dédié** de l'assistant d'initialisation : un worker par recherche, terminé par
 * l'interface pour l'annuler (l'énumération est synchrone : un message d'annulation ne serait
 * lu qu'à la fin). Chargé par `new Worker(new URL("./assistant.worker.ts", import.meta.url))`.
 */
import type { AssistantInput } from "@blondel/core";
import { errorMessage, type Message } from "@blondel/i18n";
import type { CandidateSketch } from "../lib/assistant.js";
import {
  runAssistantJob,
  runSketchJob,
  type AssistantOutcome,
  type SketchRequest,
} from "./assistantJob.js";

type Request = { readonly input: AssistantInput } | { readonly sketches: readonly SketchRequest[] };
type Response =
  | { readonly outcome: AssistantOutcome }
  | { readonly sketches: Readonly<Record<string, CandidateSketch>> }
  | { readonly error: Message };

interface Scope {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: Response): void;
}

const scope = self as unknown as Scope;
scope.onmessage = (e) => {
  try {
    const data = e.data;
    // Croquis des variantes dépliées (à la demande) ou recherche complète.
    scope.postMessage(
      "sketches" in data
        ? { sketches: runSketchJob(data.sketches) }
        : { outcome: runAssistantJob(data.input) },
    );
  } catch (err) {
    // `Message` (clonable) : traduit à l'affichage, dans la langue courante.
    scope.postMessage({ error: errorMessage(err) });
  }
};
