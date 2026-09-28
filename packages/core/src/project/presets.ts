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
 * Hypothèses simplificatrices : voir `preset-geometry.ts` (angle vif, ligne de foulée au milieu).
 */
import {
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  SteppingSchema,
  type Project,
  type ProjectInput,
} from "../model/project.js";
import { getRule } from "../rules/table.js";
import type { Vec2 } from "../model/primitives.js";
import {
  boundingRect,
  buildFrames,
  requiredOpeningLength,
  sampleFromArrival,
  walklineLength,
  type Rect,
  type TurnDirection,
} from "./preset-geometry.js";

export const PRESET_IDS = [
  "straight",
  "quarter-left",
  "quarter-right",
  "two-quarters-u",
  "half-turn",
  "quarter-landing",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_LABELS: Readonly<Record<PresetId, string>> = {
  straight: "Escalier droit",
  "quarter-left": "Quart tournant à gauche",
  "quarter-right": "Quart tournant à droite",
  "two-quarters-u": "Deux quarts tournants (U)",
  "half-turn": "Demi-tournant balancé",
  "quarter-landing": "Quart tournant avec palier",
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
 * « E <= 1200 => d_lf = E / 2 ») : hypothèse de la géométrie simplifiée des préréglages.
 */
const WALKLINE_MIDDLE_MAX_WIDTH = 1200;
/**
 * Débord de nez des préréglages : valeur recommandée de `DEBORD_NEZ_LOGEMENT` (10 mm), car les
 * préréglages ciblent le contexte `logement_interieur` et la valeur par défaut du modèle
 * (30 mm) y déclencherait un avertissement.
 */
const PRESET_NOSING: number = (() => {
  const r = getRule("DEBORD_NEZ_LOGEMENT").recommande;
  if (r === null) throw new Error("La règle DEBORD_NEZ_LOGEMENT n'a pas de valeur recommandée.");
  return r;
})();
/** Valeurs par défaut du réglage des hauteurs, lues dans le schéma (`targetRise` = 175). */
const STEPPING_DEFAULTS = SteppingSchema.parse({});
/** Module de la valeur `auto` de `targetGoing` : g = 630 − 2h (voir `SteppingSchema`). */
const AUTO_GOING_MODULE = 630;
/** Bornes de `riserCount` dans `SteppingSchema`. */
const RISER_COUNT_MIN = 2;
const RISER_COUNT_MAX = 60;
/** Valeurs par défaut du cahier des charges des préréglages. */
const DEFAULT_FLOOR_TO_FLOOR = 2700;
const DEFAULT_SLAB_THICKNESS = 200;

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

const SHAPES: Readonly<Record<PresetId, PresetShape>> = {
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
  "two-quarters-u": {
    width: 850,
    turns: ["left", "left"],
    mode: "winders",
    firstStraightGoings: 1,
    middleWell: 400,
  },
  "half-turn": {
    width: 800,
    turns: ["left", "left"],
    mode: "winders",
    firstStraightGoings: 1,
    middleWell: 200,
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

interface Computed {
  readonly legs: readonly number[];
  readonly opening: Rect;
}

/** Tournants balancés : longueurs de volées et trémie par la ligne de foulée. */
function computeWinders(
  shape: PresetShape,
  width: number,
  turns: readonly TurnDirection[],
  n: number,
  rise: number,
  going: number,
  slab: number,
): Computed {
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
  const legs: number[] = [];
  if (turns.length === 0) {
    legs.push(Math.round(total));
  } else {
    legs.push(Math.round(firstStraight + width));
    for (let i = 0; i < middleCount; i++) legs.push(Math.round(shape.middleWell + 2 * width));
    legs.push(Math.round(lastStraight + width));
  }
  const frames = buildFrames(width, legs, turns);
  const g = walklineLength(frames) / (n - 1);
  const needed = requiredOpeningLength(PRESET_HEADROOM_MIN, slab, g, rise);
  const points: Vec2[] = sampleFromArrival(frames, needed).flatMap((s) => [...s.section]);
  return { legs, opening: boundingRect(points) };
}

/**
 * Quart tournant avec palier d'angle : la première volée compte `a` girons, le palier occupe
 * le carré d'angle E × E, la seconde volée compte b = n − 2 − a girons (le palier remplace
 * un giron). Nez de la marche k (1 ≤ k ≤ a) à t = (k − 1)·g dans la première volée ; palier
 * (marche a + 1) à la hauteur (a + 1)·h ; nez de la marche a + 2 au bord du palier (t = E dans
 * la seconde volée). La ligne de pente est à la hauteur z(t) ; la trémie couvre toute section
 * où `H − ep − z < e_min`, dans la seconde volée, sur le palier et dans la première volée.
 */
function computeLanding(
  shape: PresetShape,
  width: number,
  turns: readonly TurnDirection[],
  n: number,
  rise: number,
  going: number,
  slab: number,
  height: number,
): Computed {
  const a = shape.firstStraightGoings;
  const b = n - 2 - a;
  if (b < 1)
    throw new RangeError("Hauteur à monter trop faible pour un quart tournant avec palier.");
  const legs = [Math.round(a * going + width), Math.round(b * going + width)];
  const frames = buildFrames(width, legs, turns);
  const [first, last] = [frames.legs[0]!, frames.legs[1]!];
  /** Altitude maximale de la ligne de pente (ou du palier) sans trémie au-dessus. */
  const zMax = height - slab - PRESET_HEADROOM_MIN;
  const points: Vec2[] = [];
  const addSpan = (leg: typeof first, t0: number, t1: number): void => {
    for (const t of [t0, t1]) {
      const left = { x: leg.start.x + leg.u.x * t, y: leg.start.y + leg.u.y * t };
      points.push(left, { x: left.x + leg.r.x * width, y: left.y + leg.r.y * width });
    }
  };
  // Seconde volée : z = (a + 2)·h + (t − E)·h/g pour t ∈ [E ; L2].
  const g2 = (last.length - width) / b;
  const t2 = Math.max(width, width + ((zMax - (a + 2) * rise) * g2) / rise);
  if (t2 < last.length) addSpan(last, t2, last.length);
  // Palier (carré d'angle) à (a + 1)·h, puis première volée : z = h + t·h/g pour t ∈ [0 ; a·g].
  if ((a + 1) * rise > zMax) {
    addSpan(last, 0, width);
    const g1 = (first.length - width) / a;
    const t1 = Math.max(0, (zMax / rise - 1) * g1);
    if (t1 < first.length - width) addSpan(first, t1, first.length - width);
  }
  return { legs, opening: boundingRect(points) };
}

/** Valeur donnée par l'option ou par `patch` ; les deux à la fois doivent concorder. */
function pick(
  label: string,
  option: number | undefined,
  patched: number | undefined,
): number | undefined {
  if (option !== undefined && patched !== undefined && option !== patched) {
    throw new RangeError(`« ${label} » est donné deux fois (option ${option}, patch ${patched}).`);
  }
  return option ?? patched;
}

function requirePositiveInt(label: string, value: number): void {
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
  const shape = SHAPES[preset];
  const patch = options.patch;
  const height =
    pick("floorToFloor", options.floorToFloor, patch?.site?.floorToFloor) ?? DEFAULT_FLOOR_TO_FLOOR;
  const width = pick("width", options.width, patch?.stair?.layout?.width) ?? shape.width;
  const slab =
    pick("upperSlabThickness", options.upperSlabThickness, patch?.site?.upperSlabThickness) ??
    DEFAULT_SLAB_THICKNESS;
  requirePositiveInt("La hauteur à monter", height);
  requirePositiveInt("L'emmarchement", width);
  requirePositiveInt("L'épaisseur du plancher haut", slab);
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
  const stepping = patch?.stair?.stepping;
  const targetRise = stepping?.targetRise ?? STEPPING_DEFAULTS.targetRise;
  requirePositiveInt("La hauteur de marche cible", targetRise);
  const n =
    typeof stepping?.riserCount === "number"
      ? stepping.riserCount
      : Math.round(height / targetRise);
  if (!Number.isInteger(n) || n < RISER_COUNT_MIN || n > RISER_COUNT_MAX) {
    throw new RangeError(
      `Nombre de hauteurs hors domaine : ${n} (attendu entre ${RISER_COUNT_MIN} et ${RISER_COUNT_MAX}).`,
    );
  }
  const rise = height / n;
  const going =
    typeof stepping?.targetGoing === "number" ? stepping.targetGoing : AUTO_GOING_MODULE - 2 * rise;
  if (!(going > 0)) {
    throw new RangeError(
      `Giron calculé non positif (${going.toFixed(1)} mm) : hauteur de marche trop grande.`,
    );
  }
  const turns: TurnDirection[] = shape.turns.map((t) => direction ?? t);
  const computed =
    shape.mode === "landing"
      ? computeLanding(shape, width, turns, n, rise, going, slab, height)
      : computeWinders(shape, width, turns, n, rise, going, slab);

  const input: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: options.name ?? PRESET_LABELS[preset],
    site: {
      floorToFloor: height,
      upperSlabThickness: slab,
      opening: { kind: "rect", ...computed.opening },
    },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout: {
        width,
        legs: computed.legs.map((length) => ({ length })),
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
  return structuredClone(ProjectSchema.parse(deepMerge(input, options.patch)));
}
