/**
 * Messages du modèle (ADR-0007) : clés construites à partir d'identifiants.
 */
import { msg, type Message, type MessageKey } from "@blondel/i18n";

/**
 * Description d'une règle du contrôle de conception, règle de rules.yaml ou contrôle de plugin
 * (`PluginRuleSpec`) : clé `rules.<ruleId>.description`. Remplace l'ancien
 * `RuleResult.description` (le résultat ne porte plus la description). Identifiant sans
 * description dans les dictionnaires : la traduction rend la clé elle-même.
 */
export function ruleDescription(ruleId: string): Message {
  return msg(`rules.${ruleId}.description` as MessageKey);
}

/**
 * Titre court d'une règle (inspecteur Règle, cartes du contrôle, ADR-0009) : groupe nominal
 * neutre, sans seuil chiffré, qui vaut pour une règle respectée comme violée. Clé
 * `rules.<ruleId>.title`, pour les règles de rules.yaml comme pour les contrôles de plugins.
 * Identifiant sans titre dans les dictionnaires : la traduction rend la clé elle-même.
 */
export function ruleTitle(ruleId: string): Message {
  return msg(`rules.${ruleId}.title` as MessageKey);
}
