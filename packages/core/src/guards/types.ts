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
  /** Libellé français (« entre balustres, travée 2 »). */
  readonly label: string;
  /** Nature : entre éléments verticaux, entre éléments filants, sous le remplissage. */
  readonly kind: "vertical" | "horizontal" | "bottom";
}

/** Appui potentiel (élément filant) à la hauteur X au-dessus du niveau de référence. */
export interface Foothold {
  readonly x: Mm;
  readonly location: Location;
  readonly label: string;
}

/** Ligne de garde-corps (rampant le long d'un côté vide, ou horizontal autour de la trémie). */
export interface GuardRun {
  readonly id: string;
  readonly kind: "rake" | "opening";
  readonly side?: StairSide;
  /** Libellé français. */
  readonly label: string;
  /** Axe du garde-corps en plan. */
  readonly path: readonly Vec2[];
  /** Niveau de référence à chaque sommet de `path`. */
  readonly ref: readonly Mm[];
  /** Hauteur du dessus de la main courante au-dessus du niveau de référence. */
  readonly height: Mm;
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
  readonly infillPartIds: readonly string[];
  readonly handrailPartId?: string;
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
  readonly notes: readonly string[];
  /**
   * Lignes de garde-corps impossibles à construire (jour plus étroit que la sphère T1, décalage
   * impossible) : erreurs lisibles, reprises dans `Model.errors` par le pipeline ; les autres
   * lignes sont calculées (pas d'exception). Absent : aucune.
   */
  readonly errors?: readonly string[];
}
