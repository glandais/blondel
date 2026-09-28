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
