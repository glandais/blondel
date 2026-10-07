/**
 * Résolution des contextes actifs et applicabilité des règles (ADR-0004, SPEC §3.1).
 *
 * - Contextes **cumulatifs** : toutes les règles des contextes actifs s'appliquent ; `tous` est implicite.
 * - Contextes **déduits** : `tournant` si le découpage contient des marches balancées,
 *   `helicoidal` si le découpage est celui d'un tracé hélicoïdal (`Stepping.helical`),
 *   `helicoidal_fut` si ce tracé est à fût central (projet : `layout.core.kind === "column"`) ;
 *   contextes de structure (`contextes_structure` de rules.yaml, ex. `limon_bois_encastre` pour
 *   `wood-housed`, QUESTIONS D2) si la structure choisie en porte ; régime
 *   garde-corps `garde_corps_1988` / `garde_corps_2024` déduit de `referenceDate` si l'utilisateur
 *   n'en a choisi aucun explicitement.
 * - Applicabilité : les contextes de forme (`tournant`, `helicoidal`) **qualifient** les contextes de
 *   destination/matériau d'une règle (voir `isRuleApplicable`).
 */
import { msg, textMessage, type Message, type MessageKey } from "@blondel/i18n";
import type { Stepping } from "../model/derived.js";
import type { ComplianceSettings } from "../model/project.js";
import { RULE_CONTEXTS, RULE_TABLE, type RuleDef } from "./table.js";

/** Contexte implicite, toujours actif. */
export const ALWAYS_CONTEXT = "tous";

/**
 * Clé du libellé de chaque contexte de rules.yaml (`contextes`, texte français de référence dans
 * la table). Liste explicite : un test vérifie qu'elle couvre exactement les contextes de la
 * table et que le français est celui de rules.yaml.
 */
export const CONTEXT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  bois_dtu: "compliance.context.bois_dtu",
  logement_interieur: "compliance.context.logement_interieur",
  bhc_parties_communes: "compliance.context.bhc_parties_communes",
  erp_neuf: "compliance.context.erp_neuf",
  erp_existant: "compliance.context.erp_existant",
  erp_securite: "compliance.context.erp_securite",
  exterieur: "compliance.context.exterieur",
  tournant: "compliance.context.tournant",
  helicoidal: "compliance.context.helicoidal",
  helicoidal_fut: "compliance.context.helicoidal_fut",
  gain_de_place: "compliance.context.gain_de_place",
  echelle_meunier: "compliance.context.echelle_meunier",
  industriel: "compliance.context.industriel",
  garde_corps_1988: "compliance.context.garde_corps_1988",
  garde_corps_2024: "compliance.context.garde_corps_2024",
  limon_bois_encastre: "compliance.context.limon_bois_encastre",
  limon_central_bois: "compliance.context.limon_central_bois",
  tous: "compliance.context.tous",
};

/**
 * Libellé d'un contexte (description de rules.yaml, traduite) ; un contexte inconnu des
 * dictionnaires est rendu par son identifiant.
 */
export function contextLabel(context: string): Message {
  const key = Object.hasOwn(CONTEXT_LABEL_KEYS, context) ? CONTEXT_LABEL_KEYS[context] : undefined;
  return key !== undefined ? msg(key) : textMessage(context);
}

/**
 * Clé du libellé **court** de chaque contexte (« Logement (intérieur) », « Bois (DTU 36.3) ») :
 * libellé unifié des cases du panneau Contexte, de la ligne des contextes de l'inspecteur et du
 * dossier PDF (spécification de contenu § 4, ADR-0009). La description longue
 * (`contextLabel`) reste l'aide sous la case. Liste explicite, couverte par un test.
 */
export const CONTEXT_SHORT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  bois_dtu: "compliance.contextShort.bois_dtu",
  logement_interieur: "compliance.contextShort.logement_interieur",
  bhc_parties_communes: "compliance.contextShort.bhc_parties_communes",
  erp_neuf: "compliance.contextShort.erp_neuf",
  erp_existant: "compliance.contextShort.erp_existant",
  erp_securite: "compliance.contextShort.erp_securite",
  exterieur: "compliance.contextShort.exterieur",
  tournant: "compliance.contextShort.tournant",
  helicoidal: "compliance.contextShort.helicoidal",
  helicoidal_fut: "compliance.contextShort.helicoidal_fut",
  gain_de_place: "compliance.contextShort.gain_de_place",
  echelle_meunier: "compliance.contextShort.echelle_meunier",
  industriel: "compliance.contextShort.industriel",
  garde_corps_1988: "compliance.contextShort.garde_corps_1988",
  garde_corps_2024: "compliance.contextShort.garde_corps_2024",
  limon_bois_encastre: "compliance.contextShort.limon_bois_encastre",
  limon_central_bois: "compliance.contextShort.limon_central_bois",
  tous: "compliance.contextShort.tous",
};

/**
 * Libellé court d'un contexte ; à défaut (contexte sans libellé court), sa description
 * (`contextLabel`), elle-même rendue par l'identifiant si le contexte est inconnu.
 */
export function contextShortLabel(context: string): Message {
  const key = Object.hasOwn(CONTEXT_SHORT_LABEL_KEYS, context)
    ? CONTEXT_SHORT_LABEL_KEYS[context]
    : undefined;
  return key !== undefined ? msg(key) : contextLabel(context);
}

/**
 * Contextes de **forme** de l'escalier (`contextes_forme` de rules.yaml). Dans une règle, ils
 * qualifient les autres contextes : `[erp_securite, tournant, helicoidal]` se lit « ERP **et**
 * (tournant **ou** hélicoïdal) », `[helicoidal, bois_dtu]` « bois **et** hélicoïdal ».
 * Interprétation Blondel (LEDGER l. 47, écrite en tête de rules.yaml et dans ADR-0004) : la
 * lecture purement disjonctive imposerait la ligne de foulée hélicoïdale à 600 mm à tout
 * escalier bois.
 */
export const SHAPE_CONTEXTS: ReadonlySet<string> = new Set(RULE_TABLE.contextes_forme);

/**
 * Contextes déduits de la structure choisie (`contextes_structure` de rules.yaml) : une règle
 * portée par une structure (ex. `LIMON_ENTAILLE_MIN` pour `wood-housed`) s'applique dès que la
 * structure est utilisée, quel que soit le contexte déclaré (QUESTIONS D2, 2026-09-30).
 */
export const STRUCTURE_CONTEXTS: Readonly<Record<string, readonly string[]>> =
  RULE_TABLE.contextes_structure;

/** Contextes de structure, jamais saisis : une déclaration à la main est ignorée. */
const STRUCTURE_ONLY_CONTEXTS: ReadonlySet<string> = new Set(
  Object.values(STRUCTURE_CONTEXTS).flat(),
);

/** Contexte déduit d'un hélicoïdal à fût central (QUESTIONS A5). */
export const HELICAL_COLUMN_CONTEXT = "helicoidal_fut";

/**
 * Contextes toujours déduits (jamais saisis) : l'interface ne les propose pas. `helicoidal` reste
 * saisissable (il peut être déclaré explicitement).
 */
export const DEDUCED_ONLY_CONTEXTS: ReadonlySet<string> = new Set([
  ALWAYS_CONTEXT,
  "tournant",
  HELICAL_COLUMN_CONTEXT,
  ...STRUCTURE_ONLY_CONTEXTS,
]);

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
  readonly note?: Message;
}

/** Régime garde-corps déduit de la date de référence du projet (ISO `AAAA-MM-JJ`). */
export function guardRailRegime(referenceDate?: string): GuardRailResolution {
  if (referenceDate === undefined || referenceDate.trim() === "") {
    return {
      regime: "garde_corps_2024",
      assumed: true,
      note: msg("compliance.contexts.noReferenceDate"),
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
      note: msg("compliance.contexts.unreadableReferenceDate", { date: referenceDate }),
    };
  }
  return {
    regime: t < GUARD_RAIL_2024_FROM_UTC ? "garde_corps_1988" : "garde_corps_2024",
    assumed: false,
  };
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
  readonly notes: readonly Message[];
}

/**
 * Contextes actifs pour un projet et son découpage. `helicalCore` : bord intérieur du tracé
 * hélicoïdal du projet (`stair.layout.core.kind`), pour déduire `helicoidal_fut` ;
 * `structureKind` : structure choisie (`stair.structure.kind`), pour les contextes de structure.
 */
export function resolveContexts(
  settings: ComplianceSettings,
  stepping?: Stepping,
  helicalCore?: "column" | "well",
  structureKind?: string,
): ResolvedContexts {
  const known = new Set(RULE_CONTEXTS);
  const active = new Set<string>([ALWAYS_CONTEXT]);
  const unknown: string[] = [];
  const derived: string[] = [];
  const notes: Message[] = [];
  const declaredDeduced: string[] = [];
  for (const c of settings.contexts) {
    // `helicoidal_fut` n'est jamais saisi : le déclarer écarterait G_COLLET_MIN d'un jour central
    // (QUESTIONS A5) ; seul le tracé le déduit. De même, les contextes de structure ne sont
    // déduits que de la structure choisie (QUESTIONS D2).
    if (c === HELICAL_COLUMN_CONTEXT || STRUCTURE_ONLY_CONTEXTS.has(c)) declaredDeduced.push(c);
    else if (known.has(c)) active.add(c);
    else unknown.push(c);
  }
  if (unknown.length > 0)
    notes.push(msg("compliance.contexts.unknown", { contexts: unknown.join(", ") }));
  if (declaredDeduced.length > 0)
    notes.push(
      msg("compliance.contexts.declaredDeduced", { contexts: declaredDeduced.join(", ") }),
    );

  if (stepping && stepping.treads.some((t) => t.kind === "winder") && !active.has("tournant")) {
    active.add("tournant");
    derived.push("tournant");
  }
  // Tracé hélicoïdal (marches rayonnantes, `Stepping.helical`) : contexte de forme `helicoidal`.
  if (stepping?.helical && known.has("helicoidal") && !active.has("helicoidal")) {
    active.add("helicoidal");
    derived.push("helicoidal");
  }
  // Hélicoïdal à fût central : écarte les règles qui l'excluent (G_COLLET_MIN, QUESTIONS A5).
  if (
    stepping?.helical &&
    helicalCore === "column" &&
    known.has(HELICAL_COLUMN_CONTEXT) &&
    !active.has(HELICAL_COLUMN_CONTEXT)
  ) {
    active.add(HELICAL_COLUMN_CONTEXT);
    derived.push(HELICAL_COLUMN_CONTEXT);
  }
  // Structure choisie : contextes qu'elle porte (ex. `limon_bois_encastre` pour `wood-housed`).
  if (structureKind !== undefined && Object.hasOwn(STRUCTURE_CONTEXTS, structureKind)) {
    for (const c of STRUCTURE_CONTEXTS[structureKind]!) {
      if (known.has(c) && !active.has(c)) {
        active.add(c);
        derived.push(c);
      }
    }
  }

  let guardRail: GuardRailResolution;
  const explicit = (["garde_corps_1988", "garde_corps_2024"] as const).filter((c) => active.has(c));
  if (explicit.length === 1) {
    guardRail = { regime: explicit[0]!, assumed: false };
  } else if (explicit.length === 2) {
    guardRail = { regime: "garde_corps_2024", assumed: false };
    notes.push(msg("compliance.contexts.bothGuardRegimes"));
  } else {
    guardRail = guardRailRegime(settings.referenceDate);
    active.add(guardRail.regime);
    derived.push(guardRail.regime);
  }
  if (guardRail.note) notes.push(guardRail.note);

  return { active: [...active].sort(), derived, unknown, guardRail, notes };
}

/**
 * Une règle s'applique si aucun de ses contextes exclus (`contexte_exclu`) n'est actif et si :
 * - elle porte `tous`, ou
 * - (aucun de ses contextes hors forme, ou au moins un actif) **et** (aucun contexte de forme,
 *   ou au moins un actif). Chaque groupe est une disjonction, les deux groupes une conjonction
 *   (sémantique écrite en tête de rules.yaml et dans ADR-0004).
 */
export function isRuleApplicable(
  rule: RuleDef,
  active: ReadonlySet<string> | readonly string[],
): boolean {
  const set = active instanceof Set ? active : new Set(active as readonly string[]);
  if (rule.contexte_exclu?.some((c) => set.has(c))) return false;
  if (rule.contexte.includes(ALWAYS_CONTEXT)) return true;
  const shape = rule.contexte.filter((c) => SHAPE_CONTEXTS.has(c));
  const other = rule.contexte.filter((c) => !SHAPE_CONTEXTS.has(c));
  const shapeOk = shape.length === 0 || shape.some((c) => set.has(c));
  const otherOk = other.length === 0 || other.some((c) => set.has(c));
  return shapeOk && otherOk;
}
