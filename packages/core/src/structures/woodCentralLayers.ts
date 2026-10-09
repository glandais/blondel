/**
 * Couches empilées du limon central bois (`wood-central`, QUESTIONS A33 (e), décision du
 * 2026-10-09 ; C §1.6 [7][8], §1.11) : sur une trace courbe, filière « couches horizontales
 * découpées selon le plan, empilées et collées puis délardées au profil, sans moule »
 * (`section.curvedMethod` = `stacked`, défaut au-delà de `section.mouldMaxWidth`).
 *
 * Contrat partagé (squelette posé par l'architecte de la vague « suites du limon central ») :
 * la poutre (`woodCentralBeam.ts`) décrit la forme finie de la poutre (`StackedBeamShape`) et
 * appelle `buildStackedLayers` ; ce module rend une pièce **composante** par couche
 * (`Part.componentOf` = identifiant de la poutre) : gabarit en plan avec la surcote de
 * délardement (`flat`), débit (`stock`), grandeurs de matière (volume et masse de la part finie,
 * volume de débit), solide = part de la poutre finie comprise dans la couche (non dessiné en
 * 3D : la poutre l'est). La poutre ne porte alors ni débit ni grandeurs de matière. Une couche
 * composée de plusieurs planches porte seulement son solide ; ses planches portent le reste
 * (A36 (9), plus bas).
 *
 * Convention Blondel **à valider** (aucune source sur l'épaisseur, l'orientation ni la surcote,
 * C §1.11) : couches d'épaisseur finie au plus t_max = `section.layerThickness` (`auto` : plus
 * forte épaisseur de débit du profil moins la surcote de corroyage), de la base de l'empilement
 * (`StackedBeamShape.baseZ`) vers le haut ; une couche [z0 ; z1] couvre les abscisses σ où la
 * poutre finie coupe cette tranche (dessous(σ) < z1 et dessus(σ) > z0), prolongées de la
 * surcote de délardement à chaque bout, sur la largeur b + 2 × surcote
 * (`section.dressingAllowance`, `auto` : `wood.planingAllowance`).
 *
 * Joints calés sur les assises (QUESTIONS A35 (g), décision du 2026-10-09 ; C §1.11 [8] : « crans
 * non coupés ») : les niveaux sont la base puis les altitudes des assises
 * (`StackedBeamShape.seatLevels`) ; chaque intervalle [lo ; hi] entre deux niveaux consécutifs
 * est partagé en n = ⌈(hi − lo) / t_max⌉ couches égales d'épaisseur (hi − lo) / n ≤ t_max ;
 * au-dessus du dernier niveau, tranches régulières de t_max jusqu'au plus haut dessus. Le dessus
 * de chaque assise est donc un joint et la face de chaque cran un bout de couche : une entaille
 * de cran ne coupe plus aucune couche. L'entaille arrière (logement de la marche, `notch`) reste
 * taillée dans la couche au-dessus de l'assise, après collage. Sans `seatLevels` : tranches
 * régulières de t_max depuis la base (comportement antérieur à A35).
 *
 * Couches composées de plusieurs planches (QUESTIONS A35 (h), décision du 2026-10-09 ; pente de
 * fil C §1.11 [82], tableau 5-12 de [81]) : le fil d'une planche suit sa corde en plan. Une
 * couche est découpée le long de la trace en n planches **aboutées** de même longueur sur σ
 * (n le plus petit) tant que l'écart en plan entre la corde d'une planche et la tangente à la
 * trace dépasse β_max = atan(`section.maxGrainSlope` / 100), ou que son gabarit dépasse la plus
 * large planche du profil (`max(wood.widths)` − surcote de corroyage, comme `stockOf`). Si même
 * la bande droite b + 2 × surcote est trop large, la couche est faite de k bandes égales
 * **collées sur chant** (en travers), chacune découpée en long de la même façon. Gabarit d'une
 * planche : surcote de délardement aux seuls bouts et faces extérieurs de la couche, joints
 * intérieurs coupés justes (convention **à valider**). Une couche d'une seule planche reste une
 * pièce (`wood-central-layer-<k>`, `LC1-<k>`, composante de la poutre). Au-delà du garde-fou
 * `MAX_BOARDS`, la couche reste d'une pièce, avec une remarque.
 *
 * Aboutages à entures décalés (QUESTIONS A36 (6), décision du 2026-10-09 ; C §1.11 [85] à [87]) :
 * les planches d'une couche composée sont aboutées **à entures multiples** (entures de
 * `section.fingerLength`, 15 mm) ; leurs joints sont placés couche par couche, du bas vers le
 * haut, à au moins `section.jointOffset` (152 mm, ANSI A190.1-2017 § 10.4 (a), à valider) des
 * joints de la couche du dessous, mesurés le long de la trace entre les parties les plus proches
 * (|σ − σ'| − `fingerLength`). On garde le découpage en planches égales s'il tient ; sinon on
 * déplace les coupes (planches inégales) en partant du plus petit nombre de planches, sans
 * dépasser β_max ni la largeur des plateaux ; à défaut, on garde le placement au plus grand
 * décalage minimal et chaque couche fautive reçoit un constat `FAB_LIMON_CENTRAL_BOIS_ABOUTAGES`
 * (avertissement). Bandes collées sur chant : aucun décalage latéral exigé (joints collés,
 * [85] § 9.3). Le gabarit d'une planche est prolongé de `fingerLength` / 2 à chaque bout abouté
 * (plan de joint tracé), le débit est lu sur ce gabarit ; le volume fini est inchangé.
 *
 * Couche composée, pièce intermédiaire (QUESTIONS A36 (9), décision du 2026-10-09) : une couche
 * de plusieurs planches est une pièce `wood-central-layer-<k>` / `LC1-<k>` composante de la
 * poutre (`componentOf` = poutre), avec le solide de la couche entière mais ni gabarit, ni débit,
 * ni grandeurs de matière ; ses planches (`wood-central-layer-<k>-<j>`, `LC1-<k>.<j>`) sont ses
 * composantes (`componentOf` = la couche) et portent gabarit, débit et grandeurs. Dans `parts`,
 * la couche précède ses planches. Pièces fabriquées : `fabricatedParts` (planches et couches
 * d'une planche, sans double compte).
 *
 * Perçages horizontaux et joints de colle (QUESTIONS A36 (12), décision du 2026-10-09) : aucun
 * joint de colle à moins du rayon du perçage + `wood.clearance` (jeu d'atelier, à valider) du
 * centre d'un perçage (broches des platines, boulons des sabots, `StackedBeamShape.holes`) ;
 * chaque broche de pied (âme `AP1`) est au milieu de sa couche. Les intervalles entre niveaux
 * concernés sont partagés autrement (`layerBounds`) : épaisseur de la couche centrée et joints
 * choisis pour rendre la plus mince couche de l'intervalle la plus épaisse possible, toujours
 * ≤ t_max, joints toujours calés sur les assises. Impossible (perçage à cheval sur une assise,
 * perçages trop proches) : joints écartés au mieux et remarque.
 *
 * Logements des âmes (QUESTIONS A36 (5), décision du 2026-10-09) : le contour en plan du logement
 * (`StackedBeamShape.kerfs`, trait de scie de largeur `width` de part et d'autre de la trace)
 * est tracé sur le gabarit de chaque couche ou planche qu'il traverse, sur l'étendue où il
 * coupe sa tranche : découpé avant collage s'il traverse toute l'épaisseur, fraisé (profondeur
 * indiquée) sinon ; contour extérieur du gabarit inchangé ; à valider par un atelier.
 *
 * Précisions de mise en œuvre :
 * - les tranches sont empilées jusqu'à couvrir le plus haut dessus ; une tranche que la poutre ne
 *   coupe pas (sous la sous-face au pied, par exemple) est omise et les couches restantes sont
 *   numérotées 1, 2… du bas vers le haut (`StackedLayer.z0` / `z1` gardent l'altitude réelle) ;
 * - la forme est lue sur une grille d'abscisses (nœuds de la forme, sauts du dessus à 0,01 mm
 *   près, pas fin `FINE_STEP`) : dessus constant et dessous affine entre deux abscisses de la
 *   grille ; le volume fini d'une couche, b × ∫ (min(dessus, z1) − max(dessous, z0))⁺ dσ, est
 *   intégré exactement sous cette hypothèse (la somme des couches redonne le volume de la
 *   poutre) ; les bouts finis σ0 et σ1 sont affinés par dichotomie sur le dessous réel ;
 * - une couche qui couperait la poutre en plusieurs parts disjointes est débitée d'une pièce
 *   (enveloppe [σ0 ; σ1]) et signalée par une remarque ;
 * - gabarit : bande entre les faces décalées de ± (b/2 + surcote) autour de la trace, de
 *   σ0 − surcote à σ1 + surcote, vue de dessus, posée dans l'axe de son rectangle minimal ;
 *   traçage de l'axe de la trace, des faces finies, des bouts finis et des naissances ;
 * - l'écart de fil d'une planche est lu aux abscisses du gabarit (bouts, naissances, pas de 2°
 *   sur un arc) : exact sur une droite et aux bouts d'un arc, où il est le plus fort ;
 * - le volume fini d'une planche est l'intégrale ci-dessus restreinte à ses abscisses (et à la
 *   largeur de sa bande) : la somme des planches redonne celui de la couche.
 *
 * Question résolue (C §1.11 [8] : « crans non coupés ») : joints calés sur les assises, A35 (g).
 * Sans source (QUESTIONS A37) : épaisseur minimale d'une couche et longueur minimale d'une
 * planche (gardes techniques `MIN_LAYER` et `MIN_BOARD` seulement).
 *
 * `buildStackedLayers` ne lève jamais : erreurs dans `errors`.
 */
import { dec, errorMessage, msg, textMessage, type Message } from "@blondel/i18n";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, Part } from "../model/derived.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import { sourceSpec } from "../rules/sources.js";
import type { Finding } from "../rules/types.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import {
  FAB_RULES,
  pluginRuleDef,
  type CheckCollector,
  type CheckItem,
  type PluginRuleSpec,
} from "./checks.js";
import { area, minAreaRect } from "./geom.js";
import { woodQuantities } from "./quantities.js";
import type { WoodCentralParams } from "./woodCentralParams.js";
import { WOOD_CENTRAL_PLATE_FOOT_WEB_MARK, type BeamKerf } from "./woodCentralPlates.js";
import type { ShoeBeamHole } from "./woodCentralShoes.js";
import { stockOf } from "./woodHoused.js";

/**
 * Contrôles des couches empilées (descriptions : `rules.<id>.description`).
 */
export const WOOD_CENTRAL_LAYER_RULES = {
  /**
   * Aboutages à entures des planches d'une couche composée décalés de ceux de la couche du
   * dessous (QUESTIONS A36 (6)) : décalage `section.jointOffset` entre les parties les plus
   * proches des joints (C §1.11 [85] § 10.4 (a), norme américaine, à valider).
   */
  fingerJoints: {
    id: "FAB_LIMON_CENTRAL_BOIS_ABOUTAGES",
    ...sourceSpec(msg("compliance.source.woodCentralFingerJoints")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
  /**
   * Joints de colle des couches empilées écartés des perçages horizontaux (QUESTIONS A36 (12)) :
   * distance du joint le plus proche au centre du perçage ≥ rayon + `profile.wood.clearance`
   * (jeu d'atelier, à valider, QUESTIONS A37 (7)) ; un perçage que l'empilement ne peut pas
   * écarter (broche de tête sur une assise, A37 (15)) est un constat, plus une simple remarque.
   */
  holeJoints: {
    id: "FAB_LIMON_CENTRAL_BOIS_JOINT_PERCAGE",
    ...sourceSpec(msg("compliance.source.woodCentralHoleJoints")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

/** Préfixe des identifiants des couches : `wood-central-layer-<k>` (k ≥ 1, du bas vers le haut). */
export const WOOD_CENTRAL_LAYER_ID_PREFIX = "wood-central-layer-";

/** Identifiant de la couche k (k ≥ 1). */
export function woodCentralLayerId(index: number): string {
  return `${WOOD_CENTRAL_LAYER_ID_PREFIX}${index}`;
}

/** Repère de la couche k de la poutre de repère `beamMark` (« LC1-3 »), non traduit. */
export function woodCentralLayerMark(beamMark: string, index: number): string {
  return `${beamMark}-${index}`;
}

/**
 * Identifiant de la planche j (j ≥ 1, dans le sens de la montée) de la couche k composée de
 * plusieurs planches (QUESTIONS A35 (h)) : `wood-central-layer-<k>-<j>`. Une couche d'une seule
 * planche garde l'identifiant de la couche (`woodCentralLayerId`).
 */
export function woodCentralBoardId(index: number, board: number): string {
  return `${WOOD_CENTRAL_LAYER_ID_PREFIX}${index}-${board}`;
}

/** Repère de la planche j de la couche k (« LC1-3.2 »), non traduit. */
export function woodCentralBoardMark(beamMark: string, index: number, board: number): string {
  return `${beamMark}-${index}.${board}`;
}

/** Forme finie de la poutre, décrite par la poutre (développement à l'axe, u = σ). */
export interface StackedBeamShape {
  readonly beamId: string;
  readonly beamMark: string;
  /** Largeur b de la poutre (perpendiculaire aux faces), mm. */
  readonly b: Mm;
  /** Étendue de la poutre sur la trace, mm. */
  readonly sStart: Mm;
  readonly sEnd: Mm;
  /**
   * Dessous réel de la poutre à l'abscisse σ (sous-face, jamais sous la coupe au sol ni sous
   * la platine ou la semelle de pied), mm.
   */
  readonly bottomAt: (s: Mm) => Mm;
  /**
   * Dessus fini de la poutre à l'abscisse σ (altitude de l'assise, en escalier, sans les
   * entailles arrière), mm.
   */
  readonly topAt: (s: Mm) => Mm;
  /** Abscisses à respecter dans l'échantillonnage (nez, naissances, bouts d'assise, sauts). */
  readonly nodes: readonly Mm[];
  /** Base de l'empilement : dessus de la platine ou de la semelle de pied, sinon le sol, mm. */
  readonly baseZ: Mm;
  /**
   * Altitudes des assises (dessous des marches), croissantes, mm (QUESTIONS A35 (g)) : les
   * joints des couches y sont calés, chaque intervalle entre deux niveaux (base, assises) étant
   * partagé en ⌈h / t_max⌉ couches égales. Absent : tranches régulières de t_max depuis la base
   * (comportement antérieur).
   */
  readonly seatLevels?: readonly Mm[];
  /**
   * Perçages horizontaux au travers de la poutre (broches des platines à âme noyée, boulons
   * des sabots), développement à l'axe (QUESTIONS A36 (12), décision du 2026-10-09) : aucun
   * joint de colle ne coupe ni ne touche un perçage ; chaque broche de pied (repère de l'âme de
   * pied, `WOOD_CENTRAL_PLATE_FOOT_WEB_MARK`) est au milieu de sa couche. Absent : aucun.
   */
  readonly holes?: readonly ShoeBeamHole[];
  /**
   * Logements des âmes de platine dans la poutre (traits de scie, contour exact en escalier
   * pour l'âme de pied, QUESTIONS A36 (5), décision du 2026-10-09) : en couches empilées, le
   * logement est découpé dans chaque couche avant collage ; son contour est reporté sur le
   * gabarit de chaque couche (ou planche) qu'il traverse. Absent : aucun.
   */
  readonly kerfs?: readonly BeamKerf[];
}

export interface StackedLayersInput {
  readonly params: WoodCentralParams;
  readonly trace: CentralTrace;
  readonly profile: WorkshopProfile;
  /**
   * Collecteur des contrôles du plugin : les couches y ajoutent leurs contrôles de fabrication
   * (longueur de plateau `FAB_PLATEAU_LONGUEUR_MAX`, débit disponible `FAB_DEBIT_DISPONIBLE`,
   * par pièce : couche d'une planche ou planche d'une couche composée ; décalage des aboutages
   * `FAB_LIMON_CENTRAL_BOIS_ABOUTAGES`, par couche composée).
   */
  readonly checks: CheckCollector;
  readonly beam: StackedBeamShape;
}

/** Couche horizontale (finie, avant surcote). */
export interface StackedLayer {
  /** Rang k ≥ 1, du bas vers le haut. */
  readonly index: number;
  readonly partId: string;
  readonly mark: string;
  /** Tranche d'altitude [z0 ; z1], mm. */
  readonly z0: Mm;
  readonly z1: Mm;
  /** Abscisses de la part finie de la poutre dans la tranche (sans surcote), mm. */
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /**
   * Planches de la couche composée (A35 (h)), dans le sens de la montée ; absent ou une seule :
   * la couche est une planche (pièce `partId`, avec gabarit et débit). Plusieurs : la couche est
   * une pièce sans gabarit ni débit (`partId`, composante de la poutre), chaque planche une pièce
   * composante de la couche (A36 (9)).
   */
  readonly boards?: readonly StackedBoard[];
}

/** Planche d'une couche composée (QUESTIONS A35 (h)). */
export interface StackedBoard {
  /** Rang j ≥ 1 dans la couche, dans le sens de la montée. */
  readonly index: number;
  readonly partId: string;
  readonly mark: string;
  /** Abscisses finies de la planche sur la trace (joints aboutés aux bornes intérieures), mm. */
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** Bande en travers (planches collées sur chant) : décalages gauche [d0 ; d1] depuis l'axe, mm. */
  readonly across?: { readonly d0: Mm; readonly d1: Mm };
  /** Plus grand écart en plan entre le fil de la planche (sa corde) et la trace, rad. */
  readonly grainDeviation: number;
  /**
   * Décalage le long de la trace, entre parties les plus proches, de ses aboutages à entures et
   * de ceux de la couche du dessous (|σ − σ'| − `fingerLength`, le plus petit de ses bouts
   * aboutés), mm (A36 (6)) ; absent : aucun aboutage de la couche du dessous en regard.
   */
  readonly jointOffset?: Mm;
}

export interface StackedLayersResult {
  /**
   * Pièces, du bas vers le haut : couche d'une planche (`componentOf` = `beam.beamId`), ou
   * couche composée (`componentOf` = `beam.beamId`, sans gabarit ni débit) suivie de ses
   * planches (`componentOf` = la couche, A36 (9)).
   */
  readonly parts: readonly Part[];
  readonly layers: readonly StackedLayer[];
  /**
   * Épaisseur finie maximale t_max d'une couche (`section.layerThickness` résolu), mm ; avec des
   * assises, chaque couche a sa propre épaisseur z1 − z0 ≤ t_max (A35 (g)).
   */
  readonly layerThickness: Mm;
  /** Surcote de délardement retenue (`section.dressingAllowance` résolu), mm. */
  readonly dressingAllowance: Mm;
  /**
   * Plus grand écart en plan entre le fil d'une planche et la trace, toutes couches, rad
   * (A35 (h), (j) : β du prédimensionnement). Absent : non calculé (0 supposé).
   */
  readonly maxGrainDeviation?: number;
  readonly notes: readonly Message[];
  readonly errors: readonly Message[];
}

/**
 * Épaisseur finie maximale d'une couche (A35 (g)) : saisie, ou `auto` → plus forte épaisseur de débit du profil
 * d'atelier moins la surcote de corroyage (comme les couches droites), b à défaut.
 */
export function resolveLayerThickness(params: WoodCentralParams, profile: WorkshopProfile): Mm {
  const entered = params.section.layerThickness;
  if (entered !== "auto") return entered;
  const tMax = Math.max(...profile.wood.thicknesses) - profile.wood.planingAllowance;
  return tMax > 0 ? tMax : params.section.width;
}

/** Surcote de délardement : saisie, ou `auto` → surcote de corroyage du profil d'atelier. */
export function resolveDressingAllowance(params: WoodCentralParams, profile: WorkshopProfile): Mm {
  const entered = params.section.dressingAllowance;
  return entered !== "auto" ? entered : profile.wood.planingAllowance;
}

// ------------------------------------------------------------------ constantes techniques

/** Pas d'échantillonnage de la forme le long de la trace (technique, pas une valeur métier), mm. */
const FINE_STEP: Mm = 10;
/** Décalage d'échantillonnage avant un saut du dessus (comme le solide de la poutre), mm. */
const STEP_EPS: Mm = 0.01;
/** Hauteur minimale d'une section du solide réglé (solide refusé sous une section plate), mm. */
const MIN_SECTION: Mm = 0.1;
/** Aire développée en dessous de laquelle une tranche est vide, mm². */
const EMPTY_AREA = 1e-9;
/** Garde-fou de calcul : nombre maximal de couches (technique, protège d'une saisie aberrante). */
const MAX_LAYERS = 1000;
/**
 * Garde-fou de calcul : nombre maximal de planches d'une couche, en long comme en travers
 * (technique, borne la recherche ; au-delà, la couche reste d'une pièce, avec une remarque).
 */
export const MAX_BOARDS = 64;
/** Tolérance d'altitude entre deux niveaux d'assise (dédoublonnage), mm. */
const LEVEL_EPS: Mm = 1e-6;
/** Tolérance de comparaison des largeurs (mm) et des angles (rad). */
const CMP_EPS = 1e-9;
/** Pas angulaire du gabarit sur un arc (rad) et bornes du pas le long de l'axe, mm. */
const ARC_ANGLE_STEP = Math.PI / 90;
const ARC_STEP_MIN: Mm = 2;
const ARC_STEP_MAX: Mm = 50;
/** Nombre de sommets du contour allégé qui sert à orienter le rectangle minimal du gabarit. */
const RECT_SAMPLES = 120;
/** Demi-longueur de la ligne support d'un texte de repère, mm. */
const TEXT_HALF: Mm = 20;
/**
 * Garde technique : épaisseur minimale d'une couche quand un intervalle est partagé autour des
 * perçages (A36 (12)), mm ; aucune source sur l'épaisseur minimale (QUESTIONS A37).
 */
const MIN_LAYER: Mm = 1;
/**
 * Garde technique : longueur minimale d'une planche quand les coupes sont déplacées (A36 (6)),
 * mm ; aucune source sur la longueur minimale d'une planche (QUESTIONS A37).
 */
const MIN_BOARD: Mm = 1;
/** Nombre d'épaisseurs essayées pour la couche centrée sur une broche (recherche technique). */
const CENTER_SAMPLES = 48;
/** Itérations des recherches par dichotomie (épaisseur minimale, décalage, portée d'une planche). */
const SEARCH_ITERATIONS = 32;
const REACH_ITERATIONS = 14;
/** Tolérance de position (joints, coupes), mm. */
const POS_EPS: Mm = 1e-6;
/**
 * Garde-fou de calcul de la recherche du décalage des aboutages (A36 (6)), pour toute la
 * poutre : nombre maximal d'essais de planche, chacun compté autant de fois que la couche a de
 * bandes collées sur chant (technique ; les exemples et les préréglages en demandent moins de
 * 14 000). Au-delà, la recherche d'une couche s'arrête sur le placement trouvé, ou garde le
 * partage égal (constat d'aboutage s'il y a lieu) : une saisie aberrante (poutre de plusieurs
 * mètres de large) ne bloque pas le calcul.
 */
const STAGGER_BUDGET = 200_000;

/**
 * Couches empilées de la poutre. Ne lève jamais.
 */
export function buildStackedLayers(input: StackedLayersInput): StackedLayersResult {
  const t = resolveLayerThickness(input.params, input.profile);
  const s = resolveDressingAllowance(input.params, input.profile);
  try {
    return build(input, t, s);
  } catch (err) {
    return {
      parts: [],
      layers: [],
      layerThickness: t,
      dressingAllowance: s,
      notes: [],
      errors: [msg("structure.woodCentral.error.layers", { detail: errorMessage(err) })],
    };
  }
}

/**
 * ∫ sur [0 ; L] de (hi − max(B, lo))⁺ avec B affine de B0 à B1 : intégrale exacte de la hauteur
 * de la poutre comprise dans la tranche [lo ; hi] (hi déjà borné par le dessus).
 */
export function clippedArea(L: Mm, B0: Mm, B1: Mm, lo: Mm, hi: Mm): number {
  if (!(hi > lo) || !(L > 0)) return 0;
  const h = (x: Mm): Mm => (x <= lo ? hi - lo : x < hi ? hi - x : 0);
  if (Math.abs(B1 - B0) < 1e-9) return L * h((B0 + B1) / 2);
  // Primitive de h en B, nulle en lo.
  const H = (x: Mm): number => {
    if (x <= lo) return (hi - lo) * (x - lo);
    if (x <= hi) return (hi - lo) * (x - lo) - ((x - lo) * (x - lo)) / 2;
    return ((hi - lo) * (hi - lo)) / 2;
  };
  return (L * (H(B1) - H(B0))) / (B1 - B0);
}

/** Tranche d'altitude d'une couche, mm. */
export interface LayerBound {
  readonly z0: Mm;
  readonly z1: Mm;
}

/**
 * Perçage horizontal vu par l'empilement (QUESTIONS A36 (12)) : aucun joint de colle à moins de
 * `r` de son centre ; une broche de pied (`centered`) est au milieu de sa couche.
 */
export interface HoleLevel {
  /** Altitude du centre du perçage, mm. */
  readonly z: Mm;
  /** Distance minimale d'un joint de colle au centre : rayon du perçage + jeu d'atelier, mm. */
  readonly r: Mm;
  /** Broche de pied : au milieu de sa couche. */
  readonly centered: boolean;
  /** Repère (remarques). */
  readonly mark?: string;
}

/** Perçage que l'empilement ne tient pas (A36 (12)). */
export interface HoleIssue {
  /** `joint` : joint de colle trop proche ; `offCenter` : broche de pied hors du milieu. */
  readonly kind: "joint" | "offCenter";
  readonly mark: string;
  readonly z: Mm;
  /** Distance du joint le plus proche au centre du perçage, mm. */
  readonly distance: Mm;
  /** Distance exigée (`HoleLevel.r`), mm. */
  readonly min: Mm;
}

/**
 * Tranches de l'empilement (QUESTIONS A35 (g)) : niveaux = base, puis les assises comprises dans
 * ]base ; zTop] (triées, dédoublonnées à `LEVEL_EPS` près) ; chaque intervalle [lo ; hi] est
 * partagé en ⌈(hi − lo) / t_max⌉ couches égales ; au-dessus du dernier niveau, tranches
 * régulières de t_max jusqu'à zTop. Sans assise : tranches régulières depuis la base. Au-delà de
 * `max` tranches, `bounds` est vide et `count` dit combien il en faudrait.
 *
 * Perçages (`holes`, A36 (12)) : un intervalle dont le partage égal met un joint à moins de `r`
 * d'un perçage, ou ne met pas une broche `centered` au milieu d'une couche, est partagé
 * autrement (`shareRun`) : couches ≤ t_max, joints hors des zones des perçages, broche au milieu
 * de sa couche, la plus mince couche de l'intervalle la plus épaisse possible ; à défaut, sans
 * centrage, puis en réduisant les zones, joints écartés au mieux. `issues` (présent avec des
 * perçages) : perçages non tenus, un par perçage et par nature.
 */
export function layerBounds(
  baseZ: Mm,
  zTop: Mm,
  tMax: Mm,
  seatLevels: readonly Mm[] = [],
  max: number = MAX_LAYERS,
  holes: readonly HoleLevel[] = [],
): {
  readonly count: number;
  readonly bounds: readonly LayerBound[];
  readonly issues?: readonly HoleIssue[];
} {
  const levels: Mm[] = [baseZ];
  const sorted = seatLevels.filter(Number.isFinite).sort((p, q) => p - q);
  for (const lv of sorted) {
    if (lv > levels[levels.length - 1]! + LEVEL_EPS && lv <= zTop + LEVEL_EPS) levels.push(lv);
  }
  const runs: { lo: Mm; hi: Mm; n: number }[] = [];
  let count = 0;
  for (let i = 0; i + 1 < levels.length; i++) {
    const lo = levels[i]!;
    const hi = levels[i + 1]!;
    const n = Math.max(1, Math.ceil((hi - lo) / tMax - 1e-9));
    runs.push({ lo, hi, n });
    count += n;
  }
  const last = levels[levels.length - 1]!;
  if (zTop > last + LEVEL_EPS) {
    const n = Math.ceil((zTop - last) / tMax - 1e-9);
    runs.push({ lo: last, hi: last + n * tMax, n });
    count += n;
  }
  const withIssues = holes.length > 0;
  if (!(count <= max)) return { count, bounds: [], ...(withIssues ? { issues: [] } : {}) };
  const issues: HoleIssue[] = [];
  const valid = holes.filter((h) => Number.isFinite(h.z) && Number.isFinite(h.r) && h.r > 0);
  const joints = runs.map((run) => runJoints(run, tMax, valid, issues));
  count = joints.reduce((acc, js) => acc + js.length - 1, 0);
  if (!(count <= max)) return { count, bounds: [], ...(withIssues ? { issues: [] } : {}) };
  const bounds = joints.flatMap((js) =>
    js.slice(1).map((z1, k) => ({ z0: js[k]!, z1 }) satisfies LayerBound),
  );
  return { count, bounds, ...(withIssues ? { issues: dedupeIssues(issues) } : {}) };
}

/** Niveaux égaux d'un intervalle : lo, lo + (hi − lo)·k / n…, hi (même arithmétique qu'avant A36). */
function equalLevels(lo: Mm, hi: Mm, n: number): Mm[] {
  return Array.from({ length: n + 1 }, (_, k) =>
    k === 0 ? lo : k === n ? hi : lo + ((hi - lo) * k) / n,
  );
}

/** Une broche est au milieu d'une des couches délimitées par `levels`. */
function centeredIn(levels: readonly Mm[], z: Mm): boolean {
  for (let k = 0; k + 1 < levels.length; k++) {
    if (Math.abs((levels[k]! + levels[k + 1]!) / 2 - z) < 1e-6) return true;
  }
  return false;
}

/** Zone interdite aux joints autour d'un perçage : ]z − r ; z + r[. */
interface Zone {
  readonly z: Mm;
  readonly r: Mm;
}

const inZone = (x: Mm, zones: readonly Zone[]): boolean =>
  zones.some((q) => Math.abs(x - q.z) < q.r - POS_EPS);

/**
 * Niveaux (bornes comprises) d'un intervalle de l'empilement : partage égal, ou partage autour
 * des perçages qui le concernent (A36 (12)) ; ajoute à `issues` les perçages non tenus.
 */
function runJoints(
  run: { readonly lo: Mm; readonly hi: Mm; readonly n: number },
  tMax: Mm,
  holes: readonly HoleLevel[],
  issues: HoleIssue[],
): Mm[] {
  const { lo, hi, n } = run;
  const equal = equalLevels(lo, hi, n);
  const relevant = holes.filter((h) => h.z + h.r > lo + POS_EPS && h.z - h.r < hi - POS_EPS);
  if (relevant.length === 0) return equal;
  const centers = relevant
    .filter((h) => h.centered && h.z > lo + POS_EPS && h.z < hi - POS_EPS)
    .sort((p, q) => p.z - q.z)
    // Broches au même niveau : une seule couche centrée.
    .filter((h, i, all) => i === 0 || h.z - all[i - 1]!.z > 1e-6);
  const ok = (levels: readonly Mm[]): boolean =>
    levels.slice(1, -1).every((j) => !inZone(j, relevant)) &&
    centers.every((h) => centeredIn(levels, h.z));
  let levels = equal;
  if (!ok(equal)) {
    const inner =
      shareRun(lo, hi, tMax, relevant, centers) ??
      shareRun(lo, hi, tMax, relevant, []) ??
      [0.75, 0.5, 0.25].reduce<Mm[] | null>(
        (found, k) =>
          found ??
          shareRun(
            lo,
            hi,
            tMax,
            relevant.map((h) => ({ z: h.z, r: h.r * k })),
            [],
          ),
        null,
      );
    if (inner) levels = [lo, ...inner, hi];
  }
  for (const h of relevant) {
    const mark = h.mark ?? "";
    const distance = Math.min(...levels.map((j) => Math.abs(j - h.z)));
    if (distance < h.r - POS_EPS) issues.push({ kind: "joint", mark, z: h.z, distance, min: h.r });
    if (centers.includes(h) && !centeredIn(levels, h.z)) {
      issues.push({ kind: "offCenter", mark, z: h.z, distance, min: h.r });
    }
  }
  return levels;
}

/** Un constat par perçage (repère, altitude) et par nature : la plus petite distance. */
function dedupeIssues(issues: readonly HoleIssue[]): HoleIssue[] {
  const out = new Map<string, HoleIssue>();
  for (const i of issues) {
    const key = `${i.kind}|${i.mark}|${i.z.toFixed(6)}`;
    const prev = out.get(key);
    if (!prev || i.distance < prev.distance) out.set(key, i);
  }
  return [...out.values()];
}

/**
 * Partage de [lo ; hi] autour des perçages (A36 (12)) : niveaux intérieurs, couches d'épaisseur
 * comprise entre g et t_max, joints hors des zones, broches `centers` au milieu de leur couche ;
 * g (la plus mince couche) le plus grand possible, par dichotomie. `null` si impossible même
 * avec g = `MIN_LAYER`.
 */
function shareRun(
  lo: Mm,
  hi: Mm,
  tMax: Mm,
  zones: readonly Zone[],
  centers: readonly HoleLevel[],
): Mm[] | null {
  const len = hi - lo;
  const gMin = Math.min(MIN_LAYER, len);
  let best = placeRun(lo, hi, tMax, gMin, zones, centers);
  if (!best) return null;
  let a = gMin;
  let b = Math.min(tMax, len);
  for (let i = 0; i < SEARCH_ITERATIONS && b - a > 1e-4; i++) {
    const m = (a + b) / 2;
    const found = placeRun(lo, hi, tMax, m, zones, centers);
    if (found) {
      best = found;
      a = m;
    } else b = m;
  }
  return best;
}

/**
 * Niveaux intérieurs de [lo ; hi] à couches d'épaisseur dans [g ; t_max], joints hors des zones,
 * chaque broche de `centers` (triées) au milieu d'une couche d'épaisseur e choisie parmi
 * `CENTER_SAMPLES` valeurs (de la plus épaisse à la plus mince) ; `null` si aucun.
 */
function placeRun(
  lo: Mm,
  hi: Mm,
  tMax: Mm,
  g: Mm,
  zones: readonly Zone[],
  centers: readonly HoleLevel[],
): Mm[] | null {
  const rec = (a: Mm, idx: number): Mm[] | null => {
    if (idx === centers.length) return freeLevels(a, hi, tMax, g, zones);
    const c = centers[idx]!;
    const others = zones.filter((q) => q.z !== c.z || q.r !== c.r);
    const eHi = Math.min(tMax, 2 * (c.z - a), 2 * (hi - c.z));
    const eLo = Math.max(g, 2 * c.r);
    if (eLo > eHi + POS_EPS) return null;
    for (let k = 0; k <= CENTER_SAMPLES; k++) {
      const e = eHi - ((eHi - eLo) * k) / CENTER_SAMPLES;
      const p = c.z - e / 2;
      const q = c.z + e / 2;
      const pAtA = p - a < POS_EPS;
      const qAtHi = hi - q < POS_EPS;
      if (!pAtA && inZone(p, others)) continue;
      if (!qAtHi && inZone(q, others)) continue;
      const below = pAtA ? [] : freeLevels(a, p, tMax, g, zones);
      if (!below) continue;
      const above = qAtHi ? (idx + 1 === centers.length ? [] : null) : rec(q, idx + 1);
      if (!above) continue;
      return [...below, ...(pAtA ? [] : [p]), ...(qAtHi ? [] : [q]), ...above];
    }
    return null;
  };
  return rec(lo, 0);
}

interface Span {
  lo: Mm;
  hi: Mm;
}

/** [lo ; hi] privé des zones ouvertes ]z − r ; z + r[ : intervalles fermés. */
function allowedSpans(lo: Mm, hi: Mm, zones: readonly Zone[]): Span[] {
  let out: Span[] = hi >= lo ? [{ lo, hi }] : [];
  for (const q of zones) {
    const a = q.z - q.r;
    const b = q.z + q.r;
    out = out.flatMap((s) => {
      if (b <= s.lo || a >= s.hi) return [s];
      const parts: Span[] = [];
      if (a >= s.lo) parts.push({ lo: s.lo, hi: a });
      if (b <= s.hi) parts.push({ lo: b, hi: s.hi });
      return parts;
    });
  }
  return out;
}

/** Union triée et fusionnée d'intervalles. */
function mergeSpans(spans: Span[]): Span[] {
  spans.sort((p, q) => p.lo - q.lo);
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.lo <= last.hi + POS_EPS) last.hi = Math.max(last.hi, s.hi);
    else out.push({ ...s });
  }
  return out;
}

/** Point de `spans` ∩ [lo ; hi] le plus proche de `target` (`null` si vide). */
function nearestIn(spans: readonly Span[], lo: Mm, hi: Mm, target: Mm): Mm | null {
  // Cible ±∞ : plus grand (plus petit) point.
  const t = Math.min(Math.max(target, lo), hi);
  let best: Mm | null = null;
  for (const s of spans) {
    const a = Math.max(s.lo, lo);
    const b = Math.min(s.hi, hi);
    if (a > b + POS_EPS) continue;
    const x = Math.min(Math.max(t, a), Math.max(a, b));
    if (best === null || Math.abs(x - t) < Math.abs(best - t)) best = x;
  }
  return best;
}

/**
 * Niveaux intérieurs de [a ; b] (a et b sont des joints) : couches d'épaisseur dans [g ; t_max],
 * joints hors des zones, le moins de couches possible, joints au plus près du partage égal.
 * Ensembles atteignables couche après couche, puis retour arrière. `null` si impossible.
 */
function freeLevels(a: Mm, b: Mm, tMax: Mm, g: Mm, zones: readonly Zone[]): Mm[] | null {
  const len = b - a;
  if (len < POS_EPS) return [];
  const steps: Span[][] = [[{ lo: a, hi: a }]];
  const cap = Math.min(MAX_LAYERS, Math.ceil(len / g) + 1);
  for (let k = 1; k <= cap; k++) {
    const prev = steps[k - 1]!;
    if (prev.some((s) => b - s.hi <= tMax + POS_EPS && b - s.lo >= g - POS_EPS)) {
      // k couches : retour arrière, chaque joint au plus près du partage égal.
      const out: Mm[] = [];
      let x = b;
      for (let i = k - 1; i >= 1; i--) {
        const y = nearestIn(steps[i]!, x - tMax, x - g, a + (len * i) / k);
        if (y === null) return null;
        out.unshift(y);
        x = y;
      }
      return out;
    }
    const next = mergeSpans(
      prev.flatMap((s) => allowedSpans(s.lo + g, Math.min(s.hi + tMax, b - g), zones)),
    );
    if (next.length === 0) return null;
    steps.push(next);
  }
  return null;
}

/** Grille d'abscisses de [a ; b] : nœuds (et nœud − STEP_EPS), pas `step` au plus. */
function grid(a: Mm, b: Mm, nodes: readonly Mm[], step: Mm): Mm[] {
  const inner = nodes.flatMap((x) => [x, x - STEP_EPS]).filter((x) => x > a && x < b);
  const base = [...new Set([a, b, ...inner])].sort((p, q) => p - q);
  const out: Mm[] = [];
  for (let i = 0; i < base.length; i++) {
    const x0 = base[i]!;
    out.push(x0);
    const x1 = base[i + 1];
    if (x1 === undefined || !(x1 - x0 > step)) continue;
    const n = Math.ceil((x1 - x0) / step);
    for (let j = 1; j < n; j++) out.push(x0 + ((x1 - x0) * j) / n);
  }
  return out;
}

/** Abscisse où `inside` bascule entre x0 (valeur `at0`) et x1, par dichotomie. */
function bisect(x0: Mm, x1: Mm, at0: boolean, inside: (x: Mm) => boolean): Mm {
  let a = x0;
  let b = x1;
  for (let i = 0; i < 50 && b - a > 1e-7; i++) {
    const m = (a + b) / 2;
    if (inside(m) === at0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Forme échantillonnée : abscisses, dessous aux abscisses, dessus constant par intervalle. */
interface Sampled {
  readonly xs: readonly Mm[];
  readonly bot: readonly Mm[];
  readonly tops: readonly Mm[];
}

interface Slice {
  readonly z0: Mm;
  readonly z1: Mm;
  /** Aire développée de la part finie (mm²). */
  readonly area: number;
  /** Intervalles d'abscisses de la part finie, triés et fusionnés. */
  readonly spans: readonly { lo: Mm; hi: Mm }[];
}

/**
 * Aire développée de la part finie de la tranche [z0 ; z1] restreinte aux abscisses [lo ; hi]
 * (dessous affine interpolé aux bornes) : additive, la somme sur des abscisses contiguës redonne
 * l'aire de la tranche.
 */
function areaOn(f: Sampled, z0: Mm, z1: Mm, lo: Mm, hi: Mm): number {
  let sum = 0;
  for (let i = 0; i + 1 < f.xs.length; i++) {
    const x0 = f.xs[i]!;
    const x1 = f.xs[i + 1]!;
    const a = Math.max(x0, lo);
    const e = Math.min(x1, hi);
    if (!(e > a)) continue;
    const B0 = f.bot[i]!;
    const B1 = f.bot[i + 1]!;
    const B = (x: Mm): Mm =>
      x === x0 ? B0 : x === x1 ? B1 : B0 + ((B1 - B0) * (x - x0)) / (x1 - x0);
    sum += clippedArea(e - a, B(a), B(e), z0, Math.min(f.tops[i]!, z1));
  }
  return sum;
}

/** Écart en plan entre la corde de [a ; b] (fil d'une planche) et la tangente à la trace, rad. */
export function grainDeviationOf(trace: CentralTrace, a: Mm, b: Mm): number {
  const chord = V.sub(trace.point(b), trace.point(a));
  if (!(V.norm(chord) > 1e-6)) return 0;
  const c = V.normalize(chord);
  let dev = 0;
  for (const x of planGrid(trace, a, b)) {
    const tg = trace.tangent(x);
    dev = Math.max(dev, Math.atan2(Math.abs(V.cross(c, tg)), V.dot(c, tg)));
  }
  return dev;
}

/** Bande en travers d'une couche : décalages gauche finis [d0 ; d1] et rives extérieures. */
interface Strip {
  readonly d0: Mm;
  readonly d1: Mm;
  /** d0 est la face droite de la poutre (−b/2) : surcote de délardement de ce côté. */
  readonly outerRight: boolean;
  /** d1 est la face gauche de la poutre (+b/2). */
  readonly outerLeft: boolean;
}

/** Planche à tailler (finie) : abscisses, bande, bouts extérieurs. */
interface BoardSpec {
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** σ0 (σ1) est un bout de la couche : surcote de délardement de ce côté. */
  readonly first: boolean;
  readonly last: boolean;
  readonly strip: Strip;
}

interface BoardPlan {
  /** Bornes des planches en long (n + 1 abscisses, de σ0 à σ1). */
  readonly cuts: readonly Mm[];
  /** Écart de fil de chaque planche en long, rad. */
  readonly deviations: readonly number[];
  readonly strips: readonly Strip[];
  /** Garde-fou atteint : couche gardée d'une pièce. */
  readonly guard: boolean;
}

/** Aboutages de la couche du dessous et décalage exigé (A36 (6)). */
interface JointRule {
  /** Coupes intérieures (plans de joint) de la couche du dessous, mm. */
  readonly below: readonly Mm[];
  /** Entraxe minimal de deux joints : `jointOffset` + `fingerLength` (0 : aucun), mm. */
  readonly need: Mm;
  /** Longueur des entures (`fingerLength`) : demi-enture ajoutée au gabarit par bout abouté. */
  readonly finger: Mm;
  /** Essais de planche restants pour la poutre (`STAGGER_BUDGET`), partagés par les couches. */
  readonly budget: { left: number };
}

/** Plus petit écart |c − c'| entre les coupes intérieures de `cuts` et `below` (∞ sans vis-à-vis). */
function cutClearance(cuts: readonly Mm[], below: readonly Mm[]): Mm {
  let out = Infinity;
  for (const c of cuts.slice(1, -1)) for (const d of below) out = Math.min(out, Math.abs(c - d));
  return out;
}

/**
 * Découpage d'une couche [σ0 ; σ1] en planches (A35 (h), A36 (6)) : k bandes collées sur chant
 * si la bande droite b + 2s dépasse `maxWidth`, puis le plus petit n de planches aboutées de même
 * longueur sur σ dont chacune respecte β_max et `maxWidth` (gabarit prolongé d'une demi-enture
 * par bout abouté). Si ses joints sont à moins de `joints.need` de ceux de la couche du dessous,
 * les coupes sont déplacées (`staggerCuts`). Garde-fou `MAX_BOARDS` : couche d'une pièce.
 */
function planBoards(
  trace: CentralTrace,
  b: Mm,
  s: Mm,
  sigma0: Mm,
  sigma1: Mm,
  betaMax: number,
  maxWidth: Mm,
  joints: JointRule,
): BoardPlan {
  const plan = equalBoards(trace, b, s, sigma0, sigma1, betaMax, maxWidth, joints.finger);
  const n = plan.cuts.length - 1;
  if (plan.guard || n === 1 || !(joints.need > 0) || joints.below.length === 0) return plan;
  if (cutClearance(plan.cuts, joints.below) >= joints.need - POS_EPS) return plan;
  const fits = (a: Mm, e: Mm): boolean => {
    joints.budget.left -= plan.strips.length;
    if (joints.budget.left < 0) return false;
    if (!(e - a >= MIN_BOARD - POS_EPS)) return false;
    if (grainDeviationOf(trace, a, e) > betaMax + CMP_EPS) return false;
    const spec = (strip: Strip): BoardSpec => ({
      sigma0: a,
      sigma1: e,
      first: a === sigma0,
      last: e === sigma1,
      strip,
    });
    return plan.strips.every((strip) => {
      // Largeur mesurée en travers de la corde : majorant de celle du rectangle minimal, qui
      // n'est calculé (plus coûteux) que si ce majorant dépasse la largeur des plateaux.
      if (
        !Number.isFinite(maxWidth) ||
        chordWidth(trace, spec(strip), s, joints.finger) <= maxWidth
      )
        return true;
      return bandBox(trace, spec(strip), s, joints.finger).width <= maxWidth + CMP_EPS;
    });
  };
  const cuts = staggerCuts(sigma0, sigma1, n, joints, fits);
  // Garde-fou atteint : un placement trouvé avant l'arrêt a été vérifié planche par planche
  // (`fits`) ; sinon, le partage égal.
  if (!cuts) return plan;
  return {
    cuts,
    deviations: cuts.slice(1).map((e, j) => grainDeviationOf(trace, cuts[j]!, e)),
    strips: plan.strips,
    guard: false,
  };
}

/**
 * Coupes d'une couche décalées des joints de la couche du dessous (A36 (6)) : interdites à moins
 * de `need` d'un joint du dessous ; planche [a ; e] admise si `fits(a, e)` (β_max, largeur ;
 * supposé vrai sur toute sous-planche). On cherche le plus petit nombre de planches ≥ n0 (avance
 * gloutonne la plus longue), puis des coupes au plus près du partage égal. À défaut, le plus
 * grand décalage atteignable (dichotomie sur le décalage). `null` : aucun déplacement utile.
 */
function staggerCuts(
  sigma0: Mm,
  sigma1: Mm,
  n0: number,
  joints: JointRule,
  fits: (a: Mm, e: Mm) => boolean,
): Mm[] | null {
  const reachMemo = new Map<Mm, Mm>();
  /** Plus loin où peut finir une planche commencée en a. */
  const reach = (a: Mm): Mm => {
    const hit = reachMemo.get(a);
    if (hit !== undefined) return hit;
    let out: Mm;
    if (fits(a, sigma1)) out = sigma1;
    else {
      let lo = a;
      let hi = sigma1;
      for (let i = 0; i < REACH_ITERATIONS; i++) {
        const m = (lo + hi) / 2;
        if (fits(a, m)) lo = m;
        else hi = m;
      }
      out = lo;
    }
    reachMemo.set(a, out);
    return out;
  };
  const backMemo = new Map<Mm, Mm>();
  /** Plus tôt où peut commencer une planche finie en e. */
  const back = (e: Mm): Mm => {
    const hit = backMemo.get(e);
    if (hit !== undefined) return hit;
    let out: Mm;
    if (fits(sigma0, e)) out = sigma0;
    else {
      let lo = sigma0;
      let hi = e;
      for (let i = 0; i < REACH_ITERATIONS; i++) {
        const m = (lo + hi) / 2;
        if (fits(m, e)) hi = m;
        else lo = m;
      }
      out = hi;
    }
    backMemo.set(e, out);
    return out;
  };
  const attempt = (need: Mm): Mm[] | null => {
    const zones = joints.below.map((z) => ({ z, r: need }));
    const allowed = allowedSpans(sigma0 + MIN_BOARD, sigma1 - MIN_BOARD, zones);
    if (allowed.length === 0) return null;
    // Avance gloutonne : plus petit nombre de planches.
    const forward: Mm[] = [sigma0];
    for (let guard = 0; reach(forward[forward.length - 1]!) < sigma1 - POS_EPS; guard++) {
      const from = forward[forward.length - 1]!;
      const x = nearestIn(allowed, from + MIN_BOARD, reach(from), Infinity);
      if (x === null || x <= from + POS_EPS || guard > MAX_BOARDS) return null;
      forward.push(x);
    }
    for (let n = Math.max(n0, forward.length); n <= Math.min(MAX_BOARDS, n0 + 4); n++) {
      const cuts = placeCuts(n, allowed) ?? repairCuts(n, allowed);
      if (cuts) return cuts;
    }
    return null;
  };
  /**
   * Repli (portée non monotone, trace mêlant droites et arcs) : partage égal en n planches,
   * chaque coupe interdite déplacée vers le plus proche point permis où ses deux planches
   * tiennent.
   */
  const repairCuts = (n: number, allowed: readonly Span[]): Mm[] | null => {
    const cuts = equalLevels(sigma0, sigma1, n);
    for (let j = 1; j < n; j++) {
      const x = cuts[j]!;
      if (nearestIn(allowed, x, x, x) !== null) continue;
      const lo = cuts[j - 1]! + MIN_BOARD;
      const hi = cuts[j + 1]! - MIN_BOARD;
      const options = [nearestIn(allowed, lo, x, Infinity), nearestIn(allowed, x, hi, -Infinity)]
        .filter((y): y is Mm => y !== null)
        .sort((p, q) => Math.abs(p - x) - Math.abs(q - x));
      const y = options.find((c) => fits(cuts[j - 1]!, c) && fits(c, cuts[j + 1]!));
      if (y === undefined) return null;
      cuts[j] = y;
    }
    for (let j = 0; j < n; j++) if (!fits(cuts[j]!, cuts[j + 1]!)) return null;
    return cuts;
  };
  /** n planches : bornes gloutonnes avant (F) et arrière (G), puis coupes au plus près du partage égal. */
  const placeCuts = (n: number, allowed: readonly Span[]): Mm[] | null => {
    const F: Mm[] = [sigma0];
    for (let j = 1; j < n; j++) {
      const from = F[j - 1]!;
      const x = nearestIn(allowed, from + MIN_BOARD, Math.min(reach(from), sigma1), Infinity);
      if (x === null) return null;
      F.push(x);
    }
    if (reach(F[n - 1]!) < sigma1 - POS_EPS) return null;
    const G: Mm[] = new Array<Mm>(n + 1);
    G[n] = sigma1;
    for (let j = n - 1; j >= 1; j--) {
      const to = G[j + 1]!;
      const x = nearestIn(allowed, Math.max(back(to), sigma0), to - MIN_BOARD, -Infinity);
      if (x === null) return null;
      G[j] = x;
    }
    const cuts: Mm[] = [sigma0];
    for (let j = 1; j < n; j++) {
      const prev = cuts[j - 1]!;
      const lo = Math.max(G[j]!, prev + MIN_BOARD);
      const hi = Math.min(F[j]!, reach(prev));
      const x = nearestIn(allowed, lo, hi, sigma0 + ((sigma1 - sigma0) * j) / n);
      if (x === null) return null;
      cuts.push(x);
    }
    cuts.push(sigma1);
    for (let j = 0; j < n; j++) if (!fits(cuts[j]!, cuts[j + 1]!)) return null;
    return cuts;
  };
  const full = attempt(joints.need);
  if (full) return full;
  // Décalage exigé impossible : le plus grand décalage atteignable.
  // Majorant : une coupe ne s'écarte pas plus que de la moitié du plus grand intervalle entre
  // deux joints du dessous (ou d'un joint à un bout de la couche).
  const marks = [sigma0, ...joints.below.filter((d) => d > sigma0 && d < sigma1), sigma1].sort(
    (p, q) => p - q,
  );
  let gapMax = 0;
  for (let i = 1; i < marks.length; i++) {
    const half = i === 1 || i === marks.length - 1 ? 1 : 2;
    gapMax = Math.max(gapMax, (marks[i]! - marks[i - 1]!) / half);
  }
  let best: Mm[] | null = null;
  let a = 0;
  let b = Math.min(joints.need, gapMax);
  for (let i = 0; i < SEARCH_ITERATIONS && b - a > 1; i++) {
    const m = (a + b) / 2;
    const found = attempt(m);
    if (found) {
      best = found;
      a = m;
    } else b = m;
  }
  return best;
}

/** Découpage en planches égales (A35 (h)) : le plus petit n qui respecte β_max et la largeur. */
function equalBoards(
  trace: CentralTrace,
  b: Mm,
  s: Mm,
  sigma0: Mm,
  sigma1: Mm,
  betaMax: number,
  maxWidth: Mm,
  finger: Mm,
): BoardPlan {
  const half = b / 2;
  const whole: Strip = { d0: -half, d1: half, outerRight: true, outerLeft: true };
  const fallback = (guard: boolean): BoardPlan => ({
    cuts: [sigma0, sigma1],
    deviations: [grainDeviationOf(trace, sigma0, sigma1)],
    strips: [whole],
    guard,
  });
  // En travers : k bandes égales, la surcote sur les seules bandes de rive.
  let k = 1;
  if (b + 2 * s > maxWidth + CMP_EPS) {
    k = Math.max(2, Math.ceil(b / (maxWidth - s) - CMP_EPS));
  }
  if (!(k <= MAX_BOARDS)) return fallback(true);
  const strips: Strip[] =
    k === 1
      ? [whole]
      : Array.from({ length: k }, (_, i) => ({
          d0: i === 0 ? -half : -half + (b * i) / k,
          d1: i + 1 === k ? half : -half + (b * (i + 1)) / k,
          outerRight: i === 0,
          outerLeft: i + 1 === k,
        }));
  for (let n = 1; n <= MAX_BOARDS; n++) {
    const cuts = Array.from({ length: n + 1 }, (_, j) =>
      j === 0 ? sigma0 : j === n ? sigma1 : sigma0 + ((sigma1 - sigma0) * j) / n,
    );
    const deviations: number[] = [];
    let ok = true;
    for (let j = 0; j < n && ok; j++) {
      const dev = grainDeviationOf(trace, cuts[j]!, cuts[j + 1]!);
      deviations.push(dev);
      ok = dev <= betaMax + CMP_EPS;
    }
    if (!ok) continue;
    for (let j = 0; j < n && ok; j++) {
      for (const strip of strips) {
        const spec: BoardSpec = {
          sigma0: cuts[j]!,
          sigma1: cuts[j + 1]!,
          first: j === 0,
          last: j + 1 === n,
          strip,
        };
        if (bandBox(trace, spec, s, finger).width > maxWidth + CMP_EPS) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return { cuts, deviations, strips, guard: false };
  }
  return fallback(true);
}

function build(input: StackedLayersInput, t: Mm, s: Mm): StackedLayersResult {
  const { params, trace, profile, checks, beam } = input;
  const { b, sStart, sEnd, baseZ, bottomAt, topAt } = beam;
  const empty = (errors: Message[]): StackedLayersResult => ({
    parts: [],
    layers: [],
    layerThickness: t,
    dressingAllowance: s,
    notes: [],
    errors,
  });
  const finite = [b, sStart, sEnd, baseZ, t, s].every(Number.isFinite);
  if (!finite || !(b > 0) || !(t > 0) || !(s >= 0) || !(sEnd - sStart > 0)) {
    return empty([msg("structure.woodCentral.error.layerShape")]);
  }

  // 1. Forme échantillonnée : dessus constant (pris au milieu) et dessous affine par intervalle.
  const xs = grid(sStart, sEnd, beam.nodes, FINE_STEP);
  const bot = xs.map((x) => bottomAt(x));
  const tops: Mm[] = [];
  for (let i = 0; i + 1 < xs.length; i++) tops.push(topAt((xs[i]! + xs[i + 1]!) / 2));
  const sampled: Sampled = { xs, bot, tops };
  let zTop = -Infinity;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! > Math.max(baseZ, Math.min(bot[i]!, bot[i + 1]!))) zTop = Math.max(zTop, tops[i]!);
  }
  if (![...bot, ...tops].every(Number.isFinite) || !(zTop > baseZ)) {
    return empty([msg("structure.woodCentral.error.layerShape")]);
  }
  const seated = beam.seatLevels !== undefined;
  // Perçages horizontaux (A36 (12)) : zone interdite aux joints = rayon + jeu d'atelier.
  const clearance = profile.wood.clearance;
  const holes: HoleLevel[] = (beam.holes ?? []).map((h) => ({
    z: h.z,
    r: h.diameter / 2 + clearance,
    centered: h.mark === WOOD_CENTRAL_PLATE_FOOT_WEB_MARK,
    mark: h.mark,
  }));
  const { count, bounds, issues } = layerBounds(
    baseZ,
    zTop,
    t,
    beam.seatLevels ?? [],
    MAX_LAYERS,
    holes,
  );
  if (bounds.length === 0) {
    return empty([
      msg("structure.woodCentral.error.layerCount", {
        count,
        thickness: dec(t, 1),
        max: MAX_LAYERS,
      }),
    ]);
  }

  // 2. Tranches : aire exacte et abscisses couvertes.
  const slices: Slice[] = [];
  for (const { z0, z1 } of bounds) {
    let sum = 0;
    const spans: { lo: Mm; hi: Mm }[] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const hi = Math.min(tops[i]!, z1);
      const a = clippedArea(x1 - x0, bot[i]!, bot[i + 1]!, z0, hi);
      if (!(a > 0)) continue;
      sum += a;
      // Part de [x0 ; x1] où le dessous passe sous `hi` (bouts affinés sur le dessous réel).
      const in0 = bot[i]! < hi;
      const in1 = bot[i + 1]! < hi;
      const under = (x: Mm): boolean => bottomAt(x) < hi;
      const lo = in0 ? x0 : bisect(x0, x1, false, under);
      const up = in1 ? x1 : bisect(x0, x1, true, under);
      const last = spans[spans.length - 1];
      if (last && lo - last.hi <= 1e-6) last.hi = Math.max(last.hi, up);
      else spans.push({ lo, hi: up });
    }
    if (sum > EMPTY_AREA && spans.length > 0) slices.push({ z0, z1, area: sum, spans });
  }

  // 3. Pièces : une par couche d'une planche ; une couche composée (A36 (9)) puis ses planches.
  const betaMax = Math.atan(params.section.maxGrainSlope / 100);
  const widestStock = Math.max(...profile.wood.widths) - profile.wood.planingAllowance;
  // Sans plateau plus large que la surcote, découper n'y change rien : `stockOf` le signale.
  const maxWidth = widestStock > 2 * s ? widestStock : Infinity;
  const finger = params.section.fingerLength;
  const offset = params.section.jointOffset;
  const need = offset > 0 ? offset + finger : 0;
  const kerfs = beam.kerfs ?? [];
  const notes: Message[] = [];
  const parts: Part[] = [];
  const layers: StackedLayer[] = [];
  const lengthItems: CheckItem[] = [];
  const stockFindings: Finding[] = [];
  const jointFindings: Finding[] = [];
  const kerfCount = new Map<string, { cut: number; milled: number }>();
  let composed = 0;
  let boardCount = 0;
  let maxDeviation = 0;
  let jointsFaced = 0;
  let jointsHeld = 0;
  let minOffset = Infinity;
  const addPart = (
    partId: string,
    mark: string,
    name: Message,
    slice: Slice,
    spec: BoardSpec,
    deviation: number,
    whole: boolean,
    componentOf: string,
    sliceKerfs: readonly KerfRange[],
  ): void => {
    const flat = templateOf(trace, beam, mark, spec, slice.z1 - slice.z0, s, finger, sliceKerfs);
    const thickness = slice.z1 - slice.z0;
    const stockRes = stockOf(flat.length, flat.width, thickness, profile);
    const stock = stockRes.stock;
    const width = spec.strip.d1 - spec.strip.d0;
    for (const [web, kind] of flat.kerfs) {
      const c = kerfCount.get(web) ?? { cut: 0, milled: 0 };
      if (kind === "cut") c.cut++;
      else c.milled++;
      kerfCount.set(web, c);
    }
    // Aire de la tranche sur les abscisses de la planche ; bouts de couche ouverts, pour que la
    // somme des planches redonne exactement l'aire de la couche.
    const sliceArea = whole
      ? slice.area
      : areaOn(
          sampled,
          slice.z0,
          slice.z1,
          spec.first ? -Infinity : spec.sigma0,
          spec.last ? Infinity : spec.sigma1,
        );
    const chord = V.sub(trace.point(spec.sigma1), trace.point(spec.sigma0));
    const dir =
      V.norm(chord) > 1e-6 ? V.normalize(chord) : trace.tangent((spec.sigma0 + spec.sigma1) / 2);
    parts.push({
      id: partId,
      mark,
      category: "carriage",
      name,
      material: params.material,
      solid: layerSolid(trace, beam, xs, slice, spec),
      flat: flat.pattern,
      stock,
      componentOf,
      quantities: woodQuantities(
        // Surface : part de la face développée de la poutre finie que forme la pièce (même
        // grandeur que la poutre d'une autre filière), au prorata de la largeur de sa bande,
        // pas l'aire du gabarit et de ses surcotes.
        {
          volumeMm3: width * sliceArea,
          surfaceMm2: (sliceArea * width) / b,
          length: flat.length,
        },
        params.material,
        profile,
        stock,
      ),
      grain: { x: dir.x, y: dir.y, z: 0 },
      assembledWith: [beam.beamId],
    });
    maxDeviation = Math.max(maxDeviation, deviation);
    lengthItems.push({ value: flat.length, label: textMessage(mark), partId });
    const ok = stockRes.widthOk && stockRes.thicknessOk;
    stockFindings.push({
      status: ok ? "ok" : "violation",
      measured: stockRes.need.w,
      location: { kind: "part", partId },
      message: ok
        ? msg("structure.common.check.stockAvailable", {
            mark,
            width: dec(stock.width, 0),
            thickness: dec(stock.thickness, 0),
          })
        : msg("structure.woodCut.check.stockMissing", {
            mark,
            width: dec(stockRes.need.w, 0),
            thickness: dec(stockRes.need.t, 0),
          }),
    });
  };
  const whole: Strip = { d0: -b / 2, d1: b / 2, outerRight: true, outerLeft: true };
  let prev: { z1: Mm; cuts: readonly Mm[] } | null = null;
  const budget = { left: STAGGER_BUDGET };
  slices.forEach((slice, i) => {
    const index = i + 1;
    const partId = woodCentralLayerId(index);
    const mark = woodCentralLayerMark(beam.beamMark, index);
    const sigma0 = slice.spans[0]!.lo;
    const sigma1 = slice.spans[slice.spans.length - 1]!.hi;
    if (slice.spans.length > 1)
      notes.push(msg("structure.woodCentral.note.layerDisjoint", { mark }));
    // Joints de la couche du dessous, si elle est jointive (A36 (6)).
    const below = prev && Math.abs(prev.z1 - slice.z0) < 1e-6 ? prev.cuts : [];
    const plan = planBoards(trace, b, s, sigma0, sigma1, betaMax, maxWidth, {
      below,
      need,
      finger,
      budget,
    });
    if (plan.guard) {
      notes.push(msg("structure.woodCentral.note.layerBoardGuard", { mark, max: MAX_BOARDS }));
    }
    const sliceKerfs = kerfRanges(kerfs, slice);
    const n = plan.cuts.length - 1;
    const boards: StackedBoard[] = [];
    if (n === 1 && plan.strips.length === 1) {
      const spec: BoardSpec = { sigma0, sigma1, first: true, last: true, strip: plan.strips[0]! };
      const deviation = plan.deviations[0]!;
      addPart(
        partId,
        mark,
        msg("structure.woodCentral.part.layer", { index, beam: beam.beamMark }),
        slice,
        spec,
        deviation,
        true,
        beam.beamId,
        sliceKerfs,
      );
      boards.push({ index: 1, partId, mark, sigma0, sigma1, grainDeviation: deviation });
    } else {
      composed++;
      // Couche composée (A36 (9)) : pièce intermédiaire, solide seul, composante de la poutre.
      parts.push({
        id: partId,
        mark,
        category: "carriage",
        name: msg("structure.woodCentral.part.layer", { index, beam: beam.beamMark }),
        material: params.material,
        solid: layerSolid(trace, beam, xs, slice, {
          sigma0,
          sigma1,
          first: true,
          last: true,
          strip: whole,
        }),
        componentOf: beam.beamId,
        quantities: {},
        assembledWith: [beam.beamId],
      });
      // Plus petit décalage des aboutages de la couche à ceux du dessous (constat par couche).
      let layerOffset: Mm | undefined;
      for (let j = 0; j < n; j++) {
        // Décalage de ses aboutages à ceux du dessous, parties les plus proches (A36 (6)).
        const ends = [...(j > 0 ? [plan.cuts[j]!] : []), ...(j + 1 < n ? [plan.cuts[j + 1]!] : [])];
        let gap = Infinity;
        for (const c of ends) for (const d of below) gap = Math.min(gap, Math.abs(c - d));
        const jointOffset = Number.isFinite(gap) ? gap - finger : undefined;
        for (const strip of plan.strips) {
          const board = boards.length + 1;
          const id = woodCentralBoardId(index, board);
          const bMark = woodCentralBoardMark(beam.beamMark, index, board);
          const spec: BoardSpec = {
            sigma0: plan.cuts[j]!,
            sigma1: plan.cuts[j + 1]!,
            first: j === 0,
            last: j + 1 === n,
            strip,
          };
          const deviation = plan.deviations[j]!;
          addPart(
            id,
            bMark,
            msg("structure.woodCentral.part.layerBoard", {
              board,
              index,
              beam: beam.beamMark,
            }),
            slice,
            spec,
            deviation,
            false,
            partId,
            sliceKerfs,
          );
          boards.push({
            index: board,
            partId: id,
            mark: bMark,
            sigma0: spec.sigma0,
            sigma1: spec.sigma1,
            ...(plan.strips.length > 1 ? { across: { d0: strip.d0, d1: strip.d1 } } : {}),
            grainDeviation: deviation,
            ...(jointOffset !== undefined ? { jointOffset } : {}),
          });
          if (jointOffset !== undefined) {
            layerOffset = Math.min(layerOffset ?? Infinity, jointOffset);
          }
        }
      }
      // Un constat par couche composée, et non par planche (QUESTIONS A37 (13)).
      jointFindings.push(jointFinding(partId, mark, layerOffset, offset));
      // Décompte par joint (un plan de joint par coupe intérieure, toutes bandes confondues).
      for (const c of plan.cuts.slice(1, -1)) {
        if (below.length === 0) continue;
        const gap = Math.min(...below.map((d) => Math.abs(c - d))) - finger;
        jointsFaced++;
        if (gap >= offset - POS_EPS) jointsHeld++;
        minOffset = Math.min(minOffset, gap);
      }
      boardCount += boards.length;
    }
    prev = { z1: slice.z1, cuts: plan.cuts.slice(1, -1) };
    layers.push({ index, partId, mark, z0: slice.z0, z1: slice.z1, sigma0, sigma1, boards });
  });

  // 4. Contrôles de fabrication par pièce (couche ou planche).
  if (layers.length > 0) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.boardLength),
      lengthItems,
      msg("structure.common.check.boardLength"),
      { min: null, max: profile.wood.maxBoardLength },
    );
    checks.add(pluginRuleDef(FAB_RULES.stockAvailable), stockFindings);
    if (jointFindings.length > 0) {
      checks.add(pluginRuleDef(WOOD_CENTRAL_LAYER_RULES.fingerJoints), jointFindings);
    }
    // Perçages horizontaux et joints de colle : un constat par perçage (A36 (12), A37 (15)).
    if (holes.length > 0) {
      checks.add(
        pluginRuleDef(WOOD_CENTRAL_LAYER_RULES.holeJoints),
        holeJointFindings(holes, layers, beam.beamId),
      );
    }
    // Remarques particulières (perçages, logements, aboutages), puis synthèses en tête.
    notes.push(...holeNotes(holes, issues ?? [], layers, clearance));
    for (const [web, c] of kerfCount) {
      notes.push(
        c.milled > 0
          ? msg("structure.woodCentral.note.layerKerfMilled", { web, cut: c.cut, milled: c.milled })
          : msg("structure.woodCentral.note.layerKerf", { web, cut: c.cut }),
      );
    }
    if (composed > 0) {
      notes.unshift(
        jointsFaced > 0
          ? msg("structure.woodCentral.note.layerFingerJoints", {
              finger: dec(finger, 0),
              offset: dec(offset, 0),
              held: jointsHeld,
              joints: jointsFaced,
              min: dec(minOffset, 0),
            })
          : msg("structure.woodCentral.note.layerFingerJointsAlone", {
              finger: dec(finger, 0),
              offset: dec(offset, 0),
            }),
      );
      notes.unshift(
        msg("structure.woodCentral.note.layerBoards", {
          layers: composed,
          boards: boardCount,
          slope: dec(params.section.maxGrainSlope, 1),
          angle: dec((betaMax * 180) / Math.PI, 1),
          deviation: dec((maxDeviation * 180) / Math.PI, 1),
        }),
      );
    }
    const thicknesses = layers.map((l) => l.z1 - l.z0);
    notes.unshift(
      seated
        ? msg("structure.woodCentral.note.stackedLayersSeated", {
            count: layers.length,
            min: dec(Math.min(...thicknesses), 1),
            max: dec(Math.max(...thicknesses), 1),
            thickness: dec(t, 1),
            allowance: dec(s, 1),
          })
        : msg("structure.woodCentral.note.stackedLayers", {
            count: layers.length,
            thickness: dec(t, 1),
            allowance: dec(s, 1),
          }),
    );
  }
  return {
    parts,
    layers,
    layerThickness: t,
    dressingAllowance: s,
    maxGrainDeviation: maxDeviation,
    notes,
    errors: [],
  };
}

/**
 * Constat de décalage d'une couche composée (A36 (6) ; un constat par couche et non par planche,
 * QUESTIONS A37 (13)) : `measured` = plus petit décalage des aboutages de ses planches à ceux de
 * la couche du dessous (parties les plus proches), `min` = `jointOffset`.
 */
function jointFinding(partId: string, mark: string, measured: Mm | undefined, offset: Mm): Finding {
  const location = { kind: "part", partId } as const;
  if (measured === undefined) {
    return {
      status: "ok",
      location,
      message: msg("structure.woodCentral.check.layerJointFree", { mark }),
    };
  }
  const ok = !(offset > 0) || measured >= offset - POS_EPS;
  return {
    status: ok ? "ok" : "violation",
    measured,
    min: offset,
    location,
    message: msg(
      ok ? "structure.woodCentral.check.layerJointOk" : "structure.woodCentral.check.layerJoint",
      {
        mark,
        distance: dec(measured, 0),
        min: dec(offset, 0),
      },
    ),
  };
}

/**
 * Constats des perçages horizontaux (A36 (12)) : distance du joint de colle le plus proche (faces
 * jointives de deux couches) au centre de chaque perçage, une entrée par repère et par
 * altitude ; `min` = rayon + jeu d'atelier (`HoleLevel.r`).
 */
function holeJointFindings(
  holes: readonly HoleLevel[],
  layers: readonly StackedLayer[],
  beamId: string,
): Finding[] {
  const joints: Mm[] = [];
  for (let i = 1; i < layers.length; i++) {
    if (Math.abs(layers[i - 1]!.z1 - layers[i]!.z0) < 1e-6) joints.push(layers[i]!.z0);
  }
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const h of holes) {
    const key = `${h.mark ?? ""}@${h.z.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let distance = Infinity;
    for (const z of joints) distance = Math.min(distance, Math.abs(z - h.z));
    const ok = distance >= h.r - POS_EPS;
    const args = { mark: h.mark ?? "", z: dec(h.z, 1), min: dec(h.r, 1) };
    out.push({
      status: ok ? "ok" : "violation",
      ...(Number.isFinite(distance) ? { measured: distance } : {}),
      min: h.r,
      location: { kind: "part", partId: beamId },
      message: ok
        ? msg("structure.woodCentral.check.layerHoleJointOk", args)
        : msg("structure.woodCentral.check.layerHoleJoint", {
            ...args,
            distance: dec(distance, 1),
          }),
    });
  }
  return out;
}

/**
 * Remarques des perçages (A36 (12)) : joints écartés, broches centrées, broches hors du milieu de
 * leur couche ; un joint de colle trop proche d'un perçage est un constat
 * (`holeJointFindings`), pas une remarque.
 */
function holeNotes(
  holes: readonly HoleLevel[],
  issues: readonly HoleIssue[],
  layers: readonly StackedLayer[],
  clearance: Mm,
): Message[] {
  if (holes.length === 0) return [];
  const out: Message[] = [];
  const pins = holes.filter((h) => h.centered);
  const centered = [
    ...new Set(
      pins
        .filter((h) => !issues.some((i) => i.kind === "offCenter" && i.z === h.z))
        .flatMap((h) =>
          layers.filter((l) => Math.abs((l.z0 + l.z1) / 2 - h.z) < 1e-6).map((l) => l.mark),
        ),
    ),
  ];
  out.push(
    centered.length > 0
      ? msg("structure.woodCentral.note.layerHolesPins", {
          holes: holes.length,
          clearance: dec(clearance, 1),
          web: pins[0]!.mark ?? "",
          marks: centered.join(", "),
        })
      : msg("structure.woodCentral.note.layerHoles", {
          holes: holes.length,
          clearance: dec(clearance, 1),
        }),
  );
  for (const i of issues) {
    if (i.kind === "offCenter") {
      out.push(
        msg("structure.woodCentral.note.layerPinOffCenter", { mark: i.mark, z: dec(i.z, 1) }),
      );
    }
  }
  return out;
}

/** Part d'un logement d'âme dans une tranche (A36 (5)) : abscisses, découpé ou fraisé. */
interface KerfRange {
  readonly web: string;
  readonly width: Mm;
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** Profondeur dans la tranche si le logement n'en traverse pas toute l'épaisseur, mm. */
  readonly depth?: Mm;
}

/** Étendue verticale du logement à l'abscisse x (contour exact ou rectangle), `null` hors. */
function kerfExtent(kerf: BeamKerf, x: Mm): { lo: Mm; hi: Mm } | null {
  if (!(x > kerf.sigma0 && x < kerf.sigma1)) return null;
  const poly = kerf.outline;
  if (!poly || poly.length < 3) return { lo: kerf.z0, hi: kerf.z1 };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    if ((p.x - x) * (q.x - x) > 0 || p.x === q.x) continue;
    const y = p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi > lo ? { lo, hi } : null;
}

/**
 * Parts des logements dans la tranche [z0 ; z1] (A36 (5)) : abscisses où le logement coupe la
 * tranche, regroupées par profondeur (traversant ou non), lues entre les sommets du contour.
 */
function kerfRanges(kerfs: readonly BeamKerf[], slice: Slice): KerfRange[] {
  const out: KerfRange[] = [];
  const h = slice.z1 - slice.z0;
  for (const kerf of kerfs) {
    const xsK = [
      kerf.sigma0,
      kerf.sigma1,
      ...(kerf.outline ?? []).map((p) => p.x).filter((x) => x > kerf.sigma0 && x < kerf.sigma1),
    ];
    const marks = [...new Set(xsK)].sort((p, q) => p - q);
    let cur: { sigma0: Mm; sigma1: Mm; depth: Mm | undefined } | null = null;
    const flush = (): void => {
      if (cur) {
        out.push({
          web: kerf.mark,
          width: kerf.width,
          sigma0: cur.sigma0,
          sigma1: cur.sigma1,
          ...(cur.depth !== undefined ? { depth: cur.depth } : {}),
        });
      }
      cur = null;
    };
    for (let i = 0; i + 1 < marks.length; i++) {
      const a = marks[i]!;
      const e = marks[i + 1]!;
      const ext = kerfExtent(kerf, (a + e) / 2);
      const ov = ext ? Math.min(ext.hi, slice.z1) - Math.max(ext.lo, slice.z0) : 0;
      if (!(ov > POS_EPS)) {
        flush();
        continue;
      }
      const depth = ov >= h - POS_EPS ? undefined : ov;
      const c = cur as { sigma0: Mm; sigma1: Mm; depth: Mm | undefined } | null;
      if (c && Math.abs(c.sigma1 - a) < POS_EPS && sameDepth(c.depth, depth)) c.sigma1 = e;
      else {
        flush();
        cur = { sigma0: a, sigma1: e, depth };
      }
    }
    flush();
  }
  return out;
}

const sameDepth = (p: Mm | undefined, q: Mm | undefined): boolean =>
  p === undefined || q === undefined ? p === q : Math.abs(p - q) < 1e-6;

/**
 * Solide d'une pièce (couche ou planche) : surface réglée sur la face gauche de sa bande
 * (trace + gauche · d1), de max(dessous, z0) à min(dessus, z1), sur ses abscisses [σ0 ; σ1],
 * épaissie de d1 − d0 vers la droite. Les sections de hauteur inférieure à `MIN_SECTION` (bouts
 * en pointe) sont rognées.
 */
function layerSolid(
  trace: CentralTrace,
  beam: StackedBeamShape,
  xs: readonly Mm[],
  slice: Slice,
  spec: BoardSpec,
): Part["solid"] {
  const { bottomAt, topAt } = beam;
  const { sigma0, sigma1 } = spec;
  const { d0, d1 } = spec.strip;
  const at = [sigma0, sigma1, ...slice.spans.flatMap((r) => [r.lo, r.hi])].filter(
    (x) => x >= sigma0 && x <= sigma1,
  );
  const pts = [...new Set([...at, ...xs.filter((x) => x > sigma0 && x < sigma1)])].sort(
    (p, q) => p - q,
  );
  const a: Vec3[] = [];
  const top: Vec3[] = [];
  const normals: Vec2[] = [];
  const push = (x: Mm, lo: Mm, hi: Mm): void => {
    const left = trace.left(x);
    const p = V.addScaled(trace.point(x), left, d1);
    a.push({ x: p.x, y: p.y, z: lo });
    top.push({ x: p.x, y: p.y, z: hi });
    normals.push(V.scale(left, -1));
  };
  // Le dessus est pris juste à l'intérieur des bouts (σ1 : dessus de l'assise qui finit là).
  const sectionAt = (x: Mm): { lo: Mm; hi: Mm } => {
    const xt = x >= sigma1 ? x - STEP_EPS : x;
    return { lo: Math.max(bottomAt(x), slice.z0), hi: Math.min(topAt(xt), slice.z1) };
  };
  for (const x of pts) {
    const { lo, hi } = sectionAt(x);
    if (hi - lo > MIN_SECTION) push(x, lo, hi);
  }
  if (a.length < 2) {
    // Pièce en pointe sur toute sa longueur : deux sections de hauteur minimale.
    a.length = 0;
    top.length = 0;
    normals.length = 0;
    const mid = (sigma0 + sigma1) / 2;
    const half = Math.max((sigma1 - sigma0) / 2, MIN_SECTION);
    const { lo } = sectionAt(mid);
    const z = Math.min(lo, slice.z1 - 2 * MIN_SECTION);
    for (const x of [mid - half, mid + half]) push(x, z, z + 2 * MIN_SECTION);
  }
  return { kind: "ruled", a, b: top, thickness: d1 - d0, normals };
}

/** Abscisses du gabarit sur [a ; b] : bouts, naissances, bornes d'arcs, pas angulaire sur un arc. */
function planGrid(trace: CentralTrace, a: Mm, b: Mm): Mm[] {
  const marks = [
    ...trace.naissances.map((n) => n.sigma),
    ...trace.arcs.flatMap((r) => [r.sigma0, r.sigma1]),
  ].filter((x) => x > a && x < b);
  const base = [...new Set([a, b, ...marks])].sort((p, q) => p - q);
  const out: Mm[] = [];
  for (let i = 0; i < base.length; i++) {
    const x0 = base[i]!;
    out.push(x0);
    const x1 = base[i + 1];
    if (x1 === undefined) continue;
    const mid = (x0 + x1) / 2;
    const arc = trace.arcs.find((r) => mid > r.sigma0 && mid < r.sigma1);
    if (!arc) continue;
    const step = Math.min(ARC_STEP_MAX, Math.max(ARC_STEP_MIN, arc.radius * ARC_ANGLE_STEP));
    const n = Math.ceil((x1 - x0) / step);
    for (let j = 1; j < n; j++) out.push(x0 + ((x1 - x0) * j) / n);
  }
  return out;
}

/** Contour en plan d'une pièce (avec surcotes extérieures), axe de son rectangle minimal. */
interface Band {
  readonly outline: readonly Vec2[];
  /** Abscisses brutes [a ; e] et décalages bruts [lo ; hi]. */
  readonly a: Mm;
  readonly e: Mm;
  readonly lo: Mm;
  readonly hi: Mm;
  readonly axis: Vec2;
  readonly perp: Vec2;
  readonly u0: Mm;
  readonly v0: Mm;
  readonly length: Mm;
  readonly width: Mm;
}

const offsetOf = (trace: CentralTrace, x: Mm, d: Mm): Vec2 =>
  V.addScaled(trace.point(x), trace.left(x), d);

/**
 * Largeur de la bande d'une pièce (`bandBox`) mesurée en travers de sa corde : majorant de la
 * largeur de son rectangle minimal, sans le calculer.
 */
function chordWidth(trace: CentralTrace, spec: BoardSpec, s: Mm, finger: Mm): Mm {
  const a = spec.sigma0 - (spec.first ? s : finger / 2);
  const e = spec.sigma1 + (spec.last ? s : finger / 2);
  const lo = spec.strip.d0 - (spec.strip.outerRight ? s : 0);
  const hi = spec.strip.d1 + (spec.strip.outerLeft ? s : 0);
  const chord = V.sub(trace.point(e), trace.point(a));
  if (!(V.norm(chord) > 1e-6)) return Infinity;
  const n = V.perpLeft(V.normalize(chord));
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const x of planGrid(trace, a, e)) {
    for (const d of [lo, hi]) {
      const v = V.dot(offsetOf(trace, x, d), n);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  }
  return v1 - v0;
}

/**
 * Bande en plan d'une pièce : décalages [d0 ; d1] (± la surcote sur les faces extérieures) sur
 * [σ0 ; σ1] (± la surcote aux bouts de la couche, ± une demi-enture `finger` / 2 aux bouts
 * aboutés, A36 (6)), avec l'axe de son rectangle minimal.
 */
function bandBox(trace: CentralTrace, spec: BoardSpec, s: Mm, finger: Mm): Band {
  const a = spec.sigma0 - (spec.first ? s : finger / 2);
  const e = spec.sigma1 + (spec.last ? s : finger / 2);
  const lo = spec.strip.d0 - (spec.strip.outerRight ? s : 0);
  const hi = spec.strip.d1 + (spec.strip.outerLeft ? s : 0);
  const xs = planGrid(trace, a, e);
  const outline = ensureCCW([
    ...xs.map((x) => offsetOf(trace, x, hi)),
    ...xs.map((x) => offsetOf(trace, x, lo)).reverse(),
  ]);
  // Axe du rectangle minimal lu sur un contour allégé (`minAreaRect` est quadratique en nombre
  // de sommets de l'enveloppe), étendues mesurées sur tous les sommets.
  const stride = Math.max(1, Math.ceil(outline.length / RECT_SAMPLES));
  const coarse = outline.filter((_, i) => i % stride === 0 || i === outline.length - 1);
  const axis = minAreaRect(coarse).axis;
  const perp = V.perpLeft(axis);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of outline) {
    const u = V.dot(p, axis);
    const v = V.dot(p, perp);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return {
    outline,
    a,
    e,
    lo,
    hi,
    axis,
    perp,
    u0,
    v0,
    length: Math.max(u1 - u0, v1 - v0),
    width: Math.min(u1 - u0, v1 - v0),
  };
}

/**
 * Gabarit en plan d'une pièce (couche ou planche) : sa bande (`bandBox`), posée dans l'axe de
 * son rectangle minimal (coordonnées positives) ; traçage de l'axe de la trace (s'il passe dans
 * la bande), des faces finies extérieures, des bouts finis de la couche, des naissances, des
 * plans de joint des aboutages à entures (A36 (6)) et du contour des logements d'âme qu'elle
 * reçoit (A36 (5) : découpé avant collage, ou fraisé à la profondeur indiquée). `kerfs` : âmes
 * dont le logement est tracé, avec sa nature.
 */
function templateOf(
  trace: CentralTrace,
  beam: StackedBeamShape,
  mark: string,
  spec: BoardSpec,
  t: Mm,
  s: Mm,
  finger: Mm,
  sliceKerfs: readonly KerfRange[],
): {
  pattern: FlatPattern;
  length: Mm;
  width: Mm;
  area: number;
  kerfs: readonly (readonly [string, "cut" | "milled"])[];
} {
  const half = beam.b / 2;
  const box = bandBox(trace, spec, s, finger);
  const { a, e, lo, hi, axis, perp, u0, v0 } = box;
  const band = (x0: Mm, x1: Mm, d: Mm): Vec2[] =>
    planGrid(trace, x0, x1).map((x) => offsetOf(trace, x, d));
  const toFlat = (p: Vec2): Vec2 => V.vec(V.dot(p, axis) - u0, V.dot(p, perp) - v0);
  const lines: FlatPattern["lines"][number][] = [];
  const polyline = (pts: readonly Vec2[], label: Message, depth?: Mm): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      lines.push({
        kind: "mark",
        a: toFlat(pts[i]!),
        b: toFlat(pts[i + 1]!),
        ...(i === 0 ? { label } : {}),
        ...(depth !== undefined ? { depth } : {}),
      });
    }
  };
  const across = (x: Mm, label: Message, kind: "mark" | "joint" = "mark"): void => {
    lines.push({
      kind,
      a: toFlat(offsetOf(trace, x, lo)),
      b: toFlat(offsetOf(trace, x, hi)),
      label,
    });
  };
  if (lo < 0 && hi > 0) polyline(band(a, e, 0), msg("structure.woodCentral.flatLine.layerAxis"));
  const face = msg("structure.woodCentral.flatLine.layerFace");
  if (spec.strip.outerLeft) polyline(band(spec.sigma0, spec.sigma1, half), face);
  if (spec.strip.outerRight) polyline(band(spec.sigma0, spec.sigma1, -half), face);
  const end = msg("structure.woodCentral.flatLine.layerEnd");
  if (spec.first) across(spec.sigma0, end);
  if (spec.last) across(spec.sigma1, end);
  for (const nai of trace.naissances) {
    if (nai.sigma > a && nai.sigma < e) {
      across(nai.sigma, msg("structure.steelCurved.flatLine.springing"));
    }
  }
  // Plans de joint des aboutages à entures (A36 (6)) : le gabarit dépasse d'une demi-enture.
  const fingerLabel = msg("structure.woodCentral.flatLine.layerFingerJoint", {
    length: dec(finger, 0),
  });
  if (!spec.first) across(spec.sigma0, fingerLabel, "joint");
  if (!spec.last) across(spec.sigma1, fingerLabel, "joint");
  // Logements des âmes (A36 (5)) : contour en plan sur l'étendue où il coupe la tranche.
  const kerfs: [string, "cut" | "milled"][] = [];
  for (const k of sliceKerfs) {
    const k0 = Math.max(k.sigma0, spec.sigma0);
    const k1 = Math.min(k.sigma1, spec.sigma1);
    const d0 = Math.max(-k.width / 2, spec.strip.d0);
    const d1 = Math.min(k.width / 2, spec.strip.d1);
    if (!(k1 - k0 > POS_EPS) || !(d1 - d0 > POS_EPS)) continue;
    const label =
      k.depth === undefined
        ? msg("structure.woodCentral.flatLine.layerKerf", { web: k.web })
        : msg("structure.woodCentral.flatLine.layerKerfMilled", {
            web: k.web,
            depth: dec(k.depth, 0),
          });
    const sides: Mm[] = [];
    if (-k.width / 2 >= spec.strip.d0 - POS_EPS) sides.push(-k.width / 2);
    if (k.width / 2 <= spec.strip.d1 + POS_EPS) sides.push(k.width / 2);
    for (const d of sides) polyline(band(k0, k1, d), label, k.depth);
    // Bouts du logement (pas une coupe de planche).
    for (const x of [k0, k1]) {
      if (Math.abs(x - k.sigma0) > POS_EPS && Math.abs(x - k.sigma1) > POS_EPS) continue;
      polyline([offsetOf(trace, x, d0), offsetOf(trace, x, d1)], label, k.depth);
    }
    kerfs.push([k.web, k.depth === undefined ? "cut" : "milled"]);
  }
  const c = toFlat(
    offsetOf(trace, (spec.sigma0 + spec.sigma1) / 2, (spec.strip.d0 + spec.strip.d1) / 2),
  );
  lines.push({
    kind: "text",
    a: V.vec(c.x - TEXT_HALF, c.y),
    b: V.vec(c.x + TEXT_HALF, c.y),
    label: textMessage(mark),
  });
  return {
    pattern: {
      outline: { outer: box.outline.map(toFlat), holes: [] },
      lines,
      thickness: t,
      reference: {
        kind: "face",
        description: msg("structure.woodCentral.reference.layer", {
          mark,
          allowance: dec(s, 1),
        }),
      },
    },
    length: box.length,
    width: box.width,
    area: area(box.outline),
    kerfs: [...new Map(kerfs.map((x) => [`${x[0]}|${x[1]}`, x])).values()],
  };
}
