/**
 * Descripteur de forme d'une pièce de garde-corps relu dans le `Model` (chantier guard-marks,
 * G2a) : bords non décalés retrouvés depuis le solide ; débit réel de la pièce et invariants du
 * repérage (G2c : débit du représentant jamais plus grand, un repère = un groupe). Fichier
 * réservé aux tests.
 */
import { expect } from "vitest";
import type { Model, Part } from "../model/derived.js";
import type { Vec3 } from "../model/primitives.js";
import { barShape, panelShape, prismShape, sameGuardShape, type GuardShape } from "./guardShape.js";
import { groupGuardMarks, guardMarkKey, type GuardMarkEntry } from "./marks.js";
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

/**
 * Débit réel d'une pièce de garde-corps relu dans son solide (le solide reste celui de la pièce
 * en place, CG3) : `[longueur, largeur, épaisseur]` — hauteur d'un prisme ou longueur 3D d'une
 * barre et cotes de leur section ; longueur en plan, hauteur maximale et épaisseur d'un panneau
 * (bords non décalés, formules de `panelMember`). `null` pour une autre pièce.
 */
export function guardRealStock(p: Part): readonly [number, number, number] | null {
  const s = p.solid;
  if (s.kind === "ruled") {
    const t = s.thickness;
    const un = (q: Vec3, i: number): Vec3 => ({
      x: q.x + (s.normals[i]!.x * t) / 2,
      y: q.y + (s.normals[i]!.y * t) / 2,
      z: q.z,
    });
    const bottom = s.a.map(un);
    const top = s.b.map(un);
    let length = 0;
    for (let i = 1; i < bottom.length; i++) {
      length += Math.hypot(bottom[i]!.x - bottom[i - 1]!.x, bottom[i]!.y - bottom[i - 1]!.y);
    }
    return [length, Math.max(...top.map((q, i) => q.z - bottom[i]!.z)), t];
  }
  const section = sectionOfPart(p);
  const size = guardSizeOfPart(p);
  if (!section || size === null) return null;
  const w = section.kind === "round" ? section.diameter : section.width;
  const h = section.kind === "round" ? section.diameter : section.height;
  return [size, Math.max(w, h), Math.min(w, h)];
}

/**
 * Garde du représentant (CG3, CG4) : le débit recopié de chaque pièce de garde-corps repérée dont
 * le préfixe est dans `prefixes` n'est, cote par cote, pas plus grand que son débit réel
 * (`guardRealStock`), à `eps` près. Rend le nombre de pièces vérifiées.
 */
export function expectGuardStockNotLarger(
  model: Pick<Model, "parts">,
  eps: number,
  prefixes: readonly string[] = ["PN"],
): number {
  let checked = 0;
  for (const p of model.parts) {
    if (p.family !== "guards") continue;
    const prefix = /^[A-Z]+/.exec(p.mark)?.[0] ?? "";
    if (!prefixes.includes(prefix)) continue;
    const real = guardRealStock(p);
    expect(real, `${p.mark} ${p.id} : débit réel`).not.toBeNull();
    expect(p.stock, `${p.mark} ${p.id} : débit`).toBeDefined();
    const cut = [p.stock!.length, p.stock!.width, p.stock!.thickness];
    cut.forEach((v, k) => {
      expect(v, `${p.mark} ${p.id} cote ${k}`).toBeLessThanOrEqual(real![k]! + eps);
    });
    checked++;
  }
  return checked;
}

/**
 * Règle du repérage (G2b) : chaque repère de garde-corps est un seul groupe autour de son ancre
 * (recalculée par `groupGuardMarks` à `T`), et aucune paire d'ancres de repères distincts de même
 * clé n'est identique à `T`. Rend les paires d'ancres identiques (`MC1~MC2`), attendues vides.
 */
export function expectGuardMarksOneGroup(
  model: Pick<Model, "parts">,
  T: number,
  at = "",
): string[] {
  const marks = new Map<string, Part[]>();
  for (const p of model.parts) {
    if (p.family !== "guards") continue;
    marks.set(p.mark, [...(marks.get(p.mark) ?? []), p]);
  }
  const anchors: { mark: string; entry: GuardMarkEntry }[] = [];
  for (const [mark, ps] of marks) {
    const entries = ps.map((x) => {
      const e = guardMarkEntryOfPart(x);
      expect(e, `${at} ${x.id}`).not.toBeNull();
      return e!;
    });
    const groups = groupGuardMarks(entries, T);
    expect(groups, `${at} ${mark}`).toHaveLength(1);
    const anchor = entries[groups[0]!.anchor]!;
    for (const e of entries) {
      expect(sameGuardShape(anchor.shape, e.shape, T), `${at} ${mark} ${e.id}`).toBe(true);
    }
    anchors.push({ mark, entry: anchor });
  }
  const near: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i]!;
      const b = anchors[j]!;
      if (a.entry.key !== b.entry.key) continue;
      if (sameGuardShape(a.entry.shape, b.entry.shape, T)) near.push(`${at} ${a.mark}~${b.mark}`);
    }
  }
  return near;
}
