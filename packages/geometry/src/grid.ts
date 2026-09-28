/**
 * Constructeurs internes : grille de quadrilatères (faces latérales) et bouchons triangulés.
 */
import type { MeshBuilder } from "./mesh.js";
import { EPS } from "./polygon.js";

/**
 * Grille `rows × cols` de points 3D (`pts[3 * (i * cols + j)]`), fermée en j (anneau).
 * Chaque quadrilatère (i, j)–(i+1, j+1) donne les triangles
 * (P[i][j], P[i][j+1], P[i+1][j+1]) et (P[i][j], P[i+1][j+1], P[i+1][j]) : pour un anneau CCW
 * vu depuis +T (T = direction des i croissants), la normale est sortante.
 *
 * Normales lissées par moyenne pondérée par l'aire des quadrilatères adjacents, sauf le long des
 * lignes vives : `sharpRow[i]` duplique les sommets de la rangée i, `sharpCol[j]` ceux de la
 * colonne j (arête vive).
 */
export function addGrid(
  b: MeshBuilder,
  pts: Float64Array,
  rows: number,
  cols: number,
  sharpRow: readonly boolean[],
  sharpCol: readonly boolean[],
): void {
  const first = b.vertexCount;
  // Sommet (i, j, si, sj) ; si / sj = 0 côté « avant », 1 côté « après » (confondus si lisse).
  const table = new Int32Array(rows * cols * 4).fill(-1);
  const vertex = (i: number, j: number, si: number, sj: number): number => {
    const ssi = sharpRow[i] ? si : 0;
    const ssj = sharpCol[j] ? sj : 0;
    const key = 4 * (i * cols + j) + 2 * ssi + ssj;
    let v = table[key]!;
    if (v < 0) {
      const k = 3 * (i * cols + j);
      v = b.addVertex(pts[k]!, pts[k + 1]!, pts[k + 2]!);
      table[key] = v;
    }
    return v;
  };
  const n = b.normals;
  const pos = b.positions;
  const P = (v: number, c: number): number => pos[3 * v + c]!;
  const same = (u: number, v: number): boolean =>
    u === v || Math.hypot(P(u, 0) - P(v, 0), P(u, 1) - P(v, 1), P(u, 2) - P(v, 2)) <= EPS;
  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % cols;
      const v00 = vertex(i, j, 1, 1);
      const v01 = vertex(i, j1, 1, 0);
      const v10 = vertex(i + 1, j, 0, 1);
      const v11 = vertex(i + 1, j1, 0, 0);
      // Triangles dont deux sommets sont confondus (surface réglée en éventail : un bord
      // immobile sur plusieurs rangées) omis : d'aire nulle, ils rendraient le maillage
      // dégénéré sans rien changer à la surface (leurs arêtes non nulles se compensent).
      if (!same(v00, v01) && !same(v01, v11) && !same(v11, v00)) b.addTriangle(v00, v01, v11);
      if (!same(v00, v11) && !same(v11, v10) && !same(v10, v00)) b.addTriangle(v00, v11, v10);
      // Normale du quadrilatère (produit des diagonales, pondérée par l'aire), répartie
      // également sur ses 4 sommets : symétrique, contrairement à une somme par triangle.
      const ax = P(v11, 0) - P(v00, 0), ay = P(v11, 1) - P(v00, 1), az = P(v11, 2) - P(v00, 2);
      const bx = P(v10, 0) - P(v01, 0), by = P(v10, 1) - P(v01, 1), bz = P(v10, 2) - P(v01, 2);
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      for (const w of [v00, v01, v10, v11]) {
        n[3 * w] = n[3 * w]! + nx;
        n[3 * w + 1] = n[3 * w + 1]! + ny;
        n[3 * w + 2] = n[3 * w + 2]! + nz;
      }
    }
  }
  b.normalizeNormals(first, b.vertexCount);
}

/**
 * Bouchon plan : `pts` (3 flottants par point) et triangles d'indices locaux, normale unique
 * `normal` (à plat). `reverse` inverse l'orientation des triangles.
 */
export function addCap(
  b: MeshBuilder,
  pts: Float64Array,
  triangles: readonly number[],
  normal: readonly [number, number, number],
  reverse: boolean,
): void {
  const first = b.vertexCount;
  const [nx, ny, nz] = normal;
  for (let k = 0; k < pts.length; k += 3) b.addVertex(pts[k]!, pts[k + 1]!, pts[k + 2]!, nx, ny, nz);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = first + triangles[t]!, c = first + triangles[t + 1]!, d = first + triangles[t + 2]!;
    if (reverse) b.addTriangle(a, d, c);
    else b.addTriangle(a, c, d);
  }
}
