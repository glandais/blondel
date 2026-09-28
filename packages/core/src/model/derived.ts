/**
 * Sorties dérivées du pipeline (non sérialisées, recalculées à chaque modification).
 *
 *   Project ─► Layout (tracé) ─► Stepping (découpage) ─► Structure ─► Guards ─► Parts
 *                                                     └─► Compliance (à chaque étape)
 *
 * Chaque étape est une fonction pure `(entrée, étapes précédentes) → sortie`.
 * Les solides et développés sont décrits **analytiquement** ici (ADR-0001) ; le package
 * `@blondel/geometry` les convertit en maillages, `@blondel/exports` en fichiers.
 */
import type { Curve2, Frame3, Mm, Polygon2, Shape2, Vec2, Vec3 } from "./primitives.js";

// ------------------------------------------------------------------ Étape 2 : tracé

export interface TurnZone {
  /** Indice du tournant dans `LayoutSpec.turns`. */
  readonly index: number;
  readonly direction: "left" | "right";
  readonly mode: "winders" | "landing";
  /** Coin intérieur (sommet du jour) et coin extérieur, repère monde. */
  readonly innerCorner: Vec2;
  readonly outerCorner: Vec2;
  /** Intervalle d'abscisse sur la ligne de foulée couvert par le tournant (partie courbe / palier). */
  readonly sStart: Mm;
  readonly sEnd: Mm;
}

export interface Layout {
  /** Bord intérieur (jour) et extérieur (mur), orientés dans le sens de la montée, repère monde. */
  readonly inner: Curve2;
  readonly outer: Curve2;
  /** Ligne de foulée de conception (équipartition des girons). */
  readonly walkline: Curve2;
  /** Distance ligne de foulée ↔ bord intérieur. */
  readonly walklineOffset: Mm;
  /** Emprise en plan (contour de l'escalier). */
  readonly footprint: Polygon2;
  readonly turns: readonly TurnZone[];
  /** Côté « intérieur » : gauche si les tournants vont à gauche. Droit : gauche par convention. */
  readonly innerSide: "left" | "right";
}

// ------------------------------------------------------------------ Étape 3 : découpage

export interface NosingLine {
  /** k = 0 … n−1 ; le nez k porte le dessus de la marche k+1 (k = 0 : première marche). */
  readonly index: number;
  /** Abscisse et point sur la ligne de foulée (fixes lors du balancement). */
  readonly s: Mm;
  readonly p: Vec2;
  /** Direction unitaire de la ligne de nez, de l'intérieur vers l'extérieur. */
  readonly dir: Vec2;
  /** Intersections avec le bord intérieur (Q) et extérieur (R), et leurs abscisses. */
  readonly q: Vec2;
  readonly r: Vec2;
  readonly sigmaInner: Mm;
  readonly sigmaOuter: Mm;
  /** Altitude du dessus de marche (sol fini). */
  readonly z: Mm;
  readonly balanced: boolean;
}

export type TreadKind = "straight" | "winder" | "landing";

export interface Tread {
  /** Numéro de marche 1 … n−1 (la dernière hauteur arrive au plancher). */
  readonly number: number;
  readonly kind: TreadKind;
  /** Altitude du dessus (sol fini). */
  readonly z: Mm;
  /** Contour en plan de la surface de marche visible (entre nez k et nez k+1), sans débord. */
  readonly walkingSurface: Polygon2;
  /** Contour en plan de la pièce, débord de nez compris. */
  readonly outline: Polygon2;
  /** Giron sur la ligne de foulée (constant par construction hors paliers). */
  readonly going: Mm;
  /** Collet : longueur d'arc sur le jour et corde (conformité). */
  readonly colletArc: Mm;
  readonly colletChord: Mm;
  /** Giron côté mur. */
  readonly goingOuter: Mm;
}

export interface Stepping {
  /** Nombre de hauteurs de marche. */
  readonly riserCount: number;
  /** Hauteurs individuelles (la première peut différer), somme = H exactement. */
  readonly rises: readonly Mm[];
  /** Hauteur nominale H / n. */
  readonly rise: Mm;
  /** Giron nominal sur la ligne de foulée. */
  readonly going: Mm;
  /** 2h + g. */
  readonly blondel: Mm;
  /** Reculement (projection horizontale totale sur la ligne de foulée). */
  readonly run: Mm;
  readonly nosings: readonly NosingLine[];
  readonly treads: readonly Tread[];
  /** Zones balancées retenues (indices de nez), par tournant. */
  readonly balancedZones: readonly { turn: number; from: number; to: number; method: string }[];
  /** Diagnostics non bloquants du calcul (ex. « jour trop court, marches ajoutées »). */
  readonly notes: readonly string[];
}

// ------------------------------------------------------------------ Étapes 4-6 : pièces

export type MaterialId =
  | "wood-oak"
  | "wood-beech"
  | "wood-ash"
  | "wood-pine"
  | "wood-glulam"
  | "steel-raw"
  | "steel-painted"
  | "steel-galvanized"
  | "stainless-brushed"
  | "glass"
  | "concrete";

/** Description analytique d'un solide ; convertie en maillage par @blondel/geometry. */
export type SolidDesc =
  /** Profil plan (dans le plan XY du repère) extrudé selon +Z du repère sur `depth`. */
  | {
      readonly kind: "extrusion";
      readonly frame: Frame3;
      readonly profile: Shape2;
      readonly depth: Mm;
    }
  /** Surface réglée entre deux polylignes 3D de même nombre de points, épaissie (limons courbes). */
  | {
      readonly kind: "ruled";
      readonly a: readonly Vec3[];
      readonly b: readonly Vec3[];
      readonly thickness: Mm;
      /** Direction d'épaississement par point (normale horizontale). */
      readonly normals: readonly Vec2[];
    }
  /** Balayage d'une section le long d'une polyligne 3D (main courante, tube). */
  | { readonly kind: "sweep"; readonly path: readonly Vec3[]; readonly section: Shape2 };

/** Développé à plat pour la fabrication (découpe, pliage, gabarit). Coordonnées en mm, 1:1. */
export interface FlatPattern {
  readonly outline: Shape2;
  /** Lignes de pli (tôle), de traçage (mortaises, reports), de roulage (débillardé). */
  readonly lines: readonly {
    readonly kind: "bend" | "mark" | "roll" | "joint" | "text";
    readonly a: Vec2;
    readonly b: Vec2;
    readonly label?: string;
    /** Pli : angle (degrés) et sens. */
    readonly bendAngle?: number;
    readonly bendUp?: boolean;
  }[];
  readonly thickness: Mm;
}

export type PartCategory =
  | "tread"
  | "riser"
  | "stringer"
  | "carriage"
  | "support"
  | "post"
  | "handrail"
  | "baluster"
  | "infill"
  | "landing"
  | "fixing";

export interface Part {
  /** Identifiant stable dans le projet (ex. `tread-5`, `stringer-inner-1`). */
  readonly id: string;
  /** Repère de fabrication affiché et gravé (ex. `M5`, `LI1`). */
  readonly mark: string;
  readonly category: PartCategory;
  readonly name: string;
  readonly material: MaterialId;
  readonly solid: SolidDesc;
  readonly flat?: FlatPattern;
  /** Section commerciale éventuelle (ex. `UPN 200`, `plat 250×10`, `40×300`). */
  readonly section?: string;
  /** Débit : dimensions brutes de la pièce (L × l × e) en mm. */
  readonly stock?: { readonly length: Mm; readonly width: Mm; readonly thickness: Mm };
  /** Grandeurs de coût/nomenclature (masse kg, volume m³, cordons mm, plis, coupes…). */
  readonly quantities: Readonly<Record<string, number>>;
  /** Direction du fil (bois) dans le repère du solide, pour les textures. */
  readonly grain?: Vec3;
}

// ------------------------------------------------------------------ Conformité

export type Severity = "bloquant" | "avertissement" | "conseil";
export type RuleStatus = "ok" | "violation" | "non-evaluee";

export type Location =
  | { readonly kind: "stair" }
  | { readonly kind: "tread"; readonly number: number }
  | { readonly kind: "nosing"; readonly index: number }
  | { readonly kind: "part"; readonly partId: string }
  | { readonly kind: "point"; readonly at: Vec3 };

export interface RuleResult {
  readonly ruleId: string;
  readonly description: string;
  readonly status: RuleStatus;
  /** Sévérité effective (après profil souple et surcharges utilisateur). */
  readonly severity: Severity;
  /** Sévérité déclarée dans rules.yaml. */
  readonly declaredSeverity: Severity;
  readonly measured?: number;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly unit?: string;
  readonly location: Location;
  readonly nature: string;
  readonly confidence: string;
  readonly source: string;
  readonly secondarySource: boolean;
  /** Raison d'une rétrogradation (profil souple, surcharge avec justification). */
  readonly downgradeReason?: string;
  readonly message: string;
}

export interface ComplianceReport {
  readonly rulesVersion: number;
  readonly contexts: readonly string[];
  readonly profile: "strict" | "souple";
  readonly results: readonly RuleResult[];
  /** Synthèse : nombre de violations par sévérité effective. */
  readonly summary: Readonly<Record<Severity, number>>;
  /**
   * Remarques de résolution (contextes déduits ou inconnus, régime garde-corps supposé,
   * version de règles, surcharges inopérantes). Absent : aucune remarque.
   */
  readonly notes?: readonly string[];
}

/**
 * Échappée sur la largeur des marches (CHALLENGE G4, grandeur (2)) : minimum, sur les segments
 * de nez Q_k R_k situés sous la dalle haute (hors trémie), de (sous-face − z_k). Donnée pour
 * avertissement et objectif du pivot K8 ; ce n'est pas l'échappée réglementaire.
 */
export interface HeadroomOnWidth {
  readonly min: Mm;
  /** Point du segment de nez sous la dalle (à l'altitude du nez z_k). */
  readonly at: Vec3;
  /** Indice du nez critique. */
  readonly nosing: number;
}

// ------------------------------------------------------------------ Résultat global

export interface Model {
  readonly layout: Layout;
  readonly stepping: Stepping;
  readonly parts: readonly Part[];
  readonly compliance: ComplianceReport;
  /**
   * Échappée minimale mesurée (verticale, sur la ligne de foulée, décision Q4) et point critique.
   * `at` est le point de la **ligne de pente** (x, y sur Γ, z = altitude de la ligne de pente)
   * où l'échappée est minimale ; le plafond est à `at.z + min`. Absent : pas de trémie, aucun
   * plafond au-dessus de la ligne de foulée, ou modèle partiel.
   */
  readonly headroom?: { readonly min: Mm; readonly at: Vec3 };
  /** Échappée sur la largeur des marches (avertissement, CHALLENGE G4). */
  readonly headroomWidth?: HeadroomOnWidth;
  /** Erreurs de génération (paramètres impossibles) : le modèle peut être partiel. */
  readonly errors: readonly string[];
  /** Remarques non bloquantes du pipeline (pièces non générées, hypothèses). */
  readonly notes?: readonly string[];
}
