/**
 * Nez de marche, recouvrement, contremarches (données du projet : `stair.treads`).
 *
 * Hypothèse : le débord de nez saisi (`treads.nosing`) est aussi le recouvrement horizontal entre
 * deux marches successives, avec ou sans contremarche.
 */
import { dec, msg } from "@blondel/i18n";
import {
  STAIR,
  checkItems,
  checkValue,
  notApplicable,
  notEvaluated,
  riseLocation,
} from "../check.js";
import { INDUSTRIAL_OVERLAP_OPEN } from "../params.js";
import type { EvaluatorContext, Finding, RuleEvaluator } from "../types.js";

function spec(ctx: EvaluatorContext) {
  return ctx.project.stair.treads;
}

/** Débord de nez sur la contremarche ; sans objet sans contremarche pleine. */
const nosingOverhang: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  if (t.risers !== "full") return [notApplicable(msg("compliance.nosing.noFullRiser"))];
  const f = checkValue(ctx, t.nosing, msg("compliance.nosing.overhang"));
  if (
    ctx.rule.id === "DEBORD_NEZ_LOGEMENT" &&
    ctx.rule.recommande !== null &&
    t.nosing > ctx.rule.recommande
  ) {
    return [
      {
        ...f,
        message: msg("rules.DEBORD_NEZ_LOGEMENT.rounded", {
          message: f.message,
          recommended: dec(ctx.rule.recommande),
        }),
      },
    ];
  }
  return [f];
};

/** ERP : recouvrement ≥ min sans contremarche. */
const overlapWithoutRiser: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  if (t.risers === "full") return [notApplicable(msg("compliance.nosing.fullRisers"))];
  return [checkValue(ctx, t.nosing, msg("rules.RECOUVREMENT_ERP_SANS_CM.label"))];
};

/** Industriel : recouvrement ≥ 50 sans contremarche (formule), ≥ min de la règle avec. */
const overlapIndustrial: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  const min = t.risers === "full" ? ctx.rule.min : INDUSTRIAL_OVERLAP_OPEN.value;
  return [
    checkValue(
      ctx,
      t.nosing,
      msg(
        t.risers === "full"
          ? "rules.RECOUVREMENT_INDUSTRIEL.withRiser"
          : "rules.RECOUVREMENT_INDUSTRIEL.withoutRiser",
      ),
      {
        bounds: { min, max: ctx.rule.max },
      },
    ),
  ];
};

/** 1re et dernière marches avec contremarche ≥ min (hauteur de contremarche = hauteur de marche). */
const extremeRisers: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  const rises = ctx.stepping.rises;
  if (rises.length === 0) return [notEvaluated(msg("rules.CONTREMARCHE_EXTREMES.noRises"))];
  const ends = rises.length === 1 ? [0] : [0, rises.length - 1];
  if (t.risers === "open") {
    return [notEvaluated(msg("rules.CONTREMARCHE_EXTREMES.open"))];
  }
  const out: Finding[] = ends.map((i) => {
    const h = t.risers === "full" ? rises[i]! : 0;
    const f = checkValue(
      ctx,
      h,
      msg(i === 0 ? "rules.CONTREMARCHE_EXTREMES.first" : "rules.CONTREMARCHE_EXTREMES.last"),
      {
        location: riseLocation(i),
      },
    );
    return f.status === "ok"
      ? {
          ...f,
          message: msg("rules.CONTREMARCHE_EXTREMES.contrastNotChecked", { message: f.message }),
        }
      : f;
  });
  return out.length > 0 ? out : [notApplicable(msg("compliance.notApplicable"))];
};

/**
 * VIDE_ENTRE_MARCHES (sans contremarche) : vide vertical entre le dessus d'une marche et le dessous
 * de la suivante = h − épaisseur de marche, comparé strictement au diamètre de sphère (`max`).
 * Approximation : le recouvrement rend l'ouverture au moins aussi étroite que ce vide vertical.
 */
const gapBetweenTreads: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  if (t.risers === "full") return [notApplicable(msg("compliance.nosing.fullRisers"))];
  if (t.risers === "open") return [notEvaluated(msg("rules.VIDE_ENTRE_MARCHES.open"))];
  return checkItems(
    ctx,
    ctx.stepping.rises.slice(1).map((h, k) => ({
      value: h - t.thickness,
      location: riseLocation(k + 1),
      label: msg("rules.VIDE_ENTRE_MARCHES.item", { lower: k + 1, upper: k + 2 }),
    })),
    msg("rules.VIDE_ENTRE_MARCHES.quantity"),
    { bounds: { min: ctx.rule.min, max: ctx.rule.max, strictMax: true } },
  );
};

export const NOSING_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  DEBORD_NEZ_ERP: nosingOverhang,
  DEBORD_NEZ_LOGEMENT: nosingOverhang,
  DEBORD_NEZ_BHC_PC: nosingOverhang,
  RECOUVREMENT_ERP_SANS_CM: overlapWithoutRiser,
  RECOUVREMENT_INDUSTRIEL: overlapIndustrial,
  CONTREMARCHE_EXTREMES: extremeRisers,
  VIDE_ENTRE_MARCHES: gapBetweenTreads,
};

/** Échelle de meunier : pas de conformité DTU revendicable si `bois_dtu` est aussi actif. */
export const MISC_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  ECHELLE_MEUNIER_HORS_DTU: (ctx) =>
    ctx.contexts.has("bois_dtu")
      ? [
          {
            status: "violation",
            location: STAIR,
            message: msg("rules.ECHELLE_MEUNIER_HORS_DTU.violation"),
          },
        ]
      : [
          {
            status: "ok",
            location: STAIR,
            message: msg("rules.ECHELLE_MEUNIER_HORS_DTU.ok"),
          },
        ],
};
