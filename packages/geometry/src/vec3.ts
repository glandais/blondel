/**
 * Petite algèbre 3D interne (objets `Vec3` immuables de @blondel/core).
 */
import type { Vec3 } from "@blondel/core";

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : a;
};

/**
 * Rotation minimale (Rodrigues) amenant le vecteur unitaire `from` sur `to`, appliquée à `v`.
 * `from` et `to` ne doivent pas être opposés (vérifié par l'appelant).
 */
export function rotateMinimal(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = length(axis);
  const c = dot(from, to);
  if (s < 1e-15) return v;
  const k = scale(axis, 1 / s);
  const kv = cross(k, v);
  const kdv = dot(k, v);
  return v3(
    v.x * c + kv.x * s + k.x * kdv * (1 - c),
    v.y * c + kv.y * s + k.y * kdv * (1 - c),
    v.z * c + kv.z * s + k.z * kdv * (1 - c),
  );
}
