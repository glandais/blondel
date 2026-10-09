/**
 * Pièces fabriquées d'un lot (QUESTIONS A33 (e), `Part.componentOf`) : une pièce finie faite de
 * composantes (poutre de limon central bois en couches empilées) ne porte ni débit ni grandeurs
 * de matière, ses composantes les portent. Les comptes de pièces, de matière et de surface
 * (liste et fiche de débit, comparateur de variantes, chiffres du projet) portent donc sur les
 * pièces fabriquées : toutes, sauf une pièce finie dont des composantes sont dans le lot.
 * La scène 3D et le glTF font l'inverse (pièce finie dessinée, composantes non dessinées).
 */
import type { Part } from "../model/derived.js";

/** Pièces fabriquées : toutes, sauf une pièce finie dont des composantes sont dans le lot. */
export function fabricatedParts<P extends Pick<Part, "id" | "componentOf">>(
  parts: readonly P[],
): readonly P[] {
  const assemblies = new Set<string>();
  for (const p of parts) if (p.componentOf !== undefined) assemblies.add(p.componentOf);
  return assemblies.size === 0 ? parts : parts.filter((p) => !assemblies.has(p.id));
}
