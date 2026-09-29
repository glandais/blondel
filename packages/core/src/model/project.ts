/**
 * Modèle de projet sérialisé (JSON versionné, validé par zod).
 * C'est la **seule** entrée du pipeline : tout le reste est dérivé (fonctions pures).
 * Voir ADR-0002 (modèle de données) et ADR-0003 (unités).
 */
import { z } from "zod";
import { GuardsSpecSchema } from "../guards/spec.js";
import { WorkshopProfileSchema } from "../workshop/profile.js";

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

/**
 * Mur du site : `a`–`b` est l'**axe** du mur (convention retenue au jalon 4 par les garde-corps,
 * `guards/sides.ts`), `thickness` son épaisseur totale (nus à ± thickness / 2 de l'axe).
 */
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
 * Tracé « à volées » : N volées reliées par N−1 tournants à 90°.
 * Droit = 1 volée ; quart tournant = 2 ; deux quarts (U) / demi-tournant = 3 volées,
 * la volée centrale d'un demi-tournant balancé ayant la longueur 2E + jour.
 * Repère local : départ sur le segment (0,0)–(E,0), montée selon +Y, x = 0 côté gauche.
 *
 * `kind` est facultatif (jalon 5a) : les projets antérieurs, sans `kind`, restent des escaliers
 * à volées ; il n'est jamais ajouté à la lecture, pour que leur sérialisation reste identique.
 */
export const FlightsLayoutSpecSchema = z.object({
  kind: z.literal("flights").optional(),
  width: mmPos,
  legs: z.array(LegSchema).min(1),
  turns: z.array(TurnSchema),
});
export type FlightsLayoutSpec = z.infer<typeof FlightsLayoutSpecSchema>;

/**
 * Bord intérieur d'un hélicoïdal (B §1.1) : fût central de rayon r_f (`column`, marches portées
 * par le fût) ou jour central de rayon r_j (`well`, limon intérieur hélicoïdal ou vide).
 */
export const HelicalCoreSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("column"), radius: mmPos }),
  z.object({ kind: z.literal("well"), radius: mmPos }),
]);
export type HelicalCore = z.infer<typeof HelicalCoreSchema>;

/** Nombre maximal de marches par tour accepté (Δθ ≥ 6°) ; au moins 3 (Δθ < 180°). */
export const HELICAL_TREADS_PER_TURN_MIN = 3;
export const HELICAL_TREADS_PER_TURN_MAX = 60;

/**
 * Rotation de l'hélicoïdal : angle total des marches (degrés, du nez de départ au nez
 * d'arrivée : Δθ = angle / (n − 1)) **ou** nombre de marches par tour (Δθ = 360° / N).
 */
export const HelicalSweepSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("angle"), degrees: z.number().positive().max(2160) }),
  z.object({
    mode: z.literal("treadsPerTurn"),
    count: z.number().int().min(HELICAL_TREADS_PER_TURN_MIN).max(HELICAL_TREADS_PER_TURN_MAX),
  }),
]);
export type HelicalSweep = z.infer<typeof HelicalSweepSchema>;

const HelicalLayoutInputSchema = z
  .object({
    kind: z.literal("helical"),
    /** Sens de rotation en montant : `left` = trigonométrique vu de dessus (axe à gauche). */
    direction: z.enum(["left", "right"]),
    /** Rayon extérieur R_e (bout des marches, face intérieure du limon extérieur éventuel). */
    outerRadius: mmPos,
    core: HelicalCoreSchema,
    sweep: HelicalSweepSchema,
    /** Angle (degrés, trigonométrique depuis +X du repère local) de la ligne de nez de départ. */
    startAngle: z.number().default(0),
    /**
     * Palier d'arrivée en secteur, au niveau du plancher haut, à partir du nez d'arrivée
     * (angle en degrés, < 360). Absent : pas de palier (arrivée directe sur le plancher).
     */
    landing: z.object({ angle: z.number().positive().lt(360) }).optional(),
    /**
     * Champs dérivés (voir `HelicalLayoutSpecSchema`) : acceptés en entrée pour qu'un projet lu
     * puisse être relu tel quel, **ignorés** et recalculés.
     */
    width: z.number().optional(),
    legs: z.array(LegSchema).max(0).optional(),
    turns: z.array(TurnSchema).max(0).optional(),
  })
  .superRefine((v, ctx) => {
    if (!(v.outerRadius > v.core.radius)) {
      ctx.addIssue({
        code: "custom",
        path: ["outerRadius"],
        message: `le rayon extérieur (${v.outerRadius} mm) doit dépasser le rayon ${v.core.kind === "column" ? "du fût" : "du jour"} (${v.core.radius} mm)`,
      });
    }
  });

/**
 * Tracé hélicoïdal (jalon 5a, B §1.1, §4.3) : marches rayonnantes autour d'un axe vertical,
 * sans balancement. Repère local : axe au point (0, 0), placé par `stair.placement`.
 *
 * Champs **dérivés** ajoutés à la lecture, pour que le code écrit pour les escaliers à volées
 * reste valable : `width` = emmarchement utile E = R_e − r (r = rayon du fût ou du jour),
 * `legs` = [] et `turns` = [] (aucune volée droite ni tournant à 90°). Ils ne sont pas
 * sérialisés (`serializeProject`) et sont recalculés à chaque lecture.
 */
export const HelicalLayoutSpecSchema = HelicalLayoutInputSchema.transform((v) => ({
  ...v,
  width: v.outerRadius - v.core.radius,
  legs: [] as Leg[],
  turns: [] as Turn[],
}));
export type HelicalLayoutSpec = z.infer<typeof HelicalLayoutSpecSchema>;
export type HelicalLayoutSpecInput = z.input<typeof HelicalLayoutSpecSchema>;

/**
 * Tracé : union discriminée par `kind` (ADR-0002, jalon 5a), rétrocompatible : sans `kind`,
 * escalier à volées. Les deux variantes exposent `width`, `legs` et `turns`.
 */
export const LayoutSpecSchema = z.discriminatedUnion("kind", [
  FlightsLayoutSpecSchema,
  HelicalLayoutSpecSchema,
]);
export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

/** Vrai si le tracé est hélicoïdal. */
export function isHelicalLayout(spec: LayoutSpec): spec is HelicalLayoutSpec {
  return spec.kind === "helical";
}

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
  /**
   * Marches balancées de chaque côté de la marche d'angle ; `auto` = choix de zone de
   * CHALLENGE G3 (corrigé le 2026-09-29) : le **moins** de marches balancées dont le collet
   * minimal en corde atteint `targetCollet`, sinon le collet maximal ; étendue bornée par
   * `maxBalancedExtent`.
   */
  windersPerSide: z.union([z.number().int().min(1).max(8), z.literal("auto")]).default("auto"),
  /**
   * Collet cible (corde, mm) du choix automatique : la zone retenue est la plus petite qui
   * l'atteint ; à défaut, celle qui maximise le collet.
   */
  targetCollet: mmPos.default(100),
  /**
   * Choix automatique, quand aucune zone n'atteint `targetCollet` : écart de collet (corde, mm)
   * sous lequel deux zones sont jugées équivalentes au collet maximal (la zone régulière K3,
   * puis celle qui balance le moins de nez, est alors retenue). Absent : 1 mm
   * (`COLLET_TIE_TOLERANCE`, choix Blondel à valider, sans source métier) ; 0 = collet maximal pur.
   */
  colletTieTolerance: mmNonNeg.optional(),
  /**
   * Choix automatique : étendue maximale des marches balancées dans les parties droites, en
   * girons comptés depuis l'angle (début / fin de la partie tournante de la ligne de foulée),
   * K7 (B §2.4, §3.1). Absent : 3,5 (`MAX_BALANCED_EXTENT`, valeur de DIN 18065 — norme
   * **allemande**, source secondaire —, reprise faute de valeur française : à valider).
   */
  maxBalancedExtent: z.number().positive().optional(),
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
  structure: StructureSpecSchema.prefault({}),
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
  /**
   * Profil d'atelier partiel (capacités de débit, seuils de fabrication, masses volumiques) ;
   * absent : profil par défaut (`resolveWorkshopProfile`, valeurs à valider). CHALLENGE A8.
   */
  workshop: WorkshopProfileSchema.optional(),
  /**
   * Garde-corps et mains courantes (jalon 4, `guards/spec.ts`) ; absent : aucun garde-corps
   * généré, règles GC_* / MC_* « non évaluées ». Ajout rétrocompatible.
   */
  guards: GuardsSpecSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
