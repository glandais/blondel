/**
 * Résultats du prédimensionnement en `RuleResult` (contrôle de conception). Chaque ligne porte
 * le libellé « prédimensionnement indicatif, ne remplace pas une note de calcul » (CHALLENGE P5).
 */
import { dec, msg, type Message } from "@blondel/i18n";
import type { Location, RuleResult, Stepping } from "../model/derived.js";
import type { Project } from "../model/project.js";
import type { Finding } from "../rules/types.js";
import { CheckCollector, pluginRuleDef, type PluginRuleSpec } from "../structures/checks.js";
import { PRECHECK_LIMITS, type InclinedBeamResult } from "./beam.js";

/**
 * Libellé de tout résultat du prédimensionnement. Les descriptions des règles
 * (`rules.PRECHECK_*.description`) commencent par ce même texte.
 */
export const PRECHECK_LABEL: Message = msg("precheck.label");

export const PRECHECK_RULES = {
  deflection: {
    id: "PRECHECK_FLECHE",
    source:
      "NF EN 16481 § 6.2 via docs/research/C-structures.md §1.3 et C-B-05 [3] ; SPEC X17 (L/200 bloquant si calcul) ; modèle de poutre Blondel",
    confidence: "moyen",
    nature: "normatif",
    severity: "bloquant",
    unit: "mm",
  },
  deflectionAdvice: {
    id: "PRECHECK_FLECHE_CONSEIL",
    source: "docs/research/C-structures.md §1.3 [52] (usage, confiance faible) ; SPEC X17",
    confidence: "faible",
    nature: "metier",
    severity: "conseil",
    unit: "mm",
  },
  stress: {
    id: "PRECHECK_CONTRAINTE",
    source:
      "Calcul élastique Blondel ; f_y = 235 / 355 MPa (nuance) ; coefficients partiels et classes de bois à valider (EN 1990, EC3, EC5, EN 338 non lus)",
    confidence: "faible",
    nature: "metier",
    severity: "bloquant",
    unit: "MPa",
  },
  frequency: {
    id: "PRECHECK_FREQUENCE",
    source: "NF EN 16481 § 6.3 via docs/research/C-structures.md §1.3 et C-B-06 [3]",
    confidence: "moyen",
    nature: "normatif",
    severity: "avertissement",
    unit: "Hz",
  },
} as const satisfies Record<string, PluginRuleSpec>;

export const PRECHECK_RULE_IDS: ReadonlySet<string> = new Set(
  Object.values(PRECHECK_RULES).map((r) => r.id),
);

/** Poutre analysée : pièce, libellé (repère, section, matériau) et résultat. */
export interface PrecheckedBeam {
  readonly partId: string;
  readonly label: Message;
  readonly result: InclinedBeamResult;
}

function findings(
  beams: readonly PrecheckedBeam[],
): Record<keyof typeof PRECHECK_RULES, Finding[]> {
  const out: Record<keyof typeof PRECHECK_RULES, Finding[]> = {
    deflection: [],
    deflectionAdvice: [],
    stress: [],
    frequency: [],
  };
  for (const b of beams) {
    const r = b.result;
    const location: Location = { kind: "part", partId: b.partId };
    const head = msg("precheck.finding.head", {
      label: PRECHECK_LABEL,
      beam: b.label,
      length: dec(r.length / 1000, 2),
    });
    for (const [key, ratio] of [
      ["deflection", PRECHECK_LIMITS.deflectionRatio],
      ["deflectionAdvice", PRECHECK_LIMITS.deflectionAdvice],
    ] as const) {
      const max = r.length / ratio;
      const ok = r.deflection <= max + 1e-9;
      out[key].push({
        status: ok ? "ok" : "violation",
        measured: r.deflection,
        min: null,
        max,
        location,
        message: msg("precheck.finding.deflection", {
          head,
          deflection: dec(r.deflection, 1),
          relation: ok ? "≤" : ">",
          ratio: String(ratio),
          max: dec(max, 1),
          spanRatio: dec(r.spanRatio, 0),
        }),
      });
    }
    const okS = r.stress <= r.design + 1e-9;
    out.stress.push({
      status: okS ? "ok" : "violation",
      measured: r.stress,
      min: null,
      max: r.design,
      location,
      message: msg("precheck.finding.stress", {
        head,
        stress: dec(r.stress, 1),
        relation: okS ? "≤" : ">",
        design: dec(r.design, 1),
        rate: dec((100 * r.stress) / r.design, 0),
      }),
    });
    const okF = r.frequency >= PRECHECK_LIMITS.frequency - 1e-9;
    out.frequency.push({
      status: okF ? "ok" : "violation",
      measured: r.frequency,
      min: PRECHECK_LIMITS.frequency,
      max: null,
      location,
      message: msg("precheck.finding.frequency", {
        head,
        frequency: dec(r.frequency, 1),
        relation: okF ? "≥" : "<",
        min: String(PRECHECK_LIMITS.frequency),
      }),
    });
  }
  return out;
}

/** Contrôles de conception du prédimensionnement (un constat par poutre et par critère). */
export function precheckResults(
  project: Project,
  stepping: Stepping,
  beams: readonly PrecheckedBeam[],
): RuleResult[] {
  const col = new CheckCollector(project, stepping);
  const f = findings(beams);
  for (const key of Object.keys(PRECHECK_RULES) as (keyof typeof PRECHECK_RULES)[]) {
    if (f[key].length > 0) col.add(pluginRuleDef(PRECHECK_RULES[key]), f[key]);
  }
  return col.results;
}
