/**
 * Corrections proposées (`suggestFixes` du cœur) pour l'interface : calcul sans exception,
 * corrections visées par une règle (inspecteur Règle, « Pour corriger ») et application d'une
 * correction au projet (fusion profonde du patch, puis validation par le schéma du cœur).
 * L'application passe par le store : une entrée d'historique, annulable.
 */
import {
  ProjectSchema,
  deepMerge,
  suggestFixes,
  type FixSuggestion,
  type Model,
  type Project,
} from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
import { appStore } from "../store/appStore.js";

/** Corrections applicables au projet dont `model` est issu ; liste vide en cas d'échec. */
export function fixesFor(project: Project, model: Model | null): FixSuggestion[] {
  try {
    return suggestFixes(project, model ?? undefined);
  } catch {
    return [];
  }
}

/**
 * Corrections qui visent la règle `ruleId` (`FixSuggestion.ruleIds` du cœur) ; une correction
 * sans `ruleIds` (erreur, remarque) n'est rattachée à aucune règle.
 */
export function fixesForRule(
  fixes: readonly FixSuggestion[],
  ruleId: string,
): readonly FixSuggestion[] {
  return fixes.filter((f) => f.ruleIds?.includes(ruleId) === true);
}

/**
 * Projet corrigé : `deepMerge(project, fix.patch)` validé par `ProjectSchema` (le patch remplace
 * les tableaux en bloc).
 * @throws ZodError si le projet corrigé est invalide (message rendu par le store).
 */
export function applyFix(project: Project, fix: Pick<FixSuggestion, "patch">): Project {
  return ProjectSchema.parse(deepMerge(project, fix.patch));
}

/**
 * Applique une correction au projet du store de l'application (une entrée d'historique, close
 * aussitôt : « Annuler » revient en arrière) et annonce la correction appliquée. Rend le motif
 * d'un refus (`Message`, traduit à l'affichage), `null` si la correction est appliquée.
 */
export function applyFixInStore(fix: FixSuggestion): Message | null {
  const r = appStore.getState().update((p) => applyFix(p, fix));
  appStore.getState().endGroup();
  if (!r.ok) return r.issues[0] ?? msg("ui.errors.fixRefused");
  appStore.setState({
    notice: { kind: "info", msg: msg("ui.errors.fixApplied", { label: fix.label }) },
  });
  return null;
}
