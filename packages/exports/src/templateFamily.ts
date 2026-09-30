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
import type { MessageKey } from "@blondel/i18n";
import { translatorOf, type Translator } from "./i18n.js";

export type TemplateFamily = "stringers" | "treads" | "guards";

export const TEMPLATE_FAMILIES: readonly TemplateFamily[] = ["stringers", "treads", "guards"];

/** Clé du libellé de chaque famille de gabarits (`template.family.*`). */
export const TEMPLATE_FAMILY_KEYS: Readonly<Record<TemplateFamily, MessageKey>> = {
  stringers: "template.family.stringers",
  treads: "template.family.treads",
  guards: "template.family.guards",
};

/** Libellé d'une famille de gabarits dans la langue du traducteur (défaut : français). */
export function templateFamilyLabel(
  family: TemplateFamily,
  t: Translator = translatorOf(),
): string {
  return t.t(TEMPLATE_FAMILY_KEYS[family]);
}

/** Libellés français (compatibilité) : `templateFamilyLabel(f)` en français. */
export const TEMPLATE_FAMILY_LABELS: Readonly<Record<TemplateFamily, string>> = {
  stringers: templateFamilyLabel("stringers"),
  treads: templateFamilyLabel("treads"),
  guards: templateFamilyLabel("guards"),
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
