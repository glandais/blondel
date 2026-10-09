/**
 * Paramètres du plugin `steel-central` (limon central métal, QUESTIONS A29, décisions de
 * l'utilisateur du 2026-10-06) : une poutre unique sous les marches, tube rectangulaire ou
 * caisson en tôles soudées, droite (escalier droit), débillardée (tournants : trace courbe à
 * l'axe de l'emmarchement, flasques roulées par tronçons) ou hélicoïdale.
 *
 * Contrat partagé de la vague « limon central » : la géométrie de la poutre
 * (`centralTrace.ts`, `centralBeam.ts`) lit `grade`, `finish`, `trace`, `section`, `beam`,
 * `plates` ; le plugin (`steelCentral.ts`) lit tout ; l'interface (`apps/web`) présente chaque
 * chemin. Noms et sens **figés** pendant la vague (un ajout éventuel est signalé).
 *
 * Valeurs par défaut : sources de docs/research/C-structures.md citées ; toute valeur sans
 * source est un paramètre **« à valider »** (◆ dans l'interface), jamais une constante cachée.
 */
import { z } from "zod";
import { PrecheckSettingsSchema } from "../precheck/settings.js";
import { STEEL_GRADES } from "../workshop/metal.js";
import { SteelFlatParamsSchema } from "./steelFlat.js";
import { TreadFixingSchema, TreadHoleDiameterSchema } from "./treadFixing.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();
const auto = <T extends z.ZodType>(s: T) => z.union([s, z.literal("auto")]).default("auto");

/** Section de la poutre : tube rectangulaire, ou caisson en tôles soudées (C §2.4, §2.5). */
export const CENTRAL_SECTION_KINDS = ["tube", "box"] as const;
export type CentralSectionKind = (typeof CENTRAL_SECTION_KINDS)[number];

/**
 * Supports de marche : console en tôle soudée (C §2.4 [20], défaut, décision A29 n° 3), ou
 * support en tôle pliée en U, en Z ou en triangle (C §2.6 [43], [42], en option).
 */
export const CENTRAL_SUPPORT_KINDS = [
  "console",
  "folded-u",
  "folded-z",
  "folded-triangle",
] as const;
export type CentralSupportKind = (typeof CENTRAL_SUPPORT_KINDS)[number];

export const SteelCentralParamsSchema = z.object({
  /** Nuance d'acier (S355 ⇒ EXC2, C §2.1). */
  grade: z.enum(STEEL_GRADES).default("S235"),
  /** Finition (matériau `steel-*`) ; galvanisé : évents des corps creux (C §2.8 [28]). */
  finish: z.enum(["raw", "painted", "galvanized"]).default("painted"),
  trace: z
    .object({
      /**
       * Décalage de l'axe de la poutre par rapport à l'axe de l'emmarchement, mm, positif vers
       * la **gauche** dans le sens de la montée (0 : axe de l'emmarchement, décision A29 n° 2,
       * **à valider**).
       */
      lateralOffset: mmInt.default(0),
    })
    .prefault({}),
  section: z
    .object({
      kind: z.enum(CENTRAL_SECTION_KINDS).default("tube"),
      /**
       * Hauteur et largeur hors tout de la section, mm, hauteur mesurée perpendiculairement à
       * l'axe de la poutre (C §2.2, §2.5 : tube 200 × 100 [42], confiance faible, **à valider**).
       */
      height: mmPos.default(200),
      width: mmPos.default(100),
      /** Tube : épaisseur de paroi (aucune source, **à valider**). */
      wallThickness: mmPos.default(5),
      /** Caisson : épaisseur des flasques (joues roulées ; C §2.2 : tôle de 8 mm [20], à valider). */
      webThickness: mmPos.default(8),
      /** Caisson : épaisseur des semelles haute et basse (aucune source, **à valider**). */
      flangeThickness: mmPos.default(8),
      /** Caisson : épaisseur des entretoises (C §2.4 [20] : entretoises, épaisseur à valider). */
      diaphragmThickness: mmPos.default(8),
      /**
       * Caisson : entraxe maximal des entretoises le long de la trace, mm (C §2.4 [20] :
       * « espacement régulier », sans valeur ; **à valider**).
       */
      diaphragmSpacing: mmPos.default(600),
      /**
       * Caisson : entraxe minimal des entretoises, mm (décision de l'utilisateur A32 (a) du
       * 2026-10-09, aucune source, **à valider**). `auto` : hauteur de la section
       * (`section.height`). Sous cette borne, `diaphragmSpacing` est refusé : erreur lisible,
       * entretoises d'extrémité et de joint seules (`resolveDiaphragmMinSpacing`).
       */
      diaphragmMinSpacing: auto(mmPos),
      /**
       * Diamètre des évents d'un corps creux galvanisé (C §2.8 [28] et C-M-10 : évents
       * obligatoires ; diamètre sans source, **à valider**).
       */
      ventDiameter: mmPos.default(20),
    })
    .prefault({}),
  beam: z
    .object({
      /**
       * Distance verticale entre la ligne des nez (prise sur la trace) et le dessus de la
       * poutre, mm. `auto` : la plus petite qui laisse sous chaque marche au moins
       * `supports.minHeight` de support au-dessus de la poutre (résolue par le plugin).
       */
      topOffset: auto(mmPos),
      /** Longueur de poutre en avant du nez de départ (avant la coupe au sol, à valider). */
      startExtension: mmNonNeg.default(50),
      /** Longueur de poutre au-delà du nez d'arrivée (à valider). */
      endExtension: mmNonNeg.default(0),
      /** Aboutage d'une poutre plus longue que la barre ou la tôle : soudé bout à bout (EXC2) ou éclissé. */
      splice: z.enum(["welded", "bolted"]).default("welded"),
      /**
       * Débillardé : décalage δ de la coupe par rapport à la naissance, dans la partie droite
       * (même règle et même valeur que `steel-curved`, B §5.4, C §2.4, **à valider**).
       */
      jointOffset: mmNonNeg.default(100),
      /** Débillardé : marge entre un joint et un support de marche (à valider). */
      jointSupportMargin: mmNonNeg.default(20),
      /** Débillardé : longueur minimale d'un tronçon (développé), sinon pas de coupe (à valider). */
      minSegmentLength: mmPos.default(200),
      /** Débillardé : pas d'échantillonnage des rives Δσ, mm (B §5.2 : « ex. 5 mm »). */
      sampleStep: z.number().positive().default(5),
      /** Débillardé : espacement des lignes de roulage tracées sur le développé (à valider). */
      rollLineSpacing: mmPos.default(50),
    })
    .prefault({}),
  supports: z
    .object({
      kind: z.enum(CENTRAL_SUPPORT_KINDS).default("console"),
      /** Fixation du support sur la poutre : soudé (C §2.5 [23], défaut) ou vissé. */
      fixing: z.enum(["welded", "bolted"]).default("welded"),
      /** Console : épaisseur de l'âme (C §2.4 : tôle de 8 mm [20], à valider). */
      consoleThickness: mmPos.default(8),
      /** Support plié U / Z / triangle : épaisseur de tôle (C §2.2 : 4 mm [42], à valider). */
      foldedThickness: mmPos.default(4),
      /**
       * Longueur du support en travers de la marche, mm. `auto` : largeur de la marche au droit
       * du support moins 2 × `endClearance` (résolue par le plugin).
       */
      length: auto(mmPos),
      /** Retrait de chaque bout du support par rapport au bout de la marche (à valider). */
      endClearance: mmNonNeg.default(50),
      /** Largeur d'appui sous la marche (plat d'appui de console, âme d'un support plié), à valider. */
      bearingWidth: mmPos.default(60),
      /** Console : épaisseur du plat d'appui soudé sur l'âme (à valider). */
      bearingThickness: mmPos.default(8),
      /** Console : hauteur de l'âme au bout du support (à valider). */
      tipHeight: mmPos.default(40),
      /** Hauteur minimale du support au-dessus de la poutre (sert à `beam.topOffset` auto, à valider). */
      minHeight: mmPos.default(40),
      /** Fixation vissée sur la poutre : boulons, perçage (M10 : 11 mm), pince (à valider). */
      bolts: mmNonNeg.default(2),
      holeDiameter: mmPos.default(11),
      holeEdgeDistance: mmPos.default(20),
      /** Points de fixation de la marche par support (un seul support par marche, à valider). */
      treadScrews: mmNonNeg.default(4),
      /** Marche en tôle pliée : vissée ou soudée sur son support (A31, vissée par défaut, à valider). */
      treadFixing: TreadFixingSchema,
      /** Marche en tôle pliée vissée : diamètre de perçage (M8 : 9 mm, A31, à valider). */
      treadHoleDiameter: TreadHoleDiameterSchema,
      /** Marge entre le support et les ailes / contremarches voisines (comme `steel-flat`). */
      endMargin: mmNonNeg.default(10),
      /** Entraxe maximal des supports sous un palier, le long de la trace (à valider). */
      landingSpacing: mmPos.default(600),
    })
    .prefault({}),
  /** Platines de pied (sol) et de tête (chevêtre) : mêmes paramètres et défauts que `steel-flat` (A29 n° 5). */
  plates: SteelFlatParamsSchema.shape.plates,
  /** Marches : bois (pièces de base, mixte) ou tôle pliée (mêmes réglages que `steel-flat`). */
  treadKind: SteelFlatParamsSchema.shape.treadKind,
  folded: SteelFlatParamsSchema.shape.folded,
  /** Réglages du prédimensionnement indicatif (`precheck/settings.ts`), flexion seule. */
  precheck: PrecheckSettingsSchema.prefault({}),
  /**
   * Référence de la justification du double porte-à-faux et de la torsion (note de calcul, avis
   * technique) ; vide : avertissement « justification requise » ; saisie : l'avertissement
   * reste, la justification lui est jointe et reprise dans le dossier PDF (A29 n° 4, comme A12).
   */
  cantileverJustification: z.string().default(""),
});
export type SteelCentralParams = z.output<typeof SteelCentralParamsSchema>;

/**
 * Borne basse de l'entraxe des entretoises d'un caisson (QUESTIONS A32 (a), **à valider**) :
 * saisie, ou `auto` → hauteur de la section.
 */
export function resolveDiaphragmMinSpacing(
  section: Pick<SteelCentralParams["section"], "diaphragmMinSpacing" | "height">,
): number {
  const entered = section.diaphragmMinSpacing;
  return entered === "auto" ? section.height : entered;
}
