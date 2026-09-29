/**
 * Comparateur de variantes de structure (CHALLENGE P2, base du jalon 3c).
 *
 * Même **épure** (site, tracé, ligne de foulée, découpage) : seule `stair.structure.kind`
 * change ; raccords et balancement sont recalculés par le pipeline pour chaque variante (la
 * variante M3 automatique dépend de la structure). Grandeurs physiques d'abord : masse,
 * surface, nombre de pièces, pièces uniques, cordons, plis, coupes, perçages, classe
 * d'exécution, violations du contrôle de conception et du prédimensionnement indicatif. Les
 * **euros** ne sont calculés que si le profil d'atelier porte un barème complet (taux horaire et
 * temps unitaires, prix matière des matériaux présents, prix de finition si de l'acier peint ou
 * galvanisé est présent) ; sinon `cost` vaut `null` et `costMissing` liste les champs manquants.
 * La finition des pièces bois n'est pas chiffrée (non modélisée).
 *
 * Module non réexporté par `structures/index.ts` (il dépend du pipeline, qui dépend des
 * structures) : il est exporté par l'index du paquet.
 */
import type { Model, Part, Severity } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { PRECHECK_RULE_IDS } from "../precheck/checks.js";
import { precheckModel } from "../precheck/stringers.js";
import { PrecheckSettingsSchema, type PrecheckSettings } from "../precheck/settings.js";
import { COST_TIME_FIELDS, type CostRates } from "../workshop/costs.js";
import { isWoodMaterial, resolveWorkshopProfile } from "../workshop/profile.js";
import {
  QUANTITY_MASS_KG,
  QUANTITY_STOCK_VOLUME_M3,
  QUANTITY_SURFACE_M2,
  QUANTITY_VOLUME_M3,
} from "./quantities.js";
import { getStructure } from "./registry.js";
import {
  IDENTICAL_TOLERANCE,
  QUANTITY_BENDS,
  QUANTITY_BUTT_WELD_MM,
  QUANTITY_CUTS,
  QUANTITY_HOLES,
  QUANTITY_TREATED_SURFACE_M2,
  QUANTITY_WELD_MM,
  groupIdenticalFlats,
} from "./steelCommon.js";

export interface VariantCost {
  /** Total € HT (matière + main-d'œuvre + finition). */
  readonly total: number;
  readonly material: number;
  readonly labour: number;
  readonly finish: number;
  /** Heures d'atelier estimées. */
  readonly hours: number;
}

export interface VariantSummary {
  readonly kind: string;
  readonly label: string;
  readonly family: "bois" | "metal" | "mixte" | null;
  /** Masse totale (kg) ; pièces sans masse connue ignorées (`massUnknown`). */
  readonly massKg: number;
  readonly massUnknown: number;
  /** Surface à traiter (acier) ou de référence (bois), m². */
  readonly surfaceM2: number;
  readonly partCount: number;
  /** Nombre de pièces différentes (développés identiques à 0,5 mm, sinon section et débit). */
  readonly uniqueParts: number;
  readonly weldMm: number;
  readonly buttWeldMm: number;
  readonly bends: number;
  readonly cuts: number;
  readonly holes: number;
  /** Classe d'exécution EN 1090-2 (structures métal), `null` sinon. */
  readonly executionClass: "EXC1" | "EXC2" | null;
  /** Violations du contrôle de conception (hors prédimensionnement), par sévérité effective. */
  readonly violations: Readonly<Record<Severity, number>>;
  /** Prédimensionnement indicatif des limons (toutes structures) : limons évalués, violations. */
  readonly precheck: {
    readonly beams: number;
    readonly violations: Readonly<Record<Severity, number>>;
  };
  readonly errors: readonly string[];
  /** Coût en € HT si le barème de l'atelier est complet, sinon `null`. */
  readonly cost: VariantCost | null;
  /** Champs du barème manquants pour chiffrer cette variante. */
  readonly costMissing: readonly string[];
  readonly model: Model;
}

export interface CompareOptions {
  /** Paramètres par structure ; défaut : ceux du projet pour sa structure, `{}` sinon. */
  readonly params?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Réglages du prédimensionnement appliqué à toutes les variantes. */
  readonly precheck?: Partial<PrecheckSettings>;
}

const sum = (parts: readonly Part[], key: string): number =>
  parts.reduce((s, p) => s + (p.quantities[key] ?? 0), 0);

const zeroes = (): Record<Severity, number> => ({ bloquant: 0, avertissement: 0, conseil: 0 });

/** Nombre de pièces différentes. */
export function countUniqueParts(parts: readonly Part[]): number {
  const withFlat = parts.filter((p) => p.flat);
  const flatGroups = groupIdenticalFlats(withFlat).length;
  const keys = new Set<string>();
  const r = (x: number | undefined): number => Math.round((x ?? 0) / IDENTICAL_TOLERANCE);
  for (const p of parts) {
    if (p.flat) continue;
    keys.add(
      `${p.category}|${p.material}|${p.section ?? ""}|${r(p.stock?.length)}|${r(p.stock?.width)}|${r(p.stock?.thickness)}|${p.quantities[QUANTITY_HOLES] ?? 0}`,
    );
  }
  return flatGroups + keys.size;
}

/** Coût d'une variante : `null` si le barème est incomplet (champs manquants listés). */
export function variantCost(
  rates: CostRates,
  m: {
    readonly steelKg: number;
    readonly woodM3: number;
    /** Surface à finir (acier peint ou galvanisé), m² : tarifée `finishPricePerM2`. */
    readonly surfaceM2: number;
    readonly cuts: number;
    readonly weldMm: number;
    readonly bends: number;
    readonly holes: number;
    readonly uniqueParts: number;
  },
): { cost: VariantCost | null; missing: string[] } {
  const missing: string[] = [];
  if (rates.hourlyRate === undefined) missing.push("hourlyRate");
  for (const f of COST_TIME_FIELDS) if (rates[f] === undefined) missing.push(f);
  if (m.steelKg > 0 && rates.steelPricePerKg === undefined) missing.push("steelPricePerKg");
  if (m.woodM3 > 0 && rates.woodPricePerM3 === undefined) missing.push("woodPricePerM3");
  if (m.surfaceM2 > 0 && rates.finishPricePerM2 === undefined) missing.push("finishPricePerM2");
  if (missing.length > 0) return { cost: null, missing };
  const minutes =
    m.cuts * rates.minutesPerCut! +
    (m.weldMm / 1000) * rates.minutesPerWeldMeter! +
    m.bends * rates.minutesPerBend! +
    m.holes * rates.minutesPerHole! +
    m.uniqueParts * rates.minutesPerUniquePart!;
  const hours = minutes / 60;
  const labour = hours * rates.hourlyRate!;
  const material =
    m.steelKg * (rates.steelPricePerKg ?? 0) + m.woodM3 * (rates.woodPricePerM3 ?? 0);
  const finish = m.surfaceM2 * (rates.finishPricePerM2 ?? 0);
  return { cost: { total: material + labour + finish, material, labour, finish, hours }, missing };
}

/**
 * Réglages du prédimensionnement portés par les paramètres du plugin (`precheck`, ex.
 * `steel-profile`), pour que le comparateur évalue la variante comme le plugin ; `{}` sinon.
 */
function pluginPrecheckSettings(
  params: Readonly<Record<string, unknown>>,
): Partial<PrecheckSettings> {
  const parsed = PrecheckSettingsSchema.safeParse(params["precheck"] ?? {});
  return parsed.success ? parsed.data : {};
}

function executionClassOf(model: Model): "EXC1" | "EXC2" | null {
  if (model.executionClass) return model.executionClass;
  // Repli (modèle produit sans `executionClass`, ex. structure en erreur) : la classe est lue
  // dans la ligne EXC_CLASSE_EXECUTION du contrôle de conception.
  const line = model.compliance.results.find((r) => r.ruleId === "EXC_CLASSE_EXECUTION");
  const m = line ? /EXC[12]/.exec(line.message) : null;
  return m ? (m[0] as "EXC1" | "EXC2") : null;
}

/**
 * Compare des variantes de structure (`kinds`, ex. `["wood-housed", "steel-flat",
 * "steel-profile"]`) sur la même épure que `project`.
 */
export function compareVariants(
  project: Project,
  kinds: readonly string[],
  options: CompareOptions = {},
): VariantSummary[] {
  const rates = resolveWorkshopProfile(project.workshop).costs;
  return kinds.map((kind) => {
    const plugin = kind === "none" ? undefined : getStructure(kind);
    const params =
      options.params?.[kind] ??
      (kind === project.stair.structure.kind ? project.stair.structure.params : {});
    const variant: Project = {
      ...project,
      stair: { ...project.stair, structure: { kind, params: { ...params } } },
    };
    const model = buildModel(variant);
    const parts = model.parts;
    let massKg = 0;
    let massUnknown = 0;
    let steelKg = 0;
    let woodM3 = 0;
    let surfaceM2 = 0;
    let finishedM2 = 0;
    for (const p of parts) {
      const mass = p.quantities[QUANTITY_MASS_KG];
      if (mass === undefined) massUnknown++;
      else massKg += mass;
      if (isWoodMaterial(p.material)) {
        woodM3 += p.quantities[QUANTITY_STOCK_VOLUME_M3] ?? p.quantities[QUANTITY_VOLUME_M3] ?? 0;
        surfaceM2 += p.quantities[QUANTITY_SURFACE_M2] ?? 0;
      } else if (p.material.startsWith("steel") || p.material.startsWith("stainless")) {
        steelKg += mass ?? 0;
        const treated = p.quantities[QUANTITY_TREATED_SURFACE_M2] ?? 0;
        surfaceM2 += treated;
        // Seul l'acier peint ou galvanisé est fini (acier brut, inox : pas de finition tarifée).
        if (p.material === "steel-painted" || p.material === "steel-galvanized") {
          finishedM2 += treated;
        }
      }
    }
    const violations = zeroes();
    const pre = zeroes();
    for (const r of model.compliance.results) {
      if (r.status !== "violation" || PRECHECK_RULE_IDS.has(r.ruleId)) continue;
      violations[r.severity]++;
    }
    const pc = precheckModel(variant, model, options.precheck ?? pluginPrecheckSettings(params));
    for (const r of pc.results) if (r.status === "violation") pre[r.severity]++;
    const uniqueParts = countUniqueParts(parts);
    const cuts = sum(parts, QUANTITY_CUTS);
    const weldMm = sum(parts, QUANTITY_WELD_MM);
    const bends = sum(parts, QUANTITY_BENDS);
    const holes = sum(parts, QUANTITY_HOLES);
    const { cost, missing } = variantCost(rates, {
      steelKg,
      woodM3,
      surfaceM2: finishedM2,
      cuts,
      weldMm,
      bends,
      holes,
      uniqueParts,
    });
    return {
      kind,
      label: plugin?.label ?? (kind === "none" ? "Sans structure (pièces de base)" : kind),
      family: plugin?.family ?? null,
      massKg,
      massUnknown,
      surfaceM2,
      partCount: parts.length,
      uniqueParts,
      weldMm,
      buttWeldMm: sum(parts, QUANTITY_BUTT_WELD_MM),
      bends,
      cuts,
      holes,
      executionClass: executionClassOf(model),
      violations,
      precheck: { beams: pc.beams.length, violations: pre },
      errors: model.errors,
      cost,
      costMissing: missing,
      model,
    };
  });
}
