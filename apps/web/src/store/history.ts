/**
 * Historique d'annulation par pile de snapshots (ADR-0005). Fonctions pures sur un état
 * immuable : les snapshots partagent leur structure (le `Project` n'est jamais muté), le coût
 * mémoire reste négligeable.
 *
 * Regroupement : une modification portant la même clé de groupe que la précédente, dans le
 * délai `groupWindowMs`, remplace l'état présent au lieu d'empiler un snapshot (glisser un
 * curseur ou taper un nombre = une seule entrée). `endGroup` clôt le groupe courant (perte de
 * focus d'un champ).
 */

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** Groupe ouvert : clé et instant de la dernière modification regroupée. */
  readonly group: { readonly key: string; readonly at: number } | null;
}

export interface HistoryOptions {
  /** Nombre maximal de snapshots conservés dans `past`. */
  readonly limit: number;
  /** Délai de regroupement des modifications continues (ms). */
  readonly groupWindowMs: number;
}

export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = { limit: 200, groupWindowMs: 1000 };

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], group: null };
}

export interface CommitOptions {
  /** Clé de regroupement (ex. chemin du champ édité) ; absente = entrée distincte. */
  readonly groupKey?: string;
  /** Instant de la modification (ms), pour le regroupement. */
  readonly now: number;
  /**
   * Geste continu (glisser une poignée) : regroupé avec la modification précédente de même clé
   * **quel que soit le délai** écoulé, jusqu'à `endGroup` (fin du geste).
   */
  readonly sticky?: boolean;
}

/**
 * Enregistre un nouvel état. Un état identique (même référence) n'est pas enregistré.
 * La pile `future` est vidée (nouvelle branche).
 */
export function commit<T>(
  h: History<T>,
  next: T,
  opts: CommitOptions,
  options: HistoryOptions = DEFAULT_HISTORY_OPTIONS,
): History<T> {
  if (Object.is(next, h.present)) return h;
  const key = opts.groupKey;
  const grouped =
    key !== undefined &&
    h.group !== null &&
    h.group.key === key &&
    (opts.sticky === true ||
      (opts.now - h.group.at <= options.groupWindowMs && opts.now >= h.group.at));
  const group = key === undefined ? null : { key, at: opts.now };
  if (grouped) {
    return { past: h.past, present: next, future: [], group };
  }
  const past = [...h.past, h.present];
  if (past.length > options.limit) past.splice(0, past.length - options.limit);
  return { past, present: next, future: [], group };
}

/** Remplace l'état sans entrée d'historique et vide l'historique (chargement, import). */
export function reset<T>(present: T): History<T> {
  return initHistory(present);
}

export function endGroup<T>(h: History<T>): History<T> {
  return h.group === null ? h : { ...h, group: null };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev as T,
    future: [h.present, ...h.future],
    group: null,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const next = h.future[0] as T;
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
    group: null,
  };
}
