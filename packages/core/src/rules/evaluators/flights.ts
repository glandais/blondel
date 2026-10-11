/**
 * Volées et paliers : nombre de marches et hauteur par volée, reculement, paliers.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import {
  STAIR,
  checkItems,
  flightsOf,
  minWidth,
  notApplicable,
  notEvaluated,
  treadLocation,
  treadsOfKind,
  widthOver,
} from "../check.js";
import type { Tread } from "../../model/derived.js";
import type { EvaluatorContext, Finding, RuleEvaluator } from "../types.js";

const risersPerFlight: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    flightsOf(ctx.stepping).map((f) => ({
      value: f.riserCount,
      location: STAIR,
      label: msg("compliance.item.flight", { n: f.number }),
    })),
    msg("compliance.flights.risersPerFlight"),
  );

/**
 * VOLEE_MAX_ERP porte sur les escaliers **droits** d'ERP (CO 55 §1). Pour un escalier tournant
 * d'ERP, la limite « ne s'applique pas telle quelle » (A-regles §2.1, CO 56 §1) : non évaluée.
 */
const risersPerFlightStraightErp: RuleEvaluator = (ctx) => {
  if (ctx.contexts.has("tournant") || ctx.contexts.has("helicoidal")) {
    return [notEvaluated(msg("rules.VOLEE_MAX_ERP.turning"))];
  }
  return risersPerFlight(ctx);
};

const flightHeight: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    flightsOf(ctx.stepping).map((f) => ({
      value: f.height,
      location: STAIR,
      label: msg("compliance.item.flight", { n: f.number }),
    })),
    msg("rules.VOLEE_HAUTEUR_INDUSTRIEL.quantity"),
  );

/** Reculement : donnée calculée, sans limite (règle informative). */
const run: RuleEvaluator = (ctx) => [
  Number.isNaN(ctx.stepping.run)
    ? notEvaluated(msg("rules.RECULEMENT.nan"))
    : {
        status: "ok",
        measured: ctx.stepping.run,
        location: STAIR,
        message: msg("rules.RECULEMENT.value", { run: dec(ctx.stepping.run) }),
      },
];

/** ERP tournant : balancement continu, aucun palier intermédiaire. */
const continuousWinding: RuleEvaluator = (ctx) => {
  const landings = treadsOfKind(ctx.stepping, "landing");
  if (landings.length === 0)
    return [
      {
        status: "ok",
        measured: 0,
        location: STAIR,
        message: msg("rules.ERP_TOURNANT_BALANCEMENT_CONTINU.noLanding"),
      },
    ];
  return landings.map((t) => ({
    status: "violation" as const,
    measured: landings.length,
    location: treadLocation(t),
    message: msg("rules.ERP_TOURNANT_BALANCEMENT_CONTINU.landing", { tread: t.number }),
  }));
};

/**
 * Dimension d'un palier : largeur minimale de sa surface de marche en plan (pour un palier d'angle
 * carré E × E, vaut E ; pour un palier droit de cage, la plus petite de sa profondeur et de sa
 * largeur). Utilisée à la fois pour la longueur et la largeur de palier (hypothèse). `min` :
 * borne du palier, fonction de l'emmarchement E au droit du palier (`widthOver` : tracé à
 * volées, E unique ; cage, plus petite des largeurs qui bordent le palier, décision F9,
 * QUESTIONS F14 (2)).
 */
function landingChecks(
  ctx: EvaluatorContext,
  min: (ctx: EvaluatorContext, e: number) => number,
  quantity: Message,
): Finding[] {
  const landings = treadsOfKind(ctx.stepping, "landing");
  if (landings.length === 0) return [notApplicable(msg("compliance.landing.none"))];
  const items = landings.map((t) => ({
    value: minWidth(t.walkingSurface),
    location: treadLocation(t),
    label: msg("compliance.item.landing", { n: t.number }),
    e: landingWidth(ctx, t),
  }));
  const bounds = [...new Set(items.map((it) => min(ctx, it.e)))];
  // Une seule borne (tracé à volées, cage à largeur unique) : contrôle groupé, inchangé.
  if (bounds.length <= 1)
    return checkItems(ctx, items, quantity, {
      bounds: { min: bounds[0] ?? min(ctx, e(ctx)), max: null },
    });
  // Cage aux largeurs différentes : borne propre à chaque palier. Constats des paliers non
  // conformes, sinon un seul constat (palier de plus petite marge), comme `checkItems`.
  const perLanding = items.map((it) => ({
    it,
    findings: checkItems(ctx, [it], quantity, { bounds: { min: min(ctx, it.e), max: null } }),
  }));
  const bad = perLanding.flatMap((p) => p.findings.filter((f) => f.status !== "ok"));
  if (bad.length > 0) return bad;
  const worst = perLanding.reduce((a, b) =>
    b.it.value - min(ctx, b.it.e) < a.it.value - min(ctx, a.it.e) ? b : a,
  );
  return worst.findings;
}

/** Emmarchement E au droit d'un palier (intervalle de Γ entre ses deux nez). */
function landingWidth(ctx: EvaluatorContext, t: Tread): number {
  const a = ctx.stepping.nosings[t.number - 1];
  const b = ctx.stepping.nosings[t.number];
  if (!a || !b) return e(ctx);
  return widthOver(ctx, a.s, b.s);
}

const e = (ctx: EvaluatorContext): number => ctx.project.stair.layout.width;

const landingAtLeastWidth: RuleEvaluator = (ctx) =>
  landingChecks(ctx, (_c, w) => w, msg("compliance.landing.atLeastWidth"));

const landingIndustrial: RuleEvaluator = (ctx) =>
  landingChecks(
    ctx,
    (c, w) => Math.max(c.rule.min ?? 0, w),
    msg("rules.PALIER_INDUSTRIEL.quantity"),
  );

/**
 * Volées « non contrariées » : notion non définie pour les tournants à 90° du modèle (non
 * évaluée). Palier droit d'une cage (zone d'angle 0, ADR-0010 sous-lot 2d, F9) : les deux
 * volées vont dans le même sens, la règle s'applique (profondeur saisie `depth`, à défaut
 * largeur d'arrivée du tronçon entrant, > `min`) ; s'il reste des paliers d'angle, leur
 * interprétation reste « non évaluée ».
 */
const landingNonContrarie: RuleEvaluator = (ctx) => {
  const landings = treadsOfKind(ctx.stepping, "landing");
  if (landings.length === 0) return [notApplicable(msg("compliance.landing.none"))];
  const pending = notEvaluated(msg("rules.PALIER_LONGUEUR_ERP_NON_CONTRARIE.notEvaluated"));
  const spec = ctx.project.stair.layout;
  if (spec.kind !== "cage") return [pending];
  const straight = ctx.layout.turns.filter((z) => z.mode === "landing" && z.angle === 0);
  if (straight.length === 0) return [pending];
  const items = straight.flatMap((z) => {
    const incoming = ctx.layout.sections?.find((sec) => sec.index === z.index);
    const depth = spec.junctions[z.index]?.depth ?? incoming?.widthEnd;
    // Palier du découpage : celui dont le nez avant est au début de la zone.
    const tread = landings.reduce((a, b) =>
      Math.abs((ctx.stepping.nosings[b.number - 1]?.s ?? Infinity) - z.sStart) <
      Math.abs((ctx.stepping.nosings[a.number - 1]?.s ?? Infinity) - z.sStart)
        ? b
        : a,
    );
    if (depth === undefined) return [];
    return [
      {
        value: depth,
        location: treadLocation(tread),
        label: msg("compliance.item.landing", { n: tread.number }),
      },
    ];
  });
  const findings = checkItems(ctx, items, msg("rules.PALIER_LONGUEUR_ERP_NON_CONTRARIE.quantity"), {
    bounds: { min: ctx.rule.min, max: null, strictMin: true },
  });
  const angled = ctx.layout.turns.some((z) => z.mode === "landing" && z.angle !== 0);
  return angled ? [...findings, pending] : findings;
};

export const FLIGHT_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  VOLEE_MAX_DTU: risersPerFlight,
  VOLEE_MAX_ERP: risersPerFlightStraightErp,
  VOLEE_HAUTEUR_INDUSTRIEL: flightHeight,
  RECULEMENT: run,
  ERP_TOURNANT_BALANCEMENT_CONTINU: continuousWinding,
  PALIER_LONGUEUR_METIER: landingAtLeastWidth,
  PALIER_LARGEUR_ERP: landingAtLeastWidth,
  PALIER_INDUSTRIEL: landingIndustrial,
  PALIER_LONGUEUR_ERP_NON_CONTRARIE: landingNonContrarie,
};
