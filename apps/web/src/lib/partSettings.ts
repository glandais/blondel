/**
 * Réglages repris par l'inspecteur Pièce (maquette 2b, ADR-0009) pour une famille de pièces,
 * d'après la colonne « Aussi dans : Inspecteur pièce » de la spécification de contenu
 * (`docs/ux/design_handoff_parcours_guide_libre/rendus/contenu.txt` § 3). Présentation
 * seulement : des préfixes de chemins des paramètres du plugin de structure (mêmes chemins que
 * la section Structure, même validation) et la section du parcours libre qui les porte tous.
 * Le mode Fabrication y lit aussi l'encart « Forme du … » et la section de Conception qui porte
 * la forme de la pièce (`partShapeFor`, `partDesignSection`). Aucune valeur métier.
 *
 * Pièces de garde-corps (famille `guards`) : chemins du projet sous `guards` qui concernent la
 * catégorie de la pièce (poteau, main courante, balustre ou remplissage selon le type), aux
 * niveaux Conception et Atelier du dictionnaire des niveaux (`lib/paramTiers.ts`), mêmes chemins
 * et même validation que la section Garde-corps.
 */
import type { GuardsSpec, MaterialId, Part } from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import { paramKey, tierEntry } from "./paramTiers.js";
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
  /**
   * Pièce de garde-corps : chemins complets du projet des paramètres repris
   * (`["guards", "posts", "size"]`), dans l'ordre d'affichage, niveaux Conception et Atelier
   * seulement. Absent ou vide : aucun champ de garde-corps.
   */
  readonly guardParams?: readonly (readonly string[])[];
}

/** Chemin d'un paramètre de garde-corps (sous `guards`). */
const g = (...path: string[]): readonly string[] => ["guards", ...path];

/** Poteaux de garde-corps : section, entraxe, poteau d'angle, implantation (volée, trémie). */
const GUARD_POST_PARAMS: readonly (readonly string[])[] = [
  g("posts", "size"),
  g("posts", "maxSpacing"),
  g("posts", "cornerAngle"),
  g("flight", "edgeOffset"),
  g("opening", "setback"),
];

/** Mains courantes : section, hauteur, prolongements, dégagement au mur. */
const GUARD_HANDRAIL_PARAMS: readonly (readonly string[])[] = [
  g("handrail", "section"),
  g("handrail", "height"),
  g("handrail", "extensions", "bottom"),
  g("handrail", "extensions", "top"),
  g("handrail", "wallClearance"),
];

/** Remplissage selon son type (mêmes champs que la section Garde-corps pour ce type). */
function infillParams(kind: GuardsSpec["infill"]["kind"]): readonly (readonly string[])[] {
  const bottomGap = g("infill", "bottomGap");
  switch (kind) {
    case "balusters":
      return [g("infill", "spacing"), g("infill", "section"), bottomGap];
    case "rails":
      return [g("infill", "count"), g("infill", "section"), bottomGap];
    case "cables":
      return [g("infill", "count"), g("infill", "diameter"), bottomGap];
    case "glass":
    case "panel":
      return [g("infill", "thickness"), g("infill", "panelGap"), bottomGap];
    case "perforated":
      return [
        g("infill", "thickness"),
        g("infill", "panelGap"),
        g("infill", "holeDiameter"),
        bottomGap,
      ];
  }
}

/** Le paramètre est-il de niveau Conception ou Atelier (jamais Essentiel) ? */
function isDesignOrWorkshop(path: readonly string[]): boolean {
  const tier = tierEntry(paramKey(path))?.tier;
  return tier === "design" || tier === "workshop";
}

/**
 * Paramètres de garde-corps repris pour une pièce de la famille `guards` (catégorie de la pièce,
 * type de remplissage du projet), niveaux Conception et Atelier. Sans garde-corps : aucun.
 */
export function guardParamsFor(
  category: Part["category"],
  guards: GuardsSpec | undefined,
): readonly (readonly string[])[] {
  if (guards === undefined) return [];
  const paths =
    category === "post"
      ? GUARD_POST_PARAMS
      : category === "handrail"
        ? GUARD_HANDRAIL_PARAMS
        : category === "baluster" || category === "infill"
          ? infillParams(guards.infill.kind)
          : [];
  return paths.filter(isDesignOrWorkshop);
}

/** Portée affichée des réglages d'une pièce de garde-corps. */
function guardScope(category: Part["category"]): MessageKey {
  switch (category) {
    case "post":
      return "ui.partInspector.scope.guardPosts";
    case "handrail":
      return "ui.partInspector.scope.handrails";
    case "baluster":
    case "infill":
      return "ui.partInspector.scope.infill";
    default:
      return "ui.partInspector.scope.guards";
  }
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
 * bois, pièces sans famille de réglages). `guards` : garde-corps du projet, pour les champs
 * d'une pièce de garde-corps (le type de remplissage choisit les champs repris).
 */
export function partSettingsFor(
  part: Pick<Part, "category" | "family"> & { readonly material?: MaterialId },
  guards?: GuardsSpec,
): PartSettings | null {
  if (part.family === "guards") {
    return {
      scopeLabel: guardScope(part.category),
      structureParams: [],
      section: "guards",
      guardParams: guardParamsFor(part.category, guards),
    };
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

// ------------------------------------------------------------------ Forme de la pièce

/**
 * Encart « Forme du … » du mode Fabrication (wireframe « Parcours libre · Fabrication ») : ce
 * qui change la forme de la pièce relève de la Conception ; titre et aide adaptés à la pièce.
 */
export interface PartShape {
  /** Titre de l'encart (« Forme du limon »). */
  readonly title: MessageKey;
  /** Aide (« Épaisseur, rives, jour : réglages de conception. »). */
  readonly help: MessageKey;
}

type ShapedPart = Pick<Part, "category" | "family">;

/** Pièce de garde-corps : famille `guards`, ou barreau / remplissage hors famille. */
function isGuardPart(part: ShapedPart): boolean {
  return part.family === "guards" || part.category === "baluster" || part.category === "infill";
}

/** Titre et aide de l'encart « Forme du … » pour la pièce. */
export function partShapeFor(part: ShapedPart): PartShape {
  if (isGuardPart(part)) {
    return { title: "ui.fabAside.shape.guards", help: "ui.fabAside.shapeHelp.guards" };
  }
  switch (part.category) {
    case "stringer":
      return { title: "ui.fabAside.shape.stringer", help: "ui.fabAside.shapeHelp.stringer" };
    case "carriage":
      return { title: "ui.fabAside.shape.carriage", help: "ui.fabAside.shapeHelp.stringer" };
    case "support":
      return { title: "ui.fabAside.shape.support", help: "ui.fabAside.shapeHelp.support" };
    case "fixing":
      return { title: "ui.fabAside.shape.fixing", help: "ui.fabAside.shapeHelp.fixing" };
    case "post":
      return { title: "ui.fabAside.shape.post", help: "ui.fabAside.shapeHelp.post" };
    case "handrail":
      return { title: "ui.fabAside.shape.handrail", help: "ui.fabAside.shapeHelp.handrail" };
    case "tread":
      return { title: "ui.fabAside.shape.tread", help: "ui.fabAside.shapeHelp.tread" };
    case "riser":
      return { title: "ui.fabAside.shape.riser", help: "ui.fabAside.shapeHelp.tread" };
    case "landing":
      return { title: "ui.fabAside.shape.landing", help: "ui.fabAside.shapeHelp.tread" };
    default:
      return { title: "ui.fabAside.shape.part", help: "ui.fabAside.shapeHelp.part" };
  }
}

/**
 * Section du parcours libre qui porte la forme de la pièce (« ← Ouvrir dans Conception ») :
 * marches, contremarches et paliers → Marches ; garde-corps → Garde-corps ; le reste (limons,
 * supports, platines, poteaux, main courante du plugin) → Structure. Vaut aussi pour une pièce
 * sans réglages d'atelier repris (marches bois).
 */
export function partDesignSection(part: ShapedPart): SectionId {
  if (isGuardPart(part)) return "guards";
  switch (part.category) {
    case "tread":
    case "riser":
    case "landing":
      return "treads";
    default:
      return "structure";
  }
}
