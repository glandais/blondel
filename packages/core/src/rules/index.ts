/**
 * Moteur de conformité (ADR-0004) — API publique.
 */
export {
  RULES,
  RULES_VERSION,
  RULE_CONTEXTS,
  RULE_TABLE,
  CONFIDENCE_LABEL_KEYS,
  NATURE_LABEL_KEYS,
  RuleDefSchema,
  RuleTableSchema,
  findRule,
  getRule,
  type RuleDef,
  type RuleTable,
} from "./table.js";
export {
  ALWAYS_CONTEXT,
  CONTEXT_LABEL_KEYS,
  DEDUCED_ONLY_CONTEXTS,
  contextLabel,
  HELICAL_COLUMN_CONTEXT,
  SHAPE_CONTEXTS,
  guardRailRegime,
  isRuleApplicable,
  resolveContexts,
  type GuardRailRegime,
  type GuardRailResolution,
  type ResolvedContexts,
} from "./contexts.js";
export {
  DEFAULT_EVALUATORS,
  PARTIAL_MODEL_RULES,
  createRegistry,
  type EvaluatorRegistry,
} from "./evaluators/index.js";
export {
  effectiveSeverity,
  evaluateCompliance,
  evaluateComplianceDetailed,
  ruleCoverage,
  type ComplianceEvaluation,
  type EffectiveSeverity,
  type RuleCoverage,
} from "./engine.js";
export {
  GUARD_EVALUATORS,
  guardHeightTable,
  handrailClearWidth,
  requiredGuardHeight2024,
  type GuardHeightStep,
} from "./evaluators/guards.js";
export { SEVERITY_LABEL_KEYS, severityLabel } from "./severity.js";
export type { ComplianceInput, EvaluatorContext, Finding, RuleEvaluator } from "./types.js";
export { RULE_FAMILIES, RULE_FAMILY_LABELS, ruleFamily, type RuleFamily } from "./family.js";
