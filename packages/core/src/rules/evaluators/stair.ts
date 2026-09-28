/**
 * Grandeurs globales de l'escalier : module de Blondel, pente, emmarchement et largeurs,
 * position de la ligne de foulée, échappée.
 */
import {
  NUMERIC_EPS,
  STAIR,
  checkValue,
  fmt,
  notApplicable,
  notEvaluated,
  treadsOfKind,
} from "../check.js";
import { LF_WIDE_THRESHOLD } from "../formula-constants.js";
import { getRule } from "../table.js";
import type { EvaluatorContext, Finding, RuleEvaluator } from "../types.js";

// ------------------------------------------------------------------ Blondel et pente

const blondel: RuleEvaluator = (ctx) => [
  checkValue(
    ctx,
    ctx.stepping.blondel,
    `Module 2h + g (h = ${fmt(ctx.stepping.rise)} mm, g = ${fmt(ctx.stepping.going)} mm)`,
  ),
];

const steepness: RuleEvaluator = (ctx) => [
  checkValue(ctx, ctx.stepping.rise / ctx.stepping.going, "Rapport h / g"),
];

/** Angle de pente α = atan(h / g), en degrés. */
const slopeAngle: RuleEvaluator = (ctx) => [
  checkValue(
    ctx,
    (Math.atan2(ctx.stepping.rise, ctx.stepping.going) * 180) / Math.PI,
    "Angle de pente (degrés)",
  ),
];

// ------------------------------------------------------------------ Emmarchement et largeurs

function width(ctx: EvaluatorContext): number {
  return ctx.project.stair.layout.width;
}

const stairWidth: RuleEvaluator = (ctx) => [checkValue(ctx, width(ctx), "Emmarchement E")];

/**
 * Largeur de passage (logement) : bornée par l'emmarchement ; les mains courantes saillantes de
 * plus de 100 mm (qui la réduisent) ne sont pas encore connues à ce stade.
 */
const passageWidthLogement: RuleEvaluator = (ctx) => {
  const f = checkValue(ctx, width(ctx), "Largeur de passage (mesurée sur l'emmarchement)");
  return [
    f.status === "ok"
      ? {
          ...f,
          message: `${f.message} Sous réserve de mains courantes saillantes de plus de 100 mm.`,
        }
      : f,
  ];
};

/**
 * Largeurs entre mains courantes ou en unités de passage : l'emmarchement en est un majorant.
 * E < min ⇒ violation certaine ; sinon la vérification attend les mains courantes (garde-corps).
 */
const upperBoundedByWidth: RuleEvaluator = (ctx) => {
  const f = checkValue(ctx, width(ctx), "Emmarchement (majorant de la largeur exigée)");
  if (f.status === "violation") return [f];
  return [
    {
      ...notEvaluated(
        `Emmarchement ${fmt(width(ctx))} mm suffisant ; largeur entre mains courantes ou en unités de passage à vérifier avec les garde-corps.`,
      ),
      measured: width(ctx),
    },
  ];
};

// ------------------------------------------------------------------ Ligne de foulée / de mesure

/**
 * Compare la ligne de conception à la ligne de mesure réglementaire (SPEC X9 : la ligne de
 * conception est libre ; les contrôles portent sur la ligne de mesure).
 * - confondues : ok ;
 * - distinctes sans marche balancée : ok (les girons droits sont identiques sur toute ligne) ;
 * - distinctes avec marches balancées : non évaluée (lignes de mesure séparées non implémentées).
 */
function walklineAt(ctx: EvaluatorContext, expected: number, label: string): Finding {
  const d = ctx.layout.walklineOffset;
  const base = { measured: d, min: expected, max: expected, location: STAIR } as const;
  if (Math.abs(d - expected) <= NUMERIC_EPS) {
    return {
      ...base,
      status: "ok",
      message: `Ligne de foulée à ${fmt(d)} mm du bord intérieur (${label}).`,
    };
  }
  if (treadsOfKind(ctx.stepping, "winder").length === 0) {
    return {
      ...base,
      status: "ok",
      message: `Ligne de conception à ${fmt(d)} mm, ligne de mesure attendue à ${fmt(expected)} mm (${label}) : sans incidence, aucune marche balancée.`,
    };
  }
  return {
    ...base,
    status: "non-evaluee",
    message: `Ligne de conception à ${fmt(d)} mm, ligne de mesure attendue à ${fmt(expected)} mm (${label}) : girons balancés à contrôler sur la ligne de mesure (non implémenté).`,
  };
}

/** Milieu si E ≤ seuil, 600 mm (valeur `min` de la règle large) sinon. */
function dtuWalkline(branch: "narrow" | "wide" | "both"): RuleEvaluator {
  return (ctx) => {
    const e = width(ctx);
    const narrow = e <= LF_WIDE_THRESHOLD.value;
    if (branch === "narrow" && !narrow)
      return [notApplicable(`Sans objet : E = ${fmt(e)} mm > ${LF_WIDE_THRESHOLD.value} mm.`)];
    if (branch === "wide" && narrow)
      return [notApplicable(`Sans objet : E = ${fmt(e)} mm ≤ ${LF_WIDE_THRESHOLD.value} mm.`)];
    if (narrow) return [walklineAt(ctx, e / 2, `milieu de l'emmarchement, E = ${fmt(e)} mm`)];
    const d = branch === "wide" ? ctx.rule.min : wideDistance(ctx);
    if (d === null) return [notEvaluated("Distance de la ligne de mesure absente de la table.")];
    return [walklineAt(ctx, d, `E = ${fmt(e)} mm > ${LF_WIDE_THRESHOLD.value} mm`)];
  };
}

/** Distance pour E large quand la règle elle-même n'a pas de `min` : celle de LF_POSITION_DTU_LARGE. */
function wideDistance(ctx: EvaluatorContext): number | null {
  return ctx.rule.min ?? getRule("LF_POSITION_DTU_LARGE").min;
}

/** d_lf = min (= max) de la règle. */
const fixedWalkline: RuleEvaluator = (ctx) => {
  const d = ctx.rule.min ?? ctx.rule.max;
  if (d === null) return [notEvaluated("Distance de la ligne de mesure absente de la table.")];
  return [walklineAt(ctx, d, "distance réglementaire au bord intérieur")];
};

// ------------------------------------------------------------------ Échappée

const headroom: RuleEvaluator = (ctx) => {
  if (!ctx.headroom) {
    if (!ctx.project.site.opening)
      return [notApplicable("Sans objet : pas de trémie (aucun plancher au-dessus).")];
    if (ctx.headroomClear) {
      return [
        {
          status: "ok",
          message: "Aucun point de la ligne de foulée sous la dalle haute (trémie couvrante).",
        },
      ];
    }
    return [notEvaluated("Échappée non calculée.")];
  }
  return [
    checkValue(ctx, ctx.headroom.min, "Échappée minimale (verticale, sur la ligne de foulée)", {
      location: { kind: "point", at: ctx.headroom.at },
    }),
  ];
};

export const STAIR_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  BLONDEL_DTU: blondel,
  BLONDEL_ERP_BHC: blondel,
  BLONDEL_CONFORT: blondel,
  BLONDEL_INDUSTRIEL: blondel,
  CONFORT_CLASSE: steepness,
  ANGLE_ECHELLE_MARCHES: slopeAngle,
  E_MIN_DTU: stairWidth,
  LARGEUR_MIN_INDUSTRIEL: stairWidth,
  LARGEUR_ECHELLE_MARCHES: stairWidth,
  LARGEUR_MIN_LOGEMENT: passageWidthLogement,
  LARGEUR_MC_BHC_PC: upperBoundedByWidth,
  LARGEUR_MC_ERP_NEUF: upperBoundedByWidth,
  LARGEUR_MC_ERP_EXISTANT: upperBoundedByWidth,
  LARGEUR_UP_ERP: upperBoundedByWidth,
  LF_POSITION_DTU_ETROIT: dtuWalkline("narrow"),
  LF_POSITION_DTU_LARGE: dtuWalkline("wide"),
  LF_POSITION_ACCESSIBILITE: dtuWalkline("both"),
  LF_POSITION_ERP_TOURNANT: fixedWalkline,
  LF_POSITION_HELICOIDAL: fixedWalkline,
  ECHAPPEE_MIN_DTU: headroom,
  ECHAPPEE_RECO_PRIVATIF: headroom,
  ECHAPPEE_RECO_PUBLIC: headroom,
  ECHAPPEE_INDUSTRIEL: headroom,
};
