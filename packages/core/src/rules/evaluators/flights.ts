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
} from "../check.js";
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
 * carré E × E, vaut E). Utilisée à la fois pour la longueur et la largeur de palier (hypothèse).
 */
function landingChecks(
  ctx: EvaluatorContext,
  min: (ctx: EvaluatorContext) => number,
  quantity: Message,
): Finding[] {
  const landings = treadsOfKind(ctx.stepping, "landing");
  if (landings.length === 0) return [notApplicable(msg("compliance.landing.none"))];
  return checkItems(
    ctx,
    landings.map((t) => ({
      value: minWidth(t.walkingSurface),
      location: treadLocation(t),
      label: msg("compliance.item.landing", { n: t.number }),
    })),
    quantity,
    { bounds: { min: min(ctx), max: null } },
  );
}

const e = (ctx: EvaluatorContext): number => ctx.project.stair.layout.width;

const landingAtLeastWidth: RuleEvaluator = (ctx) =>
  landingChecks(ctx, e, msg("compliance.landing.atLeastWidth"));

const landingIndustrial: RuleEvaluator = (ctx) =>
  landingChecks(
    ctx,
    (c) => Math.max(c.rule.min ?? 0, e(c)),
    msg("rules.PALIER_INDUSTRIEL.quantity"),
  );

/** Volées « non contrariées » : notion non définie pour les tournants à 90° du modèle. */
const landingNonContrarie: RuleEvaluator = (ctx) => {
  if (treadsOfKind(ctx.stepping, "landing").length === 0)
    return [notApplicable(msg("compliance.landing.none"))];
  return [notEvaluated(msg("rules.PALIER_LONGUEUR_ERP_NON_CONTRARIE.notEvaluated"))];
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
