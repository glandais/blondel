/**
 * M0 — rayonnant (B §3.2), référence sans balancement : chaque ligne de nez de la zone passe
 * par le centre O du tournant (centre de l'arc de Γ). Sur l'arc de Γ, c'est exactement la
 * perpendiculaire à Γ ; les nez des parties droites inclus dans la zone sont rabattus vers O.
 * Zone unique de 180° : chaque nez rayonne depuis le centre du tournant le plus proche.
 *
 * Collet d'un tournant circulaire : c = g·r_j / r_f (nul pour un angle vif).
 */
import { msg } from "@blondel/i18n";
import { curvePointAt } from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import type { BalancingInput, BalancingSolution, BalancingStrategy } from "../model/plugins.js";
import { turnCenter, zoneEnds, zoneTurns } from "./zone.js";

function solve(input: BalancingInput): BalancingSolution {
  const { a, b } = zoneEnds(input);
  const turns = zoneTurns(input).map((j) => ({
    center: turnCenter(input.layout, j),
    mid: (input.layout.turns[j]!.sStart + input.layout.turns[j]!.sEnd) / 2,
  }));
  const phi: number[] = [];
  for (let k = a + 1; k < b; k++) {
    const s = input.nosings[k]!.s;
    let best = turns[0]!;
    for (const t of turns) if (Math.abs(t.mid - s) < Math.abs(best.mid - s)) best = t;
    const p = curvePointAt(input.layout.walkline, s);
    const v = V.sub(p, best.center);
    if (V.norm(v) <= 1e-9)
      return { kind: "fail", reason: msg("balancing.m0.fail.nosingAtCentre", { nosing: k }) };
    phi.push(V.angleOf(v));
  }
  return { kind: "phi", phi };
}

export const M0_STRATEGY: BalancingStrategy = {
  id: "M0",
  labelKey: "balancing.m0.label",
  solve,
};
