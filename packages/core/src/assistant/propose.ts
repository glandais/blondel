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
import {
  DEFAULT_LOCALE,
  dec,
  msg,
  translatorFor,
  type Message,
  type MessageKey,
  type MessageParam,
} from "@blondel/i18n";
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
import { DEFAULT_NEWEL, expectedNewel } from "../project/newel.js";
import { applyStructureChoice } from "../project/structureChoice.js";
import { HELICAL_DEFAULT_CORE_RADIUS, createHelicalProject } from "../project/presetHelical.js";
import { errorMessageOf } from "../project/errors.js";
import { PRESET_NOSING } from "../project/presets.js";
import { SteppingError } from "../stepping/errors.js";
import { placeNosings } from "../stepping/positions.js";
import { computeRises } from "../stepping/rises.js";
import { rollableJourRadius } from "../structures/compare.js";
import {
  getStructure,
  structureAcceptsLayout,
  structureLateralThickness,
  structureRequiresNewel,
} from "../structures/index.js";
import { isDebillardeStructure } from "../stepping/stepping.js";
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
  typologyGeometry,
  turnPosition,
  walklineOffsetFor,
  withLayout,
  type FlightsShape,
  type FlightsTypology,
} from "./shapes.js";
import {
  REJECTION_LABELS,
  TURN_POSITION_LABELS,
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

// Épaisseurs hors emprise utile (CHALLENGE A3), poteau exigé et tracés admis : déclarés par
// les plugins (`StructureKind.capabilities`, dette D4), plus de liste tenue ici.

interface ResolvedIntent {
  readonly kind: string;
  readonly params: Record<string, unknown>;
  readonly inner: Mm;
  readonly outer: Mm;
  readonly note: Message;
}

/** Intention de structure résolue : plugin, paramètres et épaisseurs hors emprise utile. */
export function resolveStructureIntent(
  intent: StructureIntent | undefined,
): ResolvedIntent | { readonly error: Message } {
  const kind = intent?.kind ?? "none";
  const params = { ...(intent?.params ?? {}) };
  let deducedInner = 0;
  let deducedOuter = 0;
  let how: Message = msg("assistant.intent.how.none");
  if (kind !== "none") {
    const plugin = getStructure(kind);
    if (!plugin) return { error: msg("assistant.intent.unknownStructure", { kind }) };
    const structure = msg(plugin.labelKey);
    const lateral = structureLateralThickness(kind, params);
    if (lateral && (lateral.inner > 0 || lateral.outer > 0)) {
      deducedInner = lateral.inner;
      deducedOuter = lateral.outer;
      how =
        lateral.inner === lateral.outer
          ? msg("assistant.intent.how.symmetric", {
              structure,
              thickness: dec(lateral.inner, 0),
            })
          : msg("assistant.intent.how.asymmetric", {
              structure,
              inner: dec(lateral.inner, 0),
              outer: dec(lateral.outer, 0),
            });
    } else if (lateral) {
      how = msg("assistant.intent.how.noStringers", { structure });
    }
  }
  const inner = intent?.innerThickness ?? deducedInner;
  const outer = intent?.outerThickness ?? deducedOuter;
  for (const [key, v] of [
    ["assistant.intent.invalidInner", inner],
    ["assistant.intent.invalidOuter", outer],
  ] as const) {
    if (!(Number.isFinite(v) && v >= 0)) {
      return { error: msg(key, { value: String(v) }) };
    }
  }
  const explicit = intent?.innerThickness !== undefined || intent?.outerThickness !== undefined;
  return {
    kind,
    params,
    inner,
    outer,
    note: msg("assistant.intent.note", {
      kind: kind === "none" ? msg("assistant.intent.kindNone") : kind,
      how: explicit ? msg("assistant.intent.how.given") : how,
      inner: dec(inner, 0),
      outer: dec(outer, 0),
    }),
  };
}

/** Échec d'une variante à l'étage analytique. */
interface Failure {
  readonly reason: RejectionReason;
  readonly example: Message;
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
  readonly label: Message;
  readonly preScore: number;
  readonly grossWidth: Mm;
  readonly fit: Message;
  readonly make: () => Project;
  /** Emprise hors tout d'un hélicoïdal (disque) pour le contrôle des murs. */
  readonly disc?: { readonly center: Vec2; readonly radius: Mm };
}

/** Typologie et sens : « Quart tournant à gauche ». */
const groupLabel = (t: TypologyId, d: "left" | "right" | null): Message => {
  const typology = msg(TYPOLOGY_LABELS[t]);
  if (d === null) return typology;
  return msg(d === "left" ? "assistant.shape.left" : "assistant.shape.right", { typology });
};

/** Forme d'un candidat : typologie, sens, position du tournant. */
const shapeLabel = (
  t: TypologyId,
  d: "left" | "right" | null,
  pos: "bas" | "médian" | "haut" | null,
): Message =>
  pos
    ? msg("assistant.shape.withTurn", {
        shape: groupLabel(t, d),
        position: msg(TURN_POSITION_LABELS[pos]),
      })
    : groupLabel(t, d);

/** Liste « a ; b ; c » (clé `{first} ; {rest}`) ou « a, b, c » de messages ; `null` si vide. */
function joinMessages(parts: readonly Message[], key: MessageKey): Message | null {
  return parts.reduceRight<Message | null>(
    (rest, first) => (rest === null ? first : msg(key, { first, rest })),
    null,
  );
}

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

/** Contrôle des réglages de l'appelant : message d'erreur, ou `null`. */
function invalidOptions(input: AssistantInput): Message | null {
  const l = input.limits ?? {};
  const isInt = (v: number, min: number): boolean => Number.isInteger(v) && v >= min;
  const invalid = (name: string, value: unknown, expected: MessageKey): Message =>
    msg("assistant.options.invalid", { name, value: String(value), expected: msg(expected) });
  const checks: [string, unknown, (v: number) => boolean, MessageKey][] = [
    ["limits.maxCandidates", l.maxCandidates, (v) => isInt(v, 0), "assistant.options.intGe0"],
    ["limits.perGroupLimit", l.perGroupLimit, (v) => isInt(v, 1), "assistant.options.intGe1"],
    ["limits.perShapeLimit", l.perShapeLimit, (v) => isInt(v, 1), "assistant.options.intGe1"],
    [
      "limits.headroomMarginTarget",
      l.headroomMarginTarget,
      (v) => Number.isFinite(v) && v >= 0,
      "assistant.options.geZeroMm",
    ],
    ["limits.maxBuilds", l.maxBuilds, (v) => isInt(v, 0), "assistant.options.intGe0"],
    ["limits.timeBudgetMs", l.timeBudgetMs, (v) => v >= 0, "assistant.options.geZero"],
    [
      "limits.goingStep",
      l.goingStep,
      (v) => Number.isFinite(v) && v > 0,
      "assistant.options.gtZero",
    ],
    [
      "limits.arrivalClearance",
      l.arrivalClearance,
      (v) => Number.isFinite(v) && v >= 0,
      "assistant.options.geZeroMm",
    ],
    [
      "preferences.width",
      input.preferences?.width,
      (v) => isInt(v, 1),
      "assistant.options.positiveIntMm",
    ],
  ];
  for (const [k, v] of Object.entries(input.weights ?? {})) {
    checks.push([
      `weights.${k}`,
      v,
      (x) => Number.isFinite(x) && x >= 0,
      "assistant.options.finiteGeZero",
    ]);
  }
  for (const [name, value, ok, expected] of checks) {
    if (value === undefined) continue;
    if (typeof value !== "number" || Number.isNaN(value) || !ok(value)) {
      return invalid(name, value, expected);
    }
  }
  if (l.showAllVariants !== undefined && typeof l.showAllVariants !== "boolean") {
    return invalid("limits.showAllVariants", l.showAllVariants, "assistant.options.boolean");
  }
  const d = input.preferences?.direction;
  if (d !== undefined && d !== "left" && d !== "right") {
    return invalid("preferences.direction", d, "assistant.options.leftOrRight");
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
  // Noms des projets proposés (texte enregistré dans le projet) : langue demandée, français par défaut.
  const names = translatorFor(input.locale ?? DEFAULT_LOCALE);
  const projectName = (label: Message): string => names.t(msg("assistant.projectName", { label }));
  const diagnostics: Message[] = [];
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
    example: Message,
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
    diagnostics.push(msg("assistant.diag.none", { reason: invalid }));
    return finish([]);
  }
  const intent = resolveStructureIntent(prefs.structure);
  if ("error" in intent) {
    diagnostics.push(msg("assistant.diag.none", { reason: intent.error }));
    return finish([]);
  }
  const templateInput: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: names.t("assistant.templateName"),
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
    // Messages de zod (sans carte d'erreurs) repris tels quels : détail technique.
    diagnostics.push(
      msg("assistant.diag.none", { reason: msg("assistant.diag.invalidSite", { issues }) }),
    );
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
      msg("assistant.bounds.risers", {
        from: String(ns[0]),
        to: String(ns[ns.length - 1]),
        riseMax: dec(b.riseMax.value, 0),
        riseMaxRule: b.riseMax.ruleId,
        riseMin: dec(b.riseMin.value, 0),
        riseMinRule: b.riseMin.ruleId,
      }),
      b.goingMin
        ? msg("assistant.bounds.going", {
            value: dec(b.goingMin.value, 0),
            rule: b.goingMin.ruleId,
          })
        : null,
      b.blondelMin && b.blondelMax
        ? msg("assistant.bounds.blondel", {
            min: String(b.blondelMin.value),
            max: String(b.blondelMax.value),
            target: String(b.blondelTarget),
          })
        : null,
      b.widthMin
        ? msg("assistant.bounds.width", {
            value: dec(b.widthMin.value, 0),
            rule: b.widthMin.ruleId,
          })
        : null,
      b.headroomMin
        ? msg("assistant.bounds.headroom", {
            value: dec(b.headroomMin.value, 0),
            rule: b.headroomMin.ruleId,
          })
        : msg("assistant.bounds.noHeadroom"),
    ].filter((s): s is Message => s !== null);
    diagnostics.push(
      msg("assistant.diag.bounds", {
        bounds: joinMessages(parts, "assistant.list.semicolon")!,
      }),
    );
  }
  if (!opening) {
    diagnostics.push(msg("assistant.diag.noOpening"));
  }

  const typologies = (prefs.typologies ?? TYPOLOGY_IDS).filter((t) => TYPOLOGY_IDS.includes(t));
  const directions: ("left" | "right")[] = prefs.direction ? [prefs.direction] : ["left", "right"];
  // Jour des tournants : poteau d'angle pour les structures qui l'exigent (décision A4), poteau
  // élargi des profilés quand son côté est connu sans modèle (côté imposé ou section nommée) ;
  // sinon poteau par défaut pendant l'énumération, remplacé par le poteau élargi à la
  // construction de chaque proposition retenue (`applyStructureChoice`, décision A13).
  const expected = expectedNewel(intent.kind, intent.params);
  const inner: InnerCorner =
    expected ?? (structureRequiresNewel(intent.kind) ? DEFAULT_NEWEL : { kind: "sharp" });
  // Jours en arc (décision A17) : énumérés pour les tournants balancés quand la structure visée
  // les accepte — aucune (préréglages) ou limon débillardé, qui les exige (G7). Rayon : rayon
  // de jour roulable du débillardé (rayon intérieur mini de la rouleuse du profil d'atelier +
  // épaisseur du limon, arrondi aux 10 mm), celui de `steel-curved` par défaut sans structure ;
  // mêmes jours que ceux du comparateur (`adaptJour`).
  const debillarde = isDebillardeStructure(intent.kind);
  const arcKind = debillarde ? intent.kind : "steel-curved";
  const arcRadius =
    debillarde || intent.kind === "none"
      ? rollableJourRadius(template.workshop, arcKind, debillarde ? intent.params : {})
      : null;
  interface JourChoice {
    readonly inner: InnerCorner;
    /** Rayon du jour en arc (0 : jour vif ou poteau). */
    readonly radius: Mm;
    /** Suffixe d'identifiant. */
    readonly tag: string;
    /** Suffixe de libellé (« , jour en arc R … mm ») ou `""`. */
    readonly label: MessageParam;
  }
  const baseJour: JourChoice = { inner, radius: 0, tag: "", label: "" };
  const joursFor = (typology: FlightsTypology): readonly JourChoice[] => {
    const geo = typologyGeometry(typology);
    if (arcRadius === null || geo.turns === 0 || geo.mode === "landing") return [baseJour];
    const arc: JourChoice = {
      inner: { kind: "arc", radius: arcRadius },
      radius: arcRadius,
      tag: `-arc${arcRadius}`,
      label: msg("assistant.candidate.arcJour", { radius: String(arcRadius) }),
    };
    return debillarde ? [arc] : [baseJour, arc];
  };
  const finalize = (p: Project): Project =>
    intent.kind === "steel-profile" && !expected
      ? applyStructureChoice(p, intent.kind, p.stair.structure.params).project
      : p;

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

  /** Explication « trémie trop petite » quand aucune typologie ne passe (`null` : aucune). */
  const openingAdvice = (poly: Polygon2, all: readonly RejectionTally[]): Message | null => {
    let longest = 0;
    for (let i = 0; i < poly.length; i++) {
      longest = Math.max(longest, V.distance(poly[i]!, poly[(i + 1) % poly.length]!));
    }
    const flights = all.filter((r) => r.typology !== "helical");
    const w = prefs.width ?? baseBounds.widthMin?.value ?? 0;
    const wSource: MessageParam =
      prefs.width !== undefined
        ? msg("assistant.advice.requestedWidth")
        : (baseBounds.widthMin?.ruleId ?? msg("assistant.advice.noRule"));
    const structure = intent.inner + intent.outer;
    if (flights.length > 0 && flights.every((r) => r.reason === "placement")) {
      return msg("assistant.advice.openingTooSmall", {
        gross: dec(w + structure, 0),
        width: dec(w, 0),
        source: wSource,
        structure: dec(structure, 0),
        longest: dec(longest, 0),
      });
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
      return msg("assistant.advice.rejectedByStructure");
    }
    const head = baseBounds.headroomMin;
    if (!head || !flights.some((r) => r.reason === "headroom")) return null;
    // Longueur de trémie d'une volée droite (TREMIE_LONGUEUR : (e + ep)·g/h), au mieux sur n.
    let best: { length: number; n: number; g: number } | null = null;
    for (const n of riserCountRange(site.floorToFloor, baseBounds)) {
      const h = site.floorToFloor / n;
      const r = goingRange(h, baseBounds);
      if (!r) continue;
      const length = ((head.value + site.upperSlabThickness) * r.lo) / h;
      if (best === null || length < best.length) best = { length, n, g: r.lo };
    }
    if (!best) return null;
    // Côté assez long pour une volée droite : ce n'est pas la taille de la trémie qui manque
    // (murs, calage, forme) — ne pas l'affirmer.
    if (best.length <= longest + tol) {
      return msg("assistant.advice.noFit");
    }
    return msg("assistant.advice.headroom", {
      length: dec(best.length, 0),
      e: dec(head.value, 0),
      ep: dec(site.upperSlabThickness, 0),
      n: String(best.n),
      g: dec(best.g, 0),
      longest: dec(longest, 0),
    });
  };

  const survivors: Survivor[] = [];
  const noOpeningPlacement: Placement = {
    origin: { x: 0, y: 0 },
    rotation: 0,
    fit: msg("assistant.fit.origin"),
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
    (acc, t) => acc + (t === "straight" ? 1 : directions.length) * joursFor(t).length,
    0,
  );
  const enumerationDeadline = t0 + limits.timeBudgetMs * ASSISTANT_DEFAULTS.enumerationShare;
  const partialGroups: Message[] = [];
  let groupsLeft = groupCount;
  enumeration: for (const typology of flightTypologies) {
    const dirs = typology === "straight" ? [null] : directions;
    const bounds = boundsFor(shapeContextsOf(typology));
    const ns = riserCountRange(site.floorToFloor, bounds);
    for (const direction of dirs) {
      for (const jour of joursFor(typology)) {
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
              msg("assistant.reject.noGoing", { n: String(n), rise: dec(rise) }),
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
              reject(
                typology,
                direction,
                "layout",
                msg("assistant.reject.layoutWidth", { width: String(width), detail: e.msg }),
              );
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
                partialGroups.push(
                  msg("assistant.groupWithJour", {
                    group: groupLabel(typology, direction),
                    jour: jour.label,
                  }),
                );
                break group;
              }
              const shape: FlightsShape = {
                typology,
                direction,
                firstGoings: a,
                ...(jour.radius > 0 ? { jourRadius: jour.radius } : {}),
              };
              // Girons du visé au minimal pour lesquels la position du tournant existe : un
              // préfixe de la liste décroissante (plus le giron est petit, moins il y a de place).
              const feasible = goings.filter((g) => flightLegs(shape, width, n, g, df) !== null);
              if (feasible.length === 0) break; // positions suivantes : encore moins de place
              const prepare = (going: number): Prepared | Failure => {
                const legs = flightLegs(shape, width, n, going, df)!;
                const spec = flightsLayoutSpec(shape, width, legs, jour.inner);
                const local = withLayout(template, spec, n, noOpeningPlacement);
                let layout: Layout;
                let positions: ReturnType<typeof placeNosings>;
                try {
                  layout = computeLayout(local);
                  rises ??= computeRises(local);
                  positions = placeNosings(local, layout, n);
                } catch (e) {
                  if (e instanceof LayoutError || e instanceof SteppingError) {
                    return {
                      reason: "layout",
                      example: msg("assistant.reject.layout", {
                        n: String(n),
                        width: String(width),
                        detail: e.msg,
                      }),
                    };
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
                        ? msg("assistant.reject.misfit", {
                            width: String(width),
                            needed: dec(m.needed, 0),
                            available: dec(m.available, 0),
                          })
                        : msg("assistant.reject.noEdge", { width: String(width) }),
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
                    example: msg("assistant.reject.wall", {
                      variant: variantText(n, going, width, pl.fit),
                      wall: wall.id,
                    }),
                  };
                }
                const exit = wallCollision(
                  [st.arrival.map((p) => toWorld(p, pl))],
                  site.walls,
                  tol,
                );
                if (exit) {
                  return {
                    reason: "walls",
                    example: msg("assistant.reject.exitWall", {
                      variant: variantText(n, going, width, pl.fit),
                      wall: exit.id,
                      clearance: dec(clearance, 0),
                    }),
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
                    example: msg("assistant.reject.headroom", {
                      variant: variantText(n, going, width, pl.fit),
                      headroom: dec(hr.min, 0),
                      min: dec(bounds.headroomMin.value, 0),
                      rule: bounds.headroomMin.ruleId,
                    }),
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
                  const label = msg("assistant.candidate.flights", {
                    shape: shapeLabel(typology, direction, pos),
                    n: String(n),
                    rise: dec(rise),
                    going: String(going),
                    width: String(width),
                    jour: jour.label,
                  });
                  const signature = `${typology}-${direction ?? "none"}${jour.tag}-a${a}-n${n}-E${width}-g${going}`;
                  survivors.push({
                    id: `${signature}-${pl.key}`,
                    signature,
                    // Groupe de construction : une forme (typologie × position), un sens et un
                    // jour (les jours en arc ne concurrencent pas les jours vifs de même forme).
                    group: `${typology}|${direction}|${pos}${jour.tag}`,
                    typology,
                    direction,
                    turnPosition: pos,
                    label,
                    preScore,
                    grossWidth,
                    fit: pl.fit,
                    make: () =>
                      finalize({
                        ...withLayout(template, spec, n, placement),
                        name: projectName(label),
                      }),
                  });
                }
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
      if (!structureAcceptsLayout(intent.kind, "helical")) {
        reject(
          "helical",
          direction,
          "structure",
          msg("assistant.reject.helicalStructure", { kind: intent.kind }),
        );
        continue;
      }
      if (!opening) {
        reject("helical", direction, "placement", msg("assistant.reject.helicalNoOpening"));
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
          bounds.widthMin
            ? msg("assistant.reject.helicalTooSmallRule", {
                radius: dec(circle.radius, 0),
                width: dec(Math.max(0, width), 0),
                min: dec(wMin, 0),
                rule: bounds.widthMin.ruleId,
              })
            : msg("assistant.reject.helicalTooSmall", {
                radius: dec(circle.radius, 0),
                width: dec(Math.max(0, width), 0),
                min: dec(wMin, 0),
              }),
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
            reject(
              "helical",
              direction,
              "layout",
              msg("assistant.reject.helicalLayout", { n: String(n), detail: errorMessageOf(e) }),
            );
            continue;
          }
          throw e;
        }
        const label = msg("assistant.candidate.helical", {
          shape: groupLabel("helical", direction),
          n: String(n),
          rise: dec(site.floorToFloor / n),
          radius: String(outerRadius),
          width: String(width),
        });
        const named = { ...project, name: projectName(label) };
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
          fit: msg("assistant.fit.helical", { radius: dec(circle.radius, 0) }),
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
          msg("assistant.reject.invalidProject", {
            label: s.label,
            detail: valid.error.issues[0]?.message ?? "?",
          }),
        );
        continue;
      }
      const project = structuredClone(valid.data);
      built++;
      const model = buildModel(project, { memo: false });
      if (model.errors.length > 0) {
        reject(
          s.typology,
          s.direction,
          "generation",
          msg("assistant.reject.modelError", { label: s.label, detail: model.errors[0]! }),
        );
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
          msg("assistant.reject.blocking", {
            label: s.label,
            rules: joinMessages(
              blocking.map((r) =>
                msg("assistant.reject.blockingRule", { rule: r.ruleId, message: r.message }),
              ),
              "assistant.list.semicolon",
            )!,
          }),
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
            msg("assistant.reject.slab", {
              label: s.label,
              tread: String(t),
              ceiling: dec(ceiling, 0),
            }),
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
          reject(
            s.typology,
            s.direction,
            "walls",
            msg("assistant.reject.helicalWall", { label: s.label, wall: wall.id }),
          );
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
      reject(
        s.typology,
        s.direction,
        "budget",
        msg("assistant.reject.budget", { count: dec(rest, 0) }),
        rest,
      );
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
      diagnostics.push(msg("assistant.diag.groupAccepted", { group: name, count: dec(count, 0) }));
    } else if (reasons.length > 0) {
      const main = reasons[0]!;
      diagnostics.push(
        msg("assistant.diag.groupRejected", {
          group: name,
          reason: msg(REJECTION_LABELS[main.reason]),
          count: dec(main.count, 0),
          example: main.example,
        }),
      );
    } else {
      diagnostics.push(msg("assistant.diag.groupNone", { group: name }));
    }
  }
  if (candidates.length === 0 && accepted.length > 0) {
    // Liste vide par réglage (`maxCandidates = 0`), pas faute de solution (QUESTIONS D1).
    diagnostics.unshift(
      msg("assistant.diag.hidden", {
        count: dec(accepted.length, 0),
        max: String(limits.maxCandidates),
      }),
    );
  } else if (candidates.length === 0) {
    const advice =
      opening && !stopped && !truncated ? openingAdvice(opening, [...tallies.values()]) : null;
    diagnostics.unshift(
      advice
        ? msg("assistant.diag.noCandidateAdvice", { advice })
        : msg("assistant.diag.noCandidate"),
    );
  }
  if (stopped) diagnostics.push(msg("assistant.diag.stopped"));
  else if (truncated) {
    if (partialGroups.length > 0) {
      diagnostics.push(
        msg("assistant.diag.enumerationBudget", {
          groups: joinMessages(partialGroups, "assistant.list.comma")!,
        }),
      );
    }
    diagnostics.push(
      msg("assistant.diag.budget", { built: String(built), elapsed: dec(now() - t0, 0) }),
    );
  }
  return finish(candidates);
}

/** Début d'un exemple d'élimination : « n = 15, g = 250 mm, E = 800 mm, <calage> ». */
function variantText(n: number, going: number, width: number, fit: Message): Message {
  return msg("assistant.reject.variant", {
    n: String(n),
    going: String(going),
    width: String(width),
    fit,
  });
}

/** Contextes de forme ajoutés pour les bornes d'une typologie. */
function shapeContextsOf(t: TypologyId): string[] {
  if (t === "helical") return ["helicoidal"];
  return t === "straight" || t === "quarter-landing" ? [] : ["tournant"];
}
