/**
 * Paramètres du plugin `wood-central` : limon central bois (QUESTIONS A29, décisions de
 * l'utilisateur du 2026-10-06, vague 2 ; SPEC §2.4 ; C §1.4 à §1.6).
 *
 * Une **crémaillère centrale** unique sous les marches, à l'axe de l'emmarchement par défaut
 * (trace de `centralTrace.ts`, partagée avec `steel-central`) : poutre bois massif ou en couches
 * collées (lamellé-collé) sur un escalier droit, lamellé-collé **cintré sur moule** sur les
 * tournants et l'hélicoïdal (lamelles verticales cintrées en plan, règle k_r de SPEC §2.4 /
 * C-B-08, `LAMELLE_CINTRE_KR`). Marches posées sur les assises de la crémaillère, logées à
 * l'arrière dans la dent suivante (« entaille arrière », C §1.5 [54]) et boulonnées au travers de
 * la poutre (boulons de 10 ou 12 mm avec écrou, C §1.5 [54]) ; sabots métalliques en pied et en
 * tête (A29 n° 5).
 *
 * Contrat partagé de la vague « limon central bois » : la poutre (`woodCentralBeam.ts`) lit
 * `material`, `strengthClass`, `trace`, `section`, `notch`, `bolts`, `anchors` ; le plugin
 * (`woodCentral.ts`) lit tout ; l'interface (`apps/web`) présente chaque chemin. Noms et sens
 * **figés** pendant la vague (un ajout éventuel est signalé).
 *
 * Valeurs par défaut : sources de docs/research/C-structures.md citées ; toute valeur sans
 * source est un paramètre **« à valider »** (◆ dans l'interface), jamais une constante cachée.
 */
import { z } from "zod";
import { PrecheckSettingsSchema } from "../precheck/settings.js";
import { STEEL_GRADES } from "../workshop/metal.js";
import { WOOD_MATERIALS } from "../workshop/profile.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();
const auto = <T extends z.ZodType>(s: T) => z.union([s, z.literal("auto")]).default("auto");

/**
 * Section de la poutre : lamellé-collé (couches collées droites sur un escalier droit, C §1.5
 * [7][8] ; lamelles cintrées sur moule sur une trace courbe, C §1.6 [7]) ou bois massif d'une
 * pièce (escalier droit seulement : le massif courbe par tronçons, C §1.6 [6], n'est pas pris en
 * charge, `unsupportedOptions`).
 */
export const WOOD_CENTRAL_SECTION_KINDS = ["glulam", "solid"] as const;
export type WoodCentralSectionKind = (typeof WOOD_CENTRAL_SECTION_KINDS)[number];

/** Classe de résistance du tableau FCBA (même sémantique que `wood-cut.strengthClass`). */
export const WOOD_CENTRAL_STRENGTH_CLASSES = ["C30", "D40", "unknown", "auto"] as const;

export const WoodCentralParamsSchema = z.object({
  /**
   * Essence de la poutre (lamelles ou massif) ; masse volumique du profil d'atelier. Chêne par
   * défaut, comme `wood-cut` (classe FCBA `auto` : D40, hypothèse à valider).
   */
  material: z.enum(WOOD_MATERIALS).default("wood-oak"),
  /**
   * Classe de résistance pour le tableau FCBA (`CREMAILLERE_REGLE_MOYENS`) ; `auto` : C30 pour
   * le pin, D40 pour chêne, hêtre, frêne, inconnue pour `wood-glulam` (mêmes hypothèses « à
   * valider » que `wood-cut`). Classes de lamellé-collé (GL…) non sourcées : QUESTIONS A33.
   */
  strengthClass: z.enum(WOOD_CENTRAL_STRENGTH_CLASSES).default("auto"),
  trace: z
    .object({
      /**
       * Décalage de l'axe de la poutre par rapport à l'axe de l'emmarchement, mm, positif vers
       * la **gauche** dans le sens de la montée (0 : axe de l'emmarchement, A29 n° 2, **à
       * valider**). Même sens que `steel-central.trace.lateralOffset`.
       */
      lateralOffset: mmInt.default(0),
    })
    .prefault({}),
  section: z
    .object({
      kind: z.enum(WOOD_CENTRAL_SECTION_KINDS).default("glulam"),
      /**
       * Largeur b de la poutre (épaisseur de la crémaillère centrale), mm : 88 = 2 × 44, épaisseur
       * tabulée par FCBA et épaisseur usuelle des limons (C §1.4 [1][53]) multipliée par le
       * facteur de la crémaillère centrale (C §1.4, §1.5 : « × 2 ») ; **à valider**. Contrôlée
       * par `CREMAILLERE_REGLE_MOYENS` (tableau lu à b / `facteur_centrale`).
       */
      width: mmPos.default(88),
      /**
       * Reste sous entaille h_res (distance perpendiculaire à la sous-face entre le fond des
       * entailles et la sous-face), mm ; `auto` : distance exigée par le tableau FCBA à
       * b / `facteur_centrale` quand il est exploitable (escalier droit, classe connue…), sinon
       * `residualFallback`. Même sémantique que `wood-cut.residual`.
       */
      residual: auto(mmPos),
      /** Reste sous entaille retenu quand le tableau FCBA n'est pas exploitable (à valider). */
      residualFallback: mmPos.default(180),
      /**
       * Épaisseur **maximale** t d'une lamelle (lamellé-collé), mm : la poutre compte n = ⌈b / t⌉
       * lamelles **égales** d'épaisseur b / n (≤ t), de sorte que leur composition redonne b.
       * `auto` : sur une trace droite, couches collées les plus épaisses que l'atelier débite
       * (t_max = plus forte épaisseur de débit du profil moins la surcote de corroyage) ; sur une
       * trace courbe, plus grande épaisseur entière donnant r_in / t ≥ `recommande` de
       * `LAMELLE_CINTRE_KR` (k_r = 1), 1 mm au moins. Sans effet sur une section massive.
       */
      lamellaThickness: auto(mmPos),
      /**
       * Plis minces (SPEC Q10) : lamelle cintrée d'épaisseur ≤ ce seuil ⇒ avertissement « hors
       * NF EN 14080, justification requise » (C §1.6 ⚠️ : plis de 1 à 7 mm [7]) ; **à valider**.
       */
      thinPlyMax: mmPos.default(7),
    })
    .prefault({}),
  notch: z
    .object({
      /**
       * Entaille arrière (C §1.5 [54] : « entaille arrière de la marche dans le limon ») :
       * profondeur d'engagement de l'arrière de la marche dans la dent suivante, mesurée le
       * long de la trace, mm. `auto` : profondeur d'encastrement du profil d'atelier
       * (`wood.housingDepth`, 15 mm, à valider) ; contrôlée par `LIMON_ENTAILLE_MIN` (≥ 14 mm,
       * NF EN 16481). 0 : marche simplement posée sur l'assise.
       */
      rearDepth: auto(mmNonNeg),
    })
    .prefault({}),
  bolts: z
    .object({
      /**
       * Boulons traversants par marche (C §1.5 [54] : boulons de 10 ou 12 mm qui traversent le
       * limon, avec écrou ; source faible) : nombre, **à valider**. Verticaux, de la face du
       * dessus de la marche à la sous-face de la poutre, répartis le long de l'assise.
       */
      perTread: mmNonNeg.default(2),
      /** Diamètre de perçage, mm (M10 : 11 mm, jeu 1 mm ; C §1.5 [54] « 10 ou 12 mm »), à valider. */
      holeDiameter: mmPos.default(11),
      /** Distance mini d'un perçage aux bouts de l'assise (et à l'entaille arrière), à valider. */
      edgeDistance: mmPos.default(30),
      /**
       * Entraxe minimal de deux perçages de la poutre (boulons d'une même marche, boulon de
       * marche et boulon de sabot), mm. `auto` : diamètre de perçage (`holeDiameter`), perçages
       * seulement disjoints. Aucune source sur les entraxes des boulons dans le bois : **à
       * valider** (QUESTIONS A34).
       */
      minSpacing: auto(mmPos),
      /** Dépassement sous la poutre (rondelle, écrou, filet), ajouté à la longueur, à valider. */
      protrusion: mmNonNeg.default(20),
      /** Pas d'arrondi supérieur de la longueur (longueurs commerciales), à valider. */
      lengthStep: mmPos.default(10),
    })
    .prefault({}),
  anchors: z
    .object({
      /** Sabot de pied (au sol) et sabot de tête (contre le chevêtre), A29 n° 5. */
      foot: z.boolean().default(true),
      head: z.boolean().default(true),
      /** Nuance et finition de la tôle des sabots (matériau `steel-*`), à valider. */
      grade: z.enum(STEEL_GRADES).default("S235"),
      finish: z.enum(["raw", "painted", "galvanized"]).default("painted"),
      /** Épaisseur de la tôle pliée en U du sabot, mm (aucune source, **à valider**). */
      thickness: mmPos.default(6),
      /**
       * Saillie des deux joues du sabot perpendiculairement à son âme, mm : au pied, hauteur des
       * joues sur les faces de la poutre (âme = semelle au sol) ; en tête, longueur des joues
       * le long de la poutre (âme verticale contre le chevêtre). Aucune source, **à valider**.
       */
      cheekDepth: mmPos.default(150),
      /**
       * Longueur de l'âme du sabot, mm : au pied, semelle le long de la poutre (sur la coupe au
       * sol) ; en tête, hauteur de l'âme contre le chevêtre. Aucune source, **à valider**.
       */
      length: mmPos.default(200),
      /** Chevilles dans l'âme du sabot (sol ou chevêtre) et perçage (M12 : 13 mm, comme `steel-flat`). */
      anchors: mmNonNeg.default(2),
      anchorHoleDiameter: mmPos.default(13),
      /** Boulons traversant les joues et la poutre, et perçage (M12 : 13 mm), à valider. */
      bolts: mmNonNeg.default(2),
      boltHoleDiameter: mmPos.default(13),
      /** Pince des perçages (même défaut que `steel-flat.plates.holeEdgeDistance`), à valider. */
      holeEdgeDistance: mmPos.default(25),
    })
    .prefault({}),
  /** Réglages du prédimensionnement indicatif (`precheck/settings.ts`), flexion seule. */
  precheck: PrecheckSettingsSchema.prefault({}),
  /**
   * Justification du double porte-à-faux et de la torsion (`LIMON_CENTRAL_PORTE_A_FAUX`, A29
   * n° 4, comme A12) : l'avertissement reste, la justification lui est jointe (dossier PDF).
   */
  cantileverJustification: z.string().default(""),
  /**
   * Justification du lamellé-collé cintré en plis minces (SPEC Q10 : avertissement + champ de
   * justification repris dans le dossier) ; même traitement que `cantileverJustification`.
   */
  laminationJustification: z.string().default(""),
});
export type WoodCentralParams = z.output<typeof WoodCentralParamsSchema>;
