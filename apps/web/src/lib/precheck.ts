/**
 * Panneau « Prédimensionnement indicatif » (CHALLENGE P5) et classe d'exécution EN 1090-2 :
 * **présentation seule** des résultats du modèle (`Model.precheck`, calculé dans le worker par
 * le pipeline — par le plugin de structure quand il en fait un, les lignes PRECHECK_* du
 * contrôle de conception venant alors du même calcul — et `executionClassOf` du cœur). Aucun
 * calcul ni critère ici ; les bornes (L/200, L/300, 5 Hz) sont celles de `PRECHECK_LIMITS`.
 */
import {
  PRECHECK_LIMITS,
  executionClassOf,
  type Model,
  type RuleResult,
  type StairLoads,
} from "@blondel/core";
import type { Message } from "@blondel/i18n";

export type ExecutionClass = "EXC1" | "EXC2";

export interface ExecutionClassInfo {
  readonly value: ExecutionClass;
  /** Justification rendue par le plugin (ex. « nuance S355 »), si disponible. */
  readonly detail?: Message;
  readonly location?: RuleResult["location"];
}

/**
 * Classe d'exécution du modèle (`executionClassOf` du cœur) et sa justification (ligne
 * `EXC_CLASSE_EXECUTION` du contrôle de conception) ; `null` pour une structure sans acier.
 */
export function executionClassInfo(
  model: Pick<Model, "executionClass" | "compliance"> | null | undefined,
): ExecutionClassInfo | null {
  if (!model) return null;
  const value = executionClassOf(model);
  if (!value) return null;
  const line = model.compliance.results.find((r) => r.ruleId === "EXC_CLASSE_EXECUTION");
  return {
    value,
    ...(line?.message !== undefined ? { detail: line.message } : {}),
    ...(line ? { location: line.location } : {}),
  };
}

export interface PrecheckRow {
  readonly partId: string;
  readonly label: Message;
  /** Longueur d'axe (m). */
  readonly lengthM: number;
  readonly deflection: number;
  /** L/200 (bloquant) et L/300 (conseil), mm. */
  readonly limit: number;
  readonly adviceLimit: number;
  readonly spanRatio: number;
  readonly stress: number;
  readonly design: number;
  /** Taux de travail σ / f_d, %. */
  readonly ratio: number;
  readonly frequency: number;
  readonly ok: {
    readonly deflection: boolean;
    readonly advice: boolean;
    readonly stress: boolean;
    readonly frequency: boolean;
  };
}

export interface PrecheckSummary {
  readonly rows: readonly PrecheckRow[];
  readonly loads: StairLoads;
  readonly permanentArea: number;
  readonly notes: readonly Message[];
  readonly minFrequency: number;
}

/**
 * Mise en forme du prédimensionnement du modèle (`Model.precheck`) ; `null` sans modèle ou
 * sans prédimensionnement (structure absente, modèle incomplet).
 */
export function precheckSummary(
  model: Pick<Model, "precheck"> | null | undefined,
): PrecheckSummary | null {
  const pc = model?.precheck;
  if (!pc) return null;
  const rows = pc.beams.map((b): PrecheckRow => {
    const r = b.result;
    const limit = r.length / PRECHECK_LIMITS.deflectionRatio;
    const adviceLimit = r.length / PRECHECK_LIMITS.deflectionAdvice;
    return {
      partId: b.partId,
      label: b.label,
      lengthM: r.length / 1000,
      deflection: r.deflection,
      limit,
      adviceLimit,
      spanRatio: r.spanRatio,
      stress: r.stress,
      design: r.design,
      ratio: r.design > 0 ? (100 * r.stress) / r.design : Number.POSITIVE_INFINITY,
      frequency: r.frequency,
      ok: {
        deflection: r.deflection <= limit + 1e-9,
        advice: r.deflection <= adviceLimit + 1e-9,
        stress: r.stress <= r.design + 1e-9,
        frequency: r.frequency >= PRECHECK_LIMITS.frequency - 1e-9,
      },
    };
  });
  return {
    rows,
    loads: pc.loads,
    permanentArea: pc.permanentArea,
    notes: pc.notes,
    minFrequency: PRECHECK_LIMITS.frequency,
  };
}
