/**
 * M1 — progression arithmétique des collets, reformulée en **profil de collets en V**
 * (B §3.3, CHALLENGE G2, formule du relecteur ; option « tracé traditionnel »).
 *
 * Zone de N = b − a marches, longueur de jour L = σ_b − σ_a, giron g. Collet de la marche j
 * (j = 1 … N, entre les nez a + j − 1 et a + j) : c_j = g − D·w_j avec des poids en V
 *
 *   w_j = min(j / α, (N + 1 − j) / (N + 1 − α)),   Σ c_j = L  ⇒  D = (N·g − L) / Σ w_j.
 *
 * Cas symétrique (α = (N + 1)/2) : w_j ∝ min(j, N + 1 − j) et l'on retrouve exactement la
 * formule du relecteur, δ = (N·g − L)/T avec T = (p + 1)² (N = 2p + 1) ou p(p + 1) (N = 2p) ;
 * exemple N = 6, L = 900, g = 250 → 200/150/100/100/150/200.
 *
 * Cas asymétrique [ANALYSE, choix Blondel] : l'apex du V est placé au prorata de la position
 * du point d'angle σ_A sur le jour, α = (N + 1)·(σ_A − σ_a)/L, borné à [1 ; N] (apex sur une
 * marche de la zone). Le relecteur proposait deux progressions indépendantes coupées en σ_A ;
 * la forme retenue garde un seul paramètre D, une suite continue au sommet et la monotonie K3
 * par construction.
 *
 * Extrémité `free` (départ, arrivée, palier) [ANALYSE, choix Blondel, cohérent avec M3] : aucun
 * raccord à la partie droite n'est dû ; le bras du V de ce côté est remplacé par un palier de
 * poids (w = 1 de l'extrémité libre jusqu'à l'apex) : les collets y restent égaux au collet
 * minimal au lieu de remonter vers g. Deux extrémités libres : équipartition c_j = L/N.
 *
 * Si D < 0 (jour plus long que nécessaire), équipartition c_j = L/N. Si un collet est ≤ 0,
 * échec. Le « jarret » d'entrée de zone vaut g − c_1 (resp. g − c_N) aux extrémités tangentes :
 * signalé par le découpage.
 *
 * Paramètre optionnel `cornerSigma` (σ_A imposé, sinon déduit du tracé).
 */
import { msg, type Message } from "@blondel/i18n";
import type { BalancingInput, BalancingSolution, BalancingStrategy } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { EndCondition } from "./profile.js";
import { cornerSigma, zoneEnds } from "./zone.js";

/** Collets c_1 … c_N du profil en V, ou raison d'échec. */
export function vProfileCollets(
  count: number,
  length: Mm,
  going: Mm,
  cornerRatio: number,
  ends: readonly [EndCondition, EndCondition] = ["tangent", "tangent"],
): Mm[] | { reason: Message } {
  const N = count;
  if (!(N >= 1) || !(length > 0) || !(going > 0)) {
    return { reason: msg("balancing.m1.fail.degenerateZone") };
  }
  const alpha = Math.min(N, Math.max(1, (N + 1) * cornerRatio));
  const w = Array.from({ length: N }, (_, i) => {
    const j = i + 1;
    const left = ends[0] === "tangent" ? j / alpha : 1;
    const right = ends[1] === "tangent" ? (N + 1 - j) / (N + 1 - alpha) : 1;
    return Math.min(left, right);
  });
  const sumW = w.reduce((s, x) => s + x, 0);
  const D = (N * going - length) / sumW;
  const c = D < 0 ? w.map(() => length / N) : w.map((wj) => going - D * wj);
  const min = Math.min(...c);
  if (!(min > 0)) {
    return {
      reason: msg("balancing.m1.fail.nonPositiveCollet", { collet: min.toFixed(1), count: N }),
    };
  }
  return c;
}

function collets(input: BalancingInput): Mm[] | { reason: Message } {
  const { a, b, sigmaA, sigmaB } = zoneEnds(input);
  const L = sigmaB - sigmaA;
  // Longueur de jour indiscernable de 0 (nez fixes passant tous deux par un angle vif du jour de
  // développement) : le signe de L ne tient qu'au bruit d'arrondi, on refuse la zone.
  if (!(L > GEOM_EPS)) return { reason: msg("balancing.fail.zeroWellLength", { a, b }) };
  const ratio = Math.min(1, Math.max(0, (cornerSigma(input) - sigmaA) / L));
  return vProfileCollets(b - a, L, input.going, ratio, input.zone.ends);
}

function solve(input: BalancingInput): BalancingSolution {
  const c = collets(input);
  if (!Array.isArray(c)) return { kind: "fail", reason: c.reason };
  const { sigmaA } = zoneEnds(input);
  const sigma: Mm[] = [];
  let acc = sigmaA;
  for (let j = 0; j + 1 < c.length; j++) {
    acc += c[j]!;
    sigma.push(acc);
  }
  return { kind: "sigma", sigma };
}

function estimateMinCollet(input: BalancingInput): Mm {
  const c = collets(input);
  return Array.isArray(c) ? Math.min(...c) : 0;
}

export const M1_STRATEGY: BalancingStrategy = {
  id: "M1",
  labelKey: "balancing.m1.label",
  solve,
  estimateMinCollet,
};
