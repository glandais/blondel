/**
 * Préréglages de projet : un `Project` complet, valide et réaliste pour chaque forme courante.
 *
 * Repère local (identique au site, placement à l'origine sans rotation) : départ sur le
 * segment (0,0)–(E,0), montée selon +Y, x = 0 côté gauche. Tournant à gauche : la volée
 * suivante part vers −X ; à droite : vers +X. Les longueurs de volées sont mesurées sur le bord
 * extérieur des tournants (voir `LayoutSpecSchema`).
 *
 * Valeurs par défaut : H = 2 700 mm, plancher haut de 200 mm, emmarchement de 800 à 900 mm.
 * Les longueurs de volées sont calculées pour que le giron sur la ligne de foulée vaille
 * ≈ 630 − 2h (valeur `auto` de `targetGoing`), avec n = arrondi(H / 175) (valeur `auto` de
 * `riserCount`). La trémie rectangulaire couvre toute la zone où l'échappée verticale
 * au-dessus de la ligne de pente serait inférieure à 1 900 mm sous le plancher
 * (`ECHAPPEE_MIN_DTU`), en couvrant l'emmarchement entier.
 *
 * La trémie est calculée sur le **vrai** tracé (`computeLayout`) et les vraies positions et
 * altitudes des nez (`placeNosings`, `computeRises`) : c'est le rectangle aligné (arrondi vers
 * l'extérieur au multiple de 10 mm) qui englobe la partie de l'escalier où la ligne de pente
 * passerait à moins de `ECHAPPEE_MIN_DTU` de la sous-face du plancher (`requiredOpening`).
 * Les côtés de ce rectangle qui longent un bord de l'escalier sont ensuite élargis d'un jeu
 * latéral (`openingClearance`, défaut `PRESET_OPENING_CLEARANCE`, à valider) : les garde-corps
 * de volée, décalés vers le vide, ne passent pas sous la dalle haute (`GC_CONFLIT_DALLE`).
 * Les longueurs de volées supposent un jour à angle vif et la ligne de foulée au milieu
 * (E ≤ 1 200 mm) : |Γ| = ΣL − 2E·(N − 1) + N·(π/2)·(E/2) pour N tournants.
 */
import { DEFAULT_LOCALE, msg, translatorFor, type Message, type MessageKey } from "@blondel/i18n";
import { computeLayout } from "../layout/layout.js";
import { resolveRiserCount, resolveTargetGoing } from "../layout/resolve.js";
import { LayoutError } from "../layout/errors.js";
import { requiredOpening } from "../headroom/required.js";
import {
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  SteppingSchema,
  type Project,
  type ProjectInput,
} from "../model/project.js";
import type { Layout } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import { LF_WIDE_THRESHOLD } from "../rules/params.js";
import { getRule } from "../rules/table.js";
import { SteppingError } from "../stepping/errors.js";
import { placeNosings } from "../stepping/positions.js";
import { computeStepping } from "../stepping/stepping.js";
import { MAX_BALANCED_EXTENT } from "../stepping/zones.js";
import { computeRises } from "../stepping/rises.js";
import { createHelicalProject } from "./presetHelical.js";
import { MessageRangeError } from "./errors.js";

export type TurnDirection = "left" | "right";

/** Rectangle aligné sur les axes du site (trémie rectangulaire). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly sizeX: number;
  readonly sizeY: number;
}

/** Plus petit rectangle aligné contenant les points, arrondi vers l'extérieur au multiple de `grid` mm. */
export function boundingRect(points: readonly Vec2[], grid = 10): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const eps = 1e-6;
  const x0 = Math.floor((Math.min(...xs) + eps) / grid) * grid;
  const y0 = Math.floor((Math.min(...ys) + eps) / grid) * grid;
  const x1 = Math.ceil((Math.max(...xs) - eps) / grid) * grid;
  const y1 = Math.ceil((Math.max(...ys) - eps) / grid) * grid;
  return { x: x0, y: y0, sizeX: x1 - x0, sizeY: y1 - y0 };
}

/**
 * Préréglages d'escaliers **à volées** (inchangés depuis le jalon 2 : l'interface et ses tests
 * les parcourent en supposant des volées).
 */
export const PRESET_IDS = [
  "straight",
  "quarter-left",
  "quarter-right",
  "two-quarters-u",
  "half-turn",
  "quarter-landing",
] as const;
/**
 * Préréglages à tournants de sens opposés (S / Z), séparés de `PRESET_IDS` : les garde-corps, les
 * structures et l'interface supposent encore un seul côté de jour (voir le ledger).
 */
export const OPPOSITE_TURNS_PRESET_IDS = ["two-quarters-s"] as const;
export type FlightsPresetId =
  (typeof PRESET_IDS)[number] | (typeof OPPOSITE_TURNS_PRESET_IDS)[number];
/** Préréglages hélicoïdaux (jalon 5a, `presetHelical.ts`). */
export const HELICAL_PRESET_IDS = ["helical"] as const;
/** Tous les préréglages. */
export const ALL_PRESET_IDS = [
  ...PRESET_IDS,
  ...OPPOSITE_TURNS_PRESET_IDS,
  ...HELICAL_PRESET_IDS,
] as const;
export type PresetId = (typeof ALL_PRESET_IDS)[number];

/** Clés des libellés des préréglages (nom du projet créé, sélecteur de l'interface). */
export const PRESET_LABELS: Readonly<Record<PresetId, MessageKey>> = {
  straight: "preset.straight.label",
  "quarter-left": "preset.quarterLeft.label",
  "quarter-right": "preset.quarterRight.label",
  "two-quarters-u": "preset.twoQuartersU.label",
  "two-quarters-s": "preset.twoQuartersS.label",
  "half-turn": "preset.halfTurn.label",
  "quarter-landing": "preset.quarterLanding.label",
  helical: "preset.helical.label",
};

/**
 * Nom par défaut d'un projet créé par un préréglage : libellé en **français**, quelle que soit
 * la langue d'affichage (projets et exemples stables ; l'interface peut fournir `name`).
 */
export function defaultPresetName(key: MessageKey): string {
  return translatorFor(DEFAULT_LOCALE).t(key);
}

/** Seuil `min` d'une règle de rules.yaml (erreur de programmation s'il est absent). */
function ruleMin(id: string): number {
  const min = getRule(id).min;
  if (min === null) throw new Error(`La règle ${id} n'a pas de seuil minimal.`);
  return min;
}

/** Échappée minimale en logement (mm), lue dans la règle `ECHAPPEE_MIN_DTU` de rules.yaml. */
export const PRESET_HEADROOM_MIN: number = ruleMin("ECHAPPEE_MIN_DTU");
/**
 * Emmarchement maximal pour lequel la ligne de foulée est au milieu (`LF_POSITION_DTU_ETROIT` :
 * « E <= 1200 => d_lf = E / 2 ») : hypothèse du calcul des longueurs de volées. Lu dans
 * rules.yaml (`parametres.E_seuil`).
 */
const WALKLINE_MIDDLE_MAX_WIDTH = LF_WIDE_THRESHOLD.value;
/**
 * Débord de nez des préréglages : valeur recommandée de `DEBORD_NEZ_LOGEMENT` (10 mm), car les
 * préréglages ciblent le contexte `logement_interieur`. Le défaut du modèle (`TreadSpecSchema`)
 * vaut aussi 10 mm depuis QUESTIONS A9 (il valait 30 mm et déclenchait un avertissement) ; un
 * test vérifie que les deux restent égaux.
 */
export const PRESET_NOSING: number = (() => {
  const r = getRule("DEBORD_NEZ_LOGEMENT").recommande;
  if (r === null) throw new Error("La règle DEBORD_NEZ_LOGEMENT n'a pas de valeur recommandée.");
  return r;
})();
/** Valeurs par défaut du cahier des charges des préréglages. */
export const DEFAULT_FLOOR_TO_FLOOR = 2700;
export const DEFAULT_SLAB_THICKNESS = 200;
/**
 * Jeu latéral par défaut (mm) entre les bords de l'escalier et la trémie des préréglages
 * (`PresetOptions.openingClearance`). **[Choix Blondel, à valider]** : aucune valeur sourcée ;
 * 100 mm couvrent le garde-corps de volée par défaut (`guards.flight.edgeOffset` = 30 mm vers
 * le vide + demi-poteau de 40 mm, `guards/spec.ts`, eux-mêmes à valider) avec 30 mm de marge,
 * pour que le rampant et sa main courante ne passent pas sous la dalle haute
 * (`GC_CONFLIT_DALLE`). Une trémie au nu de l'escalier (jeu nul) oblige à arrêter le
 * garde-corps sous la dalle ou à le fixer au nez de dalle.
 */
export const PRESET_OPENING_CLEARANCE = 100;

/** Objet partiel récursif ; les tableaux sont remplacés en bloc. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface PresetOptions {
  readonly name?: string;
  /** Hauteur à monter H (mm), défaut 2 700. */
  readonly floorToFloor?: number;
  /** Emmarchement E (mm), défaut selon le préréglage (800 à 900), ≤ 1 200. */
  readonly width?: number;
  /** Épaisseur du plancher haut (mm), défaut 200. */
  readonly upperSlabThickness?: number;
  /**
   * Sens des tournants pour `two-quarters-u`, `half-turn`, `quarter-landing` (défaut : gauche) ;
   * sens du **premier** tournant pour `two-quarters-s` (le second est de sens opposé : Z si
   * `right`).
   */
  readonly direction?: TurnDirection;
  /**
   * Jeu latéral (mm, entier ≥ 0) ajouté à la trémie calculée sur chaque côté qui longe un bord
   * de l'escalier (jour ou extérieur), pas du côté de l'arrivée ; défaut
   * `PRESET_OPENING_CLEARANCE` (à valider). Sans effet si la trémie est donnée dans `patch`.
   */
  readonly openingClearance?: number;
  /** Hélicoïdal : rayon extérieur R_e (mm), défaut 900 (à valider). */
  readonly outerRadius?: number;
  /** Hélicoïdal : rayon du fût r_f (mm), défaut 70 (à valider). */
  readonly coreRadius?: number;
  /** Hélicoïdal : forme de la trémie qui dégage l'escalier (défaut : circulaire). */
  readonly openingShape?: "circle" | "square";
  /**
   * Surcharge libre appliquée en dernier (fusion profonde, tableaux remplacés). H, E, la dalle
   * et le réglage des hauteurs qu'elle contient sont pris en compte dans le calcul des volées et
   * de la trémie ; des volées ou une trémie données explicitement remplacent le calcul.
   */
  readonly patch?: DeepPartial<ProjectInput>;
}

/** Proportions d'un préréglage à volées (reprises par le recalage, `realign.ts`). */
export interface PresetShape {
  readonly width: number;
  readonly turns: readonly TurnDirection[];
  readonly mode: "winders" | "landing";
  /** Longueur droite de ligne de foulée dans la première volée, en girons. */
  readonly firstStraightGoings: number;
  /** Longueur intérieure (jour) des volées centrales, mm (volée centrale = 2E + jour). */
  readonly middleWell: number;
  /**
   * Longueur droite de ligne de foulée des volées centrales, en girons (remplace `middleWell`).
   * S / Z : au moins un giron (marche fixe entre les deux balancements, CHALLENGE G3).
   */
  readonly middleGoings?: number;
  /** Tournants alternés : le second de sens opposé au premier (S / Z). */
  readonly alternate?: boolean;
}

export const FLIGHTS_PRESET_SHAPES: Readonly<Record<FlightsPresetId, PresetShape>> = {
  straight: { width: 900, turns: [], mode: "winders", firstStraightGoings: 0, middleWell: 0 },
  "quarter-left": {
    width: 900,
    turns: ["left"],
    mode: "winders",
    firstStraightGoings: 2,
    middleWell: 0,
  },
  "quarter-right": {
    width: 900,
    turns: ["right"],
    mode: "winders",
    firstStraightGoings: 2,
    middleWell: 0,
  },
  // U et demi-tournant [choix Blondel, à valider] : position du premier tournant et jour
  // retenus pour que le collet minimal (M3 auto, jour vif) dépasse 100 mm (G_COLLET_MIN) avec
  // H = 2 700 et reste au-dessus pour H ∈ [2 500 ; 2 900] (balayage : U ≥ 135 mm, demi-tournant
  // ≥ 143 mm). Avant : premier tournant à 1 giron du départ (collets 90 et 87,6 mm).
  "two-quarters-u": {
    width: 850,
    turns: ["left", "left"],
    mode: "winders",
    firstStraightGoings: 2,
    middleWell: 400,
  },
  // Demi-tournant revu le 2026-09-29 [core:stepping, choix Blondel à valider] avec l'étendue de
  // balancement bornée à 3,5 girons depuis l'angle (K7, CHALLENGE G3 corrigé) : avec 4 girons
  // et un jour de 180 mm, le collet tombait à 94 mm (H = 2 500). Avec 3,5 girons et 240 mm
  // (volée centrale < 1 giron : zone unique de 180° conservée), balayage H ∈ [2 500 ; 2 900]
  // par pas de 25 mm : collet ≥ 105 mm ; K3 évalué par angle du jour (deux angles vifs : deux
  // « vallées » de collets, `cornerMonotonyBreaks`) : aucune rupture (`stepping/k3.test.ts`).
  "half-turn": {
    width: 800,
    turns: ["left", "left"],
    mode: "winders",
    firstStraightGoings: 3.5,
    middleWell: 240,
  },
  "quarter-landing": {
    width: 900,
    turns: ["left"],
    mode: "landing",
    firstStraightGoings: 2,
    middleWell: 0,
  },
  // S (2026-09-29) [choix Blondel, à valider] : premier tournant à 2 girons du départ, partie
  // droite intermédiaire de 3,5 girons, jour vif, E = 850 (ligne de foulée au milieu : pas de
  // transition). Balayage E ∈ {800, 850, 900} × premier tournant ∈ {1,5 … 3} girons × partie
  // intermédiaire ∈ {2 … 4} girons, H ∈ [2 500 ; 2 900] par pas de 25 mm : collet minimal
  // (M3 auto) ≥ 111 mm, sans rupture K3 (`presets.test.ts`).
  "two-quarters-s": {
    width: 850,
    turns: ["left", "right"],
    mode: "winders",
    firstStraightGoings: 2,
    middleWell: 0,
    middleGoings: 3.5,
    alternate: true,
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Fusion profonde : objets fusionnés, tableaux et scalaires remplacés, `undefined` ignoré. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    // `__proto__` (possible dans un JSON.parse) : ignoré pour ne pas changer le prototype.
    if (value === undefined || key === "__proto__") continue;
    out[key] = deepMerge(out[key], value);
  }
  return out as T;
}

/** Tournants balancés : longueurs de volées pour un giron `going` sur la ligne de foulée. */
function windersLegs(
  shape: PresetShape,
  width: number,
  turns: readonly TurnDirection[],
  n: number,
  going: number,
): number[] {
  const quarterArc = (Math.PI / 2) * (width / 2);
  const total = (n - 1) * going;
  const middleCount = Math.max(0, turns.length - 1);
  const middle = shape.middleGoings !== undefined ? shape.middleGoings * going : shape.middleWell;
  const firstStraight = turns.length === 0 ? total : shape.firstStraightGoings * going;
  const lastStraight = total - firstStraight - turns.length * quarterArc - middleCount * middle;
  if (turns.length > 0 && lastStraight < 0) {
    throw new MessageRangeError(
      msg("project.preset.heightTooLow", { missing: String(Math.ceil(-lastStraight)) }),
    );
  }
  if (turns.length === 0) return [Math.round(total)];
  const legs = [Math.round(firstStraight + width)];
  for (let i = 0; i < middleCount; i++) legs.push(Math.round(middle + 2 * width));
  legs.push(Math.round(lastStraight + width));
  return legs;
}

/** Préréglages dont la position du premier tournant s'adapte à E (QUESTIONS D1). */
const ADAPTIVE_FIRST_TURN_PRESETS: ReadonlySet<PresetId> = new Set(["two-quarters-u", "half-turn"]);

/**
 * Pas de recherche de la position du premier tournant, en girons : résolution de la recherche
 * (pas une valeur métier ; les longueurs sont de toute façon arrondies au mm).
 */
const FIRST_TURN_SEARCH_STEP = 0.25;

/** Collet minimal (corde) des marches balancées et présence d'une rupture K3 signalée. */
function steppingScore(project: Project): { collet: number; k3: boolean } | null {
  try {
    const st = computeStepping(project, computeLayout(project));
    const winders = st.treads.filter((t) => t.kind === "winder");
    const collet = winders.length > 0 ? Math.min(...winders.map((t) => t.colletChord)) : Infinity;
    // Rupture K3 : remarque `stepping.k3NotMonotone` du découpage.
    const k3 = st.notes.some((note) => (note.key as string) === "stepping.k3NotMonotone");
    return { collet, k3 };
  } catch (e) {
    if (e instanceof LayoutError || e instanceof SteppingError) return null;
    throw e;
  }
}

/**
 * Position du premier tournant d'un U ou d'un demi-tournant **fonction de E** (QUESTIONS D1) :
 * la position du préréglage (`firstStraightGoings`, réglée pour l'emmarchement par défaut)
 * est gardée si le collet minimal y atteint `G_COLLET_MIN.min` (rules.yaml) sans rupture K3 ;
 * sinon, aucune valeur n'étant inventée, elle est **dérivée de la géométrie** : chaque position
 * de 1 giron jusqu'à l'étendue de balancement K7 (`balancing.maxBalancedExtent`, défaut
 * `MAX_BALANCED_EXTENT`), par pas de `FIRST_TURN_SEARCH_STEP` girons, est découpée comme le
 * pipeline (`computeStepping`, choix automatique du balancement) et la meilleure est retenue :
 * sans rupture K3 d'abord, puis au plus grand collet minimal (à égalité, la plus proche de la
 * position du préréglage). La volée intermédiaire (jour du préréglage) est inchangée. Le
 * collet peut rester sous le minimum si aucune position ne l'atteint (U ou demi-tournant très
 * large à certaines hauteurs) : le contrôle de conception le signale.
 */
function adaptFirstTurn(
  project: Project,
  shape: PresetShape,
  turns: readonly TurnDirection[],
  width: number,
  n: number,
  going: number,
): Project {
  const target = getRule("G_COLLET_MIN").min;
  const withLegs = (legs: readonly number[]): Project => ({
    ...project,
    stair: {
      ...project.stair,
      layout: { ...project.stair.layout, legs: legs.map((length) => ({ length })) },
    },
  });
  const current = steppingScore(project);
  if (target === null || current === null) return project;
  if (!current.k3 && current.collet >= target) return project;
  const extent = project.stair.balancing.maxBalancedExtent ?? MAX_BALANCED_EXTENT;
  let best = { project, score: current, distance: 0 };
  const better = (s: { collet: number; k3: boolean }, distance: number): boolean =>
    s.k3 !== best.score.k3
      ? !s.k3
      : s.collet > best.score.collet + 1e-9 ||
        (Math.abs(s.collet - best.score.collet) <= 1e-9 && distance < best.distance);
  for (let f = 1; f <= extent + 1e-9; f += FIRST_TURN_SEARCH_STEP) {
    if (Math.abs(f - shape.firstStraightGoings) < 1e-9) continue;
    let legs: number[];
    try {
      legs = windersLegs({ ...shape, firstStraightGoings: f }, width, turns, n, going);
    } catch (e) {
      if (e instanceof RangeError) continue;
      throw e;
    }
    const candidate = withLegs(legs);
    const score = steppingScore(candidate);
    const distance = Math.abs(f - shape.firstStraightGoings);
    if (score !== null && better(score, distance)) best = { project: candidate, score, distance };
  }
  return best.project;
}

/**
 * Quart tournant avec palier d'angle : la première volée compte `a` girons, le palier occupe
 * le carré d'angle E × E, la seconde volée compte b = n − 2 − a girons (le palier remplace
 * un giron).
 */
function landingLegs(shape: PresetShape, width: number, n: number, going: number): number[] {
  const a = shape.firstStraightGoings;
  const b = n - 2 - a;
  if (b < 1) throw new MessageRangeError(msg("project.preset.heightTooLowLanding"));
  return [Math.round(a * going + width), Math.round(b * going + width)];
}

/**
 * Trémie rectangulaire minimale (grille de 10 mm) pour que l'échappée verticale au-dessus de
 * la ligne de pente, sur la ligne de foulée, atteigne `PRESET_HEADROOM_MIN` : calculée sur le
 * tracé et les nez réels du projet. `null` si aucune trémie n'est nécessaire.
 */
export function computeOpening(project: Project, clearance: number): Rect | null {
  const layout = computeLayout(project);
  const rises = computeRises(project);
  const positions = placeNosings(project, layout, rises.riserCount);
  const zMax = project.site.floorToFloor - project.site.upperSlabThickness - PRESET_HEADROOM_MIN;
  const region = requiredOpening(
    layout,
    { s: positions.s, z: rises.z, landings: positions.landingTreads },
    zMax,
  );
  return region ? growAlongStairEdges(boundingRect(region.points), layout, clearance) : null;
}

/** Tolérance (mm) de repérage d'un bord d'escalier sur un côté de trémie (grille d'arrondi). */
const OPENING_EDGE_TOLERANCE = 10;

/**
 * Élargit les côtés de la trémie `rect` qui longent un bord de l'escalier (segment droit du
 * jour C_i ou du bord extérieur C_e, parallèle au côté et le chevauchant) : c'est là que
 * passent les garde-corps de volée, décalés vers le vide. Un côté **au nu** du bord (à moins de
 * `OPENING_EDGE_TOLERANCE`) recule de `clearance`. Avec `topUp` (corrections proposées,
 * `suggestFixes`), un côté déjà en retrait d'un bord de d < `clearance` (trémie déjà élargie,
 * par exemple par un préréglage) recule du complément, arrondi au pas supérieur de
 * `OPENING_EDGE_TOLERANCE` ; sans `topUp` (préréglages), seuls les côtés au nu bougent. Le côté de l'arrivée (nez de dalle) et le côté
 * bas de la trémie (où l'échappée redevient suffisante) ne longent aucun bord et restent en place.
 */
export function growAlongStairEdges(
  rect: Rect,
  layout: Layout,
  clearance: number,
  topUp = false,
): Rect {
  if (clearance === 0) return rect;
  const x0 = rect.x;
  const x1 = rect.x + rect.sizeX;
  const y0 = rect.y;
  const y1 = rect.y + rect.sizeY;
  const tol = OPENING_EDGE_TOLERANCE;
  const lines = [...layout.inner.segments, ...layout.outer.segments].filter(
    (seg): seg is Extract<typeof seg, { kind: "line" }> => seg.kind === "line",
  );
  const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean =>
    Math.min(Math.max(a0, a1), b1) - Math.max(Math.min(a0, a1), b0) > tol;
  /** Recul d'un côté dont le bord d'escalier est à `d` vers l'intérieur de la trémie. */
  const growth = (d: number): number => {
    if (d < -tol) return 0;
    if (d <= tol) return clearance;
    if (!topUp || d >= clearance) return 0;
    return Math.ceil((clearance - d) / tol) * tol;
  };
  /** Recul du côté x = `x` ; `inward` = +1 si l'intérieur de la trémie est vers les x croissants. */
  const alongX = (x: number, inward: 1 | -1): number =>
    Math.max(
      0,
      ...lines
        .filter((l) => Math.abs(l.a.x - l.b.x) <= tol && overlaps(l.a.y, l.b.y, y0, y1))
        .map((l) => growth(inward * ((l.a.x + l.b.x) / 2 - x))),
    );
  const alongY = (y: number, inward: 1 | -1): number =>
    Math.max(
      0,
      ...lines
        .filter((l) => Math.abs(l.a.y - l.b.y) <= tol && overlaps(l.a.x, l.b.x, x0, x1))
        .map((l) => growth(inward * ((l.a.y + l.b.y) / 2 - y))),
    );
  const left = alongX(x0, 1);
  const right = alongX(x1, -1);
  const bottom = alongY(y0, 1);
  const top = alongY(y1, -1);
  return {
    x: x0 - left,
    y: y0 - bottom,
    sizeX: rect.sizeX + left + right,
    sizeY: rect.sizeY + bottom + top,
  };
}

/** Valeur donnée par l'option ou par `patch` ; les deux à la fois doivent concorder. */
export function pick(
  label: string,
  option: number | undefined,
  patched: number | undefined,
): number | undefined {
  if (option !== undefined && patched !== undefined && option !== patched) {
    throw new MessageRangeError(
      msg("project.preset.givenTwice", {
        option: label,
        value: String(option),
        patched: String(patched),
      }),
    );
  }
  return option ?? patched;
}

/** `label` : désignation du champ en début de phrase (« La hauteur à monter »). */
export function requirePositiveInt(label: Message, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MessageRangeError(
      msg("project.preset.notPositiveInt", { label, value: String(value) }),
    );
  }
}

/** Jeu latéral de la trémie des préréglages et du recalage : entier ≥ 0 (mm). */
export function requireOpeningClearance(clearance: number): void {
  if (!Number.isInteger(clearance) || clearance < 0) {
    throw new MessageRangeError(
      msg("project.preset.invalidClearance", { clearance: String(clearance) }),
    );
  }
}

/**
 * Crée un projet complet et valide à partir d'un préréglage.
 *
 * Les volées et la trémie sont calculées à partir de H, E, de l'épaisseur du plancher haut et
 * du réglage des hauteurs (`riserCount`, `targetRise`, `targetGoing`). Chacune de ces valeurs
 * est lue dans les options, sinon dans `patch`, sinon prend sa valeur par défaut : un `patch`
 * qui modifie H ou le réglage des hauteurs reste donc cohérent. Seules les volées et la trémie
 * fournies explicitement dans `patch` remplacent le calcul.
 *
 * @throws RangeError si les options sont incohérentes (cotes non entières ou non positives,
 *   valeur donnée à la fois en option et dans `patch` avec deux valeurs différentes,
 *   E > 1 200, nombre de hauteurs hors [2 ; 60], H trop faible pour la forme).
 */
export function createProject(preset: PresetId, options: PresetOptions = {}): Project {
  if (preset === "helical") return createHelicalProject(options);
  if (
    options.outerRadius !== undefined ||
    options.coreRadius !== undefined ||
    options.openingShape !== undefined
  ) {
    throw new MessageRangeError(msg("project.preset.noHelicalOptions", { preset }));
  }
  const shape = FLIGHTS_PRESET_SHAPES[preset];
  const patch = options.patch;
  const height =
    pick("floorToFloor", options.floorToFloor, patch?.site?.floorToFloor) ?? DEFAULT_FLOOR_TO_FLOOR;
  // Tracé à volées (les préréglages n'en produisent pas d'autre) : `width` de la surcharge.
  const patchedLayout = patch?.stair?.layout as { readonly width?: number } | undefined;
  const width = pick("width", options.width, patchedLayout?.width) ?? shape.width;
  const slab =
    pick("upperSlabThickness", options.upperSlabThickness, patch?.site?.upperSlabThickness) ??
    DEFAULT_SLAB_THICKNESS;
  requirePositiveInt(msg("project.preset.field.floorToFloor"), height);
  requirePositiveInt(msg("project.preset.field.width"), width);
  requirePositiveInt(msg("project.preset.field.upperSlabThickness"), slab);
  const clearance = options.openingClearance ?? PRESET_OPENING_CLEARANCE;
  requireOpeningClearance(clearance);
  if (width > WALKLINE_MIDDLE_MAX_WIDTH) {
    throw new MessageRangeError(
      msg("project.preset.widthTooLarge", { max: String(WALKLINE_MIDDLE_MAX_WIDTH) }),
    );
  }
  const direction = options.direction;
  const hasFixedDirection =
    preset === "straight" || preset === "quarter-left" || preset === "quarter-right";
  if (direction !== undefined && hasFixedDirection) {
    throw new MessageRangeError(msg("project.preset.noDirection", { preset }));
  }
  // n et g résolus par les fonctions du tracé (`layout/resolve.ts`) : mêmes valeurs `auto`
  // (n = arrondi(H / targetRise), g = 630 − 2h) que `computeLayout` et le découpage.
  const parsedStepping = SteppingSchema.safeParse(patch?.stair?.stepping ?? {});
  if (!parsedStepping.success) {
    // Messages de zod (sans carte d'erreurs) repris tels quels : détail technique.
    throw new MessageRangeError(
      msg("project.preset.invalidStepping", {
        detail: parsedStepping.error.issues.map((i) => i.message).join(" ; "),
      }),
    );
  }
  const stepping = parsedStepping.data;
  requirePositiveInt(msg("project.preset.field.targetRise"), stepping.targetRise);
  let n: number;
  let going: number;
  try {
    const sizing = { site: { floorToFloor: height }, stair: { stepping } };
    n = resolveRiserCount(sizing);
    going = resolveTargetGoing(sizing, n);
  } catch (e) {
    if (e instanceof LayoutError) throw new MessageRangeError(e.msg, { cause: e });
    throw e;
  }
  const first = direction ?? shape.turns[0];
  const turns: TurnDirection[] = shape.alternate
    ? shape.turns.map((_, j) => (j % 2 === 0 ? first! : first === "left" ? "right" : "left"))
    : shape.turns.map((t) => direction ?? t);
  const legs =
    shape.mode === "landing"
      ? landingLegs(shape, width, n, going)
      : windersLegs(shape, width, turns, n, going);

  const input: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: options.name ?? defaultPresetName(PRESET_LABELS[preset]),
    site: {
      floorToFloor: height,
      upperSlabThickness: slab,
    },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout: {
        width,
        legs: legs.map((length) => ({ length })),
        turns: turns.map((direction) => ({
          direction,
          mode: shape.mode,
          inner: { kind: "sharp" },
        })),
      },
      treads: { nosing: PRESET_NOSING },
    },
  };
  // Copie profonde : voir `parseProject` (objets par défaut partagés par zod 4).
  const parsed = structuredClone(ProjectSchema.parse(deepMerge(input, options.patch)));
  // U et demi-tournant : position du premier tournant adaptée à E si celle du préréglage
  // laisse le collet sous G_COLLET_MIN (QUESTIONS D1).
  const project =
    shape.mode === "winders" &&
    ADAPTIVE_FIRST_TURN_PRESETS.has(preset) &&
    patch?.stair?.layout?.legs === undefined &&
    patch?.stair?.layout?.turns === undefined
      ? adaptFirstTurn(parsed, shape, turns, width, n, going)
      : parsed;
  // Trémie donnée explicitement : elle remplace le calcul.
  if (patch?.site?.opening !== undefined) return project;
  let opening: Rect | null;
  try {
    opening = computeOpening(project, clearance);
  } catch (e) {
    if (e instanceof LayoutError || e instanceof SteppingError)
      throw new MessageRangeError(e.msg, { cause: e });
    throw e;
  }
  if (opening === null) return project;
  return structuredClone(
    ProjectSchema.parse({
      ...project,
      site: { ...project.site, opening: { kind: "rect", ...opening } },
    }),
  );
}
