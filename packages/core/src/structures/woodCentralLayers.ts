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
 * C §1.11) : couches d'épaisseur finie t = `section.layerThickness` (`auto` : plus forte
 * épaisseur de débit du profil moins la surcote de corroyage), de la base de l'empilement
 * (`StackedBeamShape.baseZ`) vers le haut : couche k (k ≥ 1) entre z0 = baseZ + (k − 1)·t et
 * z1 = z0 + t ; elle couvre les abscisses σ où la poutre finie coupe cette tranche
 * (dessous(σ) < z1 et dessus(σ) > z0), prolongées de la surcote de délardement à chaque bout,
 * sur la largeur b + 2 × surcote (`section.dressingAllowance`, `auto` : `wood.planingAllowance`).
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
 *   traçage de l'axe de la trace, des faces finies, des bouts finis et des naissances.
 *
 * Question ouverte (C §1.11 [8] : « crans non coupés ») : les tranches ne sont pas calées sur les
 * altitudes des assises ; un cran peut donc tomber dans une couche.
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
}

export interface StackedLayersInput {
  readonly params: WoodCentralParams;
  readonly trace: CentralTrace;
  readonly profile: WorkshopProfile;
  /**
   * Collecteur des contrôles du plugin : les couches y ajoutent leurs contrôles de fabrication
   * (longueur de plateau `FAB_PLATEAU_LONGUEUR_MAX`, débit disponible `FAB_DEBIT_DISPONIBLE`,
   * par couche).
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
}

export interface StackedLayersResult {
  /** Pièces composantes (`componentOf` = `beam.beamId`), du bas vers le haut. */
  readonly parts: readonly Part[];
  readonly layers: readonly StackedLayer[];
  /** Épaisseur finie retenue d'une couche (`section.layerThickness` résolu), mm. */
  readonly layerThickness: Mm;
  /** Surcote de délardement retenue (`section.dressingAllowance` résolu), mm. */
  readonly dressingAllowance: Mm;
  readonly notes: readonly Message[];
  readonly errors: readonly Message[];
}

/**
 * Épaisseur finie d'une couche : saisie, ou `auto` → plus forte épaisseur de débit du profil
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

interface Slice {
  readonly z0: Mm;
  readonly z1: Mm;
  /** Aire développée de la part finie (mm²). */
  readonly area: number;
  /** Intervalles d'abscisses de la part finie, triés et fusionnés. */
  readonly spans: readonly { lo: Mm; hi: Mm }[];
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
  let zTop = -Infinity;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! > Math.max(baseZ, Math.min(bot[i]!, bot[i + 1]!))) zTop = Math.max(zTop, tops[i]!);
  }
  if (![...bot, ...tops].every(Number.isFinite) || !(zTop > baseZ)) {
    return empty([msg("structure.woodCentral.error.layerShape")]);
  }
  const n = Math.ceil((zTop - baseZ) / t - 1e-9);
  if (n > MAX_LAYERS) {
    return empty([
      msg("structure.woodCentral.error.layerCount", {
        count: n,
        thickness: dec(t, 1),
        max: MAX_LAYERS,
      }),
    ]);
  }

  // 2. Tranches : aire exacte et abscisses couvertes.
  const slices: Slice[] = [];
  for (let k = 1; k <= n; k++) {
    const z0 = baseZ + (k - 1) * t;
    const z1 = z0 + t;
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

  // 3. Une pièce par couche.
  const notes: Message[] = [];
  const parts: Part[] = [];
  const layers: StackedLayer[] = [];
  const lengthItems: CheckItem[] = [];
  const stockFindings: Finding[] = [];
  slices.forEach((slice, i) => {
    const index = i + 1;
    const partId = woodCentralLayerId(index);
    const mark = woodCentralLayerMark(beam.beamMark, index);
    const sigma0 = slice.spans[0]!.lo;
    const sigma1 = slice.spans[slice.spans.length - 1]!.hi;
    if (slice.spans.length > 1)
      notes.push(msg("structure.woodCentral.note.layerDisjoint", { mark }));
    const flat = templateOf(trace, beam, mark, sigma0, sigma1, t, s);
    const stockRes = stockOf(flat.length, flat.width, t, profile);
    const stock = stockRes.stock;
    const chord = V.sub(trace.point(sigma1), trace.point(sigma0));
    const dir = V.norm(chord) > 1e-6 ? V.normalize(chord) : trace.tangent((sigma0 + sigma1) / 2);
    parts.push({
      id: partId,
      mark,
      category: "carriage",
      name: msg("structure.woodCentral.part.layer", { index, beam: beam.beamMark }),
      material: params.material,
      solid: layerSolid(trace, beam, xs, slice, sigma0, sigma1),
      flat: flat.pattern,
      stock,
      componentOf: beam.beamId,
      quantities: woodQuantities(
        // Surface : part de la face développée de la poutre finie que forme la couche (même
        // grandeur que la poutre d'une autre filière), pas l'aire du gabarit et de ses surcotes.
        { volumeMm3: b * slice.area, surfaceMm2: slice.area, length: flat.length },
        params.material,
        profile,
        stock,
      ),
      grain: { x: dir.x, y: dir.y, z: 0 },
      assembledWith: [beam.beamId],
    });
    layers.push({ index, partId, mark, z0: slice.z0, z1: slice.z1, sigma0, sigma1 });
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
  });

  // 4. Contrôles de fabrication par couche.
  if (layers.length > 0) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.boardLength),
      lengthItems,
      msg("structure.common.check.boardLength"),
      { min: null, max: profile.wood.maxBoardLength },
    );
    checks.add(pluginRuleDef(FAB_RULES.stockAvailable), stockFindings);
    notes.unshift(
      msg("structure.woodCentral.note.stackedLayers", {
        count: layers.length,
        thickness: dec(t, 1),
        allowance: dec(s, 1),
      }),
    );
  }
  return { parts, layers, layerThickness: t, dressingAllowance: s, notes, errors: [] };
}

/**
 * Solide d'une couche : surface réglée sur la face gauche de la poutre (trace + gauche · b/2),
 * de max(dessous, z0) à min(dessus, z1), épaissie de b vers la droite. Les sections de hauteur
 * inférieure à `MIN_SECTION` (bouts en pointe) sont rognées.
 */
function layerSolid(
  trace: CentralTrace,
  beam: StackedBeamShape,
  xs: readonly Mm[],
  slice: Slice,
  sigma0: Mm,
  sigma1: Mm,
): Part["solid"] {
  const { b, bottomAt, topAt } = beam;
  const at = [sigma0, sigma1, ...slice.spans.flatMap((r) => [r.lo, r.hi])];
  const pts = [...new Set([...at, ...xs.filter((x) => x > sigma0 && x < sigma1)])].sort(
    (p, q) => p - q,
  );
  const a: Vec3[] = [];
  const top: Vec3[] = [];
  const normals: Vec2[] = [];
  const push = (x: Mm, lo: Mm, hi: Mm): void => {
    const left = trace.left(x);
    const p = V.addScaled(trace.point(x), left, b / 2);
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
    // Couche en pointe sur toute sa longueur : deux sections de hauteur minimale.
    a.length = 0;
    top.length = 0;
    normals.length = 0;
    const mid = (sigma0 + sigma1) / 2;
    const half = Math.max((sigma1 - sigma0) / 2, MIN_SECTION);
    const { lo } = sectionAt(mid);
    const z = Math.min(lo, slice.z1 - 2 * MIN_SECTION);
    for (const x of [mid - half, mid + half]) push(x, z, z + 2 * MIN_SECTION);
  }
  return { kind: "ruled", a, b: top, thickness: b, normals };
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

/**
 * Gabarit en plan d'une couche : bande à ± (b/2 + s) autour de la trace sur [σ0 − s ; σ1 + s],
 * posée dans l'axe de son rectangle minimal (coordonnées positives).
 */
function templateOf(
  trace: CentralTrace,
  beam: StackedBeamShape,
  mark: string,
  sigma0: Mm,
  sigma1: Mm,
  t: Mm,
  s: Mm,
): { pattern: FlatPattern; length: Mm; width: Mm; area: number } {
  const half = beam.b / 2;
  const w = half + s;
  const offset = (x: Mm, d: Mm): Vec2 => V.addScaled(trace.point(x), trace.left(x), d);
  const band = (x0: Mm, x1: Mm, d: Mm): Vec2[] => planGrid(trace, x0, x1).map((x) => offset(x, d));
  const a = sigma0 - s;
  const e = sigma1 + s;
  const outline = ensureCCW([...band(a, e, w), ...band(a, e, -w).reverse()]);
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
  const box = { length: Math.max(u1 - u0, v1 - v0), width: Math.min(u1 - u0, v1 - v0) };
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
    lines.push({ kind: "mark", a: toFlat(offset(x, -w)), b: toFlat(offset(x, w)), label });
  };
  polyline(band(a, e, 0), msg("structure.woodCentral.flatLine.layerAxis"));
  const face = msg("structure.woodCentral.flatLine.layerFace");
  polyline(band(sigma0, sigma1, half), face);
  polyline(band(sigma0, sigma1, -half), face);
  const end = msg("structure.woodCentral.flatLine.layerEnd");
  across(sigma0, end);
  across(sigma1, end);
  for (const nai of trace.naissances) {
    if (nai.sigma > a && nai.sigma < e) {
      across(nai.sigma, msg("structure.steelCurved.flatLine.springing"));
    }
  }
  const mid = (sigma0 + sigma1) / 2;
  const c = toFlat(trace.point(mid));
  lines.push({
    kind: "text",
    a: V.vec(c.x - TEXT_HALF, c.y),
    b: V.vec(c.x + TEXT_HALF, c.y),
    label: textMessage(mark),
  });
  return {
    pattern: {
      outline: { outer: outline.map(toFlat), holes: [] },
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
    area: area(outline),
  };
}
