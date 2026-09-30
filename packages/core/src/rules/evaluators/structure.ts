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
import { notApplicable, notEvaluated } from "../check.js";
import type { RuleEvaluator } from "../types.js";

/** Structures qui évaluent chaque règle (`StructureOutput.checks`). */
export const STRUCTURE_EVALUATED_RULES: Readonly<Record<string, readonly string[]>> = {
  LIMON_EPAISSEUR_MIN_DTU: ["wood-housed", "wood-cut"],
  LIMON_ENTAILLE_MIN: ["wood-housed"],
  CREMAILLERE_REGLE_MOYENS: ["wood-cut"],
};

const SUBJECT: Readonly<Record<string, string>> = {
  LIMON_EPAISSEUR_MIN_DTU: "épaisseur des limons ou crémaillères bois",
  LIMON_ENTAILLE_MIN: "profondeur d'entaille des marches dans les limons bois",
  CREMAILLERE_REGLE_MOYENS: "reste de bois sous les entailles des crémaillères",
};

function structureRule(ruleId: string): RuleEvaluator {
  const kinds = STRUCTURE_EVALUATED_RULES[ruleId]!;
  const subject = SUBJECT[ruleId]!;
  const names = kinds.map((k) => `« ${k} »`).join(" ou ");
  return (ctx) => {
    const kind = ctx.project.stair.structure.kind;
    if (kinds.includes(kind))
      return [
        notEvaluated(
          `Contrôle porté par la structure « ${kind} », qui n'a rendu aucun résultat (voir les erreurs du modèle).`,
        ),
      ];
    if (kind === "none")
      return [
        notEvaluated(
          `Aucune structure choisie : ${subject} inconnue(s) ; contrôle évalué par la structure ${names}.`,
        ),
      ];
    return [
      notApplicable(
        `Sans objet : la structure « ${kind} » n'a pas de limon bois (contrôle des structures ${names}).`,
      ),
    ];
  };
}

export const STRUCTURE_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = Object.fromEntries(
  Object.keys(STRUCTURE_EVALUATED_RULES).map((id) => [id, structureRule(id)]),
);
