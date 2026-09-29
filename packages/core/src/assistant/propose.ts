/**
 * Assistant d'initialisation (prompt 2 §3, SPEC §2.2, CHALLENGE G8) : `proposeDesigns`.
 *
 * Énumération explicite et bornée, en deux étages :
 *
 * 1. **Étage analytique** (sans découpage ni balancement, quelques dizaines de µs par
 *    variante) : typologie × sens × position du tournant × n ∈ [⌈H/h_max⌉ ; ⌈H/h_min⌉] × E
 *    (grille bornée par les règles et par la trémie, emprise hors tout de l'intention de
 *    structure, A3) × calage sur la trémie (arrivée sur un côté, largeur hors tout contenue,
 *    calée à une extrémité, centrée ou au nu d'un mur). Pour chaque calage, le giron est cherché
 *    du giron visé (module recommandé − 2h) vers le giron minimal, par pas de 5 mm : le premier
 *    dont l'**échappée exacte sur Γ** (mêmes fonctions que le pipeline) atteint le minimum
 *    bloquant et dont l'emprise hors tout ne heurte aucun mur est retenu.
 * 2. **Étage complet** : `buildModel` sur les survivants, par groupe (typologie × sens ×
 *    position du tournant) à tour de rôle et dans l'ordre d'un pré-score, dans la limite d'un
 *    budget de constructions et de temps ; élimination des erreurs de génération, des
 *    violations bloquantes (échappée comprise) et des marches qui traversent la dalle hors
 *    trémie ; score détaillé ; déduplication (même tracé, même placement, même n).
 * 3. **Sélection diversifiée** (`select.ts`) : au plus `perShapeLimit` candidats par forme
 *    (typologie × position du tournant) dans la liste principale, les autres en variantes du
 *    meilleur de leur forme ; ou liste à plat avec `showAllVariants`.
 *
 * Fonction pure du point de vue de l'appelant (aucune mémoïsation globale : `memo: false`),
 * appelable dans un Web Worker, annulable par `shouldStop`.
 */
import { rotateCurve, translateCurve } from "../geom2d/curve.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import {
  ceilingOf,
  coveredIntervals,
  headroomOnWalkline,
  openingPolygon,
} from "../headroom/headroom.js";
import type { SlopeProfile } from "../headroom/profile.js";
import { LayoutError } from "../layout/errors.js";
import { computeLayout } from "../layout/layout.js";
import type { Layout } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type FlightsLayoutSpec,
  type InnerCorner,
  type Project,
  type ProjectInput,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { DEFAULT_NEWEL_SIZE, NEWEL_REQUIRED_STRUCTURES } from "../project/fixes.js";
import { HELICAL_DEFAULT_CORE_RADIUS, createHelicalProject } from "../project/presetHelical.js";
import { PRESET_NOSING } from "../project/presets.js";
import { fmt } from "../rules/check.js";
import { SteppingError } from "../stepping/errors.js";
import { placeNosings } from "../stepping/positions.js";
import { computeRises } from "../stepping/rises.js";
import { getStructure } from "../structures/index.js";
import {
  assistantContexts,
  enumerationBounds,
  goingRange,
  riserCountRange,
  type EnumerationBounds,
} from "./bounds.js";
import { ASSISTANT_DEFAULTS, DEFAULT_SCORE_WEIGHTS } from "./defaults.js";
import {
  arrivalFrame,
  arrivalPlacements,
  discOverlap,
  grossPieces,
  slabIntrusion,
  toWorld,
  wallCollision,
  wallPolygon,
  type Placement,
} from "./placement.js";
import { scoreModel, summarizeModel } from "./score.js";
import { selectDiverse, shapeKey } from "./select.js";
import {
  flightLegs,
  flightsLayoutSpec,
  maxFirstGoings,
  turnPosition,
  walklineOffsetFor,
  withLayout,
  type FlightsShape,
  type FlightsTypology,
} from "./shapes.js";
import {
  REJECTION_LABELS,
  TYPOLOGY_IDS,
  TYPOLOGY_LABELS,
  type AssistantInput,
  type AssistantResult,
  type DesignCandidate,
  type RejectionReason,
  type RejectionTally,
  type ScoreWeights,
  type StructureIntent,
  type TypologyId,
} from "./types.js";

/**
 * Plugins dont les limons sont **hors** de l'emmarchement utile, côté jour et côté extérieur,
 * d'épaisseur `thickness` (CHALLENGE A3 ; en-têtes de `woodHoused.ts` et `steelFlat.ts`).
 */
export const LATERAL_STRINGER_STRUCTURES: readonly string[] = ["wood-housed", "steel-flat"];

/** Structures admises pour l'hélicoïdal (plugin dédié ou aucune). */
const HELICAL_STRUCTURES: readonly string[] = ["none", "helical-core"];

interface ResolvedIntent {
  readonly kind: string;
  readonly params: Record<string, unknown>;
  readonly inner: Mm;
  readonly outer: Mm;
  readonly note: string;
}

/** Intention de structure résolue : plugin, paramètres et épaisseurs hors emprise utile. */
export function resolveStructureIntent(
  intent: StructureIntent | undefined,
): ResolvedIntent | { readonly error: string } {
  const kind = intent?.kind ?? "none";
  const params = { ...(intent?.params ?? {}) };
  let deduced = 0;
  let how = "aucune structure latérale";
  if (kind !== "none") {
    const plugin = getStructure(kind);
    if (!plugin) return { error: `Structure « ${kind} » inconnue : aucun plugin enregistré.` };
    if (LATERAL_STRINGER_STRUCTURES.includes(kind)) {
      const parsed = plugin.paramsSchema.safeParse(params);
      const t = parsed.success ? (parsed.data as { thickness?: unknown }).thickness : undefined;
      if (typeof t === "number") {
        deduced = t;
        how = `limons « ${plugin.label} » de ${fmt(t, 0)} mm hors emprise utile`;
      }
    } else {
      how = `« ${plugin.label} » : épaisseur hors emprise non déduite, 0 mm supposé`;
    }
  }
  const inner = intent?.innerThickness ?? deduced;
  const outer = intent?.outerThickness ?? deduced;
  for (const [label, v] of [
    ["côté jour", inner],
    ["côté extérieur", outer],
  ] as const) {
    if (!(Number.isFinite(v) && v >= 0)) {
      return { error: `Épaisseur hors emprise ${label} invalide (${v} mm).` };
    }
  }
  const explicit = intent?.innerThickness !== undefined || intent?.outerThickness !== undefined;
  return {
    kind,
    params,
    inner,
    outer,
    note: `Intention de structure : ${kind === "none" ? "aucune" : kind} (${explicit ? "épaisseurs données" : how}) ; emprise hors tout = E + ${fmt(inner, 0)} mm côté jour + ${fmt(outer, 0)} mm côté extérieur.`,
  };
}

/** Échec d'une variante à l'étage analytique. */
interface Failure {
  readonly reason: RejectionReason;
  readonly example: string;
}

/** Variante préparée (tracé local, calages, emprise, ligne de pente). */
interface Prepared {
  readonly spec: FlightsLayoutSpec;
  readonly layout: Layout;
  readonly placements: readonly Placement[];
  readonly pieces: readonly Polygon2[];
  /** Zone à dégager au-delà de la ligne d'arrivée (repère local). */
  readonly arrival: Polygon2;
  readonly profile: SlopeProfile;
}

/** Variante retenue par l'étage analytique, à construire. */
interface Survivor {
  readonly id: string;
  /**
   * Variante sans le calage (typologie, sens, position, n, E, g) : un seul calage est retenu
   * par signature (le premier construit sans bloquant), pour la diversité de la liste.
   */
  readonly signature: string;
  readonly group: string;
  readonly typology: TypologyId;
  readonly direction: "left" | "right" | null;
  readonly turnPosition: "bas" | "médian" | "haut" | null;
  readonly label: string;
  readonly preScore: number;
  readonly grossWidth: Mm;
  readonly fit: string;
  readonly make: () => Project;
  /** Emprise hors tout d'un hélicoïdal (disque) pour le contrôle des murs. */
  readonly disc?: { readonly center: Vec2; readonly radius: Mm };
}

const dirLabel = (d: "left" | "right" | null): string =>
  d === null ? "" : d === "left" ? " à gauche" : " à droite";

const groupLabel = (t: TypologyId, d: "left" | "right" | null): string =>
  `${TYPOLOGY_LABELS[t]}${dirLabel(d)}`;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Centre (moyenne des sommets) et rayon du plus grand disque centré en ce point contenu dans la
 * trémie (hélicoïdal) : distance aux **segments** du contour, rayon nul si le centre n'est pas
 * dans la trémie (trémie non convexe en L, par exemple).
 */
export function inscribedCircle(poly: Polygon2): { center: Vec2; radius: Mm } {
  const c = V.scale(
    poly.reduce((acc, p) => V.add(acc, p), V.ZERO),
    1 / poly.length,
  );
  if (pointInPolygon(c, poly, 0) !== "inside") return { center: c, radius: 0 };
  let r = Infinity;
  const m = poly.length;
  for (let i = 0; i < m; i++) {
    const a = poly[i]!;
    const ab = V.sub(poly[(i + 1) % m]!, a);
    const l2 = V.normSq(ab);
    const t = l2 > 0 ? Math.min(1, Math.max(0, V.dot(V.sub(c, a), ab) / l2)) : 0;
    r = Math.min(r, V.distance(c, V.addScaled(a, ab, t)));
  }
  return { center: c, radius: Number.isFinite(r) ? r : 0 };
}

/** Copie sans les clés de valeur `undefined` (fusion avec les valeurs par défaut). */
function definedOnly<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Contrôle des réglages de l'appelant : message d'erreur français, ou `null`. */
function invalidOptions(input: AssistantInput): string | null {
  const l = input.limits ?? {};
  const isInt = (v: number, min: number): boolean => Number.isInteger(v) && v >= min;
  const checks: [string, unknown, (v: number) => boolean, string][] = [
    ["limits.maxCandidates", l.maxCandidates, (v) => isInt(v, 0), "entier ≥ 0"],
    ["limits.perGroupLimit", l.perGroupLimit, (v) => isInt(v, 1), "entier ≥ 1"],
    ["limits.perShapeLimit", l.perShapeLimit, (v) => isInt(v, 1), "entier ≥ 1"],
    [
      "limits.headroomMarginTarget",
      l.headroomMarginTarget,
      (v) => Number.isFinite(v) && v >= 0,
      "≥ 0 mm",
    ],
    ["limits.maxBuilds", l.maxBuilds, (v) => isInt(v, 0), "entier ≥ 0"],
    ["limits.timeBudgetMs", l.timeBudgetMs, (v) => v >= 0, "≥ 0"],
    ["limits.goingStep", l.goingStep, (v) => Number.isFinite(v) && v > 0, "> 0"],
    ["limits.arrivalClearance", l.arrivalClearance, (v) => Number.isFinite(v) && v >= 0, "≥ 0 mm"],
    ["preferences.width", input.preferences?.width, (v) => isInt(v, 1), "entier > 0 (mm)"],
  ];
  for (const [k, v] of Object.entries(input.weights ?? {})) {
    checks.push([`weights.${k}`, v, (x) => Number.isFinite(x) && x >= 0, "fini et ≥ 0"]);
  }
  for (const [name, value, ok, expected] of checks) {
    if (value === undefined) continue;
    if (typeof value !== "number" || Number.isNaN(value) || !ok(value)) {
      return `${name} invalide (${String(value)}) : ${expected} attendu.`;
    }
  }
  if (l.showAllVariants !== undefined && typeof l.showAllVariants !== "boolean") {
    return `limits.showAllVariants invalide (${String(l.showAllVariants)}) : booléen attendu.`;
  }
  const d = input.preferences?.direction;
  if (d !== undefined && d !== "left" && d !== "right") {
    return `preferences.direction invalide (${String(d)}) : « left » ou « right » attendu.`;
  }
  return null;
}

/**
 * Propose des escaliers complets pour un site (voir l'en-tête du module). Ne lève pas pour des
 * données impossibles : le diagnostic l'explique et la liste est vide.
 */
export function proposeDesigns(input: AssistantInput): AssistantResult {
  const t0 = now();
  // Une clé présente mais `undefined` (`{ perShapeLimit: undefined }`, admis par le type) garde
  // la valeur par défaut au lieu de l'écraser (liste vide ou score NaN sinon).
  const limits = { ...ASSISTANT_DEFAULTS, ...definedOnly(input.limits) };
  const weights: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...definedOnly(input.weights) };
  const prefs = input.preferences ?? {};
  const stop = input.shouldStop ?? (() => false);
  const diagnostics: string[] = [];
  const tallies = new Map<string, RejectionTally>();
  let enumerated = 0;
  let built = 0;
  let stopped = false;
  let truncated = false;

  const finish = (candidates: DesignCandidate[]): AssistantResult => ({
    candidates,
    diagnostics,
    rejections: [...tallies.values()],
    stats: { enumerated, built, elapsedMs: now() - t0, stopped, truncated },
  });

  const reject = (
    typology: TypologyId,
    direction: "left" | "right" | null,
    reason: RejectionReason,
    example: string,
    count = 1,
  ): void => {
    const key = `${typology}|${direction}|${reason}`;
    const prev = tallies.get(key);
    tallies.set(
      key,
      prev
        ? { ...prev, count: prev.count + count }
        : { typology, direction, reason, count, example },
    );
  };

  // ------------------------------------------------------------ gabarit et intention
  const invalid = invalidOptions(input);
  if (invalid) {
    diagnostics.push(`Aucune proposition : ${invalid}`);
    return finish([]);
  }
  const intent = resolveStructureIntent(prefs.structure);
  if ("error" in intent) {
    diagnostics.push(`Aucune proposition : ${intent.error}`);
    return finish([]);
  }
  const templateInput: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: "Proposition de l'assistant",
    site: input.site,
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout: { width: 800, legs: [{ length: 1000 }], turns: [] },
      treads: { nosing: PRESET_NOSING },
      structure: { kind: intent.kind, params: intent.params },
    },
    ...(input.compliance ? { compliance: input.compliance } : {}),
    ...(input.workshop ? { workshop: input.workshop } : {}),
  };
  const parsed = ProjectSchema.safeParse(templateInput);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")} : ${i.message}` : i.message))
      .join(" ; ");
    diagnostics.push(`Aucune proposition : données du site invalides (${issues}).`);
    return finish([]);
  }
  const template: Project = structuredClone(parsed.data);
  const site = template.site;
  const settings = template.compliance;
  const opening = openingPolygon(site.opening);
  const ceiling = ceilingOf(site);
  const tol = ASSISTANT_DEFAULTS.contactTolerance;
  diagnostics.push(intent.note);

  const fallbacks = {
    riseMax: ASSISTANT_DEFAULTS.riseMaxFallback,
    riseMin: ASSISTANT_DEFAULTS.riseMinFallback,
    blondelTarget: ASSISTANT_DEFAULTS.blondelTargetFallback,
  };
  const boundsCache = new Map<string, EnumerationBounds>();
  const boundsFor = (shapeContexts: readonly string[]): EnumerationBounds => {
    const key = shapeContexts.join(",");
    let b = boundsCache.get(key);
    if (!b) {
      b = enumerationBounds(settings, assistantContexts(settings, shapeContexts), fallbacks);
      boundsCache.set(key, b);
    }
    return b;
  };
  const baseBounds = boundsFor([]);
  {
    const b = baseBounds;
    const ns = riserCountRange(site.floorToFloor, b);
    const parts = [
      `n de ${ns[0]} à ${ns[ns.length - 1]} (h_max = ${fmt(b.riseMax.value, 0)} mm, ${b.riseMax.ruleId} ; h_min = ${fmt(b.riseMin.value, 0)} mm, ${b.riseMin.ruleId})`,
      b.goingMin ? `g ≥ ${fmt(b.goingMin.value, 0)} mm (${b.goingMin.ruleId})` : null,
      b.blondelMin && b.blondelMax
        ? `2h + g entre ${b.blondelMin.value} et ${b.blondelMax.value} mm, visé ${b.blondelTarget} mm`
        : null,
      b.widthMin ? `E ≥ ${fmt(b.widthMin.value, 0)} mm (${b.widthMin.ruleId})` : null,
      b.headroomMin
        ? `échappée ≥ ${fmt(b.headroomMin.value, 0)} mm (${b.headroomMin.ruleId})`
        : "aucune échappée bloquante",
    ].filter((s): s is string => s !== null);
    diagnostics.push(`Bornes des règles actives : ${parts.join(" ; ")}.`);
  }
  if (!opening) {
    diagnostics.push(
      "Sans trémie : escaliers placés à l'origine du site, aucune contrainte d'échappée ni de calage.",
    );
  }

  const typologies = (prefs.typologies ?? TYPOLOGY_IDS).filter((t) => TYPOLOGY_IDS.includes(t));
  const directions: ("left" | "right")[] = prefs.direction ? [prefs.direction] : ["left", "right"];
  const inner: InnerCorner = NEWEL_REQUIRED_STRUCTURES.includes(intent.kind)
    ? { kind: "newel", size: DEFAULT_NEWEL_SIZE }
    : { kind: "sharp" };

  /** Grille d'emmarchement : minimum, recommandé, pas réguliers, plus grand qui tient. */
  const widthGrid = (b: EnumerationBounds): number[] => {
    if (prefs.width !== undefined) return [prefs.width];
    const lo = Math.ceil(
      b.widthMin?.value ?? b.widthRecommended ?? ASSISTANT_DEFAULTS.widthFallback,
    );
    const cap = ASSISTANT_DEFAULTS.widthMax;
    let fitMax: number = cap;
    if (opening) {
      let longest = 0;
      for (let i = 0; i < opening.length; i++) {
        longest = Math.max(longest, V.distance(opening[i]!, opening[(i + 1) % opening.length]!));
      }
      fitMax = Math.min(cap, Math.floor((longest - intent.inner - intent.outer) / 10) * 10);
    }
    const values = new Set<number>([lo]);
    if (b.widthRecommended !== null && b.widthRecommended >= lo)
      values.add(Math.ceil(b.widthRecommended));
    for (let k = 1; k <= limits.widthSteps; k++) values.add(lo + k * ASSISTANT_DEFAULTS.widthStep);
    const out = [...values].filter((w) => w <= cap && (w <= fitMax || w === lo));
    // Plus grand E qui tient dans la trémie, s'il reste dans la plage explorée.
    if (fitMax > lo && fitMax <= lo + limits.widthSteps * ASSISTANT_DEFAULTS.widthStep)
      out.push(fitMax);
    return [...new Set(out)].sort((a, b2) => a - b2);
  };

  /** Girons essayés, du visé au minimal, entiers, par pas de `goingStep`. */
  const goingGrid = (rise: number, b: EnumerationBounds): number[] | null => {
    const r = goingRange(rise, b);
    if (!r) return null;
    const lo = Math.ceil(r.lo - 1e-9);
    const hi = Math.floor(r.hi + 1e-9);
    if (lo > hi) return null;
    const start = Math.min(hi, Math.max(lo, Math.round(r.target)));
    const out: number[] = [];
    for (let g = start; g > lo; g -= limits.goingStep) out.push(g);
    out.push(lo);
    return out;
  };

  /** Explication « trémie trop petite » quand aucune typologie ne passe. */
  const openingAdvice = (poly: Polygon2, all: readonly RejectionTally[]): string => {
    let longest = 0;
    for (let i = 0; i < poly.length; i++) {
      longest = Math.max(longest, V.distance(poly[i]!, poly[(i + 1) % poly.length]!));
    }
    const flights = all.filter((r) => r.typology !== "helical");
    const w = prefs.width ?? baseBounds.widthMin?.value ?? 0;
    const wSource =
      prefs.width !== undefined
        ? "emmarchement demandé"
        : (baseBounds.widthMin?.ruleId ?? "aucune règle");
    const structure = intent.inner + intent.outer;
    if (flights.length > 0 && flights.every((r) => r.reason === "placement")) {
      return ` La trémie est trop petite : l'arrivée demande au moins ${fmt(w + structure, 0)} mm de largeur hors tout (E ≥ ${fmt(w, 0)} mm, ${wSource}, plus ${fmt(structure, 0)} mm de structure) sur un côté de trémie, plus grand côté ${fmt(longest, 0)} mm.`;
    }
    // La trémie n'est en cause que si toutes les éliminations sont géométriques : sinon la
    // structure visée ou le contrôle de conception écartent des variantes qui y tiennent.
    const geometric: readonly RejectionReason[] = [
      "bounds",
      "layout",
      "placement",
      "headroom",
      "walls",
      "slab",
    ];
    if (flights.some((r) => !geometric.includes(r.reason))) {
      return " Des variantes tiennent dans la trémie mais sont écartées par la structure visée ou par le contrôle de conception : voir le détail par typologie ci-dessous.";
    }
    const head = baseBounds.headroomMin;
    if (!head || !flights.some((r) => r.reason === "headroom")) return "";
    // Longueur de trémie d'une volée droite (TREMIE_LONGUEUR : (e + ep)·g/h), au mieux sur n.
    let best: { length: number; n: number; g: number } | null = null;
    for (const n of riserCountRange(site.floorToFloor, baseBounds)) {
      const h = site.floorToFloor / n;
      const r = goingRange(h, baseBounds);
      if (!r) continue;
      const length = ((head.value + site.upperSlabThickness) * r.lo) / h;
      if (best === null || length < best.length) best = { length, n, g: r.lo };
    }
    if (!best) return "";
    // Côté assez long pour une volée droite : ce n'est pas la taille de la trémie qui manque
    // (murs, calage, forme) — ne pas l'affirmer.
    if (best.length <= longest + tol) {
      return " Aucun calage sur la trémie ne passe à la fois l'échappée et les murs : voir le détail par typologie ci-dessous.";
    }
    return ` La trémie est trop petite pour l'échappée : une volée droite demande une trémie d'au moins ${fmt(best.length, 0)} mm de long (TREMIE_LONGUEUR, (e + ep)·g/h avec e = ${fmt(head.value, 0)} mm, ep = ${fmt(site.upperSlabThickness, 0)} mm, n = ${best.n}, g = ${fmt(best.g, 0)} mm) ; les tournants la réduisent sans suffire ici (plus grand côté ${fmt(longest, 0)} mm).`;
  };

  const survivors: Survivor[] = [];
  const noOpeningPlacement: Placement = {
    origin: { x: 0, y: 0 },
    rotation: 0,
    fit: "placé à l'origine (sans trémie)",
    key: "origin",
  };

  // ------------------------------------------------------------ étage 1 : volées
  const flightTypologies = typologies.filter((t): t is FlightsTypology => t !== "helical");
  // Budget de l'étage analytique (part `enumerationShare` du budget de temps) : un site coûteux
  // (grande hauteur, longue plage de n) ne doit pas dépasser le budget. Équité entre les groupes
  // typologie × sens, parcourus dans l'ordre : un groupe dispose au plus de
  // `enumerationGroupFactor` parts égales du temps restant, pour que les derniers ne soient pas
  // privés ; un groupe rapide laisse son temps aux suivants.
  const groupCount = flightTypologies.reduce(
    (acc, t) => acc + (t === "straight" ? 1 : directions.length),
    0,
  );
  const enumerationDeadline = t0 + limits.timeBudgetMs * ASSISTANT_DEFAULTS.enumerationShare;
  const partialGroups: string[] = [];
  let groupsLeft = groupCount;
  enumeration: for (const typology of flightTypologies) {
    const dirs = typology === "straight" ? [null] : directions;
    const bounds = boundsFor(shapeContextsOf(typology));
    const ns = riserCountRange(site.floorToFloor, bounds);
    for (const direction of dirs) {
      const start = now();
      const groupDeadline = Math.min(
        enumerationDeadline,
        start +
          (Math.max(0, enumerationDeadline - start) * ASSISTANT_DEFAULTS.enumerationGroupFactor) /
            groupsLeft,
      );
      groupsLeft--;
      group: for (const n of ns) {
        const rise = site.floorToFloor / n;
        const goings = goingGrid(rise, bounds);
        if (!goings) {
          reject(
            typology,
            direction,
            "bounds",
            `n = ${n} (h = ${fmt(rise)} mm) : aucun giron entre le minimum et le module maximal.`,
          );
          continue;
        }
        let rises: ReturnType<typeof computeRises> | null = null;
        widths: for (const width of widthGrid(bounds)) {
          const grossWidth = width + intent.inner + intent.outer;
          let df: Mm;
          try {
            df = walklineOffsetFor(template, width);
          } catch (e) {
            if (!(e instanceof LayoutError)) throw e;
            reject(typology, direction, "layout", `E = ${width} mm : ${e.message}`);
            continue;
          }
          const clearance = limits.arrivalClearance ?? width;
          const maxA = maxFirstGoings({ typology, direction, firstGoings: 0 }, n);
          for (let a = typology === "quarter-landing" ? 1 : 0; a <= maxA; a++) {
            if (stop()) {
              stopped = true;
              break enumeration;
            }
            if (now() > groupDeadline) {
              truncated = true;
              partialGroups.push(groupLabel(typology, direction));
              break group;
            }
            const shape: FlightsShape = { typology, direction, firstGoings: a };
            // Girons du visé au minimal pour lesquels la position du tournant existe : un
            // préfixe de la liste décroissante (plus le giron est petit, moins il y a de place).
            const feasible = goings.filter((g) => flightLegs(shape, width, n, g, df) !== null);
            if (feasible.length === 0) break; // positions suivantes : encore moins de place
            const prepare = (going: number): Prepared | Failure => {
              const legs = flightLegs(shape, width, n, going, df)!;
              const spec = flightsLayoutSpec(shape, width, legs, inner);
              const local = withLayout(template, spec, n, noOpeningPlacement);
              let layout: Layout;
              let positions: ReturnType<typeof placeNosings>;
              try {
                layout = computeLayout(local);
                rises ??= computeRises(local);
                positions = placeNosings(local, layout, n);
              } catch (e) {
                if (e instanceof LayoutError || e instanceof SteppingError) {
                  return { reason: "layout", example: `n = ${n}, E = ${width} mm : ${e.message}` };
                }
                throw e;
              }
              const frame = arrivalFrame(spec, layout.walklineOffset, intent.inner, intent.outer);
              let placements: Placement[] = [noOpeningPlacement];
              if (opening) {
                const res = arrivalPlacements(frame, opening, site.walls, tol);
                placements = res.placements;
                if (placements.length === 0) {
                  const m = res.misfit;
                  return {
                    reason: "placement",
                    example: m
                      ? `E = ${width} mm : largeur hors tout ${fmt(m.needed, 0)} mm pour ${fmt(m.available, 0)} mm au plus long côté de la trémie.`
                      : `E = ${width} mm : aucun côté de trémie exploitable.`,
                  };
                }
              }
              // Dégagement au-delà de l'arrivée (largeur hors tout × `clearance`).
              const beyond = V.scale(frame.dir, clearance);
              return {
                spec,
                layout,
                placements,
                arrival: [
                  frame.grossInner,
                  frame.grossOuter,
                  V.add(frame.grossOuter, beyond),
                  V.add(frame.grossInner, beyond),
                ],
                pieces: grossPieces(spec, intent.inner, intent.outer),
                profile: { s: positions.s, z: rises.z, landings: positions.landingTreads },
              };
            };
            /** Murs et échappée exacte sur Γ d'un calage : échappée (ou null) ou échec. */
            const check = (
              st: Prepared,
              pl: Placement,
              going: number,
            ): { headroom: number | null } | Failure => {
              enumerated++;
              const world = st.pieces.map((poly) => poly.map((p) => toWorld(p, pl)));
              const wall = wallCollision(world, site.walls, tol);
              if (wall) {
                return {
                  reason: "walls",
                  example: `n = ${n}, g = ${going} mm, E = ${width} mm, ${pl.fit} : l'emprise hors tout heurte le mur ${wall.id}.`,
                };
              }
              const exit = wallCollision([st.arrival.map((p) => toWorld(p, pl))], site.walls, tol);
              if (exit) {
                return {
                  reason: "walls",
                  example: `n = ${n}, g = ${going} mm, E = ${width} mm, ${pl.fit} : l'arrivée débouche sur le mur ${exit.id} (dégagement de ${fmt(clearance, 0)} mm exigé).`,
                };
              }
              if (!opening || !bounds.headroomMin) return { headroom: null };
              const walk = translateCurve(
                rotateCurve(st.layout.walkline, (pl.rotation * Math.PI) / 180),
                pl.origin,
              );
              const hr = headroomOnWalkline(
                walk,
                st.profile,
                ceiling,
                coveredIntervals(walk, opening),
              );
              if (hr && hr.min < bounds.headroomMin.value - 1e-6) {
                return {
                  reason: "headroom",
                  example: `n = ${n}, g = ${going} mm, E = ${width} mm, ${pl.fit} : échappée ${fmt(hr.min, 0)} mm < ${fmt(bounds.headroomMin.value, 0)} mm (${bounds.headroomMin.ruleId}).`,
                };
              }
              return { headroom: hr?.min ?? null };
            };
            // 1. Crible au plus petit giron : l'échappée et l'emprise y sont les plus
            //    favorables (escalier le plus court) ; un calage qui y échoue est éliminé.
            const gFloor = feasible[feasible.length - 1]!;
            const base = prepare(gFloor);
            if ("reason" in base) {
              reject(typology, direction, base.reason, base.example);
              if (base.reason === "placement") break widths; // ne dépend que de E
              continue;
            }
            const alive = new Map<string, { headroom: number | null }>();
            for (const pl of base.placements) {
              const r = check(base, pl, gFloor);
              if ("reason" in r) reject(typology, direction, r.reason, r.example);
              else alive.set(pl.key, r);
            }
            // 2. Pour chaque calage retenu, le plus grand giron (du visé vers le minimal) qui passe.
            for (const going of feasible) {
              if (alive.size === 0) break;
              const st = going === gFloor ? base : prepare(going);
              if ("reason" in st) continue;
              const pos = turnPosition(shape, width, n, going, df);
              for (const pl of st.placements) {
                const floorResult = alive.get(pl.key);
                if (!floorResult) continue;
                const r = going === gFloor ? floorResult : check(st, pl, going);
                if ("reason" in r) continue;
                alive.delete(pl.key);
                const headroom = r.headroom;
                const preScore =
                  weights.blondel * Math.abs(2 * rise + going - bounds.blondelTarget) +
                  (headroom !== null && bounds.headroomRecommended !== null
                    ? weights.headroom * Math.max(0, bounds.headroomRecommended - headroom)
                    : 0) +
                  (headroom !== null && bounds.headroomMin
                    ? weights.headroomMargin *
                      Math.max(
                        0,
                        limits.headroomMarginTarget - (headroom - bounds.headroomMin.value),
                      )
                    : 0);
                const placement = { origin: pl.origin, rotation: pl.rotation };
                const spec = st.spec;
                const label = `${TYPOLOGY_LABELS[typology]}${dirLabel(direction)}${pos ? ` (tournant ${pos})` : ""} — ${n} hauteurs de ${fmt(rise)} mm, giron ${going} mm, E ${width} mm`;
                const signature = `${typology}-${direction ?? "none"}-a${a}-n${n}-E${width}-g${going}`;
                survivors.push({
                  id: `${signature}-${pl.key}`,
                  signature,
                  // Groupe de construction : une forme (typologie × position) et un sens.
                  group: `${typology}|${direction}|${pos}`,
                  typology,
                  direction,
                  turnPosition: pos,
                  label,
                  preScore,
                  grossWidth,
                  fit: pl.fit,
                  make: () => ({
                    ...withLayout(template, spec, n, placement),
                    name: `Assistant — ${label}`,
                  }),
                });
              }
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ étage 1 : hélicoïdal
  if (!stopped && typologies.includes("helical")) {
    const bounds = boundsFor(["helicoidal"]);
    for (const direction of directions) {
      if (!HELICAL_STRUCTURES.includes(intent.kind)) {
        reject(
          "helical",
          direction,
          "structure",
          `La structure « ${intent.kind} » ne s'applique pas à un hélicoïdal (plugin « helical-core » ou aucune).`,
        );
        continue;
      }
      if (!opening) {
        reject("helical", direction, "placement", "Hélicoïdal : trémie nécessaire au calage.");
        continue;
      }
      const circle = inscribedCircle(opening);
      const outerRadius = Math.floor(circle.radius - intent.outer);
      const core = HELICAL_DEFAULT_CORE_RADIUS;
      const width = outerRadius - core;
      const wMin = bounds.widthMin?.value ?? 0;
      if (!(width >= wMin) || !(outerRadius > core)) {
        reject(
          "helical",
          direction,
          "placement",
          `Hélicoïdal : rayon inscrit dans la trémie ${fmt(circle.radius, 0)} mm, emmarchement possible ${fmt(Math.max(0, width), 0)} mm < ${fmt(wMin, 0)} mm${bounds.widthMin ? ` (${bounds.widthMin.ruleId})` : ""}.`,
        );
        continue;
      }
      const contexts = [...new Set([...settings.contexts, "helicoidal"])];
      for (const n of riserCountRange(site.floorToFloor, bounds)) {
        if (stop()) {
          stopped = true;
          break;
        }
        enumerated++;
        let project: Project;
        try {
          project = createHelicalProject({
            floorToFloor: site.floorToFloor,
            upperSlabThickness: site.upperSlabThickness,
            outerRadius,
            coreRadius: core,
            direction,
            patch: {
              site: { ...site },
              stair: {
                placement: { origin: { x: circle.center.x, y: circle.center.y }, rotation: 0 },
                stepping: { riserCount: n },
                structure: { kind: intent.kind, params: intent.params },
              },
              compliance: { ...settings, contexts },
              ...(template.workshop ? { workshop: template.workshop } : {}),
            },
          });
        } catch (e) {
          if (e instanceof RangeError) {
            reject("helical", direction, "layout", `n = ${n} : ${e.message}`);
            continue;
          }
          throw e;
        }
        const label = `${TYPOLOGY_LABELS.helical}${dirLabel(direction)} — ${n} hauteurs de ${fmt(site.floorToFloor / n)} mm, R ${outerRadius} mm, E ${width} mm`;
        const named = { ...project, name: `Assistant — ${label}` };
        survivors.push({
          id: `helical-${direction}-n${n}-R${outerRadius}`,
          signature: `helical-${direction}-n${n}-R${outerRadius}`,
          group: `helical|${direction}`,
          typology: "helical",
          direction,
          turnPosition: null,
          label,
          preScore: 0,
          grossWidth: width + intent.inner + intent.outer,
          fit: `axe au centre de la trémie (rayon inscrit ${fmt(circle.radius, 0)} mm)`,
          make: () => named,
          disc: { center: circle.center, radius: outerRadius + intent.outer },
        });
      }
    }
  }

  // ------------------------------------------------------------ étage 2 : modèles complets
  const groups = new Map<string, Survivor[]>();
  for (const s of survivors) {
    const list = groups.get(s.group) ?? [];
    list.push(s);
    groups.set(s.group, list);
  }
  for (const list of groups.values()) {
    list.sort((x, y) => x.preScore - y.preScore || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }
  const accepted: DesignCandidate[] = [];
  const acceptedPerGroup = new Map<string, number>();
  const seen = new Set<string>();
  const acceptedSignatures = new Set<string>();
  const cursor = new Map<string, number>();
  const order = [...groups.keys()];
  let active = order.filter((g) => groups.get(g)!.length > 0);
  build: while (active.length > 0) {
    const next: string[] = [];
    for (const g of active) {
      if (stop()) {
        stopped = true;
        break build;
      }
      const list = groups.get(g)!;
      const i = cursor.get(g) ?? 0;
      if (i >= list.length || (acceptedPerGroup.get(g) ?? 0) >= limits.perGroupLimit) continue;
      cursor.set(g, i + 1);
      if (i + 1 < list.length) next.push(g);
      const s = list[i]!;
      if (acceptedSignatures.has(s.signature)) continue;
      const raw = s.make();
      const key = JSON.stringify([
        raw.stair.layout,
        raw.stair.placement,
        raw.stair.stepping.riserCount,
      ]);
      if (seen.has(key)) continue;
      // Budget contrôlé seulement avant une construction effective : un groupe épuisé ou
      // complet ne déclenche pas de « budget atteint ».
      if (built >= limits.maxBuilds || now() - t0 > limits.timeBudgetMs) {
        truncated = true;
        cursor.set(g, i);
        break build;
      }
      seen.add(key);
      const valid = ProjectSchema.safeParse(raw);
      if (!valid.success) {
        reject(
          s.typology,
          s.direction,
          "generation",
          `${s.label} : projet invalide (${valid.error.issues[0]?.message ?? "?"}).`,
        );
        continue;
      }
      const project = structuredClone(valid.data);
      built++;
      const model = buildModel(project, { memo: false });
      if (model.errors.length > 0) {
        reject(s.typology, s.direction, "generation", `${s.label} : ${model.errors[0]}`);
        continue;
      }
      const blocking = model.compliance.results.filter(
        (r) => r.status === "violation" && r.severity === "bloquant",
      );
      if (blocking.length > 0) {
        const onlyHeadroom = blocking.every((r) => r.ruleId.startsWith("ECHAPPEE_"));
        reject(
          s.typology,
          s.direction,
          onlyHeadroom ? "headroom" : "blocking",
          `${s.label} : ${blocking.map((r) => `${r.ruleId} (${r.message})`).join(" ; ")}`,
        );
        continue;
      }
      if (opening) {
        const t = slabIntrusion(model, opening, ceiling, intent.inner, intent.outer, tol);
        if (t !== null) {
          reject(
            s.typology,
            s.direction,
            "slab",
            `${s.label} : la marche ${t} dépasse la sous-face de la dalle (${fmt(ceiling, 0)} mm) hors trémie.`,
          );
          continue;
        }
      }
      if (s.disc) {
        const disc = s.disc;
        const wall = site.walls.find((w) =>
          discOverlap(disc.center, disc.radius, wallPolygon(w), tol),
        );
        if (wall) {
          reject(s.typology, s.direction, "walls", `${s.label} : heurte le mur ${wall.id}.`);
          continue;
        }
      }
      const bounds = boundsFor(shapeContextsOf(s.typology));
      const summary = summarizeModel(project, model, bounds, s.grossWidth, s.fit);
      const score = scoreModel(model, summary, bounds, weights, limits.headroomMarginTarget);
      accepted.push({
        id: s.id,
        typology: s.typology,
        direction: s.direction,
        turnPosition: s.turnPosition,
        label: s.label,
        project,
        summary,
        score,
        shape: shapeKey(s.typology, s.turnPosition),
        variants: [],
      });
      acceptedPerGroup.set(g, (acceptedPerGroup.get(g) ?? 0) + 1);
      acceptedSignatures.add(s.signature);
    }
    active = next;
  }
  // Survivants non construits (budget ou arrêt).
  for (const [g, list] of groups) {
    const done = (acceptedPerGroup.get(g) ?? 0) >= limits.perGroupLimit;
    const rest = list.length - (cursor.get(g) ?? 0);
    if (rest > 0 && !done && (truncated || stopped)) {
      const s = list[0]!;
      reject(s.typology, s.direction, "budget", `${rest} variante(s) non construite(s).`, rest);
    }
  }

  const candidates = selectDiverse(accepted, limits);

  // ------------------------------------------------------------ diagnostic
  const explored = new Set<string>();
  for (const t of typologies) {
    const dirs = t === "straight" ? [null] : directions;
    for (const d of dirs) explored.add(`${t}|${d}`);
  }
  for (const key of explored) {
    const [t, d] = key.split("|") as [TypologyId, string];
    const direction = d === "null" ? null : (d as "left" | "right");
    const count = accepted.filter((c) => c.typology === t && c.direction === direction).length;
    // Motif principal : celui des variantes allées le plus loin. Une élimination au modèle
    // complet (génération, bloquant, dalle, structure) concerne des variantes qui passaient le
    // crible géométrique : elle explique mieux l'échec que les milliers de calages écartés
    // avant (la structure débillardée sur jour vif, par exemple, pas l'échappée).
    const late: readonly RejectionReason[] = ["generation", "blocking", "slab", "structure"];
    const rank = (r: RejectionTally): number => (late.includes(r.reason) ? 0 : 1);
    const reasons = [...tallies.values()]
      .filter((r) => r.typology === t && r.direction === direction && r.reason !== "budget")
      .sort((x, y) => rank(x) - rank(y) || y.count - x.count);
    const name = groupLabel(t, direction);
    if (count > 0) {
      diagnostics.push(`${name} : ${count} proposition(s) sans bloquant.`);
    } else if (reasons.length > 0) {
      const main = reasons[0]!;
      diagnostics.push(
        `${name} : rejeté — ${REJECTION_LABELS[main.reason]} (${main.count} variante(s) ; ex. ${main.example})`,
      );
    } else {
      diagnostics.push(`${name} : aucune variante retenue.`);
    }
  }
  if (candidates.length === 0 && accepted.length > 0) {
    // Liste vide par réglage (`maxCandidates = 0`), pas faute de solution (QUESTIONS D1).
    diagnostics.unshift(
      `Liste vide : ${accepted.length} proposition(s) sans bloquant trouvée(s) mais non affichée(s) (nombre maximal de propositions réglé à ${limits.maxCandidates}).`,
    );
  } else if (candidates.length === 0) {
    diagnostics.unshift(
      `Aucune proposition sans bloquant pour ce site.${
        opening && !stopped && !truncated ? openingAdvice(opening, [...tallies.values()]) : ""
      }`,
    );
  }
  if (stopped) diagnostics.push("Recherche interrompue : résultat partiel.");
  else if (truncated) {
    if (partialGroups.length > 0) {
      diagnostics.push(
        `Budget de temps de l'énumération atteint : exploration partielle de ${partialGroups.join(", ")}.`,
      );
    }
    diagnostics.push(
      `Budget atteint (${built} modèles construits, ${fmt(now() - t0, 0)} ms) : variantes restantes non évaluées.`,
    );
  }
  return finish(candidates);
}

/** Contextes de forme ajoutés pour les bornes d'une typologie. */
function shapeContextsOf(t: TypologyId): string[] {
  if (t === "helical") return ["helicoidal"];
  return t === "straight" || t === "quarter-landing" ? [] : ["tournant"];
}
