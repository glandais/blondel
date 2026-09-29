/**
 * Géométries three.js partagées par empreinte de solide (voir `model/meshCache.ts`) : une pièce
 * inchangée garde son `BufferGeometry` (pas de nouveau transfert vers le GPU) ; les géométries
 * qui ne sont plus affichées sont libérées après chaque rendu validé (`retain`), toutes au
 * démontage (`disposeAll`). three.js retransfère d'elle-même une géométrie libérée puis
 * réutilisée : un double montage (StrictMode) reste sans effet visible.
 */
import type { Mesh } from "@blondel/geometry";
import type { BufferGeometry } from "three";
import { toBufferGeometry } from "./geometry.js";

export interface Disposable {
  dispose(): void;
}

export class GeometryPool<G extends Disposable = BufferGeometry> {
  private readonly map = new Map<string, G>();

  constructor(private readonly create: (mesh: Mesh) => G) {}

  /** Géométrie de l'empreinte `key`, créée à la première demande. */
  get(key: string, mesh: Mesh): G {
    let g = this.map.get(key);
    if (!g) {
      g = this.create(mesh);
      this.map.set(key, g);
    }
    return g;
  }

  /** Libère les géométries dont l'empreinte n'est pas dans `keys`. */
  retain(keys: Iterable<string>): number {
    const keep = new Set(keys);
    let n = 0;
    for (const [k, g] of this.map) {
      if (!keep.has(k)) {
        g.dispose();
        this.map.delete(k);
        n++;
      }
    }
    return n;
  }

  disposeAll(): void {
    for (const g of this.map.values()) g.dispose();
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export function createGeometryPool(): GeometryPool<BufferGeometry> {
  return new GeometryPool(toBufferGeometry);
}
