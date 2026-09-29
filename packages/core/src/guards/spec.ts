/**
 * Spécification des garde-corps et mains courantes dans le projet (`Project.guards`, jalon 4).
 *
 * Section **facultative** du projet (ajout rétrocompatible) : absente, aucun garde-corps n'est
 * généré et les règles GC_* / MC_* sortent « non évaluées ». Présente (même `{}`), les défauts
 * ci-dessous s'appliquent.
 *
 * Provenance des valeurs par défaut (CHALLENGE P3 : aucune règle métier inventée) :
 * - **sourcées** (rules.yaml) : hauteur de garde-corps rampant 900 mm (GC_HAUTEUR_RAMPANT_1988 /
 *   _2024, mesurée à la verticale du nez), hauteur de garde-corps de trémie 1 000 mm
 *   (GC_HAUTEUR_PALIER_1988, GC_HAUTEUR_2024 pour E ≤ 250 mm), hauteur de main courante murale
 *   900 mm (MC_HAUTEUR, valeur recommandée), dégagement au mur 50 mm (MC_DEGAGEMENT_MUR, valeur
 *   « autres cas », la plus exigeante), prolongements « auto » = un giron (MC_PROLONGEMENT_*) ;
 * - **usage** (C §3.3, confiance faible) : main courante ronde Ø 42 mm ;
 * - **à valider** (aucune source, choix Blondel, voir LEDGER §2) : entraxe et section des
 *   balustres, nombre et section des lisses, diamètre des câbles, épaisseurs de panneaux,
 *   jeux entre panneaux, vide sous le remplissage, section et entraxe maximal des poteaux,
 *   angle de poteau d'angle, décalage de l'axe du garde-corps par rapport au bord de
 *   l'emmarchement et au nu de la trémie, tolérance de détection des murs, matériau.
 */
import { z } from "zod";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();

/** Matériaux acceptés pour les pièces de garde-corps (`MaterialId` du modèle dérivé). */
export const GUARD_MATERIALS = [
  "wood-oak",
  "wood-beech",
  "wood-ash",
  "wood-pine",
  "wood-glulam",
  "steel-raw",
  "steel-painted",
  "steel-galvanized",
  "stainless-brushed",
] as const;

/** Section d'un élément filant ou vertical (balustre, lisse, main courante, câble). */
export const GuardSectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("round"), diameter: mmPos }),
  /** `width` : dimension horizontale (le long du garde-corps pour un balustre, en travers pour une lisse) ; `height` : dimension verticale (ou dans la direction perpendiculaire du plan pour un balustre). */
  z.object({ kind: z.literal("rect"), width: mmPos, height: mmPos }),
]);
export type GuardSection = z.infer<typeof GuardSectionSchema>;

/**
 * Vide vertical entre le niveau de référence (ligne des nez sur un rampant, sol fini sur un
 * garde-corps horizontal) et le bas du remplissage. Défaut 50 mm : **à valider**.
 */
const bottomGap = mmNonNeg.default(50);

/**
 * Remplissage du garde-corps entre poteaux. Les vides sont calculés **analytiquement** à partir
 * des entraxes, sections et jeux (pas d'opération booléenne).
 */
export const GuardInfillSchema = z.discriminatedUnion("kind", [
  /**
   * Barreaudage vertical. `spacing` = entraxe **maximal** des balustres : le nombre de balustres
   * de chaque travée est le plus petit qui respecte cet entraxe, répartis à vides égaux.
   * Défauts (entraxe 140, section 40 × 40) : à valider.
   */
  z.object({
    kind: z.literal("balusters"),
    spacing: mmPos.default(140),
    section: GuardSectionSchema.default({ kind: "rect", width: 40, height: 40 }),
    bottomGap,
  }),
  /**
   * Lisses parallèles à la ligne de référence (horizontales sur un palier ou une trémie,
   * rampantes le long d'une volée), réparties à vides égaux entre le bas du remplissage et la
   * main courante. Défauts (5 lisses 40 × 30) : à valider.
   */
  z.object({
    kind: z.literal("rails"),
    count: z.number().int().min(1).max(30).default(5),
    section: GuardSectionSchema.default({ kind: "rect", width: 40, height: 30 }),
    bottomGap,
  }),
  /**
   * Câbles tendus : traités comme des lisses (SPEC X12), avec un avertissement sur leur
   * détente (NF P01-012:2024, durabilité des vides). Défauts (8 câbles Ø 6) : à valider.
   */
  z.object({
    kind: z.literal("cables"),
    count: z.number().int().min(1).max(40).default(8),
    diameter: mmPos.default(6),
    bottomGap,
  }),
  /**
   * Verre (V1) : paramètre accepté, contrôles minimaux (jeux entre panneaux et poteaux, vide
   * sous le panneau). Produit (feuilleté 1B1, NF DTU 39 P5) et pinces non vérifiés.
   * Défauts (épaisseur 17,5 → 18 mm, jeu 20 mm) : à valider.
   */
  z.object({
    kind: z.literal("glass"),
    thickness: mmPos.default(18),
    panelGap: mmNonNeg.default(20),
    bottomGap,
  }),
  /** Tôle perforée : diamètre de perforation contrôlé au gabarit T3. Défauts à valider. */
  z.object({
    kind: z.literal("perforated"),
    thickness: mmPos.default(3),
    holeDiameter: mmPos.default(10),
    panelGap: mmNonNeg.default(20),
    bottomGap,
  }),
  /** Panneau plein (bois, tôle). Défauts à valider. */
  z.object({
    kind: z.literal("panel"),
    thickness: mmPos.default(20),
    panelGap: mmNonNeg.default(20),
    bottomGap,
  }),
]);
export type GuardInfill = z.infer<typeof GuardInfillSchema>;

/** Nature d'un côté de l'escalier : déduite (`auto`), ou imposée. */
export const GuardSideModeSchema = z.enum(["auto", "void", "wall"]);
export type GuardSideMode = z.infer<typeof GuardSideModeSchema>;

export const FlightGuardSpecSchema = z.object({
  /** Garde-corps de volée côté vide. */
  enabled: z.boolean().default(true),
  /**
   * Côté intérieur (jour) et extérieur : `auto` = vide sauf là où un mur du site longe le bord
   * (voir `wallTolerance`) ; `void` / `wall` : imposé sur tout le côté (mur supposé au nu du
   * bord de l'emmarchement).
   */
  inner: GuardSideModeSchema.default("auto"),
  outer: GuardSideModeSchema.default("auto"),
  /** Hauteur au-dessus de la ligne des nez, mesurée à la verticale du nez (GC_HAUTEUR_RAMPANT_*). */
  height: mmPos.default(900),
  /** Distance du bord de l'emmarchement (C_i / C_e) à l'axe du garde-corps, vers le vide. À valider. */
  edgeOffset: mmNonNeg.default(30),
});

export const OpeningGuardSpecSchema = z.object({
  /** Garde-corps de trémie sur les côtés libres (hors arrivée et murs). */
  enabled: z.boolean().default(true),
  /** Hauteur au-dessus du sol fini haut (GC_HAUTEUR_PALIER_1988, GC_HAUTEUR_2024). */
  height: mmPos.default(1000),
  /** Recul de l'axe du garde-corps par rapport au nu de la trémie, sur le plancher. À valider. */
  setback: mmNonNeg.default(50),
});

export const GuardPostSpecSchema = z.object({
  /** Côté du poteau carré. À valider. */
  size: mmPos.default(80),
  /** Entraxe maximal entre poteaux (poteaux intermédiaires ajoutés). À valider. */
  maxSpacing: mmPos.default(1500),
  /** Déviation en plan (degrés) au-delà de laquelle un sommet reçoit un poteau d'angle. À valider. */
  cornerAngle: z.number().positive().max(180).default(30),
});

/** Prolongement horizontal : longueur en mm ou `auto` (= giron nominal, MC_PROLONGEMENT_*). */
const extension = z.union([mmNonNeg, z.literal("auto")]).default("auto");

export const HandrailSpecSchema = z.object({
  /** Section de la main courante (usage : Ø 42 mm, C §3.3, confiance faible). */
  section: GuardSectionSchema.default({ kind: "round", diameter: 42 }),
  /**
   * Hauteur du **dessus** de la main courante murale au-dessus du nez (MC_HAUTEUR, recommandé
   * 900 mm). Sur un garde-corps, la main courante est à la hauteur du garde-corps.
   */
  height: mmPos.default(900),
  /**
   * Mains courantes murales (côtés murs). Les garde-corps de volée portent toujours une main
   * courante (logement : « le garde-corps tient lieu de main courante », A §1.12).
   * `auto` : si l'escalier a un garde-corps de volée, main courante murale seulement sur les
   * portions murales des côtés qui portent un garde-corps (continuité, MC_DISCONTINUITE ;
   * logement : une main courante suffit, MC_LOGEMENT) ; sinon une seule, sur les portions
   * murales du côté extérieur (du côté intérieur à défaut). ERP / BHC : choisir `both`
   * (MC_DEUX_COTES).
   */
  wallSides: z.enum(["auto", "none", "inner", "outer", "both"]).default("auto"),
  /** Prolongements horizontaux au-delà de la première et de la dernière marche. */
  extensions: z.object({ bottom: extension, top: extension }).prefault({}),
  /** Dégagement entre la main courante et le mur (MC_DEGAGEMENT_MUR). */
  wallClearance: mmNonNeg.default(50),
});
export type HandrailSpec = z.infer<typeof HandrailSpecSchema>;

export const GuardsSpecSchema = z.object({
  flight: FlightGuardSpecSchema.prefault({}),
  opening: OpeningGuardSpecSchema.prefault({}),
  infill: GuardInfillSchema.default({
    kind: "balusters",
    spacing: 140,
    section: { kind: "rect", width: 40, height: 40 },
    bottomGap: 50,
  }),
  posts: GuardPostSpecSchema.prefault({}),
  handrail: HandrailSpecSchema.prefault({}),
  /** Matériau des poteaux, lisses, balustres, panneaux pleins et mains courantes. À valider. */
  material: z.enum(GUARD_MATERIALS).default("wood-oak"),
  /**
   * Détection des murs du site : un bord d'emmarchement est « côté mur » si le nu d'un mur
   * (axe `a`–`b` ± épaisseur / 2) est parallèle et à au plus cette distance. À valider.
   */
  wallTolerance: mmNonNeg.default(100),
});
export type GuardsSpec = z.infer<typeof GuardsSpecSchema>;
export type GuardsSpecInput = z.input<typeof GuardsSpecSchema>;
