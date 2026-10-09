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
 * - **à valider** (aucune source dans docs/research : EN 1990, EC3 / EC5 et leurs AN non lus) :
 *   γ_G = 1,35, γ_Q = 1,5, γ_M0 = 1,0, γ_M bois = 1,3, k_mod = 0,8, part de la charge ponctuelle
 *   et de la masse de vibration reprise par un limon (1 : tout sur un limon, sécuritaire) ;
 * - classes de bois massif C24, C30, D30, D40 (QUESTIONS A36 (2), 2026-10-09) : f_m,k, E_0,mean,
 *   ρ_k, ρ_mean, f_v,k de l'EN 338:2016 (tableau 1 lu sur l'aperçu public, C §1.11 [84] ;
 *   tableau 3 lu sur le projet prEN 338:2013, [89]), recoupées par la NF EN 338:2009 du catalogue
 *   FCBA [90] ; norme non lue en entier (confiance moyenne) ; E_0,mean = 13 000 MPa de D40
 *   confirmé (les 11 000 MPa de [83] sont ceux de l'édition 2003, [92]) ;
 * - lamellé-collé (QUESTIONS A33 (a), 2026-10-09) : classes GL24h / GL28h / GL32h (E_0,g,mean,
 *   f_m,g,k de la NF EN 14080) et γ_M = 1,25 (EN 1995-1-1 § 2.4.1), rapportés par C §1.11 [71]
 *   (normes non lues, confiance moyenne, **à valider**) ;
 * - classe `auto` (QUESTIONS A36 (1), décision du 2026-10-09) : GL24h pour l'essence
 *   lamellé-collé, **D30** pour les essences feuillues (chêne, hêtre, frêne), en massif comme en
 *   lamellé-collé, dans tous les plugins (`HARDWOOD_WOOD_CLASS`), C24 sinon ; D30 = classe
 *   visuelle 1 du chêne (NF B 52-001-1 non lue, via C §1.11 [82], et NF EN 1912 via [90]) ;
 *   hêtre et frêne par analogie, sans source : **à valider** (QUESTIONS A37).
 */
import { msg, type Message } from "@blondel/i18n";
import { z } from "zod";
import type { SteelGrade } from "../workshop/metal.js";

export const LOAD_CATEGORIES = ["A", "B", "C1", "C2", "C3", "C4", "C5", "D1", "D2"] as const;
export type LoadCategory = (typeof LOAD_CATEGORIES)[number];

/**
 * Classes de résistance du bois : massif C24, C30, D30, D40 (EN 338:2016 via C §1.11 [84][89],
 * recoupée par [90], QUESTIONS A36 (2)) et lamellé-collé homogène GL24h, GL28h, GL32h
 * (NF EN 14080 non lue, valeurs rapportées par C §1.11 [71], QUESTIONS A33 (a)). D30 ajoutée
 * le 2026-10-09 (ajout rétrocompatible de l'énumération).
 */
export const WOOD_CLASSES = ["C24", "C30", "D30", "D40", "GL24h", "GL28h", "GL32h"] as const;
export type WoodClass = (typeof WOOD_CLASSES)[number];

/** Classes de lamellé-collé (γ_M du lamellé-collé, `gammaMGlulam`). */
export const GLULAM_WOOD_CLASSES: readonly WoodClass[] = ["GL24h", "GL28h", "GL32h"];

/**
 * Réglage de la classe : une classe, ou `auto` = GL24h pour l'essence lamellé-collé
 * (`wood-glulam`, plus basse classe GL sourcée), D30 pour une essence feuillue, massive ou
 * lamellée-collée (`HARDWOOD_WOOD_CLASS`, QUESTIONS A36 (1)), C24 sinon (défaut historique) ;
 * à valider.
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
   * Classe de résistance des limons bois ; `auto` : GL24h pour l'essence lamellé-collé, D30
   * pour une essence feuillue, C24 sinon (à valider ; classes massives : EN 338 via C §1.11
   * [84][89][90] ; classes GL : NF EN 14080 via C §1.11 [71]).
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

/** Propriétés d'une classe de résistance du bois. */
export interface WoodClassProperties {
  /** Module d'élasticité moyen parallèle au fil E_0,mean (E_0,g,mean en GL), MPa. */
  readonly e: number;
  /** Résistance caractéristique en flexion f_m,k (f_m,g,k en GL), MPa. */
  readonly fmk: number;
  /**
   * Masse volumique caractéristique ρ_k, kg/m³ : **informative**, non utilisée par le calcul (la
   * masse volumique du poids propre reste celle du profil d'atelier). Absente des classes GL.
   */
  readonly rhoK?: number;
  /** Masse volumique moyenne ρ_mean, kg/m³ : informative, non utilisée. */
  readonly rhoMean?: number;
  /**
   * Résistance caractéristique au cisaillement f_v,k, MPa : informative, non utilisée (le
   * prédimensionnement indicatif ne vérifie que flexion, flèche et fréquence propre).
   */
  readonly fvk?: number;
  /** Provenance des valeurs. */
  readonly sourced: Message;
}

/**
 * Propriétés des classes de bois.
 * - Classes massives C24, C30, D30, D40 : EN 338:2016 (QUESTIONS A36 (2)) ; tableau 1 (C) lu sur
 *   l'aperçu public de l'édition 2016 (C §1.11 [84]), tableau 3 (D) sur le projet prEN 338:2013
 *   déclaré équivalent (C §1.11 [89]) ; f_m,k, E_0,mean, ρ_k et ρ_mean identiques dans la
 *   NF EN 338:2009 (catalogue FCBA, [90]) ; f_v,k de D30 / D40 : 3,9 / 4,2 MPa (projet 2016),
 *   4,0 en 2009. Norme non lue en entier (confiance moyenne).
 * - Classes GL : E_0,g,mean et f_m,g,k de la NF EN 14080 rapportés par C §1.11 [71] (norme non
 *   lue, confiance moyenne) ; masses volumiques et f_v,k non sourcés, donc absents.
 */
export const WOOD_CLASS_PROPERTIES: Readonly<Record<WoodClass, WoodClassProperties>> = {
  C24: {
    e: 11_000,
    fmk: 24,
    rhoK: 350,
    rhoMean: 420,
    fvk: 4,
    sourced: msg("precheck.woodClass.C24"),
  },
  C30: {
    e: 12_000,
    fmk: 30,
    rhoK: 380,
    rhoMean: 460,
    fvk: 4,
    sourced: msg("precheck.woodClass.C30"),
  },
  D30: {
    e: 11_000,
    fmk: 30,
    rhoK: 530,
    rhoMean: 640,
    fvk: 3.9,
    sourced: msg("precheck.woodClass.D30"),
  },
  D40: {
    e: 13_000,
    fmk: 40,
    rhoK: 550,
    rhoMean: 660,
    fvk: 4.2,
    sourced: msg("precheck.woodClass.D40"),
  },
  GL24h: { e: 11_500, fmk: 24, sourced: msg("precheck.woodClass.GL24h") },
  GL28h: { e: 12_600, fmk: 28, sourced: msg("precheck.woodClass.GL28h") },
  GL32h: { e: 14_200, fmk: 32, sourced: msg("precheck.woodClass.GL32h") },
};

/**
 * Classe `auto` des essences feuillues du code (QUESTIONS A36 (1), décision du 2026-10-09) :
 * **D30**, en massif comme en lamellé-collé, dans tous les plugins. D30 = classe visuelle 1 du
 * chêne (NF B 52-001-1 non lue, via la fiche FNB C10, C §1.11 [82] ; le catalogue FCBA [90]
 * classe le chêne en D18 / D24 / D30, jamais D40) ; hêtre et frêne par analogie, **aucune
 * source** : à valider (QUESTIONS A37). La classe FCBA `auto` des tables de crémaillère et de
 * reste sous entaille d'une essence feuillue (`woodCut`, `WOOD_CENTRAL_AUTO_CLASS`) lit la
 * colonne C30, de même f_m,k que D30, et non plus « feuillus ≥ D40 » (QUESTIONS A37 (2)).
 */
export const HARDWOOD_WOOD_CLASS: Readonly<Partial<Record<string, WoodClass>>> = {
  "wood-oak": "D30",
  "wood-beech": "D30",
  "wood-ash": "D30",
};

/** Options de la classe `auto`. */
export interface WoodClassOptions {
  /**
   * Classe de résistance imposée à la pièce par son plugin (`wood-central.strengthClass` saisi,
   * lecture du tableau FCBA) : elle remplace la classe `auto` d'une essence feuillue
   * (`HARDWOOD_WOOD_CLASS`), pour que prédimensionnement et lecture FCBA gardent la même
   * hypothèse ; sans effet sur une autre essence.
   */
  readonly strengthClass?: WoodClass;
}

/**
 * Classe retenue : celle du réglage, ou `auto` → GL24h pour l'essence lamellé-collé
 * (`wood-glulam`) ; D30 pour une essence feuillue, massive ou lamellée-collée
 * (`HARDWOOD_WOOD_CLASS`, à valider), ou la classe imposée `options.strengthClass` ; C24 sinon
 * (et sans essence connue).
 */
export function resolveWoodClass(
  settings: PrecheckSettings,
  material?: string,
  options?: WoodClassOptions,
): WoodClass {
  if (settings.woodClass !== "auto") return settings.woodClass;
  if (material === "wood-glulam") return "GL24h";
  const species = material !== undefined ? HARDWOOD_WOOD_CLASS[material] : undefined;
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
 * massif sinon (D30 d'un lamellé-collé feuillu compris : classe massive).
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
