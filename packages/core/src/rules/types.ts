/**
 * Types du moteur de conformité : contexte d'évaluation et constats bruts des évaluateurs.
 */
import type { GuardsAnalysis } from "../guards/types.js";
import type { Layout, Location, Model, RuleStatus, Severity, Stepping } from "../model/derived.js";
import type { Project } from "../model/project.js";
import type { RuleDef } from "./table.js";

/** Entrée du moteur : projet et étapes dérivées disponibles (modèle sans pièces). */
export interface ComplianceInput {
  readonly project: Project;
  readonly layout: Layout;
  readonly stepping: Stepping;
  /** Échappée minimale mesurée (absente si non calculée ou sans plancher au-dessus). */
  readonly headroom?: Model["headroom"];
  /**
   * Vrai si une trémie existe mais qu'aucun point de la ligne de foulée n'est sous la dalle
   * haute (échappée non bornée) : l'échappée est alors satisfaite sans mesure.
   */
  readonly headroomClear?: boolean;
  /**
   * Échappée sur la largeur des marches (`Model.headroomWidth`, CHALLENGE G4) : absente si aucun
   * nez n'est sous la dalle haute ou si l'échappée n'est pas calculée. Évaluée par
   * `ECHAPPEE_LARGEUR` (QUESTIONS A7).
   */
  readonly headroomWidth?: Model["headroomWidth"];
  /**
   * Échappée calculée et aucun nez sous la dalle haute (trémie couvrante,
   * `Model.headroomUnlimited.width`) : `ECHAPPEE_LARGEUR` satisfaite sans mesure. Absent avec
   * `headroomWidth` absent : échappée non calculée (non évaluée).
   */
  readonly headroomWidthClear?: boolean;
  /**
   * Étape du pipeline en échec (modèle partiel) : `layout` (tracé vide) ou `stepping` (découpage
   * vide, hauteurs seules si calculables). Seules les règles de `PARTIAL_MODEL_RULES` sont alors
   * évaluées ; les autres sortent `non-evaluee` au lieu d'un « sans objet » trompeur.
   */
  readonly incomplete?: "layout" | "stepping";
  /**
   * Garde-corps et mains courantes (étape du pipeline, `guards/compute.ts`). Absent : calculés à
   * la demande par les évaluateurs si le projet a une section `guards` ; `null` : étape en
   * échec (règles GC_* / MC_* non évaluées).
   */
  readonly guards?: GuardsAnalysis | null;
}

/** Contexte passé à chaque évaluateur. */
export interface EvaluatorContext extends ComplianceInput {
  /** Règle évaluée (seuils `min` / `max` à lire ici, jamais en dur). */
  readonly rule: RuleDef;
  /** Contextes actifs (utilisateur + implicites + déduits). */
  readonly contexts: ReadonlySet<string>;
}

/**
 * Constat brut produit par un évaluateur ; le moteur y ajoute les métadonnées de la règle
 * (source, nature, sévérités, profil, surcharges).
 */
export interface Finding {
  readonly status: RuleStatus;
  readonly measured?: number;
  /** Bornes effectives (par défaut : `min` / `max` de la règle). */
  readonly min?: number | null;
  readonly max?: number | null;
  /** Par défaut : l'escalier entier. */
  readonly location?: Location;
  readonly message: string;
  /**
   * Sévérité propre à ce constat, **plus faible** que celle de la règle (ex. `GC_OBLIGATOIRE` en
   * conseil au droit d'un jour plus étroit que la sphère T1, QUESTIONS A10), avec sa raison
   * (`severityReason`, reprise dans `RuleResult.downgradeReason`). Elle remplace la sévérité
   * déclarée avant le profil et les surcharges de l'utilisateur, qui s'appliquent ensuite.
   * Ignorée si elle n'est pas plus faible que la sévérité déclarée.
   */
  readonly severity?: Severity;
  readonly severityReason?: string;
  /** Justification saisie par l'utilisateur (`RuleResult.justification`, décision A12). */
  readonly justification?: string;
}

/** Évaluateur d'une règle : renvoie au moins un constat. */
export type RuleEvaluator = (ctx: EvaluatorContext) => readonly Finding[];
