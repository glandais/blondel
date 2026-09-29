/**
 * Client du Web Worker de calcul : appels asynchrones numérotés, et repli **transparent** sur
 * le fil principal quand le worker est indisponible (pas de `Worker` sous Node ni dans un
 * navigateur ancien, échec de chargement du module, erreur de clonage). Le repli exécute le
 * même code (`handler.ts`) : seuls les temps de réponse changent.
 */
import type { Project } from "@blondel/core";
import type { CompareOutcome, Variant } from "../lib/variants.js";
import { createJobRunner, type JobRunner } from "./handler.js";
import type { PdfResult, WorkerJob, WorkerRequest, WorkerResponse } from "./protocol.js";
import type { ModelSnapshot } from "./snapshot.js";

/** Sous-ensemble de `Worker` utilisé (injectable dans les tests). */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((e: { readonly data: WorkerResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  /** Réponse impossible à désérialiser : sans ce gestionnaire, la demande resterait en attente. */
  onmessageerror?: ((e: unknown) => void) | null;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike | null;

export interface JobExec {
  build(project: Project): ModelSnapshot | Promise<ModelSnapshot>;
  compare(project: Project, variants: readonly Variant[]): CompareOutcome | Promise<CompareOutcome>;
  /**
   * Dossier PDF du projet, mis en page dans le worker (repli : fil principal). Rejette avec le
   * message de l'export si celui-ci échoue (sans basculer sur le fil principal).
   */
  pdf(project: Project): Promise<Uint8Array>;
  /** Le worker est-il utilisé (sinon : fil principal) ? */
  readonly usesWorker: boolean;
  dispose(): void;
}

/**
 * Exécutant de calculs : dans le worker créé (paresseusement) par `factory`, sinon sur le fil
 * principal par `fallback`. Une panne du worker (erreur de chargement, réponse « error ») bascule
 * définitivement sur le fil principal, la demande en cours comprise.
 */
export function createJobExec(
  factory: WorkerFactory,
  fallback: () => JobRunner = () => createJobRunner(),
): JobExec {
  let worker: WorkerLike | null | undefined;
  let broken = false;
  let local: JobRunner | undefined;
  let seq = 0;
  const waiting = new Map<
    number,
    { resolve: (r: WorkerResponse) => void; reject: (e: unknown) => void }
  >();

  const runLocal = (): JobRunner => (local ??= fallback());

  const fail = (e: unknown): void => {
    broken = true;
    worker?.terminate();
    worker = null;
    const all = [...waiting.values()];
    waiting.clear();
    for (const w of all) w.reject(e);
  };

  const getWorker = (): WorkerLike | null => {
    if (broken) return null;
    if (worker === undefined) {
      try {
        worker = factory();
      } catch {
        worker = null;
      }
      if (worker) {
        worker.onmessage = (e) => {
          const w = waiting.get(e.data.id);
          if (!w) return;
          waiting.delete(e.data.id);
          if (e.data.type === "error") w.reject(new Error(e.data.message));
          else w.resolve(e.data);
        };
        worker.onerror = (e) => fail(e);
        worker.onmessageerror = (e) => fail(e);
      } else {
        broken = true;
      }
    }
    return worker;
  };

  const call = (job: WorkerJob): Promise<WorkerResponse> | null => {
    const w = getWorker();
    if (!w) return null;
    const id = ++seq;
    return new Promise<WorkerResponse>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      try {
        w.postMessage({ ...job, id } as WorkerRequest);
      } catch (e) {
        waiting.delete(id);
        reject(e);
      }
    });
  };

  return {
    build(project) {
      const p = call({ type: "build", project });
      if (!p) return runLocal().build({ type: "build", project });
      return p.then(
        (r) => (r.type === "build" ? r.result : runLocal().build({ type: "build", project })),
        (e: unknown) => {
          if (!broken) fail(e);
          return runLocal().build({ type: "build", project });
        },
      );
    },
    compare(project, variants) {
      const job = { type: "compare", project, variants } as const;
      const p = call(job);
      if (!p) return runLocal().compare(job);
      return p.then(
        (r) => (r.type === "compare" ? r.result : runLocal().compare(job)),
        (e: unknown) => {
          if (!broken) fail(e);
          return runLocal().compare(job);
        },
      );
    },
    async pdf(project) {
      const job = { type: "pdf", project } as const;
      const p = call(job);
      let result: PdfResult;
      if (!p) result = await runLocal().pdf(job);
      else {
        result = await p.then(
          (r) => (r.type === "pdf" ? r.result : runLocal().pdf(job)),
          (e: unknown) => {
            if (!broken) fail(e);
            return runLocal().pdf(job);
          },
        );
      }
      if ("error" in result) throw new Error(result.error);
      return result.bytes;
    },
    get usesWorker() {
      return !broken && worker !== null;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      broken = true;
    },
  };
}

/**
 * Worker de calcul du navigateur (`null` sans `Worker`). L'expression `new Worker(new URL(…,
 * import.meta.url), { type: "module" })` doit rester littérale : Vite la détecte pour empaqueter
 * le worker.
 */
export function browserWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./model.worker.ts", import.meta.url), {
    type: "module",
    name: "blondel-calcul",
  }) as unknown as WorkerLike;
}
