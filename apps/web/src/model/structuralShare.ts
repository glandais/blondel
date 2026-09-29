/**
 * Partage structurel d'un projet reçu par le worker de calcul.
 *
 * `postMessage` **clone** le projet : chaque demande arrive avec des objets neufs, et les caches
 * par étape de `buildModel` (comparaison par identité, `LastValueCache`) ne serviraient jamais
 * (tracé, balancement, structure… recalculés à chaque frappe). `shareUnchanged(prev, next)`
 * rend `next` en y remplaçant chaque sous-arbre égal (en profondeur) à celui de `prev` par
 * l'objet de `prev` : on retrouve les identités que le store du fil principal avait
 * conservées (projet immuable, copie sur écriture), et donc les succès de cache du cœur.
 *
 * Données JSON uniquement (objets simples, tableaux, primitifs) : c'est le cas d'un `Project`.
 */
export function shareUnchanged<T>(prev: T | undefined, next: T): T {
  if (prev === undefined) return next;
  return share(prev, next) as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Rend `next`, ou `prev` s'ils sont égaux en profondeur, avec partage des sous-arbres égaux. */
function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((v: unknown, i) => {
      const s = i < prev.length ? share(prev[i], v) : v;
      if (s !== prev[i]) same = false;
      return s;
    });
    return same ? prev : out;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const pk = Object.keys(prev);
    const nk = Object.keys(next);
    let same = pk.length === nk.length;
    const out: Record<string, unknown> = {};
    for (const k of nk) {
      const has = Object.prototype.hasOwnProperty.call(prev, k);
      const s = has ? share(prev[k], next[k]) : next[k];
      if (!has || s !== prev[k]) same = false;
      out[k] = s;
    }
    return same ? prev : out;
  }
  return next;
}
