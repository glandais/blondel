/**
 * Sévérité effective d'une règle (profil de conformité, surcharges utilisateur, sévérité propre
 * au constat). Module sans dépendance aux évaluateurs : ils peuvent le lire (ligne de mesure,
 * `evaluators/stair.ts`) sans cycle d'import avec `engine.ts`, qui le réexporte.
 */
import type { Severity } from "../model/derived.js";
import type { ComplianceSettings } from "../model/project.js";
import type { RuleDef } from "./table.js";
import type { Finding } from "./types.js";

export interface EffectiveSeverity {
  readonly severity: Severity;
  /** Vrai si l'utilisateur a choisi d'ignorer la règle (justification obligatoire). */
  readonly ignored: boolean;
  readonly downgradeReason?: string;
}

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
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
