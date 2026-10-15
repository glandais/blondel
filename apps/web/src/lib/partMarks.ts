/**
 * Réglages du repérage des pièces dans l'interface (lot « attribution des repères », décisions
 * F10 (21) et (30)) : chemin de la tolérance d'identité des pièces repérées dans le profil
 * d'atelier du projet (`workshop.identicalPartTolerance`, défaut « à valider » du cœur), clé du
 * rappel du représentant d'un repère de cornières ou de supports (élément d'interface sans
 * chemin, préfixe `ui:` du dictionnaire des niveaux) et condition de présence.
 *
 * Lecture du projet et du modèle seulement : la valeur effective vient de
 * `resolveWorkshopProfile` du cœur, la présence des repères par identité de `Part.markName`
 * (désignation commune que le cœur pose sur toute pièce repérée par identité, décision F10 Q6).
 * Aucun calcul métier.
 */
import {
  isValueValidated,
  MARK_REPRESENTATIVE_RULE,
  resolveWorkshopProfile,
  type MarkRepresentativeRule,
  type Model,
  type Project,
} from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";

/** Chemin de la tolérance d'identité dans le projet (profil d'atelier, enregistré). */
export const IDENTICAL_TOLERANCE_PATH: readonly string[] = ["workshop", "identicalPartTolerance"];

/**
 * Clé du rappel « représentant d'un repère de cornières ou de supports : la plus courte, à
 * confirmer par un atelier » (décision (30)) dans le dictionnaire des niveaux et dans
 * `Project.validatedValues`.
 */
export const MARK_REPRESENTATIVE_KEY = "ui:workshop.markRepresentative";

/**
 * Valeur du rappel du représentant : la règle appliquée par le cœur (`MARK_REPRESENTATIVE_RULE`,
 * tenue en accord avec le regroupement par les tests du cœur), jamais recopiée ici.
 */
export const MARK_REPRESENTATIVE_VALUE: MarkRepresentativeRule = MARK_REPRESENTATIVE_RULE;

/**
 * Libellé de chaque règle du représentant : un `Record` sur le type du cœur, pour qu'une règle
 * ajoutée ou changée dans le cœur ne compile pas sans son texte.
 */
export const MARK_REPRESENTATIVE_LABEL: Readonly<Record<MarkRepresentativeRule, MessageKey>> = {
  shortest: "ui.partMarks.representative.shortest",
};

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
 * commune `markName`) ? Condition de présence du réglage et des deux lignes ◆ (question (38)).
 * Sans modèle : non.
 */
export function partMarksInModel(model: Pick<Model, "parts"> | null | undefined): boolean {
  return model?.parts.some((p) => p.markName !== undefined) === true;
}
