/**
 * Section du panneau libre à ouvrir pour corriger une règle (inspecteur Règle, « Pour corriger »,
 * ADR-0009). Table de **préfixes d'identifiants** de règles, présentation seulement : elle ne
 * dit rien de l'évaluation (seuils et contextes restent dans rules.yaml) ; une règle sans
 * préfixe connu n'ouvre aucune section.
 */
import type { SectionId } from "./sectionIds.js";

/**
 * Préfixes et sections. Le plus long préfixe qui convient l'emporte (`G_COLLET` avant `G_`),
 * quel que soit l'ordre de la table.
 */
export const RULE_SECTION_PREFIXES: readonly (readonly [prefix: string, section: SectionId])[] = [
  // Découpage : hauteurs, girons, module, confort, reculement, volées.
  ["H_", "stepping"],
  ["G_", "stepping"],
  ["BLONDEL_", "stepping"],
  ["CONFORT", "stepping"],
  ["RECULEMENT", "stepping"],
  ["VOLEE_", "stepping"],
  // Balancement : collets, girons balancés, tournants d'ERP.
  ["G_COLLET", "balancing"],
  ["G_BALANCE", "balancing"],
  ["ERP_TOURNANT", "balancing"],
  // Tracé : ligne de foulée, emmarchement, largeurs, paliers.
  ["LF_", "layout"],
  ["E_MIN", "layout"],
  ["LARGEUR_", "layout"],
  ["PALIER_", "layout"],
  // Site : échappée, trémie, hauteur à monter.
  ["ECHAPPEE", "site"],
  ["TREMIE", "site"],
  ["HAUTEUR_ETAGE", "site"],
  // Garde-corps et mains courantes.
  ["GC_", "guards"],
  ["MC_", "guards"],
  ["VIDE_", "guards"],
  // Marches : nez, recouvrement, contremarches, bandes d'éveil.
  ["DEBORD_NEZ", "treads"],
  ["RECOUVREMENT", "treads"],
  ["CONTREMARCHE", "treads"],
  ["NEZ_", "treads"],
  ["BANDE_", "treads"],
  // Structure : fabrication, limons, crémaillères, lamellé-collé cintré, prédimensionnement,
  // charges.
  ["FAB_", "structure"],
  ["LIMON_", "structure"],
  ["CREMAILLERE", "structure"],
  ["LAMELLE_", "structure"],
  ["PRECHECK_", "structure"],
  ["CHARGE_", "structure"],
  ["DEFORMATION", "structure"],
  ["HELICOIDAL", "structure"],
];

/** Section du panneau libre où corriger la règle `ruleId`, `null` si aucune. */
export function ruleSection(ruleId: string): SectionId | null {
  let best: readonly [string, SectionId] | null = null;
  for (const entry of RULE_SECTION_PREFIXES) {
    if (ruleId.startsWith(entry[0]) && (best === null || entry[0].length > best[0].length)) {
      best = entry;
    }
  }
  return best === null ? null : best[1];
}
