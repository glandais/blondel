/**
 * Édition des surcharges de règles (décision A18 (b) de l'utilisateur, 2026-09-29) : depuis la
 * liste du contrôle de conception, l'utilisateur change la sévérité effective d'une règle (ou
 * l'ignore) avec une **justification obligatoire**, reprise dans le dossier PDF.
 *
 * Une seule surcharge par règle : `withRuleOverride` remplace les surcharges existantes du même
 * identifiant (le moteur ne retenait déjà que la dernière, `effectiveSeverity`). La
 * justification est enregistrée sans espaces de bord ; vide, la surcharge est refusée (le moteur
 * l'ignorerait avec une remarque). L'identifiant n'est pas contrôlé contre rules.yaml : les
 * contrôles de plugin (FAB_*, HELICOIDAL_*…) sont surchargeables aussi.
 *
 * Fonctions pures.
 */
import type { Project, RuleOverride } from "../model/project.js";

/** Surcharge en vigueur pour la règle `ruleId` (la dernière, comme le moteur), ou `undefined`. */
export function ruleOverrideOf(project: Project, ruleId: string): RuleOverride | undefined {
  return [...project.compliance.overrides].reverse().find((o) => o.ruleId === ruleId);
}

/**
 * Projet avec la surcharge `override` (remplace celles de la même règle, à la place de la
 * première).
 * @throws RangeError si la justification est vide ou l'identifiant de règle vide.
 */
export function withRuleOverride(project: Project, override: RuleOverride): Project {
  const ruleId = override.ruleId.trim();
  const justification = override.justification.trim();
  if (ruleId === "") throw new RangeError("Surcharge sans identifiant de règle.");
  if (justification === "") {
    throw new RangeError(`Surcharge de ${ruleId} : la justification est obligatoire.`);
  }
  const entry: RuleOverride = { ruleId, severity: override.severity, justification };
  const current = project.compliance.overrides;
  const first = current.findIndex((o) => o.ruleId === ruleId);
  const others = current.filter((o) => o.ruleId !== ruleId);
  const overrides =
    first < 0 ? [...current, entry] : [...others.slice(0, first), entry, ...others.slice(first)];
  return { ...project, compliance: { ...project.compliance, overrides } };
}

/** Projet sans surcharge sur la règle `ruleId` (projet inchangé s'il n'y en a pas). */
export function withoutRuleOverride(project: Project, ruleId: string): Project {
  const current = project.compliance.overrides;
  if (!current.some((o) => o.ruleId === ruleId)) return project;
  return {
    ...project,
    compliance: { ...project.compliance, overrides: current.filter((o) => o.ruleId !== ruleId) },
  };
}
