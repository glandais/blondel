/**
 * Générateurs fast-check partagés par les tests du package (non exporté par index.ts).
 */
import fc from "fast-check";
import type { Frame3, Polygon2, Shape2, Vec2 } from "@blondel/core";

/** Polygone étoilé simple (CCW) autour de l'origine, rayons dans [rMin, rMax]. */
export function starPolygon(rMin: number, rMax: number, minPts = 3, maxPts = 24): fc.Arbitrary<Polygon2> {
  return fc
    .array(fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: rMin, max: rMax, noNaN: true })), {
      minLength: minPts,
      maxLength: maxPts,
    })
    .map((raw) => {
      const n = raw.length;
      // Angles strictement croissants : un secteur par point, position aléatoire dans le secteur.
      return raw.map(([t, r], i): Vec2 => {
        const a = ((i + 0.1 + 0.8 * t) / n) * 2 * Math.PI;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      });
    });
}

/** Rectangle centré en (cx, cy), CCW. */
export function rect(cx: number, cy: number, w: number, h: number): Polygon2 {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

/**
 * Profil étoilé (rayons ≥ 100, ≥ 8 points) avec 0 à 4 trous rectangulaires (un par quadrant,
 * inscrits dans le disque de rayon 70), orientés au hasard.
 */
export const shapeWithHoles: fc.Arbitrary<Shape2> = fc
  .tuple(
    starPolygon(100, 400, 8), // ≥ 8 points : cercle inscrit de rayon ≥ 76 > 64 (trous inclus)
    fc.array(fc.tuple(fc.double({ min: 5, max: 40, noNaN: true }), fc.double({ min: 5, max: 40, noNaN: true }), fc.boolean()), {
      maxLength: 4,
    }),
  )
  .map(([outer, holes]) => ({
    outer,
    holes: holes.map(([w, h, rev], q) => {
      const cx = q % 2 === 0 ? 25 : -25;
      const cy = q < 2 ? 25 : -25;
      const r = rect(cx, cy, w, h);
      return rev ? [...r].reverse() : r;
    }),
  }));

/** Repère orthonormé aléatoire (quaternion), direct ou indirect. */
export const frame3: fc.Arbitrary<Frame3> = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.tuple(fc.double({ min: -5000, max: 5000, noNaN: true }), fc.double({ min: -5000, max: 5000, noNaN: true }), fc.double({ min: -5000, max: 5000, noNaN: true })),
    fc.boolean(),
  )
  .filter(([a, b, c, d]) => Math.hypot(a, b, c, d) > 0.1)
  .map(([a0, b0, c0, d0, [ox, oy, oz], indirect]) => {
    const l = Math.hypot(a0, b0, c0, d0);
    const [w, x, y, z] = [a0 / l, b0 / l, c0 / l, d0 / l];
    const X = { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) };
    const Y = { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) };
    const Z = { x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y) };
    const s = indirect ? -1 : 1;
    return { origin: { x: ox, y: oy, z: oz }, xAxis: X, yAxis: Y, zAxis: { x: s * Z.x, y: s * Z.y, z: s * Z.z } };
  });

export const identityFrame: Frame3 = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
};

/** Écart relatif. */
export const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

/** Plus petit produit scalaire entre la normale géométrique d'un triangle et celles de ses sommets. */
export function minNormalAgreement(mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array }): number {
  const p = mesh.positions, n = mesh.normals, idx = mesh.indices;
  let min = 1;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const ux = p[3 * b]! - p[3 * a]!, uy = p[3 * b + 1]! - p[3 * a + 1]!, uz = p[3 * b + 2]! - p[3 * a + 2]!;
    const vx = p[3 * c]! - p[3 * a]!, vy = p[3 * c + 1]! - p[3 * a + 1]!, vz = p[3 * c + 2]! - p[3 * a + 2]!;
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const l = Math.hypot(fx, fy, fz);
    if (l < 1e-6) continue; // triangle (quasi) dégénéré : normale non significative
    fx /= l; fy /= l; fz /= l;
    for (const v of [a, b, c]) min = Math.min(min, fx * n[3 * v]! + fy * n[3 * v + 1]! + fz * n[3 * v + 2]!);
  }
  return min;
}
