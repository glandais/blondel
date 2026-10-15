/**
 * Réglages du repérage des pièces dans l'interface (lot « attribution des repères », décisions
 * F10 (21) et (30) ; chantier « repères de garde-corps », décision G-Q7) : chemin de la tolérance
 * d'identité des pièces repérées dans le profil d'atelier du projet
 * (`workshop.identicalPartTolerance`, défaut « à valider » du cœur), clés des rappels du
 * représentant d'un repère, une par règle (éléments d'interface sans chemin, préfixe `ui:` du
 * dictionnaire des niveaux), et conditions de présence.
 *
 * Lecture du projet et du modèle seulement : la valeur effective vient de
 * `resolveWorkshopProfile` du cœur, la présence des repères par identité de `Part.markName`
 * (désignation commune que le cœur pose sur toute pièce repérée par identité, décision F10 Q6),
 * les règles du représentant présentes de `markRepresentativeRules` du cœur (règle posée par le
 * cœur sur chaque pièce repérée, `Part.markRepresentative`). Aucun calcul métier.
 */
import {
  isValueValidated,
  markRepresentativeRules,
  resolveWorkshopProfile,
  type MarkRepresentativeRule,
  type Model,
  type Project,
} from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";

/** Chemin de la tolérance d'identité dans le projet (profil d'atelier, enregistré). */
export const IDENTICAL_TOLERANCE_PATH: readonly string[] = ["workshop", "identicalPartTolerance"];

/**
 * Clé du rappel « représentant d'un repère de barres (cornières, supports, garde-corps) : la plus
 * courte, à confirmer par un atelier » (décisions (30), G-Q7) dans le dictionnaire des niveaux et
 * dans `Project.validatedValues`. Clé et valeur (`shortest`) inchangées depuis R2d : les
 * validations enregistrées restent valides.
 */
export const MARK_REPRESENTATIVE_KEY = "ui:workshop.markRepresentative";

/**
 * Clé du rappel « représentant d'un repère de développés ou de panneaux : la plus petite par
 * l'aire nette, à confirmer par un atelier » (décision G-Q7).
 */
export const MARK_REPRESENTATIVE_AREA_KEY = "ui:workshop.markRepresentativeArea";

/** Clé de chaque règle du représentant (`Record` sur le type du cœur : exhaustif). */
export const MARK_REPRESENTATIVE_KEYS: Readonly<Record<MarkRepresentativeRule, string>> = {
  shortest: MARK_REPRESENTATIVE_KEY,
  smallestNetArea: MARK_REPRESENTATIVE_AREA_KEY,
};

/** Titre du rappel de chaque règle (nature des pièces du repère). */
export const MARK_REPRESENTATIVE_TITLE: Readonly<Record<MarkRepresentativeRule, MessageKey>> = {
  shortest: "ui.partMarks.representative",
  smallestNetArea: "ui.partMarks.representativeArea",
};

/**
 * Libellé de chaque règle du représentant : un `Record` sur le type du cœur, pour qu'une règle
 * ajoutée ou changée dans le cœur ne compile pas sans son texte.
 */
export const MARK_REPRESENTATIVE_LABEL: Readonly<Record<MarkRepresentativeRule, MessageKey>> = {
  shortest: "ui.partMarks.representative.shortest",
  smallestNetArea: "ui.partMarks.representative.smallestNetArea",
};

/** Règle du représentant d'une clé de rappel (`undefined` : autre clé). */
export function markRepresentativeRuleOfKey(key: string): MarkRepresentativeRule | undefined {
  for (const [rule, k] of Object.entries(MARK_REPRESENTATIVE_KEYS)) {
    if (k === key) return rule as MarkRepresentativeRule;
  }
  return undefined;
}

/**
 * Règles du représentant appliquées dans le modèle affiché, dans l'ordre fixe du cœur : lecture
 * de `markRepresentativeRules` (question G-Q7 : une ligne ◆ par règle présente). Sans modèle :
 * aucune.
 */
export function markRepresentativeRulesInModel(
  model: Pick<Model, "parts"> | null | undefined,
): readonly MarkRepresentativeRule[] {
  return model ? markRepresentativeRules(model) : [];
}

/** Tolérance d'identité effective du projet (mm) : réglage du projet, sinon défaut du cœur. */
export function identicalToleranceValue(project: Pick<Project, "workshop">): number {
  return resolveWorkshopProfile(project.workshop).identicalPartTolerance;
}

/**
 * La tolérance d'identité effective est-elle validée (`Project.validatedValues`, valeur
 * courante) ? Lue directement sur le projet, indépendamment de la présence de la ligne ◆.
 */
export function identicalToleranceValidated(project: Project): boolean {
  return isValueValidated(
    project,
    IDENTICAL_TOLERANCE_PATH.join("."),
    identicalToleranceValue(project),
  );
}

/**
 * Le modèle a-t-il des pièces repérées par identité (au moins une pièce porte une désignation
 * commune `markName`) ? Condition de présence du réglage de la tolérance et de sa ligne ◆
 * (question (38)) ; les rappels du représentant suivent `markRepresentativeRulesInModel`. Sans
 * modèle : non.
 */
export function partMarksInModel(model: Pick<Model, "parts"> | null | undefined): boolean {
  return model?.parts.some((p) => p.markName !== undefined) === true;
}
