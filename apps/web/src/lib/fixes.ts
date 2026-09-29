/**
 * Corrections proposées (`suggestFixes` du cœur) pour l'interface : calcul sans exception et
 * application d'une correction au projet (fusion profonde du patch, puis validation par le
 * schéma du cœur). L'application passe par le store : une entrée d'historique, annulable.
 */
import {
  ProjectSchema,
  deepMerge,
  suggestFixes,
  type FixSuggestion,
  type Model,
  type Project,
} from "@blondel/core";

/** Corrections applicables au projet dont `model` est issu ; liste vide en cas d'échec. */
export function fixesFor(project: Project, model: Model | null): FixSuggestion[] {
  try {
    return suggestFixes(project, model ?? undefined);
  } catch {
    return [];
  }
}

/**
 * Projet corrigé : `deepMerge(project, fix.patch)` validé par `ProjectSchema` (le patch remplace
 * les tableaux en bloc).
 * @throws ZodError si le projet corrigé est invalide (message rendu par le store).
 */
export function applyFix(project: Project, fix: Pick<FixSuggestion, "patch">): Project {
  return ProjectSchema.parse(deepMerge(project, fix.patch));
}
