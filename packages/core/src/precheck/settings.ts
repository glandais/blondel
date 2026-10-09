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
 *   la masse de vibration reprise par un limon (1 : tout sur un limon, sécuritaire) ;
 * - lamellé-collé (QUESTIONS A33 (a), 2026-10-09) : classes GL24h / GL28h / GL32h (E_0,g,mean,
 *   f_m,g,k de la NF EN 14080) et γ_M = 1,25 (EN 1995-1-1 § 2.4.1), rapportés par C §1.11 [71]
 *   (normes non lues, confiance moyenne, **à valider**) ; classe `auto` : GL24h pour l'essence
 *   lamellé-collé, C24 sinon ;
 * - lamellé-collé d'une essence feuillue (QUESTIONS A35 (k), 2026-10-09) : classe `auto` = classe
 *   massive de l'essence, D40 pour le chêne, le hêtre et le frêne (`GLULAM_SPECIES_WOOD_CLASS`),
 *   même hypothèse que la classe FCBA `auto` de `wood-central` ; **à valider** : le classement
 *   visuel du chêne donne au plus D30 (NF B 52-001-1 non lue, via FNB fiche C10, C §1.11 [82]),
 *   et E_0,mean de D40 vaut 11 000 MPa d'après [83] contre 13 000 ici (QUESTIONS A36).
 */
import { msg, type Message } from "@blondel/i18n";
import { z } from "zod";
import type { SteelGrade } from "../workshop/metal.js";

export const LOAD_CATEGORIES = ["A", "B", "C1", "C2", "C3", "C4", "C5", "D1", "D2"] as const;
export type LoadCategory = (typeof LOAD_CATEGORIES)[number];

/**
 * Classes de résistance du bois : massif (EN 338 non lue) et lamellé-collé homogène GL24h,
 * GL28h, GL32h (NF EN 14080 non lue, valeurs rapportées par C §1.11 [71], QUESTIONS A33 (a)).
 */
export const WOOD_CLASSES = ["C24", "C30", "D40", "GL24h", "GL28h", "GL32h"] as const;
export type WoodClass = (typeof WOOD_CLASSES)[number];

/** Classes de lamellé-collé (γ_M du lamellé-collé, `gammaMGlulam`). */
export const GLULAM_WOOD_CLASSES: readonly WoodClass[] = ["GL24h", "GL28h", "GL32h"];

/**
 * Réglage de la classe : une classe, ou `auto` = GL24h pour l'essence lamellé-collé
 * (`wood-glulam`, plus basse classe GL sourcée), classe massive de l'essence pour un
 * lamellé-collé feuillu (option `glulam` de `resolveWoodClass`, QUESTIONS A35 (k)), C24 sinon
 * (défaut historique) ; à valider.
 */
export const WOOD_CLASS_SETTINGS = [...WOOD_CLASSES, "auto"] as const;
export type WoodClassSetting = (typeof WOOD_CLASS_SETTINGS)[number];

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
  /**
   * Bois lamellé-collé (classes GL) : γ_M = 1,25 (EN 1995-1-1 § 2.4.1 via C §1.11 [71], valeur
   * recommandée ; annexe nationale non lue, à valider).
   */
  gammaMGlulam: z.number().positive().default(1.25),
  /**
   * Classe de résistance des limons bois ; `auto` : GL24h pour l'essence lamellé-collé, C24
   * sinon (à valider : EN 338 non lue ; classes GL : NF EN 14080 via C §1.11 [71]).
   */
  woodClass: z.enum(WOOD_CLASS_SETTINGS).default("auto"),
});
export type PrecheckSettings = z.output<typeof PrecheckSettingsSchema>;

export const DEFAULT_PRECHECK_SETTINGS: PrecheckSettings = PrecheckSettingsSchema.parse({});

export interface PrecheckProvenance {
  readonly status: "source" | "a-valider";
  readonly note: Message;
}

export const PRECHECK_PROVENANCE: Readonly<Record<keyof PrecheckSettings, PrecheckProvenance>> = {
  loadSet: { status: "source", note: msg("precheck.provenance.loadSet") },
  category: { status: "source", note: msg("precheck.provenance.category") },
  extraPermanent: { status: "a-valider", note: msg("precheck.provenance.extraPermanent") },
  pointLoadShare: {
    status: "a-valider",
    note: msg("precheck.provenance.pointLoadShare"),
  },
  gammaG: { status: "a-valider", note: msg("precheck.provenance.gammaG") },
  gammaQ: { status: "a-valider", note: msg("precheck.provenance.gammaQ") },
  gammaM0: { status: "a-valider", note: msg("precheck.provenance.gammaM0") },
  gammaMWood: { status: "a-valider", note: msg("precheck.provenance.gammaMWood") },
  kmod: { status: "a-valider", note: msg("precheck.provenance.kmod") },
  gammaMGlulam: { status: "a-valider", note: msg("precheck.provenance.gammaMGlulam") },
  woodClass: { status: "a-valider", note: msg("precheck.provenance.woodClassAuto") },
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
 * le reste des classes massives **à valider** (EN 338 non lue) ; classes GL : E_0,g,mean et
 * f_m,g,k de la NF EN 14080 rapportés par C §1.11 [71] (norme non lue, confiance moyenne).
 */
export const WOOD_CLASS_PROPERTIES: Readonly<
  Record<WoodClass, { readonly e: number; readonly fmk: number; readonly sourced: Message }>
> = {
  C24: { e: 11_000, fmk: 24, sourced: msg("precheck.woodClass.C24") },
  C30: { e: 12_000, fmk: 30, sourced: msg("precheck.woodClass.C30") },
  D40: { e: 13_000, fmk: 40, sourced: msg("precheck.woodClass.D40") },
  GL24h: { e: 11_500, fmk: 24, sourced: msg("precheck.woodClass.GL24h") },
  GL28h: { e: 12_600, fmk: 28, sourced: msg("precheck.woodClass.GL28h") },
  GL32h: { e: 14_200, fmk: 32, sourced: msg("precheck.woodClass.GL32h") },
};

/**
 * Classe massive retenue pour le lamellé-collé d'une essence feuillue (classe `auto`,
 * QUESTIONS A35 (k), décision du 2026-10-09) : D40 pour le chêne, le hêtre et le frêne, même
 * hypothèse que la classe FCBA `auto` de `wood-central` (`strengthClass`). **À valider** : le
 * classement visuel du chêne donne D30 / D24 / D18, jamais D40 (NF B 52-001-1 non lue, via
 * C §1.11 [82]) ; aucune classe de lamellé-collé feuillu sourcée (QUESTIONS A36).
 */
export const GLULAM_SPECIES_WOOD_CLASS: Readonly<Partial<Record<string, WoodClass>>> = {
  "wood-oak": "D40",
  "wood-beech": "D40",
  "wood-ash": "D40",
};

/** Options de la classe `auto`. */
export interface WoodClassOptions {
  /**
   * La pièce est un lamellé-collé de l'essence `material` (poutre de `wood-central` en couches
   * collées) : feuillu → classe massive de l'essence (`GLULAM_SPECIES_WOOD_CLASS`).
   */
  readonly glulam?: boolean;
  /**
   * Classe de résistance imposée à la pièce par son plugin (`wood-central.strengthClass` saisi,
   * lecture du tableau FCBA) : avec `glulam`, elle remplace la classe massive par défaut d'une
   * essence feuillue, pour que prédimensionnement et lecture FCBA gardent la même hypothèse.
   */
  readonly strengthClass?: WoodClass;
}

/**
 * Classe retenue : celle du réglage, ou `auto` → GL24h pour l'essence lamellé-collé
 * (`wood-glulam`) ; avec `options.glulam`, classe massive d'une essence feuillue (D40,
 * `GLULAM_SPECIES_WOOD_CLASS`, à valider) ; C24 sinon (et sans essence connue).
 */
export function resolveWoodClass(
  settings: PrecheckSettings,
  material?: string,
  options?: WoodClassOptions,
): WoodClass {
  if (settings.woodClass !== "auto") return settings.woodClass;
  if (material === "wood-glulam") return "GL24h";
  const species =
    options?.glulam && material !== undefined ? GLULAM_SPECIES_WOOD_CLASS[material] : undefined;
  if (species === undefined) return "C24";
  return options?.strengthClass ?? species;
}

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

/**
 * Matériau bois d'une poutre : classe retenue (`resolveWoodClass`, `material` = essence de la
 * pièce pour `auto`, `options` transmises), γ_M du lamellé-collé pour une classe GL, du bois
 * massif sinon (D40 d'un lamellé-collé feuillu compris : classe massive).
 */
export function woodMaterialOf(
  settings: PrecheckSettings,
  density: number,
  material?: string,
  options?: WoodClassOptions,
): BeamMaterial {
  const cls = resolveWoodClass(settings, material, options);
  const c = WOOD_CLASS_PROPERTIES[cls];
  const gammaM = GLULAM_WOOD_CLASSES.includes(cls) ? settings.gammaMGlulam : settings.gammaMWood;
  return {
    kind: "wood",
    label: cls,
    e: c.e,
    strength: c.fmk,
    design: (settings.kmod * c.fmk) / gammaM,
    density,
  };
}
