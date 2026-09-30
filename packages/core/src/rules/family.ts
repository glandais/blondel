/**
 * Familles de règles du contrôle de conception (QUESTIONS A23, décision du 2026-09-29) :
 * **géométrie** (hauteurs, girons, ligne de foulée, largeurs, échappée, trémie, paliers, nez…),
 * **fabrication** (contrôles des plugins de structure `FAB_*`, `HELICOIDAL_*`, limons, charges,
 * cintrage) et **garde-corps** (garde-corps et mains courantes, `GC_*`, `MC_*`). Sert au filtre
 * des marqueurs de la vue 3D : l'interface lit la famille ici, sans table à elle.
 *
 * Classement de présentation (aucun seuil) : par identifiant de règle, d'abord les exceptions
 * nommées, puis les préfixes ; une règle hors table (`rules.yaml`) est un contrôle de plugin de
 * structure, donc de fabrication ; sinon, géométrie.
 */
import type { MessageKey } from "@blondel/i18n";
import { findRule } from "./table.js";

export type RuleFamily = "geometrie" | "fabrication" | "garde-corps";

export const RULE_FAMILIES: readonly RuleFamily[] = ["geometrie", "fabrication", "garde-corps"];

/** Clé du libellé de chaque famille (ADR-0007) : `t(RULE_FAMILY_LABELS[f])`. */
export const RULE_FAMILY_LABELS: Readonly<Record<RuleFamily, MessageKey>> = {
  geometrie: "compliance.family.geometrie",
  fabrication: "compliance.family.fabrication",
  "garde-corps": "compliance.family.gardeCorps",
};

/** Règles dont le préfixe ne dit pas la famille. */
const NAMED: Readonly<Record<string, RuleFamily>> = {
  // Main courante exigée d'une échelle de meunier.
  ECHELLE_MEUNIER_MC: "garde-corps",
  // Charge horizontale sur le garde-corps.
  CHARGE_GC_HORIZONTALE: "garde-corps",
  // Classe d'exécution EN 1090-2 (contrôle de la structure acier).
  EXC_CLASSE_EXECUTION: "fabrication",
};

/** Préfixes d'identifiant, du plus spécifique au plus général. */
const PREFIXES: readonly (readonly [string, RuleFamily])[] = [
  ["GC_", "garde-corps"],
  ["MC_", "garde-corps"],
  ["FAB_", "fabrication"],
  ["HELICOIDAL_", "fabrication"],
  ["LIMON_", "fabrication"],
  ["CREMAILLERE_", "fabrication"],
  ["DEFORMATION_", "fabrication"],
  ["CHARGE_", "fabrication"],
  ["EXC_", "fabrication"],
  // Échappée (table ou contrôle du pipeline) : géométrie même hors table.
  ["ECHAPPEE_", "geometrie"],
];

/** Famille d'une règle (table ou contrôle de plugin) par son identifiant. */
export function ruleFamily(ruleId: string): RuleFamily {
  const named = NAMED[ruleId];
  if (named) return named;
  for (const [prefix, family] of PREFIXES) if (ruleId.startsWith(prefix)) return family;
  return findRule(ruleId) ? "geometrie" : "fabrication";
}
