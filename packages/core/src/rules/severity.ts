/**
 * Sévérité effective d'une règle (profil de conformité, surcharges utilisateur, sévérité propre
 * au constat). Module sans dépendance aux évaluateurs : ils peuvent le lire (ligne de mesure,
 * `evaluators/stair.ts`) sans cycle d'import avec `engine.ts`, qui le réexporte.
 */
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import type { Severity } from "../model/derived.js";
import type { ComplianceSettings } from "../model/project.js";
import type { RuleDef } from "./table.js";
import type { Finding } from "./types.js";

export interface EffectiveSeverity {
  readonly severity: Severity;
  /** Vrai si l'utilisateur a choisi d'ignorer la règle (justification obligatoire). */
  readonly ignored: boolean;
  readonly downgradeReason?: Message;
}

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  conseil: 0,
  avertissement: 1,
  bloquant: 2,
};

/** Clé du libellé de chaque sévérité (l'identifiant du modèle reste français). */
export const SEVERITY_LABEL_KEYS: Readonly<Record<Severity, MessageKey>> = {
  bloquant: "compliance.severityName.bloquant",
  avertissement: "compliance.severityName.avertissement",
  conseil: "compliance.severityName.conseil",
};

/** Libellé traduisible d'une sévérité (« bloquant », « avertissement », « conseil »). */
export function severityLabel(severity: Severity): Message {
  return msg(SEVERITY_LABEL_KEYS[severity]);
}

/** Messages successifs réunis en un seul, séparés par une espace. */
export function joinWithSpace(messages: readonly Message[]): Message {
  return messages.reduce((first, next) => msg("compliance.join.space", { first, next }));
}

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
  const reasons: Message[] = [];
  if (finding?.severity && SEVERITY_RANK[finding.severity] < SEVERITY_RANK[severity]) {
    severity = finding.severity;
    reasons.push(
      finding.severityReason ??
        msg("compliance.severity.findingDowngrade", { severity: severityLabel(finding.severity) }),
    );
  }
  if (settings.profile === "souple" && rule.source_secondaire && severity === "bloquant") {
    severity = "avertissement";
    reasons.push(msg("compliance.severity.softProfile"));
  }
  const override = [...settings.overrides]
    .reverse()
    .find((o) => o.ruleId === rule.id && o.justification.trim() !== "");
  let ignored = false;
  if (override) {
    if (override.severity === "ignore") {
      ignored = true;
      reasons.push(
        msg("compliance.severity.ignoredByUser", {
          justification: override.justification.trim(),
        }),
      );
    } else if (
      severity !== rule.severite &&
      SEVERITY_RANK[override.severity] < SEVERITY_RANK[rule.severite] &&
      SEVERITY_RANK[override.severity] >= SEVERITY_RANK[severity]
    ) {
      // Surcharge qui assouplit la règle : elle ne relève pas un constat déjà plus faible
      // (sévérité propre au constat ou profil souple).
    } else if (override.severity !== severity) {
      reasons.push(
        msg("compliance.severity.userOverride", {
          from: severityLabel(severity),
          to: severityLabel(override.severity),
          justification: override.justification.trim(),
        }),
      );
      severity = override.severity;
    }
  }
  return reasons.length > 0
    ? { severity, ignored, downgradeReason: joinWithSpace(reasons) }
    : { severity, ignored };
}
