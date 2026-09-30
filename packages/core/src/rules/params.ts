/**
 * Constantes nommées lues dans les champs structurés `parametres` / `tables` de rules.yaml
 * (ADR-0004). Aucune valeur n'est écrite ici : ce module nomme seulement les lectures
 * partagées par plusieurs modules (évaluateurs, tracé, garde-corps). Il remplace
 * `rules/formula-constants.ts`, qui extrayait ces valeurs des champs documentaires `formule` /
 * `description` (LEDGER l. 51, l. 163).
 *
 * Une table incohérente (paramètre absent) lève une erreur au chargement : `table.test.ts` et
 * `params.test.ts` la détectent.
 */
import { numberCell, ruleParam, ruleTable } from "./table.js";

export interface RuleConstant {
  readonly ruleId: string;
  /** Nom du paramètre (`parametres.<param>`) ou de la ligne de table. */
  readonly param: string;
  readonly value: number;
}

function param(ruleId: string, name: string): RuleConstant {
  return { ruleId, param: name, value: ruleParam(ruleId, name) };
}

/** Emmarchement au-delà duquel la ligne de foulée (ou de mesure) passe à 600 mm du bord intérieur. */
export const LF_WIDE_THRESHOLD: RuleConstant = param("LF_POSITION_DTU_ETROIT", "E_seuil");

/** Recouvrement minimal sans contremarche (industriel) ; `min` de la règle = cas avec contremarche. */
export const INDUSTRIAL_OVERLAP_OPEN: RuleConstant = param(
  "RECOUVREMENT_INDUSTRIEL",
  "min_sans_contremarche",
);

/** Gabarit B (2024) : bas de la zone de recherche d'appuis, X ≥ 100 mm. */
export const GC_B_ZONE_MIN: RuleConstant = param("GC_GABARIT_B_2024", "X_min");

/** Gabarit B (2024) : haut (exclu) de la zone de recherche d'appuis, X < 600 mm. */
export const GC_B_ZONE_MAX: RuleConstant = param("GC_GABARIT_B_2024", "X_max");

/** Gabarit B (2024) : hauteur exigée H ≥ 1 000 + X au-dessus d'un appui à la hauteur X. */
export const GC_B_BASE: RuleConstant = param("GC_GABARIT_B_2024", "H_base");

/** Limite haute du domaine du gabarit T1 (2024) : 800 mm. */
export const GC_T1_ZONE_TOP: RuleConstant = param("GC_GABARIT_T1_2024", "z_haut");

/** Limite basse du domaine du gabarit T2 (2024) : 800 mm. */
export const GC_T2_ZONE_BOTTOM: RuleConstant = param("GC_GABARIT_T2_2024", "z_bas");

/** Dégagement main courante / mur hors logement individuel (le `min` de la règle = logement). */
export const MC_WALL_CLEARANCE_OTHER: RuleConstant = param(
  "MC_DEGAGEMENT_MUR",
  "min_hors_logement",
);

/** Largeur d'1 unité de passage (ERP, CO 36). */
export const UP1_WIDTH: RuleConstant = param("LARGEUR_UP_ERP", "largeur_1UP");

/** Largeur de 2 unités de passage (ERP) : main courante de chaque côté dès 2 UP (MC_UP_ERP). */
export const UP2_WIDTH: RuleConstant = param("LARGEUR_UP_ERP", "largeur_2UP");

/** Largeur par unité de passage à partir de 3 UP (ERP, CO 36 : n × 600 mm). */
export const UP_WIDTH_PER_UNIT: RuleConstant = param("LARGEUR_UP_ERP", "largeur_par_UP");

/**
 * Diamètre maximal du fût central (mm) d'un hélicoïdal en ERP neuf pour lequel une seule main
 * courante est admise (exception de MC_DEUX_COTES, arrêté du 20/04/2017 art. 7-1).
 */
export const MC_CORE_DIAMETER_MAX: RuleConstant = param("MC_DEUX_COTES", "D_fut_max");

/** Seuil d'emmarchement des règles de moyens des limons bois (LIMON_EPAISSEUR_MIN_DTU). */
export const STRINGER_RULES_MAX_WIDTH: RuleConstant = param("LIMON_EPAISSEUR_MIN_DTU", "E_max");

/** Charge horizontale linéique sur garde-corps d'une catégorie (kN/m), CHARGE_GC_HORIZONTALE. */
function guardLoad(category: string): RuleConstant {
  const row = ruleTable("CHARGE_GC_HORIZONTALE", "categories").find(
    (r) => r["categorie"] === category,
  );
  if (!row) throw new Error(`CHARGE_GC_HORIZONTALE : catégorie ${category} absente.`);
  return { ruleId: "CHARGE_GC_HORIZONTALE", param: category, value: numberCell(row, "qk") };
}

/** Charge horizontale sur garde-corps, catégorie A (habitation), kN/m. */
export const GC_LOAD_HOUSING: RuleConstant = guardLoad("A");
/** Catégories C1 à C4 (lieux de réunion), kN/m (SPEC X4). */
export const GC_LOAD_PUBLIC: RuleConstant = guardLoad("C1-C4");

/**
 * Largeur exigée pour n unités de passage (CO 36) : 1 UP = 900, 2 UP = 1 400, n ≥ 3 : n × 600.
 */
export function upWidth(n: number): number {
  if (n <= 1) return UP1_WIDTH.value;
  if (n === 2) return UP2_WIDTH.value;
  return n * UP_WIDTH_PER_UNIT.value;
}

/** Nombre d'unités de passage offertes par une largeur (0 sous 1 UP). */
export function upCount(width: number, eps = 1e-6): number {
  if (width + eps < UP1_WIDTH.value) return 0;
  if (width + eps < UP2_WIDTH.value) return 1;
  // n ≥ 2 : plus grand n tel que largeur(n) ≤ width.
  let n = 2;
  while (upWidth(n + 1) <= width + eps) n++;
  return n;
}

/** Toutes les constantes nommées (tests de cohérence). */
export const RULE_CONSTANTS: readonly RuleConstant[] = [
  LF_WIDE_THRESHOLD,
  INDUSTRIAL_OVERLAP_OPEN,
  GC_B_ZONE_MIN,
  GC_B_ZONE_MAX,
  GC_B_BASE,
  GC_T1_ZONE_TOP,
  GC_T2_ZONE_BOTTOM,
  MC_WALL_CLEARANCE_OTHER,
  UP1_WIDTH,
  UP2_WIDTH,
  UP_WIDTH_PER_UNIT,
  MC_CORE_DIAMETER_MAX,
  STRINGER_RULES_MAX_WIDTH,
  GC_LOAD_HOUSING,
  GC_LOAD_PUBLIC,
];
