/**
 * Balayage d'une section plane le long d'une polyligne 3D (main courante, tube, lisse).
 *
 * Repère de section par segment (voir `MeshOptions.sweepFrame`) :
 * - `"upright"` (défaut) : section d'aplomb, son axe v reste dans le plan vertical contenant la
 *   tangente ; exact (sans torsion) aux virages horizontaux et aux changements de pente ; sur
 *   une hélice, chaque segment porte une très légère torsion (quelques centièmes de degré par
 *   segment aux discrétisations usuelles) ;
 * - `"parallel"` : **transport parallèle** (rotation minimale d'un segment au suivant) : aucune
 *   torsion locale, contrairement au repère de Frenet qui bascule aux inflexions, mais une
 *   rotation cumulée autour de la tangente sur une hélice (la section finit par se retourner).
 * Aux sommets intérieurs, la section est placée dans le plan bissecteur (coupe d'onglet) :
 * le volume vaut alors exactement aire × longueur du chemin quand le centre de gravité de la
 * section est à l'origine (théorème de Guldin appliqué segment par segment), en mode
 * `"parallel"` ; en mode `"upright"`, à la légère torsion près sur un chemin gauche.
 *
 * Auto-intersection (onglets d'un même segment qui se croisent : virage trop serré pour la
 * section, ou proche de 180°, l'onglet s'allongeant de 1 / cos(θ/2) ; spires qui se touchent) :
 * non vérifiée ici, le maillage est produit tel quel (replié localement) ; le cœur la signale
 * dans `Model.errors` (`parts/solidChecks.ts`). Seul le demi-tour exact lève `GeometryError`.
 */
import type { Shape2, Vec3 } from "@blondel/core";
import { GeometryError } from "./errors.js";
import { addCap, addGrid } from "./grid.js";
import { MeshBuilder, type Mesh } from "./mesh.js";
import { creaseCos, maxPathPoints, type MeshOptions, type SweepFrameMode } from "./options.js";
import { EPS, prepareShape, sharpCorners } from "./polygon.js";
import { add, cross, dot, length, normalize, rotateMinimal, scale, sub, v3 } from "./vec3.js";

/** Repère de section d'un segment : section (u, v) ↦ u · normal + v · binormal ; tangent = normal × binormal. */
export interface SweepFrame {
  readonly tangent: Vec3;
  readonly normal: Vec3;
  readonly binormal: Vec3;
}

/** Retire les points consécutifs confondus (distance ≤ EPS). */
export function dedupePath(path: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of path) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      throw new GeometryError("coordonnée non finie dans un chemin de balayage");
    }
    const last = out[out.length - 1];
    if (!last || length(sub(p, last)) > EPS) out.push(p);
  }
  return out;
}

/**
 * Repères de section par transport parallèle, un par segment du chemin (déjà dédoublonné).
 *
 * Repère initial : l'axe v de la section (binormal) est la verticale +Z projetée sur le plan
 * normal au premier segment (section « debout ») ; si le premier segment est vertical, v = +Y.
 * Lève `GeometryError` sur un demi-tour (segments consécutifs opposés).
 */
export function parallelTransportFrames(path: readonly Vec3[]): SweepFrame[] {
  return sweepFrames(path, "parallel");
}

/**
 * Repères de section d'aplomb, un par segment : binormale = verticale +Z projetée sur le plan
 * normal au segment. Sur un segment vertical (plan vertical indéfini), repère transporté du
 * segment précédent (ou v = +Y pour un premier segment vertical).
 */
export function uprightFrames(path: readonly Vec3[]): SweepFrame[] {
  return sweepFrames(path, "upright");
}

/** Repères de section selon le mode (voir `MeshOptions.sweepFrame`). */
export function sweepFrames(path: readonly Vec3[], mode: SweepFrameMode): SweepFrame[] {
  const frames: SweepFrame[] = [];
  let prevT: Vec3 | undefined;
  let N = v3(0, 0, 0);
  let B = v3(0, 0, 0);
  for (let k = 0; k + 1 < path.length; k++) {
    const T = normalize(sub(path[k + 1]!, path[k]!));
    // Segment (quasi) vertical : plan vertical de la tangente mal défini (< 1 µrad).
    const vertical = Math.hypot(T.x, T.y) <= 1e-6;
    if (prevT && dot(prevT, T) < -1 + 1e-9)
      throw new GeometryError("chemin de balayage avec demi-tour");
    if (!prevT || (mode === "upright" && !vertical)) {
      const up = vertical ? v3(0, 1, 0) : v3(0, 0, 1);
      B = normalize(sub(up, scale(T, dot(up, T))));
      B = normalize(sub(B, scale(T, dot(B, T)))); // seconde passe : T presque vertical
    } else {
      B = rotateMinimal(B, prevT, T);
      // Réorthonormalisation (dérive numérique sur de longs chemins).
      B = normalize(sub(B, scale(T, dot(B, T))));
    }
    N = cross(B, T);
    frames.push({ tangent: T, normal: N, binormal: B });
    prevT = T;
  }
  return frames;
}

/** Longueur d'une polyligne 3D. */
export function polylineLength(path: readonly Vec3[]): number {
  let s = 0;
  for (let k = 0; k + 1 < path.length; k++) s += length(sub(path[k + 1]!, path[k]!));
  return s;
}

/** Balaye `section` le long de `path`. Chemin d'au moins 2 points distincts. */
export function meshSweep(
  pathIn: readonly Vec3[],
  section: Shape2,
  options: MeshOptions = {},
): Mesh {
  const path = dedupePath(pathIn);
  if (path.length < 2) throw new GeometryError("chemin de balayage de moins de 2 points distincts");
  if (path.length > maxPathPoints(options)) throw new GeometryError("chemin de balayage trop long");
  const crease = creaseCos(options, 30);
  const mode = options.sweepFrame ?? "upright";
  if (mode !== "upright" && mode !== "parallel")
    throw new GeometryError(`repère de balayage inconnu : ${String(mode)}`);
  const shape = prepareShape(section);
  const frames = sweepFrames(path, mode);
  const m = path.length;

  // Repère de section à chaque sommet, dans le plan de coupe. Aux sommets intérieurs, le plan
  // de coupe est le plan bissecteur (normale M = tangente moyenne) : la section y est étirée de
  // 1 / cos(θ/2) selon la direction du virage d = (T_out − T_in) / |…|, de sorte que chacun
  // des deux segments adjacents y voie une section droite exacte (coupe d'onglet), orientée
  // par le repère du sommet ramené sur sa tangente par rotation minimale.
  //  - "parallel" : repère du segment entrant ramené sur M par rotation minimale (identique à
  //    la projection du prisme entrant sur le plan bissecteur ; aucune torsion) ;
  //  - "upright" : repère d'aplomb relativement à M (la torsion d'une hélice se répartit
  //    symétriquement de part et d'autre de chaque segment).
  interface VertexFrame {
    readonly n: Vec3;
    readonly b: Vec3;
    readonly d: Vec3;
    /** Allongement relatif selon d : 1 / cos(θ/2) − 1 (0 aux extrémités). */
    readonly stretch: number;
  }
  const vframes: VertexFrame[] = [];
  for (let k = 0; k < m; k++) {
    const fin = frames[Math.max(0, k - 1)]!;
    const fout = frames[Math.min(frames.length - 1, k)]!;
    if (k === 0 || k === m - 1) {
      const f = k === 0 ? fout : fin;
      vframes.push({ n: f.normal, b: f.binormal, d: f.normal, stretch: 0 });
      continue;
    }
    const M = normalize(add(fin.tangent, fout.tangent));
    const c = dot(fin.tangent, M); // cos(θ/2) > 0 (demi-tour exclu)
    const diff = sub(fout.tangent, fin.tangent);
    const d = length(diff) > 1e-12 ? normalize(diff) : fin.normal;
    let nb: Vec3;
    if (mode === "upright" && Math.hypot(M.x, M.y) > 1e-6) {
      nb = normalize(sub(v3(0, 0, 1), scale(M, M.z)));
      nb = normalize(sub(nb, scale(M, dot(nb, M))));
    } else {
      nb = rotateMinimal(fin.binormal, fin.tangent, M);
      nb = normalize(sub(nb, scale(M, dot(nb, M))));
    }
    vframes.push({ n: cross(nb, M), b: nb, d, stretch: 1 / c - 1 });
  }
  const place = (k: number, u: number, v: number, out: Float64Array, o: number): void => {
    const f = vframes[k]!;
    const P = path[k]!;
    let wx = u * f.n.x + v * f.b.x;
    let wy = u * f.n.y + v * f.b.y;
    let wz = u * f.n.z + v * f.b.z;
    if (f.stretch !== 0) {
      const t = f.stretch * (wx * f.d.x + wy * f.d.y + wz * f.d.z);
      wx += t * f.d.x;
      wy += t * f.d.y;
      wz += t * f.d.z;
    }
    out[o] = P.x + wx;
    out[o + 1] = P.y + wy;
    out[o + 2] = P.z + wz;
  };

  const sharpRow: boolean[] = [];
  for (let k = 0; k < m; k++) {
    sharpRow.push(k > 0 && k < m - 1 && dot(frames[k - 1]!.tangent, frames[k]!.tangent) < crease);
  }

  const b = new MeshBuilder();
  for (const r of shape.rings) {
    const n = r.length / 2;
    const pts = new Float64Array(3 * m * n);
    for (let k = 0; k < m; k++)
      for (let j = 0; j < n; j++) place(k, r[2 * j]!, r[2 * j + 1]!, pts, 3 * (k * n + j));
    addGrid(b, pts, m, n, sharpRow, sharpCorners(r, crease));
  }
  const c = shape.coords;
  const nc = c.length / 2;
  const start = new Float64Array(3 * nc);
  const end = new Float64Array(3 * nc);
  for (let q = 0; q < nc; q++) {
    place(0, c[2 * q]!, c[2 * q + 1]!, start, 3 * q);
    place(m - 1, c[2 * q]!, c[2 * q + 1]!, end, 3 * q);
  }
  const t0 = frames[0]!.tangent;
  const t1 = frames[frames.length - 1]!.tangent;
  addCap(b, start, shape.triangles, [-t0.x, -t0.y, -t0.z], true);
  addCap(b, end, shape.triangles, [t1.x, t1.y, t1.z], false);
  return b.build(options.localOrigin === true);
}
