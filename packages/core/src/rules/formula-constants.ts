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

/** Gabarit B (2024) : bas de la zone de recherche d'appuis, X ≥ 100 mm. */
export const GC_B_ZONE_MIN: FormulaConstant = {
  ruleId: "GC_GABARIT_B_2024",
  excerpt: "[100 ; 600[",
  value: 100,
};

/** Gabarit B (2024) : haut (exclu) de la zone de recherche d'appuis, X < 600 mm. */
export const GC_B_ZONE_MAX: FormulaConstant = {
  ruleId: "GC_GABARIT_B_2024",
  excerpt: "600[",
  value: 600,
};

/** Gabarit B (2024) : hauteur exigée H ≥ 1 000 + X au-dessus d'un appui à la hauteur X. */
export const GC_B_BASE: FormulaConstant = {
  ruleId: "GC_GABARIT_B_2024",
  excerpt: "1000 + X",
  value: 1000,
};

/** Limite haute du domaine du gabarit T1 (2024), début du domaine T2 : 800 mm. */
export const GC_T1_ZONE_TOP: FormulaConstant = {
  ruleId: "GC_GABARIT_T1_2024",
  excerpt: "[0 ; 800]",
  value: 800,
};

/** Dégagement main courante / mur hors logement individuel (le `min` de la règle = logement). */
export const MC_WALL_CLEARANCE_OTHER: FormulaConstant = {
  ruleId: "MC_DEGAGEMENT_MUR",
  excerpt: ": 50)",
  value: 50,
};

/** Largeur de 2 unités de passage (ERP) : main courante de chaque côté dès 2 UP (MC_UP_ERP). */
export const UP2_WIDTH: FormulaConstant = {
  ruleId: "LARGEUR_UP_ERP",
  excerpt: "n_UP == 2 ? 1400",
  value: 1400,
};

export const FORMULA_CONSTANTS: readonly FormulaConstant[] = [
  LF_WIDE_THRESHOLD,
  { ruleId: "LF_POSITION_DTU_LARGE", excerpt: "E > 1200", value: 1200 },
  { ruleId: "LF_POSITION_ACCESSIBILITE", excerpt: "E > 1200", value: 1200 },
  INDUSTRIAL_OVERLAP_OPEN,
  GC_B_ZONE_MIN,
  GC_B_ZONE_MAX,
  GC_B_BASE,
  GC_T1_ZONE_TOP,
  { ruleId: "GC_GABARIT_T2_2024", excerpt: "[800 ; H]", value: 800 },
  MC_WALL_CLEARANCE_OTHER,
  UP2_WIDTH,
];

/**
 * Constantes lues dans le champ `description` de rules.yaml (tables sans champ structuré) ;
 * un test vérifie que l'extrait figure toujours dans la description.
 */
export const DESCRIPTION_CONSTANTS: readonly FormulaConstant[] = [
  /** Charge horizontale sur garde-corps, catégorie A (habitation), kN/m. */
  { ruleId: "CHARGE_GC_HORIZONTALE", excerpt: "A 0,6", value: 0.6 },
  /** Catégories C1 à C4 (lieux de réunion), kN/m (SPEC X4). */
  { ruleId: "CHARGE_GC_HORIZONTALE", excerpt: "C1-C4 1,0", value: 1.0 },
];

export const GC_LOAD_HOUSING = DESCRIPTION_CONSTANTS[0]!;
export const GC_LOAD_PUBLIC = DESCRIPTION_CONSTANTS[1]!;
