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
 *   marche est logé de d au moins dans la dent. Sans entaille (d = 0, contremarches pleines :
 *   contremarche devant la dent comme `wood-cut`, dernière marche contre le chevêtre) : face de
 *   la dent à σ_max de la ligne (de la face arrière de la contremarche).
 * - **Sous-face** : courbe des nez sur la trace abaissée d'une constante Δ, la plus petite qui
 *   laisse au moins le reste sous entaille (`section.residual`, `auto` : tableau FCBA lu à
 *   b / `facteur_centrale` quand il est exploitable, sinon `residualFallback`) sous chaque fond
 *   d'entaille, distance prise perpendiculairement à la sous-face locale. Sur un escalier droit
 *   à girons égaux, la rive basse et le reste sous entaille sont exactement ceux de `wood-cut`.
 * - **Extrémités** : face avant sous le nez 0 (décalée du débord et de la contremarche, comme
 *   `wood-cut`) ; coupe de niveau au pied sur le dessus de la semelle du sabot (au sol sans
 *   sabot) ; coupe d'aplomb en tête contre le chevêtre (ligne du nez d'arrivée décalée comme
 *   l'arrière d'une marche, convention de `wood-cut`), moins l'âme du sabot de tête et le jeu.
 * - **Lamellation** (`WoodCentralLamination`) : massif d'une pièce, couches collées droites
 *   (escalier droit, C §1.5 [7][8]) ou lamelles verticales cintrées sur moule (trace courbe,
 *   C §1.6 [7] ; la source recommande le moule sous 60 mm d'épaisseur : remarque « à valider »,
 *   QUESTIONS A33 (e)) ; n = ⌈b / t⌉ lamelles égales d'épaisseur b / n ; k_r et refus sous
 *   r_in/t = 170 lus dans `LAMELLE_CINTRE_KR`. Débit : une lame par lamelle (`stock.count`).
 * - **Boulons** (C §1.5 [54], source faible) : `bolts.perTread` boulons verticaux par marche,
 *   du dessus de la marche à la sous-face, répartis sur l'assise hors des pinces, à l'entraxe
 *   `bolts.minSpacing` au moins ; longueur arrondie au pas supérieur. Sur l'axe de la poutre,
 *   ou décalés d'une demi-couche quand un nombre pair de couches droites met un joint de colle
 *   sur l'axe. Aucun boulon là où la sous-face ne laisse pas la place de l'écrou au-dessus du
 *   sol ou de la semelle du sabot (coupe au sol), ni à moins de l'entraxe d'un boulon de sabot :
 *   constat `FAB_LIMON_CENTRAL_BOIS_BOULONS` (QUESTIONS A34). Le développé porte aussi les
 *   perçages des boulons de sabot.
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
import type { BeamSection } from "../precheck/beam.js";
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
import { fcbaTable, requiredCentralResidual, type StrengthClass } from "./fcba.js";
import { area, clipHalfPlane, minAreaRect, removeCollinear } from "./geom.js";
import { woodQuantities } from "./quantities.js";
import { STEEL_RULES, holePolygon } from "./steelCommon.js";
import { stockOf } from "./woodHoused.js";
import { SHOE_FIT_RULE, buildWoodCentralShoes, roundUpTo, spread } from "./woodCentralShoes.js";
import type { WoodCentralParams } from "./woodCentralParams.js";

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
  /** Boulons traversants de chaque marche placés sur son assise (C §1.5 [54]). */
  bolts: {
    id: "FAB_LIMON_CENTRAL_BOIS_BOULONS",
    ...sourceSpec(msg("compliance.source.woodCentralBolts")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: null,
  },
  /** Sabots logés sur la coupe au sol et dans la hauteur de la coupe de tête. */
  shoeFit: SHOE_FIT_RULE,
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

/** Boulon traversant vertical d'une marche. */
export interface WoodCentralBolt {
  /** Abscisse sur la trace, mm. */
  readonly sigma: Mm;
  /** Décalage latéral par rapport à l'axe de la poutre (positif à gauche), mm. */
  readonly lateral: Mm;
  /** Longueur retenue (arrondie au pas supérieur), mm. */
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
  /** Boulons traversants de la marche. */
  readonly bolts: readonly WoodCentralBolt[];
}

/** Lamellation de la poutre (lamellé-collé ou massif). */
export interface WoodCentralLamination {
  readonly kind: "glulam" | "solid";
  /** Lamelles cintrées sur moule (trace courbe, lamellé-collé). */
  readonly curved: boolean;
  /**
   * Épaisseur d'une lamelle retenue, mm : b / n, n lamelles égales (massif : b). Au plus
   * l'épaisseur saisie (ou `auto` résolue).
   */
  readonly lamellaThickness: Mm;
  /** Nombre de lamelles n = ⌈b / t⌉ (massif : 1) ; n × épaisseur = b. */
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
}

export interface WoodCentralBeamResult {
  /** Pièces : poutre (catégorie `carriage`) et sabots (catégorie `fixing`). */
  readonly parts: readonly Part[];
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

/** Lamellation retenue (paramètres résolus) ; `ratio` = ∞ et k_r = 1 sans cintrage. */
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
  if (!curvedTrace || !Number.isFinite(innerRadius)) {
    const tMax = Math.max(...profile.wood.thicknesses) - profile.wood.planingAllowance;
    const t = entered !== "auto" ? entered : tMax > 0 ? tMax : b;
    return {
      kind: "glulam",
      curved: false,
      ...equal(t),
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
 * Classe de résistance `auto` (mêmes hypothèses « à valider » que `wood-cut`) : C30 pour le pin,
 * D40 pour chêne, hêtre et frêne, inconnue pour le lamellé-collé (classes GL : QUESTIONS A33).
 */
export const WOOD_CENTRAL_AUTO_CLASS: Readonly<Record<WoodMaterialId, StrengthClass | "unknown">> =
  {
    "wood-pine": "C30",
    "wood-oak": "D40",
    "wood-beech": "D40",
    "wood-ash": "D40",
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
  if (cls === "unknown") return unusable(msg("structure.woodCut.fcba.unknownClass"));
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
  const H = ctx.project.site.floorToFloor;
  if (H > table.floorToFloor) {
    return unusable(
      msg("structure.woodCut.fcba.totalRise", {
        rise: dec(H, 0),
        max: dec(table.floorToFloor, 0),
      }),
    );
  }
  const sig = trace.nosingSigma;
  const run = Math.abs(sig[sig.length - 1]! - sig[0]!);
  const maxRun = table.floorToFloor / Math.tan((table.pitchDeg * Math.PI) / 180);
  if (run > maxRun + 1e-6) {
    return unusable(
      msg("structure.woodCut.fcba.run", {
        run: dec(run, 0),
        max: dec(maxRun, 0),
        floorToFloor: dec(table.floorToFloor, 0),
        pitch: dec(table.pitchDeg, 0),
      }),
    );
  }
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
 * intervalles les plus longs d'abord ; un boulon au milieu, plusieurs répartis bout à bout.
 */
function placeBolts(intervals: readonly { lo: Mm; hi: Mm }[], n: number, spacing: Mm): Mm[] {
  if (n <= 0) return [];
  const byLength = [...intervals].sort((p, q) => q.hi - q.lo - (p.hi - p.lo));
  const out: Mm[] = [];
  for (const r of byLength) {
    const left = n - out.length;
    if (left <= 0) break;
    const len = r.hi - r.lo;
    if (len < -1e-9) continue;
    const k = Math.min(left, 1 + Math.floor(Math.max(0, len) / spacing + 1e-9));
    if (k === 1) out.push((r.lo + r.hi) / 2);
    else out.push(...spread(len, 0, k).map((x) => r.lo + x));
  }
  return out.sort((p, q) => p - q);
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
  const lamination: WoodCentralLamination = known?.lamination ?? {
    kind: input.params.section.kind,
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

function sectionLabelOf(lam: WoodCentralLamination, b: Mm, height: Mm): Message {
  const h = Number.isFinite(height) ? dec(Math.ceil(height - 1e-6), 0) : dec(0, 0);
  if (lam.kind === "solid")
    return msg("structure.woodCentral.section.solid", { width: dec(b, 0), height: h });
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

  // 1. Valeurs auto, lamellation, FCBA.
  const lamination = laminationOf(params, trace, profile);
  const fcba = woodCentralFcba(ctx, params, trace);
  const residual =
    params.section.residual !== "auto"
      ? params.section.residual
      : (fcba.required ?? params.section.residualFallback);
  const rearDepth = params.notch.rearDepth !== "auto" ? params.notch.rearDepth : wood.housingDepth;
  const known = { lamination, fcba, residual, rearDepth };
  const curvedTrace = trace.kind !== "straight";
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
  const rearOffset = spec.nosing + (full ? spec.riserThickness : 0);
  const spanOf = (k: number): { lo: Mm; hi: Mm } | null =>
    lineSpan(trace, nosings[k]!, sig[k]!, rearOffset, b);
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
  const shoeT = params.anchors.thickness;
  const trimmer = arrival.hi;
  const sH = trimmer - (head ? shoeT + c : 0);
  const sF = front.hi;
  const drafts: SeatDraft[] = [];
  let prevFace = sF;
  const sorted = [...treads].sort((p, q) => p.number - q.number);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    const k = t.number;
    const last = i === sorted.length - 1;
    const z = t.z - tm;
    const rear = k < nosings.length ? spanOf(k) : null;
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
    } else if (!full && rearDepth > 0) {
      face = rear.lo - rearDepth;
      sigma1 = rear.hi + c;
      notch = true;
    } else {
      face = rear.hi;
      sigma1 = rear.hi;
    }
    drafts.push({ tread: k, z, sigma0: prevFace, face, sigma1, rearMin: rear.lo, notch });
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
  const floorLevel = params.anchors.foot ? shoeT : 0;
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

  // 5. Sabots (avant les boulons de marche, écartés de leurs perçages).
  const shoes = buildWoodCentralShoes({
    params,
    trace,
    profile,
    checks,
    beam: {
      beamId: WOOD_CENTRAL_BEAM_ID,
      beamMark: WOOD_CENTRAL_BEAM_MARK,
      frontSigma: sF,
      floorCutLength: floorCut ? floorCut.x1 - floorCut.x0 : 0,
      firstSeatZ: drafts[0]!.z,
      trimmerSigma: trimmer,
      headBottom: Math.max(zLow(sH), floorLevel),
      headTop: drafts[drafts.length - 1]!.z,
    },
  });
  errors.push(...shoes.errors);
  notes.push(...shoes.notes);

  // 6. Assises : reste sous entaille mesuré, bois au-dessus de l'entaille, boulons.
  const baseParts = ctx.baseParts ?? buildBasicParts(project, ctx.layout, stepping).parts;
  const markOfTread = new Map(
    baseParts.filter((p) => p.treadNumber !== undefined).map((p) => [p.treadNumber!, p.mark]),
  );
  const treadMark = (n: number): string => markOfTread.get(n) ?? String(n);
  const bp = params.bolts;
  const spacing = bp.minSpacing !== "auto" ? bp.minSpacing : bp.holeDiameter;
  // Place de l'écrou : sous-face au moins `protrusion` + pas d'arrondi au-dessus du sol ou de la
  // semelle, de sorte que le bout du boulon (longueur arrondie) reste au-dessus (la sous-face
  // monte avec la trace : borne basse σ*, par dichotomie).
  // Dessous réel de la poutre : contour développé (sous-face échantillonnée, coupe au sol).
  const bottomAt = (x: Mm): Mm => verticalExtent(outline, x)?.[0] ?? Math.max(zLow(x), floorLevel);
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
  // Zones interdites : perçages des boulons de sabot (entraxe et demi-diamètres).
  const forbidden = shoes.beamHoles.map((h) => {
    const m = Math.max(spacing, (h.diameter + bp.holeDiameter) / 2);
    return { lo: h.sigma - m, hi: h.sigma + m };
  });
  // Boulons hors du joint de colle central (nombre pair de couches droites).
  const lateral =
    lamination.kind === "glulam" && !lamination.curved && lamination.lamellae % 2 === 0
      ? lamination.lamellaThickness / 2
      : 0;
  const missingBolts: {
    seat: SeatDraft;
    placed: number;
    length: Mm;
    blocked: boolean;
  }[] = [];
  const seats: WoodCentralSeat[] = drafts.map((d, i) => {
    const next = drafts[i + 1];
    const toothAbove =
      d.notch && next ? Math.max(0, next.z - d.z - tm - c) : Number.POSITIVE_INFINITY;
    const lo = d.sigma0 + bp.edgeDistance;
    const hi = Math.min(d.face, d.sigma1, d.rearMin) - bp.edgeDistance;
    const free = hi < lo - 1e-9 ? [] : [{ lo, hi }];
    const allowed = subtractIntervals(
      free.map((r) => ({ lo: Math.max(r.lo, sNut), hi: r.hi })).filter((r) => r.hi >= r.lo - 1e-9),
      forbidden,
    );
    const positions = placeBolts(allowed, bp.perTread, spacing);
    const fit = positions.length;
    if (fit < bp.perTread) {
      missingBolts.push({
        seat: d,
        placed: fit,
        length: hi - lo + 2 * bp.edgeDistance,
        blocked: placeBolts(free, bp.perTread, spacing).length > fit,
      });
    }
    return {
      tread: d.tread,
      treadPartId: `tread-${d.tread}`,
      sigma0: d.sigma0,
      sigma1: d.sigma1,
      z: d.z,
      rearDepth: d.notch ? d.rearMin - d.face : 0,
      residual: (d.z - zLow(d.sigma1)) * cosAt(d.sigma1),
      toothAbove,
      bolts: positions.map((s) => ({
        sigma: s,
        lateral,
        // Jusqu'au dessous réel de la poutre (jamais sous la coupe au sol).
        length: roundUpTo(tm + (d.z - bottomAt(s)) + bp.protrusion, bp.lengthStep),
      })),
    };
  });

  // 7. Pièce poutre.
  const id = WOOD_CENTRAL_BEAM_ID;
  const mark = WOOD_CENTRAL_BEAM_MARK;
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
    for (const bolt of s.bolts) {
      lines.push({
        kind: "mark",
        a: toFlat(V.vec(bolt.sigma, s.z)),
        b: toFlat(V.vec(bolt.sigma, bottomAt(bolt.sigma))),
        label: msg("structure.woodCentral.flatLine.bolt", { diameter: dec(bp.holeDiameter, 0) }),
      });
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
  const mid = (sStart + sEnd) / 2;
  const midExt = verticalExtent(outline, mid);
  const yMid = midExt ? (midExt[0] + midExt[1]) / 2 : floorLevel + residual / 2;
  lines.push({
    kind: "text",
    a: toFlat(V.vec(mid - 20, yMid)),
    b: toFlat(V.vec(mid + 20, yMid)),
    label: textMessage(mark),
  });
  // Perçages des boulons de sabot au travers de la poutre (horizontaux, perpendiculaires aux
  // faces : vrais trous du développé), centres dans le contour seulement.
  const shoeHoles = shoes.beamHoles.filter(
    (h) => pointInPolygon(V.vec(h.sigma, h.z), outline, 1e-6) === "inside",
  );
  for (const h of shoeHoles) {
    lines.push({
      kind: "text",
      a: toFlat(V.vec(h.sigma - 20, h.z + h.diameter)),
      b: toFlat(V.vec(h.sigma + 20, h.z + h.diameter)),
      label: msg("structure.woodCentral.flatLine.shoeBolt", {
        diameter: dec(h.diameter, 0),
        mark: h.mark,
      }),
    });
  }
  const flat: FlatPattern = {
    outline: {
      outer: outline.map(toFlat),
      holes: shoeHoles.map((h) => holePolygon(toFlat(V.vec(h.sigma, h.z)), h.diameter)),
    },
    lines,
    thickness: b,
    reference: { kind: "face", description: msg("structure.woodCentral.reference.beam") },
  };
  const box = minAreaRect(outline);
  const devArea = area(outline);
  const height = Math.min(...seats.map((s) => s.residual).filter(Number.isFinite), Infinity);
  const sectionHeight = Number.isFinite(height) ? height : residual;
  const sectionLabel = sectionLabelOf(lamination, b, box.width);
  const solidStock =
    lamination.kind === "solid" ? stockOf(box.length, box.width, b, profile) : null;
  const layerStock =
    lamination.kind === "glulam" && !lamination.curved
      ? stockOf(box.length, box.width, lamination.lamellaThickness, profile)
      : null;
  // Débit du lamellé-collé : une lame par lamelle (`count`). Couches droites : plateau du profil
  // d'atelier (contrôlé par FAB_DEBIT_DISPONIBLE) ; lamelles cintrées : lame à l'épaisseur de la
  // lamelle, sans surcote de corroyage (plis minces, à valider, QUESTIONS A34).
  const stock: NonNullable<Part["stock"]> = solidStock
    ? solidStock.stock
    : layerStock
      ? { ...layerStock.stock, count: lamination.lamellae }
      : {
          length: box.length + wood.lengthAllowance,
          width: box.width + wood.planingAllowance,
          thickness: lamination.lamellaThickness,
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
    const byLength = new Map<Mm, number>();
    for (const bolt of s.bolts) byLength.set(bolt.length, (byLength.get(bolt.length) ?? 0) + 1);
    for (const [length, points] of byLength) {
      fixings.push({
        joint: "treadBeamBolted",
        points,
        holeDiameter: bp.holeDiameter,
        length,
        with: [s.treadPartId],
      });
    }
  }
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
    stock,
    quantities: {
      ...woodQuantities(
        { volumeMm3: devArea * b, surfaceMm2: devArea, length: box.length },
        params.material,
        profile,
        stock,
      ),
      ...(lamination.kind === "glulam"
        ? {
            [QUANTITY_LAMELLAE]: lamination.lamellae,
            [QUANTITY_LAMELLA_THICKNESS_MM]: lamination.lamellaThickness,
          }
        : {}),
    },
    grain: {
      x: midT.x * Math.cos(pitch),
      y: midT.y * Math.cos(pitch),
      z: Math.sin(pitch),
    },
    ...(fixings.length > 0 ? { fixings } : {}),
  };

  // 8. Contrôles de fabrication de la poutre.
  const loc = { partId: id };
  checks.addItems(
    pluginRuleDef(FAB_RULES.boardLength),
    [{ value: box.length, label: textMessage(mark), ...loc }],
    msg("structure.common.check.boardLength"),
    { min: null, max: wood.maxBoardLength },
  );
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
  const boltFindings: Finding[] =
    bp.perTread === 0
      ? [{ status: "ok", message: msg("structure.woodCentral.check.bolts.none") }]
      : missingBolts.length === 0
        ? [
            {
              status: "ok",
              message: msg("structure.woodCentral.check.bolts.ok", {
                count: seats.length,
                perTread: bp.perTread,
                edge: dec(bp.edgeDistance, 0),
              }),
            },
          ]
        : missingBolts.map((m) => ({
            status: "violation" as const,
            measured: m.placed,
            location: { kind: "part" as const, partId: id, treadNumber: m.seat.tread },
            message: m.blocked
              ? msg("structure.woodCentral.check.bolts.blocked", {
                  mark: treadMark(m.seat.tread),
                  placed: m.placed,
                  wanted: bp.perTread,
                })
              : msg("structure.woodCentral.check.bolts.missing", {
                  mark: treadMark(m.seat.tread),
                  placed: m.placed,
                  wanted: bp.perTread,
                  length: dec(Math.max(0, m.length), 0),
                  edge: dec(bp.edgeDistance, 0),
                }),
          }));
  checks.add(pluginRuleDef(WOOD_CENTRAL_BEAM_RULES.bolts), boltFindings);

  // 9. Remarques.
  notes.unshift(
    lamination.kind === "solid"
      ? msg("structure.woodCentral.note.solid", { section: sectionLabel })
      : lamination.curved
        ? msg("structure.woodCentral.note.curvedGlulam", {
            count: lamination.lamellae,
            thickness: dec(lamination.lamellaThickness, 1),
            radius: dec(lamination.innerRadius, 0),
            ratio: dec(lamination.ratio, 0),
            kr: dec(lamination.kr, 3),
          })
        : msg("structure.woodCentral.note.glulam", {
            count: lamination.lamellae,
            thickness: dec(lamination.lamellaThickness, 1),
          }),
  );
  if (lamination.curved)
    notes.push(msg("structure.woodCentral.note.mouldDomain", { width: dec(b, 0) }));
  if (lateral > 0 && seats.some((s) => s.bolts.length > 0)) {
    notes.push(msg("structure.woodCentral.note.boltOffset", { offset: dec(lateral, 1) }));
  }
  if (curvedTrace && drafts.some((d) => d.notch))
    notes.push(msg("structure.woodCentral.note.notchNot3d"));

  const assemblies: PartAssembly[] = [
    ...seats.map((s) => ({ a: { partId: id }, b: { treadNumber: s.tread } })),
    ...shoes.assemblies,
  ];
  const footMid = floorCut ? (floorCut.x0 + floorCut.x1) / 2 : sStart;
  return {
    parts: [beamPart, ...shoes.parts],
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
  const topAt = (s: Mm): Mm => {
    for (const d of drafts) if (s < d.sigma1 - 1e-9) return d.z;
    return drafts[drafts.length - 1]!.z;
  };
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
