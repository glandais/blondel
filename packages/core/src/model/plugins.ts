/**
 * Interfaces d'extension du pipeline (ADR-0002).
 */
import type { z } from "zod";
import type { Layout, NosingLine, Part, RuleResult, Stepping } from "./derived.js";
import type { Mm } from "./primitives.js";
import type { Project } from "./project.js";

/**
 * Zone de balancement : nez `from` et `to` fixes (exclus), nez intermédiaires réorientés.
 * Chaque extrémité est `tangent` (une partie droite continue : pente développée = h/g)
 * ou `free` (départ, arrivée, palier : pas de raccord imposé). Voir docs/CHALLENGE.md §G3.
 */
export interface BalancingZone {
  readonly turn: number;
  readonly from: number;
  readonly to: number;
  /** Côté du jour (collet) de ce tournant. */
  readonly collarSide: "left" | "right";
  readonly ends: readonly ["tangent" | "free", "tangent" | "free"];
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
  readonly id: "M0" | "M1" | "M2" | "M3" | "M6" | "M7";
  readonly label: string;
  solve(input: BalancingInput): BalancingSolution;
  /** Collet minimal estimé analytiquement (choix rapide de zone, B §3.5). */
  estimateMinCollet?(input: BalancingInput): Mm;
}

export type BalancingSolution =
  /** Abscisses sur le bord du jour des nez from+1 … to−1. */
  | { readonly kind: "sigma"; readonly sigma: readonly Mm[] }
  /** Angles (rad, repère monde) des lignes de nez from+1 … to−1. */
  | { readonly kind: "phi"; readonly phi: readonly number[] }
  | { readonly kind: "fail"; readonly reason: string };

export interface StructureContext {
  readonly project: Project;
  readonly layout: Layout;
  readonly stepping: Stepping;
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
  readonly parts: readonly Part[];
  readonly checks: readonly RuleResult[];
  /** Classe d'exécution EN 1090-2 déduite (métal). */
  readonly executionClass?: "EXC1" | "EXC2";
  readonly notes: readonly string[];
}
