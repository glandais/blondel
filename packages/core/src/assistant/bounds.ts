/**
 * Bornes de l'énumération lues dans les règles actives (rules.yaml) : aucune valeur métier en
 * dur. Une règle borne une grandeur quand sa formule documentaire est un simple encadrement de
 * cette grandeur (`h <= 180`, `160 <= h <= 180`, `g >= 240`, `580 <= 2*h + g <= 660`…) ; les
 * seuils sont ceux des champs `min` / `max` / `recommande` de la règle.
 *
 * - Bornes **bloquantes** (sévérité effective, profil et surcharges compris) : domaine de
 *   l'énumération (h_max, g_min, module de Blondel, E_min, échappée minimale).
 * - Bornes **toutes sévérités** : h_min (aucune règle bloquante ne borne h par le bas ;
 *   `H_CONFORT` le fait en conseil) ; repli (avertissement, puis toutes sévérités) quand
 *   aucune règle bloquante n'existe.
 * - Valeurs **recommandées** (`recommande`) : cibles du score.
 */
import type { Severity } from "../model/derived.js";
import type { ComplianceSettings } from "../model/project.js";
import { isRuleApplicable, resolveContexts } from "../rules/contexts.js";
import { effectiveSeverity } from "../rules/engine.js";
import { RULES, type RuleDef } from "../rules/table.js";

/** Grandeurs bornées reconnues dans les formules de rules.yaml. */
export type BoundedQuantity = "h" | "g" | "2*h + g" | "E" | "L_passage" | "e" | "g_collet";

export interface RuleBound {
  readonly value: number;
  readonly ruleId: string;
}

export interface QuantityBounds {
  /** Plus grand minimum (le plus contraignant). */
  readonly min: RuleBound | null;
  /** Plus petit maximum. */
  readonly max: RuleBound | null;
  /** Plus grande valeur recommandée ; `null` si aucune. */
  readonly recommended: RuleBound | null;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUM = "-?\\d+(?:\\.\\d+)?";

/** Vrai si la formule de la règle est un encadrement simple de la grandeur `q`. */
export function boundsQuantity(rule: RuleDef, q: BoundedQuantity): boolean {
  const f = rule.formule.replace(/\s+/g, "");
  const v = escapeRegExp(q.replace(/\s+/g, ""));
  return new RegExp(`^(?:${NUM}<=)?${v}(?:(?:<=|<|>=)${NUM})?$`).test(f) && f !== v;
}

/** Contextes actifs de l'énumération : ceux du projet, `tous`, régime garde-corps, formes. */
export function assistantContexts(
  settings: ComplianceSettings,
  shapeContexts: readonly string[] = [],
): Set<string> {
  const set = new Set(resolveContexts(settings).active);
  for (const c of shapeContexts) set.add(c);
  return set;
}

/**
 * Bornes d'une grandeur par les règles applicables. `severities` filtre sur la sévérité
 * **effective** (profil souple, surcharges) ; une règle ignorée par surcharge ne compte pas.
 */
export function quantityBounds(
  q: BoundedQuantity,
  settings: ComplianceSettings,
  contexts: ReadonlySet<string>,
  severities: readonly Severity[] = ["bloquant", "avertissement", "conseil"],
): QuantityBounds {
  let min: RuleBound | null = null;
  let max: RuleBound | null = null;
  let recommended: RuleBound | null = null;
  for (const rule of RULES) {
    if (!boundsQuantity(rule, q) || !isRuleApplicable(rule, contexts)) continue;
    const eff = effectiveSeverity(rule, settings);
    if (eff.ignored || !severities.includes(eff.severity)) continue;
    if (rule.min !== null && (min === null || rule.min > min.value))
      min = { value: rule.min, ruleId: rule.id };
    if (rule.max !== null && (max === null || rule.max < max.value))
      max = { value: rule.max, ruleId: rule.id };
    if (rule.recommande !== null && (recommended === null || rule.recommande > recommended.value))
      recommended = { value: rule.recommande, ruleId: rule.id };
  }
  return { min, max, recommended };
}

/**
 * Bornes bloquantes, à défaut bloquantes ou en avertissement (profil souple : règles de source
 * secondaire rétrogradées), à défaut toutes sévérités confondues.
 */
export function blockingOrAny(
  q: BoundedQuantity,
  settings: ComplianceSettings,
  contexts: ReadonlySet<string>,
): QuantityBounds {
  const blocking = quantityBounds(q, settings, contexts, ["bloquant"]);
  const warning = quantityBounds(q, settings, contexts, ["bloquant", "avertissement"]);
  const any = quantityBounds(q, settings, contexts);
  return {
    min: blocking.min ?? warning.min ?? any.min,
    max: blocking.max ?? warning.max ?? any.max,
    recommended: any.recommended,
  };
}

/** Domaine de l'énumération pour un jeu de contextes. */
export interface EnumerationBounds {
  /** h_max : plus petit maximum bloquant de h (à défaut, toutes sévérités). */
  readonly riseMax: RuleBound;
  /** h_min : plus grand minimum de h, toutes sévérités (confort). */
  readonly riseMin: RuleBound;
  /** Giron minimal bloquant (`null` si aucune règle). */
  readonly goingMin: RuleBound | null;
  /** Module 2h + g : bornes bloquantes (à défaut toutes sévérités) et valeur recommandée. */
  readonly blondelMin: RuleBound | null;
  readonly blondelMax: RuleBound | null;
  readonly blondelTarget: number;
  /** Emmarchement utile minimal bloquant (E ou largeur de passage). */
  readonly widthMin: RuleBound | null;
  /** Emmarchement recommandé (plus grande valeur `recommande`). */
  readonly widthRecommended: number | null;
  /** Échappée minimale bloquante (`null` : aucune règle bloquante, pas de filtre). */
  readonly headroomMin: RuleBound | null;
  /** Échappée recommandée (cible du score). */
  readonly headroomRecommended: number | null;
  /** Collet recommandé (cible du score) ; `null` si aucune règle. */
  readonly colletRecommended: number | null;
}

/** Réglages de repli quand aucune règle ne borne une grandeur (`ASSISTANT_DEFAULTS`). */
export interface BoundsFallbacks {
  readonly riseMax: number;
  readonly riseMin: number;
  readonly blondelTarget: number;
}

export function enumerationBounds(
  settings: ComplianceSettings,
  contexts: ReadonlySet<string>,
  fallbacks: BoundsFallbacks,
): EnumerationBounds {
  const h = blockingOrAny("h", settings, contexts);
  const hAny = quantityBounds("h", settings, contexts);
  const g = quantityBounds("g", settings, contexts, ["bloquant"]);
  const b = blockingOrAny("2*h + g", settings, contexts);
  const e = quantityBounds("E", settings, contexts, ["bloquant"]);
  const passage = quantityBounds("L_passage", settings, contexts, ["bloquant"]);
  const eAny = quantityBounds("E", settings, contexts);
  const head = quantityBounds("e", settings, contexts, ["bloquant"]);
  const headAny = quantityBounds("e", settings, contexts);
  const collet = quantityBounds("g_collet", settings, contexts);
  const widthMin =
    e.min && passage.min
      ? e.min.value >= passage.min.value
        ? e.min
        : passage.min
      : (e.min ?? passage.min);
  // Échappée recommandée : plus grande valeur recommandée ou minimum non bloquant (conseil).
  const headRec = Math.max(
    headAny.recommended?.value ?? -Infinity,
    quantityBounds("e", settings, contexts, ["avertissement", "conseil"]).min?.value ?? -Infinity,
  );
  return {
    riseMax: h.max ?? { value: fallbacks.riseMax, ruleId: "(repli)" },
    riseMin: hAny.min ?? { value: fallbacks.riseMin, ruleId: "(repli)" },
    goingMin: g.min,
    blondelMin: b.min,
    blondelMax: b.max,
    blondelTarget: b.recommended?.value ?? fallbacks.blondelTarget,
    widthMin,
    widthRecommended: eAny.recommended?.value ?? null,
    headroomMin: head.min,
    headroomRecommended: Number.isFinite(headRec) ? headRec : null,
    colletRecommended: collet.recommended?.value ?? collet.min?.value ?? null,
  };
}

/** Nombre de hauteurs énumérés : n ∈ [⌈H / h_max⌉ ; ⌈H / h_min⌉] (au moins une valeur). */
export function riserCountRange(height: number, bounds: EnumerationBounds): number[] {
  const lo = Math.max(2, Math.ceil(height / bounds.riseMax.value - 1e-9));
  const hi = Math.max(lo, Math.ceil(height / bounds.riseMin.value - 1e-9));
  const out: number[] = [];
  for (let n = lo; n <= Math.min(hi, 60); n++) out.push(n);
  return out;
}

/** Intervalle admissible du giron pour une hauteur h et le giron visé (module recommandé). */
export interface GoingRange {
  readonly lo: number;
  readonly hi: number;
  readonly target: number;
}

export function goingRange(rise: number, bounds: EnumerationBounds): GoingRange | null {
  const lo = Math.max(
    bounds.goingMin?.value ?? 0,
    bounds.blondelMin ? bounds.blondelMin.value - 2 * rise : 0,
    1,
  );
  const hi = bounds.blondelMax ? bounds.blondelMax.value - 2 * rise : Infinity;
  if (!(hi >= lo)) return null;
  const target = Math.min(hi, Math.max(lo, bounds.blondelTarget - 2 * rise));
  return { lo, hi, target };
}
