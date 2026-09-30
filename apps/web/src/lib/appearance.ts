/**
 * Apparence de la vue 3D par famille de pièces (jalon 6) : l'utilisateur essaie une essence ou
 * une finition (chêne, frêne, acier galvanisé…) sur les marches, la structure, les garde-corps
 * ou les mains courantes. **Aperçu de rendu seulement** : le projet, la nomenclature, les
 * masses et les exports gardent le matériau du modèle (`Part.material`), choisi dans les
 * panneaux Structure et Garde-corps. Choix de présentation, aucune règle métier.
 */
import type { MaterialId, PartCategory, PartFamilyId } from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import { MATERIAL_LABELS, type PaintZone } from "../three/materials.js";

export type PartFamily = "treads" | "structure" | "guards" | "handrails";

export const PART_FAMILIES: readonly PartFamily[] = ["treads", "structure", "guards", "handrails"];

/** Clés des libellés des familles de pièces. */
export const FAMILY_LABELS: Readonly<Record<PartFamily, MessageKey>> = {
  treads: "ui.label.partFamily.treads",
  structure: "ui.label.partFamily.structure",
  guards: "ui.label.partFamily.guards",
  handrails: "ui.label.partFamily.handrails",
};

/** Surcharges d'apparence par famille (absente : matériau du modèle). */
export type AppearanceOverrides = Readonly<Partial<Record<PartFamily, MaterialId>>>;

/** Matériaux proposés (tous ceux du modèle), dans l'ordre des libellés. */
export const APPEARANCE_MATERIALS: readonly MaterialId[] = Object.keys(
  MATERIAL_LABELS,
) as MaterialId[];

/** Pièce vue par l'apparence : catégorie et famille rendues par le cœur (`Part.family`). */
export interface AppearancePart {
  readonly category: PartCategory;
  readonly family?: PartFamilyId | undefined;
}

/**
 * Famille d'une pièce : mains courantes par catégorie ; sinon famille explicite du cœur
 * (`Part.family`, QUESTIONS D6 : garde-corps, marches, ossature), sans convention d'identifiant.
 * Pièce sans famille (modèle construit hors pipeline) : ossature.
 */
export function partFamily(part: AppearancePart): PartFamily {
  if (part.category === "handrail") return "handrails";
  if (part.family === "guards") return "guards";
  if (part.family === "treads") return "treads";
  return "structure";
}

/**
 * Zone de peinture d'une pièce (teintes enregistrées `Project.appearance`) : marches, garde-corps
 * (mains courantes comprises) ou ossature.
 */
export function paintZone(part: AppearancePart): PaintZone {
  const family = partFamily(part);
  if (family === "treads") return "treads";
  if (family === "guards" || family === "handrails") return "guards";
  return "structure";
}

/** Matériau affiché d'une pièce : surcharge de sa famille, sinon matériau du modèle. */
export function displayedMaterial(
  part: AppearancePart & { readonly material: MaterialId },
  overrides: AppearanceOverrides,
): MaterialId {
  return overrides[partFamily(part)] ?? part.material;
}

/**
 * Familles présentes dans le modèle, avec les matériaux du modèle de chacune (pour afficher
 * « matériau du projet : Chêne » dans la liste).
 */
export function familiesOf(
  parts: readonly (AppearancePart & { readonly material: MaterialId })[],
): readonly { readonly family: PartFamily; readonly materials: readonly MaterialId[] }[] {
  const found = new Map<PartFamily, Set<MaterialId>>();
  for (const p of parts) {
    const f = partFamily(p);
    let set = found.get(f);
    if (!set) found.set(f, (set = new Set()));
    set.add(p.material);
  }
  return PART_FAMILIES.filter((f) => found.has(f)).map((family) => ({
    family,
    materials: [...found.get(family)!],
  }));
}

/** Nouvelle table de surcharges : `material` `null` = retour au matériau du modèle. */
export function withAppearance(
  overrides: AppearanceOverrides,
  family: PartFamily,
  material: MaterialId | null,
): AppearanceOverrides {
  const next: Partial<Record<PartFamily, MaterialId>> = { ...overrides };
  if (material === null) delete next[family];
  else next[family] = material;
  return next;
}
