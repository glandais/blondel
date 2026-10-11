/**
 * Grandeurs globales de l'escalier : module de Blondel, pente, emmarchement et largeurs,
 * position de la ligne de foulée, échappée.
 */
import { MessageError, dec, msg, type Message } from "@blondel/i18n";
import { pointInPolygon } from "../../geom2d/polygon.js";
import { curvePointAt } from "../../geom2d/curve.js";
import { coveredIntervals, openingPolygon } from "../../headroom/headroom.js";
import type { Location, Severity, Tread } from "../../model/derived.js";
import {
  NUMERIC_EPS,
  STAIR,
  checkValue,
  notApplicable,
  notEvaluated,
  junctionWidth,
  treadLocation,
  treadsOfKind,
  widestWidth,
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
    msg("compliance.stair.blondel", {
      rise: dec(ctx.stepping.rise),
      going: dec(ctx.stepping.going),
    }),
  ),
];

const steepness: RuleEvaluator = (ctx) => [
  checkValue(ctx, ctx.stepping.rise / ctx.stepping.going, msg("rules.CONFORT_CLASSE.label")),
];

/** Angle de pente α = atan(h / g), en degrés. */
const slopeAngle: RuleEvaluator = (ctx) => [
  checkValue(
    ctx,
    (Math.atan2(ctx.stepping.rise, ctx.stepping.going) * 180) / Math.PI,
    msg("rules.ANGLE_ECHELLE_MARCHES.label"),
  ),
];

// ------------------------------------------------------------------ Emmarchement et largeurs

function width(ctx: EvaluatorContext): number {
  return ctx.project.stair.layout.width;
}

const stairWidth: RuleEvaluator = (ctx) => [
  checkValue(ctx, width(ctx), msg("compliance.stair.width")),
];

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

function passageLabel(p: { deducted: number; limit: number }): Message {
  return msg(
    p.deducted > 0 ? "compliance.stair.passageAtHandrails" : "compliance.stair.passageNoHandrail",
    { limit: dec(p.limit, 0) },
  );
}

/**
 * Largeur de passage (logement) : emmarchement diminué des mains courantes saillantes de plus
 * de 100 mm quand les garde-corps sont décrits ; sinon emmarchement, sous réserve.
 */
const passageWidthLogement: RuleEvaluator = (ctx) => {
  const p = passageWidth(ctx);
  if (p) return [checkValue(ctx, p.width, passageLabel(p), { location: p.location })];
  const f = checkValue(ctx, width(ctx), msg("rules.LARGEUR_MIN_LOGEMENT.onWidth"));
  return [
    f.status === "ok"
      ? {
          ...f,
          message: msg("rules.LARGEUR_MIN_LOGEMENT.reservation", {
            message: f.message,
            limit: dec(ruleParam(ctx.rule, "saillie_mc_max"), 0),
          }),
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
      message: msg("rules.LARGEUR_UP_ERP.units", { message: f.message, count: n }),
    },
  ];
};

/**
 * MC_INTERMEDIAIRE_ERP : au-delà de 4 UP (`max`), mains courantes intermédiaires (CO 55 §1), que
 * Blondel ne modélise pas. Nombre d'UP de la largeur de passage (garde-corps décrits) ou de
 * l'emmarchement (majorant) sinon. Seuil déclencheur : une cage est jugée sur son tronçon le
 * plus large (`widestWidth`, même déduction des mains courantes), ADR-0010 sous-lot 2d.
 */
const intermediateHandrails: RuleEvaluator = (ctx) => {
  const max = ctx.rule.max;
  if (max === null) return [notEvaluated(msg("rules.MC_INTERMEDIAIRE_ERP.noMax"))];
  const p = passageWidth({ ...ctx, rule: getRule("LARGEUR_UP_ERP") });
  const w = (p ? p.width : width(ctx)) + (widestWidth(ctx) - width(ctx));
  const n = upCount(w);
  const base = { measured: n, min: null, max, location: p?.location ?? STAIR } as const;
  const params = { count: n, width: dec(w, 0), max: String(max) };
  if (n <= max)
    return [
      {
        ...base,
        status: "ok",
        message: msg(
          p ? "rules.MC_INTERMEDIAIRE_ERP.okPassage" : "rules.MC_INTERMEDIAIRE_ERP.okWidth",
          params,
        ),
      },
    ];
  if (!p)
    return [
      {
        ...base,
        status: "non-evaluee",
        message: msg("rules.MC_INTERMEDIAIRE_ERP.probable", params),
      },
    ];
  return [
    {
      ...base,
      status: "violation",
      message: msg("rules.MC_INTERMEDIAIRE_ERP.violation", params),
    },
  ];
};

/**
 * Largeurs entre mains courantes ou en unités de passage : l'emmarchement en est un majorant.
 * E < min ⇒ violation certaine ; sinon la vérification attend les mains courantes (garde-corps).
 */
const upperBoundedByWidth: RuleEvaluator = (ctx) => {
  const f = checkValue(ctx, width(ctx), msg("compliance.stair.upperBound"));
  if (f.status === "violation") return [f];
  return [
    {
      ...notEvaluated(msg("compliance.stair.upperBoundPending", { width: dec(width(ctx)) })),
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
    checkValue(ctx, w.width, msg("compliance.stair.betweenHandrails"), {
      location: w.location,
    }),
  ];
};

// ------------------------------------------------------------------ Ligne de foulée / de mesure

/**
 * Groupe de marches contrôlé par une même ligne de mesure : tout l'escalier (tracé à volées,
 * hélicoïdal, cage d'une seule distance), ou une jonction tournante de cage (ADR-0010) avec sa
 * distance d_f de Γ au jour et son emmarchement E (`cageWalklineGroups`).
 */
interface WalklineGroup {
  /** Distance d_f de la ligne de conception au jour pour ce groupe. */
  readonly offset: number;
  /** Marches balancées du groupe ; absent : toutes. */
  readonly include?: (t: Tread) => boolean;
  /**
   * Distances pour la mesure (cage) : distance réglementaire et distance d_f de la jonction du
   * groupe.
   */
  readonly target?: (s: number) => { readonly d: number; readonly offset: number };
}

/**
 * Compare la ligne de conception à la ligne de mesure réglementaire (SPEC X9 : la ligne de
 * conception est libre ; les contrôles portent sur la ligne de mesure).
 * - confondues : ok ;
 * - distinctes sans marche balancée : ok (les girons droits sont identiques sur toute ligne) ;
 * - distinctes avec marches balancées : girons balancés mesurés sur la ligne de mesure.
 */
function walklineAt(
  ctx: EvaluatorContext,
  expected: number,
  label: Message,
  group: WalklineGroup = { offset: ctx.layout.walklineOffset },
): Finding[] {
  const d = group.offset;
  const base = { measured: d, min: expected, max: expected, location: STAIR } as const;
  if (Math.abs(d - expected) <= NUMERIC_EPS) {
    return [
      {
        ...base,
        status: "ok",
        message: msg("compliance.walkline.at", { distance: dec(d), label }),
      },
    ];
  }
  const winders = treadsOfKind(ctx.stepping, "winder").filter(
    (t) => !group.include || group.include(t),
  );
  if (winders.length === 0) {
    // Sans incidence : la ligne de conception n'est pas soumise à la borne ; ni mesure ni
    // bornes (sinon « mesuré 650 mm, attendu 600 mm » sur une ligne conforme).
    return [
      {
        status: "ok",
        min: null,
        max: null,
        location: STAIR,
        message: msg("compliance.walkline.noWinder", {
          distance: dec(d),
          expected: dec(expected),
          label,
        }),
      },
    ];
  }
  return measurementLineFindings(ctx, expected, label, group);
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
  label: Message,
  group: WalklineGroup,
): Finding[] {
  const d = group.offset;
  const head = msg("compliance.walkline.head", {
    distance: dec(d),
    expected: dec(expected),
    label,
  });
  const res = goingsOnMeasurementLine(ctx.layout, ctx.stepping, expected, {
    ...(group.include ? { include: group.include } : {}),
    ...(group.target ? { target: group.target } : {}),
  });
  if (!res.ok)
    return [
      {
        ...notEvaluated(msg("compliance.walkline.notMeasured", { head, reason: res.reason })),
        measured: d,
        min: expected,
        max: expected,
      },
    ];
  // Règles de giron applicables, avec leur sévérité effective (profil, surcharges de
  // l'utilisateur) : une règle ignorée par l'utilisateur n'est pas reportée sur cette ligne.
  const rules: { rule: RuleDef; severity: Severity; reason?: Message }[] = [];
  const ignored: string[] = [];
  for (const id of ctx.rule.regles_mesurees ?? []) {
    const r = findRule(id);
    if (!r) throw new MessageError(msg("compliance.walkline.unknownMeasuredRule", { ruleId: id }));
    if (!MEASURED_QUANTITY[id])
      throw new MessageError(msg("compliance.walkline.unknownMeasuredQuantity", { ruleId: id }));
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
  const ignoredParam = { ignored: ignored.join(", ") };
  const goings = res.goings.map((g) => g.going);
  const lo = Math.min(...goings);
  const hi = Math.max(...goings);
  const range = msg("compliance.walkline.range", { lo: dec(lo), hi: dec(hi) });
  if (rules.length === 0)
    return [
      {
        status: "ok",
        measured: lo,
        min: null,
        max: null,
        location: STAIR,
        message: msg(
          ignored.length > 0 ? "compliance.walkline.noRuleIgnored" : "compliance.walkline.noRule",
          { head, range, ...ignoredParam },
        ),
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
        ? msg("compliance.walkline.expectedDeviation", {
            nominal: dec(nominal),
            min: dec(r.min ?? -Infinity),
            max: dec(r.max ?? Infinity),
          })
        : msg("compliance.walkline.expectedGoing", { min: dec(r.min ?? 0) });
      out.push({
        status: "violation",
        measured: v,
        min: r.min,
        max: r.max,
        location: treadLocation(tread),
        message: msg("compliance.walkline.violation", {
          head,
          tread: tread.number,
          going: dec(going),
          ruleId: r.id,
          expected: expectedText,
        }),
        ...(weaker
          ? {
              severity,
              severityReason: reason
                ? msg("compliance.walkline.severityReasonWith", { ruleId: r.id, reason })
                : msg("compliance.walkline.severityReason", { ruleId: r.id }),
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
      message: msg(
        ignored.length > 0 ? "compliance.walkline.conformIgnored" : "compliance.walkline.conform",
        { head, range, rules: rules.map((r) => r.rule.id).join(", "), ...ignoredParam },
      ),
    },
  ];
}

/** Milieu si E ≤ seuil, 600 mm (valeur `min` de la règle large) sinon. */
function dtuWalkline(branch: "narrow" | "wide" | "both"): RuleEvaluator {
  return (ctx) => {
    // Seuil de la règle évaluée (`parametres.E_seuil`), à défaut celui des règles DTU.
    const threshold = ctx.rule.parametres?.["E_seuil"] ?? LF_WIDE_THRESHOLD.value;
    /** Distance attendue pour un emmarchement `e` ; `undefined` : sans objet pour la branche. */
    const expectedFor = (e: number): number | null | undefined => {
      const narrow = e <= threshold;
      if ((branch === "narrow" && !narrow) || (branch === "wide" && narrow)) return undefined;
      if (narrow) return e / 2;
      return branch === "wide" ? ctx.rule.min : wideDistance(ctx);
    };
    const labelFor = (e: number): Message => {
      const params = { width: dec(e), threshold: String(threshold) };
      return e <= threshold
        ? msg("compliance.walkline.labelMiddle", params)
        : msg("compliance.walkline.labelWide", params);
    };
    const notApplicableFor = (e: number): Finding => {
      const params = { width: dec(e), threshold: String(threshold) };
      return notApplicable(
        msg(
          e <= threshold
            ? "compliance.walkline.narrowNotApplicable"
            : "compliance.walkline.wideNotApplicable",
          params,
        ),
      );
    };
    const groups = cageWalklineGroups(ctx);
    if (groups === null) {
      const e = width(ctx);
      const d = expectedFor(e);
      if (d === undefined) return [notApplicableFor(e)];
      if (d === null) return [notEvaluated(msg("compliance.walkline.noDistance"))];
      return walklineAt(ctx, d, labelFor(e));
    }
    return perJunction(
      ctx,
      groups,
      (g) => {
        const d = expectedFor(g.width);
        if (d === undefined) return null;
        if (d === null) return { expected: null, label: labelFor(g.width) };
        return { expected: d, label: labelFor(g.width) };
      },
      notApplicableFor(Math.min(...groups.map((g) => g.width))),
    );
  };
}

/** Jonction tournante d'une cage et ses distances (voir `cageWalklineGroups`). */
interface JunctionGroup {
  /** Numéro de la jonction (1 …). */
  readonly junction: number;
  /** Distance d_f de Γ au jour à la jonction. */
  readonly offset: number;
  /** Emmarchement E à la jonction. */
  readonly width: number;
  readonly sStart: number;
  readonly sEnd: number;
}

/** Groupe de la jonction la plus proche de l'abscisse s (premier à égalité, comme `collarSideAt`). */
function nearestGroup(groups: readonly JunctionGroup[], s: number): JunctionGroup {
  let best = groups[0]!;
  let bestD = Infinity;
  for (const g of groups) {
    const d = Math.max(0, g.sStart - s, s - g.sEnd);
    if (d < bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

/**
 * Cage (ADR-0010, décisions F1, F2) dont les jonctions tournantes n'ont pas toutes la distance
 * d_f ni l'emmarchement E de l'escalier : un groupe par jonction tournante (angle ≠ 0), avec d_f
 * de la jonction (`TurnZone.walklineOffset`) et E = plus petite largeur en présence à la
 * jonction (`junctionWidth`, celle sur laquelle le tracé calcule d_f) ; chaque marche balancée
 * relève de la jonction la plus proche. `null` : contrôle unique de l'escalier (tracé à volées,
 * hélicoïdal, cage sans jonction tournante ou d'une seule distance et d'un seul emmarchement),
 * inchangé.
 */
function cageWalklineGroups(ctx: EvaluatorContext): JunctionGroup[] | null {
  if (ctx.project.stair.layout.kind !== "cage") return null;
  const turning = ctx.layout.turns.filter((t) => t.angle !== undefined && t.angle !== 0);
  if (turning.length === 0) return null;
  const groups = turning.map((t) => ({
    junction: t.index + 1,
    offset: t.walklineOffset ?? ctx.layout.walklineOffset,
    width: junctionWidth(ctx, t),
    sStart: t.sStart,
    sEnd: t.sEnd,
  }));
  const uniform = groups.every(
    (g) =>
      Math.abs(g.offset - ctx.layout.walklineOffset) <= NUMERIC_EPS &&
      Math.abs(g.width - width(ctx)) <= NUMERIC_EPS,
  );
  return uniform ? null : groups;
}

/**
 * Constats par jonction tournante d'une cage (`cageWalklineGroups`), chacun préfixé du numéro de
 * la jonction. `expect` rend la distance attendue et son libellé pour une jonction (`null` : sans
 * objet pour la règle, `expected: null` : distance absente de la table) ; marches balancées de
 * la jonction mesurées sur la ligne à la distance attendue de chaque jonction. Toutes les
 * jonctions sans objet : `none`.
 */
function perJunction(
  ctx: EvaluatorContext,
  groups: readonly JunctionGroup[],
  expect: (g: JunctionGroup) => { expected: number | null; label: Message } | null,
  none: Finding,
): Finding[] {
  const out: Finding[] = [];
  for (const g of groups) {
    const e = expect(g);
    if (e === null) continue;
    const expected = e.expected;
    const findings: Finding[] =
      expected === null
        ? [notEvaluated(msg("compliance.walkline.noDistance"))]
        : walklineAt(ctx, expected, e.label, {
            offset: g.offset,
            // Marches balancées dont la jonction la plus proche est `g` ; mesurées à la
            // distance attendue de `g`, la ligne de mesure décalant Γ de d − d_f(g).
            include: (t) => {
              const a = ctx.stepping.nosings[t.number - 1];
              const b = ctx.stepping.nosings[t.number];
              return !!a && !!b && nearestGroup(groups, (a.s + b.s) / 2) === g;
            },
            target: () => ({ d: expected, offset: g.offset }),
          });
    for (const f of findings)
      out.push({
        ...f,
        message: msg("compliance.walkline.atJunction", {
          junction: g.junction,
          message: f.message,
        }),
      });
  }
  return out.length > 0 ? out : [none];
}

/** Distance pour E large quand la règle elle-même n'a pas de `min` : celle de LF_POSITION_DTU_LARGE. */
function wideDistance(ctx: EvaluatorContext): number | null {
  return ctx.rule.min ?? getRule("LF_POSITION_DTU_LARGE").min;
}

/** d_lf = min (= max) de la règle. */
const fixedWalkline: RuleEvaluator = (ctx) => {
  const d = ctx.rule.min ?? ctx.rule.max;
  if (d === null) return [notEvaluated(msg("compliance.walkline.noDistance"))];
  const label = msg("compliance.walkline.labelRegulatory");
  const groups = cageWalklineGroups(ctx);
  if (groups === null) return walklineAt(ctx, d, label);
  // Cage : même distance réglementaire à chaque jonction, d_f propre à chacune.
  return perJunction(ctx, groups, () => ({ expected: d, label }), notApplicable(label));
};

// ------------------------------------------------------------------ Échappée

const headroom: RuleEvaluator = (ctx) => {
  if (!ctx.headroom) {
    if (!ctx.project.site.opening) return [notApplicable(msg("compliance.headroom.noOpening"))];
    if (ctx.headroomClear) {
      return [
        {
          status: "ok",
          message: msg("compliance.headroom.clear"),
        },
      ];
    }
    return [notEvaluated(msg("compliance.headroom.notComputed"))];
  }
  return [
    checkValue(ctx, ctx.headroom.min, msg("compliance.headroom.quantity"), {
      location:
        ctx.headroom.nosingIndex === undefined
          ? { kind: "point", at: ctx.headroom.at }
          : { kind: "point", at: ctx.headroom.at, nosingIndex: ctx.headroom.nosingIndex },
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
  if (threshold === null) return [notApplicable(msg("compliance.headroom.noBlockingRule"))];
  if (ctx.incomplete) return [notEvaluated(msg("rules.ECHAPPEE_LARGEUR.partial"))];
  const w = ctx.headroomWidth;
  if (!w) {
    if (!ctx.project.site.opening) return [notApplicable(msg("compliance.headroom.noOpening"))];
    if (!ctx.headroomWidthClear) return [notEvaluated(msg("rules.ECHAPPEE_LARGEUR.notComputed"))];
    return [
      {
        status: "ok",
        min: threshold.min,
        message: msg("rules.ECHAPPEE_LARGEUR.unlimited"),
      },
    ];
  }
  // Le nez k porte le dessus de la marche k + 1 ; le dernier est le nez d'arrivée.
  const label =
    w.nosing === ctx.stepping.nosings.length - 1
      ? msg("rules.ECHAPPEE_LARGEUR.atArrival", { ruleId: threshold.ruleId })
      : msg("rules.ECHAPPEE_LARGEUR.atNosing", {
          tread: w.nosing + 1,
          ruleId: threshold.ruleId,
        });
  return [
    checkValue(ctx, w.min, label, {
      bounds: { min: threshold.min, max: null },
      location: { kind: "point", at: w.at },
    }),
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
  if (!poly) return [notApplicable(msg("compliance.headroom.noOpening"))];
  const threshold = headroomWidthThreshold(ctx.contexts);
  if (threshold === null) return [notApplicable(msg("compliance.headroom.noBlockingRule"))];
  const nosings = ctx.stepping.nosings;
  if (ctx.incomplete || nosings.length < 2)
    return [notEvaluated(msg("rules.TREMIE_LONGUEUR.partial"))];
  if (ctx.layout.helical) return [notEvaluated(msg("rules.TREMIE_LONGUEUR.helical"))];
  const ep = ctx.project.site.upperSlabThickness;
  const { rise: h, going: g } = ctx.stepping;
  const required = ((threshold.min + ep) * g) / h;
  const arrival = nosings[nosings.length - 1]!;
  const sA = arrival.s;
  if (pointInPolygon(arrival.p, poly) === "outside")
    return [notApplicable(msg("rules.TREMIE_LONGUEUR.arrivalOutside"))];
  // Dernier passage sous la dalle avant l'arrivée : la trémie s'étend de sa sortie à l'arrivée.
  const covered = coveredIntervals(ctx.layout.walkline, poly).filter(
    (c) => c.s1 <= sA + NUMERIC_EPS,
  );
  const edge = covered.length > 0 ? covered[covered.length - 1]!.s1 : 0;
  const length = sA - edge;
  const from = Math.max(0, sA - Math.max(required, length));
  // Tournant, palier droit, transition de Γ ou axe en arc d'une cage (ADR-0010) avant
  // l'arrivée : la dérivation suppose une volée droite à pente constante. Un palier droit
  // (zone d'angle 0) garde Γ droite mais interrompt la pente : message propre.
  const overlaps = (t: { sStart: number; sEnd: number }): boolean =>
    t.sEnd > from + NUMERIC_EPS && t.sStart < sA - NUMERIC_EPS;
  const zones = ctx.layout.turns.filter(overlaps);
  const curved =
    zones.some((t) => t.angle !== 0) ||
    (ctx.layout.walklineTransitions ?? []).some(overlaps) ||
    (ctx.layout.sections ?? []).some((sec) => sec.kind === "arc" && overlaps(sec));
  const shown = { length: dec(Math.max(required, length), 0) };
  if (curved) return [notEvaluated(msg("rules.TREMIE_LONGUEUR.turn", shown))];
  if (zones.length > 0) return [notEvaluated(msg("rules.TREMIE_LONGUEUR.landing", shown))];
  const p = curvePointAt(ctx.layout.walkline, edge);
  return [
    checkValue(
      ctx,
      length,
      msg("rules.TREMIE_LONGUEUR.quantity", {
        headroom: dec(threshold.min, 0),
        ruleId: threshold.ruleId,
        slab: dec(ep, 0),
        going: dec(g),
        rise: dec(h),
      }),
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
