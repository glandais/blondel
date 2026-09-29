/**
 * Coordonnées de texture (UV) projetées selon le **sens du fil** d'une pièce (jalon 6, rendu
 * PBR). Aucune règle métier : choix de présentation.
 *
 * Repère du fil (g, a, b), orthonormé direct :
 * - g : direction du fil (`Part.grain`, repère monde des maillages), normalisée ;
 * - a : perpendiculaire horizontale au fil (g × Z), ou X si le fil est vertical ;
 * - b = g × a.
 *
 * Projection « boîte » dans ce repère, sommet par sommet selon sa normale :
 * - face de fil (normale dominée par a ou b) : u = p·g (le long du fil), v = p·b ou p·a
 *   (en travers) → les veines d'une texture dont l'axe u porte le fil suivent la pièce ;
 * - bois de bout (normale dominée par g) : u = p·a, v = p·b.
 *
 * Les coordonnées sont en unités de `period` mm (1 000 par défaut : UV en mètres), mesurées dans
 * le repère monde : deux pièces contiguës de même fil ont des veines continues, et l'échelle de
 * la texture ne dépend pas de la taille de la pièce. Les arêtes vives des maillages dupliquant
 * leurs sommets (`Mesh`), une face plane reçoit une seule projection. Sur une surface lissée
 * (balayage, surface réglée), des sommets partagés peuvent relever de classes différentes :
 * `grainUVs` (par sommet) interpole alors, dans un même triangle, des coordonnées sans rapport
 * (texture écrasée jusqu'à plusieurs centaines de fois). `grainUVMesh` choisit la projection
 * **par triangle** et duplique les sommets aux coutures : c'est elle que la vue 3D utilise.
 */
import type { Mm, Vec3 } from "@blondel/core";
import { GeometryError } from "./errors.js";
import type { Mesh } from "./mesh.js";
import { cross, dot, length, normalize, v3 } from "./vec3.js";

/** Repère orthonormé direct du fil. */
export interface GrainFrame {
  /** Sens du fil. */
  readonly along: Vec3;
  /** Travers horizontal (g × Z), ou X pour un fil vertical. */
  readonly across: Vec3;
  /** Troisième axe g × a. */
  readonly third: Vec3;
}

export interface GrainUvOptions {
  /** Longueur (mm) correspondant à une unité de coordonnée de texture. Défaut : 1 000. */
  readonly period?: Mm;
}

/** Classe de projection d'un sommet (voir `grainUVs`). */
export type UvFace = "end" | "across" | "third";

const Z = v3(0, 0, 1);
const EPS = 1e-9;

/**
 * Repère du fil de direction `grain` (non nulle, finie). Lève `GeometryError` sinon.
 */
export function grainFrame(grain: Vec3): GrainFrame {
  const l = length(grain);
  if (!Number.isFinite(l) || l < EPS) {
    throw new GeometryError(`direction de fil invalide : (${grain.x}, ${grain.y}, ${grain.z})`);
  }
  const along = normalize(grain);
  const h = cross(along, Z);
  // Fil vertical (ou presque) : travers pris selon X, orthogonalisé.
  const d = along.x; // X · g
  const across =
    length(h) > 1e-6 ? normalize(h) : normalize(v3(1 - along.x * d, -along.y * d, -along.z * d));
  const third = normalize(cross(along, across));
  return { along, across, third };
}

/**
 * Axe principal d'un maillage : axe monde (X, Y ou Z) de plus grande étendue. Sert de sens de
 * brossage / de fil par défaut quand la pièce n'en déclare pas. Maillage vide : X.
 */
export function principalAxis(mesh: Mesh): Vec3 {
  const p = mesh.positions;
  if (p.length === 0) return v3(1, 0, 0);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.length; k += 3) {
    for (let c = 0; c < 3; c++) {
      const x = p[k + c]!;
      if (x < min[c]!) min[c] = x;
      if (x > max[c]!) max[c] = x;
    }
  }
  const ext = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
  const i = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
  return v3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
}

/** Classe de projection pour une normale (composantes dans le repère du fil). */
export function uvFace(frame: GrainFrame, normal: Vec3): UvFace {
  const cg = Math.abs(dot(normal, frame.along));
  const ca = Math.abs(dot(normal, frame.across));
  const cb = Math.abs(dot(normal, frame.third));
  // Égalité : face de fil (une face oblique garde les veines dans le sens du fil).
  if (cg > Math.max(ca, cb) + 1e-6) return "end";
  return ca >= cb ? "across" : "third";
}

/**
 * Coordonnées de texture de `mesh` (2 flottants par sommet), projetées selon le fil `grain`
 * (défaut : axe principal du maillage, `principalAxis`).
 */
export function grainUVs(mesh: Mesh, grain?: Vec3, options: GrainUvOptions = {}): Float32Array {
  const period = options.period ?? 1000;
  if (!Number.isFinite(period) || period <= 0) {
    throw new GeometryError(`période de texture invalide : ${period}`);
  }
  const frame = grainFrame(grain ?? principalAxis(mesh));
  const { along: g, across: a, third: b } = frame;
  const p = mesh.positions;
  const n = mesh.normals;
  const uv = new Float32Array((p.length / 3) * 2);
  const inv = 1 / period;
  for (let v = 0, k = 0; k < p.length; v++, k += 3) {
    const px = p[k]!;
    const py = p[k + 1]!;
    const pz = p[k + 2]!;
    const face = uvFace(frame, v3(n[k]!, n[k + 1]!, n[k + 2]!));
    const pg = px * g.x + py * g.y + pz * g.z;
    const pa = px * a.x + py * a.y + pz * a.z;
    const pb = px * b.x + py * b.y + pz * b.z;
    if (face === "end") {
      uv[2 * v] = pa * inv;
      uv[2 * v + 1] = pb * inv;
    } else {
      uv[2 * v] = pg * inv;
      uv[2 * v + 1] = (face === "across" ? pb : pa) * inv;
    }
  }
  return uv;
}

/** Maillage (sommets dupliqués aux coutures de projection) et ses coordonnées de texture. */
export interface UvMesh {
  /** Maillage d'entrée s'il n'a aucune couture (tableaux partagés), sinon copie élargie. */
  readonly mesh: Mesh;
  /** 2 flottants par sommet de `mesh`. */
  readonly uvs: Float32Array;
}

const FACE_CODE: Readonly<Record<UvFace, number>> = { end: 0, across: 1, third: 2 };

/**
 * Coordonnées de texture projetées selon le fil, avec projection choisie **par triangle**
 * (somme des normales de ses sommets, ou normale géométrique si elle s'annule) : les trois
 * sommets d'un triangle sont projetés de la même façon, et un sommet partagé par des triangles
 * de classes différentes est dupliqué (couture nette au lieu d'une texture écrasée). Dans chaque
 * triangle, les UV sont une projection orthogonale des positions : |Δuv| ≤ |Δp| / période.
 */
export function grainUVMesh(mesh: Mesh, grain?: Vec3, options: GrainUvOptions = {}): UvMesh {
  const period = options.period ?? 1000;
  if (!Number.isFinite(period) || period <= 0) {
    throw new GeometryError(`période de texture invalide : ${period}`);
  }
  const frame = grainFrame(grain ?? principalAxis(mesh));
  const { along: g, across: a, third: b } = frame;
  const p = mesh.positions;
  const n = mesh.normals;
  const idx = mesh.indices;
  const nv = p.length / 3;
  // Classe de chaque triangle.
  const faces = new Uint8Array(idx.length / 3);
  // Classe retenue par sommet (255 : pas encore vu) et nombre de sommets supplémentaires.
  const first = new Uint8Array(nv).fill(255);
  let seams = false;
  for (let t = 0; t < faces.length; t++) {
    const i0 = idx[3 * t]!;
    const i1 = idx[3 * t + 1]!;
    const i2 = idx[3 * t + 2]!;
    let nx = n[3 * i0]! + n[3 * i1]! + n[3 * i2]!;
    let ny = n[3 * i0 + 1]! + n[3 * i1 + 1]! + n[3 * i2 + 1]!;
    let nz = n[3 * i0 + 2]! + n[3 * i1 + 2]! + n[3 * i2 + 2]!;
    if (Math.hypot(nx, ny, nz) < EPS) {
      const e1 = v3(
        p[3 * i1]! - p[3 * i0]!,
        p[3 * i1 + 1]! - p[3 * i0 + 1]!,
        p[3 * i1 + 2]! - p[3 * i0 + 2]!,
      );
      const e2 = v3(
        p[3 * i2]! - p[3 * i0]!,
        p[3 * i2 + 1]! - p[3 * i0 + 1]!,
        p[3 * i2 + 2]! - p[3 * i0 + 2]!,
      );
      const c = cross(e1, e2);
      nx = c.x;
      ny = c.y;
      nz = c.z;
    }
    const code = FACE_CODE[uvFace(frame, v3(nx, ny, nz))];
    faces[t] = code;
    for (const i of [i0, i1, i2]) {
      if (first[i] === 255) first[i] = code;
      else if (first[i] !== code) seams = true;
    }
  }
  const project = (i: number, code: number, out: Float32Array, o: number): void => {
    const px = p[3 * i]!;
    const py = p[3 * i + 1]!;
    const pz = p[3 * i + 2]!;
    const pg = px * g.x + py * g.y + pz * g.z;
    const pa = px * a.x + py * a.y + pz * a.z;
    const pb = px * b.x + py * b.y + pz * b.z;
    out[o] = (code === 0 ? pa : pg) / period;
    out[o + 1] = (code === 2 ? pa : pb) / period;
  };
  if (!seams) {
    const uvs = new Float32Array(nv * 2);
    for (let i = 0; i < nv; i++) project(i, first[i] === 255 ? 1 : first[i]!, uvs, 2 * i);
    return { mesh, uvs };
  }
  // Sommets dupliqués par (sommet, classe) ; les sommets non référencés sont conservés.
  const slot = new Int32Array(nv * 3).fill(-1);
  for (let i = 0; i < nv; i++) if (first[i] !== 255) slot[3 * i + first[i]!] = i;
  let count = nv;
  const indices = new Uint32Array(idx.length);
  const extra: number[] = [];
  for (let t = 0; t < faces.length; t++) {
    const code = faces[t]!;
    for (let c = 0; c < 3; c++) {
      const i = idx[3 * t + c]!;
      let j = slot[3 * i + code]!;
      if (j < 0) {
        j = count++;
        slot[3 * i + code] = j;
        extra.push(i, code);
      }
      indices[3 * t + c] = j;
    }
  }
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  positions.set(p);
  normals.set(n);
  for (let i = 0; i < nv; i++) project(i, first[i] === 255 ? 1 : first[i]!, uvs, 2 * i);
  for (let k = 0; k < extra.length; k += 2) {
    const i = extra[k]!;
    const j = nv + k / 2;
    for (let c = 0; c < 3; c++) {
      positions[3 * j + c] = p[3 * i + c]!;
      normals[3 * j + c] = n[3 * i + c]!;
    }
    project(i, extra[k + 1]!, uvs, 2 * j);
  }
  return { mesh: { positions, normals, indices }, uvs };
}
