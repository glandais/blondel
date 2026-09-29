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
import { isRuleApplicable } from "../contexts.js";
import { RULES, getRule } from "../table.js";
import { handrailClearWidth } from "./guards.js";
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

/**
 * Largeur entre mains courantes : emmarchement diminué de l'empiètement des mains courantes
 * (jalon 4, `handrailClearWidth`) quand les garde-corps sont décrits ; sinon majorant E.
 */
const betweenHandrails: RuleEvaluator = (ctx) => {
  const w = ctx.incomplete ? null : handrailClearWidth(ctx);
  if (!w) return upperBoundedByWidth(ctx);
  return [
    checkValue(ctx, w.width, "Largeur libre entre mains courantes", { location: w.location }),
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
    // Sans incidence : la ligne de conception n'est pas soumise à la borne ; ni mesure ni
    // bornes (sinon « mesuré 650 mm, attendu 600 mm » sur une ligne conforme).
    return {
      status: "ok",
      min: null,
      max: null,
      location: STAIR,
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

/** Préfixe des règles d'échappée dont `ECHAPPEE_LARGEUR` reprend le seuil. */
const HEADROOM_PREFIX = "ECHAPPEE_";
const HEADROOM_WIDTH_RULE = "ECHAPPEE_LARGEUR";

/**
 * Seuil de `ECHAPPEE_LARGEUR` : plus grand `min` des règles ECHAPPEE_* de sévérité **déclarée**
 * `bloquant` applicables aux contextes actifs (QUESTIONS A7) ; `null` sans telle règle. La
 * sévérité déclarée (et non effective) est retenue : le profil souple ou une surcharge ne
 * change pas l'exigence reprise.
 */
export function headroomWidthThreshold(
  contexts: ReadonlySet<string>,
): { min: number; ruleId: string } | null {
  let best: { min: number; ruleId: string } | null = null;
  for (const r of RULES) {
    if (!r.id.startsWith(HEADROOM_PREFIX) || r.id === HEADROOM_WIDTH_RULE) continue;
    if (r.severite !== "bloquant" || r.min === null || !isRuleApplicable(r, contexts)) continue;
    if (best === null || r.min > best.min) best = { min: r.min, ruleId: r.id };
  }
  return best;
}

/** ECHAPPEE_LARGEUR : échappée sur la largeur des marches ≥ seuil des ECHAPPEE_* bloquantes. */
const headroomWidth: RuleEvaluator = (ctx) => {
  const threshold = headroomWidthThreshold(ctx.contexts);
  if (threshold === null)
    return [
      notApplicable("Sans objet : aucune règle d'échappée bloquante dans les contextes actifs."),
    ];
  if (ctx.incomplete)
    return [notEvaluated("Échappée sur la largeur non calculée (modèle partiel).")];
  const w = ctx.headroomWidth;
  if (!w) {
    if (!ctx.project.site.opening)
      return [notApplicable("Sans objet : pas de trémie (aucun plancher au-dessus).")];
    if (!ctx.headroomWidthClear) return [notEvaluated("Échappée sur la largeur non calculée.")];
    return [
      {
        status: "ok",
        min: threshold.min,
        message:
          "Échappée sur la largeur non limitée : aucun nez de marche sous la dalle haute (trémie couvrante).",
      },
    ];
  }
  // Le nez k porte le dessus de la marche k + 1 ; le dernier est le nez d'arrivée.
  const where =
    w.nosing === ctx.stepping.nosings.length - 1
      ? "au nez d'arrivée"
      : `au nez de la marche ${w.nosing + 1}`;
  return [
    checkValue(
      ctx,
      w.min,
      `Échappée sur la largeur des marches ${where} (seuil repris de ${threshold.ruleId})`,
      { bounds: { min: threshold.min, max: null }, location: { kind: "point", at: w.at } },
    ),
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
  LARGEUR_MC_BHC_PC: betweenHandrails,
  LARGEUR_MC_ERP_NEUF: betweenHandrails,
  LARGEUR_MC_ERP_EXISTANT: betweenHandrails,
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
  ECHAPPEE_LARGEUR: headroomWidth,
};
