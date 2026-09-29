/**
 * Client du Web Worker de calcul : appels asynchrones numérotés, et repli **transparent** sur
 * le fil principal quand le worker est indisponible (pas de `Worker` sous Node ni dans un
 * navigateur ancien, échec de chargement du module, erreur de clonage). Le repli exécute le
 * même code (`handler.ts`) : seuls les temps de réponse changent. Chien de garde : un calcul
 * sans réponse au bout de `watchdogMs` (20 s par défaut) fait terminer et recréer le worker,
 * puis relancer la demande (QUESTIONS A21).
 */
import type { Project } from "@blondel/core";
import type { CompareOutcome, Variant } from "../lib/variants.js";
import { createJobRunner, type JobRunner } from "./handler.js";
import type { PdfJobOptions } from "../lib/optionalApi.js";
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
  pdf(project: Project, options?: PdfJobOptions): Promise<Uint8Array>;
  /** Modèle 3D glTF binaire, dans le worker (repli : fil principal) ; rejette si l'export échoue. */
  glb(project: Project): Promise<Uint8Array>;
  /** Le worker est-il utilisé (sinon : fil principal) ? */
  readonly usesWorker: boolean;
  /** Workers remplacés par le chien de garde (statistiques, tests). */
  readonly restarts?: number;
  dispose(): void;
}

/** Délai par défaut du chien de garde du calcul (ms) : QUESTIONS A21, à confirmer. */
export const DEFAULT_WATCHDOG_MS = 20_000;

/**
 * Calcul abandonné par le chien de garde : le worker n'a pas répondu dans le délai, même après
 * avoir été recréé. Jamais de repli sur le fil principal dans ce cas (le même calcul y
 * figerait l'interface).
 */
export class WatchdogTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly restarts: number,
  ) {
    super(
      `Calcul interrompu : aucune réponse en ${Math.round(timeoutMs / 1000)} s` +
        (restarts > 0 ? ` (relancé ${restarts} fois dans un nouveau worker)` : "") +
        ". Modifiez un paramètre pour relancer le calcul.",
    );
    this.name = "WatchdogTimeoutError";
  }
}

export interface JobExecOptions {
  /** Exécution sur le fil principal (repli) ; défaut : `createJobRunner()`. */
  readonly fallback?: () => JobRunner;
  /**
   * Chien de garde (QUESTIONS A21, appliqué par défaut) : délai de réponse du worker (ms) au-delà
   * duquel le worker est terminé, un nouveau worker créé et la demande relancée. Le délai court
   * à partir du moment où la demande est en tête de file du worker (réponse reçue à toutes les
   * demandes envoyées avant elle), pas de son envoi. Défaut
   * `DEFAULT_WATCHDOG_MS` (20 s) ; 0 ou `Infinity` : désactivé.
   */
  readonly watchdogMs?: number;
  /** Relances d'une même demande après expiration du délai (défaut 1) ; ensuite, rejet. */
  readonly watchdogRetries?: number;
  /** Demandes surveillées (défaut : `build` et `compare` ; les exports peuvent être longs). */
  readonly watchdogJobs?: readonly WorkerJob["type"][];
}

interface Waiting {
  readonly job: WorkerJob;
  readonly resolve: (r: WorkerResponse) => void;
  readonly reject: (e: unknown) => void;
  /** Relances déjà faites pour cette demande (délai expiré). */
  restarts: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Exécutant de calculs : dans le worker créé (paresseusement) par `factory`, sinon sur le fil
 * principal par `fallback`. Une panne du worker (erreur de chargement, réponse « error ») bascule
 * définitivement sur le fil principal, la demande en cours comprise. Un calcul qui dépasse le
 * délai du chien de garde n'est pas une panne : le worker est remplacé et la demande relancée,
 * puis rejetée (`WatchdogTimeoutError`) si elle expire encore.
 */
export function createJobExec(
  factory: WorkerFactory,
  fallbackOrOptions: (() => JobRunner) | JobExecOptions = {},
): JobExec {
  const options: JobExecOptions =
    typeof fallbackOrOptions === "function" ? { fallback: fallbackOrOptions } : fallbackOrOptions;
  const fallback = options.fallback ?? (() => createJobRunner());
  const watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  const watchdogOn = watchdogMs > 0 && Number.isFinite(watchdogMs);
  const retries = Math.max(0, options.watchdogRetries ?? 1);
  const watched = new Set(options.watchdogJobs ?? ["build", "compare"]);
  let worker: WorkerLike | null | undefined;
  let broken = false;
  let local: JobRunner | undefined;
  let seq = 0;
  let restartCount = 0;
  const waiting = new Map<number, Waiting>();

  const runLocal = (): JobRunner => (local ??= fallback());

  const disarm = (w: Waiting): void => {
    if (w.timer !== undefined) clearTimeout(w.timer);
    delete w.timer;
  };

  const fail = (e: unknown): void => {
    broken = true;
    worker?.terminate();
    worker = null;
    const all = [...waiting.values()];
    waiting.clear();
    for (const w of all) {
      disarm(w);
      w.reject(e);
    }
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
        const self = worker;
        // Un worker remplacé par le chien de garde ne répond plus à personne.
        self.onmessage = (e) => {
          if (worker !== self) return;
          const w = waiting.get(e.data.id);
          if (!w) return;
          waiting.delete(e.data.id);
          disarm(w);
          if (e.data.type === "error") w.reject(new Error(e.data.message));
          else w.resolve(e.data);
          armHead();
        };
        self.onerror = (e) => {
          if (worker === self) fail(e);
        };
        self.onmessageerror = (e) => {
          if (worker === self) fail(e);
        };
      } else {
        broken = true;
      }
    }
    return worker;
  };

  /**
   * Arme le chien de garde de la demande en **tête de file** (la plus ancienne sans réponse),
   * si elle est surveillée. Le worker traite ses messages dans l'ordre : une demande en file
   * derrière une autre (ex. un calcul demandé pendant un export PDF long, non surveillé) n'a
   * pas commencé ; son délai ne court qu'à partir de la réponse à la précédente. Sinon, un
   * export de plus de `watchdogMs` ferait terminer le worker (et recommencer l'export) pour un
   * calcul qui n'a jamais démarré. Limite : pendant les attentes asynchrones d'un export PDF,
   * le worker peut traiter un calcul arrivé derrière lui ; ce calcul n'est alors surveillé
   * qu'après la réponse à l'export.
   */
  const armHead = (): void => {
    if (!watchdogOn) return;
    const head = waiting.entries().next();
    if (head.done === true) return;
    const [id, w] = head.value;
    if (w.timer === undefined && watched.has(w.job.type)) {
      w.timer = setTimeout(() => expire(id), watchdogMs);
    }
  };

  /** Envoie (ou renvoie) une demande au worker courant. */
  const post = (id: number, w: Waiting): boolean => {
    const target = getWorker();
    if (!target) return false;
    try {
      target.postMessage({ ...w.job, id } as WorkerRequest);
    } catch (e) {
      waiting.delete(id);
      w.reject(e);
    }
    return true;
  };

  /**
   * Délai dépassé pour la demande `id` : le worker est terminé et remplacé ; la demande est
   * relancée si elle a encore droit à une relance (sinon rejetée), et les autres demandes en
   * cours dans ce worker sont renvoyées au nouveau.
   */
  const expire = (id: number): void => {
    const late = waiting.get(id);
    if (!late) return;
    delete late.timer;
    worker?.terminate();
    worker = undefined;
    restartCount++;
    const all = [...waiting.entries()];
    for (const [, w] of all) disarm(w);
    late.restarts++;
    if (late.restarts > retries) {
      waiting.delete(id);
      late.reject(new WatchdogTimeoutError(watchdogMs, late.restarts - 1));
    }
    for (const [key, w] of all) {
      if (!waiting.has(key)) continue;
      if (!post(key, w)) {
        // Nouveau worker impossible : même traitement qu'une panne (repli sur le fil principal).
        fail(new Error("Worker de calcul impossible à recréer"));
        return;
      }
    }
    armHead();
  };

  const call = (job: WorkerJob): Promise<WorkerResponse> | null => {
    if (!getWorker()) return null;
    const id = ++seq;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const w: Waiting = { job, resolve, reject, restarts: 0 };
      waiting.set(id, w);
      if (!post(id, w)) {
        waiting.delete(id);
        reject(new Error("Worker de calcul indisponible"));
        return;
      }
      armHead();
    });
  };

  /** Rejet d'une demande : chien de garde → propagé ; autre → panne, repli sur le fil principal. */
  const recover = <T>(e: unknown, onMainThread: () => T): T => {
    if (e instanceof WatchdogTimeoutError) throw e;
    if (!broken) fail(e);
    return onMainThread();
  };

  return {
    build(project) {
      const p = call({ type: "build", project });
      if (!p) return runLocal().build({ type: "build", project });
      return p.then(
        (r) => (r.type === "build" ? r.result : runLocal().build({ type: "build", project })),
        (e: unknown) => recover(e, () => runLocal().build({ type: "build", project })),
      );
    },
    compare(project, variants) {
      const job = { type: "compare", project, variants } as const;
      const p = call(job);
      if (!p) return runLocal().compare(job);
      return p.then(
        (r) => (r.type === "compare" ? r.result : runLocal().compare(job)),
        (e: unknown) => recover(e, () => runLocal().compare(job)),
      );
    },
    async pdf(project, options) {
      const job = { type: "pdf", project, ...(options ? { options } : {}) } as const;
      const p = call(job);
      let result: PdfResult;
      if (!p) result = await runLocal().pdf(job);
      else {
        result = await p.then(
          (r) => (r.type === "pdf" ? r.result : runLocal().pdf(job)),
          (e: unknown) => recover(e, () => runLocal().pdf(job)),
        );
      }
      if ("error" in result) throw new Error(result.error);
      return result.bytes;
    },
    async glb(project) {
      const job = { type: "glb", project } as const;
      const p = call(job);
      let result: PdfResult;
      if (!p) result = runLocal().glb(job);
      else {
        result = await p.then(
          (r) => (r.type === "glb" ? r.result : runLocal().glb(job)),
          (e: unknown) => recover(e, () => runLocal().glb(job)),
        );
      }
      if ("error" in result) throw new Error(result.error);
      return result.bytes;
    },
    get usesWorker() {
      return !broken && worker !== null;
    },
    get restarts() {
      return restartCount;
    },
    dispose() {
      for (const w of waiting.values()) disarm(w);
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
