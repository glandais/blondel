/**
 * Types du moteur de conformité : contexte d'évaluation et constats bruts des évaluateurs.
 */
import type { Layout, Location, Model, RuleStatus, Stepping } from "../model/derived.js";
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
   * Étape du pipeline en échec (modèle partiel) : `layout` (tracé vide) ou `stepping` (découpage
   * vide, hauteurs seules si calculables). Seules les règles de `PARTIAL_MODEL_RULES` sont alors
   * évaluées ; les autres sortent `non-evaluee` au lieu d'un « sans objet » trompeur.
   */
  readonly incomplete?: "layout" | "stepping";
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
}

/** Évaluateur d'une règle : renvoie au moins un constat. */
export type RuleEvaluator = (ctx: EvaluatorContext) => readonly Finding[];
