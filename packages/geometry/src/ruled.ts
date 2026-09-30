/**
 * Surface réglée entre deux polylignes 3D, épaissie horizontalement (limons courbes,
 * débillardés).
 */
import type { Mm, Vec2, Vec3 } from "@blondel/core";
import { signedVolume } from "./analysis.js";
import { GeometryError } from "./errors.js";
import { addCap, addGrid } from "./grid.js";
import { MeshBuilder, flipMesh, type Mesh } from "./mesh.js";
import { creaseCos, maxPathPoints, type MeshOptions } from "./options.js";
import { EPS } from "./polygon.js";
import { add, cross, dot, length, normalize, scale, sub, v3 } from "./vec3.js";

/**
 * Solide borné par la surface réglée (a[i], b[i]) et sa copie décalée de `thickness` selon
 * la normale horizontale `normals[i]` (normalisée ici). Section courante : parallélogramme
 * (a, b, b + e·n, a + e·n). L'orientation finale est corrigée par le signe du volume.
 *
 * Les rangées consécutives identiques (a, b et normale) sont fusionnées ; un bord immobile sur
 * plusieurs rangées (éventail autour d'un pivot) est admis. Lève `GeometryError` si une
 * section est plate (a = b, ou b − a parallèle à la normale) ou si le solide se replie sur
 * lui-même (sections successives d'orientations opposées : normales incohérentes).
 */
export function meshRuled(
  a: readonly Vec3[],
  b: readonly Vec3[],
  thickness: Mm,
  normals: readonly Vec2[],
  options: MeshOptions = {},
): Mesh {
  let m = a.length;
  if (m < 2 || b.length !== m || normals.length !== m) {
    throw new GeometryError(
      "surface réglée : polylignes a, b et normales de même longueur (≥ 2) attendues",
    );
  }
  if (m > maxPathPoints(options)) throw new GeometryError("surface réglée trop longue");
  if (!Number.isFinite(thickness)) throw new GeometryError("épaisseur non finie");
  const crease = creaseCos(options, 30);
  if (Math.abs(thickness) <= 1e-9) throw new GeometryError("surface réglée d'épaisseur nulle");
  const rows: number[][] = [];
  for (let i = 0; i < m; i++) {
    const n = normals[i]!;
    const l = Math.hypot(n.x, n.y);
    if (!(l > 0) || !Number.isFinite(l))
      throw new GeometryError(`surface réglée : normale nulle au point ${i}`);
    const ox = (n.x / l) * thickness,
      oy = (n.y / l) * thickness;
    const A = a[i]!,
      B = b[i]!;
    const row = [A.x, A.y, A.z, B.x, B.y, B.z, B.x + ox, B.y + oy, B.z, A.x + ox, A.y + oy, A.z];
    for (const c of row)
      if (!Number.isFinite(c)) throw new GeometryError("surface réglée : coordonnée non finie");
    // Section plate : aire du parallélogramme |(b − a) × e·n| nulle.
    const ab = v3(B.x - A.x, B.y - A.y, B.z - A.z);
    if (
      length(ab) <= EPS ||
      length(cross(ab, v3(ox, oy, 0))) <= 1e-9 * length(ab) * Math.abs(thickness)
    ) {
      throw new GeometryError(
        `surface réglée : section plate au point ${i} (a = b ou b − a parallèle à la normale)`,
      );
    }
    const prev = rows[rows.length - 1];
    if (prev && row.every((c, k) => Math.abs(c - prev[k]!) <= EPS)) continue; // rangée répétée
    rows.push(row);
  }
  m = rows.length;
  if (m < 2) throw new GeometryError("surface réglée : moins de 2 sections distinctes");
  const pts = new Float64Array(3 * 4 * m);
  rows.forEach((row, i) => pts.set(row, 12 * i));
  const pt = (i: number, j: number): Vec3 =>
    v3(pts[12 * i + 3 * j]!, pts[12 * i + 3 * j + 1]!, pts[12 * i + 3 * j + 2]!);
  const sharpRow: boolean[] = [];
  for (let i = 0; i < m; i++) {
    let sharp = false;
    if (i > 0 && i < m - 1) {
      for (const j of [0, 1]) {
        const d0 = normalize(sub(pt(i, j), pt(i - 1, j)));
        const d1 = normalize(sub(pt(i + 1, j), pt(i, j)));
        if (dot(d0, d1) < crease) sharp = true;
      }
    }
    sharpRow.push(sharp);
  }
  // Repli : l'orientation de chaque section (normale de son parallélogramme) doit avoir le
  // même signe par rapport à la direction d'avancement, d'un bout à l'autre.
  const sectionNormal = (i: number): Vec3 =>
    cross(sub(pt(i, 1), pt(i, 0)), sub(pt(i, 3), pt(i, 0)));
  const centroid = (i: number): Vec3 =>
    scale(add(add(pt(i, 0), pt(i, 1)), add(pt(i, 2), pt(i, 3))), 0.25);
  let sign = 0;
  for (let i = 0; i + 1 < m; i++) {
    const s = dot(add(sectionNormal(i), sectionNormal(i + 1)), sub(centroid(i + 1), centroid(i)));
    const si = s > 0 ? 1 : s < 0 ? -1 : 0;
    if (si === 0 || (sign !== 0 && si !== sign)) {
      throw new GeometryError(
        `surface réglée repliée entre les points ${i} et ${i + 1} (normales incohérentes ?)`,
      );
    }
    sign = si;
  }
  const mb = new MeshBuilder();
  addGrid(mb, pts, m, 4, sharpRow, [true, true, true, true]);
  const quad = [0, 1, 2, 0, 2, 3];
  for (const [i, reverse] of [
    [0, true],
    [m - 1, false],
  ] as const) {
    const cap = pts.slice(12 * i, 12 * i + 12);
    // Normale de Newell du quadrilatère (éventuellement gauche).
    const n = normalize(
      [0, 1, 2, 3].reduce(
        (acc, j) => {
          const p = pt(i, j),
            q = pt(i, (j + 1) % 4);
          return v3(
            acc.x + (p.y - q.y) * (p.z + q.z),
            acc.y + (p.z - q.z) * (p.x + q.x),
            acc.z + (p.x - q.x) * (p.y + q.y),
          );
        },
        v3(0, 0, 0),
      ),
    );
    const s = reverse ? -1 : 1;
    addCap(mb, cap, quad, [s * n.x, s * n.y, s * n.z], reverse);
  }
  const mesh = mb.build(options.localOrigin === true);
  return signedVolume(mesh) < 0 ? flipMesh(mesh) : mesh;
}
