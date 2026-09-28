/**
 * Mémoïsation simple par identité (ADR-0002, ADR-0006) : le projet est immuable, chaque étape
 * garde son **dernier** résultat et le réutilise si toutes ses dépendances sont les mêmes
 * objets (comparaison `Object.is`).
 */
export class LastValueCache<R> {
  private keys: readonly unknown[] | undefined;
  private value: R | undefined;
  hits = 0;
  misses = 0;

  get(keys: readonly unknown[], compute: () => R): R {
    const prev = this.keys;
    if (
      prev !== undefined &&
      prev.length === keys.length &&
      prev.every((k, i) => Object.is(k, keys[i]))
    ) {
      this.hits++;
      return this.value as R;
    }
    this.misses++;
    const value = compute();
    this.keys = keys;
    this.value = value;
    return value;
  }

  clear(): void {
    this.keys = undefined;
    this.value = undefined;
    this.hits = 0;
    this.misses = 0;
  }
}
