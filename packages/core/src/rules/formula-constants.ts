/**
 * Constantes qui n'apparaissent que dans le champ documentaire `formule` de rules.yaml (pas dans
 * `min` / `max`). Elles sont regroupées ici, chacune rattachée à sa règle et à l'extrait de formule
 * qui la contient : un test vérifie que l'extrait figure toujours dans la formule, pour détecter
 * toute modification de rules.yaml.
 *
 * À terme, ces valeurs devraient devenir des champs structurés de rules.yaml (voir LEDGER).
 */
export interface FormulaConstant {
  readonly ruleId: string;
  /** Extrait littéral de la formule qui porte la valeur. */
  readonly excerpt: string;
  readonly value: number;
}

/** Emmarchement au-delà duquel la ligne de foulée (ou de mesure) passe à 600 mm du bord intérieur. */
export const LF_WIDE_THRESHOLD: FormulaConstant = {
  ruleId: "LF_POSITION_DTU_ETROIT",
  excerpt: "E <= 1200",
  value: 1200,
};

/** Recouvrement minimal sans contremarche (industriel) ; `min` de la règle = cas avec contremarche. */
export const INDUSTRIAL_OVERLAP_OPEN: FormulaConstant = {
  ruleId: "RECOUVREMENT_INDUSTRIEL",
  excerpt: "sans_contremarche ? 50",
  value: 50,
};

export const FORMULA_CONSTANTS: readonly FormulaConstant[] = [
  LF_WIDE_THRESHOLD,
  { ruleId: "LF_POSITION_DTU_LARGE", excerpt: "E > 1200", value: 1200 },
  { ruleId: "LF_POSITION_ACCESSIBILITE", excerpt: "E > 1200", value: 1200 },
  INDUSTRIAL_OVERLAP_OPEN,
];
