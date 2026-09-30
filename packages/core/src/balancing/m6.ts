/**
 * M6 — rotation paramétrée (B §3.8, SPEC : V1, deux curseurs).
 *
 * Sources [USAGE] : ALLPLAN décrit ses modes par la loi de **rotation d'une marche à la
 * suivante** — « gleichmäßig » (angle de rotation constant), « linear » (rotation croissante
 * puis décroissante, maximale au milieu), « harmonisch » ; StairDesigner règle la portée et la
 * raideur du balancement par deux coefficients (CBL, CBD). B propose [ANALYSE, **non issue des
 * sources**] le poids w_k = exp(−(d_k / λ)^p), d_k = distance (en marches) à l'angle,
 * λ ≈ portée (CBD), p ≈ raideur (CBL), avec « φ_a, φ_b imposés par normalisation de w sur
 * [a ; b] ».
 *
 * Lecture retenue [ANALYSE, choix Blondel, à valider] : w pondère les **incréments** de
 * rotation entre nez consécutifs, normalisés pour que la rotation totale de la zone soit celle
 * de ses nez fixes (φ_b − φ_a : ±90° par quart tournant) :
 *
 *   Δφ_k = (φ_b − φ_a)·w(d_k) / Σ_{i=a+1..b} w(d_i),   φ_k = φ_a + Σ_{i=a+1..k} Δφ_i,
 *
 * d_k = distance sur Γ, en girons, du milieu du pas (s_{k−1} + s_k)/2 à l'angle le plus proche
 * (milieu de la partie tournante de Γ ; deux angles dans une zone unique de 180°). λ → ∞ ou
 * p → 0 : rotation constante (« gleichmäßig ») ; λ petit : rotation concentrée à l'angle
 * (tend vers le rayonnant). Chaque ligne pivote autour de P_k (invariant B §3.1) ; le collet
 * n'est contrôlé qu'a posteriori (post-traitement commun, choix de zone).
 *
 * Paramètres (`BalancingInput.params`) : `reach` (λ, girons, défaut `ROTATION_DEFAULT_REACH`),
 * `steepness` (p, défaut `ROTATION_DEFAULT_STEEPNESS`).
 */
import { msg } from "@blondel/i18n";
import { wrapPi } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import type { BalancingInput, BalancingSolution, BalancingStrategy } from "../model/plugins.js";
import { numberParam, zoneEnds, zoneTurns } from "./zone.js";

/** Portée λ par défaut (girons) : **[choix Blondel, à valider]**, sans source. */
export const ROTATION_DEFAULT_REACH = 2;
/** Raideur p par défaut : **[choix Blondel, à valider]**, sans source. */
export const ROTATION_DEFAULT_STEEPNESS = 2;

/** Poids w(d) = exp(−(d/λ)^p). */
export function rotationWeight(d: number, reach: number, steepness: number): number {
  return Math.exp(-Math.pow(Math.abs(d) / reach, steepness));
}

function solve(input: BalancingInput): BalancingSolution {
  const { a, b } = zoneEnds(input);
  const reach = numberParam(input, "reach") ?? ROTATION_DEFAULT_REACH;
  const steepness = numberParam(input, "steepness") ?? ROTATION_DEFAULT_STEEPNESS;
  if (!(reach > 0) || !(steepness > 0)) {
    return {
      kind: "fail",
      reason: msg("balancing.m6.fail.invalidSettings", {
        reach: String(reach),
        steepness: String(steepness),
      }),
    };
  }
  const { layout, going } = input;
  const turns = zoneTurns(input);
  const corners = turns.map((j) => (layout.turns[j]!.sStart + layout.turns[j]!.sEnd) / 2);
  // Rotation totale attendue : ±90° par tournant (gauche : sens trigonométrique).
  const expected = turns.reduce(
    (acc, j) => acc + ((layout.turns[j]!.direction === "left" ? 1 : -1) * Math.PI) / 2,
    0,
  );
  const phiA = V.angleOf(input.nosings[a]!.dir);
  const phiB = V.angleOf(input.nosings[b]!.dir);
  const total = expected + wrapPi(phiB - phiA - expected);
  const weights: number[] = [];
  for (let k = a + 1; k <= b; k++) {
    const mid = (input.nosings[k - 1]!.s + input.nosings[k]!.s) / 2;
    const d = Math.min(...corners.map((c) => Math.abs(mid - c))) / going;
    weights.push(rotationWeight(d, reach, steepness));
  }
  const sum = weights.reduce((x, y) => x + y, 0);
  if (!(sum > 0)) {
    return { kind: "fail", reason: msg("balancing.m6.fail.zeroWeights") };
  }
  const phi: number[] = [];
  let acc = phiA;
  for (let i = 0; i + 1 < weights.length; i++) {
    acc += (total * weights[i]!) / sum;
    phi.push(acc);
  }
  return { kind: "phi", phi };
}

export const M6_STRATEGY: BalancingStrategy = {
  id: "M6",
  labelKey: "balancing.m6.label",
  solve,
};
