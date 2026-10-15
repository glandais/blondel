/**
 * Descripteur de forme d'une pièce de garde-corps relu dans le `Model` (chantier guard-marks,
 * G2a) : bords non décalés retrouvés depuis le solide. Fichier réservé aux tests.
 */
import type { Part } from "../model/derived.js";
import type { Vec3 } from "../model/primitives.js";
import { barShape, panelShape, prismShape, type GuardShape } from "./guardShape.js";
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
