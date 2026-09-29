/**
 * Exécution « dernier demandé seulement » d'un calcul coûteux (ADR-0006, Web Worker) :
 *
 * - une seule exécution à la fois ; une demande faite pendant un calcul **remplace** la demande
 *   en attente (les demandes intermédiaires ne sont jamais calculées : calculs obsolètes
 *   annulés avant leur départ) ;
 * - le résultat d'un calcul devenu obsolète (une autre entrée a été demandée entre-temps) est
 *   conservé dans le cache mais **pas** publié ;
 * - cache LRU par identité de l'entrée (projet immuable) : annuler / rétablir republie aussitôt
 *   un résultat déjà calculé, sans solliciter le calcul. Un résultat de repli (`onError` :
 *   exception, rejet, chien de garde du worker) n'est **pas** mis en cache : la panne peut être
 *   passagère (machine chargée), revenir à l'entrée relance le calcul.
 *
 * `exec` peut être synchrone (repli sur le fil principal, tests) ou asynchrone (worker).
 */
export type Exec<I, O> = (input: I) => O | Promise<O>;

export interface LatestRunner<I> {
  /** Demande le résultat de `input` (publication par `onResult`). */
  submit(input: I): void;
  /** Un calcul est-il en cours ou en attente pour la dernière demande ? */
  readonly pending: boolean;
  /** Nombre de calculs lancés (statistiques, tests). */
  readonly started: number;
}

export interface LatestRunnerOptions<I, O> {
  readonly exec: Exec<I, O>;
  /** Publication d'un résultat à jour (celui de la dernière demande). */
  readonly onResult: (input: I, output: O) => void;
  /** Changement de l'état « en cours ». */
  readonly onPending?: (pending: boolean) => void;
  /** Résultat de repli si `exec` échoue (rejet de la promesse ou exception). */
  readonly onError: (input: I, error: unknown) => O;
  /** Taille du cache LRU (défaut 8, 0 = pas de cache). */
  readonly cacheSize?: number;
}

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown } | null)?.then === "function";
}

export function createLatestRunner<I, O>(options: LatestRunnerOptions<I, O>): LatestRunner<I> {
  const { exec, onResult, onPending, onError } = options;
  const cacheSize = options.cacheSize ?? 8;
  const cache = new Map<I, O>();
  let target: I | undefined;
  let hasTarget = false;
  let running = false;
  let current: I | undefined;
  let next: { input: I } | null = null;
  let pending = false;
  let started = 0;

  const setPending = (p: boolean): void => {
    if (p === pending) return;
    pending = p;
    onPending?.(p);
  };

  const remember = (input: I, output: O): void => {
    if (cacheSize <= 0) return;
    cache.delete(input);
    cache.set(input, output);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const finish = (input: I, output: O, cacheable = true): void => {
    if (cacheable) remember(input, output);
    running = false;
    if (hasTarget && target === input) {
      onResult(input, output);
    }
    const n = next;
    next = null;
    if (n) start(n.input);
    else setPending(false);
  };

  const start = (input: I): void => {
    running = true;
    current = input;
    started++;
    let out: O | Promise<O>;
    try {
      out = exec(input);
    } catch (e) {
      finish(input, onError(input, e), false);
      return;
    }
    if (isPromise(out)) {
      out.then(
        (o) => finish(input, o),
        (e: unknown) => finish(input, onError(input, e), false),
      );
    } else {
      finish(input, out);
    }
  };

  return {
    submit(input) {
      target = input;
      hasTarget = true;
      const hit = cache.get(input);
      if (hit !== undefined) {
        // Résultat connu : publié tout de suite ; la demande en attente devient inutile (un
        // calcul en cours s'achève sans être publié).
        cache.delete(input);
        cache.set(input, hit);
        next = null;
        setPending(false);
        onResult(input, hit);
        return;
      }
      setPending(true);
      if (running && current === input)
        next = null; // déjà en cours de calcul
      else if (running) next = { input };
      else start(input);
    },
    get pending() {
      return pending;
    },
    get started() {
      return started;
    },
  };
}
