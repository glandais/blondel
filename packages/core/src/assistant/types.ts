/**
 * Contrats de l'assistant d'initialisation (prompt 2 §3, SPEC §2.2, CHALLENGE G8).
 *
 * L'assistant résout un problème **inverse** par énumération explicite et bornée : à partir du
 * site (hauteur à monter, dalle, trémie, murs), des contextes de conformité et de préférences
 * facultatives, il propose des escaliers complets (`Project`), chacun accompagné d'un résumé du
 * modèle calculé et d'un score détaillé (pénalités pondérées, plus petit = meilleur).
 */
import type { Mm, Vec2 } from "../model/primitives.js";
import type { Project, ProjectInput } from "../model/project.js";

/** Typologies énumérées (CHALLENGE G8). */
export type TypologyId =
  "straight" | "quarter" | "two-quarters" | "half-turn" | "quarter-landing" | "helical";

export const TYPOLOGY_IDS: readonly TypologyId[] = [
  "straight",
  "quarter",
  "two-quarters",
  "half-turn",
  "quarter-landing",
  "helical",
];

/** Libellés français des typologies. */
export const TYPOLOGY_LABELS: Readonly<Record<TypologyId, string>> = {
  straight: "Escalier droit",
  quarter: "Quart tournant",
  "two-quarters": "Deux quarts tournants (U)",
  "half-turn": "Demi-tournant balancé",
  "quarter-landing": "Quart tournant avec palier",
  helical: "Hélicoïdal",
};

/**
 * Intention de structure (CHALLENGE A3, panel « StructureIntent ») : elle ne sert qu'à convertir
 * l'emprise hors tout (trémie) en emprise utile et à choisir le plugin du projet proposé. Les
 * épaisseurs sont prises **hors** de l'emmarchement utile E, côté jour et côté extérieur.
 */
export interface StructureIntent {
  /** Plugin de structure (`stair.structure.kind`) ; défaut `none`. */
  readonly kind?: string;
  /** Paramètres du plugin recopiés dans le projet proposé ; défaut `{}`. */
  readonly params?: Readonly<Record<string, unknown>>;
  /**
   * Épaisseur hors emmarchement côté jour (mm). Absente : déduite du plugin (épaisseur des
   * limons latéraux, `thickness`) pour les plugins à limons hors emprise, sinon 0.
   */
  readonly innerThickness?: Mm;
  /** Épaisseur hors emmarchement côté extérieur (mur) ; même règle que `innerThickness`. */
  readonly outerThickness?: Mm;
}

/** Préférences facultatives de l'utilisateur. */
export interface AssistantPreferences {
  /** Typologies à explorer ; défaut : toutes. */
  readonly typologies?: readonly TypologyId[];
  /** Sens des tournants (et de rotation de l'hélicoïdal) ; défaut : les deux. */
  readonly direction?: "left" | "right";
  /** Emmarchement utile E cible (mm entier) ; défaut : grille bornée par les règles et la trémie. */
  readonly width?: Mm;
  /** Structure visée. */
  readonly structure?: StructureIntent;
}

/**
 * Poids des termes du score (pénalités ; plus petit = meilleur). **[Choix Blondel, à valider]** :
 * aucune pondération n'est sourcée ; elles sont affichées avec le score et modifiables.
 */
export interface ScoreWeights {
  /** Par mm d'écart |2h + g − module recommandé|. */
  readonly blondel: number;
  /** Par mm de collet (corde) sous le collet recommandé. */
  readonly collet: number;
  /** Par mm d'échappée sous l'échappée recommandée. */
  readonly headroom: number;
  /** Par marche balancée. */
  readonly winders: number;
  /** Par mm d'écart maximal des girons sur la ligne de foulée au giron nominal. */
  readonly regularity: number;
  /** Par avertissement du contrôle de conception. */
  readonly warnings: number;
}

/** Réglages de l'énumération (tous ont une valeur par défaut, `ASSISTANT_DEFAULTS`). */
export interface AssistantLimits {
  /** Nombre maximal de candidats rendus. */
  readonly maxCandidates?: number;
  /** Nombre maximal de candidats rendus par typologie et sens (diversité). */
  readonly perGroupLimit?: number;
  /** Nombre maximal de modèles complets construits (`buildModel`). */
  readonly maxBuilds?: number;
  /** Budget de temps indicatif (ms) : au-delà, l'évaluation s'arrête (résultat partiel). */
  readonly timeBudgetMs?: number;
  /** Pas de la recherche du giron (mm, > 0). */
  readonly goingStep?: Mm;
  /**
   * Profondeur dégagée exigée au-delà de la ligne d'arrivée, sur toute la largeur hors tout
   * (mm) : aucun mur ne doit s'y trouver (on ne débouche pas dans un mur). Absente : E du
   * candidat, par analogie avec `PALIER_LONGUEUR_METIER` (palier ≥ E) **[choix Blondel, à
   * valider]**.
   */
  readonly arrivalClearance?: Mm;
}

export interface AssistantInput {
  /** Site : H, dalle, trémie, murs (mêmes champs que `Project.site`). */
  readonly site: ProjectInput["site"];
  /** Contextes, profil, date de référence (mêmes champs que `Project.compliance`). */
  readonly compliance?: ProjectInput["compliance"];
  /** Profil d'atelier recopié dans les projets proposés. */
  readonly workshop?: ProjectInput["workshop"];
  readonly preferences?: AssistantPreferences;
  readonly weights?: Partial<ScoreWeights>;
  readonly limits?: AssistantLimits;
  /** Annulation coopérative : consultée régulièrement ; `true` arrête l'énumération. */
  readonly shouldStop?: () => boolean;
}

/** Terme du score (affiché). */
export interface ScoreTerm {
  readonly id: keyof ScoreWeights;
  readonly label: string;
  /** Grandeur mesurée (mm ou nombre). */
  readonly value: number;
  readonly unit: "mm" | "nb";
  readonly weight: number;
  /** value × weight. */
  readonly penalty: number;
}

export interface ScoreBreakdown {
  /** Somme des pénalités (plus petit = meilleur). */
  readonly total: number;
  readonly terms: readonly ScoreTerm[];
}

/** Résumé du modèle d'un candidat (sérialisable, léger pour un Web Worker). */
export interface ModelSummary {
  readonly riserCount: number;
  readonly rise: Mm;
  readonly going: Mm;
  /** 2h + g. */
  readonly blondel: Mm;
  /** Emmarchement utile E. */
  readonly width: Mm;
  /** Largeur hors tout à l'arrivée (E + épaisseurs de l'intention de structure). */
  readonly grossWidth: Mm;
  /** Reculement sur la ligne de foulée. */
  readonly run: Mm;
  /** Collet minimal en corde des marches balancées ; `null` sans marche balancée. */
  readonly minCollet: Mm | null;
  /** Échappée minimale sur la ligne de foulée ; `null` si aucun point n'est sous la dalle. */
  readonly headroom: Mm | null;
  /** Échappée − échappée minimale bloquante ; `null` sans échappée ou sans seuil. */
  readonly headroomMargin: Mm | null;
  readonly winderCount: number;
  readonly landingCount: number;
  /** Violations du contrôle de conception par sévérité (bloquant toujours 0). */
  readonly violations: { readonly avertissement: number; readonly conseil: number };
  /** Règles en avertissement (identifiants), pour l'aperçu. */
  readonly warningRules: readonly string[];
  /** Placement retenu (repère du site). */
  readonly placement: { readonly origin: Vec2; readonly rotation: number };
  /** Calage : côté de trémie d'arrivée et alignement latéral. */
  readonly fit: string;
}

export interface DesignCandidate {
  /** Identifiant stable dans le résultat (typologie, sens, position, n, E, g, calage). */
  readonly id: string;
  readonly typology: TypologyId;
  readonly direction: "left" | "right" | null;
  /** Position du tournant : `bas`, `médian`, `haut` ; `null` sans tournant. */
  readonly turnPosition: "bas" | "médian" | "haut" | null;
  /** Libellé français. */
  readonly label: string;
  readonly project: Project;
  readonly summary: ModelSummary;
  readonly score: ScoreBreakdown;
}

/** Motifs d'élimination. */
export type RejectionReason =
  | "bounds"
  | "layout"
  | "placement"
  | "headroom"
  | "walls"
  | "slab"
  | "generation"
  | "blocking"
  | "structure"
  | "budget";

export const REJECTION_LABELS: Readonly<Record<RejectionReason, string>> = {
  bounds: "aucune hauteur ni aucun giron admissibles par les règles actives",
  layout: "tracé impossible",
  placement: "calage impossible dans la trémie",
  headroom: "échappée insuffisante",
  walls: "collision avec un mur",
  slab: "passage à travers la dalle haute hors trémie",
  generation: "erreur de génération du modèle",
  blocking: "violation bloquante du contrôle de conception",
  structure: "structure visée incompatible",
  budget: "non évalué (budget atteint)",
};

/** Éliminations d'un groupe (typologie × sens) pour un motif. */
export interface RejectionTally {
  readonly typology: TypologyId;
  readonly direction: "left" | "right" | null;
  readonly reason: RejectionReason;
  readonly count: number;
  /** Premier exemple rencontré (message lisible). */
  readonly example: string;
}

export interface AssistantStats {
  /** Combinaisons énumérées (typologie × position × n × E × g × calage). */
  readonly enumerated: number;
  /** Modèles complets construits. */
  readonly built: number;
  readonly elapsedMs: number;
  /** Arrêt demandé par `shouldStop`. */
  readonly stopped: boolean;
  /** Budget de constructions ou de temps atteint. */
  readonly truncated: boolean;
}

export interface AssistantResult {
  /** Candidats sans bloquant, classés (score croissant). */
  readonly candidates: readonly DesignCandidate[];
  /** Diagnostic lisible (français) : bornes utilisées, éliminations, absence de proposition. */
  readonly diagnostics: readonly string[];
  readonly rejections: readonly RejectionTally[];
  readonly stats: AssistantStats;
}
