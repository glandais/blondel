/**
 * Registre des stratégies de balancement disponibles au MVP (ADR-0002 : M0, M1, M3).
 */
import type { BalancingStrategy } from "../model/plugins.js";
import { M0_STRATEGY } from "./m0.js";
import { M1_STRATEGY } from "./m1.js";
import { M3_STRATEGY } from "./m3.js";

export type BalancingMethodId = "M0" | "M1" | "M3";

export const BALANCING_STRATEGIES: Readonly<Record<BalancingMethodId, BalancingStrategy>> = {
  M0: M0_STRATEGY,
  M1: M1_STRATEGY,
  M3: M3_STRATEGY,
};

export function getBalancingStrategy(id: BalancingMethodId): BalancingStrategy {
  return BALANCING_STRATEGIES[id];
}
