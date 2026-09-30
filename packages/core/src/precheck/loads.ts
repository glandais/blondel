/**
 * Charges d'exploitation des escaliers pour le prédimensionnement (CHALLENGE P5, SPEC X16).
 *
 * - AN française (NF EN 1991-1-1/NA, tableau 6.2(NF), A §3.6, texte primaire lu) : catégorie A
 *   escaliers q_k = 2,5 kN/m², Q_k = 2,0 kN ; B 2,5 / 4 ; C1 2,5 / 3 ; C2 4 / 4 ; C3 4 / 4 ;
 *   C4 5 / 7 ; C5 5 / 4,5 ; D1 5 / 5 ; D2 5 / 7. Valeurs lues dans les champs structurés de
 *   rules.yaml (`CHARGE_ESCALIER_A.parametres`, `CHARGE_ESCALIER_AUTRES.tables.categories`).
 * - NF EN 16481 § 4.2 (C §1.2) : valeurs par défaut sans valeur nationale q_k = 3 kN/m²,
 *   Q_k = 2 kN, masse de vibration M_k,2 = 1 kN.
 */
import { findRule, numberCell, ruleParam, ruleTable } from "../rules/table.js";
import { LOAD_CATEGORIES, type LoadCategory, type PrecheckSettings } from "./settings.js";

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

/**
 * Tableau 6.2(NF) (A §3.6) : q_k (kN/m²), Q_k (kN), lu dans rules.yaml : catégorie A dans
 * `CHARGE_ESCALIER_A.parametres` (`qk`, `Qk`), autres catégories dans
 * `CHARGE_ESCALIER_AUTRES.tables.categories`.
 */
export const AN_STAIR_LOADS: Readonly<Record<LoadCategory, readonly [number, number]>> =
  anStairLoads();

function anStairLoads(): Record<LoadCategory, readonly [number, number]> {
  const out: Partial<Record<string, readonly [number, number]>> = {
    A: [ruleParam("CHARGE_ESCALIER_A", "qk"), ruleParam("CHARGE_ESCALIER_A", "Qk")],
  };
  for (const row of ruleTable("CHARGE_ESCALIER_AUTRES", "categories")) {
    const c = row["categorie"];
    if (typeof c === "string") out[c] = [numberCell(row, "qk"), numberCell(row, "Qk")];
  }
  const missing = LOAD_CATEGORIES.filter((c) => out[c] === undefined);
  if (missing.length > 0)
    throw new Error(`Charges d'exploitation absentes de rules.yaml : ${missing.join(", ")}.`);
  return out as Record<LoadCategory, readonly [number, number]>;
}

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
  return {
    qk: q,
    Qk: Q,
    vibrationMass: EN16481_DEFAULT_LOADS.vibrationMass,
    category,
    source: `NF EN 1991-1-1/NA tableau 6.2(NF), catégorie ${category} (A §3.6, rules.yaml CHARGE_ESCALIER_${category === "A" ? "A" : "AUTRES"})`,
  };
}
