/**
 * Maillage triangulé d'aperçu (ADR-0001) : tableaux typés prêts pour WebGL / three.js.
 *
 * Conventions :
 * - `positions` et `normals` : 3 flottants par sommet, en millimètres ; positions dans le
 *   repère monde, ou relatives à `origin` quand elle est présente (maillage en repère local,
 *   `MeshOptions.localOrigin` : le float32 garde alors sa précision loin de l'origine du
 *   monde, ≈ 0,25 mm à 5 m sinon) ; point monde = `origin` + position ;
 * - `indices` : 3 indices par triangle, orientés dans le sens trigonométrique vu de
 *   l'extérieur (normale sortante), pour un solide fermé ;
 * - les arêtes vives sont obtenues en dupliquant les sommets (normales distinctes), si bien
 *   que la topologie « fermée » s'apprécie après soudure des positions (voir `checkManifold`).
 *
 * Les maillages produits sont considérés immuables (ils peuvent être partagés par un cache).
 */
import type { Vec3 } from "@blondel/core";

export interface Mesh {
  /**
   * Origine locale (mm, float64, repère monde) à laquelle les positions sont relatives.
   * Absente : positions dans le repère monde.
   */
  readonly origin?: Vec3;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

/** Maillage vide (aucun sommet, aucun triangle). */
export function emptyMesh(): Mesh {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  };
}

/** Nombre de sommets et de triangles d'un maillage. */
export function vertexCount(mesh: Mesh): number {
  return mesh.positions.length / 3;
}

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/**
 * Accumulateur de maillage en float64 ; converti en tableaux typés par `build()`.
 * Interne au package (exporté pour les constructeurs de solides).
 */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Ajoute un sommet et retourne son indice. */
  addVertex(x: number, y: number, z: number, nx = 0, ny = 0, nz = 0): number {
    const i = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    return i;
  }

  addTriangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** Normalise les normales des sommets `[from, to)` (accumulées non normées). */
  normalizeNormals(from: number, to: number): void {
    const n = this.normals;
    for (let v = from; v < to; v++) {
      const k = 3 * v;
      const x = n[k]!;
      const y = n[k + 1]!;
      const z = n[k + 2]!;
      const l = Math.hypot(x, y, z);
      if (l > 0) {
        n[k] = x / l;
        n[k + 1] = y / l;
        n[k + 2] = z / l;
      }
    }
  }

  /**
   * Tableaux typés. `local` : positions relatives au centre de leur boîte englobante, calculé
   * et soustrait en float64 avant la conversion en float32 (`Mesh.origin`).
   */
  build(local = false): Mesh {
    const p = this.positions;
    if (local && p.length > 0) {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < p.length; k++) {
        const c = k % 3;
        if (p[k]! < lo[c]!) lo[c] = p[k]!;
        if (p[k]! > hi[c]!) hi[c] = p[k]!;
      }
      const o = [0, 1, 2].map((c) => (lo[c]! + hi[c]!) / 2);
      const positions = new Float32Array(p.length);
      for (let k = 0; k < p.length; k++) positions[k] = p[k]! - o[k % 3]!;
      return {
        origin: { x: o[0]!, y: o[1]!, z: o[2]! },
        positions,
        normals: Float32Array.from(this.normals),
        indices: Uint32Array.from(this.indices),
      };
    }
    return {
      positions: Float32Array.from(p),
      normals: Float32Array.from(this.normals),
      indices: Uint32Array.from(this.indices),
    };
  }
}

/** Inverse l'orientation de tous les triangles et les normales (nouveau maillage). */
export function flipMesh(mesh: Mesh): Mesh {
  const indices = mesh.indices.slice();
  for (let t = 0; t < indices.length; t += 3) {
    const b = indices[t + 1]!;
    indices[t + 1] = indices[t + 2]!;
    indices[t + 2] = b;
  }
  const normals = mesh.normals.slice();
  for (let k = 0; k < normals.length; k++) normals[k] = -normals[k]!;
  return {
    ...(mesh.origin ? { origin: mesh.origin } : {}),
    positions: mesh.positions.slice(),
    normals,
    indices,
  };
}

/**
 * Fusionne plusieurs maillages en un seul (concaténation, indices décalés). Origines locales :
 * le résultat garde celle du premier maillage ; les positions des autres y sont ramenées
 * (différence d'origines calculée en float64).
 */
export function mergeMeshes(meshes: readonly Mesh[]): Mesh {
  const origin = meshes[0]?.origin;
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv);
  const normals = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let pv = 0;
  let pi = 0;
  for (const m of meshes) {
    const dx = (m.origin?.x ?? 0) - (origin?.x ?? 0);
    const dy = (m.origin?.y ?? 0) - (origin?.y ?? 0);
    const dz = (m.origin?.z ?? 0) - (origin?.z ?? 0);
    if (dx === 0 && dy === 0 && dz === 0) positions.set(m.positions, pv);
    else
      for (let k = 0; k < m.positions.length; k += 3) {
        positions[pv + k] = m.positions[k]! + dx;
        positions[pv + k + 1] = m.positions[k + 1]! + dy;
        positions[pv + k + 2] = m.positions[k + 2]! + dz;
      }
    normals.set(m.normals, pv);
    const offset = pv / 3;
    for (let k = 0; k < m.indices.length; k++) indices[pi + k] = m.indices[k]! + offset;
    pv += m.positions.length;
    pi += m.indices.length;
  }
  return { ...(origin ? { origin } : {}), positions, normals, indices };
}
