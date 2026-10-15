/**
 * Invariant des repères pour les tests (chantier part-marks R2b, décision F10 Q3, convention
 * C3) : un repère = une ligne de débit. Fichier réservé aux tests.
 */
import { messageEquals } from "@blondel/i18n";
import { expect } from "vitest";
import type { Model, Part } from "../model/derived.js";
import { QUANTITY_BUTT_WELD_MM, QUANTITY_WELD_MM } from "./steelCommon.js";

/** Grandeurs d'assemblage, propres à chaque pièce en place (gardées par `unifyMarkGroup`). */
const ASSEMBLY = new Set<string>([QUANTITY_WELD_MM, QUANTITY_BUTT_WELD_MM]);

const cutQuantities = (p: Part): Record<string, number> =>
  Object.fromEntries(Object.entries(p.quantities).filter(([k]) => !ASSEMBLY.has(k)));

/** Développé sans son texte de référence (qui nomme encore la pièce porteuse : R2c, Q5). */
const flatWithoutReference = (p: Part): unknown => {
  if (!p.flat) return undefined;
  const { reference: _reference, ...rest } = p.flat;
  return rest;
};

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
 * Toutes les pièces d'un même repère (hors garde-corps) ont même catégorie, matériau et section,
 * et des cotes de débit identiques : `stock`, `quantities` hors grandeurs d'assemblage, `flat`
 * hors texte de référence.
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
      expect(flatWithoutReference(p), at).toEqual(flatWithoutReference(r!));
    }
  }
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
