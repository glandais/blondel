/**
 * Contrats de l'assistant d'initialisation (prompt 2 §3, SPEC §2.2, CHALLENGE G8).
 *
 * L'assistant résout un problème **inverse** par énumération explicite et bornée : à partir du
 * site (hauteur à monter, dalle, trémie, murs), des contextes de conformité et de préférences
 * facultatives, il propose des escaliers complets (`Project`), chacun accompagné d'un résumé du
 * modèle calculé et d'un score détaillé (pénalités pondérées, plus petit = meilleur).
 */
import type { Locale, Message, MessageKey } from "@blondel/i18n";
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

/** Clés des libellés des typologies. */
export const TYPOLOGY_LABELS: Readonly<Record<TypologyId, MessageKey>> = {
  straight: "assistant.typology.straight",
  quarter: "assistant.typology.quarter",
  "two-quarters": "assistant.typology.twoQuarters",
  "half-turn": "assistant.typology.halfTurn",
  "quarter-landing": "assistant.typology.quarterLanding",
  helical: "assistant.typology.helical",
};

/** Clés des positions du tournant (`bas`, `médian`, `haut` : identifiants). */
export const TURN_POSITION_LABELS: Readonly<Record<"bas" | "médian" | "haut", MessageKey>> = {
  bas: "assistant.turnPosition.low",
  médian: "assistant.turnPosition.middle",
  haut: "assistant.turnPosition.high",
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
  /**
   * Par mm de marge d'échappée (échappée − échappée minimale bloquante) sous la marge visée
   * `AssistantLimits.headroomMarginTarget` : un escalier qui passe « tout juste » est pénalisé,
   * jamais rejeté. Absent des poids fournis : valeur par défaut.
   */
  readonly headroomMargin: number;
  /** Par marche balancée. */
  readonly winders: number;
  /** Par mm d'écart maximal des girons sur la ligne de foulée au giron nominal. */
  readonly regularity: number;
  /** Par avertissement du contrôle de conception. */
  readonly warnings: number;
}

/** Réglages de l'énumération (tous ont une valeur par défaut, `ASSISTANT_DEFAULTS`). */
export interface AssistantLimits {
  /** Nombre maximal de candidats de la liste principale (variantes non comptées). */
  readonly maxCandidates?: number;
  /**
   * Nombre maximal de modèles acceptés par groupe de construction typologie × sens × position
   * du tournant (équité de l'étage complet ; fournit aussi les variantes de chaque forme).
   */
  readonly perGroupLimit?: number;
  /**
   * Diversité de la liste principale : au plus ce nombre de candidats par forme (typologie ×
   * position du tournant, le sens et E n'en font pas partie) ; les suivants de la même forme
   * sont rendus en `variants` du meilleur. Entier ≥ 1.
   */
  readonly perShapeLimit?: number;
  /**
   * « Montrer toutes les variantes » : liste principale **à plat**, tous les candidats acceptés
   * classés par score (sans regroupement ni troncature à `maxCandidates`), `variants` vides.
   */
  readonly showAllVariants?: boolean;
  /**
   * Marge d'échappée visée (mm, ≥ 0) du terme `headroomMargin` du score : pénalité par mm de
   * marge en dessous. **[Choix Blondel, à valider]**.
   */
  readonly headroomMarginTarget?: Mm;
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
  /**
   * Langue des noms des projets proposés (`Project.name`, texte enregistré dans le projet) ;
   * défaut : français. Les libellés et diagnostics du résultat sont des `Message`.
   */
  readonly locale?: Locale;
}

/** Terme du score (affiché). */
export interface ScoreTerm {
  readonly id: keyof ScoreWeights;
  readonly label: Message;
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
  readonly fit: Message;
}

export interface DesignCandidate {
  /** Identifiant stable dans le résultat (typologie, sens, position, n, E, g, calage). */
  readonly id: string;
  readonly typology: TypologyId;
  readonly direction: "left" | "right" | null;
  /** Position du tournant : `bas`, `médian`, `haut` ; `null` sans tournant. */
  readonly turnPosition: "bas" | "médian" | "haut" | null;
  readonly label: Message;
  readonly project: Project;
  readonly summary: ModelSummary;
  readonly score: ScoreBreakdown;
  /** Forme du candidat (diversité) : `typologie|position du tournant` (`-` sans tournant). */
  readonly shape: string;
  /**
   * Variantes de la même forme (autre sens, autre E, autre n…) regroupées sous le meilleur
   * candidat de la forme, classées par score croissant ; vide pour une variante, pour un
   * candidat non meilleur de sa forme et avec `showAllVariants`.
   */
  readonly variants: readonly DesignCandidate[];
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

/** Clés des libellés des motifs d'élimination. */
export const REJECTION_LABELS: Readonly<Record<RejectionReason, MessageKey>> = {
  bounds: "assistant.rejection.bounds",
  layout: "assistant.rejection.layout",
  placement: "assistant.rejection.placement",
  headroom: "assistant.rejection.headroom",
  walls: "assistant.rejection.walls",
  slab: "assistant.rejection.slab",
  generation: "assistant.rejection.generation",
  blocking: "assistant.rejection.blocking",
  structure: "assistant.rejection.structure",
  budget: "assistant.rejection.budget",
};

/** Éliminations d'un groupe (typologie × sens) pour un motif. */
export interface RejectionTally {
  readonly typology: TypologyId;
  readonly direction: "left" | "right" | null;
  readonly reason: RejectionReason;
  readonly count: number;
  /** Premier exemple rencontré. */
  readonly example: Message;
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
  /**
   * Liste principale des candidats sans bloquant, classés par score croissant : au plus
   * `perShapeLimit` par forme, les autres en `variants` du meilleur de leur forme (ou tous à
   * plat avec `showAllVariants`).
   */
  readonly candidates: readonly DesignCandidate[];
  /** Diagnostic : bornes utilisées, éliminations, absence de proposition. */
  readonly diagnostics: readonly Message[];
  readonly rejections: readonly RejectionTally[];
  readonly stats: AssistantStats;
}
