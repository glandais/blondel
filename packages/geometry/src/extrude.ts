/**
 * Extrusion d'un profil plan (contour + trous) dans un repère 3D.
 */
import type { Frame3, Mm, Shape2 } from "@blondel/core";
import { GeometryError } from "./errors.js";
import { addCap, addGrid } from "./grid.js";
import { MeshBuilder, emptyMesh, flipMesh, type Mesh } from "./mesh.js";
import { creaseCos, type MeshOptions } from "./options.js";
import { prepareShape, sharpCorners } from "./polygon.js";

/**
 * Extrude `profile` (plan XY du repère) selon +Z du repère sur `depth` (négatif : selon −Z).
 * Faces avant/arrière triangulées (earcut), faces latérales à normales à plat par défaut
 * (arêtes vives). Profondeur nulle : maillage vide.
 */
export function meshExtrusion(frame: Frame3, profile: Shape2, depth: Mm, options: MeshOptions = {}): Mesh {
  if (!Number.isFinite(depth)) throw new GeometryError("profondeur d'extrusion non finie");
  if (Math.abs(depth) <= 1e-9) return emptyMesh();
  const crease = creaseCos(options, 0);
  const { origin: o, xAxis: X, yAxis: Y, zAxis: Z } = frame;
  checkFrame(frame);
  const shape = prepareShape(profile);
  const dx = Z.x * depth, dy = Z.y * depth, dz = Z.z * depth;
  const b = new MeshBuilder();

  // Faces latérales : une grille à 2 rangées par anneau.
  for (const r of shape.rings) {
    const n = r.length / 2;
    const pts = new Float64Array(6 * n);
    for (let j = 0; j < n; j++) {
      const u = r[2 * j]!, v = r[2 * j + 1]!;
      const x = o.x + u * X.x + v * Y.x, y = o.y + u * X.y + v * Y.y, z = o.z + u * X.z + v * Y.z;
      pts[3 * j] = x;
      pts[3 * j + 1] = y;
      pts[3 * j + 2] = z;
      pts[3 * (n + j)] = x + dx;
      pts[3 * (n + j) + 1] = y + dy;
      pts[3 * (n + j) + 2] = z + dz;
    }
    addGrid(b, pts, 2, n, [true, true], sharpCorners(r, crease));
  }

  // Bouchons : même calcul de positions que les faces latérales (soudure exacte).
  const c = shape.coords;
  const m = c.length / 2;
  const bottom = new Float64Array(3 * m);
  const top = new Float64Array(3 * m);
  for (let k = 0; k < m; k++) {
    const u = c[2 * k]!, v = c[2 * k + 1]!;
    const x = o.x + u * X.x + v * Y.x, y = o.y + u * X.y + v * Y.y, z = o.z + u * X.z + v * Y.z;
    bottom[3 * k] = x;
    bottom[3 * k + 1] = y;
    bottom[3 * k + 2] = z;
    top[3 * k] = x + dx;
    top[3 * k + 1] = y + dy;
    top[3 * k + 2] = z + dz;
  }
  // Normale géométrique des triangles CCW du plan XY : X × Y.
  let nx = X.y * Y.z - X.z * Y.y, ny = X.z * Y.x - X.x * Y.z, nz = X.x * Y.y - X.y * Y.x;
  const l = Math.hypot(nx, ny, nz);
  nx /= l;
  ny /= l;
  nz /= l;
  addCap(b, bottom, shape.triangles, [-nx, -ny, -nz], true);
  addCap(b, top, shape.triangles, [nx, ny, nz], false);

  const mesh = b.build();
  // Repère indirect ou profondeur négative : orientation retournée.
  const det = nx * Z.x + ny * Z.y + nz * Z.z;
  return det * depth < 0 ? flipMesh(mesh) : mesh;
}

/**
 * Rejette un repère inutilisable : coordonnée non finie, axes X et Y colinéaires (plan du
 * profil non défini) ou axe Z dans ce plan (extrusion plate). Le contrat `Frame3` promet des
 * axes orthonormés ; seules les dégénérescences qui casseraient le maillage sont vérifiées ici
 * (un repère légèrement non orthonormé reste maillé fidèlement, en affine).
 */
function checkFrame(frame: Frame3): void {
  const { origin: o, xAxis: X, yAxis: Y, zAxis: Z } = frame;
  for (const v of [o, X, Y, Z]) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
      throw new GeometryError("repère d'extrusion : coordonnée non finie");
    }
  }
  const nx = X.y * Y.z - X.z * Y.y, ny = X.z * Y.x - X.x * Y.z, nz = X.x * Y.y - X.y * Y.x;
  const lx = Math.hypot(X.x, X.y, X.z), ly = Math.hypot(Y.x, Y.y, Y.z), lz = Math.hypot(Z.x, Z.y, Z.z);
  const ln = Math.hypot(nx, ny, nz);
  if (!(ln > 1e-9 * lx * ly)) throw new GeometryError("repère d'extrusion dégénéré : axes X et Y colinéaires ou nuls");
  if (!(Math.abs(nx * Z.x + ny * Z.y + nz * Z.z) > 1e-9 * ln * lz)) {
    throw new GeometryError("repère d'extrusion dégénéré : axe Z nul ou dans le plan du profil");
  }
}
