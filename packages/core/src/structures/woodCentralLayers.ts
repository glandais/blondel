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
 * 3D : la poutre l'est). La poutre ne porte alors ni débit ni grandeurs de matière.
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
 * intérieurs coupés justes (convention **à valider**). Le décalage des joints aboutés d'une
 * couche à l'autre n'est pas imposé (aucune source, à valider). Une couche d'une seule planche
 * reste une pièce (`wood-central-layer-<k>`, `LC1-<k>`) ; sinon chaque planche est une pièce
 * composante de la poutre (`wood-central-layer-<k>-<j>`, `LC1-<k>.<j>`). Au-delà du garde-fou
 * `MAX_BOARDS`, la couche reste d'une pièce, avec une remarque.
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
 *
 * `buildStackedLayers` ne lève jamais : erreurs dans `errors`.
 */
import { dec, errorMessage, msg, textMessage, type Message } from "@blondel/i18n";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, Part } from "../model/derived.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import type { Finding } from "../rules/types.js";
import type { WorkshopProfile } from "../workshop/profile.js";
import type { CentralTrace } from "./centralTrace.js";
import { FAB_RULES, pluginRuleDef, type CheckCollector, type CheckItem } from "./checks.js";
import { area, minAreaRect } from "./geom.js";
import { woodQuantities } from "./quantities.js";
import type { WoodCentralParams } from "./woodCentralParams.js";
import { stockOf } from "./woodHoused.js";

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
}

export interface StackedLayersInput {
  readonly params: WoodCentralParams;
  readonly trace: CentralTrace;
  readonly profile: WorkshopProfile;
  /**
   * Collecteur des contrôles du plugin : les couches y ajoutent leurs contrôles de fabrication
   * (longueur de plateau `FAB_PLATEAU_LONGUEUR_MAX`, débit disponible `FAB_DEBIT_DISPONIBLE`,
   * par pièce : couche d'une planche ou planche d'une couche composée).
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
   * la couche est une planche (pièce `partId`). Plusieurs : la couche n'est plus une pièce,
   * chaque planche en est une (`componentOf` = la poutre).
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
}

export interface StackedLayersResult {
  /** Pièces composantes (`componentOf` = `beam.beamId`), du bas vers le haut. */
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
 * Tranches de l'empilement (QUESTIONS A35 (g)) : niveaux = base, puis les assises comprises dans
 * ]base ; zTop] (triées, dédoublonnées à `LEVEL_EPS` près) ; chaque intervalle [lo ; hi] est
 * partagé en ⌈(hi − lo) / t_max⌉ couches égales ; au-dessus du dernier niveau, tranches
 * régulières de t_max jusqu'à zTop. Sans assise : tranches régulières depuis la base. Au-delà de
 * `max` tranches, `bounds` est vide et `count` dit combien il en faudrait.
 */
export function layerBounds(
  baseZ: Mm,
  zTop: Mm,
  tMax: Mm,
  seatLevels: readonly Mm[] = [],
  max: number = MAX_LAYERS,
): { readonly count: number; readonly bounds: readonly LayerBound[] } {
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
  if (!(count <= max)) return { count, bounds: [] };
  const bounds = runs.flatMap(({ lo, hi, n }) =>
    Array.from({ length: n }, (_, k) => ({
      z0: k === 0 ? lo : lo + ((hi - lo) * k) / n,
      z1: k + 1 === n ? hi : lo + ((hi - lo) * (k + 1)) / n,
    })),
  );
  return { count, bounds };
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

/**
 * Découpage d'une couche [σ0 ; σ1] en planches (A35 (h)) : k bandes collées sur chant si la
 * bande droite b + 2s dépasse `maxWidth`, puis le plus petit n de planches aboutées de même
 * longueur sur σ dont chacune respecte β_max et `maxWidth`. Garde-fou `MAX_BOARDS` : couche
 * d'une pièce.
 */
function planBoards(
  trace: CentralTrace,
  b: Mm,
  s: Mm,
  sigma0: Mm,
  sigma1: Mm,
  betaMax: number,
  maxWidth: Mm,
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
        if (bandBox(trace, spec, s).width > maxWidth + CMP_EPS) {
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
  const { count, bounds } = layerBounds(baseZ, zTop, t, beam.seatLevels ?? []);
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

  // 3. Pièces : une par couche d'une planche, une par planche d'une couche composée (A35 (h)).
  const betaMax = Math.atan(params.section.maxGrainSlope / 100);
  const widestStock = Math.max(...profile.wood.widths) - profile.wood.planingAllowance;
  // Sans plateau plus large que la surcote, découper n'y change rien : `stockOf` le signale.
  const maxWidth = widestStock > 2 * s ? widestStock : Infinity;
  const notes: Message[] = [];
  const parts: Part[] = [];
  const layers: StackedLayer[] = [];
  const lengthItems: CheckItem[] = [];
  const stockFindings: Finding[] = [];
  let composed = 0;
  let boardCount = 0;
  let maxDeviation = 0;
  const addPart = (
    partId: string,
    mark: string,
    name: Message,
    slice: Slice,
    spec: BoardSpec,
    deviation: number,
    whole: boolean,
  ): void => {
    const flat = templateOf(trace, beam, mark, spec, slice.z1 - slice.z0, s);
    const thickness = slice.z1 - slice.z0;
    const stockRes = stockOf(flat.length, flat.width, thickness, profile);
    const stock = stockRes.stock;
    const width = spec.strip.d1 - spec.strip.d0;
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
      componentOf: beam.beamId,
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
  slices.forEach((slice, i) => {
    const index = i + 1;
    const partId = woodCentralLayerId(index);
    const mark = woodCentralLayerMark(beam.beamMark, index);
    const sigma0 = slice.spans[0]!.lo;
    const sigma1 = slice.spans[slice.spans.length - 1]!.hi;
    if (slice.spans.length > 1)
      notes.push(msg("structure.woodCentral.note.layerDisjoint", { mark }));
    const plan = planBoards(trace, b, s, sigma0, sigma1, betaMax, maxWidth);
    if (plan.guard) {
      notes.push(msg("structure.woodCentral.note.layerBoardGuard", { mark, max: MAX_BOARDS }));
    }
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
      );
      boards.push({ index: 1, partId, mark, sigma0, sigma1, grainDeviation: deviation });
    } else {
      composed++;
      for (let j = 0; j < n; j++) {
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
          );
          boards.push({
            index: board,
            partId: id,
            mark: bMark,
            sigma0: spec.sigma0,
            sigma1: spec.sigma1,
            ...(plan.strips.length > 1 ? { across: { d0: strip.d0, d1: strip.d1 } } : {}),
            grainDeviation: deviation,
          });
        }
      }
      boardCount += boards.length;
    }
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
    if (composed > 0) {
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
 * Bande en plan d'une pièce : décalages [d0 ; d1] (± la surcote sur les faces extérieures) sur
 * [σ0 ; σ1] (± la surcote aux bouts de la couche), avec l'axe de son rectangle minimal.
 */
function bandBox(trace: CentralTrace, spec: BoardSpec, s: Mm): Band {
  const a = spec.sigma0 - (spec.first ? s : 0);
  const e = spec.sigma1 + (spec.last ? s : 0);
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
 * la bande), des faces finies extérieures, des bouts finis de la couche et des naissances.
 */
function templateOf(
  trace: CentralTrace,
  beam: StackedBeamShape,
  mark: string,
  spec: BoardSpec,
  t: Mm,
  s: Mm,
): { pattern: FlatPattern; length: Mm; width: Mm; area: number } {
  const half = beam.b / 2;
  const box = bandBox(trace, spec, s);
  const { a, e, lo, hi, axis, perp, u0, v0 } = box;
  const band = (x0: Mm, x1: Mm, d: Mm): Vec2[] =>
    planGrid(trace, x0, x1).map((x) => offsetOf(trace, x, d));
  const toFlat = (p: Vec2): Vec2 => V.vec(V.dot(p, axis) - u0, V.dot(p, perp) - v0);
  const lines: FlatPattern["lines"][number][] = [];
  const polyline = (pts: readonly Vec2[], label: Message): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      lines.push({
        kind: "mark",
        a: toFlat(pts[i]!),
        b: toFlat(pts[i + 1]!),
        ...(i === 0 ? { label } : {}),
      });
    }
  };
  const across = (x: Mm, label: Message): void => {
    lines.push({
      kind: "mark",
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
  };
}
