/**
 * Modèle de projet sérialisé (JSON versionné, validé par zod).
 * C'est la **seule** entrée du pipeline : tout le reste est dérivé (fonctions pures).
 * Voir ADR-0002 (modèle de données) et ADR-0003 (unités).
 */
import { msg, translatorFor } from "@blondel/i18n";
import { z } from "zod";
import { GuardsSpecSchema } from "../guards/spec.js";
import { UnderlaySchema } from "../site/schema.js";
import { WOOD_MATERIALS, WorkshopProfileSchema } from "../workshop/profile.js";

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
  z.object({
    kind: z.literal("polygon"),
    points: z.array(Vec2Schema).min(3),
    /**
     * Trémie circulaire (ajout rétrocompatible, dette D3) : cercle exact dont `points` est le
     * polygone inscrit (`circularOpening`, flèche ≤ 0,5 mm), seul lu par les consommateurs qui ne
     * connaissent pas le cercle. Ignoré s'il ne correspond plus aux points (`openingCircle`).
     */
    circle: z.object({ center: Vec2Schema, radius: z.number().positive() }).optional(),
  }),
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
  /**
   * Calque de fond pour la saisie (jalon 7, `site/schema.ts`) : plan DXF simplifié et / ou image
   * calibrée. Facultatif, jamais lu par le pipeline ; ajout rétrocompatible.
   */
  underlay: UnderlaySchema.optional(),
});
export type Site = z.infer<typeof SiteSchema>;

// ------------------------------------------------------------------ Tracé

/** Forme du jour (bord intérieur) dans un tournant. */
export const InnerCornerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sharp") }),
  z.object({ kind: z.literal("arc"), radius: mmPos }),
  /**
   * Poteau carré de côté `size`, centré sur le coin intérieur K, ou **décalé vers le jour** de
   * `offset` le long des deux faces (centre en K − offset·(n + u), n : normale jour → mur, u :
   * sens de montée de la volée entrante). Le poteau déborde alors de `size/2 − offset` côté
   * marches et de `size/2 + offset` côté jour ; `offset < size/2` (sinon `LayoutError`).
   * Absent : 0 (poteau centré, contrat d'origine). Poteau élargi des profilés (décision A13).
   */
  z.object({ kind: z.literal("newel"), size: mmPos, offset: mmNonNeg.optional() }),
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
      // Texte français pour zod (`issue.message`), `Message` dans `params` (ADR-0007, lu par
      // `zodIssueMessage` de `project/errors.ts`).
      const message = msg(
        v.core.kind === "column"
          ? "model.helical.outerRadiusTooSmall.column"
          : "model.helical.outerRadiusTooSmall.well",
        { outer: String(v.outerRadius), core: String(v.core.radius) },
      );
      ctx.addIssue({
        code: "custom",
        path: ["outerRadius"],
        message: translatorFor("fr").t(message),
        params: { message },
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

/**
 * Bord de mesure de la ligne de foulée d'un **escalier droit** (décision A16 de l'utilisateur,
 * 2026-09-29) : `left` / `right` (bords gauche et droit dans le sens de la montée). Absent :
 * automatique, côté de la main courante principale (côté vide s'il porte un garde-corps, sinon
 * côté mur ; à défaut, gauche), voir `layout/walklineSide.ts`. Sans effet sur un tracé à
 * tournants (d_f est mesurée depuis le jour) ni sur un hélicoïdal. Ajout rétrocompatible.
 */
export const WalklineSideSchema = z.enum(["left", "right"]);
export type WalklineSide = z.infer<typeof WalklineSideSchema>;

export const WalklineSchema = z.discriminatedUnion("mode", [
  /** DTU 36.3 : milieu si E ≤ 1 200, sinon 600 mm du bord intérieur (bord de mesure). */
  z.object({ mode: z.literal("dtu"), side: WalklineSideSchema.optional() }),
  z.object({
    mode: z.literal("fromInner"),
    distance: mmPos,
    side: WalklineSideSchema.optional(),
  }),
]);
export type WalklineSpec = z.infer<typeof WalklineSchema>;

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
  /**
   * Méthode de balancement : M0 rayonnant, M1 progression arithmétique, M2 herse (option V1,
   * `herseAngle`), M3 développement du limon (défaut), M6 rotation paramétrée (option V1,
   * `rotationReach`, `rotationSteepness`). Ajout rétrocompatible de M2 et M6.
   */
  method: z.enum(["M0", "M1", "M2", "M3", "M6"]).default("M3"),
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
  /**
   * M2 (herse, B §3.4) : angle α de la ligne inclinée, en degrés. Utile seulement dans
   * ]0 ; α_eq[, α_eq = arccos(L_c / (m·g)) propre à chaque demi-zone (au-delà, collets
   * croissants vers l'angle) : hors de cet intervalle, la zone est refusée ; la borne de la
   * zone retenue est rendue par `Stepping.balancedZones[].herseAlphaMax`. Absent : 20°
   * (`HERSE_DEFAULT_ANGLE`, usage trepedia [4]).
   */
  herseAngle: z.number().gt(0).lt(90).optional(),
  /**
   * M6 (rotation paramétrée, B §3.8) : portée λ (girons) de la loi de rotation
   * w = exp(−(d/λ)^p). Absent : 2 (`ROTATION_DEFAULT_REACH`, choix Blondel à valider).
   */
  rotationReach: z.number().positive().max(50).optional(),
  /**
   * M6 : raideur p de la loi de rotation. Absent : 2 (`ROTATION_DEFAULT_STEEPNESS`, choix
   * Blondel à valider).
   */
  rotationSteepness: z.number().positive().max(20).optional(),
});

/**
 * Identifiant de méthode de balancement : **liste unique** (`BalancingSchema.method`), reprise
 * par `BalancingStrategy.id` et le registre `balancing/registry.ts`.
 */
export type BalancingMethod = z.output<typeof BalancingSchema>["method"];

export const TreadSpecSchema = z.object({
  thickness: mmPos.default(40),
  /**
   * Débord du nez sur la contremarche. Défaut 10 mm (QUESTIONS A9, appliqué par défaut le
   * 2026-09-30, à confirmer) : valeur recommandée de `DEBORD_NEZ_LOGEMENT`, déjà celle des
   * préréglages. L'ancien défaut (30 mm) ne s'appliquait qu'aux projets écrits à la main sans
   * ce champ : `serializeProject` écrit toujours `treads.nosing`, un projet enregistré par
   * Blondel n'est donc pas modifié (pas de migration, voir LEDGER).
   */
  nosing: mmNonNeg.default(10),
  risers: z.enum(["full", "open", "none"]).default("full"),
  riserThickness: mmPos.default(20),
  /**
   * Essence des marches, contremarches et paliers bois (pièces de base, et marches bois des
   * plugins qui les reprennent) : masses, débit et chiffrage en dépendent. Absente : chêne
   * (`DEFAULT_WOOD_MATERIAL`, comportement antérieur). Ajout rétrocompatible (2026-09-30), jamais
   * ajouté à la lecture : un projet sans ce champ est sérialisé à l'identique.
   */
  material: z.enum(WOOD_MATERIALS).optional(),
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
export type RuleOverride = z.infer<typeof RuleOverrideSchema>;
/** Sévérités proposées par une surcharge de règle (`ignore` : règle sortie des violations). */
export const RULE_OVERRIDE_SEVERITIES = RuleOverrideSchema.shape.severity.options;

export const ComplianceSettingsSchema = z.object({
  /** Contextes cumulés de rules.yaml (`tous` est implicite). */
  contexts: z.array(z.string()).default(["bois_dtu", "logement_interieur"]),
  profile: z.enum(["strict", "souple"]).default("strict"),
  /** Date de dépôt PC/DP ou de marché (ISO), pilote le régime garde-corps 1988 / 2024. */
  referenceDate: z.string().optional(),
  overrides: z.array(RuleOverrideSchema).default([]),
});
export type ComplianceSettings = z.infer<typeof ComplianceSettingsSchema>;

// ------------------------------------------------------------------ Apparence

/** Couleur `#rrggbb`. */
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "couleur attendue au format #rrggbb");

/**
 * Apparence enregistrée du projet (ajout rétrocompatible, 2026-09-30) : **teintes de
 * présentation** qui ne changent pas le matériau des pièces. L'essence du bois, la finition de
 * l'acier (brut, peint, galvanisé), l'inox et le verre restent portés par les paramètres de
 * structure et de garde-corps (`Part.material`), dont dépendent masses, débit et chiffrage ;
 * `appearance` ne règle que ce qui n'y change rien : couleur de la peinture (thermolaquage),
 * ton d'une finition bois (huile, teinte), teinte du verre. Absent : rendu par défaut du matériau
 * (comportement antérieur). Lu par la vue 3D de l'interface, jamais par le pipeline ni les
 * exports.
 * Distinct de l'essai d'apparence par famille de pièces de l'interface (QUESTIONS A24), qui
 * reste un aperçu non enregistré.
 */
export const AppearanceSchema = z.object({
  /** Couleur de l'acier peint (`#rrggbb`), ex. noir RAL 9005 ; absente : gris anthracite. */
  paintColor: HexColorSchema.optional(),
  /**
   * Couleur de l'acier peint des marches, contremarches et paliers (ex. tôle pliée) ; absente :
   * `paintColor`. Permet de distinguer marches et ossature d'une même finition.
   */
  treadPaintColor: HexColorSchema.optional(),
  /** Couleur de l'acier peint des garde-corps et mains courantes ; absente : `paintColor`. */
  guardPaintColor: HexColorSchema.optional(),
  /** Ton de la finition du bois : naturel (défaut), clair (blanchi) ou foncé (teinté). */
  woodTone: z.enum(["natural", "light", "dark"]).optional(),
  /** Teinte du verre : clair (défaut), extra-clair ou fumé. */
  glassTint: z.enum(["clear", "extra-clear", "smoked"]).optional(),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

// ------------------------------------------------------------------ Valeurs ◆ validées

/** Valeur scalaire validée (nombre, choix d'une liste, case à cocher). */
export type ValidatedScalar = number | string | boolean;

/**
 * Validation d'une valeur par défaut « à valider » (◆) par l'utilisateur (ADR-0009 point 9,
 * vague 4) :
 * - `path` : clé du dictionnaire des niveaux de l'interface, chemin du projet joint par des
 *   points (`guards.posts.size`, `stair.balancing.rotationReach`,
 *   `stair.structure.params.supports.pinch`) ;
 * - `value` : valeur **effective** au moment de la validation (défauts compris, même si le
 *   projet ne l'enregistre pas) ;
 * - `structureKind` : plugin de structure, seulement pour les paramètres de plugin
 *   (`stair.structure.params.*`).
 *
 * Une validation ne vaut que si le chemin, le plugin et la valeur effective courante sont égaux
 * (`===`) à ceux enregistrés. Sinon elle est **caduque** : l'entrée reste dans le fichier mais
 * est ignorée (une valeur modifiée doit être validée de nouveau).
 */
export const ValidatedValueSchema = z.object({
  path: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean()]),
  structureKind: z.string().optional(),
});
export type ValidatedValue = z.infer<typeof ValidatedValueSchema>;

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
  /**
   * Teintes de présentation (peinture, ton du bois, verre) : voir `AppearanceSchema`. Absent :
   * rendu par défaut. Ajout rétrocompatible, sans effet sur le modèle.
   */
  appearance: AppearanceSchema.optional(),
  /**
   * Valeurs ◆ validées par l'utilisateur (voir `ValidatedValueSchema`, ADR-0009 point 9). Absent
   * : aucune validation (fichier inchangé). Sans défaut, pour que les projets antérieurs restent
   * identiques à l'octet près. Ajout rétrocompatible, sans migration, sans effet sur le modèle.
   */
  validatedValues: z.array(ValidatedValueSchema).optional(),
});
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;
