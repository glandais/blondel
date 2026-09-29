/**
 * Panneau « Prédimensionnement indicatif » (CHALLENGE P5) et classe d'exécution EN 1090-2 :
 * présentation des résultats du cœur (`precheckModel`, ligne `EXC_CLASSE_EXECUTION`). Aucun
 * critère n'est évalué ici ; les bornes (L/200, L/300, 5 Hz) sont celles de `PRECHECK_LIMITS`.
 */
import {
  PRECHECK_LIMITS,
  PrecheckSettingsSchema,
  precheckModel,
  type Model,
  type PrecheckSettings,
  type Project,
  type RuleResult,
  type StairLoads,
} from "@blondel/core";

export type ExecutionClass = "EXC1" | "EXC2";

export interface ExecutionClassInfo {
  readonly value: ExecutionClass;
  /** Justification rendue par le plugin (ex. « nuance S355 »), si disponible. */
  readonly detail?: string;
  readonly location?: RuleResult["location"];
}

/**
 * Classe d'exécution du modèle : `Model.executionClass` si le pipeline la reporte, sinon la
 * ligne `EXC_CLASSE_EXECUTION` du contrôle de conception (comme le comparateur du cœur) ;
 * `null` pour une structure sans acier.
 */
export function executionClassOf(
  model: Pick<Model, "executionClass" | "compliance"> | null | undefined,
): ExecutionClassInfo | null {
  if (!model) return null;
  const line = model.compliance.results.find((r) => r.ruleId === "EXC_CLASSE_EXECUTION");
  const parsed = line ? /EXC[12]/.exec(line.message) : null;
  const value = model.executionClass ?? (parsed ? (parsed[0] as ExecutionClass) : undefined);
  if (!value) return null;
  return {
    value,
    ...(line?.message ? { detail: line.message } : {}),
    ...(line ? { location: line.location } : {}),
  };
}

/** Réglages du prédimensionnement portés par les paramètres du plugin (`precheck`), sinon `{}`. */
export function projectPrecheckSettings(project: Project): Partial<PrecheckSettings> {
  const params = project.stair.structure.params;
  const raw = typeof params === "object" && params !== null ? params["precheck"] : undefined;
  if (raw === undefined) return {};
  const parsed = PrecheckSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export interface PrecheckRow {
  readonly partId: string;
  readonly label: string;
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
  readonly notes: readonly string[];
  readonly minFrequency: number;
}

/**
 * Prédimensionnement des limons du modèle (toutes structures, réglages du plugin s'il en
 * porte) ; `null` sans modèle ou si le calcul échoue.
 */
export function precheckSummary(
  project: Project,
  model: Pick<Model, "stepping" | "parts"> | null | undefined,
): PrecheckSummary | null {
  if (!model) return null;
  try {
    const pc = precheckModel(project, model, projectPrecheckSettings(project));
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
  } catch {
    return null;
  }
}
