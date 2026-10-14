/**
 * Regroupement de pièces identiques **au bruit d'arrondi près** (chantier `stable-tiebreaks`,
 * F10 (7) et (11)) : une clé exacte (repère, matériau…) puis une relation de proximité sur les
 * grandeurs calculées, comparées à une tolérance explicite. Jamais d'arrondi à un pas (deux
 * valeurs voisines de part et d'autre d'un seuil seraient séparées) : on compare des écarts.
 */

/**
 * Groupes d'éléments : même clé exacte, puis composantes connexes de la relation `near`
 * (lien simple, union-find) dans chaque clé. La partition ne dépend pas de l'ordre d'entrée ;
 * les groupes et leurs éléments suivent l'ordre de première apparition (le premier élément
 * d'un groupe est son représentant).
 */
export function groupNear<T>(
  items: readonly T[],
  exactKey: (item: T) => string,
  near: (a: T, b: T) => boolean,
): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const buckets = new Map<string, number[]>();
  items.forEach((item, i) => {
    const key = exactKey(item);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [i]);
      return;
    }
    for (const j of bucket) {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj && near(items[j]!, item)) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
    bucket.push(i);
  });
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(item);
    else groups.set(root, [item]);
  });
  // La racine est le plus petit indice du groupe : `groups` suit l'ordre de première apparition.
  return [...groups.values()];
}

/**
 * Égalité structurelle à `eps` près sur les nombres : mêmes clés (une clé de valeur
 * `undefined` vaut une clé absente, comme pour `JSON.stringify`), tableaux de même longueur,
 * chaînes, booléens et `null` égaux, nombres à `eps` près en absolu (deux non-finis égaux
 * seulement s'ils sont identiques).
 */
export function nearlyEqualDeep(a: unknown, b: unknown, eps: number): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= eps;
    return Object.is(a, b);
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as readonly unknown[];
    return a.length === bb.length && a.every((x, i) => nearlyEqualDeep(x, bb[i], eps));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => rb[k] !== undefined && nearlyEqualDeep(ra[k], rb[k], eps));
}

/**
 * Deux grandeurs dérivées (volume, masse) égales à la tolérance relative `rel` près
 * (|a − b| ≤ rel · max(|a|, |b|)) ; l'absence de valeur n'est égale qu'à l'absence.
 */
export function nearlyEqualRelative(
  a: number | undefined,
  b: number | undefined,
  rel: number,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
}
