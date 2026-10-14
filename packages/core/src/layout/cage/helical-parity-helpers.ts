/**
 * Aides des tests de l'hélicoïdal calculé par le moteur de cage (F10, sous-lots P1 à P3) et
 * comparateur partagé (`helicalCage.test.ts`, `fromHelical.test.ts`, `parity.test.ts`,
 * `pipeline/arcWinder.test.ts`, `stepping/helicalRegularTreads.test.ts`), non exportés par le
 * paquet (comme `layout/helical-test-helpers.ts`). Le nom du fichier vient de la parité avec
 * l'ancien moteur hélicoïdal (P1, P2), retiré avec sa copie figée en P3 : les comparaisons à
 * cette référence sont devenues des instantanés figés (`helicalCage.test.ts`,
 * `fromHelical.test.ts`, `parity.test.ts`).
 *
 * ## Comparateur
 *
 * Parcours récursif des deux valeurs (référence `a`, valeur calculée `b`) :
 * - mêmes clés : un champ présent d'un seul côté est un écart (`missing` / `extra`), sauf les
 *   chemins exclus par l'appelant, dont la valeur est vérifiée à part ;
 * - tableaux de même longueur (`length`) ; chaînes, booléens, clés de `Message` égaux
 *   strictement ; paramètres de `Message` comparés récursivement par la même règle ;
 * - nombres : |a − b| ≤ 1e-6 (longueurs, coordonnées en mm) ou 1e-9 rad (angles : `sweep`,
 *   `stepAngle`, `totalAngle`, `landingAngle`, `arrivalSweep`) ; `startAngle` comparé modulo 2π
 *   (`wrapPi(a − b)`, `atan2` peut rendre −π au lieu de π pour le même arc) ; signe de zéro non
 *   distingué ; égalité exacte sur demande (`exact`) ;
 * - grandeurs discrètes égales strictement (`===`) : `riserCount`, `rises`, `index`, `number`,
 *   `tread`, `nosing`, altitudes des nez, des marches et des sous-faces (`z`, et non celle d'un
 *   point de la ligne de pente) et longueurs de tableaux.
 *
 * 1e-6 mm reprend les précédents du dépôt (moteur général contre moteur à largeur unique,
 * `free.property.test.ts` ; `helicalHeadroomBound` contre `computeHeadroom`) et reste très en
 * dessous de l'arrondi d'affichage (0,1 mm, ADR-0003) et de la flèche de discrétisation
 * (0,1 mm). Ce n'est pas une tolérance de forme : un nombre de sommets différent est un écart.
 *
 * Chaque écart est rangé sous un **chemin normalisé** (indices de tableau remplacés par `*`)
 * avec son ampleur maximale (mm ou rad ; `NaN` pour un écart de nature : clé, longueur, champ
 * manquant).
 */
import fc from "fast-check";
import { MessageError, type Message } from "@blondel/i18n";
import { wrapPi } from "../../geom2d/segment.js";
import type { HeadroomAnalysis } from "../../headroom/headroom.js";
import { circularOpening } from "../../headroom/helical.js";
import { headroomStage } from "../../headroom/test-helpers.js";
import type { Layout, Soffit, Stepping } from "../../model/derived.js";
import { ProjectSchema, type Opening, type Project } from "../../model/project.js";
import { computeStepping } from "../../stepping/stepping.js";
import { computeLayout } from "../layout.js";
import { makeHelicalProject, type HelicalShape } from "../helical-test-helpers.js";

/** Tolérance des longueurs et coordonnées (mm), voir l'en-tête. */
export const LENGTH_TOL = 1e-6;
/** Tolérance des angles (rad), voir l'en-tête. */
export const ANGLE_TOL = 1e-9;

const ANGLE_KEYS = new Set(["sweep", "stepAngle", "totalAngle", "landingAngle", "arrivalSweep"]);
const MODULO_KEYS = new Set(["startAngle"]);
const EXACT_KEYS = new Set(["riserCount", "rises", "index", "number", "tread", "nosing"]);
/** Altitudes discrètes (nez, marches, sous-faces), et non celles d'un point de la ligne de pente. */
const EXACT_PATH = /(nosings|treads|soffits)\[\*\]\.z$/;

/** Écarts : chemin normalisé → ampleur maximale (`NaN` : écart de nature). */
export type Gaps = Map<string, number>;

function record(out: Gaps, path: string, magnitude: number): void {
  const prev = out.get(path);
  if (prev === undefined) out.set(path, magnitude);
  else if (Number.isNaN(magnitude) || Number.isNaN(prev)) out.set(path, Number.NaN);
  else out.set(path, Math.max(prev, magnitude));
}

const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);

/**
 * Compare `a` (référence) et `b` (cage) ; `skip` : chemins normalisés (sans niveau) exclus ici
 * parce que vérifiés à part (ajouts de cage, champs déplacés), jamais en silence.
 */
export function compareValues(
  a: unknown,
  b: unknown,
  path: string,
  out: Gaps,
  skip: ReadonlySet<string> = new Set(),
  key = "",
  exact = false,
): void {
  if (skip.has(path)) return;
  if (typeof a === "number" && typeof b === "number") {
    // Valeur non calculée des deux côtés (modèle partiel) : identique.
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    if (exact || EXACT_KEYS.has(key) || EXACT_PATH.test(path)) {
      if (a !== b && !(a === 0 && b === 0)) record(out, path, Math.abs(a - b));
      return;
    }
    const d = MODULO_KEYS.has(key) ? Math.abs(wrapPi(a - b)) : Math.abs(a - b);
    const tol = ANGLE_KEYS.has(key) || MODULO_KEYS.has(key) ? ANGLE_TOL : LENGTH_TOL;
    if (!(d <= tol)) record(out, path, Number.isFinite(d) ? d : Number.NaN);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      record(out, `${path}.length`, Math.abs(a.length - b.length));
      return;
    }
    const inner = exact || EXACT_KEYS.has(key);
    a.forEach((x, i) => compareValues(x, b[i], `${path}[*]`, out, skip, key, inner));
    return;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    for (const k of new Set([...ka, ...kb])) {
      const p = join(path, k);
      if (skip.has(p)) continue;
      const inA = ka.includes(k);
      const inB = kb.includes(k);
      if (!inA || !inB) {
        record(out, `${p}${inA ? ":missing" : ":extra"}`, Number.NaN);
        continue;
      }
      compareValues(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        p,
        out,
        skip,
        k,
        exact,
      );
    }
    return;
  }
  if (a !== b) record(out, path, Number.NaN);
}

/** Erreur comparable : nom, clé et paramètres. */
export interface ErrorOutcome {
  readonly name: string;
  readonly msg: Message | string;
}

function errorOf(e: unknown): ErrorOutcome {
  return e instanceof MessageError
    ? { name: e.name, msg: e.msg }
    : { name: "Error", msg: String(e) };
}

/** Résultat d'un moteur, niveau par niveau ; `error` : niveau où le calcul s'arrête. */
export interface EngineRun {
  readonly layout?: Layout;
  readonly stepping?: Stepping;
  readonly soffits?: readonly Soffit[];
  readonly headroom?: HeadroomAnalysis | null;
  readonly error?: { readonly level: "N1" | "N2" | "N4"; readonly error: ErrorOutcome };
}

/**
 * Hélicoïdal par les étapes du pipeline (`buildModel`) : `computeLayout` (conversion
 * `helicalToCage` et moteur de cage d'origine `helical`, plus `Layout.helical`),
 * `computeStepping`, puis l'étape d'échappée (`headroomStage` : `cageHeadroomCeilings`, seule
 * source des sous-faces, décision F10 (10a), et `computeHeadroom`), sur le projet d'origine.
 */
export function runCage(project: Project): EngineRun {
  let layout: Layout;
  try {
    layout = computeLayout(project);
  } catch (e) {
    return { error: { level: "N1", error: errorOf(e) } };
  }
  let stepping: Stepping;
  try {
    stepping = computeStepping(project, layout);
  } catch (e) {
    return { layout, error: { level: "N2", error: errorOf(e) } };
  }
  try {
    const headroom = headroomStage(project, layout, stepping);
    return { layout, stepping, soffits: headroom?.selfCover ?? [], headroom };
  } catch (e) {
    return { layout, stepping, error: { level: "N4", error: errorOf(e) } };
  }
}

const r1 = (x: number | undefined): number | null =>
  x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Cotes N5 : projection `mainDimensions` de `pipeline/build.test.ts` restreinte au tracé, au
 * découpage et à l'échappée (mêmes arrondis r1 / r2), à comparer à l'égalité stricte.
 */
export function n5Projection(stepping: Stepping, headroom: HeadroomAnalysis | null | undefined) {
  const winders = stepping.treads.filter((t) => t.kind === "winder");
  return {
    n: stepping.riserCount,
    h: r2(stepping.rise),
    firstRise: r2(stepping.rises[0]!),
    g: r2(stepping.going),
    blondel: r2(stepping.blondel),
    run: r1(stepping.run),
    treads: stepping.treads.map((t) => t.kind[0]).join(""),
    zones: stepping.balancedZones.map((z) => `${z.from}-${z.to} ${z.method}`),
    colletsChord: winders.map((t) => r1(t.colletChord)),
    colletMin: winders.length > 0 ? r1(Math.min(...winders.map((t) => t.colletChord))) : null,
    headroom: r1(headroom?.walkline?.min),
    headroomWidth: headroom?.width
      ? { min: r1(headroom.width.min), nosing: headroom.width.nosing }
      : null,
  };
}

/** Liste triée des chemins en écart. */
export function gapPaths(gaps: Gaps): string[] {
  return [...gaps.keys()].sort();
}

/** Ampleurs lisibles, pour documenter un écart (mm, rad ou `nature`). */
export function gapSummary(gaps: Gaps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of gapPaths(gaps)) {
    const v = gaps.get(k)!;
    out[k] = Number.isNaN(v) ? "nature" : v.toExponential(2);
  }
  return out;
}

// ------------------------------------------------------------------ générateur étendu

/**
 * Générateur CONTRAINT de paramètres hélicoïdaux, dérivé de `helicalShapeArb` : sens gauche ou
 * droite ; mode `angle` (90° à 2 160°, angle par marche < 180° garanti par n) ou
 * `treadsPerTurn` (3 à 60) ; palier absent ou Λ ∈ ]0 ; 359] ; ligne de foulée DTU ou
 * `fromInner` ∈ ]0 ; E[ ; débord ∈ [0 ; min(30, r_i − 1)] ; placement quelconque ; trémie
 * absente (escalier sous les sous-faces seules).
 */
export const helicalParityShapeArb: fc.Arbitrary<HelicalShape> = fc
  .record({
    coreRadius: fc.integer({ min: 40, max: 400 }),
    width: fc.integer({ min: 400, max: 1400 }),
    core: fc.constantFrom("column" as const, "well" as const),
    direction: fc.constantFrom("left" as const, "right" as const),
    mode: fc.constantFrom("angle" as const, "treadsPerTurn" as const),
    totalAngle: fc.integer({ min: 90, max: 2160 }),
    treadsPerTurn: fc.integer({ min: 3, max: 60 }),
    startAngle: fc.integer({ min: -180, max: 180 }),
    floorToFloor: fc.integer({ min: 2200, max: 3500 }),
    riserCount: fc.integer({ min: 8, max: 24 }),
    treadThickness: fc.integer({ min: 20, max: 60 }),
    nosing: fc.integer({ min: 0, max: 30 }),
    landing: fc.option(fc.integer({ min: 1, max: 359 }), { nil: undefined }),
    fromInner: fc.option(fc.double({ min: 0.05, max: 0.95, noNaN: true }), { nil: undefined }),
    origin: fc.record({
      x: fc.integer({ min: -5000, max: 5000 }),
      y: fc.integer({ min: -5000, max: 5000 }),
    }),
    rotation: fc.integer({ min: -180, max: 180 }),
  })
  .map((r) => {
    // Angle par marche < 180° : n − 1 > Θ / 180 (n borné à 60 par le schéma).
    const minN = Math.floor(r.totalAngle / 180) + 2;
    const riserCount =
      r.mode === "angle" ? Math.min(60, Math.max(r.riserCount, minN)) : r.riserCount;
    const walklineFromInner =
      r.fromInner === undefined ? undefined : Math.max(1, Math.round(r.fromInner * r.width));
    return {
      outerRadius: r.coreRadius + r.width,
      coreRadius: r.coreRadius,
      core: r.core,
      direction: r.direction,
      ...(r.mode === "angle" ? { totalAngle: r.totalAngle } : { treadsPerTurn: r.treadsPerTurn }),
      startAngle: r.startAngle,
      floorToFloor: r.floorToFloor,
      riserCount,
      treadThickness: r.treadThickness,
      nosing: Math.min(r.nosing, r.coreRadius - 1),
      ...(r.landing !== undefined ? { landingAngle: r.landing } : {}),
      ...(walklineFromInner !== undefined && walklineFromInner < r.width
        ? { walklineFromInner }
        : {}),
      origin: r.origin,
      rotation: r.rotation,
    };
  });

/**
 * Générateur CONTRAINT de **projets** hélicoïdaux pour les propriétés du chemin de cage : un
 * tirage de `helicalParityShapeArb`, plus les réglages que la forme ne porte pas, chacun optionnel :
 * - trémie (plafond de dalle : `covered`, échappée sur la largeur) centrée sur l'axe (centre
 *   du tracé = origine du placement) : polygone inscrit dans un cercle (`circularOpening`) de
 *   rayon 0,3 à 1,3 R_e, ou rectangle de demi-côté a ∈ [0,3 ; 1,3]·R_e couvrant un demi-plan
 *   (y ≥ centre, repère du site) ;
 * - `firstRiseOffset` ∈ [−20 ; 20] mm (h ≥ 2 200 / 60 > 36 mm : première hauteur positive) ;
 * - giron cible saisi ∈ [200 ; 320] mm (sans effet attendu : remarque `targetGoingIgnored`) ;
 * - côté de Γ saisi (sans effet attendu : forcé par la conversion) ;
 * - surcharges de nez fixe et d'angle sur des indices intérieurs (non appliquées, remarque
 *   `overrideIgnored` identique attendue).
 */
export const helicalParityProjectArb: fc.Arbitrary<Project> = fc
  .record({
    shape: helicalParityShapeArb,
    opening: fc.option(
      fc.record({
        kind: fc.constantFrom("circle" as const, "rect" as const),
        scale: fc.double({ min: 0.3, max: 1.3, noNaN: true }),
      }),
      { nil: undefined, freq: 2 },
    ),
    firstRiseOffset: fc.option(fc.integer({ min: -20, max: 20 }), { nil: undefined }),
    targetGoing: fc.option(fc.integer({ min: 200, max: 320 }), { nil: undefined }),
    side: fc.option(fc.constantFrom("left" as const, "right" as const), { nil: undefined }),
    overrides: fc.option(
      fc.record({
        fixed: fc.double({ min: 0, max: 1, noNaN: true }),
        angle: fc.double({ min: 0, max: 1, noNaN: true }),
        degrees: fc.integer({ min: -15, max: 15 }),
      }),
      { nil: undefined },
    ),
  })
  .map((r) => {
    const s = r.shape;
    const c = s.origin ?? { x: 0, y: 0 };
    let opening: Opening | undefined;
    if (r.opening) {
      const size = Math.round(r.opening.scale * s.outerRadius);
      opening =
        r.opening.kind === "circle"
          ? circularOpening(c, size)
          : { kind: "rect", x: c.x - size, y: c.y, sizeX: 2 * size, sizeY: size };
    }
    const base = makeHelicalProject({
      ...s,
      ...(opening ? { opening } : {}),
      ...(r.firstRiseOffset !== undefined ? { firstRiseOffset: r.firstRiseOffset } : {}),
    });
    const n = base.stair.stepping.riserCount as number;
    // Indices intérieurs 1 … n − 2 (nez 0 et nez d'arrivée exclus).
    const inner = (u: number): number => 1 + Math.min(n - 3, Math.floor(u * (n - 2)));
    const walkline = r.side ? { ...base.stair.walkline, side: r.side } : base.stair.walkline;
    return ProjectSchema.parse({
      ...base,
      stair: {
        ...base.stair,
        walkline,
        stepping: {
          ...base.stair.stepping,
          ...(r.targetGoing !== undefined ? { targetGoing: r.targetGoing } : {}),
        },
        nosingOverrides:
          r.overrides && n >= 4
            ? [
                { kind: "fixed", index: inner(r.overrides.fixed) },
                { kind: "angle", index: inner(r.overrides.angle), angle: r.overrides.degrees },
              ]
            : [],
      },
    });
  });
