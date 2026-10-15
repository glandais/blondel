/**
 * Invariant des repères pour les tests (chantier part-marks R2b et R2c, décisions F10 Q3, Q5,
 * Q6, (27), convention C3) : un repère = une ligne de débit = un développé = une désignation.
 * Fichier réservé aux tests.
 */
import { messageEquals } from "@blondel/i18n";
import { expect } from "vitest";
import type { Model, Part } from "../model/derived.js";
import { QUANTITY_BUTT_WELD_MM, QUANTITY_WELD_MM } from "./steelCommon.js";
import { drillingPositions } from "./supports.js";

/** Grandeurs d'assemblage, propres à chaque pièce en place (gardées par `unifyMarkGroup`). */
const ASSEMBLY = new Set<string>([QUANTITY_WELD_MM, QUANTITY_BUTT_WELD_MM]);

const cutQuantities = (p: Part): Record<string, number> =>
  Object.fromEntries(Object.entries(p.quantities).filter(([k]) => !ASSEMBLY.has(k)));

/** Repères portés par deux pièces ou plus, hors garde-corps (statu quo D1, décision Q4). */
export function sharedMarks(parts: readonly Part[]): Map<string, Part[]> {
  const out = new Map<string, Part[]>();
  for (const p of parts) {
    if (p.family === "guards") continue;
    out.set(p.mark, [...(out.get(p.mark) ?? []), p]);
  }
  for (const [k, g] of out) if (g.length < 2) out.delete(k);
  return out;
}

/**
 * Toutes les pièces d'un même repère (hors garde-corps) ont même catégorie, matériau, section et
 * désignation commune (`markName`), et des cotes de débit identiques : `stock`, `quantities` hors
 * grandeurs d'assemblage, `flat` en entier (texte de référence commun, décision F10 Q5),
 * positions des perçages (décision (27)).
 */
export function expectMarksUnified(model: Pick<Model, "parts">): void {
  for (const [mark, g] of sharedMarks(model.parts)) {
    const [r, ...rest] = g;
    for (const p of rest) {
      const at = `${mark} : ${r!.id} / ${p.id}`;
      expect(p.category, at).toBe(r!.category);
      expect(p.material, at).toBe(r!.material);
      expect(
        p.section === r!.section ||
          (p.section !== undefined &&
            r!.section !== undefined &&
            messageEquals(p.section, r!.section)),
        at,
      ).toBe(true);
      expect(p.stock, at).toEqual(r!.stock);
      expect(cutQuantities(p), at).toEqual(cutQuantities(r!));
      expect(p.flat, at).toEqual(r!.flat);
      expect(p.markName, at).toEqual(r!.markName);
      expect(drillingPositions(p), at).toEqual(drillingPositions(r!));
    }
  }
}

/** Préfixes des repères attribués par identité (`markGroups`) : pièces à désignation commune. */
export const IDENTITY_MARK_PREFIXES: readonly string[] = [
  "CR",
  "PS",
  "PF",
  "PH",
  "PP",
  "PA",
  "CO",
  "SP",
  "AP",
  "EC",
  "SH",
  "SB",
];

/**
 * Désignation commune (décision F10 Q6) : chaque pièce d'un repère attribué par identité
 * (`IDENTITY_MARK_PREFIXES`, hors garde-corps et repères de position du limon central bois)
 * porte `markName`, la même pour toutes les pièces du repère, ainsi que le même texte de
 * référence de développé (Q5). Rend le nombre de pièces vérifiées.
 */
export function expectMarkNames(model: Pick<Model, "parts">): number {
  const byMark = new Map<string, Part[]>();
  let checked = 0;
  for (const p of model.parts) {
    // Garde-corps (statu quo D1, Q4) et repères de position du limon central bois (C5, mêmes
    // préfixes PP, SP… mais attribués par position, pas par identité) : hors invariant.
    if (p.family === "guards" || p.id.startsWith("wood-central-")) continue;
    const prefix = /^[A-Z]+/.exec(p.mark)?.[0] ?? "";
    if (!IDENTITY_MARK_PREFIXES.includes(prefix) || !/^[A-Z]+\d+$/.test(p.mark)) continue;
    expect(p.markName, `${p.mark} ${p.id} : markName`).toBeDefined();
    byMark.set(p.mark, [...(byMark.get(p.mark) ?? []), p]);
    checked++;
  }
  for (const [mark, g] of byMark) {
    const [r, ...rest] = g;
    for (const p of rest) {
      expect(messageEquals(p.markName!, r!.markName!), `${mark} : ${r!.id} / ${p.id}`).toBe(true);
      expect(p.flat?.reference, `${mark} : ${r!.id} / ${p.id}`).toEqual(r!.flat?.reference);
    }
  }
  return checked;
}

/** Encombrement (étendues en x et en y) du contour d'un développé, dans son repère. */
function flatExtents(p: Part): readonly [number, number] | null {
  const outer = p.flat?.outline.outer;
  if (!outer || outer.length === 0) return null;
  const xs = outer.map((q) => q.x);
  const ys = outer.map((q) => q.y);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/**
 * Pièces logées entre deux faces (entretoises `EC`, décision F10 Q3 : débit sur la plus petite) :
 * le développé débité de chaque membre d'un repère partagé n'est, cote par cote (étendues en x et
 * en y de son contour), pas plus grand que celui de la pièce réelle (`real` : même projet à
 * T = 0), à `eps` près.
 */
export function expectFittedNotLarger(
  model: Pick<Model, "parts">,
  real: Pick<Model, "parts">,
  eps: number,
  prefix = "EC",
): number {
  const own = new Map(real.parts.map((p) => [p.id, p]));
  let checked = 0;
  for (const [mark, g] of sharedMarks(model.parts)) {
    if (!mark.startsWith(prefix)) continue;
    for (const p of g) {
      const cut = flatExtents(p);
      const r = own.get(p.id);
      const fit = r ? flatExtents(r) : null;
      if (!cut || !fit) continue;
      expect(cut[0], `${mark} ${p.id} x`).toBeLessThanOrEqual(fit[0] + eps);
      expect(cut[1], `${mark} ${p.id} y`).toBeLessThanOrEqual(fit[1] + eps);
      checked++;
    }
  }
  return checked;
}
