/**
 * Grandeurs globales de l'escalier : module de Blondel, pente, emmarchement et largeurs,
 * position de la ligne de foulée, échappée.
 */
import { pointInPolygon } from "../../geom2d/polygon.js";
import { curvePointAt } from "../../geom2d/curve.js";
import { coveredIntervals, openingPolygon } from "../../headroom/headroom.js";
import type { Location, Severity } from "../../model/derived.js";
import {
  NUMERIC_EPS,
  STAIR,
  checkValue,
  fmt,
  notApplicable,
  notEvaluated,
  treadLocation,
  treadsOfKind,
  within,
  type Bounds,
} from "../check.js";
import { LF_WIDE_THRESHOLD, upCount } from "../params.js";
import { isRuleApplicable } from "../contexts.js";
import { goingsOnMeasurementLine } from "../measurementLine.js";
import { RULES, findRule, getRule, ruleParam, type RuleDef } from "../table.js";
import { SEVERITY_RANK, effectiveSeverity } from "../severity.js";
import { guardsOf, handrailClearWidth } from "./guards.js";
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
 * Largeur de passage L_passage (variable de rules.yaml, A-regles L3) : emmarchement diminué de
 * l'empiètement des mains courantes qui dépassent la saillie admise (`parametres.saillie_mc_max`,
 * 100 mm : au-delà, la largeur se mesure à l'aplomb de la main courante). `null` si les
 * garde-corps ne sont pas décrits ou pas calculés (modèle partiel).
 */
export function passageWidth(
  ctx: EvaluatorContext,
): { width: number; location: Location; deducted: number; limit: number } | null {
  const g = ctx.incomplete ? null : guardsOf(ctx);
  if (!g) return null;
  const limit = ruleParam(ctx.rule, "saillie_mc_max");
  let w = width(ctx);
  let deducted = 0;
  let location: Location = STAIR;
  for (const side of ["inner", "outer"] as const) {
    const hs = g.handrails.filter((h) => h.side === side);
    if (hs.length === 0) continue;
    const worst = hs.reduce((a, b) => (b.intrusion > a.intrusion ? b : a));
    if (worst.intrusion > limit + NUMERIC_EPS) {
      w -= worst.intrusion;
      deducted++;
      location = { kind: "part", partId: worst.partId };
    }
  }
  return { width: w, location, deducted, limit };
}

function passageLabel(p: { deducted: number; limit: number }): string {
  return p.deducted > 0
    ? `Largeur de passage (à l'aplomb des mains courantes saillantes de plus de ${fmt(p.limit, 0)} mm)`
    : `Largeur de passage (aucune main courante saillante de plus de ${fmt(p.limit, 0)} mm)`;
}

/**
 * Largeur de passage (logement) : emmarchement diminué des mains courantes saillantes de plus
 * de 100 mm quand les garde-corps sont décrits ; sinon emmarchement, sous réserve.
 */
const passageWidthLogement: RuleEvaluator = (ctx) => {
  const p = passageWidth(ctx);
  if (p) return [checkValue(ctx, p.width, passageLabel(p), { location: p.location })];
  const f = checkValue(ctx, width(ctx), "Largeur de passage (mesurée sur l'emmarchement)");
  return [
    f.status === "ok"
      ? {
          ...f,
          message: `${f.message} Sous réserve de mains courantes saillantes de plus de ${fmt(ruleParam(ctx.rule, "saillie_mc_max"), 0)} mm (garde-corps non décrits).`,
        }
      : f,
  ];
};

/**
 * LARGEUR_UP_ERP : largeur de passage ≥ 1 UP (900 mm, `min`) ; le nombre d'UP exigé dépend de
 * l'effectif, absent du projet : le message donne le nombre d'UP offert par la largeur.
 */
const passageWidthUp: RuleEvaluator = (ctx) => {
  const p = passageWidth(ctx);
  if (!p) return upperBoundedByWidth(ctx);
  const f = checkValue(ctx, p.width, passageLabel(p), { location: p.location });
  const n = upCount(p.width);
  return [
    {
      ...f,
      message: `${f.message} Largeur de ${n} unité(s) de passage ; le nombre d'UP exigé dépend de l'effectif, non saisi.`,
    },
  ];
};

/**
 * MC_INTERMEDIAIRE_ERP : au-delà de 4 UP (`max`), mains courantes intermédiaires (CO 55 §1), que
 * Blondel ne modélise pas. Nombre d'UP de la largeur de passage (garde-corps décrits) ou de
 * l'emmarchement (majorant) sinon.
 */
const intermediateHandrails: RuleEvaluator = (ctx) => {
  const max = ctx.rule.max;
  if (max === null) return [notEvaluated("Nombre d'UP maximal absent de la table.")];
  const p = passageWidth({ ...ctx, rule: getRule("LARGEUR_UP_ERP") });
  const w = p ? p.width : width(ctx);
  const n = upCount(w);
  const what = p ? "largeur de passage" : "emmarchement";
  const base = { measured: n, min: null, max, location: p?.location ?? STAIR } as const;
  if (n <= max)
    return [
      {
        ...base,
        status: "ok",
        message: `${n} unité(s) de passage (${what} ${fmt(w, 0)} mm) ≤ ${max} : pas de main courante intermédiaire exigée.`,
      },
    ];
  if (!p)
    return [
      {
        ...base,
        status: "non-evaluee",
        message: `Emmarchement ${fmt(w, 0)} mm, soit ${n} UP > ${max} : mains courantes intermédiaires probablement exigées (CO 55 §1) ; à vérifier avec les garde-corps.`,
      },
    ];
  return [
    {
      ...base,
      status: "violation",
      message: `${n} unités de passage (largeur de passage ${fmt(w, 0)} mm) > ${max} : mains courantes intermédiaires exigées (CO 55 §1), non modélisées par Blondel.`,
    },
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
function walklineAt(ctx: EvaluatorContext, expected: number, label: string): Finding[] {
  const d = ctx.layout.walklineOffset;
  const base = { measured: d, min: expected, max: expected, location: STAIR } as const;
  if (Math.abs(d - expected) <= NUMERIC_EPS) {
    return [
      {
        ...base,
        status: "ok",
        message: `Ligne de foulée à ${fmt(d)} mm du bord intérieur (${label}).`,
      },
    ];
  }
  if (treadsOfKind(ctx.stepping, "winder").length === 0) {
    // Sans incidence : la ligne de conception n'est pas soumise à la borne ; ni mesure ni
    // bornes (sinon « mesuré 650 mm, attendu 600 mm » sur une ligne conforme).
    return [
      {
        status: "ok",
        min: null,
        max: null,
        location: STAIR,
        message: `Ligne de conception à ${fmt(d)} mm, ligne de mesure attendue à ${fmt(expected)} mm (${label}) : sans incidence, aucune marche balancée.`,
      },
    ];
  }
  return measurementLineFindings(ctx, expected, label);
}

/** Grandeur contrôlée sur la ligne de mesure par chaque règle de `regles_mesurees`. */
const MEASURED_QUANTITY: Readonly<Record<string, "going" | "deviation">> = {
  G_MIN_DTU: "going",
  G_MIN_LOGEMENT: "going",
  G_MIN_BHC_PC: "going",
  G_MIN_ERP_NEUF: "going",
  G_MIN_ERP_EXISTANT: "going",
  // |g_i − g_nom| ≤ 10 mm sur chaque ligne de mesure réglementaire (B-geometrie §2.2, K1 / K9).
  G_TOL_BALANCEE: "deviation",
};

/**
 * SPEC X9 : ligne de conception distincte de la ligne de mesure réglementaire, marches
 * balancées. Les girons balancés sont mesurés sur la ligne de mesure (`goingsOnMeasurementLine`)
 * et contrôlés par les règles de `regles_mesurees` applicables (seuils de ces règles, sévérité
 * la plus faible des deux règles).
 */
function measurementLineFindings(
  ctx: EvaluatorContext,
  expected: number,
  label: string,
): Finding[] {
  const d = ctx.layout.walklineOffset;
  const head = `Ligne de conception à ${fmt(d)} mm, ligne de mesure à ${fmt(expected)} mm (${label})`;
  const res = goingsOnMeasurementLine(ctx.layout, ctx.stepping, expected);
  if (!res.ok)
    return [
      {
        ...notEvaluated(`${head} : girons balancés non mesurés (${res.reason}).`),
        measured: d,
        min: expected,
        max: expected,
      },
    ];
  // Règles de giron applicables, avec leur sévérité effective (profil, surcharges de
  // l'utilisateur) : une règle ignorée par l'utilisateur n'est pas reportée sur cette ligne.
  const rules: { rule: RuleDef; severity: Severity; reason?: string }[] = [];
  const ignored: string[] = [];
  for (const id of ctx.rule.regles_mesurees ?? []) {
    const r = findRule(id);
    if (!r) throw new Error(`Règle mesurée inconnue : ${id}.`);
    if (!MEASURED_QUANTITY[id]) throw new Error(`Grandeur mesurée inconnue pour ${id}.`);
    if (!isRuleApplicable(r, ctx.contexts)) continue;
    const eff = effectiveSeverity(r, ctx.project.compliance);
    if (eff.ignored) ignored.push(id);
    else
      rules.push({
        rule: r,
        severity: eff.severity,
        ...(eff.downgradeReason !== undefined ? { reason: eff.downgradeReason } : {}),
      });
  }
  const ignoredText =
    ignored.length > 0 ? ` ; ${ignored.join(", ")} ignorée(s) par l'utilisateur` : "";
  const goings = res.goings.map((g) => g.going);
  const lo = Math.min(...goings);
  const hi = Math.max(...goings);
  const range = `girons balancés de ${fmt(lo)} à ${fmt(hi)} mm sur la ligne de mesure`;
  if (rules.length === 0)
    return [
      {
        status: "ok",
        measured: lo,
        min: null,
        max: null,
        location: STAIR,
        message: `${head} : ${range} ; aucune règle de giron applicable à cette ligne dans les contextes actifs${ignoredText}.`,
      },
    ];
  // Giron nominal de la ligne de mesure : celui des marches droites (identique sur toute ligne) ;
  // hélicoïdal (aucune marche droite, toutes les marches égales) : le giron de la ligne.
  const nominal = ctx.layout.helical ? lo : ctx.stepping.going;
  const out: Finding[] = [];
  for (const { rule: r, severity, reason } of rules) {
    const deviation = MEASURED_QUANTITY[r.id] === "deviation";
    const b: Bounds = { min: r.min, max: r.max };
    const weaker = SEVERITY_RANK[severity] < SEVERITY_RANK[ctx.rule.severite];
    for (const { tread, going } of res.goings) {
      const v = deviation ? going - nominal : going;
      if (within(v, b)) continue;
      const expectedText = deviation
        ? `écart au giron nominal ${fmt(nominal)} mm dans [${fmt(r.min ?? -Infinity)} ; ${fmt(r.max ?? Infinity)}] mm`
        : `giron ≥ ${fmt(r.min ?? 0)} mm`;
      out.push({
        status: "violation",
        measured: v,
        min: r.min,
        max: r.max,
        location: treadLocation(tread),
        message: `${head} : marche ${tread.number} (balancée), giron ${fmt(going)} mm sur la ligne de mesure (${r.id} : ${expectedText}).`,
        ...(weaker
          ? {
              severity,
              severityReason: `Sévérité de ${r.id}, contrôlée sur la ligne de mesure${reason ? ` (${reason})` : ""}.`,
            }
          : {}),
      });
    }
  }
  if (out.length > 0) return out;
  return [
    {
      status: "ok",
      measured: lo,
      min: null,
      max: null,
      location: STAIR,
      message: `${head} : ${range}, conformes à ${rules.map((r) => r.rule.id).join(", ")}${ignoredText}.`,
    },
  ];
}

/** Milieu si E ≤ seuil, 600 mm (valeur `min` de la règle large) sinon. */
function dtuWalkline(branch: "narrow" | "wide" | "both"): RuleEvaluator {
  return (ctx) => {
    const e = width(ctx);
    // Seuil de la règle évaluée (`parametres.E_seuil`), à défaut celui des règles DTU.
    const threshold = ctx.rule.parametres?.["E_seuil"] ?? LF_WIDE_THRESHOLD.value;
    const narrow = e <= threshold;
    if (branch === "narrow" && !narrow)
      return [notApplicable(`Sans objet : E = ${fmt(e)} mm > ${threshold} mm.`)];
    if (branch === "wide" && narrow)
      return [notApplicable(`Sans objet : E = ${fmt(e)} mm ≤ ${threshold} mm.`)];
    if (narrow) return walklineAt(ctx, e / 2, `milieu de l'emmarchement, E = ${fmt(e)} mm`);
    const d = branch === "wide" ? ctx.rule.min : wideDistance(ctx);
    if (d === null) return [notEvaluated("Distance de la ligne de mesure absente de la table.")];
    return walklineAt(ctx, d, `E = ${fmt(e)} mm > ${threshold} mm`);
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
  return walklineAt(ctx, d, "distance réglementaire au bord intérieur");
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

// ------------------------------------------------------------------ Trémie

/**
 * TREMIE_LONGUEUR (conseil, A-regles §1.7) : longueur de trémie mesurée sur la ligne de foulée
 * depuis le nez d'arrivée ≥ (e_min + ep) · g / h, avec e_min le seuil d'échappée des règles
 * ECHAPPEE_* bloquantes actives (comme ECHAPPEE_LARGEUR), ep l'épaisseur du plancher haut.
 * Dérivation pour une volée **droite** : évaluée si la ligne de foulée est droite sur la
 * longueur exigée avant l'arrivée (pas de tournant ni d'hélicoïdal) ; l'échappée elle-même est
 * contrôlée par les règles ECHAPPEE_*.
 */
const openingLength: RuleEvaluator = (ctx) => {
  const poly = openingPolygon(ctx.project.site.opening);
  if (!poly) return [notApplicable("Sans objet : pas de trémie (aucun plancher au-dessus).")];
  const threshold = headroomWidthThreshold(ctx.contexts);
  if (threshold === null)
    return [
      notApplicable("Sans objet : aucune règle d'échappée bloquante dans les contextes actifs."),
    ];
  const nosings = ctx.stepping.nosings;
  if (ctx.incomplete || nosings.length < 2)
    return [notEvaluated("Découpage non calculé (modèle partiel).")];
  if (ctx.layout.helical)
    return [
      notEvaluated(
        "Hélicoïdal : la longueur de trémie (volée droite) ne s'applique pas ; échappée contrôlée par les règles ECHAPPEE_*.",
      ),
    ];
  const ep = ctx.project.site.upperSlabThickness;
  const { rise: h, going: g } = ctx.stepping;
  const required = ((threshold.min + ep) * g) / h;
  const arrival = nosings[nosings.length - 1]!;
  const sA = arrival.s;
  if (pointInPolygon(arrival.p, poly) === "outside")
    return [
      notApplicable(
        "Sans objet : l'arrivée (nez d'arrivée sur la ligne de foulée) n'est pas dans la trémie.",
      ),
    ];
  // Dernier passage sous la dalle avant l'arrivée : la trémie s'étend de sa sortie à l'arrivée.
  const covered = coveredIntervals(ctx.layout.walkline, poly).filter(
    (c) => c.s1 <= sA + NUMERIC_EPS,
  );
  const edge = covered.length > 0 ? covered[covered.length - 1]!.s1 : 0;
  const length = sA - edge;
  const from = Math.max(0, sA - Math.max(required, length));
  const curved =
    ctx.layout.turns.some((t) => t.sEnd > from + NUMERIC_EPS && t.sStart < sA - NUMERIC_EPS) ||
    (ctx.layout.walklineTransitions ?? []).some(
      (t) => t.sEnd > from + NUMERIC_EPS && t.sStart < sA - NUMERIC_EPS,
    );
  if (curved)
    return [
      notEvaluated(
        `Tournant dans les ${fmt(Math.max(required, length), 0)} mm de ligne de foulée avant l'arrivée : dérivation pour une volée droite, échappée contrôlée par les règles ECHAPPEE_*.`,
      ),
    ];
  const p = curvePointAt(ctx.layout.walkline, edge);
  return [
    checkValue(
      ctx,
      length,
      `Longueur de trémie sur la ligne de foulée depuis le nez d'arrivée ((e + ep) · g / h avec e = ${fmt(threshold.min, 0)} mm de ${threshold.ruleId}, ep = ${fmt(ep, 0)} mm, g = ${fmt(g)} mm, h = ${fmt(h)} mm)`,
      {
        bounds: { min: required, max: null },
        location: { kind: "point", at: { x: p.x, y: p.y, z: ctx.project.site.floorToFloor } },
      },
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
  LARGEUR_UP_ERP: passageWidthUp,
  MC_INTERMEDIAIRE_ERP: intermediateHandrails,
  TREMIE_LONGUEUR: openingLength,
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
