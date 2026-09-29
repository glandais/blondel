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
import { getRule } from "../rules/table.js";
import { SteppingError } from "../stepping/errors.js";
import { placeNosings } from "../stepping/positions.js";
import { computeRises } from "../stepping/rises.js";
import { createHelicalProject } from "./presetHelical.js";

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
export type FlightsPresetId = (typeof PRESET_IDS)[number];
/** Préréglages hélicoïdaux (jalon 5a, `presetHelical.ts`). */
export const HELICAL_PRESET_IDS = ["helical"] as const;
/** Tous les préréglages. */
export const ALL_PRESET_IDS = [...PRESET_IDS, ...HELICAL_PRESET_IDS] as const;
export type PresetId = (typeof ALL_PRESET_IDS)[number];

export const PRESET_LABELS: Readonly<Record<PresetId, string>> = {
  straight: "Escalier droit",
  "quarter-left": "Quart tournant à gauche",
  "quarter-right": "Quart tournant à droite",
  "two-quarters-u": "Deux quarts tournants (U)",
  "half-turn": "Demi-tournant balancé",
  "quarter-landing": "Quart tournant avec palier",
  helical: "Hélicoïdal à fût central",
};

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
 * « E <= 1200 => d_lf = E / 2 ») : hypothèse du calcul des longueurs de volées.
 */
const WALKLINE_MIDDLE_MAX_WIDTH = 1200;
/**
 * Débord de nez des préréglages : valeur recommandée de `DEBORD_NEZ_LOGEMENT` (10 mm), car les
 * préréglages ciblent le contexte `logement_interieur` et la valeur par défaut du modèle
 * (30 mm) y déclencherait un avertissement.
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
  /** Sens des tournants pour `two-quarters-u`, `half-turn`, `quarter-landing` (défaut : gauche). */
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

interface PresetShape {
  readonly width: number;
  readonly turns: readonly TurnDirection[];
  readonly mode: "winders" | "landing";
  /** Longueur droite de ligne de foulée dans la première volée, en girons. */
  readonly firstStraightGoings: number;
  /** Longueur intérieure (jour) des volées centrales, mm (volée centrale = 2E + jour). */
  readonly middleWell: number;
}

const SHAPES: Readonly<Record<FlightsPresetId, PresetShape>> = {
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
  const firstStraight = turns.length === 0 ? total : shape.firstStraightGoings * going;
  const lastStraight =
    total - firstStraight - turns.length * quarterArc - middleCount * shape.middleWell;
  if (turns.length > 0 && lastStraight < 0) {
    throw new RangeError(
      `Hauteur à monter trop faible pour ce préréglage : il manque ${Math.ceil(-lastStraight)} mm de ligne de foulée.`,
    );
  }
  if (turns.length === 0) return [Math.round(total)];
  const legs = [Math.round(firstStraight + width)];
  for (let i = 0; i < middleCount; i++) legs.push(Math.round(shape.middleWell + 2 * width));
  legs.push(Math.round(lastStraight + width));
  return legs;
}

/**
 * Quart tournant avec palier d'angle : la première volée compte `a` girons, le palier occupe
 * le carré d'angle E × E, la seconde volée compte b = n − 2 − a girons (le palier remplace
 * un giron).
 */
function landingLegs(shape: PresetShape, width: number, n: number, going: number): number[] {
  const a = shape.firstStraightGoings;
  const b = n - 2 - a;
  if (b < 1)
    throw new RangeError("Hauteur à monter trop faible pour un quart tournant avec palier.");
  return [Math.round(a * going + width), Math.round(b * going + width)];
}

/**
 * Trémie rectangulaire minimale (grille de 10 mm) pour que l'échappée verticale au-dessus de
 * la ligne de pente, sur la ligne de foulée, atteigne `PRESET_HEADROOM_MIN` : calculée sur le
 * tracé et les nez réels du projet. `null` si aucune trémie n'est nécessaire.
 */
function computeOpening(project: Project, clearance: number): Rect | null {
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
    throw new RangeError(`« ${label} » est donné deux fois (option ${option}, patch ${patched}).`);
  }
  return option ?? patched;
}

export function requirePositiveInt(label: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(
      `${label} doit être un entier strictement positif en mm (reçu : ${value}).`,
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
    throw new RangeError(
      `Le préréglage « ${preset} » n'accepte pas les options de l'hélicoïdal (rayons, trémie).`,
    );
  }
  const shape = SHAPES[preset];
  const patch = options.patch;
  const height =
    pick("floorToFloor", options.floorToFloor, patch?.site?.floorToFloor) ?? DEFAULT_FLOOR_TO_FLOOR;
  // Tracé à volées (les préréglages n'en produisent pas d'autre) : `width` de la surcharge.
  const patchedLayout = patch?.stair?.layout as { readonly width?: number } | undefined;
  const width = pick("width", options.width, patchedLayout?.width) ?? shape.width;
  const slab =
    pick("upperSlabThickness", options.upperSlabThickness, patch?.site?.upperSlabThickness) ??
    DEFAULT_SLAB_THICKNESS;
  requirePositiveInt("La hauteur à monter", height);
  requirePositiveInt("L'emmarchement", width);
  requirePositiveInt("L'épaisseur du plancher haut", slab);
  const clearance = options.openingClearance ?? PRESET_OPENING_CLEARANCE;
  if (!Number.isInteger(clearance) || clearance < 0) {
    throw new RangeError(
      `Le jeu latéral de la trémie doit être un entier positif ou nul en mm (reçu : ${clearance}).`,
    );
  }
  if (width > WALKLINE_MIDDLE_MAX_WIDTH) {
    throw new RangeError(
      `Les préréglages supposent la ligne de foulée au milieu, donc un emmarchement ≤ ${WALKLINE_MIDDLE_MAX_WIDTH} mm.`,
    );
  }
  const direction = options.direction;
  const hasFixedDirection =
    preset === "straight" || preset === "quarter-left" || preset === "quarter-right";
  if (direction !== undefined && hasFixedDirection) {
    throw new RangeError(`Le préréglage « ${preset} » n'accepte pas d'option de sens.`);
  }
  // n et g résolus par les fonctions du tracé (`layout/resolve.ts`) : mêmes valeurs `auto`
  // (n = arrondi(H / targetRise), g = 630 − 2h) que `computeLayout` et le découpage.
  const parsedStepping = SteppingSchema.safeParse(patch?.stair?.stepping ?? {});
  if (!parsedStepping.success) {
    throw new RangeError(
      `Réglage des hauteurs invalide : ${parsedStepping.error.issues.map((i) => i.message).join(" ; ")}.`,
    );
  }
  const stepping = parsedStepping.data;
  requirePositiveInt("La hauteur de marche cible", stepping.targetRise);
  let n: number;
  let going: number;
  try {
    const sizing = { site: { floorToFloor: height }, stair: { stepping } };
    n = resolveRiserCount(sizing);
    going = resolveTargetGoing(sizing, n);
  } catch (e) {
    if (e instanceof LayoutError) throw new RangeError(e.message);
    throw e;
  }
  const turns: TurnDirection[] = shape.turns.map((t) => direction ?? t);
  const legs =
    shape.mode === "landing"
      ? landingLegs(shape, width, n, going)
      : windersLegs(shape, width, turns, n, going);

  const input: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: options.name ?? PRESET_LABELS[preset],
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
  const project = structuredClone(ProjectSchema.parse(deepMerge(input, options.patch)));
  // Trémie donnée explicitement : elle remplace le calcul.
  if (patch?.site?.opening !== undefined) return project;
  let opening: Rect | null;
  try {
    opening = computeOpening(project, clearance);
  } catch (e) {
    if (e instanceof LayoutError || e instanceof SteppingError) throw new RangeError(e.message);
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
