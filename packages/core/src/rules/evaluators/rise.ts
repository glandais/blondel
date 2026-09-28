/**
 * Hauteurs de marche : maxima par contexte, tolérances, première marche, régularité, confort.
 */
import { checkItems, checkValue, flightsOf, riseLocation, type Item } from "../check.js";
import { isRuleApplicable } from "../contexts.js";
import { getRule } from "../table.js";
import type { EvaluatorContext, Finding, RuleEvaluator } from "../types.js";

function riseItems(ctx: EvaluatorContext, fromIndex: number): Item[] {
  return ctx.stepping.rises
    .map((h, i) => ({ value: h, location: riseLocation(i), label: `hauteur ${i + 1}` }))
    .slice(fromIndex);
}

/** h ≤ max sur toutes les hauteurs. */
const allRisesMax: RuleEvaluator = (ctx) => checkItems(ctx, riseItems(ctx, 0), "Hauteur de marche");

/** H_MAX_DTU : « hors marche de départ » (la 1re hauteur a sa propre tolérance). */
const risesMaxExceptFirst: RuleEvaluator = (ctx) =>
  checkItems(ctx, riseItems(ctx, 1), "Hauteur de marche (hors marche de départ)");

/**
 * Écart h_i − h_nom de chaque hauteur. La 1re hauteur n'en est exclue que si elle relève de sa
 * propre tolérance (H_PREMIERE_MARCHE_TOL applicable, c.-à-d. contexte DTU) : hors DTU, la table
 * ne prévoit aucune exception pour la marche de départ (« chaque hauteur de marche »).
 */
const riseTolerance: RuleEvaluator = (ctx) => {
  const firstHasOwnTolerance = isRuleApplicable(getRule("H_PREMIERE_MARCHE_TOL"), ctx.contexts);
  return checkItems(
    ctx,
    ctx.stepping.rises
      .map((h, i) => ({
        value: h - ctx.stepping.rise,
        location: riseLocation(i),
        label: `hauteur ${i + 1}`,
      }))
      .slice(firstHasOwnTolerance ? 1 : 0),
    "Écart à la hauteur nominale",
  );
};

const firstRiseTolerance: RuleEvaluator = (ctx) => {
  const h1 = ctx.stepping.rises[0];
  if (h1 === undefined) return [];
  return [
    checkValue(ctx, h1 - ctx.stepping.rise, "Écart de la 1re hauteur à la hauteur nominale", {
      location: riseLocation(0),
    }),
  ];
};

const nominalRise: RuleEvaluator = (ctx) => [
  checkValue(ctx, ctx.stepping.rise, "Hauteur de marche nominale"),
];

/** max(h_i) − min(h_i) par volée, hors 1re hauteur de l'escalier. */
const riseRegularity: RuleEvaluator = (ctx) => {
  const out: Finding[] = [];
  for (const f of flightsOf(ctx.stepping)) {
    const hs = f.riseIndices.filter((i) => i > 0).map((i) => ctx.stepping.rises[i]!);
    if (hs.length < 2) continue;
    const spread = Math.max(...hs) - Math.min(...hs);
    out.push(
      checkValue(ctx, spread, `Écart entre hauteurs de la volée ${f.number} (hors 1re marche)`),
    );
  }
  const bad = out.filter((f) => f.status === "violation");
  if (bad.length > 0) return bad;
  return out.length > 0
    ? [out.reduce((a, b) => ((b.measured ?? 0) > (a.measured ?? 0) ? b : a))]
    : [];
};

export const RISE_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  H_MAX_DTU: risesMaxExceptFirst,
  H_MAX_LOGEMENT: allRisesMax,
  H_MAX_BHC_PC: allRisesMax,
  H_MAX_ERP_NEUF: allRisesMax,
  H_MAX_ERP_EXISTANT: allRisesMax,
  H_MAX_HELICOIDAL_DTU: allRisesMax,
  H_MAX_ECHELLE_MARCHES: allRisesMax,
  H_TOLERANCE_DTU: riseTolerance,
  H_PREMIERE_MARCHE_TOL: firstRiseTolerance,
  H_CONFORT: nominalRise,
  H_REGULARITE: riseRegularity,
};
