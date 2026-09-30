/**
 * Export glTF 2.0 binaire (`.glb`, spécification Khronos glTF 2.0 §4.4) écrit sans dépendance,
 * à partir des maillages d'aperçu de `@blondel/geometry` (SPEC §3, présentation et RA).
 *
 * Conventions du fichier :
 * - unités : **mètres**, repère **Y vers le haut** (glTF §3.4) ; le repère monde de Blondel
 *   (mm, Z vers le haut) est converti par (x, y, z) ↦ (x, z, −y) / 1 000, rotation propre qui
 *   conserve l'orientation des triangles ;
 * - un nœud par pièce, nommé par son **repère** (`Part.mark`), sous un nœud racine au nom du
 *   projet ; la translation du nœud est le centre de la boîte englobante de la pièce et les
 *   sommets sont relatifs à ce centre (précision float32 locale) : les maillages sont demandés
 *   en repère local (`MeshOptions.localOrigin`, origine en float64), la position monde n'est
 *   jamais arrondie en float32 (sinon ≈ 0,25 mm à 5 m de l'origine) ;
 * - un maillage par solide (partagé quand deux pièces ont le même `SolidDesc` et le même
 *   matériau), une primitive
 *   triangulée : `POSITION` (avec `min` / `max`), `NORMAL`, indices `UNSIGNED_SHORT` ou
 *   `UNSIGNED_INT` ;
 * - un matériau PBR metallicRoughness par `MaterialId` utilisé (`MATERIAL_PBR`) ;
 * - `extras` du nœud : métadonnées de la pièce (identifiant, repère, catégorie, désignation,
 *   matériau, section, débit, grandeurs) ; `extras` de la scène : projet et unités d'origine.
 *
 * Une pièce dont le solide n'a pas pu être maillé garde son nœud (sans maillage) et porte
 * `extras.meshError`.
 */
import type { Model, Part, Project } from "@blondel/core";
import { meshPart, type Mesh, type MeshOptions } from "@blondel/geometry";
import { tr } from "../i18n.js";
import { hexToLinear, pbrLook } from "./materials.js";

export const GLB_MAGIC = 0x46546c67; // « glTF »
export const GLB_CHUNK_JSON = 0x4e4f534a; // « JSON »
export const GLB_CHUNK_BIN = 0x004e4942; // « BIN\0 »

export const GL_FLOAT = 5126;
export const GL_UNSIGNED_SHORT = 5123;
export const GL_UNSIGNED_INT = 5125;
export const GL_ARRAY_BUFFER = 34962;
export const GL_ELEMENT_ARRAY_BUFFER = 34963;
export const GL_TRIANGLES = 4;

/** Millimètres → mètres. */
const MM_TO_M = 1e-3;

export interface GlbOptions {
  /** Projet (nom de la scène et du nœud racine). */
  readonly project?: Project;
  /** Nom de la scène (défaut : `project.name`, sinon « Escalier »). */
  readonly title?: string;
  /**
   * Options de maillage (`@blondel/geometry`) ; absentes : maillages en cache. Toujours en
   * repère local (`localOrigin` forcé).
   */
  readonly meshOptions?: MeshOptions;
  /** Filtre des pièces exportées (défaut : toutes). */
  readonly filter?: (part: Part) => boolean;
}

// ------------------------------------------------------------------ types du document

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: "SCALAR" | "VEC3";
  min?: number[];
  max?: number[];
}

interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target?: number;
}

interface GltfNode {
  name: string;
  mesh?: number;
  translation?: number[];
  children?: number[];
  extras?: Record<string, unknown>;
}

interface GltfMaterial {
  name: string;
  pbrMetallicRoughness: {
    baseColorFactor: number[];
    metallicFactor: number;
    roughnessFactor: number;
  };
  alphaMode?: "BLEND";
  doubleSided?: boolean;
  extras?: Record<string, unknown>;
}

interface GltfMesh {
  name: string;
  primitives: {
    attributes: { POSITION: number; NORMAL: number };
    indices: number;
    material: number;
    mode: number;
  }[];
}

/** Document glTF (sous-ensemble écrit par `exportGlb`). */
export interface GltfDocument {
  asset: { version: "2.0"; generator: string; copyright?: string };
  scene: number;
  scenes: { name: string; nodes: number[]; extras?: Record<string, unknown> }[];
  nodes: GltfNode[];
  meshes?: GltfMesh[];
  materials?: GltfMaterial[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number }[];
}

// ------------------------------------------------------------------ binaire

/** Tampon binaire extensible, blocs alignés sur 4 octets (glTF §3.6.2.4 et §4.4.3.3). */
class BinWriter {
  private chunks: Uint8Array[] = [];
  length = 0;

  /** Ajoute un bloc (aligné sur 4 octets) et renvoie son décalage. */
  push(bytes: Uint8Array): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad > 0) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    const offset = this.length;
    this.chunks.push(bytes);
    this.length += bytes.length;
    return offset;
  }

  bytes(): Uint8Array {
    const pad = (4 - (this.length % 4)) % 4;
    const out = new Uint8Array(this.length + pad);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

const round = (v: number, d = 6): number => {
  const k = 10 ** d;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? 0 : r;
};

/** Valeur JSON sûre (nombres finis seulement) : les métadonnées non finies sont omises. */
function jsonSafe(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const s = jsonSafe(x);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return v;
}

/** Métadonnées d'une pièce (`extras` du nœud). */
export function partExtras(part: Part): Record<string, unknown> {
  return jsonSafe({
    id: part.id,
    mark: part.mark,
    category: part.category,
    name: tr(part.name),
    material: part.material,
    ...(part.section !== undefined ? { section: tr(part.section) } : {}),
    ...(part.stock !== undefined ? { stockMm: part.stock } : {}),
    quantities: part.quantities,
    ...(part.flat !== undefined ? { flatThicknessMm: part.flat.thickness } : {}),
  }) as Record<string, unknown>;
}

/**
 * Sommets du maillage convertis (mètres, Y vers le haut) et recentrés sur le centre de leur
 * boîte englobante ; normales converties et renormalisées (normale nulle → +Y).
 */
function convertMesh(mesh: Mesh): {
  positions: Float32Array;
  normals: Float32Array;
  center: [number, number, number];
  min: number[];
  max: number[];
} {
  const n = mesh.positions.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const conv = new Float64Array(3 * n);
  // Origine locale du maillage (float64) : positions monde reconstituées sans perte.
  const o = mesh.origin ?? { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    const x = (o.x + mesh.positions[3 * i]!) * MM_TO_M;
    const y = (o.y + mesh.positions[3 * i + 1]!) * MM_TO_M;
    const z = (o.z + mesh.positions[3 * i + 2]!) * MM_TO_M;
    const p = [x, z, -y];
    for (let k = 0; k < 3; k++) {
      conv[3 * i + k] = p[k]!;
      if (p[k]! < lo[k]!) lo[k] = p[k]!;
      if (p[k]! > hi[k]!) hi[k] = p[k]!;
    }
  }
  const center: [number, number, number] =
    n > 0
      ? ([0, 1, 2].map((k) => round((lo[k]! + hi[k]!) / 2, 6)) as [number, number, number])
      : [0, 0, 0];
  const positions = new Float32Array(3 * n);
  for (let i = 0; i < 3 * n; i++) positions[i] = conv[i]! - center[i % 3]!;
  // min / max exacts des valeurs float32 écrites (exigence des validateurs).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 3 * n; i++) {
    const k = i % 3;
    if (positions[i]! < min[k]!) min[k] = positions[i]!;
    if (positions[i]! > max[k]!) max[k] = positions[i]!;
  }
  const normals = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const nx = mesh.normals[3 * i] ?? 0;
    const ny = mesh.normals[3 * i + 1] ?? 0;
    const nz = mesh.normals[3 * i + 2] ?? 0;
    let v = [nx, nz, -ny];
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    v = l > 1e-12 && Number.isFinite(l) ? v.map((c) => c / l) : [0, 1, 0];
    normals.set(v, 3 * i);
  }
  return { positions, normals, center, min, max };
}

function encodeJson(doc: GltfDocument): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const pad = (4 - (bytes.length % 4)) % 4;
  const out = new Uint8Array(bytes.length + pad).fill(0x20); // espaces (glTF §4.4.3.2)
  out.set(bytes);
  return out;
}

/** Assemble le conteneur GLB (en-tête de 12 octets, bloc JSON, bloc BIN facultatif). */
export function packGlb(doc: GltfDocument, bin: Uint8Array): Uint8Array {
  const json = encodeJson(doc);
  const hasBin = bin.length > 0;
  const total = 12 + 8 + json.length + (hasBin ? 8 + bin.length : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true);
  dv.setUint32(16, GLB_CHUNK_JSON, true);
  out.set(json, 20);
  if (hasBin) {
    const o = 20 + json.length;
    dv.setUint32(o, bin.length, true);
    dv.setUint32(o + 4, GLB_CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out;
}

// ------------------------------------------------------------------ export

/** Construit le document glTF et son tampon binaire (sans les empaqueter). */
export function buildGltf(
  model: Pick<Model, "parts">,
  options: GlbOptions = {},
): { doc: GltfDocument; bin: Uint8Array } {
  const name = options.title ?? options.project?.name ?? "Escalier";
  const parts = options.filter ? model.parts.filter(options.filter) : model.parts;
  const bin = new BinWriter();
  const accessors: GltfAccessor[] = [];
  const bufferViews: GltfBufferView[] = [];
  const meshes: GltfMesh[] = [];
  const materials: GltfMaterial[] = [];
  const materialIndex = new Map<string, number>();
  const nodes: GltfNode[] = [{ name, children: [] }];
  // Maillage partagé par solide **et** matériau : le matériau est porté par la primitive, deux
  // pièces de même solide mais de matériaux différents ne peuvent pas partager leur maillage.
  const meshCache = new Map<unknown, Map<string, { mesh: number; center: number[] }>>();
  const cacheGet = (part: Part) => meshCache.get(part.solid)?.get(part.material);
  const cacheSet = (part: Part, entry: { mesh: number; center: number[] }): void => {
    let byMaterial = meshCache.get(part.solid);
    if (!byMaterial) {
      byMaterial = new Map();
      meshCache.set(part.solid, byMaterial);
    }
    byMaterial.set(part.material, entry);
  };

  const view = (bytes: Uint8Array, target: number): number => {
    const byteOffset = bin.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
    return bufferViews.length - 1;
  };
  const material = (id: string): number => {
    const known = materialIndex.get(id);
    if (known !== undefined) return known;
    const look = pbrLook(id);
    const [r, g, b] = hexToLinear(look.color);
    const opacity = look.opacity ?? 1;
    materials.push({
      name: id,
      pbrMetallicRoughness: {
        baseColorFactor: [round(r), round(g), round(b), round(opacity)],
        metallicFactor: look.metalness,
        roughnessFactor: look.roughness,
      },
      ...(opacity < 1 ? { alphaMode: "BLEND" as const, doubleSided: true } : {}),
    });
    materialIndex.set(id, materials.length - 1);
    return materials.length - 1;
  };

  for (const part of parts) {
    const extras = partExtras(part);
    const cached = cacheGet(part);
    if (cached) {
      nodes.push({ name: part.mark, mesh: cached.mesh, translation: cached.center, extras });
      nodes[0]!.children!.push(nodes.length - 1);
      continue;
    }
    const pm = meshPart(part, { ...options.meshOptions, localOrigin: true });
    const vertexCount = pm.mesh.positions.length / 3;
    if (pm.error !== undefined || vertexCount === 0 || pm.mesh.indices.length === 0) {
      nodes.push({
        name: part.mark,
        extras: { ...extras, meshError: pm.error !== undefined ? tr(pm.error) : "maillage vide" },
      });
      nodes[0]!.children!.push(nodes.length - 1);
      continue;
    }
    const c = convertMesh(pm.mesh);
    const pos = view(new Uint8Array(c.positions.buffer), GL_ARRAY_BUFFER);
    accessors.push({
      bufferView: pos,
      componentType: GL_FLOAT,
      count: vertexCount,
      type: "VEC3",
      min: c.min,
      max: c.max,
    });
    const posAcc = accessors.length - 1;
    const nor = view(new Uint8Array(c.normals.buffer), GL_ARRAY_BUFFER);
    accessors.push({ bufferView: nor, componentType: GL_FLOAT, count: vertexCount, type: "VEC3" });
    const norAcc = accessors.length - 1;
    const small = vertexCount <= 0xffff;
    const idx = small ? Uint16Array.from(pm.mesh.indices) : Uint32Array.from(pm.mesh.indices);
    const iv = view(new Uint8Array(idx.buffer), GL_ELEMENT_ARRAY_BUFFER);
    accessors.push({
      bufferView: iv,
      componentType: small ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT,
      count: idx.length,
      type: "SCALAR",
    });
    const idxAcc = accessors.length - 1;
    meshes.push({
      name: part.id,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: norAcc },
          indices: idxAcc,
          material: material(part.material),
          mode: GL_TRIANGLES,
        },
      ],
    });
    const entry = { mesh: meshes.length - 1, center: c.center };
    cacheSet(part, entry);
    nodes.push({ name: part.mark, mesh: entry.mesh, translation: entry.center, extras });
    nodes[0]!.children!.push(nodes.length - 1);
  }

  const data = bin.bytes();
  const doc: GltfDocument = {
    asset: { version: "2.0", generator: "Blondel" },
    scene: 0,
    scenes: [
      {
        name,
        nodes: [0],
        extras: {
          project: name,
          units: "m",
          upAxis: "Y",
          source: "Blondel : mm, Z vers le haut ; (x, y, z) -> (x, z, -y) / 1000",
          partCount: parts.length,
        },
      },
    ],
    nodes,
    ...(meshes.length > 0 ? { meshes, materials, accessors, bufferViews } : {}),
    ...(data.length > 0 ? { buffers: [{ byteLength: data.length }] } : {}),
  };
  if (nodes[0]!.children!.length === 0) delete nodes[0]!.children;
  return { doc, bin: data };
}

/** Modèle 3D glTF 2.0 binaire (`.glb`) des pièces du modèle. Sortie déterministe. */
export function exportGlb(model: Pick<Model, "parts">, options: GlbOptions = {}): Uint8Array {
  const { doc, bin } = buildGltf(model, options);
  return packGlb(doc, bin);
}

export const GLB_FILE_EXTENSION = ".glb";
export const GLB_MIME = "model/gltf-binary";
