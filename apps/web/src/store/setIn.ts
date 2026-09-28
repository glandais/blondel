/**
 * Mise à jour immuable par chemin : copie les seuls objets et tableaux traversés (partage
 * structurel), sans muter l'entrée. Sert à l'édition des champs du projet.
 */

export type Path = readonly (string | number)[];

export function getIn(obj: unknown, path: Path): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/**
 * Retourne une copie de `obj` où la valeur au chemin `path` vaut `value`. Une valeur
 * `undefined` supprime la clé d'un objet. Si la valeur est déjà identique, `obj` est rendu tel
 * quel (même référence), ce qui évite une entrée d'historique vide.
 */
export function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  if (head === "__proto__") throw new Error("Chemin interdit : __proto__.");
  const container: unknown = obj;
  const isObj = container !== null && typeof container === "object";
  const record = isObj ? (container as Record<string | number, unknown>) : {};
  const present = isObj && Object.prototype.hasOwnProperty.call(record, head);
  const current = present ? record[head] : undefined;
  const nextChild = setIn(current, rest, value);
  if (Object.is(nextChild, current) && (nextChild !== undefined || !present)) {
    return obj;
  }
  if (Array.isArray(container)) {
    if (typeof head !== "number") throw new Error(`Indice de tableau attendu : ${String(head)}`);
    const copy = container.slice();
    copy[head] = nextChild;
    return copy as T;
  }
  const copy: Record<string | number, unknown> = { ...record };
  if (nextChild === undefined) delete copy[head];
  else copy[head] = nextChild;
  return copy as T;
}
