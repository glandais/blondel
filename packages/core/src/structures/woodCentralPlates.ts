/**
 * Platines à âme noyée du limon central bois (`wood-central`, QUESTIONS A33 (f), A34 (c),
 * décisions du 2026-10-09 ; C §1.11 [80], [71]) : ancrage `anchors.kind` = `embeddedPlate`
 * (défaut sur une poutre cintrée, `resolveAnchorKind`), à côté du sabot en U
 * (`woodCentralShoes.ts`, défaut sur une poutre droite).
 *
 * Contrat partagé (squelette posé par l'architecte de la vague « suites du limon central ») :
 * même entrée que les sabots (`WoodCentralShoesInput`, géométrie de la poutre
 * `ShoeBeamGeometry`) ; la poutre (`woodCentralBeam.ts`) appelle
 * `buildWoodCentralEmbeddedPlates` à la place de `buildWoodCentralShoes` et :
 * - coupe la poutre de niveau sur le dessus de la platine de pied (z = `anchors.plate.thickness`)
 *   et d'aplomb en tête à `trimmerSigma − anchors.plate.thickness − wood.clearance` ;
 * - reporte sur son développé les perçages des broches (`beamHoles`, horizontaux, au travers
 *   des faces : vrais trous du développé, comme ceux des boulons de sabot) et le **trait de
 *   scie** de chaque âme (`beamKerfs`, rectangle tracé en lignes de traçage) ;
 * - écarte ses boulons et tire-fonds de marche des broches (entraxe a1 au moins) ;
 * - transmet `welded` au plugin (classe d'exécution : âme soudée en T sur la platine).
 *
 * Convention Blondel **à valider** (dimensions de `anchors.plate`, aucune source escalier ;
 * principe et ordre de grandeur d'un pied de poteau à âme du commerce, C §1.11 [80]) :
 * - **Pied** (`PP1` platine, `AP1` âme) : platine d'appui posée au sol sous la poutre, le long
 *   de la trace depuis la face avant de la poutre, largeur `anchors.plate.width` (`auto` : b +
 *   4 × `anchors.holeEdgeDistance`), chevillée au sol (`anchors.anchors` chevilles de perçage
 *   `anchors.anchorHoleDiameter`, de part et d'autre de la poutre, fixation `plateFloor`) ;
 *   âme verticale dans le plan médian de la poutre, soudée sur la platine, noyée vers le haut
 *   dans un trait de scie de la sous-face (épaisseur `webThickness` + 2 × `wood.clearance`).
 *   **Âme prolongée** (QUESTIONS A35 (a), décision du 2026-10-09) : l'âme finit au bout de la
 *   coupe au sol (moins le jeu c) et s'étend vers l'avant sur `anchors.plate.footWebLength`
 *   (`auto` : la plus longue âme plane dont la flèche + le demi-trait reste à b/2 − a4,c des
 *   faces) ; son dessus suit les assises **en escalier** : webTop(σ) = min(tp + `webDepth`,
 *   dessus de la poutre − max(`wood.minCheek`, `seatClearance`) − c), le dessus de la poutre
 *   étant pris au plus bas sur [σ − c ; σ + c] pour que le trait de scie (âme épaissie de c)
 *   reste sous chaque assise ; les bouts plus bas que deux pinces de perçage sont retirés (sous
 *   la première marche, la place est laissée à ses tire-fonds). La platine couvre l'âme
 *   (longueur min(coupe au sol, max(`anchors.length`, âme + jeu))). **Repli** : si aucune âme
 *   ainsi prolongée ne tient, âme de `webLength` × `webDepth` centrée sur la platine de
 *   `anchors.length` sous la première marche (comportement antérieur, remarque
 *   `plateWebReduced`).
 * - **Tête** (`PT1` platine, `AT1` âme) : platine verticale contre le chevêtre, de hauteur
 *   `anchors.length` depuis le dessous de la poutre à sa coupe de tête, fixée au chevêtre
 *   (`plateTrimmer`) ; âme dans le plan médian, noyée le long de la trace dans un trait de scie
 *   de la coupe de tête (`webDepth` le long de la trace, `webLength` en hauteur).
 * - **Broches** (`anchors.plate.pins`, Ø `pinDiameter`, perçage `pinHoleDiameter` dans l'âme)
 *   horizontales au travers des faces de la poutre et de l'âme, placées selon les entraxes et
 *   pinces des broches de l'EC5 (`ec5Spacing("dowel", d)`, C §1.11 [71]) ; fixation
 *   `embeddedPlatePinned` déclarée sur l'âme (`with` = la poutre, longueur = b).
 *   Pince d'extrémité selon la convention de gravité (QUESTIONS A35 (e), **à valider**,
 *   `woodSpacing.ts`) et la filière (A35 (b)) : au **pied**, depuis la coupe au sol, extrémité
 *   non chargée a3,c (massif, couches droites, cintrage sur moule : fil le long de la poutre)
 *   ou rive a4,t (couches empilées : fil horizontal parallèle à la coupe), `footPinFloorDistance` ;
 *   en **tête**, depuis la coupe d'aplomb, extrémité chargée a3,t. Au pied, une rangée
 *   horizontale dont la hauteur est balayée au pas de 1 mm pour donner le plus long intervalle
 *   admissible, de préférence là où un tire-fond arrêté au-dessus d'une broche (jeu
 *   géométrique, `lagHoleClearance`, à valider) garde sous chaque assise son ancrage : en
 *   pratique sous les marches 2 et 3, où la poutre est haute.
 * - Sur une poutre cintrée, l'âme reste plane (corde) : sa flèche dans la poutre est contrôlée
 *   (l'âme et le trait de scie restent dans le bois, à la pince a4 des faces).
 *
 * `buildWoodCentralEmbeddedPlates` ne lève jamais : erreurs dans `errors`.
 */
import { dec, errorMessage, msg, textMessage, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, Part, PartFixing } from "../model/derived.js";
import type { PartAssembly } from "../model/plugins.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import { sourceSpec } from "../rules/sources.js";
import type { Finding } from "../rules/types.js";
import type { CentralTrace } from "./centralTrace.js";
import { pluginRuleDef, type PluginRuleSpec } from "./checks.js";
import { minAreaRect, pointSegmentDistance } from "./geom.js";
import {
  STEEL_RULES,
  holePolygon,
  plateMeasures,
  steelMaterial,
  steelQuantities,
} from "./steelCommon.js";
import { resolveCurvedMethod, WoodCentralParamsSchema } from "./woodCentralParams.js";
import {
  ec5Spacing,
  footPinFloorDistance,
  lagHoleClearance,
  type WoodGrainMethod,
} from "./woodSpacing.js";
import { spread, type ShoeBeamHole, type WoodCentralShoesInput } from "./woodCentralShoes.js";

/**
 * Contrôles de fabrication des platines à âme noyée (hors rules.yaml) ; titres et descriptions :
 * `rules.<id>.title` / `rules.<id>.description`. Repris dans `WOOD_CENTRAL_BEAM_RULES`
 * (`rules/messages.test.ts`). Nom **figé**.
 */
export const WOOD_CENTRAL_PLATE_RULES = {
  /**
   * Platine et âme logées : platine sous la coupe au sol (pied) ou dans la hauteur de la coupe
   * de tête, âme et trait de scie dans le bois (profondeur, flèche de l'âme plane dans une
   * poutre cintrée, pince a4 des faces), broches aux entraxes et pinces de l'EC5 (C §1.11 [71]).
   */
  plateFit: {
    id: "FAB_PLATINE_AME_NOYEE",
    ...sourceSpec(msg("compliance.source.woodCentralPlateFit")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

/** Identifiants et repères des platines et de leurs âmes (contrat de la vague). */
export const WOOD_CENTRAL_PLATE_FOOT_ID = "wood-central-plate-foot";
export const WOOD_CENTRAL_PLATE_FOOT_WEB_ID = "wood-central-plate-foot-web";
export const WOOD_CENTRAL_PLATE_HEAD_ID = "wood-central-plate-head";
export const WOOD_CENTRAL_PLATE_HEAD_WEB_ID = "wood-central-plate-head-web";
export const WOOD_CENTRAL_PLATE_FOOT_MARK = "PP1";
export const WOOD_CENTRAL_PLATE_FOOT_WEB_MARK = "AP1";
export const WOOD_CENTRAL_PLATE_HEAD_MARK = "PT1";
export const WOOD_CENTRAL_PLATE_HEAD_WEB_MARK = "AT1";

/**
 * Trait de scie d'une âme dans la poutre (développement à l'axe) : rectangle [σ0 ; σ1] ×
 * [z0 ; z1] dans le plan médian, de largeur `width` perpendiculairement aux faces.
 */
export interface BeamKerf {
  /** Repère de l'âme logée. */
  readonly mark: string;
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  readonly z0: Mm;
  readonly z1: Mm;
  /** Largeur du trait de scie (âme + 2 × jeu), mm. */
  readonly width: Mm;
  /**
   * Contour exact du trait de scie dans le plan médian (développement à l'axe, points (σ, z),
   * sens trigonométrique) quand il n'est pas le rectangle [σ0 ; σ1] × [z0 ; z1] : âme de pied
   * prolongée dont le dessus suit les assises en escalier (QUESTIONS A35 (a)). Le rectangle
   * reste son enveloppe. La poutre trace ce contour et lit au-dessus d'un organe vertical le
   * haut du trait à son abscisse (obstacle d'ancrage).
   */
  readonly outline?: readonly Vec2[];
}

export interface WoodCentralPlatesResult {
  /** Platines et âmes (catégorie `fixing`). */
  readonly parts: readonly Part[];
  /** Perçages des broches au travers de la poutre (même forme que ceux des boulons de sabot). */
  readonly beamHoles: readonly ShoeBeamHole[];
  /** Traits de scie des âmes, à tracer sur le développé de la poutre. */
  readonly beamKerfs: readonly BeamKerf[];
  /** Assemblages : platine ↔ âme, âme ↔ poutre. */
  readonly assemblies: readonly PartAssembly[];
  /** Âmes soudées sur leur platine (classe d'exécution du plugin). */
  readonly welded: boolean;
  /**
   * Longueur retenue de l'âme de pied le long de la trace (`anchors.plate.footWebLength`
   * résolu, A35 (a)), mm ; absente sans âme de pied. Valeur `auto` exposée par le plugin.
   */
  readonly footWebLength?: Mm;
  readonly notes: readonly Message[];
  readonly errors: readonly Message[];
}

/**
 * Largeur de la platine d'appui en travers de la poutre : saisie, ou `auto` → b + 4 ×
 * `anchors.holeEdgeDistance` (chevilles de part et d'autre de la poutre, à la pince du bord de
 * la platine et de la face de la poutre). Contrat partagé (valeur `auto` exposée par le plugin).
 */
export function resolvePlateWidth(params: WoodCentralShoesInput["params"]): Mm {
  const w = params.anchors.plate.width;
  return w !== "auto" ? w : params.section.width + 4 * params.anchors.holeEdgeDistance;
}

/** Constat élémentaire d'une platine (joint aux autres dans un constat par platine). */
interface Issue {
  readonly message: Message;
  readonly measured: Mm;
  readonly min?: Mm;
  readonly max?: Mm;
}

/** Broche placée : abscisse sur la trace et altitude (développement à l'axe). */
export interface EmbeddedPin {
  readonly sigma: Mm;
  readonly z: Mm;
}

/** Pinces mesurées d'une broche (mm) : extrémité, rive du dessus, rive de la sous-face. */
interface PinDistances {
  readonly end: Mm;
  readonly top: Mm;
  readonly under: Mm;
}

/** Côté d'une platine (pied ou tête), dimensions retenues après réductions. */
interface PlateSpec {
  readonly foot: boolean;
  readonly id: string;
  readonly mark: string;
  readonly webId: string;
  readonly webMark: string;
  /** Pied : longueur le long de la trace ; tête : hauteur. */
  readonly length: Mm;
  /** Âme : longueur le long de la trace (pied) ou hauteur (tête). */
  readonly webLength: Mm;
  /** Âme : profondeur dans la poutre (hauteur au pied, le long de la trace en tête). */
  readonly webDepth: Mm;
  /** σ du repère de pose : milieu de la platine (pied), face du chevêtre (tête). */
  readonly at: Mm;
  /** Pied : début de l'âme en σ. Tête : bas de l'âme en z. */
  readonly webStart: Mm;
  /** Plan de l'âme en plan (corde de la trace, décalée pour centrer la flèche). */
  readonly line: EmbeddedWebLine;
  readonly pins: readonly EmbeddedPin[];
  readonly kerf: BeamKerf;
  /**
   * Pied prolongé (A35 (a)) : contour de l'âme dans le développé (points (σ, z), sens
   * trigonométrique, bord bas sur la platine, dessus en escalier) ; absent : rectangle
   * `webLength` × `webDepth`.
   */
  readonly webOutline?: readonly Vec2[];
}

/** Palier d'une fonction en escalier σ ↦ h sur [s0 ; s1[ (dernier palier fermé). */
interface Step {
  readonly s0: Mm;
  readonly s1: Mm;
  readonly h: Mm;
}

/** Pince d'extrémité exigée d'une broche et message de son constat. */
interface EndRule {
  readonly min: Mm;
  readonly message: (distance: Mm) => Message;
}

const UP: Vec3 = { x: 0, y: 0, z: 1 };
/** Défaut de `anchors.plate.webLength` (lu sur le schéma, jamais recopié). */
const DEFAULT_WEB_LENGTH: Mm = WoodCentralParamsSchema.parse({}).anchors.plate.webLength;
const v3 = (p: Vec2, z: Mm): Vec3 => ({ x: p.x, y: p.y, z });
const h3 = (p: Vec2): Vec3 => ({ x: p.x, y: p.y, z: 0 });
const EPS = 1e-6;
/** Pas de recherche des positions des broches (mm, précision géométrique, pas une valeur métier). */
const SCAN_STEP: Mm = 1;
/** Portée de la sous-face examinée de part et d'autre d'une broche (mm, ≫ pinces de l'EC5). */
const UNDER_REACH: Mm = 1000;
/** Tolérance de mesure des pinces (mm, arrondi d'affichage). */
const PINCH_TOL: Mm = 0.5;

/** Messages joints par « ; » (constat unique par platine). */
function joinIssues(items: readonly Message[]): Message {
  let out = items[items.length - 1]!;
  for (let i = items.length - 2; i >= 0; i--) {
    out = msg("compliance.join.semicolon", { first: items[i]!, next: out });
  }
  return out;
}

/** Distance (développé) d'un point à la courbe σ ↦ z échantillonnée sur [s0 ; s1]. */
function distanceToCurve(p: Vec2, s0: Mm, s1: Mm, z: (s: Mm) => Mm): Mm {
  if (!(s1 > s0)) return Infinity;
  const n = Math.max(1, Math.ceil((s1 - s0) / 2));
  let best = Infinity;
  let prev = V.vec(s0, z(s0));
  for (let i = 1; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const q = V.vec(s, z(s));
    best = Math.min(best, pointSegmentDistance(p, prev, q));
    prev = q;
  }
  return best;
}

/** `count` valeurs réparties sur [lo ; hi] (une seule : au milieu). */
function evenly(lo: Mm, hi: Mm, count: number): Mm[] {
  if (count <= 0) return [];
  if (count === 1 || !(hi > lo)) return [(lo + hi) / 2];
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

/** Nombre de broches qui tiennent sur [lo ; hi] à l'entraxe `a1` (au plus `wanted`). */
function fitting(lo: Mm, hi: Mm, a1: Mm, wanted: number): number {
  if (wanted <= 0) return 0;
  if (!(hi > lo)) return 1;
  return Math.min(wanted, Math.floor((hi - lo) / a1 + 1e-9) + 1);
}

/**
 * Paliers d'une fonction en escalier (dessus des assises, dessus de l'âme) sur [a ; b] :
 * échantillonnage au pas `SCAN_STEP`, chaque saut localisé par dichotomie. Deux sauts dans un
 * même pas (paliers de moins de 1 mm) seraient confondus : sans objet pour des assises.
 */
function stepSegments(f: (s: Mm) => Mm, a: Mm, b: Mm): Step[] {
  if (!(b > a)) return [{ s0: a, s1: Math.max(a, b), h: f(a) }];
  const n = Math.max(1, Math.ceil((b - a) / SCAN_STEP));
  const out: Step[] = [];
  let s0 = a;
  let h = f(a);
  for (let i = 1; i <= n; i++) {
    const s = a + ((b - a) * i) / n;
    // Plusieurs sauts possibles dans le pas : chacun localisé tour à tour.
    for (let guard = 0; guard < 8 && Math.abs(f(s) - h) > EPS; guard++) {
      let lo = s0;
      let hi = s;
      for (let k = 0; k < 50 && hi - lo > 1e-7; k++) {
        const m = (lo + hi) / 2;
        if (Math.abs(f(m) - h) <= EPS) lo = m;
        else hi = m;
      }
      out.push({ s0, s1: hi, h });
      s0 = hi;
      h = f(hi);
    }
  }
  out.push({ s0, s1: b, h });
  return out.filter((t) => t.s1 - t.s0 > 1e-7 || out.length === 1);
}

/** Valeur du palier contenant σ (−∞ hors des paliers). */
function stepAt(steps: readonly Step[], s: Mm): Mm {
  for (let i = 0; i < steps.length; i++) {
    const t = steps[i]!;
    if (s >= t.s0 - 1e-9 && (s < t.s1 || (i === steps.length - 1 && s <= t.s1 + 1e-9))) return t.h;
  }
  return -Infinity;
}

/** Plus petite valeur des paliers qui rencontrent ]w0 ; w1[ (+∞ sans palier). */
function stepMin(steps: readonly Step[], w0: Mm, w1: Mm): Mm {
  let out = Infinity;
  for (const t of steps) if (t.s1 > w0 + 1e-9 && t.s0 < w1 - 1e-9) out = Math.min(out, t.h);
  return out;
}

/**
 * Contour (σ, z), sens trigonométrique, de la région comprise entre z = `base` et le dessus en
 * escalier `steps` (paliers contigus).
 */
function stepOutline(steps: readonly Step[], base: Mm): Vec2[] {
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  const pts: Vec2[] = [V.vec(first.s0, base), V.vec(last.s1, base)];
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = steps[i]!;
    pts.push(V.vec(t.s1, t.h), V.vec(t.s0, t.h));
  }
  // Points confondus (paliers de même hauteur) retirés.
  return pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.y - q.y) > 1e-9;
  });
}

/** Plus long intervalle d'indices consécutifs satisfaisant `ok` ([−1 ; −2] si aucun). */
function longestRun(n: number, ok: (k: number) => boolean): [number, number] {
  let best: [number, number] = [-1, -2];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    if (k < n && ok(k)) {
      if (start < 0) start = k;
      continue;
    }
    if (start >= 0 && k - 1 - start > best[1] - best[0]) best = [start, k - 1];
    start = -1;
  }
  return best;
}

/** Plan (vertical) d'une âme plane dans la poutre, vu en plan. */
export interface EmbeddedWebLine {
  /** Milieu de l'âme en plan (repère monde). */
  readonly center: Vec2;
  /** Direction de l'âme : corde de la trace sur la portée de l'âme, dans le sens de la montée. */
  readonly dir: Vec2;
  /**
   * Flèche (mm) : plus grand écart entre le plan de l'âme et le plan médian de la poutre sur la
   * portée de l'âme (nul sur une trace droite, ≈ L² / 16R sur un arc de rayon R).
   */
  readonly sag: Mm;
}

/**
 * Plan de l'âme plane d'une platine sur σ ∈ [from ; to] : parallèle à la corde de la trace et
 * décalé pour centrer les écarts au plan médian de la poutre (la flèche est partagée de part et
 * d'autre du plan de l'âme). Convention Blondel **à valider** : sur une poutre cintrée, l'âme
 * est soudée sur la platine selon cette corde (en tête, légèrement biaise par rapport à la
 * normale du chevêtre) ; sur une trace droite, l'âme est dans le plan médian.
 */
export function embeddedWebLine(trace: CentralTrace, from: Mm, to: Mm): EmbeddedWebLine {
  const a = trace.point(from);
  const b = trace.point(to);
  const chord = V.sub(b, a);
  const len = V.norm(chord);
  const dir = len > EPS ? V.scale(chord, 1 / len) : trace.tangent((from + to) / 2);
  const n = V.perpLeft(dir);
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 5));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const d = V.dot(n, V.sub(trace.point(from + ((to - from) * i) / steps), a));
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return {
    center: V.addScaled(V.scale(V.add(a, b), 0.5), n, (lo + hi) / 2),
    dir,
    sag: (hi - lo) / 2,
  };
}

/**
 * Platines à âme noyée de pied et de tête. Ne lève jamais (erreur inattendue : `errors`, sans
 * platine). Ajoute le contrôle `FAB_PLATINE_AME_NOYEE` (un constat par platine demandée) et
 * les contrôles de découpe laser à `checks`.
 */
export function buildWoodCentralEmbeddedPlates(
  input: WoodCentralShoesInput,
): WoodCentralPlatesResult {
  try {
    return buildPlates(input);
  } catch (err) {
    return {
      ...EMPTY,
      errors: [msg("structure.woodCentral.error.plate", { detail: errorMessage(err) })],
    };
  }
}

const EMPTY: WoodCentralPlatesResult = {
  parts: [],
  beamHoles: [],
  beamKerfs: [],
  assemblies: [],
  welded: false,
  notes: [],
  errors: [],
};

function buildPlates(input: WoodCentralShoesInput): WoodCentralPlatesResult {
  const { params, profile, beam, checks, trace } = input;
  const an = params.anchors;
  const P = an.plate;
  const rule = pluginRuleDef(WOOD_CENTRAL_PLATE_RULES.plateFit);
  if (!an.foot && !an.head) {
    checks.add(rule, [{ status: "ok", message: msg("structure.woodCentral.check.plate.none") }]);
    return EMPTY;
  }
  const b = params.section.width;
  const c = profile.wood.clearance;
  const tp = P.thickness;
  const W = resolvePlateWidth(params);
  const hE = an.holeEdgeDistance;
  const minLength = 2 * hE;
  const ec5 = ec5Spacing("dowel", P.pinDiameter);
  const loc = { kind: "part" as const, partId: beam.beamId };
  const kerfWidth = P.webThickness + 2 * c;
  const Z = (s: Mm): Mm => trace.nosingZ(s);

  const findings: Finding[] = [];
  const specs: PlateSpec[] = [];
  const notes: Message[] = [msg("structure.woodCentral.note.plate")];
  let footWebLength: Mm | undefined;

  /** Constats communs : chevilles hors de l'emprise de la poutre, flèche de l'âme, broches. */
  const commonIssues = (
    mark: string,
    webMark: string,
    sag: Mm,
    pins: readonly EmbeddedPin[],
    dist: (p: EmbeddedPin) => PinDistances,
    endRule: EndRule,
  ): Issue[] => {
    const issues: Issue[] = [];
    const half = W / 2 - hE;
    const need = b / 2 + an.anchorHoleDiameter / 2;
    if (an.anchors > 0 && half < need - EPS) {
      issues.push({
        measured: half,
        min: need,
        message: msg("structure.woodCentral.check.plate.anchorsUnderBeam", {
          mark,
          distance: dec(half, 0),
          half: dec(b / 2, 0),
        }),
      });
    }
    // Trait de scie dans le bois : flèche de l'âme plane + demi-trait ≤ b/2 − a4,c.
    const reach = sag + kerfWidth / 2;
    const allowed = b / 2 - ec5.a4c;
    if (reach > allowed + EPS) {
      issues.push({
        measured: reach,
        max: allowed,
        message: msg("structure.woodCentral.check.plate.webCurved", {
          web: webMark,
          sag: dec(sag, 1),
          edge: dec(b / 2 - reach, 1),
          a4c: dec(ec5.a4c, 0),
        }),
      });
    }
    if (pins.length < P.pins) {
      issues.push({
        measured: pins.length,
        min: P.pins,
        message: msg("structure.woodCentral.check.plate.pinsMissing", {
          web: webMark,
          placed: pins.length,
          wanted: P.pins,
          a1: dec(ec5.a1, 0),
        }),
      });
    }
    let end = Infinity;
    let edge = Infinity;
    for (const p of pins) {
      const d = dist(p);
      end = Math.min(end, d.end);
      edge = Math.min(edge, d.top, d.under);
    }
    if (end < endRule.min - PINCH_TOL) {
      issues.push({ measured: end, min: endRule.min, message: endRule.message(end) });
    }
    if (edge < ec5.a4t - PINCH_TOL) {
      issues.push({
        measured: edge,
        min: ec5.a4t,
        message: msg("structure.woodCentral.check.plate.pinEdge", {
          web: webMark,
          distance: dec(edge, 0),
          a4t: dec(ec5.a4t, 0),
        }),
      });
    }
    return issues;
  };

  /** Platine plus courte que deux pinces de perçage (non générée). */
  const tooShort = (mark: string, length: Mm): Issue => ({
    measured: length,
    min: minLength,
    message: msg("structure.woodCentral.check.plate.tooShort", {
      mark,
      length: dec(length, 0),
      min: dec(minLength, 0),
    }),
  });

  const record = (ok: Message, okMeasured: Mm, okMax: Mm, issues: readonly Issue[]): void => {
    if (issues.length === 0) {
      findings.push({ status: "ok", measured: okMeasured, max: okMax, location: loc, message: ok });
      return;
    }
    const first = issues[0]!;
    findings.push({
      status: "violation",
      measured: first.measured,
      min: first.min ?? null,
      max: first.max ?? null,
      location: loc,
      message: joinIssues(issues.map((i) => i.message)),
    });
  };

  /**
   * Âme plus profonde que le bois disponible (`webDepth` est une profondeur maximale, comme la
   * hauteur des joues du sabot) : ramenée au bois disponible, avec une remarque ; constat en
   * violation si elle ne laisse plus deux pinces de perçage (platine non générée). Une âme
   * réduite qui ne tient plus ses broches aux pinces de l'EC5 est signalée par leurs constats.
   */
  const limitDepth = (
    webMark: string,
    mark: string,
    room: Mm,
    depth: Mm,
    issues: Issue[],
  ): void => {
    if (!(P.webDepth + c > room + EPS)) {
      // Âme saisie trop peu profonde pour ses deux pinces de perçage : platine non générée.
      if (depth < minLength) {
        issues.push({
          measured: depth,
          min: minLength,
          message: msg("structure.woodCentral.check.plate.webTooShallow", {
            web: webMark,
            mark,
            depth: dec(depth, 0),
            min: dec(minLength, 0),
          }),
        });
      }
      return;
    }
    if (depth >= minLength) {
      notes.push(
        msg("structure.woodCentral.note.plateWebReduced", {
          web: webMark,
          wanted: dec(P.webDepth, 0),
          room: dec(room, 0),
          depth: dec(depth, 0),
        }),
      );
      return;
    }
    issues.push({
      measured: P.webDepth + c,
      max: room,
      message: msg("structure.woodCentral.check.plate.webMissing", {
        web: webMark,
        mark,
        room: dec(room, 0),
      }),
    });
  };

  // ---------------------------------------------------------------- Pied
  if (an.foot) {
    const mark = WOOD_CENTRAL_PLATE_FOOT_MARK;
    const webMark = WOOD_CENTRAL_PLATE_FOOT_WEB_MARK;
    const cut = beam.floorCutLength;
    const L0 = Math.min(an.length, cut);
    const issues: Issue[] = [];
    if (an.length > cut + EPS) {
      issues.push({
        measured: an.length,
        max: cut,
        message:
          L0 >= minLength
            ? msg("structure.woodCentral.check.plate.footReduced", {
                mark,
                wanted: dec(an.length, 0),
                cut: dec(cut, 0),
                length: dec(L0, 0),
              })
            : msg("structure.woodCentral.check.plate.footMissing", { mark, cut: dec(cut, 0) }),
      });
    } else if (L0 < minLength) {
      issues.push(tooShort(mark, L0));
    }
    // Pince des broches depuis la coupe au sol selon la filière (A35 (b)) et la convention de
    // gravité (A35 (e)) : extrémité non chargée a3,c, ou rive a4,t en couches empilées.
    const method: WoodGrainMethod =
      params.section.kind === "solid"
        ? "solid"
        : (resolveCurvedMethod(params, trace.kind !== "straight") ?? "straight");
    const floorPin = footPinFloorDistance(method, P.pinDiameter);
    const floorRule: EndRule = {
      min: floorPin.distance,
      message: (distance) =>
        msg(
          floorPin.kind === "a4t"
            ? "structure.woodCentral.check.plate.pinFloorEdge"
            : "structure.woodCentral.check.plate.pinFloorEnd",
          { web: webMark, distance: dec(distance, 0), min: dec(floorPin.distance, 0) },
        ),
    };
    // Sous-face au-delà de la coupe au sol : parallèle à la ligne des nez (développé).
    const x1 = beam.frontSigma + cut;
    const under = (s: Mm): Mm => tp + Z(s) - Z(x1);
    const underDistance = (p: EmbeddedPin): Mm =>
      distanceToCurve(
        V.vec(p.sigma, p.z),
        Math.max(x1, p.sigma - UNDER_REACH),
        Math.max(x1, p.sigma) + UNDER_REACH,
        under,
      );
    const topAt = beam.topAt ?? ((): Mm => beam.firstSeatZ);
    const ext = L0 >= minLength ? extendedFootWeb(input, kerfWidth) : null;
    if (ext) {
      // Âme prolongée (A35 (a)) : platine couvrant l'âme, broches où la poutre est haute.
      const L = Math.min(cut, Math.max(an.length, ext.ws1 - beam.frontSigma + c));
      const dist = (p: EmbeddedPin): PinDistances => ({
        end: p.z - tp,
        top: topAt(p.sigma) - p.z,
        under: underDistance(p),
      });
      const pins = placeFootPins(input, ext, floorPin.distance, underDistance);
      issues.push(...commonIssues(mark, webMark, ext.line.sag, pins, dist, floorRule));
      const height = Math.max(...ext.steps.map((t) => t.h)) - tp;
      const seatOf = (s: Mm): number => {
        const steps = stepSegments(topAt, beam.frontSigma, Math.max(beam.frontSigma, s));
        return steps.length;
      };
      const first = seatOf(ext.ws0 + EPS);
      const last = seatOf(ext.ws1 - EPS);
      const common = {
        web: webMark,
        mark,
        length: dec(ext.ws1 - ext.ws0, 0),
        height: dec(height, 0),
        wanted: dec(P.webDepth, 0),
      };
      notes.push(
        first === last
          ? msg("structure.woodCentral.note.plateFootWebExtendedOne", { ...common, seat: first })
          : msg("structure.woodCentral.note.plateFootWebExtended", { ...common, first, last }),
      );
      // Ancien réglage : `webLength` ne règle plus l'âme de pied prolongée (relecture A35).
      if (P.webLength !== DEFAULT_WEB_LENGTH) {
        notes.push(
          msg("structure.woodCentral.note.plateWebLengthHeadOnly", {
            web: webMark,
            length: dec(P.webLength, 0),
          }),
        );
      }
      specs.push({
        foot: true,
        id: WOOD_CENTRAL_PLATE_FOOT_ID,
        mark,
        webId: WOOD_CENTRAL_PLATE_FOOT_WEB_ID,
        webMark,
        length: L,
        webLength: ext.ws1 - ext.ws0,
        webDepth: height,
        at: beam.frontSigma + L / 2,
        webStart: ext.ws0,
        line: ext.line,
        pins,
        kerf: ext.kerf,
        webOutline: ext.outline,
      });
      footWebLength = ext.ws1 - ext.ws0;
      record(
        msg("structure.woodCentral.check.plate.footOk", {
          mark,
          web: webMark,
          length: dec(L, 0),
          cut: dec(cut, 0),
        }),
        an.length,
        cut,
        issues,
      );
    } else {
      // Repli (comportement antérieur à A35 (a)) : âme de `webLength` centrée sur la platine,
      // sous le dessous de la première marche moins la joue minimale. Une longueur d'âme de pied
      // saisie qui ne tient pas n'est jamais remplacée en silence (constat en violation).
      if (P.footWebLength !== "auto" && L0 >= minLength) {
        issues.push({
          measured: P.footWebLength,
          min: minLength,
          message: msg("structure.woodCentral.check.plate.footWebRejected", {
            web: webMark,
            wanted: dec(P.footWebLength, 0),
            min: dec(minLength, 0),
          }),
        });
      }
      const L = L0;
      const room = beam.firstSeatZ - profile.wood.minCheek - tp;
      const depth = Math.min(P.webDepth, room - c);
      if (L >= minLength) limitDepth(webMark, mark, room, depth, issues);
      if (L >= minLength && depth >= minLength) {
        const at = beam.frontSigma + L / 2;
        const Lw = Math.min(P.webLength, L);
        const ws0 = at - Lw / 2;
        const ws1 = at + Lw / 2;
        const dist = (p: EmbeddedPin): PinDistances => ({
          end: p.z - tp,
          top: beam.firstSeatZ - p.z,
          under: underDistance(p),
        });
        // Hauteur de la rangée : pince depuis la coupe au sol (A35 (b), (e)), pince de rive
        // sous la première marche (a4,t), pinces de perçage de l'âme.
        const webLo = tp + Math.min(hE, depth / 2);
        const webHi = tp + depth - Math.min(hE, depth / 2);
        const zLo = Math.max(webLo, tp + floorPin.distance);
        const zHi = Math.min(webHi, beam.firstSeatZ - ec5.a4t);
        const z = zLo <= zHi ? (zLo + zHi) / 2 : Math.min(webHi, Math.max(webLo, (zLo + zHi) / 2));
        // Rangée le long de la trace, dans l'âme, à la pince de rive de la sous-face (a4,t).
        const xLo = ws0 + Math.min(hE, Lw / 2);
        let xHi = ws1 - Math.min(hE, Lw / 2);
        const okAt = (s: Mm): boolean => underDistance({ sigma: s, z }) >= ec5.a4t;
        if (okAt(xLo)) {
          while (xHi > xLo && !okAt(xHi)) xHi = Math.max(xLo, xHi - SCAN_STEP);
        }
        const count = fitting(xLo, xHi, ec5.a1, P.pins);
        const pins = evenly(xLo, xHi, count).map((sigma) => ({ sigma, z }));
        const line = embeddedWebLine(trace, ws0, ws1);
        issues.push(...commonIssues(mark, webMark, line.sag, pins, dist, floorRule));
        footWebLength = Lw;
        specs.push({
          foot: true,
          id: WOOD_CENTRAL_PLATE_FOOT_ID,
          mark,
          webId: WOOD_CENTRAL_PLATE_FOOT_WEB_ID,
          webMark,
          length: L,
          webLength: Lw,
          webDepth: depth,
          at,
          webStart: ws0,
          line,
          pins,
          // Trait de scie borné à la coupe au sol (âme aussi longue que la platine : trait
          // débouchant sur la face avant de la poutre).
          kerf: {
            mark: webMark,
            sigma0: Math.max(ws0 - c, beam.frontSigma),
            sigma1: Math.min(ws1 + c, x1),
            z0: tp,
            z1: tp + depth + c,
            width: kerfWidth,
          },
        });
      }
      record(
        msg("structure.woodCentral.check.plate.footOk", {
          mark,
          web: webMark,
          length: dec(L, 0),
          cut: dec(cut, 0),
        }),
        an.length,
        cut,
        issues,
      );
    }
  }

  // ---------------------------------------------------------------- Tête
  if (an.head) {
    const mark = WOOD_CENTRAL_PLATE_HEAD_MARK;
    const webMark = WOOD_CENTRAL_PLATE_HEAD_WEB_MARK;
    const height = Math.max(0, beam.headTop - beam.headBottom);
    const H = Math.min(an.length, height);
    const issues: Issue[] = [];
    if (an.length > height + EPS) {
      issues.push({
        measured: an.length,
        max: height,
        message:
          H >= minLength
            ? msg("structure.woodCentral.check.plate.headReduced", {
                mark,
                wanted: dec(an.length, 0),
                height: dec(height, 0),
                length: dec(H, 0),
              })
            : msg("structure.woodCentral.check.plate.headMissing", {
                mark,
                height: dec(height, 0),
              }),
      });
    } else if (H < minLength) {
      issues.push(tooShort(mark, H));
    }
    // Coupe d'aplomb de la poutre (contrat : épaisseur de la platine et jeu devant le chevêtre).
    const sH = beam.trimmerSigma - tp - c;
    const Hw = Math.min(P.webLength, H);
    const wz0 = beam.headBottom + (H - Hw) / 2;
    // Bois disponible le long de la trace : le trait de scie, bande horizontale [wz0 ; wz0 + Hw]
    // (jeu compris), reste sous le dessus de la poutre (assises, dessus fini `topAt`) ; il ne
    // remonte pas sous l'assise précédente, plus basse.
    // Âme aussi haute que la coupe de tête : trait débouchant au dessus et au dessous de la
    // poutre, borné à la coupe.
    const kerfTop = Math.min(wz0 + Hw + c, beam.headTop);
    const kerfBottom = Math.max(wz0 - c, beam.headBottom);
    const topAt = beam.topAt ?? ((): Mm => beam.headTop);
    let sWood = sH;
    while (sWood > beam.frontSigma && topAt(sWood - SCAN_STEP) >= kerfTop - EPS) {
      sWood -= SCAN_STEP;
    }
    const room = sH - Math.max(beam.frontSigma, sWood);
    const depth = Math.min(P.webDepth, room - c);
    if (H >= minLength) limitDepth(webMark, mark, room, depth, issues);
    if (H >= minLength && depth >= minLength) {
      const at = beam.trimmerSigma;
      const wa = beam.trimmerSigma - tp - depth;
      const wb = beam.trimmerSigma - tp;
      // Sous-face en deçà de la coupe de tête : parallèle à la ligne des nez (développé).
      const under = (s: Mm): Mm => beam.headBottom + Z(s) - Z(sH);
      const dist = (p: EmbeddedPin): PinDistances => ({
        end: sH - p.sigma,
        top: topAt(p.sigma) - p.z,
        under: distanceToCurve(
          V.vec(p.sigma, p.z),
          Math.min(sH, p.sigma) - UNDER_REACH,
          Math.min(sH, p.sigma + UNDER_REACH),
          under,
        ),
      });
      // Colonne verticale : pince d'extrémité depuis la coupe d'aplomb (a3,t), pinces de l'âme.
      const sLo = wa + Math.min(hE, depth / 2);
      const sWebHi = wb - Math.min(hE, depth / 2);
      const sHi = Math.min(sWebHi, sH - ec5.a3t);
      const sigma = sLo <= sHi ? (sLo + sHi) / 2 : sLo;
      // Rives : sous-face (a4,t, recherchée) et dessus à la coupe de tête (a4,t).
      const zWebLo = wz0 + Math.min(hE, Hw / 2);
      const zWebHi = wz0 + Hw - Math.min(hE, Hw / 2);
      const zTop = Math.min(zWebHi, topAt(sigma) - ec5.a4t);
      const zHi = zTop >= zWebLo ? zTop : zWebHi;
      let zLo = zWebLo;
      const okAt = (z: Mm): boolean => dist({ sigma, z }).under >= ec5.a4t;
      while (zLo < zHi && !okAt(zLo)) zLo = Math.min(zHi, zLo + SCAN_STEP);
      const count = fitting(zLo, zHi, ec5.a1, P.pins);
      const pins = evenly(zLo, zHi, count).map((z) => ({ sigma, z }));
      const line = embeddedWebLine(trace, wa, wb);
      // Tête : extrémité chargée (a3,t), convention de gravité (A35 (e)).
      const headRule: EndRule = {
        min: ec5.a3t,
        message: (distance) =>
          msg("structure.woodCentral.check.plate.pinEnd", {
            web: webMark,
            distance: dec(distance, 0),
            a3t: dec(ec5.a3t, 0),
          }),
      };
      issues.push(...commonIssues(mark, webMark, line.sag, pins, dist, headRule));
      specs.push({
        foot: false,
        id: WOOD_CENTRAL_PLATE_HEAD_ID,
        mark,
        webId: WOOD_CENTRAL_PLATE_HEAD_WEB_ID,
        webMark,
        length: H,
        webLength: Hw,
        webDepth: depth,
        at,
        webStart: wz0,
        line,
        pins,
        kerf: {
          mark: webMark,
          sigma0: wa - c,
          sigma1: sH,
          z0: kerfBottom,
          z1: kerfTop,
          width: kerfWidth,
        },
      });
    }
    record(
      msg("structure.woodCentral.check.plate.headOk", {
        mark,
        web: webMark,
        length: dec(H, 0),
        height: dec(height, 0),
      }),
      an.length,
      height,
      issues,
    );
  }
  checks.add(rule, findings);
  if (specs.length === 0) return { ...EMPTY, notes: notes.slice(1) };

  const parts: Part[] = [];
  const beamHoles: ShoeBeamHole[] = [];
  const assemblies: PartAssembly[] = [];
  for (const s of specs) {
    const built = plateParts(input, s, W);
    parts.push(built.plate, built.web);
    beamHoles.push(
      ...s.pins.map((p) => ({ mark: s.webMark, sigma: p.sigma, z: p.z, diameter: P.pinDiameter })),
    );
    assemblies.push(
      { a: { partId: s.id }, b: { partId: s.webId } },
      { a: { partId: s.webId }, b: { partId: beam.beamId } },
    );
  }
  checks.addItems(
    pluginRuleDef(STEEL_RULES.laser),
    parts.map((p) => ({ value: p.flat!.thickness, label: textMessage(p.mark), partId: p.id })),
    msg("structure.steel.quantity.cutThickness"),
    { min: null, max: profile.metal.laser.maxThickness },
  );
  return {
    parts,
    beamHoles,
    beamKerfs: specs.map((s) => s.kerf),
    assemblies,
    welded: true,
    ...(footWebLength !== undefined ? { footWebLength } : {}),
    notes,
    errors: [],
  };
}

/** Âme de pied prolongée (A35 (a)) : étendue, dessus en escalier, plan, trait de scie. */
interface ExtendedFootWeb {
  readonly ws0: Mm;
  readonly ws1: Mm;
  /** Paliers du dessus de l'âme sur [ws0 ; ws1] (z absolus). */
  readonly steps: readonly Step[];
  /** Contour de l'âme (σ, z), sens trigonométrique. */
  readonly outline: readonly Vec2[];
  readonly line: EmbeddedWebLine;
  readonly kerf: BeamKerf;
}

/**
 * Âme de pied prolongée le long de la trace (QUESTIONS A35 (a), convention **à valider**) : finit
 * au bout de la coupe au sol moins le jeu (ws1 = x1 − c), commence à ws1 − `footWebLength`
 * (bornée à la face avant + c ; `auto` : plus longue âme plane dont flèche + demi-trait ≤ b/2 −
 * a4,c, par dichotomie) ; dessus webTop(σ) = min(tp + `webDepth`, min du dessus de la poutre sur
 * [σ − c ; σ + c] − max(`wood.minCheek`, `seatClearance`) − c) ; paliers plus bas que deux
 * pinces de perçage retirés (plus long tronçon restant). `null` : aucune âme d'au moins deux
 * pinces de perçage en hauteur et en longueur (repli sur l'âme centrée).
 */
function extendedFootWeb(input: WoodCentralShoesInput, kerfWidth: Mm): ExtendedFootWeb | null {
  const { params, profile, beam, trace } = input;
  const P = params.anchors.plate;
  const c = profile.wood.clearance;
  const tp = P.thickness;
  const minLength = 2 * params.anchors.holeEdgeDistance;
  const x1 = beam.frontSigma + beam.floorCutLength;
  let ws1 = x1 - c;
  const wsMin = beam.frontSigma + c;
  if (!(ws1 - wsMin >= minLength - EPS)) return null;
  const topAt = beam.topAt ?? ((): Mm => beam.firstSeatZ);
  const clear = Math.max(profile.wood.minCheek, beam.seatClearance ?? 0);
  const webTop = (s: Mm): Mm =>
    Math.min(tp + P.webDepth, Math.min(topAt(s - c), topAt(s), topAt(s + c)) - clear - c);

  // Longueur : saisie (depuis ws1 vers l'avant), ou plus longue âme dont le trait reste dans le
  // bois (la flèche croît avec la longueur : dichotomie sur le début de l'âme).
  let ws0: Mm;
  if (P.footWebLength !== "auto") {
    ws0 = Math.max(wsMin, ws1 - P.footWebLength);
  } else {
    const allowed = params.section.width / 2 - ec5Spacing("dowel", P.pinDiameter).a4c;
    const fits = (s0: Mm): boolean =>
      embeddedWebLine(trace, s0, ws1).sag + kerfWidth / 2 <= allowed + EPS;
    if (kerfWidth / 2 > allowed + EPS || fits(wsMin)) {
      // Trait trop large même sans flèche (constat) ou âme entière admise.
      ws0 = wsMin;
    } else if (!fits(ws1 - minLength)) {
      ws0 = ws1 - minLength;
    } else {
      let lo = wsMin;
      let hi = ws1 - minLength;
      for (let k = 0; k < 40 && hi - lo > 1e-3; k++) {
        const m = (lo + hi) / 2;
        if (fits(m)) hi = m;
        else lo = m;
      }
      ws0 = hi;
    }
  }
  // Bouts trop bas retirés : plus long tronçon de paliers d'au moins deux pinces de haut.
  const span = (r: readonly Step[]): Mm => (r.length > 0 ? r[r.length - 1]!.s1 - r[0]!.s0 : 0);
  let best: Step[] = [];
  let cur: Step[] = [];
  for (const t of stepSegments(webTop, ws0, ws1)) {
    if (t.h - tp >= minLength - EPS) {
      cur.push(t);
      continue;
    }
    if (span(cur) > span(best)) best = cur;
    cur = [];
  }
  if (span(cur) > span(best)) best = cur;
  if (best.length === 0 || span(best) < minLength - EPS) return null;
  const steps = best;
  ws0 = steps[0]!.s0;
  ws1 = steps[steps.length - 1]!.s1;

  // Trait de scie : âme épaissie du jeu c (bouts et dessus), borné à la coupe au sol.
  const k0 = Math.max(ws0 - c, beam.frontSigma);
  const k1 = Math.min(ws1 + c, x1);
  const clamp = (s: Mm): Mm => Math.min(ws1, Math.max(ws0, s));
  const kerfTop = (s: Mm): Mm =>
    Math.max(stepAt(steps, clamp(s - c)), stepAt(steps, clamp(s)), stepAt(steps, clamp(s + c))) + c;
  const kerfSteps = stepSegments(kerfTop, k0, k1);
  const kerf: BeamKerf = {
    mark: WOOD_CENTRAL_PLATE_FOOT_WEB_MARK,
    sigma0: k0,
    sigma1: k1,
    z0: tp,
    z1: Math.max(...kerfSteps.map((t) => t.h)),
    width: kerfWidth,
    ...(kerfSteps.length > 1 ? { outline: stepOutline(kerfSteps, tp) } : {}),
  };
  return {
    ws0,
    ws1,
    steps,
    outline: stepOutline(steps, tp),
    line: embeddedWebLine(trace, ws0, ws1),
    kerf,
  };
}

/** Rangée de broches retenue : hauteur, intervalle le long de la trace, nombre. */
interface PinRow {
  readonly z: Mm;
  readonly sa: Mm;
  readonly sb: Mm;
  readonly count: number;
}

/**
 * Broches de l'âme de pied prolongée (A35 (a), (b), (e), convention **à valider**) : une rangée
 * horizontale dont la hauteur z est balayée au pas de 1 mm ; retenue : le plus de broches à
 * l'entraxe a1, puis le plus long intervalle, puis la plus basse. Conditions en σ (évaluées sur
 * une grille au pas de 1 mm, minima pris sur une fenêtre qui couvre l'entre-deux) :
 * - z ≥ tp + pince depuis la coupe au sol (`footPinFloorDistance`) et dans l'âme, à la pince de
 *   perçage de son dessus (sur ±`holeEdgeDistance`) et de ses bouts ;
 * - z ≤ dessus de la poutre − a4,t ; pince de rive a4,t de la sous-face au-delà de la coupe au
 *   sol (borne haute en σ, par dichotomie : la distance décroît vers la coupe) ;
 * - préférence : la zone d'obstacle d'une broche (jeu géométrique d'un tire-fond autour du
 *   perçage, `lagHoleClearance`) laisse sous chaque assise de [σ − jeu ; σ + jeu] l'ancrage d'un
 *   tire-fond arrêté au-dessus du perçage (`seatClearance` − `tipCover`, à défaut
 *   `lagScrews.minAnchorage`) ; abandonnée si elle ne laisse pas `pins` broches ;
 * - en dernier recours (aucune rangée aux pinces), dans l'âme seulement : les constats le disent.
 */
function placeFootPins(
  input: WoodCentralShoesInput,
  ext: ExtendedFootWeb,
  floorDistance: Mm,
  underDistance: (p: EmbeddedPin) => Mm,
): EmbeddedPin[] {
  const { params, profile, beam } = input;
  const P = params.anchors.plate;
  if (P.pins <= 0) return [];
  const tp = P.thickness;
  const hE = params.anchors.holeEdgeDistance;
  const ec5 = ec5Spacing("dowel", P.pinDiameter);
  const topAt = beam.topAt ?? ((): Mm => beam.firstSeatZ);
  // Jeu d'un tire-fond autour du perçage d'une broche (convention partagée avec la poutre).
  const gap = lagHoleClearance(
    P.pinDiameter,
    params.bolts.holeDiameter,
    profile.wood.clearance,
    params.lagScrews.tipCover,
  );
  const margin = gap.half;
  const anchorage =
    beam.seatClearance !== undefined
      ? beam.seatClearance - params.lagScrews.tipCover
      : params.lagScrews.minAnchorage;
  const { ws0, ws1, steps } = ext;
  let lo = ws0 + hE;
  let hi = ws1 - hE;
  if (lo > hi) lo = hi = (ws0 + ws1) / 2;
  const n = Math.max(0, Math.ceil((hi - lo) / SCAN_STEP));
  const g = (k: number): Mm => (n === 0 ? lo : lo + ((hi - lo) * k) / n);
  const reach = margin + 2 * SCAN_STEP;
  const topSteps = stepSegments(topAt, ws0 - reach, ws1 + reach);
  const webMin: Mm[] = [];
  const topMin: Mm[] = [];
  const prefMin: Mm[] = [];
  for (let k = 0; k <= n; k++) {
    const s = g(k);
    webMin.push(stepMin(steps, s - hE - SCAN_STEP, s + hE + SCAN_STEP));
    topMin.push(stepMin(topSteps, s - SCAN_STEP, s + SCAN_STEP));
    prefMin.push(stepMin(topSteps, s - margin - SCAN_STEP, s + margin + SCAN_STEP));
  }
  const zTop = Math.max(...webMin) - hE;

  const row = (stage: "pref" | "strict" | "relaxed"): PinRow | null => {
    const zMin = tp + (stage === "relaxed" ? hE : Math.max(hE, floorDistance));
    let out: PinRow | null = null;
    const nz = Math.floor((zTop - zMin) / SCAN_STEP + 1e-9);
    for (let i = 0; i <= nz; i++) {
      const z = zMin + i * SCAN_STEP;
      const ok = (k: number): boolean =>
        z <= webMin[k]! - hE + EPS &&
        (stage === "relaxed" || z <= topMin[k]! - ec5.a4t + EPS) &&
        (stage !== "pref" || z + gap.above <= prefMin[k]! - anchorage + EPS);
      // Sous-face au-delà de la coupe au sol : dernière abscisse à la pince a4,t.
      let kMax = n;
      if (stage !== "relaxed") {
        const under = (k: number): boolean => underDistance({ sigma: g(k), z }) >= ec5.a4t;
        if (!under(n)) {
          if (!under(0)) continue;
          let a = 0;
          let e = n;
          while (e - a > 1) {
            const m = (a + e) >> 1;
            if (under(m)) a = m;
            else e = m;
          }
          kMax = a;
        }
      }
      const [a, b] = longestRun(kMax + 1, ok);
      if (a < 0) continue;
      const sa = g(a);
      const sb = g(b);
      const count = fitting(sa, sb, ec5.a1, P.pins);
      if (!out || count > out.count || (count === out.count && sb - sa > out.sb - out.sa + EPS)) {
        out = { z, sa, sb, count };
      }
    }
    return out;
  };
  const pref = row("pref");
  if (pref && pref.count >= P.pins) {
    return evenly(pref.sa, pref.sb, pref.count).map((sigma) => ({ sigma, z: pref.z }));
  }
  const chosen = row("strict") ?? row("relaxed");
  if (!chosen) return [];
  // Sans la préférence : broches serrées à l'entraxe a1 du côté où la poutre est la plus haute
  // (vers les marches 2 et 3), pour laisser à la première marche le plus de place possible ;
  // réparties sur l'intervalle si le dessus est le même aux deux bouts.
  const { z, sa, sb, count } = chosen;
  const hiA = topAt(sa);
  const hiB = topAt(sb);
  const sigmas =
    count > 1 && hiB > hiA + EPS
      ? Array.from({ length: count }, (_, i) => sb - (count - 1 - i) * ec5.a1)
      : count > 1 && hiA > hiB + EPS
        ? Array.from({ length: count }, (_, i) => sa + i * ec5.a1)
        : evenly(sa, sb, count);
  return sigmas.map((sigma) => ({ sigma, z }));
}

/** Platine et âme d'un côté : développés, solides, quantités, fixations. */
function plateParts(
  input: WoodCentralShoesInput,
  s: PlateSpec,
  W: Mm,
): { readonly plate: Part; readonly web: Part } {
  const { params, trace, profile, beam } = input;
  const an = params.anchors;
  const P = an.plate;
  const tp = P.thickness;
  const tw = P.webThickness;
  const hE = an.holeEdgeDistance;
  const material = steelMaterial(an.finish);

  // Platine : chevilles en deux rangées, de part et d'autre de la poutre, à la pince du bord.
  // Pied : x le long de la trace, y en travers (y = 0 à droite de la montée). Tête : x en
  // travers (x = 0 à droite), y vertical depuis le dessous de la poutre.
  const nLeft = Math.ceil(an.anchors / 2);
  const nRight = an.anchors - nLeft;
  const holes: Vec2[][] = [];
  const lines: FlatPattern["lines"][number][] = [];
  const webLabel = msg("structure.woodCentral.flatLine.plateWeb", { mark: s.webMark });
  const L = s.length;
  const outer: Vec2[] = s.foot
    ? [V.vec(0, 0), V.vec(L, 0), V.vec(L, W), V.vec(0, W)]
    : [V.vec(0, 0), V.vec(W, 0), V.vec(W, L), V.vec(0, L)];
  const along = (u: Mm, across: Mm): Vec2 => (s.foot ? V.vec(u, across) : V.vec(across, u));
  for (const u of spread(L, hE, nLeft))
    holes.push(holePolygon(along(u, W - hE), an.anchorHoleDiameter));
  for (const u of spread(L, hE, nRight))
    holes.push(holePolygon(along(u, hE), an.anchorHoleDiameter));
  // Tracé de l'âme : son plan est décalé de `lateral` (vers la gauche) de l'axe de la platine
  // pour centrer sa flèche dans une poutre cintrée (`embeddedWebLine`), nul sur une droite.
  const u0 = s.foot ? s.webStart - (s.at - L / 2) : s.webStart - beam.headBottom;
  const lateral = V.dot(trace.left(s.at), V.sub(s.line.center, trace.point(s.at)));
  [W / 2 + lateral - tw / 2, W / 2 + lateral + tw / 2].forEach((across, i) => {
    lines.push({
      kind: "mark",
      a: along(u0, across),
      b: along(u0 + s.webLength, across),
      ...(i === 0 ? { label: webLabel } : {}),
    });
  });
  const corner = outer[2]!;
  lines.push({
    kind: "text",
    a: V.vec(corner.x / 4 - 20, corner.y / 4),
    b: V.vec(corner.x / 4 + 20, corner.y / 4),
    label: textMessage(s.mark),
  });
  const plateFlat: FlatPattern = {
    outline: { outer, holes },
    lines,
    thickness: tp,
    reference: {
      kind: "face",
      description: msg(
        s.foot
          ? "structure.woodCentral.reference.plateFoot"
          : "structure.woodCentral.reference.plateHead",
        { mark: s.mark, web: s.webMark, beam: beam.beamMark },
      ),
    },
  };

  // Âme : x le long de la trace (vers la montée), y vertical ; perçages des broches.
  const wx = s.foot ? s.webLength : s.webDepth;
  const wy = s.foot ? s.webDepth : s.webLength;
  const webX0 = s.foot ? s.webStart : beam.trimmerSigma - tp - s.webDepth;
  const webY0 = s.foot ? tp : s.webStart;
  const webHoles = s.pins.map((p) =>
    holePolygon(V.vec(p.sigma - webX0, p.z - webY0), P.pinHoleDiameter),
  );
  // Âme de pied prolongée : contour en escalier (A35 (a)) ; sinon rectangle.
  const webOuter = s.webOutline
    ? s.webOutline.map((p) => V.vec(p.x - webX0, p.y - webY0))
    : [V.vec(0, 0), V.vec(wx, 0), V.vec(wx, wy), V.vec(0, wy)];
  // Repère gravé au milieu du plus haut palier (dans le contour).
  let labelX = wx / 2;
  for (let i = 0; i < webOuter.length; i++) {
    const p = webOuter[i]!;
    const q = webOuter[(i + 1) % webOuter.length]!;
    if (Math.abs(p.y - wy) < 1e-6 && Math.abs(q.y - wy) < 1e-6) labelX = (p.x + q.x) / 2;
  }
  const webFlat: FlatPattern = {
    outline: { outer: webOuter, holes: webHoles },
    lines: [
      {
        kind: "text",
        a: V.vec(labelX - 20, wy * 0.85),
        b: V.vec(labelX + 20, wy * 0.85),
        label: textMessage(s.webMark),
      },
    ],
    thickness: tw,
    reference: {
      kind: "face",
      description: msg("structure.woodCentral.reference.plateWeb", {
        mark: s.webMark,
        plate: s.mark,
        beam: beam.beamMark,
      }),
    },
  };

  // Solides : repère sur la trace (pied : tangente au milieu de la platine ; tête : au chevêtre).
  const T = trace.tangent(s.at);
  const left = trace.left(s.at);
  const o = trace.point(s.at);
  const plateSolid: Part["solid"] = s.foot
    ? {
        kind: "extrusion",
        frame: {
          origin: v3(V.addScaled(V.addScaled(o, T, -L / 2), left, -W / 2), 0),
          xAxis: h3(T),
          yAxis: h3(left),
          zAxis: UP,
        },
        profile: { outer, holes },
        depth: tp,
      }
    : {
        kind: "extrusion",
        frame: {
          origin: v3(V.addScaled(V.addScaled(o, T, -tp), left, -W / 2), beam.headBottom),
          xAxis: h3(left),
          yAxis: UP,
          zAxis: h3(T),
        },
        profile: { outer, holes },
        depth: tp,
      };
  // Âme : plan vertical sur la corde décalée (`embeddedWebLine`), extrudée de +tw/2 à −tw/2.
  const n = V.perpLeft(s.line.dir);
  const webSolid: Part["solid"] = {
    kind: "extrusion",
    frame: {
      origin: v3(V.addScaled(V.addScaled(s.line.center, s.line.dir, -wx / 2), n, tw / 2), webY0),
      xAxis: h3(s.line.dir),
      yAxis: UP,
      zAxis: h3(V.scale(n, -1)),
    },
    profile: webFlat.outline,
    depth: tw,
  };

  const plateMeas = plateMeasures(plateFlat.outline, tp);
  const plateBox = minAreaRect(outer);
  const webMeas = plateMeasures(webFlat.outline, tw);
  const plateFixings: PartFixing[] =
    an.anchors > 0
      ? [
          {
            joint: s.foot ? "plateFloor" : "plateTrimmer",
            points: an.anchors,
            holeDiameter: an.anchorHoleDiameter,
          },
        ]
      : [];
  // Broches : diamètre nominal lu sur le perçage de l'âme, longueur = largeur de la poutre.
  const webFixings: PartFixing[] =
    s.pins.length > 0
      ? [
          {
            joint: "embeddedPlatePinned",
            points: s.pins.length,
            holeDiameter: P.pinHoleDiameter,
            length: params.section.width,
            with: [beam.beamId],
          },
        ]
      : [];
  const plate: Part = {
    id: s.id,
    mark: s.mark,
    category: "fixing",
    name: msg(
      s.foot ? "structure.woodCentral.part.plateFoot" : "structure.woodCentral.part.plateHead",
    ),
    material,
    solid: plateSolid,
    flat: plateFlat,
    section: msg("structure.woodCentral.section.plate", { thickness: dec(tp, 0), grade: an.grade }),
    stock: { length: plateBox.length, width: plateBox.width, thickness: tp },
    quantities: steelQuantities(
      {
        volumeMm3: plateMeas.volumeMm3,
        treatedSurfaceMm2: plateMeas.treatedSurfaceMm2,
        length: plateBox.length,
        cuts: 1,
        laserCut: plateMeas.laserCut,
        holes: holes.length,
      },
      profile,
    ),
    assembledWith: [s.webId],
    ...(plateFixings.length > 0 ? { fixings: plateFixings } : {}),
  };
  const web: Part = {
    id: s.webId,
    mark: s.webMark,
    category: "fixing",
    name: msg(
      s.foot
        ? "structure.woodCentral.part.plateFootWeb"
        : "structure.woodCentral.part.plateHeadWeb",
    ),
    material,
    solid: webSolid,
    flat: webFlat,
    section: msg("structure.woodCentral.section.plate", { thickness: dec(tw, 0), grade: an.grade }),
    stock: { length: Math.max(wx, wy), width: Math.min(wx, wy), thickness: tw },
    quantities: steelQuantities(
      {
        volumeMm3: webMeas.volumeMm3,
        treatedSurfaceMm2: webMeas.treatedSurfaceMm2,
        length: Math.max(wx, wy),
        cuts: 1,
        laserCut: webMeas.laserCut,
        holes: webHoles.length,
        // Deux cordons d'angle le long de l'âme sur la platine.
        weld: 2 * s.webLength,
      },
      profile,
    ),
    assembledWith: [s.id, beam.beamId],
    ...(webFixings.length > 0 ? { fixings: webFixings } : {}),
  };
  return { plate, web };
}
