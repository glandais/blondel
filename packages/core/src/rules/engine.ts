/**
 * Moteur de conformité (ADR-0004) : contextes → règles applicables → évaluateurs → sévérité
 * effective (profil, surcharges) → rapport.
 */
import type { ComplianceReport, RuleResult, Severity } from "../model/derived.js";
import type { ComplianceSettings } from "../model/project.js";
import { STAIR } from "./check.js";
import { isRuleApplicable, resolveContexts, type ResolvedContexts } from "./contexts.js";
import { DEFAULT_EVALUATORS, type EvaluatorRegistry } from "./evaluators/index.js";
import { RULES, RULES_VERSION, findRule, type RuleDef } from "./table.js";
import type { ComplianceInput, Finding } from "./types.js";

export interface EffectiveSeverity {
  readonly severity: Severity;
  /** Vrai si l'utilisateur a choisi d'ignorer la règle (justification obligatoire). */
  readonly ignored: boolean;
  readonly downgradeReason?: string;
}

/**
 * Sévérité effective d'une règle :
 * 1. profil `souple` : `bloquant` + `source_secondaire` → `avertissement` ;
 * 2. surcharge utilisateur (dernière pour l'id), prise en compte seulement avec une justification non vide.
 */
export function effectiveSeverity(rule: RuleDef, settings: ComplianceSettings): EffectiveSeverity {
  let severity: Severity = rule.severite;
  const reasons: string[] = [];
  if (settings.profile === "souple" && rule.source_secondaire && severity === "bloquant") {
    severity = "avertissement";
    reasons.push("Profil souple : valeur issue d'une source secondaire (norme non lue).");
  }
  const override = [...settings.overrides].reverse().find((o) => o.ruleId === rule.id && o.justification.trim() !== "");
  let ignored = false;
  if (override) {
    if (override.severity === "ignore") {
      ignored = true;
      reasons.push(`Ignorée par l'utilisateur : ${override.justification.trim()}`);
    } else if (override.severity !== severity) {
      reasons.push(`Surcharge utilisateur (${severity} → ${override.severity}) : ${override.justification.trim()}`);
      severity = override.severity;
    }
  }
  return reasons.length > 0 ? { severity, ignored, downgradeReason: reasons.join(" ") } : { severity, ignored };
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
  };
}

export interface ComplianceEvaluation {
  readonly report: ComplianceReport;
  readonly contexts: ResolvedContexts;
  /** Remarques (contextes déduits ou inconnus, régime supposé, version de règles…). */
  readonly notes: readonly string[];
}

/** Évaluation complète avec le détail de la résolution des contextes. */
export function evaluateComplianceDetailed(
  input: ComplianceInput,
  evaluators: EvaluatorRegistry = DEFAULT_EVALUATORS,
): ComplianceEvaluation {
  const settings = input.project.compliance;
  const resolved = resolveContexts(settings, input.stepping);
  const active = new Set(resolved.active);
  const notes = [...resolved.notes];
  if (resolved.derived.length > 0) notes.push(`Contextes déduits : ${resolved.derived.join(", ")}.`);
  if (input.project.rulesVersion !== RULES_VERSION) {
    notes.push(
      `Le projet référence le jeu de règles v${input.project.rulesVersion} ; rapport établi avec la v${RULES_VERSION}.`,
    );
  }

  // Surcharges inopérantes : signalées plutôt qu'ignorées en silence.
  for (const o of settings.overrides) {
    if (!findRule(o.ruleId)) notes.push(`Surcharge ignorée : règle inconnue « ${o.ruleId} ».`);
    else if (o.justification.trim() === "") notes.push(`Surcharge ignorée sur ${o.ruleId} : justification vide.`);
  }

  const results: RuleResult[] = [];
  for (const rule of RULES) {
    if (!isRuleApplicable(rule, active)) continue;
    const eff = effectiveSeverity(rule, settings);
    const ev = evaluators.get(rule.id);
    let findings: readonly Finding[];
    if (!ev) {
      findings = [{ status: "non-evaluee", location: STAIR, message: "Règle applicable sans évaluateur (non implémentée)." }];
    } else {
      try {
        findings = ev({ ...input, rule, contexts: active });
      } catch (e) {
        findings = [
          { status: "non-evaluee", location: STAIR, message: `Erreur de l'évaluateur : ${e instanceof Error ? e.message : String(e)}` },
        ];
      }
      if (findings.length === 0) findings = [{ status: "ok", location: STAIR, message: "Sans objet." }];
    }
    for (const f of findings) results.push(toResult(rule, f, eff));
  }

  const summary: Record<Severity, number> = { bloquant: 0, avertissement: 0, conseil: 0 };
  for (const r of results) if (r.status === "violation") summary[r.severity]++;

  return {
    report: { rulesVersion: RULES_VERSION, contexts: resolved.active, profile: settings.profile, results, summary },
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
