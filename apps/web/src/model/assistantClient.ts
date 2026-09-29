/**
 * Client de l'assistant : une recherche = un worker dédié, **annulable** (le worker est terminé).
 * Sans `Worker` (tests sous Node, navigateur ancien) ou si le worker ne se charge pas, le calcul
 * se fait sur le fil principal (après une tâche, pour laisser l'interface afficher l'attente) ;
 * l'annulation écarte alors seulement le résultat.
 */
import type { AssistantInput } from "@blondel/core";
import { runAssistantJob, type AssistantOutcome } from "./assistantJob.js";

/** Sous-ensemble de `Worker` utilisé (injectable dans les tests). */
export interface AssistantWorkerLike {
  postMessage(message: { readonly input: AssistantInput }): void;
  onmessage:
    | ((e: {
        readonly data: { readonly outcome: AssistantOutcome } | { readonly error: string };
      }) => void)
    | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

export type AssistantWorkerFactory = () => AssistantWorkerLike | null;

/** Recherche annulée par l'utilisateur. */
export class AssistantCancelled extends Error {
  constructor() {
    super("Recherche annulée.");
    this.name = "AssistantCancelled";
  }
}

export interface AssistantRun {
  readonly promise: Promise<AssistantOutcome>;
  /** Annule la recherche (worker terminé) ; la promesse est rejetée par `AssistantCancelled`. */
  cancel(): void;
  /** Le calcul tourne-t-il dans un worker ? */
  readonly usesWorker: boolean;
}

export interface AssistantClientOptions {
  readonly factory?: AssistantWorkerFactory;
  /** Calcul de repli (fil principal) ; injectable dans les tests. */
  readonly local?: (input: AssistantInput) => AssistantOutcome;
}

export function startAssistant(
  input: AssistantInput,
  options: AssistantClientOptions = {},
): AssistantRun {
  const factory = options.factory ?? browserAssistantWorker;
  const local = options.local ?? ((i: AssistantInput) => runAssistantJob(i));
  let settled = false;
  let reject!: (e: unknown) => void;
  let resolve!: (o: AssistantOutcome) => void;
  const promise = new Promise<AssistantOutcome>((res, rej) => {
    resolve = (o) => {
      if (settled) return;
      settled = true;
      res(o);
    };
    reject = (e) => {
      if (settled) return;
      settled = true;
      rej(e);
    };
  });

  const runLocal = (): void => {
    setTimeout(() => {
      if (settled) return;
      try {
        resolve(local(input));
      } catch (e) {
        reject(e);
      }
    }, 0);
  };

  let worker: AssistantWorkerLike | null = null;
  try {
    worker = factory();
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    w.onmessage = (e) => {
      w.terminate();
      if ("outcome" in e.data) resolve(e.data.outcome);
      else reject(new Error(e.data.error));
    };
    w.onerror = () => {
      // Worker introuvable ou en panne : repli sur le fil principal.
      w.terminate();
      runLocal();
    };
    try {
      w.postMessage({ input });
    } catch {
      w.terminate();
      runLocal();
    }
  } else {
    runLocal();
  }

  return {
    promise,
    usesWorker: worker !== null,
    cancel() {
      worker?.terminate();
      reject(new AssistantCancelled());
    },
  };
}

/**
 * Worker de l'assistant (`null` sans `Worker`). L'expression `new Worker(new URL(…,
 * import.meta.url), { type: "module" })` doit rester littérale (détectée par Vite).
 */
export function browserAssistantWorker(): AssistantWorkerLike | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./assistant.worker.ts", import.meta.url), {
    type: "module",
    name: "blondel-assistant",
  }) as unknown as AssistantWorkerLike;
}
