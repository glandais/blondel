/**
 * M3 — balancement par développement du limon intérieur (B §3.5, CHALLENGE G3), méthode par
 * défaut. La courbe F (cubique C1 ou quintique C2, voir `profile.ts`) relie sur le développé
 * les nez fixes a et b ; chaque nez intermédiaire k se lit à l'intersection de F avec
 * l'horizontale z = z_k : σ_k = F⁻¹(z_k) (dichotomie, z_k liste générale).
 *
 * Paramètres (`BalancingInput.params`) : `variant` (`cubic` par défaut, `quintic`) ;
 * optionnels `startSlope`, `endSlope` (pentes des parties droites, sinon Δz/Δs des marches
 * voisines).
 */
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { BalancingInput, BalancingSolution, BalancingStrategy } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import {
  buildProfile,
  evalProfile,
  invertProfile,
  isStrictlyIncreasing,
  maxSlope,
  type DevelopmentProfile,
  type M3Variant,
} from "./profile.js";
import { adjacentSlopes, zoneEnds } from "./zone.js";

function variantOf(input: BalancingInput): M3Variant {
  return input.params["variant"] === "quintic" ? "quintic" : "cubic";
}

/** Courbe F de la zone (ou raison d'échec). */
export function zoneProfile(
  input: BalancingInput,
): { profile: DevelopmentProfile; delta: Mm; zA: Mm } | { reason: string } {
  const { a, b, sigmaA, sigmaB } = zoneEnds(input);
  const delta = sigmaB - sigmaA;
  const zA = input.z[a];
  const zB = input.z[b];
  if (zA === undefined || zB === undefined) return { reason: "altitudes des nez manquantes" };
  // Longueur de jour indiscernable de 0 (nez fixes passant tous deux par un angle vif du jour de
  // développement) : le signe de delta ne tient qu'au bruit d'arrondi, on refuse la zone.
  if (!(delta > GEOM_EPS)) {
    return { reason: `longueur de jour nulle ou négative entre les nez ${a} et ${b}` };
  }
  const slopes = adjacentSlopes(input);
  const profile = buildProfile({
    variant: variantOf(input),
    ends: input.zone.ends,
    meanSlope: (zB - zA) / delta,
    startSlope: slopes.start,
    endSlope: slopes.end,
  });
  return { profile, delta, zA };
}

function solve(input: BalancingInput): BalancingSolution {
  const built = zoneProfile(input);
  if ("reason" in built) return { kind: "fail", reason: built.reason };
  const { profile, delta, zA } = built;
  if (!isStrictlyIncreasing(profile)) {
    return {
      kind: "fail",
      reason: "courbe de développement non strictement croissante (jour trop long pour la zone)",
    };
  }
  const { a, b, sigmaA } = zoneEnds(input);
  const sigma: Mm[] = [];
  for (let k = a + 1; k < b; k++) {
    const y = (input.z[k]! - zA) / delta;
    sigma.push(sigmaA + invertProfile(profile, y) * delta);
  }
  // Contrôle de cohérence : F(σ_k) = z_k (dichotomie convergée).
  const last = sigma[sigma.length - 1];
  if (
    last !== undefined &&
    Math.abs(zA + delta * evalProfile(profile, (last - sigmaA) / delta) - input.z[b - 1]!) > 1e-6
  ) {
    return { kind: "fail", reason: "inversion de F non convergée" };
  }
  return { kind: "sigma", sigma };
}

/** Collet minimal estimé en longueur d'arc : h / F'max (B §3.5). */
function estimateMinCollet(input: BalancingInput): Mm {
  const built = zoneProfile(input);
  if ("reason" in built) return 0;
  const fmax = maxSlope(built.profile);
  return fmax > 0 ? input.rise / fmax : 0;
}

export const M3_STRATEGY: BalancingStrategy = {
  id: "M3",
  label: "Développement du limon (M3)",
  solve,
  estimateMinCollet,
};
