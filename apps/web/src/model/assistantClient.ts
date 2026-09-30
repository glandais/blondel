/**
 * Client de l'assistant : une recherche = un worker dédié, **annulable** (le worker est terminé).
 * Sans `Worker` (tests sous Node, navigateur ancien) ou si le worker ne se charge pas, le calcul
 * se fait sur le fil principal (après une tâche, pour laisser l'interface afficher l'attente) ;
 * l'annulation écarte alors seulement le résultat.
 */
import { MessageError, isMessage, msg, textMessage, type Message } from "@blondel/i18n";
import type { AssistantInput } from "@blondel/core";
import type { CandidateSketch } from "../lib/assistant.js";
import {
  runAssistantJob,
  runSketchJob,
  type AssistantOutcome,
  type SketchRequest,
} from "./assistantJob.js";

/** Message au worker : recherche complète, ou croquis de variantes dépliées. */
export type AssistantRequest =
  { readonly input: AssistantInput } | { readonly sketches: readonly SketchRequest[] };

/** Réponse du worker (erreur : `Message`, traduit à l'affichage). */
export type AssistantResponse =
  | { readonly outcome: AssistantOutcome }
  | { readonly sketches: Readonly<Record<string, CandidateSketch>> }
  | { readonly error: Message | string };

/** Sous-ensemble de `Worker` utilisé (injectable dans les tests). */
export interface AssistantWorkerLike {
  postMessage(message: AssistantRequest): void;
  onmessage: ((e: { readonly data: AssistantResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

export type AssistantWorkerFactory = () => AssistantWorkerLike | null;

/** Recherche annulée par l'utilisateur. */
export class AssistantCancelled extends MessageError {
  constructor() {
    super(msg("ui.worker.assistantCancelled"));
    this.name = "AssistantCancelled";
  }
}

/** Calcul annulable, dans un worker dédié ou sur le fil principal. */
export interface Job<T> {
  readonly promise: Promise<T>;
  /** Annule le calcul (worker terminé) ; la promesse est rejetée par `AssistantCancelled`. */
  cancel(): void;
  /** Le calcul tourne-t-il dans un worker ? */
  readonly usesWorker: boolean;
}

export type AssistantRun = Job<AssistantOutcome>;

export interface AssistantClientOptions {
  readonly factory?: AssistantWorkerFactory;
  /** Calcul de repli (fil principal) ; injectable dans les tests. */
  readonly local?: (input: AssistantInput) => AssistantOutcome;
}

/**
 * Lance `message` dans un worker dédié (terminé à la réponse ou à l'annulation) ; sans worker ou
 * s'il ne se charge pas, `local` sur le fil principal, après une tâche.
 */
function startJob<T>(
  message: AssistantRequest,
  read: (data: AssistantResponse) => T | Error,
  local: () => T,
  factory: AssistantWorkerFactory,
): Job<T> {
  let settled = false;
  let reject!: (e: unknown) => void;
  let resolve!: (o: T) => void;
  const promise = new Promise<T>((res, rej) => {
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
        resolve(local());
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
      const r = read(e.data);
      if (r instanceof Error) reject(r);
      else resolve(r);
    };
    w.onerror = () => {
      // Worker introuvable ou en panne : repli sur le fil principal.
      w.terminate();
      runLocal();
    };
    try {
      w.postMessage(message);
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

const unexpected = (): Error => new MessageError(msg("ui.worker.assistantUnexpected"));

/** Erreur rendue par le worker : `MessageError` (son `msg` suit la langue de l'interface). */
const workerError = (e: Message | string): Error =>
  new MessageError(isMessage(e) ? e : textMessage(e));

export function startAssistant(
  input: AssistantInput,
  options: AssistantClientOptions = {},
): AssistantRun {
  const local = options.local ?? ((i: AssistantInput) => runAssistantJob(i));
  return startJob(
    { input },
    (d) => ("outcome" in d ? d.outcome : "error" in d ? workerError(d.error) : unexpected()),
    () => local(input),
    options.factory ?? browserAssistantWorker,
  );
}

export interface SketchClientOptions {
  readonly factory?: AssistantWorkerFactory;
  readonly local?: (
    requests: readonly SketchRequest[],
  ) => Readonly<Record<string, CandidateSketch>>;
}

/**
 * Croquis des variantes d'une forme, demandés à son dépliage (QUESTIONS D5) : un worker dédié,
 * comme la recherche, pour ne pas construire de modèle sur le fil principal.
 */
export function startSketches(
  requests: readonly SketchRequest[],
  options: SketchClientOptions = {},
): Job<Readonly<Record<string, CandidateSketch>>> {
  const local = options.local ?? runSketchJob;
  return startJob(
    { sketches: requests },
    (d) => ("sketches" in d ? d.sketches : "error" in d ? workerError(d.error) : unexpected()),
    () => local(requests),
    options.factory ?? browserAssistantWorker,
  );
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
