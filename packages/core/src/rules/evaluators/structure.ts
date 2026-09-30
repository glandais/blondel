/**
 * Règles de rules.yaml évaluées par un **plugin de structure** (limons et crémaillères bois) :
 * seul le plugin connaît l'épaisseur des limons, la profondeur des entailles ou le reste sous
 * entaille. Le moteur rend ici un résultat d'attente, que `mergeStructureChecks` (pipeline)
 * remplace par les contrôles du plugin :
 * - structure concernée : `non-evaluee` « contrôle porté par la structure… » (visible seulement si
 *   le plugin n'a rien rendu : erreur de structure, découpage vide…) ;
 * - aucune structure choisie : `non-evaluee` (donnée inconnue) ;
 * - autre structure (acier, hélicoïdal à fût) : sans objet (pas de limon bois).
 */
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import { notApplicable, notEvaluated } from "../check.js";
import type { RuleEvaluator } from "../types.js";

/** Structures qui évaluent chaque règle (`StructureOutput.checks`). */
export const STRUCTURE_EVALUATED_RULES: Readonly<Record<string, readonly string[]>> = {
  LIMON_EPAISSEUR_MIN_DTU: ["wood-housed", "wood-cut"],
  LIMON_ENTAILLE_MIN: ["wood-housed"],
  CREMAILLERE_REGLE_MOYENS: ["wood-cut"],
};

/** Grandeur contrôlée par chaque règle (complément de « inconnue(s) »). */
const SUBJECT: Readonly<Record<string, MessageKey>> = {
  LIMON_EPAISSEUR_MIN_DTU: "rules.LIMON_EPAISSEUR_MIN_DTU.subject",
  LIMON_ENTAILLE_MIN: "rules.LIMON_ENTAILLE_MIN.subject",
  CREMAILLERE_REGLE_MOYENS: "rules.CREMAILLERE_REGLE_MOYENS.subject",
};

/** « « wood-housed » ou « wood-cut » » : identifiants de structure entre guillemets. */
function kindNames(kinds: readonly string[]): Message {
  return kinds
    .map((kind) => msg("compliance.structureRule.kindName", { kind }))
    .reduce((first, next) => msg("compliance.join.or", { first, next }));
}

function structureRule(ruleId: string): RuleEvaluator {
  const kinds = STRUCTURE_EVALUATED_RULES[ruleId]!;
  const subject = msg(SUBJECT[ruleId]!);
  const names = kindNames(kinds);
  return (ctx) => {
    const kind = ctx.project.stair.structure.kind;
    if (kinds.includes(kind))
      return [notEvaluated(msg("compliance.structureRule.noResult", { kind }))];
    if (kind === "none")
      return [notEvaluated(msg("compliance.structureRule.noStructure", { subject, names }))];
    return [notApplicable(msg("compliance.structureRule.otherStructure", { kind, names }))];
  };
}

export const STRUCTURE_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = Object.fromEntries(
  Object.keys(STRUCTURE_EVALUATED_RULES).map((id) => [id, structureRule(id)]),
);
