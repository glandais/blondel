/**
 * Aides du test de parité hélicoïdal / cage (F10, sous-lot P1, `helicalParity.test.ts`), non
 * exportées par le paquet (comme `layout/helical-test-helpers.ts`).
 *
 * ## Comparateur
 *
 * Parcours récursif des deux valeurs (référence = moteur hélicoïdal, `a` ; cage, `b`) :
 * - mêmes clés : un champ présent d'un seul côté est un écart (`missing` / `extra`), sauf les
 *   « ajouts de cage » énumérés par l'appelant, dont la valeur est vérifiée à part ;
 * - tableaux de même longueur (`length`) ; chaînes, booléens, clés de `Message` égaux
 *   strictement ; paramètres de `Message` comparés récursivement par la même règle ;
 * - nombres : |a − b| ≤ 1e-6 (longueurs, coordonnées en mm) ou 1e-9 rad (angles : `sweep`,
 *   `stepAngle`, `totalAngle`, `landingAngle`, `arrivalSweep`) ; `startAngle` comparé modulo 2π
 *   (`wrapPi(a − b)`, `atan2` peut rendre −π au lieu de π pour le même arc) ; signe de zéro non
 *   distingué ;
 * - grandeurs discrètes égales strictement (`===`) : `riserCount`, `rises`, `index`, `number`,
 *   `tread`, `nosing`, altitudes des nez, des marches et des sous-faces (`z`, et non celle d'un
 *   point de la ligne de pente) et longueurs de tableaux.
 *
 * Pourquoi une tolérance (et non l'égalité au bit de `parity.test.ts`) : les deux moteurs
 * suivent des chemins de calcul différents par construction (centre obtenu par rotation et
 * translation du repère local, origine recalée de r_i ou de R_e, rotation diminuée de 180° à
 * droite, `deg·π/180` au lieu de `deg·DEG`, s_k = k·|Γ|/(n − 1) au lieu de r_w·k·Δθ, P_k par
 * `curvePointAt` au lieu de `helicalPoint`). 1e-6 mm reprend les précédents du dépôt (moteur
 * général contre moteur à largeur unique, `free.property.test.ts` ; `helicalHeadroomBound`
 * contre `computeHeadroom`) et reste très en dessous de l'arrondi d'affichage (0,1 mm,
 * ADR-0003) et de la flèche de discrétisation (0,1 mm). Ce n'est pas une tolérance de forme :
 * un nombre de sommets différent est un écart.
 *
 * Chaque écart est rangé sous un **chemin normalisé** (indices de tableau remplacés par `*`,
 * préfixé du niveau N0 à N5) avec son ampleur maximale (mm ou rad ; `NaN` pour un écart de
 * nature : clé, longueur, champ manquant).
 */
import fc from "fast-check";
import { MessageError, type Message } from "@blondel/i18n";
import { wrapPi } from "../../geom2d/segment.js";
import { computeHeadroom, type HeadroomAnalysis } from "../../headroom/headroom.js";
import { circularOpening } from "../../headroom/helical.js";
import { slopeProfileOf, slopeZ } from "../../headroom/profile.js";
import { curvePointAt } from "../../geom2d/curve.js";
import type { FlatPattern, HelicalLayout, Layout, Soffit, Stepping } from "../../model/derived.js";
import type { Vec2 } from "../../model/primitives.js";
import { ProjectSchema, type Opening, type Project } from "../../model/project.js";
import { computeStepping } from "../../stepping/stepping.js";
import { computeLayout } from "../layout.js";
import { legacyComputeHelicalLayout, legacyComputeHelicalStepping } from "../legacyHelical.js";
import { resolveRiserCount } from "../resolve.js";
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
 * Ancien chemin hélicoïdal (référence) : copie figée `layout/legacyHelical.ts` (tracé et
 * découpage, état d'avant la bascule P2), puis l'échappée partagée (`computeHeadroom` sur
 * `Stepping.soffits`, départage TIE commun, décision F10 (3)).
 */
export function runHelical(project: Project): EngineRun {
  if (project.stair.layout.kind !== "helical") throw new Error("projet non hélicoïdal");
  let layout: Layout;
  try {
    layout = legacyComputeHelicalLayout(project, project.stair.layout);
  } catch (e) {
    return { error: { level: "N1", error: errorOf(e) } };
  }
  let stepping: Stepping;
  try {
    stepping = legacyComputeHelicalStepping(project, layout);
  } catch (e) {
    return { layout, error: { level: "N2", error: errorOf(e) } };
  }
  try {
    const headroom = computeHeadroom(project.site, layout, stepping);
    return { layout, stepping, soffits: stepping.soffits ?? [], headroom };
  } catch (e) {
    return { layout, stepping, error: { level: "N4", error: errorOf(e) } };
  }
}

/**
 * Chemin du pipeline basculé (P2) : `computeLayout` (conversion `helicalToCage` et moteur de
 * cage d'origine `helical`, plus `Layout.helical`), `computeStepping` et `computeHeadroom` sur
 * le projet d'origine, comme les étapes de `buildModel` pour un hélicoïdal (le projet n'étant
 * pas saisi en cage, l'étape d'échappée de cage `cageHeadroomCeilings` ne s'applique pas ; les
 * sous-faces sont dans `Stepping.soffits`).
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
    const headroom = computeHeadroom(project.site, layout, stepping);
    return { layout, stepping, soffits: stepping.soffits ?? [], headroom };
  } catch (e) {
    return { layout, stepping, error: { level: "N4", error: errorOf(e) } };
  }
}

/**
 * Reconstruction du `HelicalLayout` depuis le tracé et le découpage de la cage (`Layout.helical`
 * est absent d'une cage) : centre et rayons de l'arc et des bords, angles du découpage.
 */
export function reconstructHelical(layout: Layout, n: number): HelicalLayout | undefined {
  const sec = layout.sections?.[0];
  const inner = layout.inner.segments[0];
  const outer = layout.outer.segments[0];
  const walk = layout.walkline.segments[0];
  const origin = layout.helicalOrigin;
  if (!sec?.arc || inner?.kind !== "arc" || outer?.kind !== "arc" || walk?.kind !== "arc") {
    return undefined;
  }
  if (!origin) return undefined;
  const totalAngle = Math.abs(sec.arc.sweep);
  const stepAngle = totalAngle / (n - 1);
  return {
    center: sec.arc.center,
    direction: layout.innerSide,
    core: origin.core,
    innerRadius: inner.radius,
    outerRadius: outer.radius,
    walklineRadius: walk.radius,
    startAngle: inner.startAngle,
    stepAngle,
    treadsPerTurn: (2 * Math.PI) / stepAngle,
    totalAngle,
    landingAngle: Math.abs(origin.arrivalSweep),
    ...(origin.arrivalOutline ? { landingOutline: origin.arrivalOutline } : {}),
  };
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

/** Compare les projections N5 (égalité stricte après arrondis). */
function compareN5(
  a: ReturnType<typeof n5Projection>,
  b: ReturnType<typeof n5Projection>,
  out: Gaps,
): void {
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) record(out, `N5:${k}`, Number.NaN);
  }
}

/** Champs de `Layout` propres à la cage (ajouts), vérifiés à part. */
const LAYOUT_CAGE_ADDITIONS = ["sections", "walklineSide", "helicalOrigin"];

/** Parité complète d'un projet hélicoïdal : écarts par niveau (voir l'en-tête). */
export interface ParityReport {
  readonly gaps: Gaps;
  readonly helical: EngineRun;
  readonly cage: EngineRun;
}

const prefixed = (level: string, inner: Gaps, out: Gaps): void => {
  for (const [k, v] of inner) record(out, `${level}:${k}`, v);
};

export function helicalParity(project: Project): ParityReport {
  const ref = runHelical(project);
  const cage = runCage(project);
  const gaps: Gaps = new Map();

  // Erreurs : même étage, même nom, même clé et mêmes paramètres. Une erreur de spécification
  // hélicoïdale sort du tracé (`computeLayout` : conversion pour le domaine de n, moteur de cage
  // pour les autres contrôles, `helicalChecks.ts`).
  const refLevel = ref.error?.level;
  const cageLevel = cage.error?.level;
  if (ref.error || cage.error) {
    if (refLevel !== cageLevel) {
      record(gaps, `error.level:${refLevel ?? "none"}→${cageLevel ?? "none"}`, Number.NaN);
    } else {
      const g: Gaps = new Map();
      compareValues(ref.error!.error, cage.error!.error, "", g);
      prefixed(`${refLevel}:error`, g, gaps);
    }
  }
  if (!ref.layout || !cage.layout) return { gaps, helical: ref, cage };

  // N1 : tracé, ajouts de cage, `Layout.helical` égal AU BIT (`helicalLayoutOf`), et cohérent
  // avec la géométrie de la cage (reconstruction, à la tolérance).
  const n1: Gaps = new Map();
  const h = ref.layout.helical!;
  compareValues(ref.layout, cage.layout, "", n1, new Set(["helical", ...LAYOUT_CAGE_ADDITIONS]));
  if (!cage.layout.helical) record(n1, "helical:missing", Number.NaN);
  else compareValues(h, cage.layout.helical, "helical", n1, new Set(), "", true);
  const sec = cage.layout.sections;
  const sign = h.direction === "left" ? 1 : -1;
  if (sec?.length !== 1 || sec[0]!.kind !== "arc" || !sec[0]!.arc) {
    record(n1, "sections", Number.NaN);
  } else {
    compareValues(
      { center: h.center, radius: h.innerRadius, sweep: sign * h.totalAngle },
      sec[0]!.arc,
      "sections[*].arc",
      n1,
    );
  }
  if (cage.layout.walklineSide !== h.direction) record(n1, "walklineSide", Number.NaN);
  const origin = cage.layout.helicalOrigin;
  if (!origin) record(n1, "helicalOrigin", Number.NaN);
  else {
    compareValues(
      { core: h.core, arrivalSweep: sign * h.landingAngle, arrivalOutline: h.landingOutline },
      origin,
      "helicalOrigin",
      n1,
    );
  }
  const rebuilt = reconstructHelical(cage.layout, resolveRiserCount(project));
  if (!rebuilt) record(n1, "helicalRebuilt", Number.NaN);
  else compareValues(h, rebuilt, "helicalRebuilt", n1);
  prefixed("N1", n1, gaps);

  if (!ref.stepping || !cage.stepping) return { gaps, helical: ref, cage };
  // N2 : découpage (angle des nez absent des deux côtés depuis P2) ; `soffits` présentes des
  // deux côtés, contenu comparé en N3.
  const n2: Gaps = new Map();
  compareValues(ref.stepping, cage.stepping, "", n2, new Set(["soffits"]));
  if (cage.stepping.soffits === undefined) record(n2, "soffits:missing", Number.NaN);
  prefixed("N2", n2, gaps);

  // N3 : sous-faces (contenu, ordre compris).
  if (ref.soffits && cage.soffits) {
    const n3: Gaps = new Map();
    compareValues(ref.soffits, cage.soffits, "soffits", n3);
    prefixed("N3", n3, gaps);
  }

  // N4 : échappée complète (`selfCover` absent des deux côtés : sous-faces dans le découpage).
  if (ref.headroom !== undefined && cage.headroom !== undefined) {
    const n4: Gaps = new Map();
    compareValues(ref.headroom, cage.headroom, "headroom", n4);
    prefixed("N4", n4, gaps);
    // N5 : cotes des instantanés.
    compareN5(
      n5Projection(ref.stepping, ref.headroom),
      n5Projection(cage.stepping, cage.headroom),
      gaps,
    );
  }
  return { gaps, helical: ref, cage };
}

/** Liste triée des chemins en écart (pour l'assertion `EXPECTED_GAPS`). */
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
 * Lacune TIE vérifiable : le minimum d'échappée de la cage est-il un **minimum ex æquo de la
 * référence** ? (`walkline` / `width` : `true` si l'écart d'emplacement est admissible.)
 *
 * Sur Γ : même valeur (1e-6), et le point critique de la cage est un point de la géométrie de
 * référence décalé d'un nombre entier de marches : abscisse s_b = s_a + k·g (k entier, à 1e-6
 * près : invariance de l'hélicoïde par vissage de Δθ, h, qui envoie un minimum sur un minimum),
 * point en plan sur la ligne de foulée de référence en s_b, altitude sur la ligne de pente de
 * référence en s_b (`slopeZ` à gauche, comme `selfcover.ts`). Sur la largeur : même valeur,
 * altitude du nez de référence de même indice, point sur le segment de nez de référence.
 */
export function tieOnReference(
  ref: EngineRun,
  cage: EngineRun,
): { walkline: boolean; width: boolean } {
  const a = ref.headroom;
  const b = cage.headroom;
  const st = ref.stepping;
  const layout = ref.layout;
  let walkline = false;
  let width = false;
  if (!a || !b || !st || !layout) return { walkline, width };
  if (a.walkline && b.walkline && Math.abs(a.walkline.min - b.walkline.min) <= LENGTH_TOL) {
    const k = (b.walkline.s - a.walkline.s) / st.going;
    const p = curvePointAt(layout.walkline, b.walkline.s);
    const z = slopeZ(slopeProfileOf(st), b.walkline.s, "left");
    walkline =
      Math.abs(k - Math.round(k)) <= LENGTH_TOL &&
      Math.abs(p.x - b.walkline.at.x) <= LENGTH_TOL &&
      Math.abs(p.y - b.walkline.at.y) <= LENGTH_TOL &&
      Math.abs(z - b.walkline.at.z) <= LENGTH_TOL;
  }
  if (a.width && b.width && Math.abs(a.width.min - b.width.min) <= LENGTH_TOL) {
    const nosing = st.nosings[b.width.nosing];
    if (nosing) {
      const { q, r } = nosing;
      const len = Math.hypot(r.x - q.x, r.y - q.y);
      const cross = ((r.x - q.x) * (b.width.at.y - q.y) - (r.y - q.y) * (b.width.at.x - q.x)) / len;
      const t =
        ((r.x - q.x) * (b.width.at.x - q.x) + (r.y - q.y) * (b.width.at.y - q.y)) / (len * len);
      width =
        nosing.z === b.width.at.z &&
        Math.abs(cross) <= LENGTH_TOL &&
        t >= -LENGTH_TOL / len &&
        t <= 1 + LENGTH_TOL / len;
    }
  }
  return { walkline, width };
}

/**
 * Générateur CONTRAINT de **projets** hélicoïdaux pour la propriété de parité : un tirage de
 * `helicalParityShapeArb`, plus les réglages que la forme ne porte pas, chacun optionnel :
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

/**
 * Développé tourné d'un demi-tour autour du centre de la boîte englobante de son contour
 * (symétrie centrale de chaque sommet, trou et ligne tracée, libellés inchangés ; un texte
 * tracé garde son sens de lecture, seul son milieu tourne). Sert à
 * reconnaître l'écart `ROT180` de la bascule (F10, sous-lot P2) : `minAreaRect`
 * (`structures/geom.ts`) départage, par le bruit d'arrondi, deux côtés de même largeur de
 * l'enveloppe convexe d'un gabarit de couche, qui sort alors retourné dans sa boîte.
 */
export function rotateFlat180(flat: FlatPattern): FlatPattern {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of flat.outline.outer) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const turn = (p: Vec2): Vec2 => ({ x: x0 + x1 - p.x, y: y0 + y1 - p.y });
  return {
    ...flat,
    outline: {
      outer: flat.outline.outer.map(turn),
      holes: flat.outline.holes.map((h) => h.map(turn)),
    },
    lines: flat.lines.map((l) => {
      if (l.kind !== "text") return { ...l, a: turn(l.a), b: turn(l.b) };
      // Texte tracé gardé lisible par le générateur : son milieu tourne, son sens reste.
      const m = turn({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 });
      const hx = (l.b.x - l.a.x) / 2;
      const hy = (l.b.y - l.a.y) / 2;
      return { ...l, a: { x: m.x - hx, y: m.y - hy }, b: { x: m.x + hx, y: m.y + hy } };
    }),
  };
}

/**
 * `ROT180` : `a` et `b` diffèrent tels quels, mais `b` est `a` tourné d'un demi-tour dans sa
 * boîte (`rotateFlat180`), à 1e-6 mm près, mêmes sommets dans le même ordre, mêmes lignes et
 * mêmes libellés.
 */
export function flatRotated180(a: FlatPattern, b: FlatPattern): boolean {
  const asIs: Gaps = new Map();
  compareValues(a, b, "", asIs);
  if (asIs.size === 0) return false;
  const turned: Gaps = new Map();
  compareValues(rotateFlat180(a), b, "", turned);
  return turned.size === 0;
}
