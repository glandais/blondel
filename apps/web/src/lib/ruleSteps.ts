/**
 * Rattachement des règles du contrôle de conception aux étapes du parcours guidé (ADR-0009,
 * spécification de contenu § 2 « Règles rattachées ») : sert à cocher ✓ une étape (vue et sans
 * règle bloquante rattachée) et à compter les bloquants par étape.
 *
 * Présentation seulement, **sans seuil** : une table de préfixes d'identifiants de règles. Elle
 * ne dit rien de l'évaluation (seuils, contextes et sévérités restent dans rules.yaml et le
 * moteur du cœur) ; la sévérité lue est la sévérité effective rendue par le cœur.
 *
 * Résolution : le plus long préfixe qui convient l'emporte (`G_COLLET` avant `G_`), et un même
 * préfixe peut mener à plusieurs étapes (l'échappée : Site et Découpage). À défaut, la famille
 * de la règle (`ruleFamily` du cœur : fabrication → 7, garde-corps → 6), puis la section du
 * panneau libre où la corriger (`ruleSection`) et l'étape de cette section (`stepForPanel`) ;
 * sinon aucune étape.
 */
import { ruleFamily, type ComplianceReport, type RuleFamily } from "@blondel/core";
import { isStepChecked, stepForPanel } from "./journey.js";
import { ruleSection } from "./ruleSections.js";
import { GUIDED_STEPS, type GuidedStep } from "./sectionIds.js";

/** Préfixes d'identifiants de règles rattachés à chaque étape. */
export const STEP_RULE_PREFIXES: Readonly<Record<GuidedStep, readonly string[]>> = {
  // Site : hauteur à monter, trémie, échappée (pré-évaluée).
  1: ["HAUTEUR_ETAGE", "TREMIE", "ECHAPPEE"],
  // Forme : emmarchement, largeurs, ligne de foulée, collet, balancées, tournants, paliers.
  2: [
    "E_MIN",
    "LARGEUR_",
    "LF_",
    "G_COLLET",
    "G_BALANCE",
    // Tolérance du giron d'une marche balancée (régularité des balancées), avant « G_ ».
    "G_TOL_BALANCEE",
    "G_EXT_MAX_ERP_TOURNANT",
    "ERP_TOURNANT",
    "PALIER_",
  ],
  // Découpage : hauteurs, girons, 2h + g, confort, reculement, volées, échappée, échelles.
  3: [
    "H_",
    "G_",
    "BLONDEL_",
    "CONFORT",
    "RECULEMENT",
    "VOLEE_",
    "ECHAPPEE",
    "ANGLE_ECHELLE",
    "ECHELLE_MEUNIER_HORS_DTU",
  ],
  // Marches : nez, recouvrement, contremarches, bandes d'éveil, vide entre marches.
  4: ["DEBORD_NEZ", "RECOUVREMENT", "CONTREMARCHE", "NEZ_", "BANDE_", "VIDE_ENTRE_MARCHES"],
  // Structure : prédimensionnement, hélicoïdal, limons, crémaillères, lamellé-collé cintré du
  // limon central bois (`LAMELLE_CINTRE_KR`, `LAMELLE_PLIS_MINCES`), charges.
  5: [
    "PRECHECK_",
    "HELICOIDAL_",
    "LIMON_",
    "CREMAILLERE",
    "LAMELLE_",
    "CHARGE_ESCALIER",
    "CHARGE_MARCHE",
  ],
  // Garde-corps : garde-corps, mains courantes, charge horizontale.
  6: ["GC_", "MC_", "CHARGE_GC_HORIZONTALE", "ECHELLE_MEUNIER_MC"],
  // Fabrication : contrôles des plugins, classe d'exécution, cintrage.
  7: ["FAB_", "EXC_", "DEFORMATION_"],
};

/** Étapes d'une règle par la famille du cœur, avant le repli par section. */
const FAMILY_STEPS: Readonly<Partial<Record<RuleFamily, GuidedStep>>> = {
  fabrication: 7,
  "garde-corps": 6,
};

/** Étapes auxquelles la règle `ruleId` est rattachée (ordre croissant), vide si aucune. */
export function ruleSteps(ruleId: string): readonly GuidedStep[] {
  let bestLength = -1;
  let steps: GuidedStep[] = [];
  for (const step of GUIDED_STEPS) {
    for (const prefix of STEP_RULE_PREFIXES[step]) {
      if (!ruleId.startsWith(prefix)) continue;
      if (prefix.length > bestLength) {
        bestLength = prefix.length;
        steps = [step];
      } else if (prefix.length === bestLength && !steps.includes(step)) {
        steps.push(step);
      }
    }
  }
  if (steps.length > 0) return steps;
  const byFamily = FAMILY_STEPS[ruleFamily(ruleId)];
  if (byFamily !== undefined) return [byFamily];
  const section = ruleSection(ruleId);
  const bySection = section === null ? null : stepForPanel(section);
  return bySection === null ? [] : [bySection];
}

function zeroByStep(): Record<GuidedStep, number> {
  return Object.fromEntries(GUIDED_STEPS.map((s) => [s, 0])) as Record<GuidedStep, number>;
}

/**
 * Violations de sévérité effective « bloquant » par étape : une violation rattachée à deux
 * étapes compte dans chacune.
 */
export function blockingCountByStep(
  report: ComplianceReport | undefined,
): Record<GuidedStep, number> {
  const out = zeroByStep();
  for (const r of report?.results ?? []) {
    if (r.status !== "violation" || r.severity !== "bloquant") continue;
    for (const step of ruleSteps(r.ruleId)) out[step] += 1;
  }
  return out;
}

/** Étapes cochées ✓ : vues au moins une fois et sans règle bloquante rattachée. */
export function checkedSteps(
  visited: ReadonlySet<GuidedStep>,
  report: ComplianceReport | undefined,
): ReadonlySet<GuidedStep> {
  const blocking = blockingCountByStep(report);
  return new Set(GUIDED_STEPS.filter((s) => isStepChecked(s, visited, blocking[s])));
}
