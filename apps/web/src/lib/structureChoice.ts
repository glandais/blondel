/**
 * Changement de structure depuis l'interface (décisions A4 et A13 de l'utilisateur) : la
 * structure et le jour adapté (poteau d'angle, poteau élargi des profilés) sont calculés par le
 * cœur (`applyStructureChoice`) et appliqués en **une seule** modification du projet (une seule
 * entrée d'annulation) ; les remarques du cœur deviennent le message affiché.
 */
import { applyStructureChoice, type Project } from "@blondel/core";

export interface StructureChoice {
  readonly project: Project;
  /** Message d'information (modifications du jour), `null` s'il n'y en a pas. */
  readonly notice: string | null;
}

/** Projet avec la structure `kind` (paramètres `params`) et le jour adapté. */
export function chooseStructure(
  project: Project,
  kind: string,
  params: Readonly<Record<string, unknown>>,
): StructureChoice {
  const r = applyStructureChoice(project, kind, params);
  return { project: r.project, notice: r.notes.length > 0 ? r.notes.join(" ") : null };
}
