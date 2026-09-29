/**
 * Interfaces d'extension du pipeline (ADR-0002).
 */
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
  readonly label: string;
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
  | { readonly kind: "fail"; readonly reason: string };

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
  readonly label: string;
  readonly family: "bois" | "metal" | "mixte";
  readonly paramsSchema: z.ZodType<P>;
  /** Paramètres par défaut raisonnables. */
  defaults(ctx: StructureContext): P;
  build(ctx: StructureContext, params: P): StructureOutput;
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
  readonly notes: readonly string[];
  /**
   * Configurations non prises en charge (ex. jour en arc sous un limon à la française) : la
   * structure est partielle ; messages repris dans `Model.errors`. Absent : aucune.
   */
  readonly errors?: readonly string[];
}
