/**
 * Registre des évaluateurs par identifiant de règle.
 */
import type { RuleEvaluator } from "../types.js";
import { FLIGHT_EVALUATORS } from "./flights.js";
import { GOING_EVALUATORS } from "./going.js";
import { GUARD_EVALUATORS } from "./guards.js";
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

/**
 * Évaluateurs du cœur (Project + Layout + Stepping + échappée ; garde-corps et mains courantes
 * d'après l'analyse de l'étape « garde-corps », `ComplianceInput.guards`).
 */
export const DEFAULT_EVALUATORS: EvaluatorRegistry = createRegistry(
  RISE_EVALUATORS,
  GOING_EVALUATORS,
  STAIR_EVALUATORS,
  FLIGHT_EVALUATORS,
  NOSING_EVALUATORS,
  MISC_EVALUATORS,
  GUARD_EVALUATORS,
);

/**
 * Règles évaluables sur un **modèle partiel** (tracé ou découpage en échec) :
 * - `project` : ne lisent que le projet (emmarchement, débord de nez, échelle de meunier) ou
 *   gèrent elles-mêmes l'absence de mesure (échappée) ;
 * - `rises` : ne lisent que les hauteurs (`Stepping.rises`, `rise`), calculables sans tracé ;
 *   `H_REGULARITE` en est exclue car elle dépend du découpage en volées (paliers).
 */
export const PARTIAL_MODEL_RULES: {
  readonly project: ReadonlySet<string>;
  readonly rises: ReadonlySet<string>;
} = {
  project: new Set([
    ...Object.keys(MISC_EVALUATORS),
    ...Object.keys(NOSING_EVALUATORS).filter((id) => id.startsWith("DEBORD_NEZ_")),
    ...Object.keys(STAIR_EVALUATORS).filter(
      (id) => id.startsWith("ECHAPPEE_") || id.startsWith("LARGEUR_") || id === "E_MIN_DTU",
    ),
  ]),
  rises: new Set(Object.keys(RISE_EVALUATORS).filter((id) => id !== "H_REGULARITE")),
};
