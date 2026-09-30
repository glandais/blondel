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

/** Cellule d'une table structurée : nombre, libellé, drapeau ou vide (`null`). */
const TableCellSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);
export type TableCell = z.infer<typeof TableCellSchema>;

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
  /**
   * Constantes numériques nommées autres que `min` / `max` / `recommande` (ex. seuil
   * d'emmarchement 1 200 mm des LF_POSITION_*), lues par `ruleParam`.
   */
  parametres: z.record(z.string(), z.number()).optional(),
  /** Tableaux de valeurs (ex. table h(E) de GC_HAUTEUR_2024), lus par `ruleTable`. */
  tables: z.record(z.string(), z.array(z.record(z.string(), TableCellSchema))).optional(),
  /**
   * Règles LF_POSITION_* : règles de giron contrôlées aussi sur la ligne de mesure
   * réglementaire quand elle diffère de la ligne de conception (SPEC X9).
   */
  regles_mesurees: z.array(z.string()).optional(),
});
export type RuleDef = z.infer<typeof RuleDefSchema>;
export type TableRow = Readonly<Record<string, TableCell>>;

export const RuleTableSchema = z.object({
  version: z.number().int(),
  date_consultation: z.string(),
  pays: z.string(),
  profils: z.record(z.string(), z.string()),
  variables: z.record(z.string(), z.string()),
  contextes: z.record(z.string(), z.string()),
  /** Contextes de forme, qui qualifient les autres contextes d'une règle (ADR-0004). */
  contextes_forme: z.array(z.string()),
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

function ruleOf(rule: RuleDef | string): RuleDef {
  return typeof rule === "string" ? getRule(rule) : rule;
}

/**
 * Paramètre structuré `parametres.<name>` d'une règle. Lève une erreur si la règle ou le
 * paramètre manque (table incohérente avec son évaluateur : erreur de programmation, rendue
 * `non-evaluee` par le moteur).
 */
export function ruleParam(rule: RuleDef | string, name: string): number {
  const r = ruleOf(rule);
  const v = r.parametres?.[name];
  if (v === undefined) throw new Error(`Paramètre « ${name} » absent de la règle ${r.id}.`);
  return v;
}

/** Table structurée `tables.<name>` d'une règle ; lève une erreur si elle manque. */
export function ruleTable(rule: RuleDef | string, name: string): readonly TableRow[] {
  const r = ruleOf(rule);
  const t = r.tables?.[name];
  if (t === undefined) throw new Error(`Table « ${name} » absente de la règle ${r.id}.`);
  return t;
}

/** Cellule numérique d'une ligne de table ; lève une erreur si elle n'est pas un nombre. */
export function numberCell(row: TableRow, key: string): number {
  const v = row[key];
  if (typeof v !== "number") throw new Error(`Cellule « ${key} » non numérique.`);
  return v;
}

export type { Severity };
