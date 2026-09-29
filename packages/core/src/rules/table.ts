/**
 * Table des règles de dimensionnement (ADR-0004).
 *
 * Source de vérité : `docs/research/rules.yaml`, converti en `rules.data.json` par
 * `scripts/build-rules.mjs` (un test vérifie que le JSON est à jour). La table est validée
 * par zod au chargement : une erreur de structure casse les tests, pas l'exécution silencieusement.
 *
 * Les champs `formule` sont **documentaires** : ils ne sont jamais évalués. Les seuils sont lus
 * dans `min` / `max` par les évaluateurs.
 */
import { z } from "zod";
import raw from "./rules.data.json" with { type: "json" };
import type { Severity } from "../model/derived.js";

export const SeveritySchema = z.enum(["bloquant", "avertissement", "conseil"]);

export const RuleDefSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  /** Formule documentaire (jamais évaluée). */
  formule: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  recommande: z.number().nullable(),
  unite: z.string().nullable(),
  contexte: z.array(z.string()).min(1),
  /**
   * Contextes qui écartent la règle même si ses contextes sont actifs (ex. `G_COLLET_MIN` hors
   * hélicoïdal à fût central, QUESTIONS A5). Absent : aucune exclusion.
   */
  contexte_exclu: z.array(z.string()).optional(),
  nature: z.enum(["reglementaire", "normatif", "metier"]),
  source: z.string(),
  /** Valeur issue d'une norme payante non lue (profil souple : bloquant → avertissement). */
  source_secondaire: z.boolean().default(false),
  confiance: z.enum(["eleve", "moyen", "faible"]),
  severite: SeveritySchema,
  note: z.string().optional(),
});
export type RuleDef = z.infer<typeof RuleDefSchema>;

export const RuleTableSchema = z.object({
  version: z.number().int(),
  date_consultation: z.string(),
  pays: z.string(),
  profils: z.record(z.string(), z.string()),
  variables: z.record(z.string(), z.string()),
  contextes: z.record(z.string(), z.string()),
  regles: z.array(RuleDefSchema),
});
export type RuleTable = z.infer<typeof RuleTableSchema>;

/** Table chargée et validée. */
export const RULE_TABLE: RuleTable = RuleTableSchema.parse(raw);

/** Version du jeu de règles (`rules.yaml` → `version`), enregistrée dans le rapport. */
export const RULES_VERSION: number = RULE_TABLE.version;

export const RULES: readonly RuleDef[] = RULE_TABLE.regles;

/** Identifiants des contextes déclarés dans la table. */
export const RULE_CONTEXTS: readonly string[] = Object.keys(RULE_TABLE.contextes);

const byId = new Map<string, RuleDef>(RULES.map((r) => [r.id, r]));

/** Règle par identifiant ; lève une erreur si l'identifiant est inconnu (erreur de programmation). */
export function getRule(id: string): RuleDef {
  const r = byId.get(id);
  if (!r) throw new Error(`Règle inconnue : ${id}`);
  return r;
}

export function findRule(id: string): RuleDef | undefined {
  return byId.get(id);
}

export type { Severity };
