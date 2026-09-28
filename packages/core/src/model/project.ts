/**
 * Modèle de projet sérialisé (JSON versionné, validé par zod).
 * C'est la **seule** entrée du pipeline : tout le reste est dérivé (fonctions pures).
 * Voir ADR-0002 (modèle de données) et ADR-0003 (unités).
 */
import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 1 as const;

/** mm entier saisi par l'utilisateur. */
const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();

export const Vec2Schema = z.object({ x: z.number(), y: z.number() });

// ------------------------------------------------------------------ Site

export const OpeningSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rect"),
    /** Coin min (x, y) de la trémie dans le repère du site. */
    x: mmInt,
    y: mmInt,
    /** Dimension selon X. */
    sizeX: mmPos,
    /** Dimension selon Y. */
    sizeY: mmPos,
  }),
  z.object({ kind: z.literal("polygon"), points: z.array(Vec2Schema).min(3) }),
]);
export type Opening = z.infer<typeof OpeningSchema>;

export const WallSchema = z.object({
  id: z.string(),
  a: Vec2Schema,
  b: Vec2Schema,
  thickness: mmPos,
  loadBearing: z.boolean(),
});
export type Wall = z.infer<typeof WallSchema>;

export const SiteSchema = z.object({
  /** Hauteur à monter H, sol fini bas → sol fini haut. */
  floorToFloor: mmPos,
  /** Épaisseur de revêtement du sol bas (information ; H est déjà en sol fini). */
  lowerFinish: mmNonNeg.default(0),
  /** Épaisseur de revêtement du sol haut. */
  upperFinish: mmNonNeg.default(0),
  /** Épaisseur du plancher haut, sol fini → sous-face (échappée, trémie). */
  upperSlabThickness: mmPos,
  /** Trémie du plancher haut ; absente = escalier extérieur ou sans plancher au-dessus. */
  opening: OpeningSchema.optional(),
  walls: z.array(WallSchema).default([]),
});
export type Site = z.infer<typeof SiteSchema>;

// ------------------------------------------------------------------ Tracé

/** Forme du jour (bord intérieur) dans un tournant. */
export const InnerCornerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sharp") }),
  z.object({ kind: z.literal("arc"), radius: mmPos }),
  /** Poteau carré de côté `size`, centré sur le coin intérieur. */
  z.object({ kind: z.literal("newel"), size: mmPos }),
]);
export type InnerCorner = z.infer<typeof InnerCornerSchema>;

export const TurnSchema = z.object({
  direction: z.enum(["left", "right"]),
  /** Marches balancées dans le tournant, ou palier d'angle. */
  mode: z.enum(["winders", "landing"]),
  inner: InnerCornerSchema.default({ kind: "sharp" }),
});
export type Turn = z.infer<typeof TurnSchema>;

export const LegSchema = z.object({
  /**
   * Longueur de la volée mesurée sur le bord **extérieur** (côté mur des tournants), du départ
   * (ou de l'angle précédent) à l'arrivée (ou à l'angle suivant). `auto` : seulement pour un
   * escalier droit, longueur = reculement déduit du giron cible.
   */
  length: z.union([mmPos, z.literal("auto")]),
});
export type Leg = z.infer<typeof LegSchema>;

/**
 * Tracé générique : N volées reliées par N−1 tournants à 90°.
 * Droit = 1 volée ; quart tournant = 2 ; deux quarts (U) / demi-tournant = 3 volées,
 * la volée centrale d'un demi-tournant balancé ayant la longueur 2E + jour.
 * Repère local : départ sur le segment (0,0)–(E,0), montée selon +Y, x = 0 côté gauche.
 */
export const LayoutSpecSchema = z.object({
  width: mmPos,
  legs: z.array(LegSchema).min(1),
  turns: z.array(TurnSchema),
});
export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

export const PlacementSchema = z.object({
  origin: Vec2Schema,
  rotation: z.number().default(0),
});

export const WalklineSchema = z.discriminatedUnion("mode", [
  /** DTU 36.3 : milieu si E ≤ 1 200, sinon 600 mm du bord intérieur. */
  z.object({ mode: z.literal("dtu") }),
  z.object({ mode: z.literal("fromInner"), distance: mmPos }),
]);

export const SteppingSchema = z.object({
  /** Nombre de hauteurs n ; `auto` = arrondi(H / targetRise). */
  riserCount: z.union([z.number().int().min(2).max(60), z.literal("auto")]).default("auto"),
  targetRise: mmPos.default(175),
  /** Giron cible, utilisé seulement si une longueur de volée est `auto`. `auto` = 630 − 2h. */
  targetGoing: z.union([mmPos, z.literal("auto")]).default("auto"),
  /** Correction de la hauteur de la première marche (compensation de revêtement), mm signé. */
  firstRiseOffset: mmInt.default(0),
});

export const BalancingSchema = z.object({
  method: z.enum(["M0", "M1", "M3"]).default("M3"),
  /** Variante M3 : cubique (C1) ou quintique (C2). `auto` = selon la structure (décision Q7). */
  variant: z.enum(["cubic", "quintic", "auto"]).default("auto"),
  /** Marches balancées de chaque côté de la marche d'angle ; `auto` = plus petit nombre respectant le collet mini. */
  windersPerSide: z.union([z.number().int().min(1).max(8), z.literal("auto")]).default("auto"),
  /** Collet cible pour le choix automatique (corde, mm). */
  targetCollet: mmPos.default(100),
});

export const TreadSpecSchema = z.object({
  thickness: mmPos.default(40),
  /** Débord du nez sur la contremarche. */
  nosing: mmNonNeg.default(30),
  risers: z.enum(["full", "open", "none"]).default("full"),
  riserThickness: mmPos.default(20),
});

// ------------------------------------------------------------------ Structure (plugins)

/**
 * Spécification de structure : union discriminée par `kind` (clé de plugin `StructureKind`).
 * Chaque plugin valide ses propres paramètres (`params`) ; le schéma projet reste ouvert.
 */
export const StructureSpecSchema = z.object({
  kind: z.string().default("none"),
  params: z.record(z.string(), z.unknown()).prefault({}),
});
export type StructureSpec = z.infer<typeof StructureSpecSchema>;

/**
 * Surcharges du mode expert (persistées, typées) : elles s'appliquent sur des nez identifiés
 * par leur indice ; si l'indice n'existe plus après régénération, la surcharge est déclarée
 * « orpheline » dans le modèle et n'est pas appliquée (docs/CHALLENGE.md §A4).
 */
export const NosingOverrideSchema = z.discriminatedUnion("kind", [
  /** Nez fixe : non balancé, perpendiculaire à la ligne de foulée (borne de zone). */
  z.object({ kind: z.literal("fixed"), index: z.number().int().nonnegative() }),
  /** Angle imposé de la ligne de nez (degrés, écart à la perpendiculaire à la ligne de foulée). */
  z.object({ kind: z.literal("angle"), index: z.number().int().nonnegative(), angle: z.number() }),
]);
export type NosingOverride = z.infer<typeof NosingOverrideSchema>;

export const StairSchema = z.object({
  placement: PlacementSchema,
  layout: LayoutSpecSchema,
  walkline: WalklineSchema.default({ mode: "dtu" }),
  stepping: SteppingSchema.prefault({}),
  balancing: BalancingSchema.prefault({}),
  treads: TreadSpecSchema.prefault({}),
  structure: StructureSpecSchema.default({ kind: "none", params: {} }),
  nosingOverrides: z.array(NosingOverrideSchema).default([]),
});
export type Stair = z.infer<typeof StairSchema>;

// ------------------------------------------------------------------ Conformité

export const RuleOverrideSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["bloquant", "avertissement", "conseil", "ignore"]),
  justification: z.string().min(1),
});

export const ComplianceSettingsSchema = z.object({
  /** Contextes cumulés de rules.yaml (`tous` est implicite). */
  contexts: z.array(z.string()).default(["bois_dtu", "logement_interieur"]),
  profile: z.enum(["strict", "souple"]).default("strict"),
  /** Date de dépôt PC/DP ou de marché (ISO), pilote le régime garde-corps 1988 / 2024. */
  referenceDate: z.string().optional(),
  overrides: z.array(RuleOverrideSchema).default([]),
});
export type ComplianceSettings = z.infer<typeof ComplianceSettingsSchema>;

// ------------------------------------------------------------------ Projet

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  name: z.string().default("Sans titre"),
  /** Version du jeu de règles utilisé (rules.yaml `version`), enregistrée avec le rapport. */
  rulesVersion: z.number().int().default(1),
  site: SiteSchema,
  stair: StairSchema,
  compliance: ComplianceSettingsSchema.prefault({}),
});
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
