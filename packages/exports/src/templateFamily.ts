/**
 * Familles de gabarits 1:1 du dossier PDF (QUESTIONS A20, décision du 2026-09-29) : limons et
 * structure, marches, garde-corps. Le dossier « complet » garde toutes les familles ; un dossier
 * filtré ne tuile que les gabarits des familles choisies (recouvrement des cases fixe, 10 mm).
 *
 * Classement : pièces des garde-corps et mains courantes par leur identifiant (`guard-…`,
 * `handrail-…`, convention de `guards/compute.ts` du cœur) ou leur catégorie (main courante,
 * balustre, remplissage) ; marches, contremarches et paliers ; tout le reste (limons,
 * crémaillères, poteaux, supports, platines) = limons et structure.
 */
import type { Part } from "@blondel/core";

export type TemplateFamily = "stringers" | "treads" | "guards";

export const TEMPLATE_FAMILIES: readonly TemplateFamily[] = ["stringers", "treads", "guards"];

export const TEMPLATE_FAMILY_LABELS: Readonly<Record<TemplateFamily, string>> = {
  stringers: "Limons et structure",
  treads: "Marches",
  guards: "Garde-corps",
};

/** Famille de gabarit d'une pièce. */
export function templateFamily(part: Pick<Part, "id" | "category">): TemplateFamily {
  if (
    part.id.startsWith("guard-") ||
    part.id.startsWith("handrail-") ||
    part.category === "handrail" ||
    part.category === "baluster" ||
    part.category === "infill"
  ) {
    return "guards";
  }
  if (part.category === "tread" || part.category === "riser" || part.category === "landing") {
    return "treads";
  }
  return "stringers";
}
