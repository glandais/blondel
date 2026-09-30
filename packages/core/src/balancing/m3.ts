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
import { msg, type Message } from "@blondel/i18n";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { BalancingInput, BalancingSolution, BalancingStrategy } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import {
  buildProfile,
  buildSpline,
  evalProfile,
  invertProfile,
  isSplineStrictlyIncreasing,
  isStrictlyIncreasing,
  maxSlope,
  type DevelopmentProfile,
  type M3Variant,
  type SplineEnd,
  type SplineProfile,
} from "./profile.js";
import { adjacentSlopes, zoneEnds } from "./zone.js";

function variantOf(input: BalancingInput): M3Variant {
  return input.params["variant"] === "quintic" ? "quintic" : "cubic";
}

/**
 * Spline prolongée de la zone (`BalancingZone.continuation`) : nœuds des nez fixes qui suivent
 * une extrémité libre située dans la partie tournante, conditions à leurs extrémités. `null`
 * sans prolongement, ou si les nœuds ne sont pas strictement croissants.
 */
export function zoneSpline(
  input: BalancingInput,
  variant: M3Variant,
  slopes: { readonly start: number; readonly end: number },
): SplineProfile | null {
  const cont = input.zone.continuation;
  if (!cont || (cont[0] === null && cont[1] === null)) return null;
  const { a, b, sigmaA, sigmaB } = zoneEnds(input);
  const delta = sigmaB - sigmaA;
  const zA = input.z[a]!;
  const knot = (k: number): { t: number; f: number } | null => {
    const nl = input.nosings[k];
    const z = input.z[k];
    if (!nl || z === undefined) return null;
    return { t: (nl.sigmaInner - sigmaA) / delta, f: (z - zA) / delta };
  };
  const secant = (i: number, j: number): number | null => {
    const ki = knot(i);
    const kj = knot(j);
    if (!ki || !kj || !(kj.t - ki.t > GEOM_EPS / delta)) return null;
    return (kj.f - ki.f) / (kj.t - ki.t);
  };
  const knots: { t: number; f: number }[] = [];
  let start: SplineEnd =
    input.zone.ends[0] === "tangent" ? { kind: "tangent", slope: slopes.start } : { kind: "free" };
  let end: SplineEnd =
    input.zone.ends[1] === "tangent" ? { kind: "tangent", slope: slopes.end } : { kind: "free" };
  const [before, after] = cont;
  if (before && before.nosings.length > 0) {
    for (const k of [...before.nosings].reverse()) {
      const kn = knot(k);
      if (!kn) return null;
      knots.push(kn);
    }
    const c = before.nosings[before.nosings.length - 1]!;
    const m = before.end === "tangent" ? secant(c - 1, c) : null;
    start = m !== null && m > 0 ? { kind: "tangent", slope: m } : { kind: "free" };
  }
  knots.push({ t: 0, f: 0 }, knot(b)!);
  if (after && after.nosings.length > 0) {
    for (const k of after.nosings) {
      const kn = knot(k);
      if (!kn) return null;
      knots.push(kn);
    }
    const c = after.nosings[after.nosings.length - 1]!;
    const m = after.end === "tangent" ? secant(c, c + 1) : null;
    end = m !== null && m > 0 ? { kind: "tangent", slope: m } : { kind: "free" };
  }
  for (let i = 0; i + 1 < knots.length; i++) {
    if (!(knots[i + 1]!.t - knots[i]!.t > GEOM_EPS / delta)) return null;
    if (!(knots[i + 1]!.f > knots[i]!.f)) return null;
  }
  try {
    return buildSpline({ variant, knots, start, end });
  } catch {
    return null;
  }
}

/**
 * Courbe F de la zone (ou raison d'échec). Avec un prolongement (`BalancingZone.continuation`),
 * F est le morceau [a ; b] de la spline passant par les nez fixes qui suivent la borne libre
 * (F dérivable à la borne) ; si cette spline n'est pas strictement croissante sur tous ses
 * morceaux, repli sur les conditions naturelles à la borne (F'' = 0), signalé par `spline: null`.
 */
export function zoneProfile(
  input: BalancingInput,
):
  | { profile: DevelopmentProfile; delta: Mm; zA: Mm; spline: SplineProfile | null }
  | { reason: Message } {
  const { a, b, sigmaA, sigmaB } = zoneEnds(input);
  const delta = sigmaB - sigmaA;
  const zA = input.z[a];
  const zB = input.z[b];
  if (zA === undefined || zB === undefined)
    return { reason: msg("balancing.m3.fail.missingAltitudes") };
  // Longueur de jour indiscernable de 0 (nez fixes passant tous deux par un angle vif du jour de
  // développement) : le signe de delta ne tient qu'au bruit d'arrondi, on refuse la zone.
  if (!(delta > GEOM_EPS)) {
    return { reason: msg("balancing.m3.fail.nonPositiveWellLength", { a, b }) };
  }
  const slopes = adjacentSlopes(input);
  const variant = variantOf(input);
  const spline = zoneSpline(input, variant, slopes);
  if (spline && isSplineStrictlyIncreasing(spline)) {
    const i = spline.spec.knots.findIndex((k) => k.t === 0);
    const profile: DevelopmentProfile = {
      spec: {
        variant,
        ends: input.zone.ends,
        meanSlope: (zB - zA) / delta,
        startSlope: slopes.start,
        endSlope: slopes.end,
      },
      coeffs: spline.pieces[i]!,
    };
    return { profile, delta, zA, spline };
  }
  const profile = buildProfile({
    variant,
    ends: input.zone.ends,
    meanSlope: (zB - zA) / delta,
    startSlope: slopes.start,
    endSlope: slopes.end,
  });
  return { profile, delta, zA, spline: null };
}

function solve(input: BalancingInput): BalancingSolution {
  const built = zoneProfile(input);
  if ("reason" in built) return { kind: "fail", reason: built.reason };
  const { profile, delta, zA } = built;
  if (!isStrictlyIncreasing(profile)) {
    return {
      kind: "fail",
      reason: msg("balancing.m3.fail.notIncreasing"),
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
    return { kind: "fail", reason: msg("balancing.m3.fail.inversionNotConverged") };
  }
  return input.zone.continuation
    ? { kind: "sigma", sigma, continued: built.spline !== null }
    : { kind: "sigma", sigma };
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
  labelKey: "balancing.m3.label",
  solve,
  estimateMinCollet,
};
