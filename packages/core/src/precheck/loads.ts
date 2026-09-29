/**
 * Charges d'exploitation des escaliers pour le prédimensionnement (CHALLENGE P5, SPEC X16).
 *
 * - AN française (NF EN 1991-1-1/NA, tableau 6.2(NF), A §3.6, texte primaire lu) : catégorie A
 *   escaliers q_k = 2,5 kN/m², Q_k = 2,0 kN ; B 2,5 / 4 ; C1 2,5 / 3 ; C2 4 / 4 ; C3 4 / 4 ;
 *   C4 5 / 7 ; C5 5 / 4,5 ; D1 5 / 5 ; D2 5 / 7. q_k de la catégorie A est lu dans rules.yaml
 *   (`CHARGE_ESCALIER_A.min`) ; les autres valeurs viennent de la même table (A §3.6,
 *   `CHARGE_ESCALIER_AUTRES`, dont rules.yaml ne porte que les bornes).
 * - NF EN 16481 § 4.2 (C §1.2) : valeurs par défaut sans valeur nationale q_k = 3 kN/m²,
 *   Q_k = 2 kN, masse de vibration M_k,2 = 1 kN.
 */
import { findRule } from "../rules/table.js";
import type { LoadCategory, PrecheckSettings } from "./settings.js";

export interface StairLoads {
  /** Charge répartie, kN/m² (en plan). */
  readonly qk: number;
  /** Charge concentrée, kN. */
  readonly Qk: number;
  /** Masse de vibration (poids), kN. */
  readonly vibrationMass: number;
  readonly category: LoadCategory;
  readonly source: string;
}

/** Tableau 6.2(NF) (A §3.6) : q_k (kN/m²), Q_k (kN). */
export const AN_STAIR_LOADS: Readonly<Record<LoadCategory, readonly [number, number]>> = {
  A: [2.5, 2.0],
  B: [2.5, 4.0],
  C1: [2.5, 3.0],
  C2: [4.0, 4.0],
  C3: [4.0, 4.0],
  C4: [5.0, 7.0],
  C5: [5.0, 4.5],
  D1: [5.0, 5.0],
  D2: [5.0, 7.0],
};

/** NF EN 16481 § 4.2 (C §1.2) : q_k,1, Q_k,1, M_k,2. */
export const EN16481_DEFAULT_LOADS = { qk: 3, Qk: 2, vibrationMass: 1 } as const;

/** Contextes d'habitation de la catégorie A (rules.yaml `CHARGE_ESCALIER_A.contexte`). */
function residentialContexts(): readonly string[] {
  return findRule("CHARGE_ESCALIER_A")?.contexte ?? ["logement_interieur", "bhc_parties_communes"];
}

/**
 * Catégorie retenue pour `auto` : D1 si un contexte ERP est actif ; A si un contexte
 * d'habitation l'est (contextes de `CHARGE_ESCALIER_A`) ; sinon D1, car « si la catégorie n'est
 * pas spécifiée, on prend D1 » (tableau 6.2(NF), A §3.6).
 */
export function resolveCategory(
  settings: PrecheckSettings,
  contexts: readonly string[],
): LoadCategory {
  if (settings.category !== "auto") return settings.category;
  if (contexts.some((c) => c.startsWith("erp"))) return "D1";
  const residential = residentialContexts();
  return contexts.some((c) => residential.includes(c)) ? "A" : "D1";
}

export function stairLoads(settings: PrecheckSettings, contexts: readonly string[]): StairLoads {
  const category = resolveCategory(settings, contexts);
  if (settings.loadSet === "EN16481") {
    return {
      ...EN16481_DEFAULT_LOADS,
      category,
      source: "NF EN 16481 § 4.2, valeurs par défaut (C §1.2)",
    };
  }
  const [q, Q] = AN_STAIR_LOADS[category];
  const qA = findRule("CHARGE_ESCALIER_A")?.min;
  return {
    qk: category === "A" && typeof qA === "number" ? qA : q,
    Qk: Q,
    vibrationMass: EN16481_DEFAULT_LOADS.vibrationMass,
    category,
    source: `NF EN 1991-1-1/NA tableau 6.2(NF), catégorie ${category} (A §3.6, rules.yaml CHARGE_ESCALIER_${category === "A" ? "A" : "AUTRES"})`,
  };
}
