/**
 * Jauge du module 2h + g de l'étape « Découpage » du parcours guidé (maquette 1a, spécification
 * de contenu § 2, étape 3 : « 2h + g sur la jauge 60–64 cm »).
 *
 * Présentation seulement, aucun seuil écrit ici :
 *
 * - la valeur est celle du modèle (`model.stepping.blondel`, mm, calculée par le cœur) ;
 * - la zone de confort est celle de la règle `BLONDEL_CONFORT` de la table (`rules.yaml`,
 *   lue par `findRule`) ;
 * - l'échelle affichée prolonge la zone de sa propre largeur de part et d'autre
 *   (`[min − (max − min), max + (max − min)]`, soit 56–68 cm avec la table actuelle) : c'est un
 *   choix de dessin, pas une borne métier ;
 * - le statut est lu dans le résultat de la règle du rapport de contrôle : la valeur n'est jamais
 *   comparée ici aux bornes.
 */
import { findRule, type Model } from "@blondel/core";

/** Règle qui porte la zone de confort du module. */
export const BLONDEL_GAUGE_RULE = "BLONDEL_CONFORT";

/** Statut lu dans le rapport : confortable, hors zone, ou non évalué. */
export type BlondelGaugeStatus = "comfortable" | "outside" | "unknown";

export interface BlondelGauge {
  /** Module 2h + g (mm). */
  readonly value: number;
  /** Zone de confort (mm), bornes de la règle. */
  readonly zone: { readonly min: number; readonly max: number };
  /** Échelle d'affichage (mm). */
  readonly scale: { readonly min: number; readonly max: number };
  /** Positions relatives 0..1 sur l'échelle (bornées). */
  readonly position: {
    readonly zoneStart: number;
    readonly zoneEnd: number;
    readonly value: number;
  };
  readonly status: BlondelGaugeStatus;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Statut de la règle dans le rapport : une violation l'emporte, puis un résultat conforme. */
function statusOf(compliance: Model["compliance"] | undefined): BlondelGaugeStatus {
  const results = compliance?.results.filter((r) => r.ruleId === BLONDEL_GAUGE_RULE) ?? [];
  if (results.some((r) => r.status === "violation")) return "outside";
  if (results.some((r) => r.status === "ok")) return "comfortable";
  return "unknown";
}

/**
 * Données de la jauge, ou `null` si une donnée manque (modèle absent, découpage non calculé,
 * règle absente de la table ou sans bornes).
 */
export function blondelGauge(
  model: Pick<Model, "stepping" | "compliance"> | null | undefined,
): BlondelGauge | null {
  const value = model?.stepping?.blondel;
  if (value === undefined || !Number.isFinite(value)) return null;
  const rule = findRule(BLONDEL_GAUGE_RULE);
  const min = rule?.min;
  const max = rule?.max;
  if (min === null || min === undefined || max === null || max === undefined || !(max > min)) {
    return null;
  }
  const width = max - min;
  const scale = { min: min - width, max: max + width };
  const at = (x: number): number => clamp01((x - scale.min) / (scale.max - scale.min));
  return {
    value,
    zone: { min, max },
    scale,
    position: { zoneStart: at(min), zoneEnd: at(max), value: at(value) },
    status: statusOf(model?.compliance),
  };
}
