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
import type { PrecheckedBeam } from "../precheck/checks.js";
import type { StairLoads } from "../precheck/loads.js";
import type { Curve2, Frame3, Mm, Polygon2, Rad, Shape2, Vec2, Vec3 } from "./primitives.js";

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
  /**
   * Côté du jour (collet) de ce tournant, dans le sens de la montée : égal à `direction` pour un
   * tournant à 90°. Ajout rétrocompatible (facultatif) : dans un escalier en S ou en Z, le jour
   * du second tournant est du côté **opposé** à `Layout.innerSide` (son jour est alors porté par
   * la courbe `Layout.outer`). Absent : `Layout.innerSide`.
   */
  readonly collarSide?: "left" | "right";
}

/**
 * Transition de la ligne de foulée dans une volée intermédiaire d'escalier en S ou en Z quand
 * d_f ≠ E/2 (E > 1 200 mm en DTU, ou distance saisie) : la distance au jour change de côté
 * d'un tournant à l'autre. Raccord linéaire de d_f le long de la partie droite de la volée
 * (défaut Blondel, point en suspens du ledger) : Γ y est un segment oblique, anguleux à ses
 * extrémités.
 */
export interface WalklineTransition {
  /** Indice de la volée (0 = première). */
  readonly leg: number;
  /** Intervalle d'abscisse sur Γ de la partie oblique. */
  readonly sStart: Mm;
  readonly sEnd: Mm;
  /** Distances de Γ au bord `Layout.inner` au début et à la fin de la partie oblique. */
  readonly fromOffset: Mm;
  readonly toOffset: Mm;
  /** Direction de montée de la volée (unitaire, repère monde) : les nez y restent perpendiculaires. */
  readonly direction: Vec2;
  /** Angle (rad, > 0) entre Γ et la direction de la volée. */
  readonly angle: Rad;
}

/**
 * Géométrie d'un tracé hélicoïdal (jalon 5a, B §1.1, §4.3), repère monde. Angles en radians,
 * mesurés dans le sens trigonométrique depuis +X du repère monde (rotation du placement
 * comprise). La ligne de nez k est portée par le rayon d'angle
 * θ_k = `startAngle` + sens · k · `stepAngle`, sens = +1 pour `left`, −1 pour `right`.
 */
export interface HelicalLayout {
  /** Axe vertical (centre des arcs C_i, C_e et Γ). */
  readonly center: Vec2;
  readonly direction: "left" | "right";
  /** Fût central (`column`) ou jour central (`well`). */
  readonly core: "column" | "well";
  /** Rayon de C_i (r_f ou r_j), de C_e (R_e) et de Γ (r_i + d_f). */
  readonly innerRadius: Mm;
  readonly outerRadius: Mm;
  readonly walklineRadius: Mm;
  /** Angle de la ligne de nez de départ (nez 0). */
  readonly startAngle: Rad;
  /** Angle par marche Δθ (> 0). */
  readonly stepAngle: Rad;
  /** Nombre de marches par tour 2π / Δθ (non entier si l'angle total est imposé). */
  readonly treadsPerTurn: number;
  /** Angle total des marches, du nez 0 au nez d'arrivée : (n − 1)·Δθ. */
  readonly totalAngle: Rad;
  /** Palier d'arrivée : secteur de `landingAngle` (> 0) à partir du nez d'arrivée, contour en plan. */
  readonly landingAngle: Rad;
  readonly landingOutline?: Polygon2;
}

export interface Layout {
  /** Bord intérieur (jour) et extérieur (mur), orientés dans le sens de la montée, repère monde. */
  readonly inner: Curve2;
  readonly outer: Curve2;
  /** Ligne de foulée de conception (équipartition des girons). */
  readonly walkline: Curve2;
  /**
   * Distance ligne de foulée ↔ bord du jour (d_f) ; escalier droit : ↔ bord `walklineSide`.
   * Escalier en S ou en Z : distance au jour du
   * tournant voisin (côté `TurnZone.collarSide`), égale de part et d'autre ; voir
   * `walklineTransitions` pour la partie où elle change de côté.
   */
  readonly walklineOffset: Mm;
  /** Emprise en plan (contour de l'escalier). */
  readonly footprint: Polygon2;
  /**
   * Trous de l'emprise (ajout rétrocompatible) : hélicoïdal de plus d'un tour, disque du jour
   * central de rayon R_i (fût ou jour), que `footprint` (disque de R_e) ne peut pas exclure.
   * Absent : aucun trou.
   */
  readonly footprintHoles?: readonly Polygon2[];
  /**
   * Anomalies du tracé qui ne l'empêchent pas d'être calculé (emprise dégénérée : volées qui se
   * touchent ou se superposent en plan, bord intérieur de longueur nulle), reprises dans
   * `Model.errors`. Absent : aucune.
   */
  readonly errors?: readonly string[];
  readonly turns: readonly TurnZone[];
  /**
   * Côté « intérieur » : gauche si les tournants vont à gauche. Droit : gauche par convention.
   * Escalier en S ou en Z : côté du jour du **premier** tournant (`inner` est la courbe de ce
   * côté sur toute la montée ; le jour d'un tournant de sens opposé est sur `outer`).
   */
  readonly innerSide: "left" | "right";
  /**
   * Escalier droit seulement : bord depuis lequel `walklineOffset` est mesurée (décision A16,
   * choix de l'utilisateur ou côté de la main courante principale). `innerSide` n'en dépend
   * pas. Absent (tournants, hélicoïdal) : d_f est mesurée depuis le jour.
   */
  readonly walklineSide?: "left" | "right";
  /**
   * Transitions de la ligne de foulée (escalier en S ou en Z, d_f ≠ E/2). Ajout rétrocompatible :
   * absent ou vide, Γ reste à `walklineOffset` du bord `inner` hors tournants de sens opposé.
   */
  readonly walklineTransitions?: readonly WalklineTransition[];
  /**
   * Tracé hélicoïdal (jalon 5a) : axe, rayons, angles. Absent : escalier à volées. Un tracé
   * hélicoïdal n'a pas de tournant à 90° (`turns` vide) ; `footprint` est le secteur de couronne
   * des marches et du palier d'arrivée (le disque de rayon R_e au-delà d'un tour, avec le trou
   * du jour central dans `footprintHoles`).
   */
  readonly helical?: HelicalLayout;
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
  /**
   * Zones balancées retenues (indices de nez), par tournant. `ends` et `continuation` (ajouts
   * rétrocompatibles, facultatifs) : conditions aux extrémités et prolongement de la courbe F
   * retenus par le découpage (`BalancingZone`), pour reconstituer F (limon débillardé).
   */
  readonly balancedZones: readonly {
    turn: number;
    from: number;
    to: number;
    method: string;
    ends?: readonly ["tangent" | "free", "tangent" | "free"];
    /**
     * M2 (herse) : borne supérieure de l'angle α (degrés) pour cette zone, plus petite
     * α_eq = arccos(L_c / (m·g)) de ses demi-zones (curseur borné, B §3.4). Ajout facultatif.
     */
    herseAlphaMax?: number;
    continuation?: readonly [
      { readonly nosings: readonly number[]; readonly end: "tangent" | "free" } | null,
      { readonly nosings: readonly number[]; readonly end: "tangent" | "free" } | null,
    ];
  }[];
  /** Diagnostics non bloquants du calcul (ex. « jour trop court, marches ajoutées »). */
  readonly notes: readonly string[];
  /**
   * Sous-faces de l'escalier lui-même qui forment un plafond pour les parties plus basses
   * (auto-recouvrement, CHALLENGE G4 : marches du tour supérieur et palier d'arrivée d'un
   * hélicoïdal). Absent : aucun auto-recouvrement pris en compte (escaliers à volées).
   */
  readonly soffits?: readonly Soffit[];
  /**
   * Découpage d'un tracé **hélicoïdal** (nez rayonnants, `stepping/helical.ts`) : le moteur de
   * règles en déduit le contexte de forme `helicoidal`. Absent : escalier à volées (ajout
   * rétrocompatible).
   */
  readonly helical?: true;
}

/**
 * Sous-face d'une pièce de l'escalier (marche, palier), plafond pour l'échappée (CHALLENGE G4).
 * Elle ne compte qu'au-dessus des points de Γ d'abscisse **inférieure** à `sStart` (pièce située
 * plus loin dans la montée) : la marche sur laquelle on se tient et les précédentes sont exclues.
 */
export interface Soffit {
  /** Contour en plan de la pièce (repère monde). */
  readonly outline: Polygon2;
  /** Altitude de la sous-face. */
  readonly z: Mm;
  /** Abscisse sur Γ du début de la pièce (nez avant). */
  readonly sStart: Mm;
  /** Numéro de marche ; absent : palier d'arrivée. */
  readonly tread?: number;
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

/**
 * Description analytique d'un solide ; convertie en maillage par @blondel/geometry. Solides
 * dégénérés (profondeur ou épaisseur nulle, section plate, balayage auto-intersecté) : signalés
 * dans `Model.errors` (`parts/solidChecks.ts`) et non maillés (message de maillage).
 */
export type SolidDesc =
  /** Profil plan (dans le plan XY du repère) extrudé selon +Z du repère sur `depth` (≠ 0). */
  | {
      readonly kind: "extrusion";
      readonly frame: Frame3;
      readonly profile: Shape2;
      readonly depth: Mm;
    }
  /**
   * Surface réglée entre deux polylignes 3D de même nombre de points, épaissie (limons courbes).
   * Chaque section (a[i], b[i], b[i] + e·n, a[i] + e·n) doit avoir une aire non nulle, extrémités
   * comprises : un limon qui finit « en pointe » s'arrête sur une section de hauteur non nulle.
   */
  | {
      readonly kind: "ruled";
      readonly a: readonly Vec3[];
      readonly b: readonly Vec3[];
      readonly thickness: Mm;
      /** Direction d'épaississement par point (normale horizontale). */
      readonly normals: readonly Vec2[];
    }
  /**
   * Balayage d'une section le long d'une polyligne 3D (main courante, tube).
   *
   * Orientation de la section (u, v) : v est « le haut » de la section, u = v × tangente (à
   * gauche dans le sens de parcours). Repère `upright` (défaut) : v = verticale +Z projetée sur
   * le plan normal au segment (section d'aplomb, sans dévers : main courante) ; segment vertical,
   * repère transporté du précédent (v = +Y pour un premier segment vertical). `parallel` :
   * transport parallèle depuis le premier segment (rotation minimale ; sur une hélice, la
   * section tourne autour de la tangente). Aux sommets, coupe d'onglet dans le plan bissecteur ;
   * les onglets d'un même segment ne doivent pas se croiser (virage trop serré pour la section
   * ou proche de 180°), ni deux parties éloignées du chemin se toucher.
   */
  | {
      readonly kind: "sweep";
      readonly path: readonly Vec3[];
      readonly section: Shape2;
      /** Repère de section (défaut : `upright`, ou l'option de maillage). */
      readonly frame?: "upright" | "parallel";
    };

/** Développé à plat pour la fabrication (découpe, pliage, gabarit). Coordonnées en mm, 1:1. */
export interface FlatPattern {
  readonly outline: Shape2;
  /** Lignes de pli (tôle), de traçage (mortaises, reports), de roulage (débillardé). */
  readonly lines: readonly {
    readonly kind: "bend" | "mark" | "roll" | "joint" | "text";
    readonly a: Vec2;
    readonly b: Vec2;
    readonly label?: string;
    /**
     * Pli : angle (degrés) et sens. `bendUp` : l'aile se relève vers l'observateur du
     * développé (face vue = face de référence déclarée par `reference`).
     */
    readonly bendAngle?: number;
    readonly bendUp?: boolean;
    /** Pli : rayon intérieur r_int (mm) de l'outillage retenu (loi de pli du profil d'atelier). */
    readonly bendRadius?: Mm;
    /**
     * Traçage (`kind: "mark"`) : nature de l'usinage tracé. `mortise` = contour d'une mortaise
     * ou d'un encastrement de marche / contremarche (limon à la française, B §4.1), `tenon` =
     * contour d'un tenon. Absent : traçage générique (reports de nez, niveaux, naissances).
     * Les exports placent les mortaises sur un calque / un style dédiés.
     */
    readonly feature?: "mortise" | "tenon";
    /** Profondeur de l'usinage borgne (mortaise), mm ; annotation seulement. */
    readonly depth?: Mm;
  }[];
  readonly thickness: Mm;
  /**
   * Fibre de référence du développé (CHALLENGE G6) : face tracée (`face`, ex. face intérieure
   * d'un limon, côté marches) ou fibre neutre (`neutral-fiber`, tôle pliée). `description`
   * précise le repère (axes, sens de vue). Absent : non déclarée.
   */
  readonly reference?: {
    readonly kind: "face" | "neutral-fiber";
    readonly description: string;
  };
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

/**
 * Famille d'une pièce, selon l'étape qui l'a produite (QUESTIONS D6) : marches, contremarches et
 * paliers (pièces de base, ou pièces d'un plugin qui les remplacent) ; ossature (pièces propres
 * au plugin de structure) ; garde-corps et mains courantes (`computeGuards`).
 */
export type PartFamilyId = "treads" | "structure" | "guards";

export interface Part {
  /**
   * Identifiant stable dans le projet (ex. `tread-5`, `stringer-inner-1`). Ne pas en déduire la
   * famille ni le numéro de marche : voir `family` et `treadNumber`.
   */
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
  /**
   * Famille de la pièce, renseignée par le pipeline (`buildModel`) pour toutes les pièces du
   * `Model` ; facultative pour les pièces rendues directement par une étape (plugin, tests).
   */
  readonly family?: PartFamilyId;
  /**
   * Numéro de la marche (ou du palier) que la pièce matérialise (`Tread.number`) : dessus de
   * marche ou de palier seulement (surlignage marche ↔ pièce). Une pièce de plugin qui remplace
   * une marche de base en hérite. Absent : pièce qui n'est pas une marche.
   */
  readonly treadNumber?: number;
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
  /**
   * Justification saisie par l'utilisateur, jointe au contrôle sans le lever (note de calcul,
   * avis technique : porte-à-faux hélicoïdal, décision A12 du 2026-09-30), reprise dans le
   * dossier. Absente : aucune.
   */
  readonly justification?: string;
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

// ------------------------------------------------------------------ Prédimensionnement

/**
 * Prédimensionnement indicatif des limons (CHALLENGE P5) rendu par le pipeline : **seule
 * source** du panneau de prédimensionnement et du comparateur. Calculé par le plugin de
 * structure quand il en fait un (`StructureOutput.precheck`, ex. `steel-profile` qui choisit
 * sa section avec), sinon par `precheckStringers` sur les pièces du modèle. Les lignes
 * PRECHECK_* du contrôle de conception, quand elles existent, viennent du même calcul.
 */
export interface ModelPrecheck {
  readonly beams: readonly PrecheckedBeam[];
  readonly loads: StairLoads;
  /** Charge permanente répartie en plan (kN/m²). */
  readonly permanentArea: number;
  readonly notes: readonly string[];
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
  /** Échappée sur la largeur des marches (règle ECHAPPEE_LARGEUR, CHALLENGE G4). */
  readonly headroomWidth?: HeadroomOnWidth;
  /**
   * Échappée non limitée par la dalle haute (trémie couvrante, QUESTIONS A7) : `walkline` si
   * aucun point de la ligne de foulée n'est sous la dalle (`headroom` absent), `width` si aucun
   * nez de marche ne l'est (`headroomWidth` absent). Absent : sans trémie ni plafond (échappée
   * non calculée) ou échappée limitée sur les deux grandeurs. Lu tel quel par l'interface.
   */
  readonly headroomUnlimited?: { readonly walkline: boolean; readonly width: boolean };
  /**
   * Classe d'exécution EN 1090-2 déduite par la structure métal (`StructureOutput.executionClass`,
   * SPEC §2.4). Absent : structure sans pièce métal ou pipeline qui ne la reporte pas.
   */
  readonly executionClass?: "EXC1" | "EXC2";
  /**
   * Prédimensionnement indicatif des limons (voir `ModelPrecheck`). Absent : modèle incomplet
   * (tracé ou découpage en erreur) ou calcul en échec.
   */
  readonly precheck?: ModelPrecheck;
  /**
   * Plancher haut repris du site (QUESTIONS D5) : les exports (plan, élévation, DXF, notice de
   * pose) le lisent ici plutôt que dans le projet. Absent : modèle construit hors pipeline.
   */
  readonly upperFloor?: ModelUpperFloor;
  /** Erreurs de génération (paramètres impossibles) : le modèle peut être partiel. */
  readonly errors: readonly string[];
  /** Remarques non bloquantes du pipeline (pièces non générées, hypothèses). */
  readonly notes?: readonly string[];
}

/** Plancher haut et trémie, dans le repère du site (celui du tracé, `placement` appliqué). */
export interface ModelUpperFloor {
  /** Épaisseur du plancher haut, sol fini → sous-face (`site.upperSlabThickness`). */
  readonly slabThickness: Mm;
  /**
   * Contour de la trémie, dans l'ordre de saisie (rectangle : coin min puis sens trigonométrique).
   * Absent : pas de trémie (escalier extérieur ou sans plancher au-dessus).
   */
  readonly opening?: Polygon2;
}
