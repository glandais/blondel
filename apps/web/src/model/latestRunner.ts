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
 *
 * Option `publishStale` (aperçu de l'éditeur de plan, sous-lot 4c) : le résultat d'un calcul
 * devenu obsolète est **aussi** publié, s'il est plus récent que le dernier résultat publié
 * (ordre des demandes). Pendant un glisser, une demande arrive à chaque image : sans cette
 * option, chaque calcul serait obsolète avant de finir et rien ne serait affiché avant la fin du
 * geste ; avec elle, l'affichage garde le dernier aperçu reçu, en retard d'au plus une demande.
 * `cancel()` abandonne la demande en attente et ne publie plus rien jusqu'à la prochaine demande,
 * ni, ensuite, un calcul demandé avant l'abandon.
 */
export type Exec<I, O> = (input: I) => O | Promise<O>;

export interface LatestRunner<I> {
  /** Demande le résultat de `input` (publication par `onResult`). */
  submit(input: I): void;
  /** Un calcul est-il en cours ou en attente pour la dernière demande ? */
  readonly pending: boolean;
  /** Nombre de calculs lancés (statistiques, tests). */
  readonly started: number;
  /** Nombre de résultats publiés (statistiques, tests). */
  readonly published: number;
  /**
   * Abandon : la demande en attente n'est pas lancée, et le calcul en cours s'achève sans être
   * publié (il reste en cache).
   */
  cancel(): void;
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
  /** Publier aussi un résultat obsolète plus récent que le dernier publié (défaut : non). */
  readonly publishStale?: boolean;
}

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown } | null)?.then === "function";
}

export function createLatestRunner<I, O>(options: LatestRunnerOptions<I, O>): LatestRunner<I> {
  const { exec, onResult, onPending, onError } = options;
  const cacheSize = options.cacheSize ?? 8;
  const publishStale = options.publishStale === true;
  const cache = new Map<I, O>();
  let target: I | undefined;
  let hasTarget = false;
  let running = false;
  let current: I | undefined;
  /** Rang de la demande du calcul en cours (ordre des `submit`). */
  let currentSeq = 0;
  let next: { input: I; seq: number } | null = null;
  let pending = false;
  let started = 0;
  let published = 0;
  /** Rang de la dernière demande, et du dernier résultat publié. */
  let submitSeq = 0;
  let publishedSeq = 0;

  const publish = (input: I, output: O, seq: number): void => {
    publishedSeq = seq;
    published++;
    onResult(input, output);
  };

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

  const finish = (input: I, output: O, seq: number, cacheable = true): void => {
    if (cacheable) remember(input, output);
    running = false;
    if (hasTarget && target === input) {
      publish(input, output, seq);
    } else if (hasTarget && publishStale && seq > publishedSeq) {
      publish(input, output, seq);
    }
    const n = next;
    next = null;
    if (n) start(n.input, n.seq);
    else setPending(false);
  };

  const start = (input: I, seq: number): void => {
    running = true;
    current = input;
    currentSeq = seq;
    started++;
    let out: O | Promise<O>;
    try {
      out = exec(input);
    } catch (e) {
      finish(input, onError(input, e), seq, false);
      return;
    }
    if (isPromise(out)) {
      out.then(
        (o) => finish(input, o, currentSeq),
        (e: unknown) => finish(input, onError(input, e), currentSeq, false),
      );
    } else {
      finish(input, out, currentSeq);
    }
  };

  return {
    submit(input) {
      target = input;
      hasTarget = true;
      const seq = ++submitSeq;
      const hit = cache.get(input);
      if (hit !== undefined) {
        // Résultat connu : publié tout de suite ; la demande en attente devient inutile (un
        // calcul en cours s'achève sans être publié).
        cache.delete(input);
        cache.set(input, hit);
        next = null;
        setPending(false);
        publish(input, hit, seq);
        return;
      }
      setPending(true);
      if (running && current === input) {
        next = null; // déjà en cours de calcul
        currentSeq = seq;
      } else if (running) next = { input, seq };
      else start(input, seq);
    },
    cancel() {
      next = null;
      hasTarget = false;
      // Rien de ce qui a été demandé avant l'abandon ne peut plus être publié comme obsolète
      // (`publishStale`) : un calcul encore en cours s'achèverait sinon dans la demande suivante.
      publishedSeq = submitSeq;
      target = undefined;
      setPending(false);
    },
    get published() {
      return published;
    },
    get pending() {
      return pending;
    },
    get started() {
      return started;
    },
  };
}
