/**
 * Poutre du limon central bois (`wood-central`, QUESTIONS A29, vague 2) : crémaillère centrale
 * le long de la trace (`centralTrace.ts`), lamellation, entailles, boulons traversants, sabots de
 * pied et de tête (`woodCentralShoes.ts`), contrôles de fabrication propres.
 *
 * Contrat partagé de la vague « limon central bois » (interfaces **figées**) : implémenté par la
 * tâche « poutre », appelé par le plugin (`woodCentral.ts`) après la construction de la trace.
 *
 * Construction (convention Blondel **à valider**, QUESTIONS A33 ; sources : C §1.4 à §1.6) :
 * - **Développement à l'axe** : u = σ (abscisse sur la trace), z = altitude. Marche t (nez
 *   avant t − 1, nez arrière t) posée sur une **assise** horizontale au dessous de la marche
 *   (z du dessus − `treads.thickness`).
 * - **Arrière d'une marche** : ligne du nez suivant décalée du débord (`treads.nosing`) vers le
 *   haut de l'escalier ; son intersection avec l'emprise de la poutre (faces à ± b/2 de la
 *   trace) donne σ_min et σ_max (égaux si la ligne est d'équerre sur la trace).
 * - **Entaille arrière** (C §1.5 [54]) : la face de la dent suivante est à σ_min − d
 *   (d = `notch.rearDepth`, `auto` : `wood.housingDepth`) ; l'entaille, pleine largeur, va de
 *   cette face à σ_max + `wood.clearance`, sur l'épaisseur de marche + jeu : l'arrière de la
 *   marche est logé de d au moins dans la dent. **Contremarches pleines** (QUESTIONS A33 (i),
 *   décision du 2026-10-09 : admises) : la ligne arrière est prise derrière la contremarche
 *   (débord + épaisseur de contremarche), l'entaille arrière se place donc derrière la
 *   contremarche et la dent recule de l'épaisseur de la contremarche (convention à valider :
 *   l'arrière de la marche passe sous la contremarche). Sans entaille (d = 0, dernière marche
 *   contre le chevêtre) : face de la dent à σ_max de la ligne.
 * - **Sous-face** : courbe des nez sur la trace abaissée d'une constante Δ, la plus petite qui
 *   laisse au moins le reste sous entaille (`section.residual`, `auto` : tableau FCBA lu à
 *   b / `facteur_centrale` quand il est exploitable, sinon `residualFallback`) sous chaque fond
 *   d'entaille, distance prise perpendiculairement à la sous-face locale. Sur un escalier droit
 *   à girons égaux, la rive basse et le reste sous entaille sont exactement ceux de `wood-cut`.
 * - **Extrémités** : face avant sous le nez 0 (décalée du débord et de la contremarche, comme
 *   `wood-cut`) ; coupe de niveau au pied sur le dessus de la semelle du sabot ou de la platine
 *   (au sol sans ancrage) ; coupe d'aplomb en tête contre le chevêtre (ligne du nez d'arrivée
 *   décalée comme l'arrière d'une marche, convention de `wood-cut` : chevêtre en retrait du
 *   débord du nez d'arrivée, **confirmé** par l'utilisateur le 2026-10-09, QUESTIONS A33 (i)),
 *   moins l'âme du sabot ou l'épaisseur de la platine de tête et le jeu.
 * - **Lamellation** (`WoodCentralLamination`, `method`) : massif d'une pièce ; couches collées
 *   droites (escalier droit, C §1.5 [7][8]) ; sur une trace courbe (filière
 *   `resolveCurvedMethod`, QUESTIONS A33 (e)), soit lamelles verticales cintrées sur moule
 *   (C §1.6 [7], n = ⌈b / t⌉ lamelles égales d'épaisseur b / n ; k_r et refus sous r_in/t = 170
 *   lus dans `LAMELLE_CINTRE_KR` ; débit en placages achetés à l'épaisseur, A34 (e)), soit
 *   couches **horizontales** découpées selon le plan, empilées, collées puis délardées, sans
 *   moule ni cintrage (k_r = 1, C §1.6 [7][8], §1.11 ; pièces composantes de
 *   `woodCentralLayers.ts`, la poutre ne portant alors ni débit ni matière).
 * - **Fixation des marches** (C §1.5 [54], source faible ; QUESTIONS A34 (a), (b)) :
 *   `bolts.perTread` organes verticaux par marche, répartis sur l'assise à la pince
 *   `bolts.edgeDistance` et à l'entraxe `bolts.minSpacing` au moins (`auto` : bornes « tous
 *   angles » de l'EC5, `woodCentralBoltSpacing`, C §1.11 [71]), à l'écart des perçages
 *   d'ancrage. Boulon traversant du dessus de la marche à la sous-face, longueur arrondie au pas
 *   supérieur, là où la sous-face laisse la place de l'écrou au-dessus du sol ou de l'ancrage
 *   de pied (σ ≥ σ*) ; **tire-fond** vertical depuis le dessus de la marche avant σ*
 *   (`lagScrews`, C §1.11 [78]), ancrage borné par le bois disponible sous l'assise, longueur
 *   arrondie au pas inférieur, posé seulement si l'ancrage minimal est tenu
 *   (`lagScrews.minAnchorage`, QUESTIONS A37 (1), A38 (14), décisions du 2026-10-10 et du
 *   2026-10-11 : partie filetée pénétrant de la valeur saisie, ou de 6·d en `auto`, EN 1995-1-1
 *   § 8.7.2 (3) via C §1.11 [88], tire-fond retiré sinon ; projet antérieur à A38 migré en
 *   ancrage total `lagScrews.minTotalAnchorage` : ancrage ≥ valeur, pénétration filetée sous
 *   `minAnchorage` signalée), à l'écart des
 *   perçages horizontaux avec le bois `lagScrews.holeWood` entre filet et perçage (A37 (17)).
 *   **Tire-fonds** (QUESTIONS A35 (l), décision du 2026-10-09, à valider) : entraxes et pinces au
 *   plus sévère des règles latérales (boulons) et axiales (vis chargées axialement, EC5 § 8.7.2
 *   via C §1.11 [71] tableau 10.6) : entraxe `lagScrews.minSpacing` (7·d), pince latérale au
 *   bout avant de l'assise `lagScrews.endDistance` (a3,c = 4·d), au bout arrière a3,c, aux
 *   faces max(a4,c ; a2,CG) = 4·d (`WoodCentralLagSpacing`) ; une assise qui porte au moins un
 *   tire-fond est replacée avec ces règles pour tous ses organes ; avant-trou
 *   `lagScrews.pilotDiameter` (7 mm) gardé.
 *   **Pince axiale a1,CG le long du fil** (QUESTIONS A36 (4), décision du 2026-10-09, à
 *   valider) : centre de gravité de la seule partie filetée comprise dans la poutre (DIN 571,
 *   longueur filetée b = `lagScrews.threadLength`, `auto` ⌊20 + L / 3⌋ côté pointe, C §1.11
 *   [78], QUESTIONS A37 (5) ; `lagThreadInBeam`) à `lagScrews.threadEndDistance` (10·d) au moins, le
 *   long du fil (selon la pente ; horizontal en couches empilées), de la coupe au sol et des
 *   faces de cran (`grainEndDistance`, `isBeamEndSide`, en-tête de `woodSpacing.ts`) ; en
 *   couches empilées, a2,CG au-dessus de la coupe au sol (rive). Le tire-fond est raccourci au
 *   pas `bolts.lengthStep` tant que l'ancrage minimal reste tenu ; les positions sont
 *   cherchées dans les parties de l'assise où un organe tient (`fitIntervals`).
 *   **Pinces d'extrémité** (A35 (e), à valider) : direction d'effort supposée par la gravité
 *   (en-tête de `woodSpacing.ts`) ; aux bouts des assises, l'organe pousse le bois vers
 *   l'intérieur de la poutre : extrémité non chargée a3,c pour les boulons comme pour les
 *   tire-fonds (valeurs des boulons inchangées).
 *   Sur l'axe de la poutre : couches droites en nombre **impair** par défaut quand des organes
 *   sont posés, organe au milieu de la couche centrale (A35 (f)) ; décalés d'une demi-couche
 *   quand un nombre pair de couches saisi met un joint de colle sur l'axe (A34 (d)). Constats
 *   `FAB_LIMON_CENTRAL_BOIS_BOULONS` (organes manquants) et `FAB_LIMON_CENTRAL_BOIS_PINCES`
 *   (entraxes et pinces de l'EC5, chaque nature d'organe avec ses règles).
 * - **Ancrages** (`resolveAnchorKind`, A33 (f), A34 (c)) : sabots en U (`woodCentralShoes.ts`,
 *   boulons du sabot de pied regroupés dans `anchors.footBoltZone`, pince a3,c du bois mesurée
 *   le long du fil, A36 (10)) ou platines à âme noyée (`woodCentralPlates.ts`, logements tracés
 *   sur le développé, contour en escalier de l'âme de pied prolongée, A35 (a) ; logement fraisé,
 *   ou découpé dans chaque couche avant collage en couches empilées, A36 (5)) ; le développé
 *   porte les perçages des boulons de sabot ou des broches. Un organe vertical dans le plan
 *   réel d'une âme (`BeamKerf.line`, corde de la trace, QUESTIONS A38 (8)) est décalé de part et
 *   d'autre du trait si la pince de sa nature le permet de ce côté (boulon : a4,c ; tire-fond :
 *   max(a4,c ; a2,CG)), sinon un tire-fond s'arrête au haut du trait à son abscisse plus
 *   `lagScrews.tipCover`. Organes placés deux fois (A38 (6)) : une pré-passe sans obstacle
 *   d'ancrage donne sous chaque assise la place du tire-fond réellement posé
 *   (`seatReservations`), lue par la platine pour le dessus de l'âme de pied, puis la passe
 *   finale avec les perçages et les traits. En couches empilées, un joint de colle est imposé
 *   sur le dessus voulu du logement de l'âme de pied (A38 (12), `StackedBeamShape.jointLevels` ;
 *   recalé à « voisin − minimum » contre une couche trop mince, A40 (c), sinon abandonné, A39 (d)).
 *   Autour d'un perçage horizontal, un boulon s'écarte de l'entraxe des boulons ; un tire-fond
 *   garde le jeu géométrique plus le bois `lagScrews.holeWood` entre son filet et le bord du
 *   perçage (`lagHoleClearance`, relecture A35, QUESTIONS A36 (10) et A37 (17), `auto` 0,5·d,
 *   à valider), retiré sinon (avertissement).
 * - **Solide** : extrusion exacte du contour (entailles comprises) sur une trace droite ; surface
 *   réglée sur la face gauche, épaissie de b vers la droite, sur une trace courbe (dents
 *   d'équerre sur la trace au fond de l'entaille, entailles arrière non représentées en 3D).
 *
 * `buildWoodCentralBeam` ne lève jamais : erreurs dans `errors`, poutre partielle ou absente.
 */
import { dec, errorMessage, msg, textMessage, type Message } from "@blondel/i18n";
import { cumulativeLengths } from "../geom2d/curve.js";
import { ensureCCW, pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Part, PartFixing } from "../model/derived.js";
import type { PartAssembly, StructureContext } from "../model/plugins.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import { buildBasicParts } from "../parts/basic.js";
import { helicalTreadOutline } from "../stepping/helical.js";
import { outlineBetween } from "../stepping/treads.js";
import type { BeamSection } from "../precheck/beam.js";
import { HARDWOOD_WOOD_CLASS } from "../precheck/settings.js";
import { sourceSpec } from "../rules/sources.js";
import { getRule, ruleParam } from "../rules/table.js";
import type { Finding } from "../rules/types.js";
import {
  resolveWorkshopProfile,
  type WoodMaterialId,
  type WorkshopProfile,
} from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import {
  FAB_RULES,
  pluginRuleDef,
  type CheckCollector,
  type CheckItem,
  type PluginRuleSpec,
} from "./checks.js";
import {
  fallbackThicknessOutOfRange,
  fcbaTable,
  requiredCentralResidual,
  type StrengthClass,
} from "./fcba.js";
import { fcbaDomainReason, fcbaUnknownClassFullReason } from "./woodCut.js";
import { area, clipHalfPlane, minAreaRect, removeCollinear } from "./geom.js";
import { woodQuantities } from "./quantities.js";
import { STEEL_RULES, holePolygon } from "./steelCommon.js";
import { readPlanExtrusion, verticalExtrusion } from "./housing.js";
import { stockOf } from "./woodHoused.js";
import {
  WOOD_CENTRAL_LAYER_RULES,
  buildStackedLayers,
  resolveLayerThickness,
  stackedJointLevels,
  type StackedBeamShape,
  type StackedLayersResult,
} from "./woodCentralLayers.js";
import {
  SHOE_FIT_RULE,
  buildWoodCentralShoes,
  roundUpTo,
  spread,
  type ShoeBeamHole,
} from "./woodCentralShoes.js";
import {
  WOOD_CENTRAL_PLATE_RULES,
  buildWoodCentralEmbeddedPlates,
  type BeamKerf,
} from "./woodCentralPlates.js";
import {
  grainDirection,
  grainEndDistance,
  isBeamEndSide,
  lagAnchorageHolds,
  lagHoleClearance,
  lagRetained,
  lagThreadInBeam,
  woodCentralBoltSpacing,
  type WoodCentralBoltSpacing,
} from "./woodSpacing.js";
import {
  resolveAnchorKind,
  resolveCurvedMethod,
  type WoodCentralAnchorKind,
  type WoodCentralCurvedMethod,
  type WoodCentralParams,
} from "./woodCentralParams.js";
import { QUANTITY_LENGTH_MM } from "./quantities.js";

/** Identifiant de la règle du lamellé-collé cintré (rules.yaml). */
export const LAMINATION_RULE_ID = "LAMELLE_CINTRE_KR";

/** Identifiant et repère de la poutre (contrat de la vague). */
export const WOOD_CENTRAL_BEAM_ID = "wood-central-beam";
export const WOOD_CENTRAL_BEAM_MARK = "LC1";

/** Grandeurs propres au lamellé-collé (`Part.quantities`) : nombre et épaisseur des lamelles. */
export const QUANTITY_LAMELLAE = "lamellae";
export const QUANTITY_LAMELLA_THICKNESS_MM = "lamella_thickness_mm";

/**
 * Contrôles de fabrication propres à la poutre (hors rules.yaml) ; titres et descriptions :
 * `rules.<id>.title` / `rules.<id>.description`. Nom **figé** (repris par
 * `rules/messages.test.ts`) ; les contrôles communs réutilisés y figurent aussi.
 */
export const WOOD_CENTRAL_BEAM_RULES = {
  /**
   * Boulons traversants ou tire-fonds de chaque marche placés sur son assise (C §1.5 [54] ;
   * tire-fonds des marches basses, QUESTIONS A34 (a)).
   */
  bolts: {
    id: "FAB_LIMON_CENTRAL_BOIS_BOULONS",
    ...sourceSpec(msg("compliance.source.woodCentralBolts")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: null,
  },
  /**
   * Entraxes et pinces de l'EC5 des boulons et tire-fonds de marche (QUESTIONS A34 (b) ;
   * EN 1995-1-1 § 8.5 via C §1.11 [71], bornes « tous angles » à valider) : boulons, entraxe
   * ≥ a1, distance aux bouts de l'assise et à l'entaille ≥ a3,c, distance aux faces ≥ a4,c ;
   * assises à tire-fonds (A35 (l), § 8.7.2 via [71] tableau 10.6), entraxe ≥ max(a1 ; 7·d),
   * bouts ≥ a3,c, faces ≥ max(a4,c ; a2,CG), centre de gravité de la partie filetée à a1,CG le
   * long du fil de la coupe au sol et des faces de cran (A36 (4), [88]), pénétration de la
   * partie filetée ≥ `lagScrews.minAnchorage` (6·d en `auto`, § 8.7.2 (3), [88], QUESTIONS
   * A37 (1)) en mode d'ancrage total (A38 (14)).
   */
  spacing: {
    id: "FAB_LIMON_CENTRAL_BOIS_PINCES",
    ...sourceSpec(msg("compliance.source.woodCentralSpacing")),
    confidence: "moyen",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  /** Sabots logés sur la coupe au sol et dans la hauteur de la coupe de tête. */
  shoeFit: SHOE_FIT_RULE,
  /** Platines à âme noyée logées (`woodCentralPlates.ts`, A33 (f)). */
  plateFit: WOOD_CENTRAL_PLATE_RULES.plateFit,
  /** Aboutages à entures décalés d'une couche à l'autre (`woodCentralLayers.ts`, A36 (6)). */
  fingerJoints: WOOD_CENTRAL_LAYER_RULES.fingerJoints,
  /** Joints de colle écartés des perçages horizontaux (`woodCentralLayers.ts`, A36 (12)). */
  holeJoints: WOOD_CENTRAL_LAYER_RULES.holeJoints,
  /** Planches d'une couche composée assez longues (`woodCentralLayers.ts`, A37 (4)). */
  shortBoards: WOOD_CENTRAL_LAYER_RULES.shortBoards,
  boardLength: FAB_RULES.boardLength,
  stockAvailable: FAB_RULES.stockAvailable,
  cheek: FAB_RULES.cheek,
  bendLaw: STEEL_RULES.bendLaw,
  bendRadius: STEEL_RULES.bendRadius,
  bendFlange: STEEL_RULES.bendFlange,
  pressBrake: STEEL_RULES.pressBrake,
  laser: STEEL_RULES.laser,
} as const satisfies Record<string, PluginRuleSpec>;

export interface WoodCentralBeamInput {
  readonly ctx: StructureContext;
  /** Paramètres complets (défauts appliqués, `auto` non résolus). */
  readonly params: WoodCentralParams;
  readonly trace: CentralTrace;
  /**
   * Collecteur des contrôles du plugin : la poutre y ajoute ses contrôles de **fabrication**
   * (longueur de plateau, débit disponible, bois au-dessus de l'entaille arrière, pliage et
   * perçages des sabots, boulons). Les règles de rules.yaml et les contrôles de justification
   * sont ajoutés par le plugin.
   */
  readonly checks: CheckCollector;
}

/**
 * Organe vertical de fixation d'une marche : boulon traversant (`bolt`) ou tire-fond vissé
 * depuis le dessus de la marche (`lagScrew`, marches basses où l'écrou ne trouve pas de place,
 * QUESTIONS A34 (a)).
 */
export interface WoodCentralBolt {
  readonly kind: "bolt" | "lagScrew";
  /** Abscisse sur la trace, mm. */
  readonly sigma: Mm;
  /** Décalage latéral par rapport à l'axe de la poutre (positif à gauche), mm. */
  readonly lateral: Mm;
  /**
   * Longueur retenue, mm : boulon arrondi au pas supérieur (jusqu'au dessous réel de la poutre
   * plus le dépassement) ; tire-fond arrondi au pas inférieur (épaisseur de marche + ancrage).
   */
  readonly length: Mm;
}

/** Assise d'une marche (ou d'un palier) sur la crémaillère centrale. */
export interface WoodCentralSeat {
  /** Numéro de la marche portée (`Tread.number`). */
  readonly tread: number;
  /** Identifiant de la pièce de marche du modèle (pièce de base `tread-<n>`). */
  readonly treadPartId: string;
  /** Début de l'assise sur la trace (face de la dent précédente), mm. */
  readonly sigma0: Mm;
  /** Fin de l'assise sur la trace (fond de l'entaille arrière dans la dent suivante), mm. */
  readonly sigma1: Mm;
  /** Altitude de l'assise (dessous de la marche), mm. */
  readonly z: Mm;
  /**
   * Profondeur d'entaille arrière **mesurée** (minimum sur la largeur de la poutre ; 0 : marche
   * simplement posée, contremarches pleines ou arrivée), mm — valeur de `LIMON_ENTAILLE_MIN`.
   */
  readonly rearDepth: Mm;
  /**
   * Reste sous entaille mesuré au point le plus défavorable de l'assise (fond de l'entaille
   * arrière), perpendiculairement à la sous-face locale, mm — valeur de
   * `CREMAILLERE_REGLE_MOYENS`.
   */
  readonly residual: Mm;
  /**
   * Bois restant dans la dent au-dessus de l'entaille arrière (hauteur de dent moins épaisseur
   * de marche et jeu), mm ; `Infinity` sans entaille arrière.
   */
  readonly toothAbove: Mm;
  /** Boulons traversants et tire-fonds de la marche, par abscisse croissante. */
  readonly bolts: readonly WoodCentralBolt[];
}

/**
 * Filière de la poutre : massif (`solid`), couches collées droites (`straight`, trace droite),
 * lamelles cintrées sur moule (`mould`) ou couches horizontales empilées (`stacked`) sur une
 * trace courbe (QUESTIONS A33 (e)).
 */
export type WoodCentralLaminationMethod = "solid" | "straight" | WoodCentralCurvedMethod;

/** Lamellation de la poutre (lamellé-collé ou massif). */
export interface WoodCentralLamination {
  readonly kind: "glulam" | "solid";
  readonly method: WoodCentralLaminationMethod;
  /** Lamelles cintrées sur moule (trace courbe, lamellé-collé, filière `mould`). */
  readonly curved: boolean;
  /**
   * Épaisseur d'une lamelle retenue, mm : b / n, n lamelles égales (massif : b). Au plus
   * l'épaisseur saisie (ou `auto` résolue). Couches empilées : épaisseur finie d'une couche
   * (`section.layerThickness` résolu).
   */
  readonly lamellaThickness: Mm;
  /**
   * Nombre de lamelles n = ⌈b / t⌉ (massif : 1) ; n × épaisseur = b. Couches empilées : nombre
   * de couches rendues par `buildStackedLayers` (0 avant leur construction).
   */
  readonly lamellae: number;
  /**
   * Plus petit rayon intérieur en plan de la poutre (face côté centre de l'arc le plus serré),
   * mm ; `Infinity` sur une trace droite.
   */
  readonly innerRadius: Mm;
  /** r_in / t (`Infinity` sur une trace droite ou une section massive). */
  readonly ratio: number;
  /**
   * k_r (EN 1995-1-1 via C §1.6 [71], `LAMELLE_CINTRE_KR`) : 1 si ratio ≥ `recommande`,
   * `parametres.kr_a + parametres.kr_b · ratio` entre `min` et `recommande`, `NaN` sous `min`
   * (refus). 1 sur une trace droite.
   */
  readonly kr: number;
  /** Arcs cintrés : rayon intérieur du moule et portée sur la trace. */
  readonly bends: readonly { readonly radius: Mm; readonly sigma0: Mm; readonly sigma1: Mm }[];
}

/** Lecture du tableau FCBA pour la crémaillère centrale. */
export interface WoodCentralFcba {
  /** Classe retenue (`strengthClass` résolu). */
  readonly cls: StrengthClass | "unknown";
  /** Distance exigée à b / `facteur_centrale` ; `null` si le tableau n'est pas exploitable. */
  readonly required: Mm | null;
  /** Raison pour laquelle le tableau n'est pas exploitable (absent : exploitable). */
  readonly unusable?: Message;
  /**
   * Tableau non exploitable pour la **seule** raison d'une essence feuillue en classe `auto`
   * (D30, aucune colonne, QUESTIONS A37 (2)), sur une trace droite dans le domaine du tableau
   * (hauteur, projection, et b / facteur au moins la plus petite épaisseur de chaque colonne) :
   * un reste sous entaille **saisi** est alors contrôlé contre le reste de repli
   * `section.residualFallback` (QUESTIONS A38 (15), décision du 2026-10-11) au lieu de
   * « non évalué ». Absent : autre cas.
   */
  readonly hardwoodFallback?: true;
}

export interface WoodCentralBeamResult {
  /**
   * Pièces : poutre (catégorie `carriage`), ancrages (sabots ou platines et âmes, catégorie
   * `fixing`), couches composantes de la poutre en couches empilées.
   */
  readonly parts: readonly Part[];
  /** Ancrage retenu (`resolveAnchorKind`). */
  readonly anchorKind: WoodCentralAnchorKind;
  /** Ancrages soudés (âme en T des platines) : classe d'exécution du plugin. */
  readonly anchorsWelded: boolean;
  /** Filière sur trace courbe (`resolveCurvedMethod`) ; `null` sur une trace droite ou en massif. */
  readonly curvedMethod: WoodCentralCurvedMethod | null;
  /**
   * Couches empilées (filière `stacked`) : épaisseur et surcote de délardement retenues, nombre
   * de couches ; `null` hors de cette filière ou sans poutre.
   */
  readonly stacked: {
    readonly layerThickness: Mm;
    readonly dressingAllowance: Mm;
    readonly count: number;
    /**
     * Plus grand écart en plan du fil des planches (`StackedLayersResult.maxGrainDeviation`,
     * A35 (h)), rad ; absent : 0 supposé. Lu par le prédimensionnement (A35 (j)).
     */
    readonly maxGrainDeviation?: number;
    /** Couches de bas en haut, altitudes de leurs faces (joints de colle aux faces jointives). */
    readonly layers: readonly { readonly z0: Mm; readonly z1: Mm }[];
    /** Perçages horizontaux de la poutre (broches, boulons de sabot), écartés des joints (A36 (12)). */
    readonly holes: readonly ShoeBeamHole[];
  } | null;
  /**
   * Longueur retenue de l'âme de pied d'une platine à âme noyée (`anchors.plate.footWebLength`
   * résolu, A35 (a)), mm ; absente sans âme de pied. Valeur `auto` exposée par le plugin.
   */
  readonly footWebLength?: Mm;
  /**
   * Platine de pied à âme noyée (QUESTIONS A38 (6)) : pré-passe des organes sans obstacle
   * d'ancrage et place réservée sous chaque assise au-dessus de l'âme de pied (`seatReservations`,
   * mm sous l'assise ; 0 : rien), dans l'ordre des assises. Absente sans platine de pied.
   */
  readonly seatReserve?: readonly {
    readonly tread: number;
    readonly reserved: Mm;
    /** Organes et tire-fonds posés par la pré-passe. */
    readonly organs: number;
    readonly lags: number;
  }[];
  /** Traits de scie des âmes de platine reportés sur la poutre (plan réel de l'âme, A37 (16)). */
  readonly beamKerfs?: readonly BeamKerf[];
  /** Identifiant de la pièce de poutre (absent : poutre non générée). */
  readonly beamPartId?: string;
  /** Assises, dans l'ordre des marches. */
  readonly seats: readonly WoodCentralSeat[];
  readonly lamination: WoodCentralLamination;
  readonly fcba: WoodCentralFcba;
  /** Reste sous entaille retenu (`section.residual` résolu), mm. */
  readonly residual: Mm;
  /** Profondeur d'entaille arrière retenue (`notch.rearDepth` résolu), mm. */
  readonly rearDepth: Mm;
  /** Assemblages : poutre ↔ marches, sabots ↔ poutre. */
  readonly assemblies: readonly PartAssembly[];
  /**
   * Section de flexion pour le prédimensionnement : rectangle b × hauteur perpendiculaire sous
   * les entailles (reste sous entaille), mm², mm⁴, mm³.
   */
  readonly section: BeamSection;
  /** Désignation de la section (« lamellé-collé 88 × 350, 2 lamelles de 44 »). */
  readonly sectionLabel: Message;
  /** Portée horizontale développée entre appuis (mm) et pente nominale tan α. */
  readonly spanH: Mm;
  readonly slope: number;
  readonly notes: readonly Message[];
  /** Configurations non prises en charge ou refusées (rayon de cintrage, section massive courbe). */
  readonly errors: readonly Message[];
}

// ------------------------------------------------------------------ Lamellation

/**
 * k_r du lamellé-collé cintré (EN 1995-1-1 via C §1.6 [71], règle `LAMELLE_CINTRE_KR`, seuils
 * lus dans la table) : 1 si r_in/t ≥ `recommande` ; `kr_a + kr_b · r_in/t` si `min` ≤ r_in/t <
 * `recommande` ; `NaN` sous `min` (refus de fabrication) ou pour un rapport non numérique.
 */
export function laminationKr(ratio: number): number {
  const rule = getRule(LAMINATION_RULE_ID);
  const min = rule.min ?? Number.NaN;
  const rec = rule.recommande ?? Number.NaN;
  if (Number.isNaN(ratio) || !(ratio >= min)) return Number.NaN;
  if (ratio >= rec) return 1;
  return ruleParam(rule, "kr_a") + ruleParam(rule, "kr_b") * ratio;
}

/**
 * Lamellation retenue (paramètres résolus) ; `ratio` = ∞ et k_r = 1 sans cintrage. Couches
 * empilées : `lamellae` = 0 (nombre de couches connu après `buildStackedLayers`).
 */
export function laminationOf(
  params: WoodCentralParams,
  trace: CentralTrace,
  profile: WorkshopProfile,
): WoodCentralLamination {
  const b = params.section.width;
  const curvedTrace = trace.kind !== "straight";
  const innerRadius = curvedTrace
    ? Math.min(...trace.arcs.map((a) => a.radius - b / 2))
    : Number.POSITIVE_INFINITY;
  if (params.section.kind === "solid") {
    return {
      kind: "solid",
      method: "solid",
      curved: false,
      lamellaThickness: b,
      lamellae: 1,
      innerRadius,
      ratio: Number.POSITIVE_INFINITY,
      kr: 1,
      bends: [],
    };
  }
  const entered = params.section.lamellaThickness;
  // n = ⌈b / t⌉ lamelles égales d'épaisseur b / n (≤ t) : la composition redonne b.
  const equal = (t: Mm): { lamellae: number; lamellaThickness: Mm } => {
    const n = Math.max(1, Math.ceil(b / t - 1e-9));
    return { lamellae: n, lamellaThickness: b / n };
  };
  if (resolveCurvedMethod(params, curvedTrace) === "stacked") {
    // Couches horizontales découpées selon le plan, sans cintrage (A33 (e), C §1.6 [7][8]).
    return {
      kind: "glulam",
      method: "stacked",
      curved: false,
      lamellaThickness: resolveLayerThickness(params, profile),
      lamellae: 0,
      innerRadius,
      ratio: Number.POSITIVE_INFINITY,
      kr: 1,
      bends: [],
    };
  }
  if (!curvedTrace || !Number.isFinite(innerRadius)) {
    const tMax = Math.max(...profile.wood.thicknesses) - profile.wood.planingAllowance;
    const t = entered !== "auto" ? entered : tMax > 0 ? tMax : b;
    // Poutre boulonnée (A35 (f), décision du 2026-10-09) : en `auto`, nombre **impair** de
    // couches, l'organe vertical tombe au milieu de la couche centrale (hors des joints de colle,
    // à b/2 des faces) ; une épaisseur saisie est respectée (n = ⌈b / t⌉, pair compris : décalage
    // d'une demi-couche et constat de pince s'il y a lieu). Sans organe : n = ⌈b / t_max⌉.
    let composition = equal(t);
    if (entered === "auto" && params.bolts.perTread > 0 && composition.lamellae % 2 === 0) {
      const n = composition.lamellae + 1;
      composition = { lamellae: n, lamellaThickness: b / n };
    }
    return {
      kind: "glulam",
      method: "straight",
      curved: false,
      ...composition,
      innerRadius,
      ratio: Number.POSITIVE_INFINITY,
      kr: 1,
      bends: [],
    };
  }
  const rec = getRule(LAMINATION_RULE_ID).recommande ?? Number.NaN;
  const composition = equal(
    entered !== "auto" ? entered : Math.max(1, Math.floor(innerRadius / rec)),
  );
  const ratio = innerRadius / composition.lamellaThickness;
  return {
    kind: "glulam",
    method: "mould",
    curved: true,
    ...composition,
    innerRadius,
    ratio,
    kr: laminationKr(ratio),
    bends: trace.arcs.map((a) => ({
      radius: a.radius - b / 2,
      sigma0: a.sigma0,
      sigma1: a.sigma1,
    })),
  };
}

// ------------------------------------------------------------------ FCBA

/**
 * Classe de résistance `auto` (mêmes hypothèses « à valider » que `wood-cut`) : colonne C30 pour
 * le pin ; aucune colonne pour chêne, hêtre et frêne, classés D30 (QUESTIONS A36 (1)) : le
 * tableau FCBA (« résineux ≥ C30 », « feuillus ≥ D40 ») ne couvre pas un bois D30, il est déclaré
 * non exploitable et le reste de repli `section.residualFallback` s'applique (QUESTIONS A37 (2),
 * décision du 2026-10-10, raison `structure.woodCut.fcba.hardwoodD30`, `fcbaUnknownClassReason`) ;
 * inconnue pour le lamellé-collé (classes GL : QUESTIONS A33). Une classe C30 ou D40 saisie
 * (`strengthClass`) est lue telle quelle.
 */
export const WOOD_CENTRAL_AUTO_CLASS: Readonly<Record<WoodMaterialId, StrengthClass | "unknown">> =
  {
    "wood-pine": "C30",
    "wood-oak": "unknown",
    "wood-beech": "unknown",
    "wood-ash": "unknown",
    "wood-glulam": "unknown",
  };

/**
 * Lecture du tableau FCBA (C §1.4, « × 2 » pour une crémaillère centrale) : exploitable sur une
 * trace droite, classe connue, b ≥ facteur × plus petite épaisseur tabulée, hauteur à monter et
 * projection horizontale dans le domaine de l'exemple publié (mêmes hypothèses que `wood-cut`).
 */
export function woodCentralFcba(
  ctx: StructureContext,
  params: WoodCentralParams,
  trace: CentralTrace,
): WoodCentralFcba {
  const table = fcbaTable();
  const cls =
    params.strengthClass === "auto"
      ? WOOD_CENTRAL_AUTO_CLASS[params.material]
      : params.strengthClass;
  const b = params.section.width;
  const unusable = (m: Message): WoodCentralFcba => ({ cls, required: null, unusable: m });
  if (trace.kind !== "straight") return unusable(msg("structure.woodCentral.fcba.curved"));
  const sig = trace.nosingSigma;
  const domain = fcbaDomainReason(
    table,
    ctx.project.site.floorToFloor,
    Math.abs(sig[sig.length - 1]! - sig[0]!),
  );
  if (cls === "unknown") {
    const base = fcbaUnknownClassFullReason(params.material, params.strengthClass, domain);
    const isHardwood =
      params.strengthClass === "auto" && HARDWOOD_WOOD_CLASS[params.material] !== undefined;
    // Feuillu D30 en classe `auto` : le repli ne vaut que dans le domaine d'épaisseur du tableau
    // (b / facteur au moins la plus petite épaisseur de chaque colonne, relecture A38 (15)).
    const outOfRange = isHardwood
      ? fallbackThicknessOutOfRange(table, b / table.centralFactor)
      : null;
    const reason =
      outOfRange === null
        ? base
        : msg("compliance.join.semicolon", {
            first: base,
            next: msg("structure.woodCentral.fcba.belowSmallestWidth", {
              width: dec(b, 0),
              factor: dec(table.centralFactor, 0),
              cls: outOfRange,
            }),
          });
    // Feuillu D30 en classe `auto` dans le domaine : reste saisi contrôlé contre le repli (A38 (15)).
    const hardwood = domain === null && isHardwood && outOfRange === null;
    return hardwood ? { ...unusable(reason), hardwoodFallback: true } : unusable(reason);
  }
  const required = requiredCentralResidual(table, cls, b);
  if (required === null) {
    return unusable(
      msg("structure.woodCentral.fcba.belowSmallestWidth", {
        width: dec(b, 0),
        factor: dec(table.centralFactor, 0),
        cls,
      }),
    );
  }
  if (domain) return unusable(domain);
  return { cls, required };
}

// ------------------------------------------------------------------ Outils

const v3 = (p: Vec2, z: Mm): Vec3 => ({ x: p.x, y: p.y, z });
const h3 = (p: Vec2): Vec3 => ({ x: p.x, y: p.y, z: 0 });

/** Pas d'échantillonnage de la sous-face (courbe des nez non affine) et des arcs en 3D, mm. */
const SAMPLE_STEP: Mm = 50;
/** Écart toléré à la linéarité de la courbe des nez entre deux nœuds (mm). */
const LINEAR_TOL = 1e-6;
/** Demi-largeur de recherche d'une ligne de nez sur la trace autour de son abscisse, mm. */
const SEARCH_SPAN: Mm = 3000;
const SEARCH_STEP: Mm = 5;

/**
 * Abscisse σ où la droite (o, dir) coupe la parallèle à la trace à la distance `w` (positive à
 * gauche) : racine de cross(dir, P(σ) + w·L(σ) − o) la plus proche de `guess` (balayage puis
 * dichotomie) ; `null` si la droite ne la coupe pas dans la fenêtre de recherche.
 */
function lineSigma(trace: CentralTrace, o: Vec2, dir: Vec2, w: Mm, guess: Mm): Mm | null {
  const f = (s: Mm): number =>
    V.cross(dir, V.sub(V.addScaled(trace.point(s), trace.left(s), w), o));
  const f0 = f(guess);
  if (f0 === 0) return guess;
  let lo = Number.NaN;
  let hi = Number.NaN;
  let prevA = f0;
  let prevB = f0;
  for (let d = SEARCH_STEP; d <= SEARCH_SPAN; d += SEARCH_STEP) {
    const fb = f(guess + d);
    if (Math.sign(fb) !== Math.sign(prevB)) {
      lo = guess + d - SEARCH_STEP;
      hi = guess + d;
      break;
    }
    const fa = f(guess - d);
    if (Math.sign(fa) !== Math.sign(prevA)) {
      lo = guess - d;
      hi = guess - d + SEARCH_STEP;
      break;
    }
    prevA = fa;
    prevB = fb;
  }
  if (Number.isNaN(lo)) return null;
  let flo = f(lo);
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    const fm = f(m);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = m;
      flo = fm;
    } else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * Étendue [σ_min ; σ_max] de la ligne de nez `k` décalée de `offset` vers le haut de
 * l'escalier, sur la largeur de la poutre (faces et axe) ; `null` si elle ne la coupe pas.
 */
function lineSpan(
  trace: CentralTrace,
  k: NosingLine,
  guess: Mm,
  offset: Mm,
  b: Mm,
): { lo: Mm; hi: Mm } | null {
  let up = V.perpLeft(k.dir);
  if (V.dot(up, trace.tangent(guess)) < 0) up = V.scale(up, -1);
  const o = V.addScaled(k.p, up, offset);
  let lo = Infinity;
  let hi = -Infinity;
  for (const w of [-b / 2, -b / 4, 0, b / 4, b / 2]) {
    const s = lineSigma(trace, o, k.dir, w, guess + offset);
    if (s === null) return null;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return { lo, hi };
}

/** Étendue verticale [min ; max] d'un polygone sur la verticale x ; `null` hors du polygone. */
function verticalExtent(poly: readonly Vec2[], x: Mm): [Mm, Mm] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((a.x - x) * (b.x - x) > 0) continue;
    if (Math.abs(b.x - a.x) < 1e-9) {
      if (Math.abs(a.x - x) < 1e-9) {
        lo = Math.min(lo, a.y, b.y);
        hi = Math.max(hi, a.y, b.y);
      }
      continue;
    }
    const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi > lo ? [lo, hi] : null;
}

/** Abscisses d'échantillonnage de [a ; b] : nœuds imposés, pas `SAMPLE_STEP` où `refine(x0, x1)`. */
function samples(a: Mm, b: Mm, nodes: readonly Mm[], refine: (x0: Mm, x1: Mm) => boolean): Mm[] {
  const base = [...new Set([a, b, ...nodes.filter((x) => x > a && x < b)])].sort((p, q) => p - q);
  const out: Mm[] = [];
  for (let i = 0; i < base.length; i++) {
    const x0 = base[i]!;
    out.push(x0);
    const x1 = base[i + 1];
    if (x1 === undefined || !(x1 - x0 > SAMPLE_STEP) || !refine(x0, x1)) continue;
    const n = Math.ceil((x1 - x0) / SAMPLE_STEP);
    for (let j = 1; j < n; j++) out.push(x0 + ((x1 - x0) * j) / n);
  }
  return out;
}

/** Intervalles [lo ; hi] privés des zones ouvertes `cut` (intervalles de longueur ≥ 0). */
function subtractIntervals(
  from: readonly { lo: Mm; hi: Mm }[],
  cut: readonly { lo: Mm; hi: Mm }[],
): { lo: Mm; hi: Mm }[] {
  let out = from.map((r) => ({ ...r }));
  for (const z of cut) {
    const next: { lo: Mm; hi: Mm }[] = [];
    for (const r of out) {
      if (z.hi <= r.lo || z.lo >= r.hi) {
        next.push(r);
        continue;
      }
      if (z.lo > r.lo) next.push({ lo: r.lo, hi: z.lo });
      if (z.hi < r.hi) next.push({ lo: z.hi, hi: r.hi });
    }
    out = next;
  }
  return out;
}

/**
 * Jusqu'à `n` positions de boulons dans les intervalles permis, à l'entraxe `spacing` au moins :
 * intervalles les plus longs d'abord ; un boulon au milieu, plusieurs répartis bout à bout ; une
 * position à moins de `spacing` d'une position déjà retenue (autre intervalle) est écartée.
 * Si cette répartition en place moins de `n` alors qu'un placement au plus tôt (de σ croissant,
 * chaque organe au plus près du précédent) en place davantage, celui-ci est retenu : deux
 * intervalles courts de part et d'autre d'un perçage peuvent porter chacun un organe (relecture
 * A35, M1 de l'exemple droit).
 */
function placeBolts(intervals: readonly { lo: Mm; hi: Mm }[], n: number, spacing: Mm): Mm[] {
  if (n <= 0) return [];
  const spread = placeBoltsSpread(intervals, n, spacing);
  if (spread.length >= n) return spread;
  const early: Mm[] = [];
  for (const r of [...intervals].sort((p, q) => p.lo - q.lo)) {
    if (r.hi < r.lo - 1e-9) continue;
    const prev = early[early.length - 1];
    let x = prev === undefined ? r.lo : Math.max(r.lo, prev + spacing);
    while (early.length < n && x <= r.hi + 1e-9) {
      early.push(x);
      x += spacing;
    }
  }
  return early.length > spread.length ? early : spread;
}

/** Répartition « au milieu » de `placeBolts` (intervalles les plus longs d'abord). */
function placeBoltsSpread(intervals: readonly { lo: Mm; hi: Mm }[], n: number, spacing: Mm): Mm[] {
  const byLength = [...intervals].sort((p, q) => q.hi - q.lo - (p.hi - p.lo));
  const out: Mm[] = [];
  for (const r of byLength) {
    const left = n - out.length;
    if (left <= 0) break;
    const len = r.hi - r.lo;
    if (len < -1e-9) continue;
    const k = Math.min(left, 1 + Math.floor(Math.max(0, len) / spacing + 1e-9));
    const xs = k === 1 ? [(r.lo + r.hi) / 2] : spread(len, 0, k).map((x) => r.lo + x);
    out.push(...xs.filter((x) => out.every((y) => Math.abs(x - y) >= spacing - 1e-9)));
  }
  return out.sort((p, q) => p - q);
}

/** Pas d'échantillonnage des parties d'une assise où un organe tient (A36 (4)), mm. */
const FIT_STEP: Mm = 2;

/** Nature d'un organe vertical de marche. */
type OrganKind = WoodCentralBolt["kind"];

/** Zone d'obstacle d'ancrage ]lo ; hi[ le long de la trace, altitude à laisser libre à σ. */
interface ObstacleZone {
  readonly lo: Mm;
  readonly hi: Mm;
  readonly top: (s: Mm) => Mm;
}

/** Règles de placement des organes d'une assise (pinces avant et arrière, entraxe, obstacles). */
interface SeatRules {
  /** Règles des boulons ou des tire-fonds (A35 (l)). */
  readonly kind: OrganKind;
  readonly front: Mm;
  readonly rear: Mm;
  readonly spacing: Mm;
  readonly obstacles: readonly ObstacleZone[];
}

/** Organes obtenus à des positions données. */
interface OrganTry {
  readonly organs: WoodCentralBolt[];
  /** Plus court ancrage d'un tire-fond refusé (∞ : aucun refus). */
  readonly shortest: Mm;
  /** Un tire-fond refusé tombait au-dessus d'un obstacle. */
  readonly obstructed: boolean;
  /**
   * Un tire-fond refusé l'était par la seule pince axiale a1,CG le long du fil (A36 (4)) : même
   * raccourci jusqu'à l'ancrage minimal, son centre de gravité restait trop près d'une surface
   * de bout.
   */
  readonly thread: boolean;
}

/** Placement d'une assise selon des règles. */
interface SeatPlan extends OrganTry {
  readonly rules: SeatRules;
  /** Longueur utile de l'assise (entre ses bouts), mm. */
  readonly length: Mm;
  readonly positions: readonly Mm[];
  /** Positions sur toute l'assise, obstacles ignorés. */
  readonly all: readonly Mm[];
}

/**
 * Décalage latéral d'un organe de part et d'autre d'un trait de scie d'âme de platine permis
 * (A35 (a), convention à valider) : il reste au moins la pince de rive de sa nature jusqu'aux
 * faces, b/2 − décalage ≥ a4,c pour un boulon, ≥ max(a4,c ; a2,CG) pour un tire-fond (A35 (l)).
 */
export function kerfShiftAllowed(
  b: Mm,
  shift: Mm,
  kind: OrganKind,
  spacing: Pick<WoodCentralBoltSpacing, "ec5" | "lag">,
): boolean {
  const min = kind === "bolt" ? spacing.ec5.a4c : spacing.lag.faceDistance;
  return b / 2 - shift >= min - 1e-9;
}

/**
 * Haut d'un trait de scie sous un organe vertical à σ de demi-largeur `r` (perçage et jeu) :
 * plus haute altitude du contour exact (`BeamKerf.outline`, âme de pied en escalier, A35 (a))
 * sur [σ − r ; σ + r] ∩ [σ0 ; σ1] ; sans contour, `z1`. Hors du trait, −∞.
 */
export function kerfObstacleTop(k: BeamKerf, s: Mm, r: Mm): Mm {
  const lo = Math.max(k.sigma0, s - r);
  const hi = Math.min(k.sigma1, s + r);
  if (hi < lo) return -Infinity;
  if (!k.outline || k.outline.length < 3) return k.z1;
  const eps = 1e-6;
  const xs = [lo, hi, s, ...k.outline.map((p) => p.x)]
    .filter((x) => x >= lo - eps && x <= hi + eps)
    .flatMap((x) => [x - eps, x, x + eps])
    .map((x) => Math.min(k.sigma1 - eps, Math.max(k.sigma0 + eps, x)));
  let top = -Infinity;
  for (const x of xs) {
    const e = verticalExtent(k.outline, x);
    if (e) top = Math.max(top, e[1]);
  }
  return Number.isFinite(top) ? top : k.z1;
}

/**
 * Distance signée (positive à gauche) d'un organe vertical au plan d'une âme de platine
 * (QUESTIONS A38 (8), décision du 2026-10-11) : organe à l'abscisse `s`, décalé de `side` vers la
 * gauche de la trace, en plan P = trace.point(s) + side · trace.left(s) ; plan réel de l'âme
 * (`BeamKerf.line`, corde de la trace) : d = (P − centre) · normale gauche de l'âme. Sans plan
 * réel : le décalage lui-même (plan médian sur la trace, comportement antérieur). Sur une trace
 * courbe, l'écart avec la trace vaut au plus la flèche de la corde.
 */
export function kerfPlaneOffset(
  k: BeamKerf,
  trace: Pick<CentralTrace, "point" | "left">,
  s: Mm,
  side: Mm,
): Mm {
  if (!k.line) return side;
  const p = V.addScaled(trace.point(s), trace.left(s), side);
  return V.dot(V.perpLeft(k.line.dir), V.sub(p, k.line.center));
}

/**
 * Décalage latéral (vers la gauche de la trace) qui met un organe à l'abscisse `s` à la
 * distance signée `target` du plan de l'âme (`kerfPlaneOffset` affine en `side`) ; NaN si la
 * trace est d'équerre sur le plan (sans objet pour une âme le long de la trace).
 */
export function kerfSideOffset(
  k: BeamKerf,
  trace: Pick<CentralTrace, "point" | "left">,
  s: Mm,
  target: Mm,
): Mm {
  if (!k.line) return target;
  const d0 = kerfPlaneOffset(k, trace, s, 0);
  const slope = V.dot(V.perpLeft(k.line.dir), trace.left(s));
  return Math.abs(slope) > 1e-6 ? (target - d0) / slope : Number.NaN;
}

/** Placement des organes de toutes les assises (passe de `placeSeats`). */
interface SeatPlacement {
  /** Organes de chaque assise, dans l'ordre des assises. */
  readonly organs: readonly (readonly WoodCentralBolt[])[];
  /** Assises incomplètes et raison (constat `FAB_LIMON_CENTRAL_BOIS_BOULONS`). */
  readonly missing: readonly MissingSeat[];
  readonly rulesFor: Record<OrganKind, SeatRules>;
}

/** Assise qui ne reçoit pas tous ses organes. */
interface MissingSeat {
  readonly seat: SeatDraft;
  readonly placed: number;
  readonly length: Mm;
  readonly reason: "missing" | "blocked" | "lagShort";
  readonly anchorage: Mm;
  readonly rules: SeatRules;
  /** Un tire-fond a été refusé par la pince axiale a1,CG le long du fil (A36 (4)). */
  readonly thread: boolean;
}

/**
 * Place à réserver sous chaque assise au-dessus de l'âme de pied d'une platine (QUESTIONS
 * A38 (6), décision du 2026-10-11 : « la place du tire-fond réellement posé, rien si aucun ne
 * tient »), mm sous l'assise, à partir des organes d'une pré-passe **sans obstacle d'ancrage**
 * (`organs`, ni perçage ni trait de scie) :
 * - réservation de l'assise = max des (L − tm + `tipCover`) de ses tire-fonds, L étant la
 *   longueur **posée** par la pré-passe (le plus long tire-fond qui tient l'ancrage, la pince
 *   axiale a1,CG et le bois de l'assise, au plus `lagScrews.maxLength`) : l'âme de pied ne
 *   raccourcit pas le tire-fond posé ;
 * - assise sans tire-fond dans la pré-passe (aucun ne tient, ou seuls des boulons traversants) :
 *   0, rien n'est réservé. Un boulon traversant n'est posé qu'au-delà de σ* (place de l'écrou
 *   sous la sous-face), donc au-delà de la coupe au sol où finit l'âme de pied : il ne passe
 *   jamais au-dessus d'elle. Un boulon que les broches de la platine écartent dans la passe
 *   finale devient un tire-fond arrêté au-dessus de l'âme et de ses perçages (U à poutre de
 *   220 mm en couches empilées, M3), comme avant A38.
 * La passe finale pose sous chaque assise le tire-fond le plus long au-dessus des obstacles : au
 * droit de l'âme, il retrouve la longueur de la pré-passe (relecture finale A38 : avant, la
 * place du plus court tire-fond qui tient était réservée, option que la décision écartait).
 */
export function seatReservations(
  drafts: readonly unknown[],
  organs: readonly (readonly WoodCentralBolt[])[],
  o: { readonly tm: Mm; readonly tipCover: Mm },
): Mm[] {
  return drafts.map((_, i) => {
    let out = 0;
    for (const lag of organs[i] ?? []) {
      if (lag.kind === "lagScrew") out = Math.max(out, lag.length - o.tm + o.tipCover);
    }
    return out;
  });
}

/**
 * Place à laisser libre sous le dessus de la poutre à σ (`ShoeBeamGeometry.seatClearanceAt`), mm,
 * à partir des réservations des assises (`seatReservations`, mesurées sous leur assise) : une
 * assise d'altitude z_i qui couvre σ ([σ0 ; σ1]) demande r_i − (z_i − dessus(σ)) sous le dessus
 * de la poutre à σ ; la plus grande de ces demandes (au moins 0) est retenue. Là où deux assises
 * se recouvrent (dent de l'assise suivante au-dessus de l'entaille de la précédente), le dessus
 * est celui de l'assise basse et la demande de l'assise haute, mesurée depuis son propre
 * niveau, n'y pèse que si elle descend plus bas. Hors des assises : celle de l'assise la plus
 * proche.
 */
export function seatClearanceFrom(
  drafts: readonly Pick<SeatDraft, "sigma0" | "sigma1" | "z">[],
  reserved: readonly Mm[],
  topAt: (s: Mm) => Mm,
): (s: Mm) => Mm {
  return (s) => {
    const top = topAt(s);
    let out = -Infinity;
    let nearest = 0;
    let gap = Infinity;
    drafts.forEach((d, i) => {
      const r = (reserved[i] ?? 0) - (d.z - top);
      if (s >= d.sigma0 - 1e-9 && s <= d.sigma1 + 1e-9) out = Math.max(out, r);
      const g = s < d.sigma0 ? d.sigma0 - s : s - d.sigma1;
      if (g < gap) {
        gap = g;
        nearest = r;
      }
    });
    return Math.max(0, Number.isFinite(out) ? out : nearest);
  };
}

/** Refus du cintrage sans recours à des lamelles plus fines (1 mm déjà insuffisant). */
function bendRadiusOnly(lam: WoodCentralLamination, min: number): boolean {
  return lam.innerRadius / 1 < min;
}

// ------------------------------------------------------------------ Construction

/**
 * Poutre du limon central bois. Ne lève jamais : erreurs dans `errors`, poutre partielle ou
 * absente.
 */
export function buildWoodCentralBeam(input: WoodCentralBeamInput): WoodCentralBeamResult {
  try {
    return beamOf(input);
  } catch (err) {
    return {
      ...emptyResult(input, null),
      errors: [msg("structure.woodCentral.error.beamNotGenerated", { detail: errorMessage(err) })],
    };
  }
}

/** Résultat sans pièce (refus, erreur) ; lamellation et lecture FCBA calculées si possible. */
function emptyResult(
  input: WoodCentralBeamInput,
  known: {
    readonly lamination: WoodCentralLamination;
    readonly fcba: WoodCentralFcba;
    readonly residual: Mm;
    readonly rearDepth: Mm;
  } | null,
  errors: readonly Message[] = [],
  notes: readonly Message[] = [],
): WoodCentralBeamResult {
  const b = input.params.section.width;
  const curvedTrace = input.trace.kind !== "straight";
  const lamination: WoodCentralLamination = known?.lamination ?? {
    kind: input.params.section.kind,
    method: input.params.section.kind === "solid" ? "solid" : "straight",
    curved: false,
    lamellaThickness: b,
    lamellae: 1,
    innerRadius: Number.POSITIVE_INFINITY,
    ratio: Number.POSITIVE_INFINITY,
    kr: 1,
    bends: [],
  };
  const residual = known?.residual ?? Number.NaN;
  return {
    parts: [],
    anchorKind: resolveAnchorKind(input.params, curvedTrace),
    anchorsWelded: false,
    curvedMethod: resolveCurvedMethod(input.params, curvedTrace),
    stacked: null,
    seats: [],
    lamination,
    fcba: known?.fcba ?? { cls: "unknown", required: null },
    residual,
    rearDepth: known?.rearDepth ?? Number.NaN,
    assemblies: [],
    section: rectSection(b, residual),
    sectionLabel: sectionLabelOf(lamination, b, residual),
    spanH: 0,
    slope: input.trace.slope,
    notes,
    errors,
  };
}

/** Rectangle b × h : aire, inertie, module (nuls pour une hauteur non finie). */
function rectSection(b: Mm, h: Mm): BeamSection {
  if (!(Number.isFinite(h) && h > 0)) return { area: 0, i: 0, w: 0 };
  return { area: b * h, i: (b * h ** 3) / 12, w: (b * h ** 2) / 6 };
}

/** Épaisseurs extrêmes des couches empilées calées sur les assises (A35 (g)). */
interface LayerRange {
  readonly min: Mm;
  readonly max: Mm;
}

function sectionLabelOf(
  lam: WoodCentralLamination,
  b: Mm,
  height: Mm,
  range: LayerRange | null = null,
): Message {
  const h = Number.isFinite(height) ? dec(Math.ceil(height - 1e-6), 0) : dec(0, 0);
  if (lam.kind === "solid")
    return msg("structure.woodCentral.section.solid", { width: dec(b, 0), height: h });
  if (lam.method === "stacked") {
    // Couches d'épaisseurs différentes (joints calés sur les assises, A35 (g)).
    if (range && range.max - range.min > 0.05)
      return msg("structure.woodCentral.section.stackedGlulamSeated", {
        width: dec(b, 0),
        height: h,
        count: lam.lamellae,
        min: dec(range.min, 1),
        max: dec(range.max, 1),
      });
    return msg("structure.woodCentral.section.stackedGlulam", {
      width: dec(b, 0),
      height: h,
      count: lam.lamellae,
      thickness: dec(lam.lamellaThickness, 1),
    });
  }
  return msg(
    lam.curved
      ? "structure.woodCentral.section.curvedGlulam"
      : "structure.woodCentral.section.glulam",
    {
      width: dec(b, 0),
      height: h,
      count: lam.lamellae,
      thickness: dec(lam.lamellaThickness, 1),
    },
  );
}

/** Assise en cours de construction. */
interface SeatDraft {
  readonly tread: number;
  readonly z: Mm;
  sigma0: Mm;
  /** Face de la dent suivante (début de l'entaille, ou fond de l'assise sans entaille). */
  face: Mm;
  /** Fond de l'assise (fond d'entaille ou face de la dent). */
  sigma1: Mm;
  /** Arrière de la marche le plus proche (σ_min de la ligne arrière). */
  rearMin: Mm;
  notch: boolean;
  /**
   * Contremarches pleines (A33 (i)) : prolongement de la marche au-delà de la face arrière de
   * la contremarche (entaille arrière, plus le biais de la ligne de nez sur la largeur de la
   * poutre), mm ; 0 sinon.
   */
  underRiser: Mm;
}

function beamOf(input: WoodCentralBeamInput): WoodCentralBeamResult {
  const { ctx, params, trace, checks } = input;
  const { project, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const wood = profile.wood;
  const spec = project.stair.treads;
  const b = params.section.width;
  const c = wood.clearance;
  const tm = spec.thickness;
  const notes: Message[] = [];
  const errors: Message[] = [];

  // 1. Valeurs auto, lamellation, FCBA, filière et ancrage retenus.
  let lamination = laminationOf(params, trace, profile);
  const fcba = woodCentralFcba(ctx, params, trace);
  const residual =
    params.section.residual !== "auto"
      ? params.section.residual
      : (fcba.required ?? params.section.residualFallback);
  const rearDepth = params.notch.rearDepth !== "auto" ? params.notch.rearDepth : wood.housingDepth;
  const known = { lamination, fcba, residual, rearDepth };
  const curvedTrace = trace.kind !== "straight";
  const curvedMethod = resolveCurvedMethod(params, curvedTrace);
  const anchorKind = resolveAnchorKind(params, curvedTrace);
  if (params.section.kind === "solid" && curvedTrace) {
    return emptyResult(input, known, [msg("structure.woodCentral.unsupported.solidCurved")]);
  }
  const krMin = getRule(LAMINATION_RULE_ID).min ?? Infinity;
  if (lamination.curved && !(lamination.ratio >= krMin)) {
    return emptyResult(input, known, [
      // Lamelle de 1 mm (plus petite épaisseur saisissable) déjà insuffisante : seul le rayon.
      msg(
        bendRadiusOnly(lamination, krMin)
          ? "structure.woodCentral.error.bendRadiusMinPly"
          : "structure.woodCentral.error.bendRadius",
        {
          radius: dec(lamination.innerRadius, 0),
          thickness: dec(lamination.lamellaThickness, 1),
          ratio: dec(lamination.ratio, 0),
          min: dec(getRule(LAMINATION_RULE_ID).min ?? Number.NaN, 0),
        },
      ),
    ]);
  }

  // 2. Assises (développement à l'axe).
  const nosings = stepping.nosings;
  const treads = stepping.treads;
  const sig = trace.nosingSigma;
  if (nosings.length < 2 || treads.length === 0 || sig.length !== nosings.length) {
    return emptyResult(input, known, [msg("structure.woodCentral.error.degenerate")]);
  }
  const full = spec.risers === "full";
  // Face arrière de la contremarche (pleine) ou nez décalé du débord : départ de la poutre (nez 0),
  // chevêtre (nez d'arrivée) et, sans entaille arrière, fond des assises.
  const riserOffset = spec.nosing + (full ? spec.riserThickness : 0);
  // Contremarches pleines et entaille arrière (A33 (i)) : la marche entaillée est prolongée
  // sous la contremarche suivante, posée sur elle, et entre de `rearDepth` dans la dent, placée
  // derrière la contremarche (`treadsUnderRisers`) ; la contremarche ne recoupe pas la poutre.
  const underRiser = full && rearDepth > 0;
  const spanOf = (k: number, offset: Mm = riserOffset): { lo: Mm; hi: Mm } | null =>
    lineSpan(trace, nosings[k]!, sig[k]!, offset, b);
  const front = spanOf(0);
  const arrival = spanOf(nosings.length - 1);
  if (!front || !arrival) {
    return emptyResult(input, known, [
      msg("structure.woodCentral.error.seatMissesTrace", {
        nosing: front ? nosings.length - 1 : 0,
      }),
    ]);
  }
  const head = params.anchors.head;
  // Épaisseur de l'ancrage : âme du sabot ou platine d'appui (coupe de niveau au pied, coupe
  // d'aplomb en tête).
  const anchorT = anchorKind === "shoe" ? params.anchors.thickness : params.anchors.plate.thickness;
  // Chevêtre en retrait du débord du nez d'arrivée (convention de `wood-cut`, confirmée,
  // QUESTIONS A33 (i)).
  const trimmer = arrival.hi;
  const sH = trimmer - (head ? anchorT + c : 0);
  const sF = front.hi;
  const drafts: SeatDraft[] = [];
  let prevFace = sF;
  const sorted = [...treads].sort((p, q) => p.number - q.number);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    const k = t.number;
    const last = i === sorted.length - 1;
    const z = t.z - tm;
    // Arrière de la marche. Contremarches pleines (A33 (i)), marche non finale : prolongée sous
    // la contremarche au-delà de sa face arrière, assez pour que la dent (à `rearDepth` devant
    // l'arrière de la marche) reste entièrement derrière la contremarche, même sur une marche
    // balancée dont la ligne de nez coupe la poutre en biais (ajusté par itérations).
    let rear = k < nosings.length ? spanOf(k) : null;
    let extension = 0;
    if (rear && !last && underRiser) {
      const back = rear;
      extension = rearDepth + (back.hi - back.lo);
      for (let it = 0; it < 8; it++) {
        rear = spanOf(k, riserOffset + extension);
        if (!rear) break;
        const deficit = back.hi - (rear.lo - rearDepth);
        if (!(deficit > 1e-9)) break;
        extension += deficit;
      }
    }
    if (!rear) {
      return emptyResult(input, known, [
        msg("structure.woodCentral.error.seatMissesTrace", { nosing: k }),
      ]);
    }
    let face: Mm;
    let sigma1: Mm;
    let notch = false;
    if (last) {
      face = sH;
      sigma1 = sH;
    } else if (rearDepth > 0) {
      face = rear.lo - rearDepth;
      sigma1 = rear.hi + c;
      notch = true;
    } else {
      face = rear.hi;
      sigma1 = rear.hi;
    }
    drafts.push({
      tread: k,
      z,
      sigma0: prevFace,
      face,
      sigma1,
      rearMin: rear.lo,
      notch,
      underRiser: extension,
    });
    prevFace = face;
  }
  for (const d of drafts) {
    if (!(d.face > d.sigma0 + 1) || !(d.sigma1 > d.sigma0 + 1)) {
      return emptyResult(input, known, [msg("structure.woodCentral.error.degenerate")]);
    }
  }

  // 3. Sous-face : z_low(σ) = nosingZ(σ) − Δ, Δ minimal pour le reste sous entaille.
  const Z = trace.nosingZ;
  const cosAt = (s: Mm): number => {
    const h = 0.5;
    const slope = (Z(s + h) - Z(s - h)) / (2 * h);
    return 1 / Math.hypot(1, slope);
  };
  let delta = -Infinity;
  for (const d of drafts) delta = Math.max(delta, residual / cosAt(d.sigma1) + Z(d.sigma1) - d.z);
  const zLow = (s: Mm): Mm => Z(s) - delta;

  // 4. Contour développé (u = σ, z), entailles comprises.
  const top: Vec2[] = [V.vec(sF, drafts[0]!.z)];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i]!;
    const next = drafts[i + 1];
    if (!next) {
      top.push(V.vec(d.sigma1, d.z));
      continue;
    }
    if (d.notch) {
      const notchTop = Math.min(d.z + tm + c, next.z);
      top.push(V.vec(d.sigma1, d.z), V.vec(d.sigma1, notchTop));
      if (next.z - notchTop > 1e-6) top.push(V.vec(d.face, notchTop), V.vec(d.face, next.z));
      else top.push(V.vec(d.face, next.z));
    } else {
      top.push(V.vec(d.face, d.z), V.vec(d.face, next.z));
    }
  }
  const floorLevel = params.anchors.foot ? anchorT : 0;
  const lineNodes = [
    ...sig,
    ...trace.naissances.map((n) => n.sigma),
    ...drafts.flatMap((d) => [d.sigma0, d.sigma1, d.face]),
  ];
  const nonLinear = (x0: Mm, x1: Mm): boolean =>
    [0.25, 0.5, 0.75].some(
      (t) => Math.abs(Z(x0 + (x1 - x0) * t) - (Z(x0) + (Z(x1) - Z(x0)) * t)) > LINEAR_TOL,
    );
  const bottomXs = samples(sF, sH, lineNodes, nonLinear);
  const raw = [...bottomXs.map((x) => V.vec(x, zLow(x))), ...[...top].reverse()];
  const outline = ensureCCW(
    removeCollinear(clipHalfPlane(ensureCCW(raw), V.vec(0, floorLevel), V.vec(0, 1))),
  );
  if (outline.length < 3 || !(area(outline) > 1)) {
    return emptyResult(input, known, [msg("structure.woodCentral.error.degenerate")]);
  }
  let sStart = Infinity;
  let sEnd = -Infinity;
  for (const p of outline) {
    sStart = Math.min(sStart, p.x);
    sEnd = Math.max(sEnd, p.x);
  }
  const onFloor = outline.filter((p) => Math.abs(p.y - floorLevel) < 1e-6).map((p) => p.x);
  const floorCut =
    onFloor.length >= 2 && Math.max(...onFloor) - Math.min(...onFloor) > 1e-6
      ? { x0: Math.min(...onFloor), x1: Math.max(...onFloor) }
      : null;
  // Dessous réel de la poutre : contour développé (sous-face échantillonnée, coupe au sol).
  const bottomAt = (x: Mm): Mm => verticalExtent(outline, x)?.[0] ?? Math.max(zLow(x), floorLevel);
  const id = WOOD_CENTRAL_BEAM_ID;
  const mark = WOOD_CENTRAL_BEAM_MARK;
  // Mesure le long du fil depuis un point du développement jusqu'à la plus proche surface de
  // bout (faces verticales de cran, face avant, coupe de tête, coupe au sol, plafond des
  // entailles) : pince axiale a1,CG des tire-fonds (QUESTIONS A36 (4)) et pince a3,c des
  // boulons du sabot de pied (A36 (10)) ; convention à valider (en-tête de `woodSpacing.ts`).
  const grainDir = grainDirection(lamination.method, trace.slope);
  const alongGrain = (p: Vec2): Mm => grainEndDistance(p, grainDir, outline, isBeamEndSide);

  // 5. Organes de marche (placement factorisé, `placeSeats`) puis ancrages (sabots en U ou
  // platines à âme noyée, A33 (f), A34 (c), même entrée). Les organes sont placés deux fois
  // (QUESTIONS A38 (6), décision du 2026-10-11) : une pré-passe sans obstacle d'ancrage donne,
  // sous chaque assise, la place du tire-fond qui y serait réellement posé (`seatClearanceAt`),
  // lue par la platine de pied pour le dessus de son âme ; la passe finale (étape 7) place les
  // organes avec les vrais obstacles (perçages, traits de scie). Calcul en une passe, sans cycle.
  const topAt = seatTopAt(drafts);
  const bp = params.bolts;
  const lp = params.lagScrews;
  // Entraxe et pinces : saisis, ou bornes « tous angles » de l'EC5 (A34 (b), C §1.11 [71]) ;
  // tire-fonds au plus sévère des règles latérales et axiales (A35 (l)) ; ancrage minimal (mode
  // `thread` ou `total`, A38 (14)), longueur filetée et bois autour d'un perçage résolus (A37 (1)
  // (5) (17)).
  const boltSpacing = woodCentralBoltSpacing(bp, profile.fasteners, lp);
  const lagSp = boltSpacing.lag;
  const spacing = boltSpacing.minSpacing;
  const edge = boltSpacing.edgeDistance;
  // Place de l'écrou : sous-face au moins `protrusion` + pas d'arrondi au-dessus du sol ou de
  // l'ancrage de pied, de sorte que le bout du boulon (longueur arrondie) reste au-dessus (la
  // sous-face monte avec la trace : borne basse σ*, par dichotomie). Avant σ* : tire-fonds.
  // Sur la coupe au sol, la sous-face est au niveau du sol : σ* est au-delà de la coupe, donc de
  // l'âme de pied d'une platine (qui finit avant le bout de la coupe).
  const nutRoom = (x: Mm): boolean =>
    bottomAt(x) >= floorLevel + bp.protrusion + bp.lengthStep - 1e-9;
  let sNut = sF;
  if (!nutRoom(sF)) {
    let a = sF;
    let e = sH;
    if (!nutRoom(e)) sNut = Infinity;
    else {
      for (let k = 0; k < 60; k++) {
        const m = (a + e) / 2;
        if (nutRoom(m)) e = m;
        else a = m;
      }
      sNut = e;
    }
  }
  // Organes hors du joint de colle central (nombre pair de couches droites verticales saisi,
  // A34 (d)) ; nombre impair par défaut (A35 (f)) et couches empilées horizontales : sur l'axe.
  // Les couches empilées ne changent pas la filière : décalage fixé avant leur construction.
  const lateral =
    lamination.method === "straight" && lamination.lamellae % 2 === 0
      ? lamination.lamellaThickness / 2
      : 0;
  // Pince axiale a1,CG le long du fil (QUESTIONS A36 (4), à valider) : centre de gravité de la
  // seule partie filetée comprise dans la poutre, au bout côté pointe (DIN 571, longueur filetée
  // `lagScrews.threadLength`, A37 (5), `lagThreadInBeam`) ; en couches empilées, la coupe au sol
  // (parallèle au fil) est une rive : a2,CG au-dessus d'elle.
  const stackedGrain = lamination.method === "stacked";
  const threadOk = (s: Mm, z: Mm, length: Mm): boolean => {
    const anchorage = length - tm;
    const { cgDepth } = lagThreadInBeam(length, anchorage, lagSp.threadLengthOf);
    const cg = V.vec(s, z - cgDepth);
    if (stackedGrain && cg.y - floorLevel < lagSp.axial.a2CG - 1e-9) return false;
    return alongGrain(cg) >= lagSp.threadEndDistance - 1e-9;
  };
  // Demi-largeur d'un organe vertical (perçage et jeu d'atelier) autour de son axe.
  const r = bp.holeDiameter / 2 + c;

  /**
   * Organes de chaque assise (boulons traversants ou tire-fonds) avec les obstacles d'ancrage
   * donnés : perçages horizontaux `holes` (boulons de sabot ou broches) et traits de scie `kerfs`
   * des âmes de platine. Sans obstacle : pré-passe de la réservation sous les assises (A38 (6)).
   */
  const placeSeats = (
    holes: readonly ShoeBeamHole[],
    kerfs: readonly BeamKerf[],
  ): SeatPlacement => {
    // Obstacles d'ancrage sous un organe vertical, par nature d'organe : perçages horizontaux
    // (boulons de sabot ou broches) et traits de scie des âmes de platine quand l'organe tombe
    // dans le plan de l'âme. Un boulon traversant ne passe jamais au-dessus d'un obstacle ; il
    // s'écarte d'un perçage de l'entraxe des boulons (`bolts.minSpacing`, convention de A34). Un
    // tire-fond s'arrête au-dessus : autour d'un perçage horizontal, jeu géométrique (demi-somme
    // des perçages plus le jeu d'atelier en plan, pointe à `tipCover` au-dessus du perçage, comme
    // au-dessus d'un trait de scie, QUESTIONS A36 (10)) et bois `lagScrews.holeWood` entre le
    // filet (Ø d) et le bord du perçage (QUESTIONS A37 (17), `auto` 0,5·d par analogie avec
    // ETA-11/0024 via C §1.11 [94], à valider) ; aucune source ne donne l'écart entre un organe
    // vertical et un perçage horizontal, l'entraxe des vis (A35 (l)) vaut entre deux vis
    // parallèles. Un tire-fond qui ne tient ni l'écart ni l'ancrage minimal au-dessus du perçage
    // est retiré (constat `FAB_LIMON_CENTRAL_BOIS_BOULONS`, `check.fixings.blocked`).
    const boltHoleZones: ObstacleZone[] = holes.map((h) => {
      const m = Math.max(spacing, (h.diameter + bp.holeDiameter) / 2);
      return { lo: h.sigma - m, hi: h.sigma + m, top: () => h.z + m };
    });
    const lagHoleZones: ObstacleZone[] = holes.map((h) => {
      const g = lagHoleClearance(h.diameter, bp.holeDiameter, c, lp.tipCover, {
        d: boltSpacing.d,
        thickness: lagSp.holeWood,
      });
      return { lo: h.sigma - g.half, hi: h.sigma + g.half, top: () => h.z + g.above };
    });
    const holeZones: Record<OrganKind, readonly ObstacleZone[]> = {
      bolt: boltHoleZones,
      lagScrew: lagHoleZones,
    };
    // Traits de scie (QUESTIONS A38 (8), décision du 2026-10-11) : un organe est dans le plan de
    // l'âme quand sa distance au plan réel de l'âme (`BeamKerf.line`, corde de la trace ; la
    // trace à défaut) est inférieure au demi-trait plus le demi-perçage (`kerfPlaneOffset`). Il
    // est alors décalé de part et d'autre du trait, à demi-trait + demi-perçage + jeu d'atelier
    // du plan, en alternant les côtés, quand la pince de rive de sa nature le permet de ce côté
    // (`kerfShiftAllowed`, A35 (a), convention à valider) ; sinon le trait reste un obstacle
    // (organe déplacé le long de la trace ou tire-fond arrêté au-dessus du haut du trait à son
    // abscisse).
    const kerfsAt = (s: Mm): BeamKerf[] =>
      kerfs.filter((k) => s > k.sigma0 - r && s < k.sigma1 + r);
    const inPlane = (k: BeamKerf, s: Mm, side: Mm): boolean =>
      Math.abs(kerfPlaneOffset(k, trace, s, side)) < k.width / 2 + bp.holeDiameter / 2 - 1e-9;
    /** Décalage latéral de l'organe de rang `i` d'une assise, à l'abscisse `s`. */
    const lateralAt = (s: Mm, i: number, kind: OrganKind): Mm => {
      const near = kerfsAt(s);
      const hit = near.find((k) => inPlane(k, s, lateral));
      if (!hit) return lateral;
      for (const sign of i % 2 === 0 ? [1, -1] : [-1, 1]) {
        const side = kerfSideOffset(hit, trace, s, sign * (hit.width / 2 + r));
        if (
          Number.isFinite(side) &&
          kerfShiftAllowed(b, Math.abs(side), kind, boltSpacing) &&
          near.every((k) => !inPlane(k, s, side))
        )
          return side;
      }
      return lateral;
    };
    /** Plus haute altitude à laisser libre sous un organe vertical à σ (−∞ sans obstacle). */
    const obstacleTop = (s: Mm, kind: OrganKind, side: Mm): Mm => {
      let topZ = -Infinity;
      for (const o of holeZones[kind]) if (s > o.lo && s < o.hi) topZ = Math.max(topZ, o.top(s));
      for (const k of kerfsAt(s)) {
        if (inPlane(k, s, side)) topZ = Math.max(topZ, kerfObstacleTop(k, s, r) + lp.tipCover);
      }
      return topZ;
    };
    /**
     * Parties de [σ0 − r ; σ1 + r] de chaque trait où un organe de cette nature reste dans le plan
     * de l'âme malgré le décalage (échantillonnage au pas `FIT_STEP`) : obstacles évités de
     * préférence par le placement le long de la trace.
     */
    const kerfZones = (kind: OrganKind): ObstacleZone[] => {
      const out: ObstacleZone[] = [];
      for (const k of kerfs) {
        const lo = k.sigma0 - r;
        const hi = k.sigma1 + r;
        const n = Math.max(1, Math.ceil((hi - lo) / FIT_STEP));
        let start: Mm | null = null;
        for (let i = 0; i <= n; i++) {
          const s = lo + ((hi - lo) * i) / n;
          const blocked = inPlane(k, s, lateralAt(s, 0, kind));
          if (blocked && start === null) start = i === 0 ? lo : s - (hi - lo) / n;
          if (!blocked && start !== null) {
            out.push({ lo: start, hi: s, top: (x: Mm) => kerfObstacleTop(k, x, r) + lp.tipCover });
            start = null;
          }
        }
        if (start !== null)
          out.push({ lo: start, hi, top: (x: Mm) => kerfObstacleTop(k, x, r) + lp.tipCover });
      }
      return out;
    };
    /**
     * Tire-fond vertical à l'abscisse `s` sous une assise d'altitude `z`, décalé de `side` :
     * ancrage borné par le bois disponible sous l'assise (moins `tipCover`), par les obstacles
     * d'ancrage (perçages horizontaux avec le bois `lagScrews.holeWood` entre filet et perçage,
     * A37 (17) ; trait de scie dans le plan de l'organe) et par `maxLength`, longueur arrondie au
     * pas inférieur ; `organ` nul si l'ancrage minimal n'est pas tenu (`lagAnchorageHolds` :
     * mode `thread`, pénétration de la partie filetée ≥ `lagScrews.minAnchorage`, saisi ou 6·d ;
     * mode `total`, ancrage ≥ `lagScrews.minTotalAnchorage`, A37 (1), A38 (14)) ; `anchorage`
     * rend alors la grandeur comparée (`lagRetained`). Pince axiale a1,CG le long du fil (A36 (4),
     * CG de la partie filetée, A37 (5)) : le tire-fond est raccourci au pas `bolts.lengthStep`
     * tant que l'ancrage minimal reste tenu (la longueur filetée b(L) est recalculée à chaque
     * pas), jusqu'à la tenir ; à défaut, `organ` nul et `thread` vrai.
     */
    const lagAt = (
      s: Mm,
      z: Mm,
      side: Mm,
    ): { organ: WoodCentralBolt | null; anchorage: Mm; obstructed: boolean; thread: boolean } => {
      const lengthAbove = (floorZ: Mm): Mm => {
        const room = Math.min(z - floorZ, lp.maxLength - tm);
        return roundDownTo(tm + Math.max(0, room), bp.lengthStep);
      };
      /**
       * Tire-fond le plus long sous `floorZ`, raccourci au pas jusqu'à tenir a1,CG ; `fail` :
       * ancrage minimal non tenu (`short`) ou pince axiale intenable (`thread`).
       */
      const fit = (floorZ: Mm): { length: Mm; fail: null | "short" | "thread" } => {
        let len = lengthAbove(floorZ);
        if (!lagAnchorageHolds(lagSp, len, tm)) return { length: len, fail: "short" };
        while (!threadOk(s, z, len)) {
          const next = len - bp.lengthStep;
          if (!(bp.lengthStep > 0) || !lagAnchorageHolds(lagSp, next, tm)) {
            return { length: len, fail: "thread" };
          }
          len = next;
        }
        return { length: len, fail: null };
      };
      const woodFloor = bottomAt(s) + lp.tipCover;
      const obstacle = obstacleTop(s, "lagScrew", side);
      const got = fit(Math.max(woodFloor, obstacle));
      if (got.fail !== null) {
        // Sans l'obstacle (perçage horizontal ou trait de scie) : tire-fond complet → refus dû à
        // l'obstacle ; pince axiale intenable → refus dû à a1,CG (A36 (4)) ; sinon ancrage minimal.
        const free = obstacle > woodFloor ? fit(woodFloor) : got;
        return {
          organ: null,
          anchorage: lagRetained(lagSp, got.length, tm),
          obstructed: free.fail === null,
          thread: free.fail === "thread",
        };
      }
      return {
        organ: { kind: "lagScrew", sigma: s, lateral: side, length: got.length },
        anchorage: lagRetained(lagSp, got.length, tm),
        obstructed: false,
        thread: false,
      };
    };
    /** Un boulon traversant tient à σ : place de l'écrou et aucun obstacle d'ancrage dessous. */
    const boltFits = (s: Mm, side: Mm): boolean =>
      s >= sNut && obstacleTop(s, "bolt", side) === -Infinity;
    /**
     * Organes aux positions données : boulon traversant si l'écrou trouve sa place (σ ≥ σ*) et
     * qu'aucun obstacle d'ancrage n'est dessous, tire-fond sinon (s'il trouve assez de bois).
     */
    const organsAt = (positions: readonly Mm[], z: Mm): OrganTry => {
      const organs: WoodCentralBolt[] = [];
      let shortest = Infinity;
      let obstructed = false;
      let thread = false;
      for (const [i, s] of positions.entries()) {
        const boltSide = lateralAt(s, i, "bolt");
        if (boltFits(s, boltSide)) {
          organs.push({
            kind: "bolt",
            sigma: s,
            lateral: boltSide,
            // Jusqu'au dessous réel de la poutre (jamais sous la coupe au sol).
            length: roundUpTo(tm + (z - bottomAt(s)) + bp.protrusion, bp.lengthStep),
          });
          continue;
        }
        const lag = lagAt(s, z, lateralAt(s, i, "lagScrew"));
        if (lag.organ) organs.push(lag.organ);
        else if (lag.thread) thread = true;
        else {
          shortest = Math.min(shortest, lag.anchorage);
          if (lag.obstructed) obstructed = true;
        }
      }
      return { organs, shortest, obstructed, thread };
    };
    /** Un organe (boulon ou tire-fond) tient à l'abscisse `s` sous l'assise d'altitude `z`. */
    const organFits = (s: Mm, z: Mm): boolean =>
      boltFits(s, lateralAt(s, 0, "bolt")) ||
      lagAt(s, z, lateralAt(s, 0, "lagScrew")).organ !== null;
    /**
     * Parties de [lo ; hi] où un organe tient (pince axiale a1,CG le long du fil comprise, A36 (4)) :
     * échantillonnage au pas `FIT_STEP`, bornes affinées par dichotomie.
     */
    const fitIntervals = (lo: Mm, hi: Mm, z: Mm): { lo: Mm; hi: Mm }[] => {
      if (hi < lo - 1e-9) return [];
      const n = Math.max(1, Math.ceil((hi - lo) / FIT_STEP));
      const xs = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
      const ok = xs.map((x) => organFits(x, z));
      const edgeAt = (a: Mm, b: Mm, okA: boolean): Mm => {
        // Transition entre a (état okA) et b (état contraire) : bord admissible au plus près.
        let x0 = a;
        let x1 = b;
        for (let k = 0; k < 40; k++) {
          const m = (x0 + x1) / 2;
          if (organFits(m, z) === okA) x0 = m;
          else x1 = m;
        }
        return okA ? x0 : x1;
      };
      const out: { lo: Mm; hi: Mm }[] = [];
      let start: Mm | null = ok[0] ? xs[0]! : null;
      for (let i = 1; i < xs.length; i++) {
        if (ok[i] === ok[i - 1]) continue;
        const e = edgeAt(xs[i - 1]!, xs[i]!, ok[i - 1]!);
        if (ok[i]) start = e;
        else if (start !== null) {
          out.push({ lo: start, hi: e });
          start = null;
        }
      }
      if (start !== null) out.push({ lo: start, hi: xs[xs.length - 1]! });
      return out;
    };
    /**
     * Règles de placement d'une assise : celles des boulons (pince a3,c aux deux bouts, entraxe
     * a1) ; une assise qui porte au moins un tire-fond est replacée avec celles des tire-fonds
     * pour tous ses organes (A35 (l)). Bouts des assises : extrémités non chargées (gravité,
     * A35 (e), en-tête de `woodSpacing.ts`).
     */
    const rulesFor: Record<OrganKind, SeatRules> = {
      bolt: {
        kind: "bolt",
        front: edge,
        rear: edge,
        spacing,
        obstacles: [...boltHoleZones, ...kerfZones("bolt")],
      },
      lagScrew: {
        kind: "lagScrew",
        front: lagSp.frontEndDistance,
        rear: lagSp.rearEndDistance,
        spacing: lagSp.minSpacing,
        // Tire-fond : jeu géométrique plus bois `lagScrews.holeWood` autour d'un perçage
        // (A37 (17), convention partagée avec les broches des platines, `lagHoleClearance`).
        obstacles: [...lagHoleZones, ...kerfZones("lagScrew")],
      },
    };
    /**
     * Placement d'une assise selon des règles : hors des obstacles d'abord, puis sur toute
     * l'assise. Règles des tire-fonds : d'abord sur les seules parties de l'assise où un organe
     * tient (pince axiale a1,CG le long du fil, A36 (4), `fitIntervals`), puis sans ce filtre
     * (les tire-fonds qui ne la tiennent pas y sont refusés, ce qui renseigne le constat).
     */
    const planSeat = (d: SeatDraft, rules: SeatRules): SeatPlan => {
      const lo = d.sigma0 + rules.front;
      const hi = Math.min(d.face, d.sigma1, d.rearMin) - rules.rear;
      const free = hi < lo - 1e-9 ? [] : [{ lo, hi }];
      const fitting = rules.kind === "lagScrew" ? fitIntervals(lo, hi, d.z) : null;
      // Hors des obstacles d'ancrage d'abord ; à défaut, sur toute l'assise (tire-fonds arrêtés
      // au-dessus des obstacles).
      const all = placeBolts(free, bp.perTread, rules.spacing);
      const candidates = [
        ...(fitting
          ? [
              placeBolts(subtractIntervals(fitting, rules.obstacles), bp.perTread, rules.spacing),
              placeBolts(fitting, bp.perTread, rules.spacing),
            ]
          : []),
        placeBolts(subtractIntervals(free, rules.obstacles), bp.perTread, rules.spacing),
        all,
      ];
      let best: OrganTry | null = null;
      let positions: readonly Mm[] = [];
      let shortest = Infinity;
      let obstructed = false;
      let thread = false;
      for (const cand of candidates) {
        const t = organsAt(cand, d.z);
        shortest = Math.min(shortest, t.shortest);
        obstructed ||= t.obstructed;
        thread ||= t.thread;
        if (best === null || t.organs.length > best.organs.length) {
          best = t;
          positions = cand;
        }
        if (best.organs.length >= bp.perTread) break;
      }
      // Constat : diagnostics de tous les essais quand l'assise reste incomplète.
      const diag =
        best!.organs.length < bp.perTread ? { shortest, obstructed, thread } : { ...best! };
      return {
        organs: best!.organs,
        ...diag,
        rules,
        length: hi - lo + rules.front + rules.rear,
        positions,
        all,
      };
    };
    const missing: MissingSeat[] = [];
    const organs = drafts.map((d) => {
      const asBolts = planSeat(d, rulesFor.bolt);
      let plan = asBolts;
      let out = asBolts.organs;
      if (out.some((o) => o.kind === "lagScrew") || out.length < bp.perTread) {
        // Replacement aux règles des tire-fonds (A35 (l)) ; à défaut de mieux, les seuls boulons
        // du placement aux règles des boulons (tenus par ces règles).
        const asLags = planSeat(d, rulesFor.lagScrew);
        const boltsOnly = out.filter((o) => o.kind === "bolt");
        if (asLags.organs.length > boltsOnly.length) {
          plan = asLags;
          out = asLags.organs;
        } else {
          plan = out.length === boltsOnly.length ? asBolts : asLags;
          out = boltsOnly;
        }
      }
      if (out.length < bp.perTread) {
        missing.push({
          seat: d,
          placed: out.length,
          length: plan.length,
          reason: plan.obstructed
            ? "blocked"
            : Number.isFinite(plan.shortest)
              ? "lagShort"
              : !plan.thread && plan.all.length > plan.positions.length
                ? "blocked"
                : "missing",
          anchorage: Number.isFinite(plan.shortest) ? plan.shortest : 0,
          rules: plan.rules,
          thread: plan.thread,
        });
      }
      return out;
    });
    return { organs, missing, rulesFor };
  };

  // Couches empilées (A33 (e)) : forme finie de la poutre vue par l'empilement, décrite avant les
  // ancrages pour que les platines lisent les joints de colle réels (A37 (8) (15)) ; zone tendue
  // du décalage des aboutages sous l'axe de la section résistante (A37 (4) (13)).
  const footPlate = anchorKind === "embeddedPlate" && params.anchors.foot;
  const stackedShape: StackedBeamShape | null =
    lamination.method === "stacked"
      ? {
          beamId: id,
          beamMark: mark,
          b,
          sStart,
          sEnd,
          bottomAt,
          topAt,
          nodes: [...lineNodes, ...drafts.slice(0, -1).map((d) => d.sigma1)],
          baseZ: floorLevel,
          // Joints calés sur les assises (A35 (g)).
          seatLevels: drafts.map((d) => d.z),
          // Joint de colle calé sur le dessus voulu du logement de l'âme de pied (épaisseur de
          // platine + `anchors.plate.webDepth` + jeu d'atelier, QUESTIONS A38 (12), décision du
          // 2026-10-11) : l'âme arrêtée au joint en dessous (A37 (8)) garde sa profondeur. S'il
          // laisserait sous le niveau voisin du dessus une couche plus mince que
          // `section.minLayerThickness`, l'empilement le recale à « voisin − minimum » (QUESTIONS
          // A40 (c), décision du 2026-10-13 : âme moins profonde d'au plus le minimum), sinon
          // l'abandonne (A39 (d) : l'âme s'arrête au joint en dessous). Niveau voulu, pas recalé :
          // le recalage est fait par `stackedBounds`, seul calcul partagé avec l'oracle des
          // platines. Convention reprise par la remarque de recalage (profondeurs = niveau −
          // base − jeu, `StackedBeamShape.jointLevels`) : la changer ici impose de la changer là.
          ...(footPlate ? { jointLevels: [floorLevel + params.anchors.plate.webDepth + c] } : {}),
          tensionZoneTop: (s: Mm): Mm =>
            zLow(s) + (params.section.tensionZone * residual) / cosAt(s),
        }
      : null;
  // Place à laisser libre sous chaque assise au-dessus de l'âme de pied d'une platine
  // (QUESTIONS A35 (a), A38 (6)) : pré-passe sans obstacle d'ancrage, réservation du tire-fond
  // réellement posé (`seatReservations`).
  const prePass = footPlate ? placeSeats([], []).organs : null;
  const reserved = prePass
    ? seatReservations(drafts, prePass, { tm, tipCover: lp.tipCover })
    : null;
  const seatClearanceAt = reserved ? seatClearanceFrom(drafts, reserved, topAt) : undefined;
  const anchorInput = {
    params,
    trace,
    profile,
    checks,
    beam: {
      beamId: id,
      beamMark: mark,
      frontSigma: sF,
      floorCutLength: floorCut ? floorCut.x1 - floorCut.x0 : 0,
      firstSeatZ: drafts[0]!.z,
      trimmerSigma: trimmer,
      headBottom: Math.max(zLow(sH), floorLevel),
      headTop: drafts[drafts.length - 1]!.z,
      topAt,
      ...(seatClearanceAt ? { seatClearanceAt } : {}),
      endDistanceAlongGrain: (s: Mm, z: Mm): Mm => alongGrain(V.vec(s, z)),
      seatLevels: drafts.map((d) => d.z),
      ...(stackedShape
        ? { stackedJoints: stackedJointLevels({ params, profile, beam: stackedShape }) }
        : {}),
    },
  };
  const anchors: AnchorsOutput =
    anchorKind === "shoe"
      ? { ...buildWoodCentralShoes(anchorInput), beamKerfs: [], welded: false }
      : buildWoodCentralEmbeddedPlates(anchorInput);
  errors.push(...anchors.errors);
  notes.push(...anchors.notes);

  // 6. Couches empilées (filière `stacked`, A33 (e)) : pièces composantes de la poutre finie.
  let layers: StackedLayersResult | null = null;
  let layerRange: LayerRange | null = null;
  if (stackedShape) {
    layers = buildStackedLayers({
      params,
      trace,
      profile,
      checks,
      beam: {
        ...stackedShape,
        // Perçages horizontaux hors des joints de colle, broches au milieu d'une couche
        // (A36 (12), A37 (15)) ; logements des âmes découpés dans les couches avant collage
        // (A36 (5), A37 (8) (16)).
        holes: anchors.beamHoles,
        kerfs: anchors.beamKerfs,
      },
    });
    lamination = {
      ...lamination,
      lamellae: layers.layers.length,
      lamellaThickness: layers.layerThickness,
    };
    errors.push(...layers.errors);
    // La remarque de synthèse des couches double celle de la poutre (`note.stackedGlulam`,
    // ajoutée en tête des remarques) : seules les remarques particulières sont reprises.
    notes.push(
      ...layers.notes.filter(
        (n) =>
          n.key !== "structure.woodCentral.note.stackedLayers" &&
          n.key !== "structure.woodCentral.note.stackedLayersSeated",
      ),
    );
    const thicknesses = layers.layers.map((l) => l.z1 - l.z0);
    if (thicknesses.length > 0)
      layerRange = { min: Math.min(...thicknesses), max: Math.max(...thicknesses) };
  }

  // 7. Assises : reste sous entaille mesuré, bois au-dessus de l'entaille, boulons et
  // tire-fonds (passe finale, obstacles d'ancrage réels).
  const baseParts = ctx.baseParts ?? buildBasicParts(project, ctx.layout, stepping).parts;
  const markOfTread = new Map(
    baseParts.filter((p) => p.treadNumber !== undefined).map((p) => [p.treadNumber!, p.mark]),
  );
  const treadMark = (n: number): string => markOfTread.get(n) ?? String(n);
  const placed = placeSeats(anchors.beamHoles, anchors.beamKerfs);
  const { missing, rulesFor } = placed;
  const seats: WoodCentralSeat[] = drafts.map((d, i) => {
    const next = drafts[i + 1];
    const toothAbove =
      d.notch && next ? Math.max(0, next.z - d.z - tm - c) : Number.POSITIVE_INFINITY;
    return {
      tread: d.tread,
      treadPartId: `tread-${d.tread}`,
      sigma0: d.sigma0,
      sigma1: d.sigma1,
      z: d.z,
      rearDepth: d.notch ? d.rearMin - d.face : 0,
      residual: (d.z - zLow(d.sigma1)) * cosAt(d.sigma1),
      toothAbove,
      bolts: placed.organs[i]!,
    };
  });

  // 8. Pièce poutre.
  const toFlat = (p: Vec2): Vec2 => V.vec(p.x - sStart, p.y);
  const vertical = (x: Mm): [Vec2, Vec2] | null => {
    const e = verticalExtent(outline, x);
    return e ? [toFlat(V.vec(x, e[0])), toFlat(V.vec(x, e[1]))] : null;
  };
  const lines: FlatPattern["lines"][number][] = [];
  sig.forEach((s, k) => {
    if (s < sStart - 1e-6 || s > sEnd + 1e-6) return;
    const seg = vertical(s);
    if (seg) lines.push({ kind: "mark", a: seg[0], b: seg[1], label: textMessage(`N${k}`) });
  });
  for (const n of trace.naissances) {
    if (n.sigma < sStart || n.sigma > sEnd) continue;
    const seg = vertical(n.sigma);
    if (seg) {
      lines.push({
        kind: "mark",
        a: seg[0],
        b: seg[1],
        label: msg("structure.steelCurved.flatLine.springing"),
      });
    }
  }
  for (const s of seats) {
    lines.push({
      kind: "mark",
      a: toFlat(V.vec(s.sigma0, s.z)),
      b: toFlat(V.vec(s.sigma1, s.z)),
      label: msg("structure.woodCentral.flatLine.seat", { mark: treadMark(s.tread) }),
    });
    for (const o of s.bolts) {
      if (o.kind === "bolt") {
        lines.push({
          kind: "mark",
          a: toFlat(V.vec(o.sigma, s.z)),
          b: toFlat(V.vec(o.sigma, bottomAt(o.sigma))),
          label: msg("structure.woodCentral.flatLine.bolt", { diameter: dec(bp.holeDiameter, 0) }),
        });
      } else {
        // Tire-fond : de l'assise jusqu'à la pointe (ancrage = longueur − épaisseur de marche).
        lines.push({
          kind: "mark",
          a: toFlat(V.vec(o.sigma, s.z)),
          b: toFlat(V.vec(o.sigma, s.z - (o.length - tm))),
          label: msg("structure.woodCentral.flatLine.lagScrew", {
            diameter: dec(boltSpacing.d, 0),
            length: dec(o.length, 0),
            pilot: dec(lp.pilotDiameter, 0),
          }),
        });
      }
    }
  }
  if (lamination.curved) {
    for (const bend of lamination.bends) {
      const a = Math.max(bend.sigma0, sStart);
      const e = Math.min(bend.sigma1, sEnd);
      if (!(e - a > 1)) continue;
      const lift = residual / 2;
      lines.push({
        kind: "roll",
        a: toFlat(V.vec(a, Math.max(zLow(a), floorLevel) + lift)),
        b: toFlat(V.vec(e, Math.max(zLow(e), floorLevel) + lift)),
        label: msg("structure.woodCentral.flatLine.bending", { radius: dec(bend.radius, 0) }),
      });
    }
  }
  // Traits de scie des âmes de platine tracés dans le plan médian (A33 (f)) : contour exact
  // (âme de pied prolongée, dessus en escalier, A35 (a)), sinon rectangle.
  for (const k of anchors.beamKerfs) {
    const corners = (
      k.outline && k.outline.length >= 3
        ? k.outline
        : [
            V.vec(k.sigma0, k.z0),
            V.vec(k.sigma1, k.z0),
            V.vec(k.sigma1, k.z1),
            V.vec(k.sigma0, k.z1),
          ]
    ).map(toFlat);
    corners.forEach((p, j) => {
      lines.push({
        kind: "mark",
        a: p,
        b: corners[(j + 1) % corners.length]!,
        ...(j === 0
          ? {
              // Logement de l'âme selon la filière (A36 (5), à faire valider par un atelier) :
              // découpé dans chaque couche avant collage en couches empilées, fraisé sinon.
              label: msg(
                stackedGrain
                  ? "structure.woodCentral.flatLine.kerfLayerCut"
                  : "structure.woodCentral.flatLine.kerfMilled",
                { width: dec(k.width, 0), mark: k.mark },
              ),
            }
          : {}),
      });
    });
  }
  const mid = (sStart + sEnd) / 2;
  const midExt = verticalExtent(outline, mid);
  const yMid = midExt ? (midExt[0] + midExt[1]) / 2 : floorLevel + residual / 2;
  lines.push({
    kind: "text",
    a: toFlat(V.vec(mid - 20, yMid)),
    b: toFlat(V.vec(mid + 20, yMid)),
    label: textMessage(mark),
  });
  // Perçages d'ancrage au travers de la poutre (boulons de sabot ou broches, horizontaux,
  // perpendiculaires aux faces : vrais trous du développé), centres dans le contour seulement.
  const anchorHoles = anchors.beamHoles.filter(
    (h) => pointInPolygon(V.vec(h.sigma, h.z), outline, 1e-6) === "inside",
  );
  for (const h of anchorHoles) {
    const args = { diameter: dec(h.diameter, 0), mark: h.mark };
    lines.push({
      kind: "text",
      a: toFlat(V.vec(h.sigma - 20, h.z + h.diameter)),
      b: toFlat(V.vec(h.sigma + 20, h.z + h.diameter)),
      label:
        anchorKind === "shoe"
          ? msg("structure.woodCentral.flatLine.shoeBolt", args)
          : msg("structure.woodCentral.flatLine.beamDowel", args),
    });
  }
  const flat: FlatPattern = {
    outline: {
      outer: outline.map(toFlat),
      holes: anchorHoles.map((h) => holePolygon(toFlat(V.vec(h.sigma, h.z)), h.diameter)),
    },
    lines,
    thickness: b,
    reference: { kind: "face", description: msg("structure.woodCentral.reference.beam") },
  };
  const box = minAreaRect(outline);
  const devArea = area(outline);
  const height = Math.min(...seats.map((s) => s.residual).filter(Number.isFinite), Infinity);
  const sectionHeight = Number.isFinite(height) ? height : residual;
  const sectionLabel = sectionLabelOf(lamination, b, box.width, layerRange);
  const stacked = lamination.method === "stacked";
  // Poutre finie faite de ses couches composantes : seulement si les couches ont été produites
  // (échec des couches : erreur, la poutre garde son volume, sa masse et un débit d'enveloppe).
  const composed = stacked && (layers?.parts.length ?? 0) > 0;
  const solidStock =
    lamination.kind === "solid" ? stockOf(box.length, box.width, b, profile) : null;
  const layerStock =
    lamination.method === "straight"
      ? stockOf(box.length, box.width, lamination.lamellaThickness, profile)
      : null;
  // Débit : massif, une pièce ; couches droites, une lame par couche (`count`, plateau du profil
  // d'atelier contrôlé par FAB_DEBIT_DISPONIBLE) ; lamelles cintrées sur moule, placages ou
  // contreplaqué souple **achetés à l'épaisseur** (A34 (e), C §1.6 [7]) : épaisseur finie, sans
  // surcote d'épaisseur, longueur et largeur avec les surcotes du profil (à valider) ; couches
  // empilées : aucun débit sur la poutre finie, ses couches composantes le portent (A33 (e)) ;
  // couches non produites : débit d'enveloppe à l'épaisseur de la poutre.
  const stock: Part["stock"] | undefined = composed
    ? undefined
    : stacked
      ? stockOf(box.length, box.width, b, profile).stock
      : solidStock
        ? solidStock.stock
        : layerStock
          ? { ...layerStock.stock, count: lamination.lamellae }
          : lamination.lamellaThickness <= params.section.thinPlyMax + 1e-9
            ? {
                length: box.length + wood.lengthAllowance,
                width: box.width + wood.planingAllowance,
                thickness: lamination.lamellaThickness,
                count: lamination.lamellae,
                supply: "veneer",
              }
            : // Lamelle plus épaisse que les plis minces (> `section.thinPlyMax`) : lame ordinaire,
              // avec la surcote de corroyage du profil d'atelier.
              {
                ...stockOf(box.length, box.width, lamination.lamellaThickness, profile).stock,
                count: lamination.lamellae,
              };
  const solid = curvedTrace
    ? ruledSolid(trace, drafts, sF, sH, zLow, floorLevel, b, lineNodes)
    : null;
  const t0 = trace.tangent(0);
  const left0 = trace.left(0);
  const midT = trace.tangent(mid);
  const pitch = Math.atan(trace.slope);
  const fixings: PartFixing[] = [];
  for (const s of seats) {
    for (const [kind, joint] of [
      ["bolt", "treadBeamBolted"],
      ["lagScrew", "treadBeamLagScrewed"],
    ] as const) {
      const byLength = new Map<Mm, number>();
      for (const o of s.bolts) {
        if (o.kind === kind) byLength.set(o.length, (byLength.get(o.length) ?? 0) + 1);
      }
      for (const [length, points] of byLength) {
        fixings.push({
          joint,
          points,
          // Tire-fond : perçage de passage dans la marche (diamètre nominal lu dessus).
          holeDiameter: bp.holeDiameter,
          length,
          with: [s.treadPartId],
        });
      }
    }
  }
  const lamellaQuantities: Record<string, number> =
    lamination.kind === "glulam"
      ? {
          [QUANTITY_LAMELLAE]: lamination.lamellae,
          [QUANTITY_LAMELLA_THICKNESS_MM]: lamination.lamellaThickness,
        }
      : {};
  const beamPart: Part = {
    id,
    mark,
    category: "carriage",
    name: msg("structure.woodCentral.part.beam"),
    material: params.material,
    solid: solid ?? {
      kind: "extrusion",
      frame: {
        origin: v3(V.addScaled(trace.point(0), left0, b / 2), 0),
        xAxis: h3(t0),
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis: h3(V.scale(left0, -1)),
      },
      profile: { outer: outline, holes: [] },
      depth: b,
    },
    flat,
    section: sectionLabel,
    ...(stock ? { stock } : {}),
    // Couches empilées : ni volume, ni masse, ni volume de débit sur la poutre finie (ses
    // couches composantes les portent, aucun double compte) ; longueur et lamellation seules.
    quantities: composed
      ? { [QUANTITY_LENGTH_MM]: box.length, ...lamellaQuantities }
      : {
          ...woodQuantities(
            { volumeMm3: devArea * b, surfaceMm2: devArea, length: box.length },
            params.material,
            profile,
            stock,
          ),
          ...lamellaQuantities,
        },
    // Couches empilées : fil horizontal (celui des couches), pas le long de la pente.
    grain: composed
      ? { x: midT.x, y: midT.y, z: 0 }
      : {
          x: midT.x * Math.cos(pitch),
          y: midT.y * Math.cos(pitch),
          z: Math.sin(pitch),
        },
    ...(fixings.length > 0 ? { fixings } : {}),
  };

  // 9. Contrôles de fabrication de la poutre (couches empilées : débit et longueur de plateau
  // contrôlés par couche, `woodCentralLayers.ts`).
  const loc = { partId: id };
  if (!stacked) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.boardLength),
      [{ value: box.length, label: textMessage(mark), ...loc }],
      msg("structure.common.check.boardLength"),
      { min: null, max: wood.maxBoardLength },
    );
  }
  const st = solidStock ?? layerStock;
  if (st) {
    const ok = st.widthOk && st.thicknessOk;
    checks.add(pluginRuleDef(FAB_RULES.stockAvailable), [
      {
        status: ok ? "ok" : "violation",
        measured: st.need.w,
        location: { kind: "part", partId: id },
        message: ok
          ? msg("structure.common.check.stockAvailable", {
              mark,
              width: dec(st.stock.width, 0),
              thickness: dec(st.stock.thickness, 0),
            })
          : msg("structure.woodCut.check.stockMissing", {
              mark,
              width: dec(st.need.w, 0),
              thickness: dec(st.need.t, 0),
            }),
      },
    ]);
  }
  const cheekItems: CheckItem[] = seats
    .filter((s) => Number.isFinite(s.toothAbove))
    .map((s) => ({
      value: s.toothAbove,
      label: textMessage(treadMark(s.tread)),
      ...loc,
      treadNumber: s.tread,
    }));
  if (cheekItems.length > 0) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.cheek),
      cheekItems,
      msg("structure.woodCentral.check.toothAbove"),
      { min: wood.minCheek - 1e-6, max: null },
    );
  }
  const lagSeats = seats.filter((s) => s.bolts.some((o) => o.kind === "lagScrew"));
  const boltFindings: Finding[] =
    bp.perTread === 0
      ? [{ status: "ok", message: msg("structure.woodCentral.check.bolts.none") }]
      : missing.length === 0
        ? [
            {
              status: "ok",
              message:
                lagSeats.length > 0
                  ? // Tire-fonds : leurs règles citées (A35 (l)).
                    msg("structure.woodCentral.check.fixings.okLagThread", {
                      count: seats.length,
                      perTread: bp.perTread,
                      edge: dec(edge, 0),
                      spacing: dec(spacing, 0),
                      lagSeats: lagSeats.length,
                      lagSpacing: dec(lagSp.minSpacing, 0),
                      lagFront: dec(lagSp.frontEndDistance, 0),
                      lagRear: dec(lagSp.rearEndDistance, 0),
                      thread: dec(lagSp.threadEndDistance, 0),
                    })
                  : msg("structure.woodCentral.check.fixings.ok", {
                      count: seats.length,
                      perTread: bp.perTread,
                      edge: dec(edge, 0),
                      spacing: dec(spacing, 0),
                      lagSeats: lagSeats.length,
                    }),
            },
          ]
        : missing.map((m) => {
            const args = {
              mark: treadMark(m.seat.tread),
              placed: m.placed,
              wanted: bp.perTread,
            };
            return {
              status: "violation" as const,
              measured: m.placed,
              location: { kind: "part" as const, partId: id, treadNumber: m.seat.tread },
              message:
                m.reason === "lagShort"
                  ? lagSp.anchorageMode === "total"
                    ? // Ancrage total sous la marche (projet antérieur à A38, A38 (14)).
                      msg("structure.woodCentral.check.fixings.lagShort", {
                        ...args,
                        available: dec(m.anchorage, 0),
                        min: dec(lagSp.minTotalAnchorage, 0),
                      })
                    : lagSp.minAnchorageAuto
                      ? // Pénétration de la partie filetée sous 6·d : tire-fond retiré (A37 (1)).
                        msg("structure.woodCentral.check.fixings.lagThreadShort", {
                          ...args,
                          available: dec(m.anchorage, 0),
                          min: dec(lagSp.minAnchorage, 0),
                          diameter: dec(boltSpacing.d, 0),
                        })
                      : // Pénétration saisie de la partie filetée (A38 (14)).
                        msg("structure.woodCentral.check.fixings.lagThreadShortEntered", {
                          ...args,
                          available: dec(m.anchorage, 0),
                          min: dec(lagSp.minAnchorage, 0),
                          sixD: dec(lagSp.axial.penetration, 0),
                          diameter: dec(boltSpacing.d, 0),
                        })
                  : m.reason === "blocked"
                    ? msg("structure.woodCentral.check.fixings.blocked", {
                        ...args,
                        spacing: dec(m.rules.spacing, 0),
                      })
                    : m.rules.kind === "lagScrew" || m.thread
                      ? // Règles des tire-fonds (A35 (l)) et pince axiale a1,CG le long du fil
                        // (A36 (4)) ; mode `thread`, raccourcissement borné par la pénétration
                        // de la partie filetée, 6·d ou saisie (A37 (1) (5), A38 (14)).
                        lagSp.anchorageMode === "thread"
                        ? lagSp.minAnchorageAuto
                          ? msg("structure.woodCentral.check.fixings.missingLagThreadAuto", {
                              ...args,
                              length: dec(Math.max(0, m.length), 0),
                              front: dec(rulesFor.lagScrew.front, 0),
                              rear: dec(rulesFor.lagScrew.rear, 0),
                              spacing: dec(rulesFor.lagScrew.spacing, 0),
                              thread: dec(lagSp.threadEndDistance, 0),
                              penetration: dec(lagSp.minAnchorage, 0),
                              diameter: dec(boltSpacing.d, 0),
                            })
                          : msg("structure.woodCentral.check.fixings.missingLagThreadEntered", {
                              ...args,
                              length: dec(Math.max(0, m.length), 0),
                              front: dec(rulesFor.lagScrew.front, 0),
                              rear: dec(rulesFor.lagScrew.rear, 0),
                              spacing: dec(rulesFor.lagScrew.spacing, 0),
                              thread: dec(lagSp.threadEndDistance, 0),
                              penetration: dec(lagSp.minAnchorage, 0),
                            })
                        : msg("structure.woodCentral.check.fixings.missingLagThread", {
                            ...args,
                            length: dec(Math.max(0, m.length), 0),
                            front: dec(rulesFor.lagScrew.front, 0),
                            rear: dec(rulesFor.lagScrew.rear, 0),
                            spacing: dec(rulesFor.lagScrew.spacing, 0),
                            thread: dec(lagSp.threadEndDistance, 0),
                          })
                      : msg("structure.woodCentral.check.fixings.missing", {
                          ...args,
                          length: dec(Math.max(0, m.length), 0),
                          edge: dec(m.rules.front, 0),
                        }),
            };
          });
  checks.add(pluginRuleDef(WOOD_CENTRAL_BEAM_RULES.bolts), boltFindings);
  addSpacingCheck(checks, {
    id,
    b,
    seats,
    drafts,
    boltSpacing,
    treadMark,
    tm,
    floorLevel,
    stacked: stackedGrain,
    alongGrain,
  });

  // 10. Remarques (couches empilées non produites : l'erreur suffit, pas de synthèse à 0 couche).
  if (!stacked || composed)
    notes.unshift(
      lamination.kind === "solid"
        ? msg("structure.woodCentral.note.solid", { section: sectionLabel })
        : lamination.method === "mould"
          ? msg("structure.woodCentral.note.curvedGlulam", {
              count: lamination.lamellae,
              thickness: dec(lamination.lamellaThickness, 1),
              radius: dec(lamination.innerRadius, 0),
              ratio: dec(lamination.ratio, 0),
              kr: dec(lamination.kr, 3),
            })
          : lamination.method === "stacked"
            ? layerRange && layerRange.max - layerRange.min > 0.05
              ? msg("structure.woodCentral.note.stackedGlulamSeated", {
                  count: lamination.lamellae,
                  min: dec(layerRange.min, 1),
                  max: dec(layerRange.max, 1),
                  thickness: dec(lamination.lamellaThickness, 1),
                  allowance: dec(layers?.dressingAllowance ?? Number.NaN, 0),
                })
              : msg("structure.woodCentral.note.stackedGlulam", {
                  count: lamination.lamellae,
                  thickness: dec(lamination.lamellaThickness, 1),
                  allowance: dec(layers?.dressingAllowance ?? Number.NaN, 0),
                })
            : msg("structure.woodCentral.note.glulam", {
                count: lamination.lamellae,
                thickness: dec(lamination.lamellaThickness, 1),
              }),
    );
  // Cintrage sur moule d'une poutre plus large que le domaine de la source (choisi explicitement).
  if (lamination.method === "mould" && b > params.section.mouldMaxWidth)
    notes.push(msg("structure.woodCentral.note.mouldDomain", { width: dec(b, 0) }));
  if (lateral > 0 && seats.some((s) => s.bolts.length > 0)) {
    notes.push(msg("structure.woodCentral.note.boltOffset", { offset: dec(lateral, 1) }));
  }
  const shifted = seats.filter((s) => s.bolts.some((o) => Math.abs(o.lateral - lateral) > 1e-9));
  if (shifted.length > 0) {
    // Plus grand décalage par rapport à l'axe des organes (plan réel de l'âme, A38 (8)).
    const kerfShift = Math.max(
      ...shifted.flatMap((s) => s.bolts.map((o) => Math.abs(o.lateral - lateral))),
    );
    notes.push(
      msg("structure.woodCentral.note.kerfOffset", {
        marks: shifted.map((s) => treadMark(s.tread)).join(", "),
        offset: dec(kerfShift, 1),
      }),
    );
  }
  if (lagSeats.length > 0) {
    // Ancrage minimal (A37 (1), A38 (14)) et longueur filetée (A37 (5)) : mode `thread`,
    // pénétration de la partie filetée ≥ 6·d (`auto`) ou saisie ; mode `total` (projet antérieur
    // à A38), ancrage total sous la marche, pénétration filetée contrôlée à `minAnchorage` ;
    // filetage b = ⌊20 + L / 3⌋ en `auto`, saisi sinon.
    const total = lagSp.anchorageMode === "total";
    const lagArgs = {
      marks: lagSeats.map((s) => treadMark(s.tread)).join(", "),
      diameter: dec(boltSpacing.d, 0),
      pilot: dec(lp.pilotDiameter, 0),
      min: dec(total ? lagSp.minTotalAnchorage : lagSp.minAnchorage, 0),
      thread: dec(lagSp.threadEndDistance, 0),
      edge: dec(lagSp.axial.a2CG, 0),
      step: dec(bp.lengthStep, 0),
      penetration: dec(total ? lagSp.minAnchorage : lagSp.axial.penetration, 0),
      threaded:
        lp.threadLength === "auto"
          ? msg("structure.woodCentral.note.lagThreadLength.auto")
          : msg("structure.woodCentral.note.lagThreadLength.entered", {
              length: dec(lp.threadLength, 0),
            }),
    };
    notes.push(
      total
        ? msg(
            stackedGrain
              ? "structure.woodCentral.note.lagScrewsTotalStacked"
              : "structure.woodCentral.note.lagScrewsTotal",
            lagArgs,
          )
        : lagSp.minAnchorageAuto
          ? msg(
              stackedGrain
                ? "structure.woodCentral.note.lagScrewsThreadAutoStacked"
                : "structure.woodCentral.note.lagScrewsThreadAuto",
              lagArgs,
            )
          : msg(
              stackedGrain
                ? "structure.woodCentral.note.lagScrewsThreadEnteredMinStacked"
                : "structure.woodCentral.note.lagScrewsThreadEnteredMin",
              lagArgs,
            ),
    );
  }
  if (underRiser && drafts.some((d) => d.notch)) {
    notes.push(
      msg("structure.woodCentral.note.riserHousing", {
        depth: dec(rearDepth, 0),
        riser: dec(spec.riserThickness, 0),
        extension: dec(spec.riserThickness + rearDepth, 0),
      }),
    );
  }
  if (curvedTrace && drafts.some((d) => d.notch))
    notes.push(msg("structure.woodCentral.note.notchNot3d"));

  const assemblies: PartAssembly[] = [
    ...seats.map((s) => ({ a: { partId: id }, b: { treadNumber: s.tread } })),
    ...anchors.assemblies,
  ];
  const footMid = floorCut ? (floorCut.x0 + floorCut.x1) / 2 : sStart;
  // Contremarches pleines (A33 (i)) : marches entaillées prolongées sous la contremarche suivante,
  // contremarche posée sur la marche (pièces de base remplacées, même identifiant).
  const underRisers = underRiser
    ? treadsUnderRisers({
        ctx,
        baseParts,
        treads: drafts
          .filter((d) => d.notch && d.underRiser > 0)
          .map((d) => ({ number: d.tread, depth: riserOffset + d.underRiser })),
        profile,
        notes,
      })
    : [];
  return {
    parts: [beamPart, ...anchors.parts, ...(layers?.parts ?? []), ...underRisers],
    anchorKind,
    anchorsWelded: anchors.welded,
    curvedMethod,
    stacked: layers
      ? {
          layerThickness: layers.layerThickness,
          dressingAllowance: layers.dressingAllowance,
          count: layers.layers.length,
          ...(layers.maxGrainDeviation !== undefined
            ? { maxGrainDeviation: layers.maxGrainDeviation }
            : {}),
          layers: layers.layers.map((l) => ({ z0: l.z0, z1: l.z1 })),
          holes: anchors.beamHoles,
        }
      : null,
    ...(anchors.footWebLength !== undefined ? { footWebLength: anchors.footWebLength } : {}),
    ...(prePass && reserved
      ? {
          seatReserve: drafts.map((d, i) => ({
            tread: d.tread,
            reserved: reserved[i]!,
            organs: prePass[i]!.length,
            lags: prePass[i]!.filter((o) => o.kind === "lagScrew").length,
          })),
        }
      : {}),
    ...(anchors.beamKerfs.length > 0 ? { beamKerfs: anchors.beamKerfs } : {}),
    beamPartId: id,
    seats,
    lamination,
    fcba,
    residual,
    rearDepth,
    assemblies,
    section: rectSection(b, sectionHeight),
    sectionLabel,
    spanH: Math.max(0, sEnd - footMid),
    slope: trace.slope,
    notes,
    errors,
  };
}

/** Résultat unifié des ancrages (sabots ou platines à âme noyée). */
interface AnchorsOutput {
  readonly parts: readonly Part[];
  readonly beamHoles: readonly ShoeBeamHole[];
  readonly beamKerfs: readonly BeamKerf[];
  readonly assemblies: readonly PartAssembly[];
  readonly welded: boolean;
  /** Âme de pied prolongée d'une platine (A35 (a)) ; absente pour un sabot. */
  readonly footWebLength?: Mm;
  readonly notes: readonly Message[];
  readonly errors: readonly Message[];
}

/**
 * Contremarches pleines sous le limon central bois (QUESTIONS A33 (i), convention à valider) :
 * chaque marche entaillée t est prolongée sous la contremarche t + 1 jusqu'à la ligne de nez t
 * décalée de `depth` (débord + épaisseur de la contremarche + entaille arrière, plus le biais de
 * la ligne de nez sur la largeur de la poutre d'une marche balancée), contour coupé
 * sur C_i et C_e comme celui des pièces de base (`outlineBetween`, `helicalTreadOutline`) ; la
 * contremarche t + 1 est posée sur la marche (de son dessus au dessous de la marche suivante).
 * Pièces de base remplacées (même identifiant). Une marche dont le contour prolongé n'est pas
 * calculable est laissée telle quelle (remarque).
 */
function treadsUnderRisers(input: {
  readonly ctx: StructureContext;
  readonly baseParts: readonly Part[];
  /** Marches prolongées et décalage de leur bord arrière depuis la ligne de nez, mm. */
  readonly treads: readonly { readonly number: number; readonly depth: Mm }[];
  readonly profile: WorkshopProfile;
  readonly notes: Message[];
}): Part[] {
  const { ctx, baseParts, treads, profile, notes } = input;
  const { layout, stepping } = ctx;
  const nosings = stepping.nosings;
  const byId = new Map(baseParts.map((p) => [p.id, p]));
  const out: Part[] = [];
  for (const { number: t, depth } of treads) {
    const tread = byId.get(`tread-${t}`);
    const riser = byId.get(`riser-${t + 1}`);
    const front = nosings[t - 1];
    const back = nosings[t];
    if (!tread || !riser || !front || !back) continue;
    const te = readPlanExtrusion(tread.solid);
    const re = readPlanExtrusion(riser.solid);
    if (!te || !re) continue;
    let outline: readonly Vec2[] | null = null;
    try {
      const h = layout.helical;
      const raw = h
        ? helicalTreadOutline(h, (t - 1) * h.stepAngle, t * h.stepAngle, depth)
        : outlineBetween(layout, front, back, depth, nosings[t + 1]);
      outline = ensureCCW(raw);
    } catch {
      outline = null;
    }
    if (!outline || !(area(outline) > area(te.outline) + 1e-6)) {
      notes.push(msg("structure.woodCentral.note.treadUnderRiserImpossible", { mark: tread.mark }));
      continue;
    }
    const across = front.dir;
    const span = (axis: Vec2): Mm => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of outline!) {
        const d = V.dot(p, axis);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      return hi - lo;
    };
    const tStock = tread.stock
      ? { ...tread.stock, length: span(across), width: span(V.perpLeft(across)) }
      : undefined;
    out.push({
      ...tread,
      solid: verticalExtrusion(outline, te.zBottom, te.height),
      ...(tStock ? { stock: tStock } : {}),
      quantities: {
        ...tread.quantities,
        ...woodQuantities(
          {
            volumeMm3: area(outline) * te.height,
            // Surface vue (dessus) inchangée : le prolongement est sous la contremarche.
            surfaceMm2: (tread.quantities["surface"] ?? 0) * 1e6,
            length: tStock?.length ?? span(across),
          },
          tread.material,
          profile,
          tStock,
        ),
      },
    });
    // Contremarche posée sur la marche prolongée.
    const bottom = te.zBottom + te.height;
    const top = re.zBottom + re.height;
    const height = top - bottom;
    if (!(height > 1e-6) || !(re.height > 1e-6)) continue;
    const ratio = height / re.height;
    const rStock = riser.stock ? { ...riser.stock, width: height } : undefined;
    out.push({
      ...riser,
      solid: verticalExtrusion(re.outline, bottom, height),
      ...(rStock ? { stock: rStock } : {}),
      quantities: {
        ...riser.quantities,
        ...woodQuantities(
          {
            volumeMm3: area(re.outline) * height,
            surfaceMm2: (riser.quantities["surface"] ?? 0) * 1e6 * ratio,
            length: rStock?.length ?? 0,
          },
          riser.material,
          profile,
          rStock,
        ),
      },
    });
  }
  return out;
}

/** Longueur arrondie au pas inférieur (tire-fonds : ancrage jamais au-delà du bois disponible). */
function roundDownTo(length: Mm, step: Mm): Mm {
  return step > 0 ? Math.floor(length / step + 1e-9) * step : length;
}

/** Dessus fini en escalier : z de l'assise i sur [σ1_{i−1} ; σ1_i[, saut au fond de chaque assise. */
function seatTopAt(drafts: readonly SeatDraft[]): (s: Mm) => Mm {
  return (s) => {
    for (const d of drafts) if (s < d.sigma1 - 1e-9) return d.z;
    return drafts[drafts.length - 1]!.z;
  };
}

/**
 * `FAB_LIMON_CENTRAL_BOIS_PINCES` (QUESTIONS A34 (b), A35 (l), A36 (4)) : entraxes et pinces de
 * l'EC5 (bornes « tous angles », `woodCentralBoltSpacing`, C §1.11 [71], à valider) des organes
 * posés, chaque nature avec ses règles. Distance aux bouts de l'assise et à l'entaille ≥ a3,c
 * (pince latérale ; extrémités non chargées, gravité, A35 (e)). Entraxe effectif ≥ a1 ; ≥ max(a1 ;
 * 7·d) sur une assise qui porte au moins un tire-fond (EC5 § 8.7.2). Chaque tire-fond : centre de
 * gravité de la seule partie filetée comprise dans la poutre (`lagThreadInBeam`, QUESTIONS
 * A37 (5)) à a1,CG = 10·d au moins, le long du fil, de la coupe au sol et des
 * faces de cran (`grainEndDistance`, convention à valider, A36 (4)) ; en couches empilées, à
 * a2,CG = 4·d au moins au-dessus de la coupe au sol (rive). Faces de la poutre (b/2 −
 * |décalage latéral|) : boulons ≥ a4,c, tire-fonds ≥ max(a4,c ; a2,CG). Valeurs de référence :
 * celles de l'EC5 (`auto`), quelles que soient les valeurs saisies, sauf la pénétration de la
 * partie filetée : `lagScrews.minAnchorage` (6·d en `auto`, valeur saisie respectée, QUESTIONS
 * A38 (14)), contrôlée en mode d'ancrage total seulement (tenue par construction sinon). Aucun
 * constat sans organe posé.
 */
function addSpacingCheck(
  checks: CheckCollector,
  input: {
    readonly id: string;
    readonly b: Mm;
    readonly seats: readonly WoodCentralSeat[];
    readonly drafts: readonly SeatDraft[];
    readonly boltSpacing: WoodCentralBoltSpacing;
    readonly treadMark: (n: number) => string;
    /**
     * Épaisseur de marche (ancrage d'un tire-fond = longueur − épaisseur ; partie filetée et son
     * centre de gravité, `lagThreadInBeam`, A37 (5)), mm.
     */
    readonly tm: Mm;
    readonly floorLevel: Mm;
    /** Couches empilées : coupe au sol parallèle au fil (rive, a2,CG). */
    readonly stacked: boolean;
    /** Distance le long du fil d'un point du développement à la plus proche surface de bout. */
    readonly alongGrain: (p: Vec2) => Mm;
  },
): void {
  const { id, b, seats, drafts, boltSpacing, treadMark, tm, floorLevel, stacked, alongGrain } =
    input;
  const { ec5, d, lag } = boltSpacing;
  // Références de l'EC5 des tire-fonds (`auto`), indépendantes des valeurs saisies.
  const lagMinSpacing = Math.max(ec5.a1, lag.axial.a1);
  const lagThread = lag.axial.a1CG;
  const lagFloor = lag.axial.a2CG;
  const lagFace = lag.faceDistance;
  // Pénétration de la partie filetée (A38 (14)) : en mode `thread`, tenue par construction
  // (tire-fond retiré sinon) ; en mode `total` (ancrage total d'un projet antérieur à A38),
  // contrôlée à `lagScrews.minAnchorage` (6·d en `auto`, valeur saisie sinon).
  const lagPenetration = lag.minAnchorage;
  const totalMode = lag.anchorageMode === "total";
  const posed = seats.filter((s) => s.bolts.length > 0);
  if (posed.length === 0) return;
  const findings: Finding[] = [];
  const TOL = 1e-6;
  for (const s of posed) {
    const draft = drafts.find((x) => x.tread === s.tread);
    if (!draft) continue;
    const xs = s.bolts.map((o) => o.sigma).sort((p, q) => p - q);
    const end0 = draft.sigma0;
    const end1 = Math.min(draft.face, draft.sigma1, draft.rearMin);
    const mark = treadMark(s.tread);
    const location = { kind: "part" as const, partId: id, treadNumber: s.tread };
    const lagged = s.bolts.some((o) => o.kind === "lagScrew");
    let pitch = Infinity;
    for (let i = 1; i < xs.length; i++) pitch = Math.min(pitch, xs[i]! - xs[i - 1]!);
    const minPitch = lagged ? lagMinSpacing : ec5.a1;
    if (pitch < minPitch - TOL) {
      findings.push({
        status: "violation",
        measured: pitch,
        min: minPitch,
        max: null,
        location,
        message: lagged
          ? msg("structure.woodCentral.check.spacing.lagPitch", {
              mark,
              measured: dec(pitch, 0),
              min: dec(minPitch, 0),
              diameter: dec(d, 0),
            })
          : msg("structure.woodCentral.check.spacing.pitch", {
              mark,
              measured: dec(pitch, 0),
              min: dec(minPitch, 0),
              diameter: dec(d, 0),
            }),
      });
    }
    const front = xs[0]! - end0;
    const rear = end1 - xs[xs.length - 1]!;
    // Pince axiale a1,CG le long du fil (A36 (4)) : plus courte distance des tire-fonds de
    // l'assise ; en couches empilées, hauteur au-dessus de la coupe au sol (a2,CG).
    let thread = Infinity;
    let floor = Infinity;
    let penetration = Infinity;
    for (const o of s.bolts) {
      if (o.kind !== "lagScrew") continue;
      // Centre de gravité et pénétration de la seule partie filetée (A37 (5)).
      const inBeam = lagThreadInBeam(o.length, o.length - tm, lag.threadLengthOf);
      const cg = V.vec(o.sigma, s.z - inBeam.cgDepth);
      thread = Math.min(thread, alongGrain(cg));
      floor = Math.min(floor, cg.y - floorLevel);
      penetration = Math.min(penetration, inBeam.penetration);
    }
    // Pénétration de la partie filetée côté pointe (6·d en `auto`, EN 1995-1-1 § 8.7.2 (3),
    // C §1.11 [88]) : en mode `thread`, tenue par construction (tire-fond retiré sinon,
    // QUESTIONS A37 (1), A38 (14)) ; en mode `total`, l'ancrage total saisi reste respecté, avec
    // ce constat.
    if (totalMode && penetration < lagPenetration - TOL) {
      findings.push({
        status: "violation",
        measured: penetration,
        min: lagPenetration,
        max: null,
        location,
        message: msg("structure.woodCentral.check.spacing.lagPenetrationTotal", {
          mark,
          measured: dec(penetration, 0),
          min: dec(lagPenetration, 0),
          sixD: dec(lag.axial.penetration, 0),
          diameter: dec(d, 0),
        }),
      });
    }
    if (thread < lagThread - TOL) {
      findings.push({
        status: "violation",
        measured: thread,
        min: lagThread,
        max: null,
        location,
        message: msg("structure.woodCentral.check.spacing.lagThread", {
          mark,
          measured: dec(thread, 0),
          min: dec(lagThread, 0),
          diameter: dec(d, 0),
        }),
      });
    }
    if (stacked && floor < lagFloor - TOL) {
      findings.push({
        status: "violation",
        measured: floor,
        min: lagFloor,
        max: null,
        location,
        message: msg("structure.woodCentral.check.spacing.lagThreadFloor", {
          mark,
          measured: dec(floor, 0),
          min: dec(lagFloor, 0),
          diameter: dec(d, 0),
        }),
      });
    }
    // Deux bouts de l'assise : a3,c (pince latérale, boulons comme tire-fonds).
    const ends = Math.min(front, rear);
    if (ends < ec5.a3c - TOL) {
      findings.push({
        status: "violation",
        measured: ends,
        min: ec5.a3c,
        max: null,
        location,
        message: msg("structure.woodCentral.check.spacing.end", {
          mark,
          measured: dec(ends, 0),
          min: dec(ec5.a3c, 0),
          diameter: dec(d, 0),
        }),
      });
    }
  }
  // Plus grand décalage latéral des organes posés, par nature (demi-couche, ou de part et
  // d'autre d'un trait de scie d'âme de platine).
  const offsetOf = (kind: OrganKind): Mm | null => {
    const all = posed.flatMap((s) => s.bolts.filter((o) => o.kind === kind));
    return all.length > 0 ? Math.max(...all.map((o) => Math.abs(o.lateral))) : null;
  };
  const boltOffset = offsetOf("bolt");
  if (boltOffset !== null && b / 2 - boltOffset < ec5.a4c - TOL) {
    const face = b / 2 - boltOffset;
    findings.push({
      status: "violation",
      measured: face,
      min: ec5.a4c,
      max: null,
      location: { kind: "part", partId: id },
      message: msg("structure.woodCentral.check.spacing.face", {
        measured: dec(face, 0),
        min: dec(ec5.a4c, 0),
        offset: dec(boltOffset, 1),
        diameter: dec(d, 0),
      }),
    });
  }
  const lagOffset = offsetOf("lagScrew");
  if (lagOffset !== null && b / 2 - lagOffset < lagFace - TOL) {
    const face = b / 2 - lagOffset;
    findings.push({
      status: "violation",
      measured: face,
      min: lagFace,
      max: null,
      location: { kind: "part", partId: id },
      message: msg("structure.woodCentral.check.spacing.lagFace", {
        measured: dec(face, 0),
        min: dec(lagFace, 0),
        offset: dec(lagOffset, 1),
        diameter: dec(d, 0),
      }),
    });
  }
  const location = { kind: "part" as const, partId: id };
  checks.add(
    pluginRuleDef(WOOD_CENTRAL_BEAM_RULES.spacing),
    findings.length > 0
      ? findings
      : [
          lagOffset !== null
            ? {
                status: "ok",
                location,
                message: msg("structure.woodCentral.check.spacing.okLagThread", {
                  count: posed.length,
                  diameter: dec(d, 0),
                  a1: dec(ec5.a1, 0),
                  a3c: dec(ec5.a3c, 0),
                  a4c: dec(ec5.a4c, 0),
                  lagSpacing: dec(lagMinSpacing, 0),
                  lagThread: dec(lagThread, 0),
                  lagFace: dec(lagFace, 0),
                  lagPenetration: dec(lagPenetration, 0),
                }),
              }
            : {
                status: "ok",
                location,
                message: msg("structure.woodCentral.check.spacing.ok", {
                  count: posed.length,
                  diameter: dec(d, 0),
                  a1: dec(ec5.a1, 0),
                  a3c: dec(ec5.a3c, 0),
                  a4c: dec(ec5.a4c, 0),
                }),
              },
        ],
  );
}

/**
 * Solide d'une poutre cintrée : surface réglée sur la face gauche (rive basse, dessus en
 * escalier aux fonds d'entaille), épaissie de b vers la droite. Dents d'équerre sur la trace au
 * fond de chaque assise ; entailles arrière non représentées.
 */
function ruledSolid(
  trace: CentralTrace,
  drafts: readonly SeatDraft[],
  sF: Mm,
  sH: Mm,
  zLow: (s: Mm) => Mm,
  floorLevel: Mm,
  b: Mm,
  nodes: readonly Mm[],
): Part["solid"] {
  const STEP_EPS = 0.01;
  // Dessus : z de l'assise i sur [σ1_{i−1} ; σ1_i[, saut au fond de chaque assise.
  const topAt = seatTopAt(drafts);
  const jumps = drafts.slice(0, -1).map((d) => d.sigma1);
  const cum = cumulativeLengths(trace.curve);
  const xs = samples(
    sF,
    sH,
    [...nodes, ...jumps, ...jumps.map((j) => j - STEP_EPS), ...cum],
    () => true,
  );
  const a: Vec3[] = [];
  const top: Vec3[] = [];
  const normals: Vec2[] = [];
  for (const s of xs) {
    const lo = Math.max(zLow(s), floorLevel);
    const hi = s >= sH - 1e-9 ? drafts[drafts.length - 1]!.z : topAt(s);
    if (!(hi - lo > 0.1)) continue;
    const left = trace.left(s);
    const p = V.addScaled(trace.point(s), left, b / 2);
    a.push(v3(p, lo));
    top.push(v3(p, hi));
    normals.push(V.scale(left, -1));
  }
  return { kind: "ruled", a, b: top, thickness: b, normals };
}
