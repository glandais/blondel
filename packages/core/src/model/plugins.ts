/**
 * Interfaces d'extension du pipeline (ADR-0002).
 *
 * Textes (ADR-0007) : les libellés des plugins sont des **clés** de dictionnaire (`labelKey`,
 * `structure.<kind>.label`, `balancing.<method>.label`) ; leurs sorties (erreurs, remarques,
 * constats, raisons d'échec) sont des `Message` de `@blondel/i18n`, jamais du texte.
 */
import type { Message, MessageKey } from "@blondel/i18n";
import type { z } from "zod";
import type { Layout, ModelPrecheck, NosingLine, Part, RuleResult, Stepping } from "./derived.js";
import type { Mm } from "./primitives.js";
import type { BalancingMethod, Project } from "./project.js";

/**
 * Zone de balancement : nez `from` et `to` fixes (exclus), nez intermédiaires réorientés.
 * Chaque extrémité est `tangent` (une partie droite continue : pente développée = h/g)
 * ou `free` (départ, arrivée, palier : pas de raccord imposé). Voir docs/CHALLENGE.md §G3.
 */
export interface BalancingZone {
  readonly turn: number;
  /**
   * Dernier tournant couvert par la zone, quand deux tournants successifs forment une zone
   * unique (U à volée centrale de moins d'un giron, CHALLENGE G3). Absent : `turn`.
   */
  readonly lastTurn?: number;
  readonly from: number;
  readonly to: number;
  /** Côté du jour (collet) de ce tournant. */
  readonly collarSide: "left" | "right";
  readonly ends: readonly ["tangent" | "free", "tangent" | "free"];
  /**
   * Prolongement de la courbe F au-delà d'une extrémité `free` qui tombe **dans la partie
   * tournante** (nez non balancés qui suivent, jusqu'à la partie droite) : [avant `from`,
   * après `to`], `null` sans prolongement. M3 construit alors une **spline** (cubique ou
   * quintique) passant par ces nez fixes, raccordée à la partie droite, au lieu d'imposer
   * F'' = 0 à la borne : F est dérivable à la borne de zone (ajout rétrocompatible, facultatif).
   */
  readonly continuation?: readonly [ZoneContinuation | null, ZoneContinuation | null];
}

/**
 * Nez fixes traversés par le prolongement d'une zone (voir `BalancingZone.continuation`).
 */
export interface ZoneContinuation {
  /** Indices des nez, du plus proche au plus éloigné de la zone. */
  readonly nosings: readonly number[];
  /**
   * Condition au dernier nez : `tangent` (il ouvre une partie droite : pente de la marche
   * suivante sur le développé) ou `free` (départ, arrivée, palier, poteau, nez fixe : conditions
   * naturelles de la variante).
   */
  readonly end: "tangent" | "free";
}

export interface BalancingInput {
  readonly layout: Layout;
  /** Lignes de nez initiales perpendiculaires à la ligne de foulée (toutes). */
  readonly nosings: readonly NosingLine[];
  readonly zone: BalancingZone;
  /** Altitudes des nez (liste générale : première marche distincte, paliers). */
  readonly z: readonly Mm[];
  readonly rise: Mm;
  readonly going: Mm;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Stratégie de balancement. Invariant (B §3.1) : chaque ligne de nez pivote autour de son
 * point `p` sur la ligne de foulée, qui reste fixe. Une stratégie rend soit les abscisses σ
 * des points de collet Q_k sur le bord du jour, soit les angles φ_k des lignes de nez ; un
 * **post-traitement commun** calcule Q, R, collets (arc et corde) et les contrôles K2/K3/K5.
 */
export interface BalancingStrategy {
  /** Méthode de balancement : liste unique `BalancingSchema.shape.method` (project.ts). */
  readonly id: BalancingMethod;
  /** Libellé de la méthode (clé `balancing.<method>.label`). */
  readonly labelKey: MessageKey;
  solve(input: BalancingInput): BalancingSolution;
  /** Collet minimal estimé analytiquement (choix rapide de zone, B §3.5). */
  estimateMinCollet?(input: BalancingInput): Mm;
}

export type BalancingSolution =
  /**
   * Abscisses sur le bord du jour des nez from+1 … to−1. `continued` (M3, facultatif) : la
   * spline prolongée de `BalancingZone.continuation` a été retenue (`false` : repli sur les
   * conditions naturelles à la borne, spline non strictement croissante).
   */
  | { readonly kind: "sigma"; readonly sigma: readonly Mm[]; readonly continued?: boolean }
  /** Angles (rad, repère monde) des lignes de nez from+1 … to−1. */
  | { readonly kind: "phi"; readonly phi: readonly number[] }
  | { readonly kind: "fail"; readonly reason: Message };

export interface StructureContext {
  readonly project: Project;
  readonly layout: Layout;
  readonly stepping: Stepping;
  /**
   * Pièces de base déjà générées par le pipeline (marches, contremarches, paliers ;
   * `parts/basic.ts`). Un plugin peut les **remplacer** en rendant des pièces de même `id`
   * (ex. marches prolongées dans les limons). Absent : le plugin les recalcule s'il en a besoin.
   */
  readonly baseParts?: readonly Part[];
  /**
   * Dessus de main courante de garde-corps (altitude absolue, mm) au droit des poteaux d'angle
   * du tracé, par indice de tournant (`GuardsAnalysis.newelHandrailTops`). Le plugin fait
   * monter ses poteaux d'angle au moins à `top + overrun` (QUESTIONS A3). Absent : pas de garde-corps, ou aucun
   * ne rejoint de poteau d'angle. Ajout rétrocompatible (jalon 4 → 2026-09-30).
   */
  readonly newelHandrailTops?: readonly {
    readonly turn: number;
    /** Altitude absolue du dessus de la main courante (mm). */
    readonly top: Mm;
    /** Dépassement exigé du poteau au-dessus (mm, garde-corps `posts.newelOverrun`). */
    readonly overrun: Mm;
  }[];
}

/**
 * Plugin de structure (`StructureKind`) : limons bois, profilés, tôles pliées…
 * Il produit ses pièces et ses propres contrôles (règles de fabrication, capacités machines).
 */
export interface StructureKind<P = unknown> {
  readonly kind: string;
  /** Libellé de la structure (clé `structure.<kind>.label`). */
  readonly labelKey: MessageKey;
  readonly family: "bois" | "metal" | "mixte";
  readonly paramsSchema: z.ZodType<P>;
  /** Paramètres par défaut raisonnables. */
  defaults(ctx: StructureContext): P;
  build(ctx: StructureContext, params: P): StructureOutput;
  /**
   * Capacités déclarées (dette D4), lues sans construire de modèle par les corrections
   * proposées, le choix de structure, l'assistant, le comparateur et l'interface. Absent :
   * tracés à volées seulement, pas de poteau exigé, aucune épaisseur hors emprise.
   */
  readonly capabilities?: StructureCapabilities<P>;
}

/** Type de tracé accepté par une structure (`ProjectSchema` : volées ou hélicoïdal). */
export type StructureLayoutKind = "flights" | "helical";

/** Capacités d'un plugin de structure (`StructureKind.capabilities`). */
export interface StructureCapabilities<P = unknown> {
  /** Types de tracé acceptés. Défaut : `["flights"]`. */
  readonly layouts?: readonly StructureLayoutKind[];
  /**
   * Les limons de jour s'assemblent sur un **poteau d'angle** : un jour à angle vif les empêche
   * de se rencontrer (erreur « jour à angle vif » du plugin). Défaut : non.
   */
  readonly requiresNewel?: boolean;
  /**
   * Épaisseurs des limons **hors** de l'emmarchement utile (CHALLENGE A3), côté jour et côté
   * extérieur, pour des paramètres complets (défauts appliqués). Emprise hors tout = E + inner +
   * outer. Section choisie par le plugin au calcul (`auto`) : valeur de la première essayée
   * (borne basse, documentée par le plugin). Absent : 0 mm des deux côtés.
   */
  lateralThickness?(params: P): { readonly inner: Mm; readonly outer: Mm };
}

/**
 * Désignation d'une pièce dans un assemblage déclaré par un plugin : par identifiant, ou par
 * numéro de marche (pièces du modèle qui portent ce `Part.treadNumber`, résolues par le
 * pipeline : le plugin n'a pas à connaître l'identifiant de la pièce de marche).
 */
export type PartRef = { readonly partId: string } | { readonly treadNumber: number };

/** Assemblage entre deux pièces (relation symétrique). */
export interface PartAssembly {
  readonly a: PartRef;
  readonly b: PartRef;
}

export interface StructureOutput {
  /**
   * Pièces de la structure. Une pièce de même `id` qu'une pièce de base la remplace dans le
   * modèle ; les autres s'ajoutent.
   */
  readonly parts: readonly Part[];
  /**
   * Contrôles propres à la structure. Un résultat dont `ruleId` est une règle de rules.yaml
   * remplace le résultat « sans évaluateur » du moteur pour cette règle ; les autres
   * (contrôles de fabrication) s'ajoutent au rapport.
   */
  readonly checks: readonly RuleResult[];
  /** Classe d'exécution EN 1090-2 déduite (métal). */
  readonly executionClass?: "EXC1" | "EXC2";
  /**
   * Prédimensionnement indicatif fait par le plugin (ex. choix de section) : repris tel quel
   * dans `Model.precheck`. Absent : le pipeline le calcule par `precheckStringers`.
   */
  readonly precheck?: ModelPrecheck;
  /**
   * Identifiants de pièces de base que la structure **supprime** (ex. contremarches bois quand
   * les marches en tôle pliée en Z portent leur contremarche). Absent : aucune.
   */
  readonly removedBaseParts?: readonly string[];
  /** Remarques non bloquantes, reprises dans `Model.notes`. */
  readonly notes: readonly Message[];
  /**
   * Valeurs retenues pour les paramètres du plugin laissés en `auto`, par chemin du paramètre
   * joint par des points (`lowerOffset`, `newel.size`) ; le pipeline les reprend dans
   * `Model.autoValues` sous `stair.structure.params.`. Ajout rétrocompatible ; absent : aucune.
   */
  readonly autoValues?: Readonly<Record<string, number>>;
  /**
   * Assemblages connus du plugin entre deux pièces (support ↔ marche et limon porteur, limon ↔
   * poteau, tronçons consécutifs…) : le pipeline les résout sur les pièces finales du modèle et
   * les reporte, symétrisés, dans `Part.assembledWith`. Une pièce peut aussi déclarer elle-même
   * `assembledWith` (identifiants). Ajout rétrocompatible ; absent : aucun.
   */
  readonly assemblies?: readonly PartAssembly[];
  /**
   * Configurations non prises en charge (ex. jour en arc sous un limon à la française) : la
   * structure est partielle ; messages repris dans `Model.errors`. Absent : aucune.
   */
  readonly errors?: readonly Message[];
}
