/**
 * Volées et paliers : nombre de marches et hauteur par volée, reculement, paliers.
 */
import {
  STAIR,
  checkItems,
  flightsOf,
  fmt,
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
      label: `volée ${f.number}`,
    })),
    "Nombre de hauteurs de marche par volée",
  );

/**
 * VOLEE_MAX_ERP porte sur les escaliers **droits** d'ERP (CO 55 §1). Pour un escalier tournant
 * d'ERP, la limite « ne s'applique pas telle quelle » (A-regles §2.1, CO 56 §1) : non évaluée.
 */
const risersPerFlightStraightErp: RuleEvaluator = (ctx) => {
  if (ctx.contexts.has("tournant") || ctx.contexts.has("helicoidal")) {
    return [
      notEvaluated(
        "Escalier tournant d'ERP : la limite de marches par volée (escaliers droits, CO 55) ne s'applique pas telle quelle (CO 56, balancement continu).",
      ),
    ];
  }
  return risersPerFlight(ctx);
};

const flightHeight: RuleEvaluator = (ctx) =>
  checkItems(
    ctx,
    flightsOf(ctx.stepping).map((f) => ({
      value: f.height,
      location: STAIR,
      label: `volée ${f.number}`,
    })),
    "Hauteur de volée",
  );

/** Reculement : donnée calculée, sans limite (règle informative). */
const run: RuleEvaluator = (ctx) => [
  Number.isNaN(ctx.stepping.run)
    ? notEvaluated("Reculement non calculable (NaN).")
    : {
        status: "ok",
        measured: ctx.stepping.run,
        location: STAIR,
        message: `Reculement sur la ligne de foulée : ${fmt(ctx.stepping.run)} mm.`,
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
        message: "Aucun palier intermédiaire.",
      },
    ];
  return landings.map((t) => ({
    status: "violation" as const,
    measured: landings.length,
    location: treadLocation(t),
    message: `Palier intermédiaire (marche ${t.number}) dans un escalier tournant d'ERP : balancement continu exigé.`,
  }));
};

/**
 * Dimension d'un palier : largeur minimale de sa surface de marche en plan (pour un palier d'angle
 * carré E × E, vaut E). Utilisée à la fois pour la longueur et la largeur de palier (hypothèse).
 */
function landingChecks(ctx: EvaluatorContext, min: (ctx: EvaluatorContext) => number, quantity: string): Finding[] {
  const landings = treadsOfKind(ctx.stepping, "landing");
  if (landings.length === 0) return [notApplicable("Sans objet : aucun palier intermédiaire.")];
  return checkItems(
    ctx,
    landings.map((t) => ({
      value: minWidth(t.walkingSurface),
      location: treadLocation(t),
      label: `palier ${t.number}`,
    })),
    quantity,
    { bounds: { min: min(ctx), max: null } },
  );
}

const e = (ctx: EvaluatorContext): number => ctx.project.stair.layout.width;

const landingAtLeastWidth: RuleEvaluator = (ctx) =>
  landingChecks(ctx, e, "Dimension minimale du palier (comparée à E)");

const landingIndustrial: RuleEvaluator = (ctx) =>
  landingChecks(ctx, (c) => Math.max(c.rule.min ?? 0, e(c)), "Dimension minimale du palier industriel");

/** Volées « non contrariées » : notion non définie pour les tournants à 90° du modèle. */
const landingNonContrarie: RuleEvaluator = (ctx) => {
  if (treadsOfKind(ctx.stepping, "landing").length === 0)
    return [notApplicable("Sans objet : aucun palier intermédiaire.")];
  return [
    notEvaluated("Paliers entre volées « non contrariées » : interprétation à préciser pour les tournants à 90°."),
  ];
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
