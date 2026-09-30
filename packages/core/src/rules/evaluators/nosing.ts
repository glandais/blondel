/**
 * Nez de marche, recouvrement, contremarches (données du projet : `stair.treads`).
 *
 * Hypothèse : le débord de nez saisi (`treads.nosing`) est aussi le recouvrement horizontal entre
 * deux marches successives, avec ou sans contremarche.
 */
import {
  STAIR,
  checkItems,
  checkValue,
  fmt,
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
  if (t.risers !== "full")
    return [notApplicable("Sans objet : pas de contremarche pleine (voir recouvrement).")];
  const f = checkValue(ctx, t.nosing, "Débord du nez de marche");
  if (
    ctx.rule.id === "DEBORD_NEZ_LOGEMENT" &&
    ctx.rule.recommande !== null &&
    t.nosing > ctx.rule.recommande
  ) {
    return [
      {
        ...f,
        message: `${f.message} Au-delà de ${fmt(ctx.rule.recommande)} mm, le nez doit être arrondi.`,
      },
    ];
  }
  return [f];
};

/** ERP : recouvrement ≥ min sans contremarche. */
const overlapWithoutRiser: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  if (t.risers === "full") return [notApplicable("Sans objet : contremarches pleines.")];
  return [checkValue(ctx, t.nosing, "Recouvrement entre marches (sans contremarche)")];
};

/** Industriel : recouvrement ≥ 50 sans contremarche (formule), ≥ min de la règle avec. */
const overlapIndustrial: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  const min = t.risers === "full" ? ctx.rule.min : INDUSTRIAL_OVERLAP_OPEN.value;
  return [
    checkValue(
      ctx,
      t.nosing,
      `Recouvrement entre marches (${t.risers === "full" ? "avec" : "sans"} contremarche)`,
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
  if (rises.length === 0) return [notEvaluated("Aucune hauteur de marche dans le découpage.")];
  const ends = rises.length === 1 ? [0] : [0, rises.length - 1];
  if (t.risers === "open") {
    return [
      notEvaluated(
        "Contremarches ajourées : hauteur pleine des contremarches extrêmes non connue.",
      ),
    ];
  }
  const out: Finding[] = ends.map((i) => {
    const h = t.risers === "full" ? rises[i]! : 0;
    const f = checkValue(
      ctx,
      h,
      `Contremarche ${i === 0 ? "de la 1re" : "de la dernière"} marche`,
      {
        location: riseLocation(i),
      },
    );
    return f.status === "ok" ? { ...f, message: `${f.message} Contraste visuel non vérifié.` } : f;
  });
  return out.length > 0 ? out : [notApplicable("Sans objet.")];
};

/**
 * VIDE_ENTRE_MARCHES (sans contremarche) : vide vertical entre le dessus d'une marche et le dessous
 * de la suivante = h − épaisseur de marche, comparé strictement au diamètre de sphère (`max`).
 * Approximation : le recouvrement rend l'ouverture au moins aussi étroite que ce vide vertical.
 */
const gapBetweenTreads: RuleEvaluator = (ctx) => {
  const t = spec(ctx);
  if (t.risers === "full") return [notApplicable("Sans objet : contremarches pleines.")];
  if (t.risers === "open")
    return [notEvaluated("Contremarches ajourées : vide dépendant du remplissage, non évalué.")];
  return checkItems(
    ctx,
    ctx.stepping.rises.slice(1).map((h, k) => ({
      value: h - t.thickness,
      location: riseLocation(k + 1),
      label: `entre les marches ${k + 1} et ${k + 2}`,
    })),
    "Vide vertical entre marches",
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
            message:
              "Échelle de meunier hors domaine du NF DTU 36.3 : le contexte bois_dtu ne peut pas être revendiqué.",
          },
        ]
      : [
          {
            status: "ok",
            location: STAIR,
            message: "Échelle de meunier : analogies échelle à marches appliquées.",
          },
        ],
};
