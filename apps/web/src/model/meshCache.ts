/**
 * Maillage d'aperçu mémoïsé **par pièce** (ADR-0006) : le cœur recrée toutes les pièces dès
 * qu'une dépendance de l'étape « pièces » change (ex. épaisseur de contremarche), si bien que le
 * cache par identité de `@blondel/geometry` remaillerait tout. Ici chaque solide est identifié
 * par son **empreinte** (JSON à clés triées du `SolidDesc`, calculée une fois par objet) : une
 * pièce dont le solide est inchangé réutilise son maillage (et sa géométrie three.js, voir
 * `three/geometryPool.ts`).
 */
import { stableStringify, type Part, type SolidDesc } from "@blondel/core";
import { meshPart, type PartMesh } from "@blondel/geometry";

export interface MeshedPart {
  readonly part: Part;
  /** Empreinte du solide (clé de cache du maillage et de la géométrie). */
  readonly key: string;
  readonly mesh: PartMesh;
}

export interface MeshRun {
  readonly parts: readonly MeshedPart[];
  /** Pièces maillées lors de cet appel / réutilisées. */
  readonly misses: number;
  readonly hits: number;
  /** Durée de l'appel (empreintes + maillages manquants), ms. */
  readonly timeMs: number;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface MeshCache {
  mesh(parts: readonly Part[]): MeshRun;
  /** Nombre de maillages conservés. */
  readonly size: number;
  clear(): void;
}

/**
 * Cache borné : les maillages de l'appel courant sont toujours conservés, les plus anciens
 * au-delà de `capacity` sont oubliés.
 */
export function createMeshCache(capacity = 512): MeshCache {
  const fingerprints = new WeakMap<SolidDesc, string>();
  const meshes = new Map<string, PartMesh>();
  const fingerprint = (solid: SolidDesc): string => {
    let k = fingerprints.get(solid);
    if (k === undefined) {
      k = stableStringify(solid, 0);
      fingerprints.set(solid, k);
    }
    return k;
  };
  return {
    mesh(parts) {
      const t0 = now();
      let hits = 0;
      let misses = 0;
      const out: MeshedPart[] = parts.map((part) => {
        const key = fingerprint(part.solid);
        let m = meshes.get(key);
        if (m) {
          hits++;
          meshes.delete(key); // récence (ordre d'insertion de la Map)
        } else {
          misses++;
          m = meshPart(part);
        }
        meshes.set(key, m);
        // Métadonnées de la pièce courante (repère, matériau), maillage partagé.
        const mesh: PartMesh =
          m.partId === part.id &&
          m.mark === part.mark &&
          m.category === part.category &&
          m.material === part.material
            ? m
            : {
                ...m,
                partId: part.id,
                mark: part.mark,
                category: part.category,
                material: part.material,
              };
        return { part, key, mesh };
      });
      while (meshes.size > Math.max(capacity, parts.length)) {
        const oldest = meshes.keys().next().value;
        if (oldest === undefined) break;
        meshes.delete(oldest);
      }
      return { parts: out, hits, misses, timeMs: now() - t0 };
    },
    get size() {
      return meshes.size;
    },
    clear() {
      meshes.clear();
    },
  };
}
