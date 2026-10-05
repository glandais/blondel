/**
 * Réglages repris par l'inspecteur Pièce (maquette 2b, ADR-0009) pour une famille de pièces,
 * d'après la colonne « Aussi dans : Inspecteur pièce » de la spécification de contenu
 * (`docs/ux/design_handoff_parcours_guide_libre/rendus/contenu.txt` § 3). Présentation
 * seulement : des préfixes de chemins des paramètres du plugin de structure (mêmes chemins que
 * la section Structure, même validation) et la section du parcours libre qui les porte tous.
 * Aucune valeur métier.
 */
import type { MaterialId, Part } from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import type { SectionId } from "./sectionIds.js";

export interface PartSettings {
  /** Portée des réglages, affichée en regard du titre du bloc (« communs aux limons »). */
  readonly scopeLabel: MessageKey;
  /**
   * Préfixes des chemins de paramètres du plugin de structure (joints par des points) : un
   * champ est repris si son chemin est l'un d'eux ou commence par l'un d'eux suivi d'un point.
   * Vide : aucun champ repris (le bloc se réduit au lien vers la section).
   */
  readonly structureParams: readonly string[];
  /** Section du parcours libre qui porte tous les réglages (« Tous les réglages dans … »). */
  readonly section: SectionId;
}

/** Réglages des limons et crémaillères (section, épaisseur, dépassements, prolongements…). */
const STRINGER_PARAMS: readonly string[] = [
  "section",
  "thickness",
  "upperOffset",
  "lowerOffset",
  "startExtension",
  "endExtension",
  "splice",
  "housingDepth",
  // Limon débillardé (steel-curved) et limons de l'hélicoïdal à fût (helical-core).
  "curved",
  "innerStringer",
  "outerStringer",
];

/** Tôle et acier : matériaux des marches et contremarches pliées. */
function isSteel(material: MaterialId | undefined): boolean {
  return (
    material !== undefined && (material.startsWith("steel") || material.startsWith("stainless"))
  );
}

/**
 * Réglages repris pour la pièce, `null` si l'inspecteur n'en reprend aucun (marches et paliers
 * bois, pièces sans famille de réglages).
 */
export function partSettingsFor(
  part: Pick<Part, "category" | "family"> & { readonly material?: MaterialId },
): PartSettings | null {
  if (part.family === "guards") {
    return { scopeLabel: "ui.partInspector.scope.guards", structureParams: [], section: "guards" };
  }
  switch (part.category) {
    case "stringer":
      return {
        scopeLabel: "ui.partInspector.scope.stringers",
        structureParams: STRINGER_PARAMS,
        section: "structure",
      };
    case "carriage":
      return {
        scopeLabel: "ui.partInspector.scope.carriages",
        structureParams: STRINGER_PARAMS,
        section: "structure",
      };
    case "post":
      // Poteau de la structure (poteau d'angle `newel`, fût de l'hélicoïdal `column`).
      return {
        scopeLabel: "ui.partInspector.scope.posts",
        structureParams: ["newel", "column"],
        section: "structure",
      };
    case "support":
      return {
        scopeLabel: "ui.partInspector.scope.supports",
        structureParams: ["supports"],
        section: "structure",
      };
    case "fixing":
      return {
        scopeLabel: "ui.partInspector.scope.plates",
        structureParams: ["plates"],
        section: "structure",
      };
    case "handrail":
      // Main courante portée par le plugin (hélicoïdal à fût) : réglages `handrail`.
      return {
        scopeLabel: "ui.partInspector.scope.handrails",
        structureParams: ["handrail"],
        section: "structure",
      };
    case "tread":
    case "riser":
      // Marches et contremarches en tôle pliée (et marches acier de l'hélicoïdal à fût).
      return isSteel(part.material)
        ? {
            scopeLabel: "ui.partInspector.scope.folded",
            structureParams: ["folded", "treads"],
            section: "structure",
          }
        : null;
    default:
      return null;
  }
}

/** Le chemin de paramètre `path` est-il repris par l'un des préfixes ? */
export function matchesSettings(path: readonly string[], prefixes: readonly string[]): boolean {
  const key = path.join(".");
  return prefixes.some((p) => key === p || key.startsWith(`${p}.`));
}
