/**
 * Moteur de conformité (ADR-0004) : contextes → règles applicables → évaluateurs → sévérité
 * effective (profil, surcharges) → rapport.
 */
import type { ComplianceReport, RuleResult, Severity } from "../model/derived.js";
import type { ComplianceSettings } from "../model/project.js";
import { STAIR } from "./check.js";
import { isRuleApplicable, resolveContexts, type ResolvedContexts } from "./contexts.js";
import {
  DEFAULT_EVALUATORS,
  PARTIAL_MODEL_RULES,
  type EvaluatorRegistry,
} from "./evaluators/index.js";
import { RULES, RULES_VERSION, findRule, type RuleDef } from "./table.js";
import type { ComplianceInput, Finding } from "./types.js";

export interface EffectiveSeverity {
  readonly severity: Severity;
  /** Vrai si l'utilisateur a choisi d'ignorer la règle (justification obligatoire). */
  readonly ignored: boolean;
  readonly downgradeReason?: string;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  conseil: 0,
  avertissement: 1,
  bloquant: 2,
};

/**
 * Sévérité effective d'une règle :
 * 0. sévérité propre au constat (`Finding.severity`), si elle est plus faible que la sévérité
 *    déclarée (ex. GC_OBLIGATOIRE au droit d'un jour étroit, QUESTIONS A10) ;
 * 1. profil `souple` : `bloquant` + `source_secondaire` → `avertissement` ;
 * 2. surcharge utilisateur (dernière pour l'id), prise en compte seulement avec une justification non vide ;
 *    une surcharge qui assouplit la règle (plus faible que la sévérité déclarée) ne relève jamais
 *    un constat déjà plus faible qu'elle.
 */
export function effectiveSeverity(
  rule: RuleDef,
  settings: ComplianceSettings,
  finding?: Pick<Finding, "severity" | "severityReason">,
): EffectiveSeverity {
  let severity: Severity = rule.severite;
  const reasons: string[] = [];
  if (finding?.severity && SEVERITY_RANK[finding.severity] < SEVERITY_RANK[severity]) {
    severity = finding.severity;
    reasons.push(
      finding.severityReason ?? `Sévérité ramenée à « ${finding.severity} » pour ce constat.`,
    );
  }
  if (settings.profile === "souple" && rule.source_secondaire && severity === "bloquant") {
    severity = "avertissement";
    reasons.push("Profil souple : valeur issue d'une source secondaire (norme non lue).");
  }
  const override = [...settings.overrides]
    .reverse()
    .find((o) => o.ruleId === rule.id && o.justification.trim() !== "");
  let ignored = false;
  if (override) {
    if (override.severity === "ignore") {
      ignored = true;
      reasons.push(`Ignorée par l'utilisateur : ${override.justification.trim()}`);
    } else if (
      severity !== rule.severite &&
      SEVERITY_RANK[override.severity] < SEVERITY_RANK[rule.severite] &&
      SEVERITY_RANK[override.severity] >= SEVERITY_RANK[severity]
    ) {
      // Surcharge qui assouplit la règle : elle ne relève pas un constat déjà plus faible
      // (sévérité propre au constat ou profil souple).
    } else if (override.severity !== severity) {
      reasons.push(
        `Surcharge utilisateur (${severity} → ${override.severity}) : ${override.justification.trim()}`,
      );
      severity = override.severity;
    }
  }
  return reasons.length > 0
    ? { severity, ignored, downgradeReason: reasons.join(" ") }
    : { severity, ignored };
}

/** Note d'une surcharge portant sur un identifiant absent de rules.yaml. */
export function unknownOverrideNote(ruleId: string): string {
  return `Surcharge ignorée : règle inconnue « ${ruleId} ».`;
}

function toResult(rule: RuleDef, f: Finding, eff: EffectiveSeverity): RuleResult {
  const base: RuleResult = {
    ruleId: rule.id,
    description: rule.description,
    // Une règle ignorée garde sa mesure mais sort des violations (traçabilité conservée).
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

export interface ComplianceEvaluation {
  readonly report: ComplianceReport;
  readonly contexts: ResolvedContexts;
  /** Remarques (contextes déduits ou inconnus, régime supposé, version de règles…). */
  readonly notes: readonly string[];
}

/** Règle évaluable sur un modèle partiel (voir `ComplianceInput.incomplete`). */
function evaluableOnPartialModel(ruleId: string, input: ComplianceInput): boolean {
  if (PARTIAL_MODEL_RULES.project.has(ruleId)) return true;
  return PARTIAL_MODEL_RULES.rises.has(ruleId) && input.stepping.rises.length > 0;
}

/** Évaluation complète avec le détail de la résolution des contextes. */
export function evaluateComplianceDetailed(
  input: ComplianceInput,
  evaluators: EvaluatorRegistry = DEFAULT_EVALUATORS,
): ComplianceEvaluation {
  const settings = input.project.compliance;
  const resolved = resolveContexts(settings, input.stepping, input.layout.helical?.core);
  const active = new Set(resolved.active);
  const notes = [...resolved.notes];
  if (resolved.derived.length > 0)
    notes.push(`Contextes déduits : ${resolved.derived.join(", ")}.`);
  if (input.project.rulesVersion !== RULES_VERSION) {
    notes.push(
      `Le projet référence le jeu de règles v${input.project.rulesVersion} ; rapport établi avec la v${RULES_VERSION}.`,
    );
  }

  if (input.incomplete) {
    notes.push(
      `Modèle partiel (${input.incomplete === "layout" ? "tracé" : "découpage"} non calculé) : seules les règles portant sur le projet ou les hauteurs sont évaluées ; les contextes déduits du découpage (ex. tournant) ne sont pas connus.`,
    );
  }

  // Surcharges inopérantes : signalées plutôt qu'ignorées en silence. Une règle hors table peut
  // être un contrôle de plugin (FAB_*, HELICOIDAL_*…) : sa note est retirée par
  // `mergeStructureChecks` si un contrôle fusionné porte cet identifiant.
  for (const o of settings.overrides) {
    if (o.justification.trim() === "")
      notes.push(`Surcharge ignorée sur ${o.ruleId} : justification vide.`);
    else if (!findRule(o.ruleId)) notes.push(unknownOverrideNote(o.ruleId));
  }

  const results: RuleResult[] = [];
  for (const rule of RULES) {
    if (!isRuleApplicable(rule, active)) continue;
    const eff = effectiveSeverity(rule, settings);
    const ev = evaluators.get(rule.id);
    let findings: readonly Finding[];
    if (ev && input.incomplete && !evaluableOnPartialModel(rule.id, input)) {
      findings = [
        {
          status: "non-evaluee",
          location: STAIR,
          message: `Non évaluée : ${input.incomplete === "layout" ? "tracé" : "découpage"} non calculé (modèle partiel, voir les erreurs).`,
        },
      ];
    } else if (!ev) {
      findings = [
        {
          status: "non-evaluee",
          location: STAIR,
          message: "Règle applicable sans évaluateur (non implémentée).",
        },
      ];
    } else {
      try {
        findings = ev({ ...input, rule, contexts: active });
      } catch (e) {
        findings = [
          {
            status: "non-evaluee",
            location: STAIR,
            message: `Erreur de l'évaluateur : ${e instanceof Error ? e.message : String(e)}`,
          },
        ];
      }
      if (findings.length === 0)
        findings = [{ status: "ok", location: STAIR, message: "Sans objet." }];
    }
    for (const f of findings)
      results.push(toResult(rule, f, f.severity ? effectiveSeverity(rule, settings, f) : eff));
  }

  const summary: Record<Severity, number> = { bloquant: 0, avertissement: 0, conseil: 0 };
  for (const r of results) if (r.status === "violation") summary[r.severity]++;

  return {
    report: {
      rulesVersion: RULES_VERSION,
      contexts: resolved.active,
      profile: settings.profile,
      results,
      summary,
      ...(notes.length > 0 ? { notes } : {}),
    },
    contexts: resolved,
    notes,
  };
}

/** Rapport de conformité (étape `compliance` du pipeline). */
export function evaluateCompliance(
  input: ComplianceInput,
  evaluators: EvaluatorRegistry = DEFAULT_EVALUATORS,
): ComplianceReport {
  return evaluateComplianceDetailed(input, evaluators).report;
}

export interface RuleCoverage {
  readonly total: number;
  readonly implemented: readonly string[];
  readonly notImplemented: readonly string[];
}

/** Couverture de la table par les évaluateurs (critère « toute règle traçable »). */
export function ruleCoverage(evaluators: EvaluatorRegistry = DEFAULT_EVALUATORS): RuleCoverage {
  const implemented = RULES.filter((r) => evaluators.has(r.id)).map((r) => r.id);
  const notImplemented = RULES.filter((r) => !evaluators.has(r.id)).map((r) => r.id);
  return { total: RULES.length, implemented, notImplemented };
}
