/**
 * Résultat de l'étape « garde-corps » du pipeline (jalon 4) : lignes de garde-corps et de mains
 * courantes, pièces, et grandeurs mesurées **analytiquement** pour le contrôle de conception
 * (évaluateurs `rules/evaluators/guards.ts`).
 *
 * Conventions de mesure :
 * - hauteurs verticales au-dessus du **niveau de référence** : ligne des nez sur un rampant
 *   (« à la verticale du nez »), sol fini haut sur un garde-corps de trémie ;
 * - vides entre éléments verticaux (balustres, poteaux, panneaux) : distance libre horizontale
 *   le long de la ligne du garde-corps ;
 * - vides entre éléments filants (lisses, câbles, bas du remplissage) : distance libre
 *   **perpendiculaire à la pente** (= vide vertical × cos α) ; sur l'horizontale, vide vertical.
 */
import type { Message } from "@blondel/i18n";
import type { Location, Part } from "../model/derived.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import type { GuardInfill, GuardsSpec } from "./spec.js";

export type StairSide = "inner" | "outer";

/** Portion d'un côté de l'escalier, en abscisse le long du bord (C_i ou C_e simplifié). */
export interface SideInterval {
  readonly from: Mm;
  readonly to: Mm;
  readonly kind: "void" | "wall";
  /** Mur du site qui borde la portion (absent : mur imposé par le projet). */
  readonly wallId?: string;
  /** Distance du bord de l'emmarchement au nu du mur (0 si mur imposé). */
  readonly wallFaceDistance?: Mm;
}

export interface SideAnalysis {
  readonly side: StairSide;
  /** Longueur du bord (polyligne simplifiée). */
  readonly length: Mm;
  readonly intervals: readonly SideInterval[];
  /**
   * Plus grande hauteur de chute côté vide : altitude du dessus de marche (nez) au-dessus du
   * sol bas, au droit des nez situés sur une portion vide. 0 sans portion vide.
   */
  readonly maxFall: Mm;
  /** Point du bord (à l'altitude du nez) où la chute est maximale. */
  readonly maxFallAt?: Vec3;
}

/** Vide mesuré entre deux éléments (analytique), localisé sur une pièce. */
export interface GapMeasure {
  readonly value: Mm;
  /** Bas et haut du vide au-dessus du niveau de référence (verticale). */
  readonly zBottom: Mm;
  readonly zTop: Mm;
  readonly location: Location;
  /** Libellé (« entre balustres, travée 2 »), traduit à l'affichage. */
  readonly label: Message;
  /** Nature : entre éléments verticaux, entre éléments filants, sous le remplissage. */
  readonly kind: "vertical" | "horizontal" | "bottom";
}

/** Appui potentiel (élément filant) à la hauteur X au-dessus du niveau de référence. */
export interface Foothold {
  readonly x: Mm;
  readonly location: Location;
  /** Libellé (« lisse 1, travée 2 »). */
  readonly label: Message;
}

/** Ligne de garde-corps (rampant le long d'un côté vide, ou horizontal autour de la trémie). */
export interface GuardRun {
  readonly id: string;
  readonly kind: "rake" | "opening";
  readonly side?: StairSide;
  /**
   * Libellé en cours de phrase (« garde-corps de volée côté jour ») ; `runTitle(label)` en donne
   * la forme de début de phrase.
   */
  readonly label: Message;
  /** Axe du garde-corps en plan. */
  readonly path: readonly Vec2[];
  /** Niveau de référence à chaque sommet de `path`. */
  readonly ref: readonly Mm[];
  /** Hauteur du dessus de la main courante au-dessus du niveau de référence. */
  readonly height: Mm;
  /**
   * Hauteur du dessus de la main courante sur les parties horizontales (paliers) quand elle
   * diffère de `height` : rehausse d'un garde-corps de volée sur un palier (QUESTIONS A1).
   * Absent : `height` partout. Contrôlée par GC_HAUTEUR_PALIER_1988 et GC_HAUTEUR_2024.
   */
  readonly levelHeight?: Mm;
  /**
   * Épaisseur de l'élément de protection (GC_HAUTEUR_2024, h(E)) : largeur de la main courante
   * ou épaisseur d'un panneau continu, sans les poteaux ni les balustres (ponctuels).
   */
  readonly thickness: Mm;
  /** Pente maximale (degrés) des tronçons de la ligne de référence. */
  readonly maxSlopeDeg: number;
  /** Longueur horizontale (paliers, trémie) de la ligne de référence, mm. */
  readonly horizontalLength: Mm;
  /** Hauteurs mesurées à la verticale des nez couverts (rampant). */
  readonly nosingHeights: readonly { readonly index: number; readonly height: Mm }[];
  /** Plus grande hauteur de chute couverte par la ligne. */
  readonly fall: Mm;
  readonly infill: GuardInfill["kind"];
  readonly gaps: readonly GapMeasure[];
  readonly footholds: readonly Foothold[];
  /** Diamètre des perforations (tôle perforée, gabarit T3). */
  readonly meshOpenings: readonly GapMeasure[];
  /** Pièce principale (main courante, sinon premier poteau) : localisation des contrôles. */
  readonly primaryPartId: string;
  readonly postPartIds: readonly string[];
  /**
   * Emprise des poteaux de la ligne (pièces `postPartIds`, dans le même ordre) : centre et
   * direction de la ligne en plan, côté de la section carrée, bas et haut (altitudes absolues).
   * Sert au contrôle de collision des poteaux de jour (`GC_POTEAUX_JOUR`, QUESTIONS A10).
   */
  readonly posts?: readonly GuardPostFootprint[];
  readonly infillPartIds: readonly string[];
  readonly handrailPartId?: string;
}

/** Emprise d'un poteau de garde-corps (section carrée orientée selon la ligne). */
export interface GuardPostFootprint {
  readonly partId: string;
  readonly center: Vec2;
  /** Direction unitaire de la ligne au droit du poteau (orientation de la section). */
  readonly dir: Vec2;
  readonly size: Mm;
  readonly z0: Mm;
  readonly z1: Mm;
}

/**
 * Jour plus étroit que la sphère T1 (QUESTIONS A10, décisions des 2026-09-29 et 2026-09-30) :
 * pas de garde-corps dans l'emprise du jour (`GC_OBLIGATOIRE` en conseil), garde-corps partiel
 * sur les portions du côté jour qui bordent un vide hors du jour.
 */
export interface NarrowJour {
  /** Largeur du jour (mm, `jourWidth`). */
  readonly width: Mm;
  /** Seuil : diamètre de la sphère T1 (`GC_GABARIT_T1_2024.max`). */
  readonly threshold: Mm;
  /**
   * Chute maximale côté jour **dans** l'emprise du jour (entre les deux volées qui se font face) :
   * seule celle-ci passe en conseil. 0 sans nez dans le jour.
   */
  readonly jourFall: Mm;
  readonly jourFallAt?: Vec3;
  /**
   * Chute maximale côté jour **hors** de l'emprise du jour (volée plus longue que celle d'en face,
   * qui borde un vide ouvert) : `GC_OBLIGATOIRE` garde sa sévérité (revue A10). 0 sans tel nez.
   */
  readonly outsideFall: Mm;
  readonly outsideFallAt?: Vec3;
  /**
   * Nombre de garde-corps partiels construits côté jour sur les portions qui bordent un vide
   * hors du jour (décision A10 du 2026-09-30). Absent : aucun. `outsideFall` ne compte alors que
   * les portions hors du jour restées sans garde-corps.
   */
  readonly partialGuards?: number;
  /** Chute maximale au droit des garde-corps partiels (protégée), avec `partialGuards`. */
  readonly guardedFall?: Mm;
}

/** Dessus de main courante au droit d'un poteau d'angle du tracé (QUESTIONS A3). */
export interface NewelHandrailTop {
  /** Indice du tournant du poteau. */
  readonly turn: number;
  /** Altitude absolue du dessus de la main courante (mm). */
  readonly top: Mm;
  /** Dépassement exigé du poteau au-dessus (mm, `posts.newelOverrun`). */
  readonly overrun: Mm;
}

/** Main courante (sur garde-corps de volée ou murale), le long de l'escalier. */
export interface HandrailRun {
  readonly id: string;
  readonly partId: string;
  readonly side: StairSide;
  readonly onGuard: boolean;
  /** Intervalle couvert, en abscisse du bord du côté. */
  readonly from: Mm;
  readonly to: Mm;
  /** Hauteur du dessus de la main courante à la verticale des nez couverts. */
  readonly nosingHeights: readonly { readonly index: number; readonly height: Mm }[];
  /** Prolongements horizontaux réalisés aux extrémités de l'escalier (absent : extrémité non atteinte). */
  readonly extensionBottom?: Mm;
  readonly extensionTop?: Mm;
  /** Dégagement au mur (main courante murale). */
  readonly wallClearance?: Mm;
  /** Épaisseur de préhension (largeur de la section). */
  readonly sectionWidth: Mm;
  /** Empiètement sur l'emmarchement (largeur entre mains courantes). */
  readonly intrusion: Mm;
}

export interface GuardsAnalysis {
  /** Spécification résolue (défauts appliqués). */
  readonly spec: GuardsSpec;
  readonly sides: readonly SideAnalysis[];
  readonly runs: readonly GuardRun[];
  readonly handrails: readonly HandrailRun[];
  /** Côtés libres de la trémie sans garde-corps (garde-corps de trémie désactivé). */
  readonly unguardedOpeningEdges: readonly { readonly a: Vec2; readonly b: Vec2 }[];
  /** Hauteur de chute au droit de la trémie (sol haut → sol bas). */
  readonly openingFall: Mm;
  readonly parts: readonly Part[];
  /**
   * Dessus de main courante (altitude absolue, mm) au droit de chaque poteau d'angle du tracé
   * qu'elle rejoint, par indice de tournant (le plus haut des garde-corps qui y aboutissent,
   * dans l'emprise du poteau), avec le dépassement demandé (`posts.newelOverrun`). Lu par les
   * structures pour faire monter le poteau au-dessus de la main courante (QUESTIONS A3).
   * Absent : aucun garde-corps ne rejoint de poteau d'angle, ou `newelOverrun` à `off`.
   */
  readonly newelHandrailTops?: readonly NewelHandrailTop[];
  readonly notes: readonly Message[];
  /**
   * Jour plus étroit que la sphère T1 dont le garde-corps n'est pas construit (remarque dans
   * `notes`, pas une erreur). Absent : jour assez large, sans vide côté jour ou garde-corps de
   * volée désactivés.
   */
  readonly narrowJour?: NarrowJour;
  /**
   * Lignes de garde-corps impossibles à construire (décalage impossible) : erreurs lisibles,
   * reprises dans `Model.errors` par le pipeline ; les autres lignes sont calculées (pas
   * d'exception). Absent : aucune.
   */
  readonly errors?: readonly Message[];
}
