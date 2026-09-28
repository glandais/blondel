/**
 * Interfaces d'extension du pipeline (ADR-0002).
 */
import type { z } from "zod";
import type { Layout, NosingLine, Part, RuleResult, Stepping } from "./derived.js";
import type { Mm } from "./primitives.js";
import type { Project } from "./project.js";

/**
 * Stratégie de balancement : oriente les lignes de nez d'une zone tournante.
 * Invariant (B §3.1) : chaque ligne de nez pivote autour de son point `p` sur la ligne de
 * foulée, qui reste fixe ; seules `dir`, `q`, `r`, `sigma*` changent.
 */
export interface BalancingStrategy {
  readonly id: "M0" | "M1" | "M2" | "M3" | "M6" | "M7";
  readonly label: string;
  /**
   * @param nosings lignes de nez **perpendiculaires** initiales (toutes), dont `from` et `to` sont fixes
   * @param from dernier nez fixe avant le tournant
   * @param to premier nez fixe après le tournant
   * @returns les lignes de nez `from+1 … to−1` réorientées
   */
  balance(input: BalancingInput): readonly NosingLine[];
  /** Collet minimal estimé (analytique) pour une zone donnée, pour le choix automatique de la zone. */
  estimateMinCollet?(input: BalancingInput): Mm;
}

export interface BalancingInput {
  readonly layout: Layout;
  readonly nosings: readonly NosingLine[];
  readonly from: number;
  readonly to: number;
  readonly rise: Mm;
  readonly going: Mm;
  readonly params: Readonly<Record<string, unknown>>;
}

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
