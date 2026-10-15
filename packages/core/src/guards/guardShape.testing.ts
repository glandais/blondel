/**
 * Descripteur de forme d'une pièce de garde-corps relu dans le `Model` (chantier guard-marks,
 * G2a) : bords non décalés retrouvés depuis le solide. Fichier réservé aux tests.
 */
import type { Part } from "../model/derived.js";
import type { Vec3 } from "../model/primitives.js";
import { barShape, panelShape, prismShape, type GuardShape } from "./guardShape.js";
import { guardMarkKey, type GuardMarkEntry } from "./marks.js";
import type { GuardSection } from "./spec.js";

/**
 * Section relue dans la désignation `Part.section` (« Ø42 », « 40×40 », texte non traduit de
 * `sectionLabel`), ou `null`.
 */
function sectionOfPart(p: Part): GuardSection | null {
  const text = p.section?.params?.["text"];
  if (typeof text !== "string") return null;
  const round = /^Ø([\d.]+)$/.exec(text);
  if (round) return { kind: "round", diameter: Number(round[1]) };
  const rect = /^([\d.]+)×([\d.]+)$/.exec(text);
  if (rect) return { kind: "rect", width: Number(rect[1]), height: Number(rect[2]) };
  return null;
}

/**
 * Descripteur de forme d'une pièce de garde-corps : extrusion → prisme (profondeur), balayage →
 * barre (chemin = axe non décalé), surface réglée → panneau (bords non décalés `a + n·t/2`,
 * `b + n·t/2`, inverse du décalage de `panelMember`). `null` pour une autre pièce.
 */
export function guardShapeOfPart(p: Part): GuardShape | null {
  const s = p.solid;
  if (s.kind === "ruled") {
    const t = s.thickness;
    const unshift = (edge: readonly Vec3[]): Vec3[] =>
      edge.map((q, i) => ({
        x: q.x + (s.normals[i]!.x * t) / 2,
        y: q.y + (s.normals[i]!.y * t) / 2,
        z: q.z,
      }));
    return panelShape(unshift(s.a), unshift(s.b), t);
  }
  const section = sectionOfPart(p);
  if (!section) return null;
  if (s.kind === "extrusion") return prismShape(section, s.depth);
  if (s.kind === "sweep") return barShape(s.path, section);
  return null;
}

/**
 * Taille de tri du repérage (`marks.ts`) relue dans la pièce : hauteur d'un prisme, longueur 3D
 * d'une barre, aire nette d'un panneau (bords non décalés, formule de `panelMember`).
 */
export function guardSizeOfPart(p: Part): number | null {
  const s = p.solid;
  if (s.kind === "extrusion") return s.depth;
  if (s.kind === "sweep") {
    let l = 0;
    for (let i = 1; i < s.path.length; i++) {
      const a = s.path[i - 1]!;
      const b = s.path[i]!;
      l += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return l;
  }
  if (s.kind === "ruled") {
    const t = s.thickness;
    const un = (q: Vec3, i: number): Vec3 => ({
      x: q.x + (s.normals[i]!.x * t) / 2,
      y: q.y + (s.normals[i]!.y * t) / 2,
      z: q.z,
    });
    const bottom = s.a.map(un);
    const top = s.b.map(un);
    let area = 0;
    for (let i = 1; i < bottom.length; i++) {
      const l = Math.hypot(bottom[i]!.x - bottom[i - 1]!.x, bottom[i]!.y - bottom[i - 1]!.y);
      area += (l * (top[i - 1]!.z - bottom[i - 1]!.z + top[i]!.z - bottom[i]!.z)) / 2;
    }
    return area;
  }
  return null;
}

/** Entrée du repérage relue dans une pièce de garde-corps repérée (préfixe tiré du repère). */
export function guardMarkEntryOfPart(p: Part): GuardMarkEntry | null {
  const shape = guardShapeOfPart(p);
  const size = guardSizeOfPart(p);
  const prefix = /^[A-Z]+/.exec(p.mark)?.[0];
  if (!shape || size === null || !prefix) return null;
  return {
    id: p.id,
    prefix,
    key: guardMarkKey(prefix, p.name.key, p.material, shape),
    shape,
    size,
  };
}
