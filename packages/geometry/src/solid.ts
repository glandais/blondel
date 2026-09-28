/**
 * Point d'entrée : conversion des `SolidDesc` / `Part` du cœur en maillages.
 */
import type { MaterialId, Part, PartCategory, SolidDesc } from "@blondel/core";
import { GeometryError } from "./errors.js";
import { meshExtrusion } from "./extrude.js";
import { emptyMesh, type Mesh } from "./mesh.js";
import type { MeshOptions } from "./options.js";
import { meshRuled } from "./ruled.js";
import { meshSweep } from "./sweep.js";

/** Convertit une description analytique de solide en maillage. Lève `GeometryError`. */
export function meshSolid(desc: SolidDesc, options?: MeshOptions): Mesh {
  switch (desc.kind) {
    case "extrusion":
      return meshExtrusion(desc.frame, desc.profile, desc.depth, options);
    case "ruled":
      return meshRuled(desc.a, desc.b, desc.thickness, desc.normals, options);
    case "sweep":
      return meshSweep(desc.path, desc.section, options);
    default: {
      // Type de solide inconnu (contrat de @blondel/core étendu sans mise à jour d'ici) :
      // erreur explicite plutôt qu'un maillage `undefined` mis en cache.
      const unknown: never = desc;
      throw new GeometryError(
        `type de solide inconnu : ${String((unknown as { kind?: unknown }).kind)}`,
      );
    }
  }
}

/** Maillage d'une pièce, avec ce qu'il faut pour le rendu (matériau, catégorie, sélection). */
export interface PartMesh {
  readonly partId: string;
  readonly mark: string;
  readonly category: PartCategory;
  readonly material: MaterialId;
  readonly mesh: Mesh;
  /** Message si le solide n'a pas pu être maillé (maillage vide dans ce cas). */
  readonly error?: string;
}

// Cache par identité du `SolidDesc` (le modèle dérivé est immuable, ADR-0002) : une
// modification ne remaille que les pièces dont le solide a changé. Options par défaut seulement.
const cache = new WeakMap<SolidDesc, Mesh>();

/** Maille une pièce ; une erreur géométrique donne un maillage vide et un message, sans lever. */
export function meshPart(part: Part, options?: MeshOptions): PartMesh {
  const base = {
    partId: part.id,
    mark: part.mark,
    category: part.category,
    material: part.material,
  };
  try {
    let mesh = options ? undefined : cache.get(part.solid);
    if (!mesh) {
      mesh = meshSolid(part.solid, options);
      if (!options) cache.set(part.solid, mesh);
    }
    return { ...base, mesh };
  } catch (e) {
    return { ...base, mesh: emptyMesh(), error: e instanceof Error ? e.message : String(e) };
  }
}

/** Maille toutes les pièces (ordre conservé). */
export function meshParts(parts: readonly Part[], options?: MeshOptions): PartMesh[] {
  return parts.map((p) => meshPart(p, options));
}
