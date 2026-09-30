/**
 * Moteur de conformité (ADR-0004) : contextes → règles applicables → évaluateurs → sévérité
 * effective (profil, surcharges) → rapport.
 */
import { errorMessage, msg, type Message } from "@blondel/i18n";
import type { ComplianceReport, RuleResult, Severity } from "../model/derived.js";
import { STAIR } from "./check.js";
import { isRuleApplicable, resolveContexts, type ResolvedContexts } from "./contexts.js";
import {
  DEFAULT_EVALUATORS,
  PARTIAL_MODEL_RULES,
  type EvaluatorRegistry,
} from "./evaluators/index.js";
import { UNEVALUATED_REASONS } from "./evaluators/unevaluable.js";
import { effectiveSeverity, type EffectiveSeverity } from "./severity.js";
import { RULES, RULES_VERSION, findRule, type RuleDef } from "./table.js";
import type { ComplianceInput, Finding } from "./types.js";

// Sévérité effective : `rules/severity.ts` (sans dépendance aux évaluateurs, lisible par eux).
export { effectiveSeverity, type EffectiveSeverity };

/** Note d'une surcharge portant sur un identifiant absent de rules.yaml. */
export function unknownOverrideNote(ruleId: string): Message {
  return msg("compliance.engine.unknownOverride", { ruleId });
}

/** Étape en échec d'un modèle partiel, en minuscules dans une phrase (« tracé », « découpage »). */
function incompleteStage(stage: "layout" | "stepping"): Message {
  return msg(
    stage === "layout" ? "compliance.engine.stage.layout" : "compliance.engine.stage.stepping",
  );
}

function toResult(rule: RuleDef, f: Finding, eff: EffectiveSeverity): RuleResult {
  const base: RuleResult = {
    ruleId: rule.id,
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
  readonly notes: readonly Message[];
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
  const resolved = resolveContexts(
    settings,
    input.stepping,
    input.layout.helical?.core,
    input.project.stair.structure.kind,
  );
  const active = new Set(resolved.active);
  const notes: Message[] = [...resolved.notes];
  if (resolved.derived.length > 0)
    notes.push(msg("compliance.engine.derivedContexts", { contexts: resolved.derived.join(", ") }));
  if (input.project.rulesVersion !== RULES_VERSION) {
    notes.push(
      msg("compliance.engine.rulesVersionMismatch", {
        projectVersion: String(input.project.rulesVersion),
        version: String(RULES_VERSION),
      }),
    );
  }

  if (input.incomplete) {
    notes.push(msg("compliance.engine.partialModel", { stage: incompleteStage(input.incomplete) }));
  }

  // Surcharges inopérantes : signalées plutôt qu'ignorées en silence. Une règle hors table peut
  // être un contrôle de plugin (FAB_*, HELICOIDAL_*…) : sa note est retirée par
  // `mergeStructureChecks` si un contrôle fusionné porte cet identifiant.
  for (const o of settings.overrides) {
    if (o.justification.trim() === "")
      notes.push(msg("compliance.engine.emptyJustification", { ruleId: o.ruleId }));
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
          message: msg("compliance.engine.partialNotEvaluated", {
            stage: incompleteStage(input.incomplete),
          }),
        },
      ];
    } else if (!ev) {
      // Règle non évaluable sur le modèle : motif précis (donnée absente, hors conception).
      const reason = UNEVALUATED_REASONS[rule.id];
      let message: Message = msg("compliance.engine.noEvaluator");
      if (reason) {
        try {
          message = reason({ ...input, rule, contexts: active });
        } catch (e) {
          message = msg("compliance.engine.reasonError", { detail: errorMessage(e) });
        }
      }
      findings = [{ status: "non-evaluee", location: STAIR, message }];
    } else {
      try {
        findings = ev({ ...input, rule, contexts: active });
      } catch (e) {
        findings = [
          {
            status: "non-evaluee",
            location: STAIR,
            message: msg("compliance.engine.evaluatorError", { detail: errorMessage(e) }),
          },
        ];
      }
      if (findings.length === 0)
        findings = [{ status: "ok", location: STAIR, message: msg("compliance.notApplicable") }];
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
  /** Règles sans évaluateur (toujours `non-evaluee`). */
  readonly notImplemented: readonly string[];
  /** Parmi elles, celles dont le motif de non-évaluation est déclaré (`UNEVALUATED_REASONS`). */
  readonly withReason: readonly string[];
}

/** Couverture de la table par les évaluateurs (critère « toute règle traçable »). */
export function ruleCoverage(evaluators: EvaluatorRegistry = DEFAULT_EVALUATORS): RuleCoverage {
  const implemented = RULES.filter((r) => evaluators.has(r.id)).map((r) => r.id);
  const notImplemented = RULES.filter((r) => !evaluators.has(r.id)).map((r) => r.id);
  const withReason = notImplemented.filter((id) => UNEVALUATED_REASONS[id] !== undefined);
  return { total: RULES.length, implemented, notImplemented, withReason };
}
