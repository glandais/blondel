/**
 * Formulaire du balancement : méthodes proposées (liste unique du schéma du cœur,
 * `BalancingSchema.method`) et bornes des curseurs des méthodes M2 (herse, angle α) et M6
 * (rotation paramétrée, portée λ et raideur p). Aucune valeur métier ici : les bornes viennent
 * du schéma du cœur et du modèle (`Stepping.balancedZones[].herseAlphaMax`), les valeurs par
 * défaut des constantes du cœur (`HERSE_DEFAULT_ANGLE`, `ROTATION_DEFAULT_*`, « à valider »).
 */
import {
  BalancingSchema,
  HERSE_DEFAULT_ANGLE,
  ROTATION_DEFAULT_REACH,
  ROTATION_DEFAULT_STEEPNESS,
  type BalancingMethod,
  type Model,
  type Project,
} from "@blondel/core";
import { enumOptions, fieldSchema, numberConstraints } from "./structureForm.js";

/** Libellés des méthodes (B §3). */
export const BALANCING_METHOD_LABELS: Readonly<Record<BalancingMethod, string>> = {
  M3: "M3 — développement du limon",
  M1: "M1 — progression arithmétique",
  M2: "M2 — herse (angle α)",
  M6: "M6 — rotation paramétrée (λ, p)",
  M0: "M0 — sans balancement",
};

/** Ordre d'affichage : la méthode par défaut du cœur en tête, puis les autres du schéma. */
const DISPLAY_ORDER: readonly BalancingMethod[] = ["M3", "M1", "M2", "M6", "M0"];

/**
 * Options du choix de méthode : toutes celles du schéma du cœur (une méthode ajoutée au
 * schéma sans libellé apparaît sous son identifiant).
 */
export function balancingMethodOptions(): readonly {
  readonly value: BalancingMethod;
  readonly label: string;
}[] {
  const schema = (enumOptions(fieldSchema(BalancingSchema, "method")) ?? []) as BalancingMethod[];
  const ordered = [
    ...DISPLAY_ORDER.filter((m) => schema.includes(m)),
    ...schema.filter((m) => !DISPLAY_ORDER.includes(m)),
  ];
  return ordered.map((m) => ({ value: m, label: BALANCING_METHOD_LABELS[m] ?? m }));
}

/** Curseur borné : bornes incluses, pas, valeur affichée et origine de la borne haute. */
export interface SliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Valeur du curseur (celle du projet, ou la valeur par défaut du cœur si absente). */
  readonly value: number;
  /** Le projet ne fixe pas la valeur : défaut du cœur (à valider). */
  readonly isDefault: boolean;
}

/** Pas des curseurs d'angle (degrés) et des paramètres λ / p : présentation seulement. */
export const ANGLE_STEP = 0.5;
export const ROTATION_STEP = 0.1;

const roundTo = (v: number, step: number): number => Math.round(v / step) * step;
/** Plus grand multiple du pas **strictement** inférieur à `bound`. */
const below = (bound: number, step: number): number =>
  Math.round((Math.ceil(bound / step - 1e-9) - 1) * step * 1e6) / 1e6;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Bornes de schéma d'un champ numérique facultatif de `BalancingSchema`. */
function schemaBounds(key: string): { min: number; max: number } {
  const c = numberConstraints(fieldSchema(BalancingSchema, key));
  return { min: c.min ?? 0, max: c.max ?? Number.POSITIVE_INFINITY };
}

/**
 * Borne haute α_max (degrés) rendue par le découpage pour M2 : la plus petite des zones
 * retenues (un seul curseur pour tout l'escalier), `null` si aucune zone M2 n'en porte (autre
 * méthode, modèle absent, ou aucune zone retenue parce que α dépasse la borne de toutes).
 */
export function herseAlphaMaxOf(model: Pick<Model, "stepping"> | null | undefined): number | null {
  const bounds = (model?.stepping.balancedZones ?? [])
    .map((z) => z.herseAlphaMax)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  return bounds.length > 0 ? Math.min(...bounds) : null;
}

/**
 * Curseur de l'angle α de la herse (M2) : ]0 ; α_max[ où α_max est la borne rendue par le
 * modèle, à défaut la borne du schéma (]0 ; 90[). Bornes ouvertes : le curseur s'arrête un pas
 * avant.
 */
export function herseAngleRange(
  balancing: Project["stair"]["balancing"],
  model: Pick<Model, "stepping"> | null | undefined,
): SliderRange & { readonly modelBound: number | null } {
  const schema = schemaBounds("herseAngle");
  const modelBound = herseAlphaMaxOf(model);
  const bound = Math.min(schema.max, modelBound ?? Number.POSITIVE_INFINITY);
  const min = Math.max(ANGLE_STEP, roundTo(schema.min + ANGLE_STEP, ANGLE_STEP));
  const max = Math.max(min, below(bound, ANGLE_STEP));
  const raw = balancing.herseAngle ?? HERSE_DEFAULT_ANGLE;
  return {
    min,
    max,
    step: ANGLE_STEP,
    value: clamp(raw, min, max),
    isDefault: balancing.herseAngle === undefined,
    modelBound,
  };
}

/** Curseurs de M6 : portée λ (girons) et raideur p, bornes du schéma du cœur. */
export function rotationRanges(balancing: Project["stair"]["balancing"]): {
  readonly reach: SliderRange;
  readonly steepness: SliderRange;
} {
  const range = (
    key: "rotationReach" | "rotationSteepness",
    dflt: number,
    current: number | undefined,
  ): SliderRange => {
    const b = schemaBounds(key);
    const min = Math.max(ROTATION_STEP, roundTo(b.min, ROTATION_STEP));
    const max = Number.isFinite(b.max) ? b.max : 10 * dflt;
    return {
      min,
      max,
      step: ROTATION_STEP,
      value: clamp(current ?? dflt, min, max),
      isDefault: current === undefined,
    };
  };
  return {
    reach: range("rotationReach", ROTATION_DEFAULT_REACH, balancing.rotationReach),
    steepness: range("rotationSteepness", ROTATION_DEFAULT_STEEPNESS, balancing.rotationSteepness),
  };
}
