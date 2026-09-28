/**
 * Résolution des contextes actifs et applicabilité des règles (ADR-0004, SPEC §3.1).
 *
 * - Contextes **cumulatifs** : toutes les règles des contextes actifs s'appliquent ; `tous` est implicite.
 * - Contextes **déduits** : `tournant` si le découpage contient des marches balancées ; régime
 *   garde-corps `garde_corps_1988` / `garde_corps_2024` déduit de `referenceDate` si l'utilisateur
 *   n'en a choisi aucun explicitement.
 * - Applicabilité : les contextes de forme (`tournant`, `helicoidal`) **qualifient** les contextes de
 *   destination/matériau d'une règle (voir `isRuleApplicable`).
 */
import type { Stepping } from "../model/derived.js";
import type { ComplianceSettings } from "../model/project.js";
import { RULE_CONTEXTS, type RuleDef } from "./table.js";

/** Contexte implicite, toujours actif. */
export const ALWAYS_CONTEXT = "tous";

/**
 * Contextes de **forme** de l'escalier. Dans une règle, ils qualifient les autres contextes :
 * `[erp_securite, tournant, helicoidal]` se lit « ERP **et** (tournant **ou** hélicoïdal) »,
 * `[helicoidal, bois_dtu]` « bois **et** hélicoïdal ». Interprétation Blondel (voir LEDGER) : la
 * lecture purement disjonctive imposerait la ligne de foulée hélicoïdale à 600 mm à tout escalier bois.
 */
export const SHAPE_CONTEXTS: ReadonlySet<string> = new Set(["tournant", "helicoidal"]);

export type GuardRailRegime = "garde_corps_1988" | "garde_corps_2024";

/**
 * Date d'entrée en vigueur de la NF P01-012:2024 pour les travaux soumis à autorisation
 * d'urbanisme (PC ou DP déposé à partir du 1er juin 2025) [A-regles §3.2, SPEC §2.5].
 * Les marchés ont une autre date (1er janvier 2026) : non distinguée ici (point en suspens).
 */
const GUARD_RAIL_2024_FROM_UTC = Date.UTC(2025, 5, 1);

export interface GuardRailResolution {
  readonly regime: GuardRailRegime;
  /** Vrai si le régime a été supposé (date absente ou illisible). */
  readonly assumed: boolean;
  readonly note?: string;
}

/** Régime garde-corps déduit de la date de référence du projet (ISO `AAAA-MM-JJ`). */
export function guardRailRegime(referenceDate?: string): GuardRailResolution {
  if (referenceDate === undefined || referenceDate.trim() === "") {
    return {
      regime: "garde_corps_2024",
      assumed: true,
      note: "Date de dépôt PC/DP ou de marché absente : régime garde-corps NF P01-012:2024 supposé.",
    };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(referenceDate.trim());
  const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
  // Date.UTC normalise les dates impossibles (2025-02-30 → 2 mars) : on vérifie l'aller-retour.
  const d = new Date(t);
  const valid =
    m !== null &&
    Number.isFinite(t) &&
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3]);
  if (!valid) {
    return {
      regime: "garde_corps_2024",
      assumed: true,
      note: `Date de référence illisible (« ${referenceDate} ») : régime garde-corps NF P01-012:2024 supposé.`,
    };
  }
  return { regime: t < GUARD_RAIL_2024_FROM_UTC ? "garde_corps_1988" : "garde_corps_2024", assumed: false };
}

export interface ResolvedContexts {
  /** Contextes actifs (utilisateur + implicites + déduits), triés. */
  readonly active: readonly string[];
  /** Contextes ajoutés automatiquement (déduits de la géométrie ou de la date). */
  readonly derived: readonly string[];
  /** Contextes demandés mais inconnus de la table (ignorés). */
  readonly unknown: readonly string[];
  readonly guardRail: GuardRailResolution;
  /** Remarques à afficher avec le rapport. */
  readonly notes: readonly string[];
}

/** Contextes actifs pour un projet et son découpage. */
export function resolveContexts(settings: ComplianceSettings, stepping?: Stepping): ResolvedContexts {
  const known = new Set(RULE_CONTEXTS);
  const active = new Set<string>([ALWAYS_CONTEXT]);
  const unknown: string[] = [];
  const derived: string[] = [];
  const notes: string[] = [];
  for (const c of settings.contexts) {
    if (known.has(c)) active.add(c);
    else unknown.push(c);
  }
  if (unknown.length > 0) notes.push(`Contextes inconnus ignorés : ${unknown.join(", ")}.`);

  if (stepping && stepping.treads.some((t) => t.kind === "winder") && !active.has("tournant")) {
    active.add("tournant");
    derived.push("tournant");
  }

  let guardRail: GuardRailResolution;
  const explicit = (["garde_corps_1988", "garde_corps_2024"] as const).filter((c) => active.has(c));
  if (explicit.length === 1) {
    guardRail = { regime: explicit[0]!, assumed: false };
  } else if (explicit.length === 2) {
    guardRail = { regime: "garde_corps_2024", assumed: false };
    notes.push("Les deux régimes garde-corps sont activés explicitement : les deux jeux de règles s'appliquent.");
  } else {
    guardRail = guardRailRegime(settings.referenceDate);
    active.add(guardRail.regime);
    derived.push(guardRail.regime);
  }
  if (guardRail.note) notes.push(guardRail.note);

  return { active: [...active].sort(), derived, unknown, guardRail, notes };
}

/**
 * Une règle s'applique si :
 * - elle porte `tous`, ou
 * - (aucun de ses contextes hors forme, ou au moins un actif) **et** (aucun contexte de forme,
 *   ou au moins un actif) — avec au moins un contexte effectivement actif.
 */
export function isRuleApplicable(rule: RuleDef, active: ReadonlySet<string> | readonly string[]): boolean {
  const set = active instanceof Set ? active : new Set(active as readonly string[]);
  if (rule.contexte.includes(ALWAYS_CONTEXT)) return true;
  const shape = rule.contexte.filter((c) => SHAPE_CONTEXTS.has(c));
  const other = rule.contexte.filter((c) => !SHAPE_CONTEXTS.has(c));
  const shapeOk = shape.length === 0 || shape.some((c) => set.has(c));
  const otherOk = other.length === 0 || other.some((c) => set.has(c));
  return shapeOk && otherOk;
}
