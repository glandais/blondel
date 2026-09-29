/**
 * Géométries three.js partagées par empreinte de solide (voir `model/meshCache.ts`) : une pièce
 * inchangée garde son `BufferGeometry` (pas de nouveau transfert vers le GPU) ; les géométries
 * qui ne sont plus affichées sont libérées après chaque rendu validé (`retain`), toutes au
 * démontage (`disposeAll`). three.js retransfère d'elle-même une géométrie libérée puis
 * réutilisée : un double montage (StrictMode) reste sans effet visible.
 */
import type { Vec3 } from "@blondel/core";
import type { Mesh } from "@blondel/geometry";
import type { BufferGeometry } from "three";
import { toBufferGeometry } from "./geometry.js";

export interface Disposable {
  dispose(): void;
}

export class GeometryPool<G extends Disposable = BufferGeometry> {
  private readonly map = new Map<string, G>();

  constructor(private readonly create: (mesh: Mesh, grain?: Vec3) => G) {}

  /**
   * Géométrie de l'empreinte `key`, créée à la première demande. Les UV dépendant du fil, la
   * clé doit l'inclure (`geometryKey`).
   */
  get(key: string, mesh: Mesh, grain?: Vec3): G {
    let g = this.map.get(key);
    if (!g) {
      g = this.create(mesh, grain);
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

/** Clé d'une géométrie : empreinte du solide et sens du fil (UV). */
export function geometryKey(solidKey: string, grain: Vec3 | undefined): string {
  return grain ? `${solidKey}|${grain.x},${grain.y},${grain.z}` : solidKey;
}

export function createGeometryPool(): GeometryPool<BufferGeometry> {
  return new GeometryPool((mesh, grain) => toBufferGeometry(mesh, grain));
}
