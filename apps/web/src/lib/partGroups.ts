/**
 * Liste des pièces du mode Fabrication (ADR-0009, vague 4) : regroupement des pièces du modèle
 * par famille d'atelier (Limons, Marches, Contremarches, Supports, Platines, Poteaux,
 * Garde-corps, Autres), résumés de repères et de matériau, filtre texte.
 *
 * Présentation seulement : famille, catégorie, repère, matériau et débit viennent du modèle du
 * cœur ; rien n'est calculé ici. La visserie n'est pas une pièce du modèle : aucun groupe.
 */
import type { Part } from "@blondel/core";
import { materialLabel } from "@blondel/exports";
import type { MessageKey, Translator } from "@blondel/i18n";
import { numberFormat } from "../i18n/locale.js";

export type PartGroupId =
  "stringers" | "treads" | "risers" | "supports" | "plates" | "posts" | "guards" | "other";

/** Ordre d'affichage des groupes. */
export const PART_GROUP_ORDER: readonly PartGroupId[] = [
  "stringers",
  "treads",
  "risers",
  "supports",
  "plates",
  "posts",
  "guards",
  "other",
];

/** Nom affiché de chaque groupe. */
export const PART_GROUP_KEYS: Readonly<Record<PartGroupId, MessageKey>> = {
  stringers: "ui.fab.group.stringers",
  treads: "ui.fab.group.treads",
  risers: "ui.fab.group.risers",
  supports: "ui.fab.group.supports",
  plates: "ui.fab.group.plates",
  posts: "ui.fab.group.posts",
  guards: "ui.fab.group.guards",
  other: "ui.fab.group.other",
};

/**
 * Groupe d'une pièce : toute pièce de la famille garde-corps va dans « Garde-corps » ; les
 * autres sont rangées par catégorie (une main courante de structure va dans « Autres »).
 */
export function partGroupOf(part: Pick<Part, "family" | "category">): PartGroupId {
  if (part.family === "guards") return "guards";
  switch (part.category) {
    case "stringer":
    case "carriage":
      return "stringers";
    case "tread":
    case "landing":
      return "treads";
    case "riser":
      return "risers";
    case "support":
      return "supports";
    case "fixing":
      return "plates";
    case "post":
      return "posts";
    default:
      return "other";
  }
}

export interface PartGroup {
  readonly id: PartGroupId;
  /** Pièces du groupe, dans l'ordre du modèle. */
  readonly parts: readonly Part[];
  /** Repères distincts, dans l'ordre du modèle. */
  readonly marks: readonly string[];
}

/** Groupes non vides, dans l'ordre `PART_GROUP_ORDER`. */
export function groupParts(parts: readonly Part[]): readonly PartGroup[] {
  const byGroup = new Map<PartGroupId, Part[]>();
  for (const p of parts) {
    const id = partGroupOf(p);
    const list = byGroup.get(id);
    if (list) list.push(p);
    else byGroup.set(id, [p]);
  }
  return PART_GROUP_ORDER.flatMap((id) => {
    const list = byGroup.get(id);
    if (!list) return [];
    return [{ id, parts: list, marks: [...new Set(list.map((p) => p.mark))] }];
  });
}

/** Séparateur des résumés (invariant, sans lettre). */
export const SUMMARY_SEPARATOR = " · ";

/**
 * Résumé des repères : « LE1 · LE2 · LD1 » jusqu'à `max` repères, au-delà le premier et le
 * dernier (« M1 … M15 »).
 */
export function marksSummary(marks: readonly string[], max = 5): string {
  if (marks.length <= max) return marks.join(SUMMARY_SEPARATOR);
  return `${marks[0] ?? ""} … ${marks[marks.length - 1] ?? ""}`;
}

/**
 * Résumé du matériau d'un groupe : « chêne 40 » quand le matériau et l'épaisseur de débit sont
 * communs à toutes les pièces, le matériau seul s'il est commun, sinon chaîne vide.
 */
export function materialSummary(parts: readonly Part[], t: Translator): string {
  const materials = new Set(parts.map((p) => p.material));
  const [material] = materials;
  if (materials.size !== 1 || material === undefined) return "";
  const label = materialLabel(t, material).toLocaleLowerCase(t.locale);
  const thicknesses = new Set(parts.map((p) => p.stock?.thickness));
  const [thickness] = thicknesses;
  if (thicknesses.size !== 1 || thickness === undefined || !Number.isFinite(thickness)) {
    return label;
  }
  return t.t("ui.fab.group.materialThickness", {
    material: label,
    thickness: numberFormat(t.locale, { maximumFractionDigits: 1 }).format(thickness),
  });
}

/** Catégories du remplissage d'un garde-corps (matériau principal du groupe). */
const INFILL_CATEGORIES: ReadonlySet<Part["category"]> = new Set(["infill", "baluster"]);

/**
 * Résumé de la matière d'un groupe :
 *
 * - section commune à toutes les pièces (profilés : « L 40 × 40 × 4 ») : la section, plus
 *   parlante que l'épaisseur de débit (encombrement du profilé) ;
 * - sinon `materialSummary` (« chêne 40 ») ;
 * - matériaux mélangés (garde-corps : poteaux, main courante, remplissage) : matériau du
 *   remplissage s'il est commun (« verre feuilleté »).
 */
export function stockSummary(parts: readonly Part[], t: Translator): string {
  const sections = new Set(parts.map((p) => (p.section ? t.t(p.section) : undefined)));
  const [section] = sections;
  if (sections.size === 1 && section !== undefined && section !== "") return section;
  const material = materialSummary(parts, t);
  if (material !== "") return material;
  const infill = parts.filter((p) => INFILL_CATEGORIES.has(p.category));
  return infill.length > 0 && infill.length < parts.length ? stockSummary(infill, t) : "";
}

/** Ligne de résumé d'un groupe : repères, puis section ou matériau s'il est connu. */
export function groupSummary(group: PartGroup, t: Translator): string {
  return [marksSummary(group.marks), stockSummary(group.parts, t)]
    .filter((s) => s !== "")
    .join(SUMMARY_SEPARATOR);
}

/** Forme de comparaison : minuscules, sans accents. */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * La pièce répond-elle au filtre ? Recherche dans le repère, la désignation traduite, le
 * matériau et la section, sans tenir compte de la casse ni des accents. Filtre vide : oui.
 */
export function matchesPartFilter(part: Part, query: string, t: Translator): boolean {
  const q = foldText(query.trim());
  if (q === "") return true;
  const haystack = [
    part.mark,
    t.t(part.name),
    materialLabel(t, part.material),
    part.section ? t.t(part.section) : "",
  ];
  return haystack.some((s) => foldText(s).includes(q));
}
