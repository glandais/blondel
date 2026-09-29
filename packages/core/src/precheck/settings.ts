/**
 * Réglages du prédimensionnement indicatif (CHALLENGE P5) : jeu de charges, catégorie d'usage,
 * coefficients partiels, matériaux.
 *
 * Provenance (`PRECHECK_PROVENANCE`) :
 * - charges d'exploitation : NF EN 1991-1-1/NA tableau 6.2(NF) (A §3.6, rules.yaml
 *   `CHARGE_ESCALIER_A` / `CHARGE_ESCALIER_AUTRES`, confiance élevée) ; valeurs par défaut de la
 *   NF EN 16481 § 4.2 (3 kN/m², 2 kN) conservées avec leur provenance, l'AN prime (SPEC X16) ;
 * - masse de vibration M_k,2 = 1 kN et critères L/200, f₁ ≥ 5 Hz : NF EN 16481 § 4.2, 6.2, 6.3
 *   (C §1.2, §1.3, confiance élevée) ; L/300 : usage résidentiel (C §1.3 [52], faible) ;
 * - acier : E = 210 000 MPa (valeur du calcul indicatif de C §2.3), f_y = 235 / 355 MPa
 *   (désignation de la nuance, EN 10025-2 non lue) ;
 * - **à valider** (aucune source dans docs/research : EN 1990, EC3 / EC5 et leurs AN, EN 338 non
 *   lus) : γ_G = 1,35, γ_Q = 1,5, γ_M0 = 1,0, γ_M bois = 1,3, k_mod = 0,8, classes de bois C24
 *   (E = 11 000 MPa, f_m,k = 24 MPa) et f_m,k des C30 / D40, part de la charge ponctuelle et de
 *   la masse de vibration reprise par un limon (1 : tout sur un limon, sécuritaire).
 */
import { z } from "zod";
import type { SteelGrade } from "../workshop/metal.js";

export const LOAD_CATEGORIES = ["A", "B", "C1", "C2", "C3", "C4", "C5", "D1", "D2"] as const;
export type LoadCategory = (typeof LOAD_CATEGORIES)[number];

export const WOOD_CLASSES = ["C24", "C30", "D40"] as const;
export type WoodClass = (typeof WOOD_CLASSES)[number];

export const PrecheckSettingsSchema = z.object({
  /** `AN` : annexe nationale française (prime, SPEC X16) ; `EN16481` : défauts de la norme. */
  loadSet: z.enum(["AN", "EN16481"]).default("AN"),
  /**
   * Catégorie d'usage (tableau 6.2(NF)) ; `auto` : A en logement, D1 en ERP (catégorie non
   * spécifiée ⇒ D1, A §3.6).
   */
  category: z.union([z.enum(LOAD_CATEGORIES), z.literal("auto")]).default("auto"),
  /** Charge permanente supplémentaire (revêtement, finitions), kN/m² en plan. */
  extraPermanent: z.number().nonnegative().default(0),
  /** Part de la charge ponctuelle Q_k et de la masse M_k,2 reprise par un limon (à valider). */
  pointLoadShare: z.number().min(0).max(1).default(1),
  /** Coefficients partiels ELU (à valider : EN 1990 non lue). */
  gammaG: z.number().positive().default(1.35),
  gammaQ: z.number().positive().default(1.5),
  /** Acier : γ_M0 (à valider : AN de l'EC3 non lue). */
  gammaM0: z.number().positive().default(1),
  /** Bois : γ_M et k_mod (à valider : EC5 et son AN non lus). */
  gammaMWood: z.number().positive().default(1.3),
  kmod: z.number().positive().max(1.1).default(0.8),
  /** Classe de résistance des limons bois (à valider : EN 338 non lue). */
  woodClass: z.enum(WOOD_CLASSES).default("C24"),
});
export type PrecheckSettings = z.output<typeof PrecheckSettingsSchema>;

export const DEFAULT_PRECHECK_SETTINGS: PrecheckSettings = PrecheckSettingsSchema.parse({});

export interface PrecheckProvenance {
  readonly status: "source" | "a-valider";
  readonly note: string;
}

export const PRECHECK_PROVENANCE: Readonly<Record<keyof PrecheckSettings, PrecheckProvenance>> = {
  loadSet: { status: "source", note: "SPEC X16 : l'AN prime ; EN 16481 § 4.2 conservée." },
  category: { status: "source", note: "Tableau 6.2(NF), A §3.6 ; catégorie inconnue ⇒ D1." },
  extraPermanent: { status: "a-valider", note: "Charge de finition saisie par l'utilisateur." },
  pointLoadShare: {
    status: "a-valider",
    note: "Répartition de Q_k entre limons non sourcée : 1 (tout sur un limon, sécuritaire).",
  },
  gammaG: { status: "a-valider", note: "1,35 : EN 1990 non lue." },
  gammaQ: { status: "a-valider", note: "1,5 : EN 1990 non lue." },
  gammaM0: { status: "a-valider", note: "1,0 : EC3 et son AN non lus." },
  gammaMWood: { status: "a-valider", note: "1,3 : EC5 et son AN non lus." },
  kmod: { status: "a-valider", note: "0,8 : EC5 non lu (classe de service et durée supposées)." },
  woodClass: { status: "a-valider", note: "C24 par défaut ; EN 338 non lue." },
};

/** Matériau d'une poutre : module, résistance de calcul, masse volumique. */
export interface BeamMaterial {
  readonly kind: "steel" | "wood";
  readonly label: string;
  /** Module d'élasticité (moyen pour le bois), MPa. */
  readonly e: number;
  /** Résistance caractéristique en flexion (f_y acier, f_m,k bois), MPa. */
  readonly strength: number;
  /** Résistance de calcul, MPa. */
  readonly design: number;
  /** Masse volumique, kg/m³. */
  readonly density: number;
}

/** Module d'élasticité de l'acier (MPa), valeur du calcul indicatif de C §2.3. */
export const STEEL_E = 210_000;

/** Limite d'élasticité nominale de la nuance (MPa) : S235 → 235, S355 → 355. */
export function steelYield(grade: SteelGrade): number {
  return grade === "S355" ? 355 : 235;
}

/**
 * Propriétés des classes de bois : E de C30 et D40 sourcés (exemple FCBA du DTU 36.3, C §1.4 [1]),
 * tout le reste **à valider** (EN 338 non lue).
 */
export const WOOD_CLASS_PROPERTIES: Readonly<
  Record<WoodClass, { readonly e: number; readonly fmk: number; readonly sourced: string }>
> = {
  C24: { e: 11_000, fmk: 24, sourced: "E et f_m,k à valider (EN 338 non lue)" },
  C30: { e: 12_000, fmk: 30, sourced: "E : C §1.4 [1] ; f_m,k à valider" },
  D40: { e: 13_000, fmk: 40, sourced: "E : C §1.4 [1] ; f_m,k à valider" },
};

export function steelMaterialOf(
  grade: SteelGrade,
  settings: PrecheckSettings,
  density: number,
): BeamMaterial {
  const fy = steelYield(grade);
  return {
    kind: "steel",
    label: grade,
    e: STEEL_E,
    strength: fy,
    design: fy / settings.gammaM0,
    density,
  };
}

export function woodMaterialOf(settings: PrecheckSettings, density: number): BeamMaterial {
  const c = WOOD_CLASS_PROPERTIES[settings.woodClass];
  return {
    kind: "wood",
    label: settings.woodClass,
    e: c.e,
    strength: c.fmk,
    design: (settings.kmod * c.fmk) / settings.gammaMWood,
    density,
  };
}
