/**
 * Registre des évaluateurs par identifiant de règle.
 */
import type { RuleEvaluator } from "../types.js";
import { FLIGHT_EVALUATORS } from "./flights.js";
import { GOING_EVALUATORS } from "./going.js";
import { MISC_EVALUATORS, NOSING_EVALUATORS } from "./nosing.js";
import { RISE_EVALUATORS } from "./rise.js";
import { STAIR_EVALUATORS } from "./stair.js";

export type EvaluatorRegistry = ReadonlyMap<string, RuleEvaluator>;

/** Construit un registre ; lève une erreur si un identifiant est fourni deux fois. */
export function createRegistry(
  ...groups: readonly Readonly<Record<string, RuleEvaluator>>[]
): EvaluatorRegistry {
  const m = new Map<string, RuleEvaluator>();
  for (const g of groups) {
    for (const [id, ev] of Object.entries(g)) {
      if (m.has(id)) throw new Error(`Évaluateur en double : ${id}`);
      m.set(id, ev);
    }
  }
  return m;
}

/** Évaluateurs du cœur (modèle sans pièces : Project + Layout + Stepping + échappée). */
export const DEFAULT_EVALUATORS: EvaluatorRegistry = createRegistry(
  RISE_EVALUATORS,
  GOING_EVALUATORS,
  STAIR_EVALUATORS,
  FLIGHT_EVALUATORS,
  NOSING_EVALUATORS,
  MISC_EVALUATORS,
);
