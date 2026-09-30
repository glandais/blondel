/**
 * Contrôles produits par les plugins de structure (`StructureOutput.checks`).
 *
 * Deux sortes de règles :
 * - règles de `rules.yaml` (ex. LIMON_EPAISSEUR_MIN_DTU, LIMON_ENTAILLE_MIN,
 *   CREMAILLERE_REGLE_MOYENS) : seuils et domaines lus dans la table (`min` / `max`,
 *   `parametres`, `tables`), contextes
 *   et sévérité effective (profil, surcharges) appliqués comme dans le moteur ; le pipeline
 *   remplace le résultat « sans évaluateur » du moteur par celui du plugin ;
 * - contrôles de fabrication propres au plugin (préfixe `FAB_`, ou règle sourcée absente de
 *   rules.yaml) : définis ici avec leur source et leur confiance, seuils lus dans le profil
 *   d'atelier ou les paramètres du plugin (valeurs « à valider »).
 */
import type { RuleResult, Severity } from "../model/derived.js";
import type { Project } from "../model/project.js";
import type { Layout, Stepping } from "../model/derived.js";
import { STAIR, boundsText, fmt, within, type Bounds } from "../rules/check.js";
import { isRuleApplicable, resolveContexts } from "../rules/contexts.js";
import { effectiveSeverity } from "../rules/engine.js";
import { findRule, ruleParam, type RuleDef } from "../rules/table.js";
import type { Finding } from "../rules/types.js";

/** Définition d'un contrôle de plugin hors rules.yaml. */
export interface PluginRuleSpec {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly confidence: RuleDef["confiance"];
  readonly nature: RuleDef["nature"];
  readonly severity: Severity;
  readonly unit: string | null;
}

/** RuleDef équivalente (contexte `tous`, seuils portés par chaque constat). */
export function pluginRuleDef(spec: PluginRuleSpec): RuleDef {
  return {
    id: spec.id,
    description: spec.description,
    formule: "",
    min: null,
    max: null,
    recommande: null,
    unite: spec.unit,
    contexte: ["tous"],
    nature: spec.nature,
    source: spec.source,
    source_secondaire: false,
    confiance: spec.confidence,
    severite: spec.severity,
  };
}

/** Conversion d'un constat en résultat (même logique que le moteur, `rules/engine.ts`). */
export function toRuleResult(rule: RuleDef, f: Finding, project: Project): RuleResult {
  const eff = effectiveSeverity(rule, project.compliance);
  const base: RuleResult = {
    ruleId: rule.id,
    description: rule.description,
    status: eff.ignored && f.status !== "non-evaluee" ? "non-evaluee" : f.status,
    severity: eff.severity,
    declaredSeverity: rule.severite,
    min: f.min !== undefined ? f.min : rule.min,
    max: f.max !== undefined ? f.max : rule.max,
    location: f.location ?? STAIR,
    nature: rule.nature,
    confidence: rule.confiance,
    source: rule.source,
    secondarySource: rule.source_secondaire,
    message: f.message,
  };
  return {
    ...base,
    ...(f.measured !== undefined ? { measured: f.measured } : {}),
    ...(rule.unite !== null ? { unit: rule.unite } : {}),
    ...(eff.downgradeReason !== undefined ? { downgradeReason: eff.downgradeReason } : {}),
    ...(f.justification !== undefined ? { justification: f.justification } : {}),
  };
}

/** Collecteur de contrôles d'un plugin. */
export class CheckCollector {
  readonly results: RuleResult[] = [];
  private readonly active: ReadonlySet<string>;

  constructor(
    private readonly project: Project,
    stepping: Stepping,
  ) {
    // Mêmes contextes que le moteur (`evaluateComplianceDetailed`), y compris `helicoidal_fut`
    // déduit du bord intérieur du tracé hélicoïdal (QUESTIONS A5).
    const lay = project.stair.layout;
    const core = lay.kind === "helical" ? lay.core.kind : undefined;
    this.active = new Set(
      resolveContexts(project.compliance, stepping, core, project.stair.structure.kind).active,
    );
  }

  /** Contextes actifs du projet (évaluateurs de rules.yaml réappliqués par un plugin). */
  get activeContexts(): ReadonlySet<string> {
    return this.active;
  }

  /** Règle de rules.yaml : `null` si inconnue ou si ses contextes ne sont pas actifs. */
  yamlRule(id: string): RuleDef | null {
    const rule = findRule(id);
    if (!rule || !isRuleApplicable(rule, this.active)) return null;
    return rule;
  }

  add(rule: RuleDef, findings: readonly Finding[]): void {
    for (const f of findings) this.results.push(toRuleResult(rule, f, this.project));
  }

  /**
   * Contrôle d'une valeur mesurée par élément : un constat par élément non conforme, sinon un
   * constat `ok` portant l'élément le plus défavorable.
   */
  addItems(
    rule: RuleDef,
    items: readonly { value: number; label: string; partId?: string }[],
    quantity: string,
    bounds: Bounds,
  ): void {
    const unit = rule.unite;
    const u = unit ? ` ${unit}` : "";
    if (items.length === 0) {
      this.add(rule, [{ status: "ok", message: `Sans objet (${quantity}).` }]);
      return;
    }
    const nan = items.filter((it) => !Number.isFinite(it.value));
    const valid = items.filter((it) => Number.isFinite(it.value));
    const findings: Finding[] = nan.map((it) => ({
      status: "non-evaluee" as const,
      location: it.partId ? { kind: "part" as const, partId: it.partId } : STAIR,
      message: `${quantity}, ${it.label} : valeur non calculable.`,
    }));
    const bad = valid.filter((it) => !within(it.value, bounds));
    for (const it of bad) {
      findings.push({
        status: "violation",
        measured: it.value,
        min: bounds.min,
        max: bounds.max,
        location: it.partId ? { kind: "part", partId: it.partId } : STAIR,
        message: `${quantity}, ${it.label} : ${fmt(it.value, 1)}${u} (attendu ${boundsText(bounds, unit)}).`,
      });
    }
    if (bad.length === 0 && valid.length > 0) {
      let worst = valid[0]!;
      let margin = Infinity;
      for (const it of valid) {
        const m = Math.min(
          bounds.min !== null ? it.value - bounds.min : Infinity,
          bounds.max !== null ? bounds.max - it.value : Infinity,
        );
        if (m < margin) {
          margin = m;
          worst = it;
        }
      }
      findings.push({
        status: "ok",
        measured: worst.value,
        min: bounds.min,
        max: bounds.max,
        message: `${quantity} conforme sur ${valid.length} élément(s) ; valeur la plus défavorable ${fmt(worst.value, 1)}${u} (${worst.label}), attendu ${boundsText(bounds, unit)}.`,
      });
    }
    this.add(rule, findings);
  }
}

/**
 * Domaine des règles de moyens des limons bois (LIMON_EPAISSEUR_MIN_DTU : escalier d'un étage au
 * plus, emmarchement ≤ `parametres.E_max`, C §1.4) : message « hors domaine » si l'emmarchement
 * le dépasse, `null` sinon.
 */
export function stringerRulesOutOfDomain(rule: RuleDef, width: number): string | null {
  const max = ruleParam(rule, "E_max");
  return width > max
    ? `Hors domaine des règles de moyens (emmarchement ${fmt(width, 0)} mm > ${fmt(max, 0)} mm)`
    : null;
}

// ------------------------------------------------------------------ Contrôles de fabrication

const WORKSHOP_SOURCE = "Profil d'atelier Blondel (valeur par défaut à valider, LEDGER §2)";

export const FAB_RULES = {
  perpendicularWidth: {
    id: "FAB_LIMON_LARGEUR_PERP_MIN",
    description: "Largeur du limon mesurée perpendiculairement à ses rives (CHALLENGE G6)",
    source: WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  woodBetweenHousings: {
    id: "FAB_LIMON_BOIS_ENTRE_MORTAISES",
    description: "Bois entre deux encastrements de marche successifs (CHALLENGE G6)",
    source: WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  cheek: {
    id: "FAB_LIMON_JOUE_MIN",
    description: "Joue : bois entre un encastrement et une rive du limon",
    source: WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  boardLength: {
    id: "FAB_PLATEAU_LONGUEUR_MAX",
    description: "Longueur de débit ≤ longueur maximale de plateau du profil d'atelier",
    source: WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  stockAvailable: {
    id: "FAB_DEBIT_DISPONIBLE",
    description:
      "Épaisseur et largeur de débit disponibles dans le profil d'atelier (surcote de corroyage comprise)",
    source: WORKSHOP_SOURCE,
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  newelReception: {
    id: "FAB_POTEAU_RECEPTION",
    description:
      "Le limon de jour s'arrête contre une face du poteau : épaisseur (largeur en plan) du limon ≤ débord du poteau côté jour au-delà de la face interne du limon (demi-côté pour un poteau centré sur l'intersection des faces internes, demi-côté + décalage pour un poteau décalé vers le jour)",
    source:
      "Géométrie du tracé (layout.ts et layout/newel.ts : poteau centré sur le coin intérieur K ou décalé vers le jour)",
    confidence: "eleve",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

/**
 * Plugin réservé aux escaliers **à volées** appelé sur un tracé hélicoïdal (`layout.helical`) :
 * message lisible (au lieu d'une erreur de géométrie trompeuse sur les volées vides), `null`
 * sur un tracé à volées.
 */
export function flightsOnlyError(kind: string, label: string, layout: Layout): string | null {
  if (!layout.helical) return null;
  return `Structure « ${kind} » (${label}) : réservée aux escaliers à volées ; le tracé est hélicoïdal — choisir la structure « helical-core ».`;
}
