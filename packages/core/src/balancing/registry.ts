/**
 * Registre des stratégies de balancement (ADR-0002 : M0, M1, M3 au MVP ; M2 herse et M6
 * rotation paramétrée, options V1 de SPEC).
 */
import type { BalancingStrategy } from "../model/plugins.js";
import type { BalancingMethod } from "../model/project.js";
import { M0_STRATEGY } from "./m0.js";
import { M1_STRATEGY } from "./m1.js";
import { M2_STRATEGY } from "./m2.js";
import { M3_STRATEGY } from "./m3.js";
import { M6_STRATEGY } from "./m6.js";

/** Alias de `BalancingMethod` (liste unique `BalancingSchema.method`). */
export type BalancingMethodId = BalancingMethod;

export const BALANCING_STRATEGIES: Readonly<Record<BalancingMethodId, BalancingStrategy>> = {
  M0: M0_STRATEGY,
  M1: M1_STRATEGY,
  M2: M2_STRATEGY,
  M3: M3_STRATEGY,
  M6: M6_STRATEGY,
};

export function getBalancingStrategy(id: BalancingMethodId): BalancingStrategy {
  return BALANCING_STRATEGIES[id];
}
