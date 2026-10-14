/**
 * Trace du limon central (`steel-central`, QUESTIONS A29) : courbe en plan de l'axe de la
 * poutre et courbe des nez prise sur cette trace.
 *
 * - **Volées** (droit, tournants) : axe de l'emmarchement (courbe parallèle au bord du jour à
 *   E/2), décalé de `trace.lateralOffset` (positif vers la gauche de la montée). Au droit d'un
 *   tournant, la parallèle côté mur d'un jour vif est un arc de rayon E/2 centré au coin, celle
 *   d'un jour en arc de rayon r_j un arc de rayon r_j + E/2 : la trace est toujours tangente
 *   (G1), droite par morceaux et arcs (limon débillardé). Escalier en S / Z : chaque tournant
 *   est pris du côté de son propre jour, raccord sur la partie droite intermédiaire.
 * - **Poteau d'angle** du tracé (jour `newel`) : le limon central ne le génère pas ; le bord du
 *   jour qui contourne le poteau est ramené au coin intérieur K (droites des volées prolongées
 *   jusqu'à K), puis traité comme un jour vif (arc de rayon d centré en K). Remarque émise.
 * - **Cage saisie** (ADR-0010, sous-lot 6c, `cageCurve`, convention à valider, QUESTIONS F18) :
 *   lue sur `Layout.sections` et `Layout.turns` ; arc autour de chaque jour (coin K, centre du
 *   jour en arc, extrémités d'un pan coupé) à la moitié de la plus petite largeur de la jonction
 *   ∓ décalage, tangentes communes droites entre deux jours (croisées entre deux tournants de
 *   sens opposés, droites à travers un palier droit), extrémités d'équerre sur les lignes de
 *   départ et d'arrivée. À largeur uniforme : exactement la trace des volées. Le raccord côté
 *   mur n'intervient pas (poutre sous les marches). Axe en arc : refusé (`CENTRAL_CAGE`).
 * - **Hélicoïdal** : arc de rayon (R_i + R_e)/2 + décalage autour de l'axe du tracé, du nez de
 *   départ au nez d'arrivée (le palier d'arrivée éventuel n'est pas sous la trace : il est au
 *   niveau du plancher d'arrivée). Fût (`core = column`) : non porteur, non généré (remarque).
 * - σ = abscisse curviligne sur la trace (prolongée par ses tangentes au-delà des extrémités) ;
 *   chaque ligne de nez coupe la trace en un point d'abscisse `nosingSigma[k]`.
 * - Courbe des nez sur la trace `nosingZ(σ)` : interpolation cubique monotone C1
 *   (Fritsch–Carlson, `monotoneHermite`) par les nœuds (σ_k, z_k) ; sur une marche palière
 *   (entre les nez k et k + 1), un nœud (σ_{k+1} − g, z_k) est ajouté (g : giron suivant sur la
 *   trace) : la courbe reste de niveau sur le palier puis monte sur un giron, même convention que
 *   la ligne des nez des limons (`nosingPitchLine`). Pentes d'extrémité = pentes des marches
 *   voisines ; prolongement linéaire hors des nez extrêmes. Sur une partie droite à girons égaux,
 *   la courbe est exactement la droite h / g (dérivées de Fritsch–Carlson égales aux sécantes).
 *
 * Contrat partagé de la vague « limon central » (interfaces **figées**) : implémenté par la
 * tâche « poutre », lu par le plugin (supports, prédimensionnement, contrôles).
 */
import { dec, errorMessage, msg, type Message } from "@blondel/i18n";
import { cumulativeLengths, curvePointAt, makeCurve, subCurve } from "../geom2d/curve.js";
import {
  distanceToCurve,
  intersectLineCurve,
  intersectLines,
  projectOnCurve,
} from "../geom2d/intersect.js";
import { offsetCurve } from "../geom2d/offset.js";
import { arcSeg, lineSeg, segEnd, segLength, segStart, segTangentAt } from "../geom2d/segment.js";
import { ANGLE_EPS, GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { splitArc } from "../geom2d/arc.js";
import type { CageFeature } from "../model/cageFeatures.js";
import type { Layout, LayoutSection, NosingLine, Stepping } from "../model/derived.js";
import type { StructureContext } from "../model/plugins.js";
import type { Curve2, CurveSeg, Mm, Vec2 } from "../model/primitives.js";
import type { LayoutSpec } from "../model/project.js";
import {
  monotoneHermite,
  naissances,
  pointAtExtended,
  tangentAtExtended,
  type Naissance,
} from "./steelCurvedGeometry.js";

/**
 * Paramètres lus par la trace (sous-ensemble commun de `steel-central` et `wood-central`) :
 * décalage latéral de l'axe et largeur de la section (contrôle d'emprise et de rayon d'axe).
 */
export interface CentralTraceParams {
  readonly trace: { readonly lateralOffset: Mm };
  readonly section: { readonly width: Mm };
}

/**
 * Fonctions de cage saisie (ADR-0010, sous-lot 6c) que les limons centraux (`wood-central`,
 * `steel-central`) savent construire : la trace (`cageCurve`) ne lit que les tronçons, le côté du
 * jour et le raccord du jour de chaque jonction. Refusé : l'axe en arc (lot « acier cintré »).
 */
export const CENTRAL_CAGE: readonly CageFeature[] = [
  "anyAngle",
  "variableWidth",
  "straightLanding",
  "wallArc",
  "chamfer",
  "radiating",
  "oppositeTurns",
];

/** Type de trace : droite (escalier droit), débillardée (tournants), hélicoïdale. */
export type CentralTraceKind = "straight" | "turning" | "helical";

export interface CentralTrace {
  readonly kind: CentralTraceKind;
  /** Trace en plan de l'axe de la poutre, orientée dans le sens de la montée (repère monde). */
  readonly curve: Curve2;
  /** Longueur de `curve` (mm). */
  readonly length: Mm;
  /** Point de la trace en σ (prolongée par ses tangentes hors de [0 ; length]). */
  point(sigma: Mm): Vec2;
  /** Tangente unitaire horizontale en σ (sens de la montée, bornée aux extrémités). */
  tangent(sigma: Mm): Vec2;
  /** Normale unitaire horizontale à gauche de la montée en σ (perpLeft de la tangente). */
  left(sigma: Mm): Vec2;
  /** Abscisse sur la trace de chaque nez (intersection ligne de nez × trace), indice du nez. */
  readonly nosingSigma: readonly Mm[];
  /** Altitude de la ligne des nez prise sur la trace en σ (C1, monotone, prolongée). */
  nosingZ(sigma: Mm): Mm;
  /** Pente développée nominale de la ligne des nez sur les parties droites (h / g sur la trace). */
  readonly slope: number;
  /** Naissances (jonctions droite / arc ou arcs de rayons différents), σ croissants. */
  readonly naissances: readonly Naissance[];
  /** Arcs de la trace : rayon d'axe et portée en σ (vide pour une trace droite). */
  readonly arcs: readonly {
    readonly radius: Mm;
    readonly sigma0: Mm;
    readonly sigma1: Mm;
    /** Centre de l'arc du côté gauche de la montée (tournant à gauche). */
    readonly turnsLeft: boolean;
  }[];
  /** Remarques non bloquantes (fût d'un hélicoïdal non porteur…). */
  readonly notes: readonly Message[];
}

export type CentralTraceResult =
  | { readonly ok: true; readonly trace: CentralTrace }
  | { readonly ok: false; readonly errors: readonly Message[] };

/** Écart toléré au raccord de deux courbes parallèles (escalier en S / Z), mm. */
const SPLICE_TOL: Mm = 1e-3;
/** Écart angulaire toléré aux jonctions de la trace (G1), rad. */
const G1_TOL = 1e-6;
/** Débord toléré d'une intersection ligne de nez × trace hors du segment [Q ; R] (fraction). */
const NOSING_SEGMENT_TOL = 1e-6;

/**
 * Trace du limon central pour le tracé de `ctx` (volées ou hélicoïdal). Ne lève jamais :
 * configuration non prise en charge → `{ ok: false, errors }`.
 */
export function buildCentralTrace(
  ctx: StructureContext,
  params: CentralTraceParams,
): CentralTraceResult {
  try {
    return traceOf(ctx, params);
  } catch (err) {
    return {
      ok: false,
      errors: [msg("structure.steelCentral.error.traceNotBuilt", { detail: errorMessage(err) })],
    };
  }
}

/**
 * Emmarchement repris par la poutre unique (prédimensionnement, domaine des règles de moyens) :
 * largeur du tracé à volées ; cage saisie : **plus grande** largeur de ses tronçons (sous-lot 6c,
 * du côté de la sécurité, comme les limons des sous-lots 6a et 6b) ; hélicoïdal : R_e − R_i.
 */
export function centralStairWidth(ctx: StructureContext): Mm {
  const h = ctx.layout.helical;
  if (h) return h.outerRadius - h.innerRadius;
  const lay = ctx.project.stair.layout;
  if (lay.kind === "helical") return 0;
  if (lay.kind === "cage" && ctx.layout.sections && ctx.layout.sections.length > 0) {
    return Math.max(...ctx.layout.sections.flatMap((s) => [s.widthStart, s.widthEnd]));
  }
  return lay.width;
}

/** Dessus de la poutre en σ : ligne des nez sur la trace moins `topOffset` (mm). */
export function beamTopAt(trace: CentralTrace, topOffset: Mm, sigma: Mm): Mm {
  return trace.nosingZ(sigma) - topOffset;
}

// ------------------------------------------------------------------ Construction

type Built = { readonly curve: Curve2; readonly notes: Message[] } | { readonly errors: Message[] };

function traceOf(ctx: StructureContext, params: CentralTraceParams): CentralTraceResult {
  const { layout, stepping, project } = ctx;
  if (stepping.nosings.length < 2) {
    return { ok: false, errors: [msg("structure.steelCentral.error.traceTooFewNosings")] };
  }
  const half = params.section.width / 2;
  const built = layout.helical
    ? helicalCurve(layout, params)
    : layout.cage === true
      ? cageCurve(layout, params)
      : flightsCurve(layout, project.stair.layout, params);
  if ("errors" in built) return { ok: false, errors: built.errors };
  const { curve, notes } = built;
  const length = cumulativeLengths(curve).at(-1) ?? 0;
  if (!(length > GEOM_EPS)) {
    return { ok: false, errors: [msg("structure.steelCentral.error.traceDegenerate")] };
  }

  // Continuité tangentielle (G1).
  for (let i = 1; i < curve.segments.length; i++) {
    const a = segTangentAt(curve.segments[i - 1]!, 1);
    const b = segTangentAt(curve.segments[i]!, 0);
    if (Math.abs(V.signedAngle(a, b)) > G1_TOL) {
      const sigma = cumulativeLengths(curve)[i]!;
      return {
        ok: false,
        errors: [msg("structure.steelCentral.error.traceNotTangent", { sigma: dec(sigma, 0) })],
      };
    }
  }

  // Arcs (arcs consécutifs de même centre, rayon et sens fusionnés) ; rayon d'axe > b/2.
  const cum = cumulativeLengths(curve);
  const arcs: { radius: Mm; sigma0: Mm; sigma1: Mm; turnsLeft: boolean; center: Vec2 }[] = [];
  curve.segments.forEach((seg, i) => {
    if (seg.kind !== "arc" || !(segLength(seg) > GEOM_EPS)) return;
    const last = arcs.at(-1);
    const turnsLeft = seg.sweep > 0;
    if (
      last &&
      Math.abs(last.sigma1 - cum[i]!) < GEOM_EPS &&
      Math.abs(last.radius - seg.radius) < GEOM_EPS &&
      V.equals(last.center, seg.center) &&
      last.turnsLeft === turnsLeft
    ) {
      last.sigma1 = cum[i + 1]!;
      return;
    }
    arcs.push({
      radius: seg.radius,
      sigma0: cum[i]!,
      sigma1: cum[i + 1]!,
      turnsLeft,
      center: seg.center,
    });
  });
  const tight = arcs.find((a) => !(a.radius > half + GEOM_EPS));
  if (tight) {
    return {
      ok: false,
      errors: [
        msg("structure.steelCentral.error.axisRadiusTooSmall", {
          radius: dec(tight.radius, 0),
          half: dec(half, 0),
        }),
      ],
    };
  }

  // Abscisses des nez sur la trace.
  const P = (s: Mm): Vec2 => pointAtExtended(curve, cum, s);
  const T = (s: Mm): Vec2 => tangentAtExtended(curve, cum, s);
  const nosingSigma: Mm[] = [];
  for (const k of stepping.nosings) {
    const s = nosingOnTrace(k, curve, length, P, T, nosingSigma.at(-1));
    if (s === null) {
      return {
        ok: false,
        errors: [msg("structure.steelCentral.error.nosingMissesTrace", { nosing: k.index })],
      };
    }
    nosingSigma.push(s);
  }
  for (let i = 1; i < nosingSigma.length; i++) {
    if (!(nosingSigma[i]! > nosingSigma[i - 1]! + GEOM_EPS)) {
      return {
        ok: false,
        errors: [
          msg("structure.steelCentral.error.nosingsNotIncreasing", {
            nosing: stepping.nosings[i]!.index,
          }),
        ],
      };
    }
  }

  const nosingZ = nosingCurve(stepping, nosingSigma);
  const slope = nominalSlope(curve, cum, stepping, nosingSigma);
  const kind: CentralTraceKind = layout.helical
    ? "helical"
    : arcs.length > 0
      ? "turning"
      : "straight";
  const trace: CentralTrace = {
    kind,
    curve,
    length,
    point: P,
    tangent: T,
    left: (s) => V.perpLeft(T(s)),
    nosingSigma,
    nosingZ,
    slope,
    naissances: naissances(curve),
    arcs: arcs.map(({ center: _c, ...a }) => a),
    notes,
  };
  return { ok: true, trace };
}

/** Trace hélicoïdale : arc de rayon (R_i + R_e)/2 + décalage, du nez 0 au nez d'arrivée. */
function helicalCurve(layout: Layout, params: CentralTraceParams): Built {
  const h = layout.helical!;
  const sign = h.direction === "left" ? 1 : -1;
  // Montée à gauche (sens trigonométrique) : la gauche de la montée est vers l'axe.
  const radius = (h.innerRadius + h.outerRadius) / 2 - sign * params.trace.lateralOffset;
  const half = params.section.width / 2;
  if (radius - half < h.innerRadius - GEOM_EPS || radius + half > h.outerRadius + GEOM_EPS) {
    return {
      errors: [
        msg("structure.steelCentral.error.beamOutsideWidth", {
          offset: dec(params.trace.lateralOffset, 0),
          width: dec(params.section.width, 0),
        }),
      ],
    };
  }
  if (!(h.totalAngle > 0)) return { errors: [msg("structure.steelCentral.error.traceDegenerate")] };
  const curve = makeCurve(splitArc(h.center, radius, h.startAngle, sign * h.totalAngle));
  const notes: Message[] = [];
  if (h.core === "column") notes.push(msg("structure.steelCentral.note.columnNotCarrying"));
  return { curve, notes };
}

/**
 * Trace d'un escalier à volées : parallèle au bord du jour (`Layout.inner`) à d_A = E/2 ∓
 * décalage, côté mur ; tournants de sens opposé (S / Z) : parallèle au bord `Layout.outer` à
 * d_B = E − d_A côté jour, raccordée dans la partie droite intermédiaire.
 */
function flightsCurve(
  layout: Layout,
  spec: Pick<LayoutSpec, "width" | "turns">,
  params: CentralTraceParams,
): Built {
  const width = spec.width;
  const half = params.section.width / 2;
  const sIn = layout.innerSide === "left" ? 1 : -1;
  const dA = width / 2 - sIn * params.trace.lateralOffset;
  const dB = width - dA;
  if (dA - half < -GEOM_EPS || dB - half < -GEOM_EPS) {
    return {
      errors: [
        msg("structure.steelCentral.error.beamOutsideWidth", {
          offset: dec(params.trace.lateralOffset, 0),
          width: dec(params.section.width, 0),
        }),
      ],
    };
  }
  if (layout.zeroLengthInner && layout.zeroLengthInner.length > 0) {
    return { errors: [msg("structure.steelCentral.error.zeroLengthWell")] };
  }
  const notes: Message[] = [];
  const turns = layout.turns;
  const corners: NewelCorner[] = [];
  spec.turns.forEach((t, j) => {
    const zone = turns[j];
    if (t.inner.kind !== "newel" || !zone) return;
    // Contour du poteau (côté a, décalé de `offset` vers le jour) : à moins de (a/2 + offset)·√2 de K.
    corners.push({
      k: zone.innerCorner,
      reach: (t.inner.size / 2 + (t.inner.offset ?? 0)) * Math.SQRT2 + 1,
      ...turnDirections(zone.innerCorner, zone.outerCorner, zone.direction),
    });
  });
  if (corners.length > 0) notes.push(msg("structure.steelCentral.note.newelNotGenerated"));
  const allCorners: NewelCorner[] = turns.map((zone) => ({
    k: zone.innerCorner,
    reach: 0,
    ...turnDirections(zone.innerCorner, zone.outerCorner, zone.direction),
  }));
  const prepare = (c: Curve2): Curve2 =>
    cornerStubs(
      squareNewels(
        c,
        corners,
        allCorners.map((x) => x.k),
      ),
      allCorners,
    );
  const away = layout.innerSide === "left" ? "right" : "left";
  const A = offsetCurve(prepare(layout.inner), dA, away);
  const sources = turns.map((t) =>
    (t.collarSide ?? layout.innerSide) === layout.innerSide ? 0 : 1,
  );
  if (!sources.includes(1)) return { curve: A, notes };
  const B = offsetCurve(prepare(layout.outer), dB, layout.innerSide);
  const curves = [A, B];
  const pieces: Curve2[] = [];
  let cur = sources[0]!;
  let from = 0;
  for (let j = 0; j + 1 < turns.length; j++) {
    const next = sources[j + 1]!;
    if (next === cur) continue;
    // Raccord au milieu de la partie droite entre les deux tournants (ligne de foulée).
    const sMid = (turns[j]!.sEnd + turns[j + 1]!.sStart) / 2;
    const pm = curvePointAt(layout.walkline, sMid);
    const a = projectOnCurve(pm, curves[cur]!);
    const b = projectOnCurve(pm, curves[next]!);
    if (V.distance(a.point, b.point) > SPLICE_TOL) {
      return {
        errors: [
          msg("structure.steelCentral.error.traceSplice", {
            turn: j + 1,
            gap: dec(V.distance(a.point, b.point), 1),
          }),
        ],
      };
    }
    pieces.push(subCurve(curves[cur]!, from, a.s));
    cur = next;
    from = b.s;
  }
  const last = curves[cur]!;
  pieces.push(subCurve(last, from, cumulativeLengths(last).at(-1)!));
  const segs: CurveSeg[] = [];
  for (const p of pieces) {
    for (const seg of p.segments) {
      if (!(segLength(seg) > GEOM_EPS)) continue;
      const prev = segs.at(-1);
      // Recollage exact au raccord (écart numérique ≤ SPLICE_TOL).
      if (prev && seg.kind === "line") segs.push(lineSeg(segEnd(prev), seg.b));
      else if (prev && prev.kind === "line" && seg.kind === "arc") {
        segs[segs.length - 1] = lineSeg(prev.a, segStart(seg));
        segs.push(seg);
      } else segs.push(seg);
    }
  }
  return { curve: makeCurve(segs, SPLICE_TOL), notes };
}

// ------------------------------------------------------------------ Cage saisie (sous-lot 6c)

/**
 * Pivot de la trace d'une cage : cercle autour duquel la trace tourne à une jonction tournante
 * (coin du jour K, centre d'un jour en arc, extrémité d'un pan coupé), parcouru du côté `side`
 * (+1 : centre à gauche de la montée, tournant à gauche).
 */
interface Pivot {
  readonly center: Vec2;
  readonly radius: Mm;
  readonly side: 1 | -1;
  /** Indice de la jonction. */
  readonly junction: number;
  /** Angle |θ| de la jonction (rad, borne du balayage de l'arc). */
  readonly turn: number;
}

/** Pas d'échantillonnage du contrôle d'emprise de la poutre sur une cage (mm, borne de calcul). */
const CAGE_SAMPLE_STEP: Mm = 25;

/**
 * Trace d'une cage saisie (ADR-0010, sous-lot 6c ; convention à valider, QUESTIONS F18) :
 *
 * - à chaque jonction tournante, l'axe tourne autour du jour à la distance ρ = W/2 ∓ décalage
 *   (`trace.lateralOffset`, positif vers la gauche), W étant la plus petite des deux largeurs à
 *   la jonction (même convention que d_f, F1) : arc de centre K (jour vif ; poteau, non généré,
 *   comme en volées), du centre du jour en arc (rayon r + ρ) ou de chaque extrémité du pan
 *   coupé (« pivots ») ;
 * - entre deux pivots, l'axe est leur tangente commune (droite, croisée entre deux tournants de
 *   sens opposés) ; un palier droit n'a pas de pivot : l'axe le traverse en ligne droite ;
 * - aux extrémités, l'axe est **perpendiculaire** à la ligne de départ (d'arrivée) et tangent au
 *   premier (dernier) pivot : la coupe d'aplomb de tête reste d'équerre sur le chevêtre et la
 *   face avant sous le nez 0, comme en volées ; sans jonction tournante (droit, paliers droits),
 *   droite perpendiculaire aux deux lignes, à mi-chemin de leurs milieux, ramenée dans
 *   l'emmarchement si elle en sort (`straightAxisPosition`), puis décalée.
 *
 * La trace est continue en tangente (G1) par construction. À largeur uniforme, c'est exactement
 * la parallèle au bord du jour des volées (`flightsCurve`), prouvé par les tests. La poutre doit
 * rester dans l'emmarchement : distance de l'axe aux deux bords ≥ demi-largeur de la section,
 * contrôlée sur toute la trace (`beamOutsideWidth`, ou `cageAxisOutsideWidth` sur une cage de
 * largeur variable qui tourne : la convention fixe alors l'axe) ; tangentes impossibles ou à rebours
 * (jonctions trop proches) : `cageTraceJunction`.
 */
function cageCurve(layout: Layout, params: CentralTraceParams): Built {
  const sections = layout.sections ?? [];
  const degenerate = (): Built => ({
    errors: [msg("structure.steelCentral.error.traceDegenerate")],
  });
  if (sections.length === 0) return degenerate();
  if (layout.zeroLengthInner && layout.zeroLengthInner.length > 0) {
    return { errors: [msg("structure.steelCentral.error.zeroLengthWell")] };
  }
  const offset = params.trace.lateralOffset;
  const half = params.section.width / 2;
  const outside = (): Built => ({
    errors: [
      msg("structure.steelCentral.error.beamOutsideWidth", {
        offset: dec(offset, 0),
        width: dec(params.section.width, 0),
      }),
    ],
  });
  const outsideVariable = (): Built => ({
    errors: [
      msg("structure.steelCentral.error.cageAxisOutsideWidth", {
        offset: dec(offset, 0),
        width: dec(params.section.width, 0),
      }),
    ],
  });
  const notes: Message[] = [];
  // Largeur variable : convention de l'axe à valider (QUESTIONS F18), rappelée en remarque.
  const w0 = sections[0]!.widthStart;
  const variable = sections.some((s) => s.widthStart !== w0 || s.widthEnd !== w0);
  if (variable) notes.push(msg("structure.steelCentral.note.cageAxis"));

  const pivots: Pivot[] = [];
  for (const zone of layout.turns) {
    const theta = zone.angle ?? (zone.direction === "left" ? Math.PI / 2 : -Math.PI / 2);
    if (Math.abs(theta) <= ANGLE_EPS) continue; // palier droit : aucun pivot
    const a = sections[zone.index];
    const b = sections[zone.index + 1];
    if (!a || !b) return degenerate();
    const sideName = zone.collarSide ?? zone.direction;
    const side: 1 | -1 = sideName === "left" ? 1 : -1;
    const rho = Math.min(a.widthEnd, b.widthStart) / 2 - side * offset;
    if (!(rho > 0)) return outside();
    const dIn = sectionEdgeDir(a, sideName);
    const dOut = sectionEdgeDir(b, sideName);
    // Vers le jour depuis son bord (centre d'un jour en arc, côté du vide).
    const towardWell = (d: Vec2): Vec2 => (side > 0 ? V.perpLeft(d) : V.perpRight(d));
    const k = zone.innerCorner;
    const well = zone.well ?? { kind: "sharp" as const };
    const pivot = (center: Vec2, radius: Mm): Pivot => ({
      center,
      radius,
      side,
      junction: zone.index,
      turn: Math.abs(theta),
    });
    if (well.kind === "arc") {
      const hit = intersectLines(
        { origin: V.addScaled(k, towardWell(dIn), well.radius), dir: dIn },
        { origin: V.addScaled(k, towardWell(dOut), well.radius), dir: dOut },
      );
      if (!hit) return { errors: [cageJunctionError(zone.index)] };
      pivots.push(pivot(hit.point, well.radius + rho));
    } else if (well.kind === "chamfer") {
      pivots.push(pivot(V.addScaled(k, dIn, -well.setbackIn), rho));
      pivots.push(pivot(V.addScaled(k, dOut, well.setbackOut), rho));
    } else {
      const newelNote = msg("structure.steelCentral.note.newelNotGenerated");
      if (well.kind === "newel" && !notes.some((n) => n.key === newelNote.key)) {
        notes.push(newelNote);
      }
      pivots.push(pivot(k, rho));
    }
  }

  // Pivots confondus (demi-tour sans partie droite du jour) : un seul arc.
  const merged: Pivot[] = [];
  for (const p of pivots) {
    const last = merged.at(-1);
    if (
      last &&
      last.side === p.side &&
      V.distance(last.center, p.center) <= GEOM_EPS &&
      Math.abs(last.radius - p.radius) <= GEOM_EPS
    ) {
      merged[merged.length - 1] = { ...last, turn: last.turn + p.turn };
      continue;
    }
    merged.push(p);
  }

  // Lignes de départ et d'arrivée : direction de la montée.
  const startLine = sections[0]!.start;
  const endLine = sections.at(-1)!.end;
  const climb = (l: LayoutSection["start"]): Vec2 =>
    V.normalize(V.perpLeft(V.sub(l.right, l.left)));
  const u0 = climb(startLine);
  const uN = climb(endLine);

  const segs: CurveSeg[] = [];
  const pushLine = (a: Vec2, b: Vec2): void => {
    if (V.distance(a, b) > GEOM_EPS) {
      segs.push(lineSeg(segs.length > 0 ? segEnd(segs.at(-1)!) : a, b));
    }
  };
  if (merged.length === 0) {
    // Droit ou paliers droits seulement : lignes parallèles ; droite d'équerre à mi-chemin des
    // milieux, ramenée dans l'emmarchement si elle en sort (trapèze ancré côté mur ou jour).
    if (Math.abs(V.cross(u0, uN)) > ANGLE_EPS || !(V.dot(u0, uN) > 0)) return degenerate();
    const n = V.perpLeft(u0);
    const m0 = V.lerp(startLine.left, startLine.right, 0.5);
    const mN = V.lerp(endLine.left, endLine.right, 0.5);
    const at = (c: number): [Vec2, Vec2] => [
      V.addScaled(m0, n, c - V.dot(m0, n)),
      V.addScaled(mN, n, c - V.dot(mN, n)),
    ];
    const c = straightAxisPosition(
      (V.dot(m0, n) + V.dot(mN, n)) / 2,
      at,
      [layout.inner, layout.outer],
      n,
      half,
      [
        Math.max(V.dot(startLine.right, n), V.dot(endLine.right, n)),
        Math.min(V.dot(startLine.left, n), V.dot(endLine.left, n)),
      ],
    );
    const [p0, pN] = at(c + offset);
    pushLine(p0, pN);
  } else {
    // Contact de la droite de direction u tangente au pivot p (centre du côté `side`).
    const touch = (p: Pivot, u: Vec2): Vec2 =>
      V.addScaled(p.center, V.perpLeft(u), -p.side * p.radius);
    const first = merged[0]!;
    const last = merged.at(-1)!;
    const t0 = touch(first, u0);
    const tN = touch(last, uN);
    const s0 = V.addScaled(t0, u0, V.dot(V.sub(startLine.left, t0), u0));
    const sN = V.addScaled(tN, uN, V.dot(V.sub(endLine.left, tN), uN));
    if (V.dot(V.sub(t0, s0), u0) < -GEOM_EPS)
      return { errors: [cageJunctionError(first.junction)] };
    if (V.dot(V.sub(sN, tN), uN) < -GEOM_EPS) return { errors: [cageJunctionError(last.junction)] };
    // Points d'entrée et de sortie de chaque pivot (tangentes communes entre pivots).
    const entries: Vec2[] = [t0];
    const exits: Vec2[] = [];
    for (let i = 0; i + 1 < merged.length; i++) {
      const t = commonTangent(merged[i]!, merged[i + 1]!);
      if (!t) return { errors: [cageJunctionError(merged[i + 1]!.junction)] };
      exits.push(t.from);
      entries.push(t.to);
    }
    exits.push(tN);
    pushLine(s0, t0);
    for (let i = 0; i < merged.length; i++) {
      const p = merged[i]!;
      const a0 = V.angleOf(V.sub(entries[i]!, p.center));
      const a1 = V.angleOf(V.sub(exits[i]!, p.center));
      let sweep = (((p.side * (a1 - a0)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (sweep > 2 * Math.PI - 1e-9) sweep = 0;
      // Arc qui fait le tour du pivot : tangentes dans le désordre (pivots trop proches).
      if (sweep > p.turn + Math.PI / 2) return { errors: [cageJunctionError(p.junction)] };
      if (p.radius * sweep > GEOM_EPS) segs.push(arcSeg(p.center, p.radius, a0, p.side * sweep));
      pushLine(exits[i]!, i + 1 < merged.length ? entries[i + 1]! : sN);
    }
  }
  if (segs.length === 0) return degenerate();
  const curve = makeCurve(segs, SPLICE_TOL);

  // Poutre dans l'emmarchement : distance de l'axe à chaque bord ≥ demi-largeur de la section.
  const cum = cumulativeLengths(curve);
  const length = cum.at(-1)!;
  const step = Math.min(CAGE_SAMPLE_STEP, Math.max(half, 1));
  const samples = new Set<Mm>(cum);
  for (let s = 0; s < length; s += step) samples.add(s);
  for (const s of samples) {
    const q = curvePointAt(curve, Math.min(Math.max(s, 0), length));
    if (
      distanceToCurve(q, layout.inner) < half - GEOM_EPS ||
      distanceToCurve(q, layout.outer) < half - GEOM_EPS
    ) {
      // Largeur variable avec jonction tournante : la position de l'axe est imposée par la
      // convention (d'équerre aux extrémités, tangent aux jours), erreur qui la nomme.
      return merged.length > 0 && variable ? outsideVariable() : outside();
    }
  }
  return { curve, notes };
}

/** Axe droit (cage sans jonction tournante) : clearance minimale aux bords, échantillonnée. */
function lineClearance(a: Vec2, b: Vec2, edge: Curve2, step: Mm): number {
  const len = V.distance(a, b);
  const count = Math.max(1, Math.ceil(len / step));
  let min = Infinity;
  for (let i = 0; i <= count; i++) {
    min = Math.min(min, distanceToCurve(V.lerp(a, b, i / count), edge));
  }
  return min;
}

/** Itérations de la dichotomie de `straightAxisPosition` (borne de calcul, ≈ 1e-9 de l'écart). */
const AXIS_BISECTION_STEPS = 40;

/**
 * Position (coordonnée selon `n`, sans décalage latéral) de l'axe droit d'une cage sans jonction
 * tournante : `preferred` (mi-chemin des milieux) s'il laisse la demi-largeur `half` aux deux
 * bords, sinon la position admissible la plus proche, cherchée par dichotomie dans `range`
 * (intersection des lignes de départ et d'arrivée) : la clearance au bord de gauche décroît
 * quand l'axe s'en approche, celle au bord de droite croît. Sans position admissible :
 * `preferred` (le contrôle d'emprise rend alors l'erreur).
 */
function straightAxisPosition(
  preferred: number,
  at: (c: number) => [Vec2, Vec2],
  edges: readonly Curve2[],
  n: Vec2,
  half: Mm,
  range: readonly [number, number],
): number {
  const step = Math.min(CAGE_SAMPLE_STEP, Math.max(half, 1));
  const fits = (c: number, edge: Curve2): boolean =>
    lineClearance(...at(c), edge, step) >= half - GEOM_EPS / 2;
  if (edges.every((e) => fits(preferred, e))) return preferred;
  const [a, b] = range;
  if (!(b - a > 2 * half)) return preferred;
  // Côté de chaque bord : position moyenne de ses sommets selon n.
  const sideOf = (edge: Curve2): number => {
    const pts = edge.segments.map((sg) => segStart(sg));
    const mean = pts.reduce((acc, p) => acc + V.dot(p, n), 0) / Math.max(pts.length, 1);
    return mean - (a + b) / 2;
  };
  let lo = a;
  let hi = b;
  for (const edge of edges) {
    const left = sideOf(edge) > 0;
    // Bord de gauche : admissible pour c ≤ c* ; bord de droite : pour c ≥ c*.
    let x = a;
    let y = b;
    if (left ? !fits(a, edge) : !fits(b, edge)) return preferred;
    for (let i = 0; i < AXIS_BISECTION_STEPS; i++) {
      const mid = (x + y) / 2;
      if (fits(mid, edge) === left) x = mid;
      else y = mid;
    }
    if (left) hi = Math.min(hi, x);
    else lo = Math.max(lo, y);
  }
  if (!(lo <= hi)) return preferred;
  return Math.min(Math.max(preferred, lo), hi);
}

function cageJunctionError(junction: number): Message {
  return msg("structure.steelCentral.error.cageTraceJunction", { junction: junction + 1 });
}

/**
 * Direction unitaire (sens de la montée) du bord `side` d'un tronçon : de son départ à son
 * arrivée ; partie droite nulle : normale à la ligne d'arrivée.
 */
function sectionEdgeDir(sec: LayoutSection, side: "left" | "right"): Vec2 {
  const v = V.sub(sec.end[side], sec.start[side]);
  if (V.norm(v) > GEOM_EPS) return V.normalize(v);
  return V.normalize(V.perpLeft(V.sub(sec.end.right, sec.end.left)));
}

/**
 * Tangente commune orientée de A vers B : direction t telle que A est à `A.side` et B à
 * `B.side` de la droite parcourue dans le sens t ; points de contact.
 * `null` si elle n'existe pas (cercles qui se recoupent) ou recule.
 */
function commonTangent(A: Pivot, B: Pivot): { from: Vec2; to: Vec2 } | null {
  const D = V.sub(B.center, A.center);
  const dist = V.norm(D);
  const k = B.side * B.radius - A.side * A.radius;
  if (!(dist > GEOM_EPS) || Math.abs(k) > dist + GEOM_EPS) return null;
  const phi = V.angleOf(D) - Math.asin(Math.max(-1, Math.min(1, k / dist)));
  const t = V.fromAngle(phi);
  const n = V.perpLeft(t);
  const from = V.addScaled(A.center, n, -A.side * A.radius);
  const to = V.addScaled(B.center, n, -B.side * B.radius);
  if (V.dot(V.sub(to, from), t) < -GEOM_EPS) return null;
  return { from, to };
}

/**
 * Poteau d'angle du tracé : coin intérieur K, portée de son contour autour de K et directions
 * (unitaires) des volées entrante et sortante.
 */
interface NewelCorner {
  readonly k: Vec2;
  readonly reach: Mm;
  readonly incoming: Vec2;
  readonly outgoing: Vec2;
}

/**
 * Directions des volées d'un tournant à 90° : le coin extérieur est en K + E·(d_in − d_out),
 * d'où d_in = (K_e − K)/|K_e − K| tourné de ±45° (+ pour un tournant à gauche) et d_out = d_in
 * tourné de ±90°.
 */
function turnDirections(
  inner: Vec2,
  outer: Vec2,
  direction: "left" | "right",
): { incoming: Vec2; outgoing: Vec2 } {
  const u = V.normalize(V.sub(outer, inner));
  const incoming = V.rotate(u, direction === "left" ? Math.PI / 4 : -Math.PI / 4);
  return {
    incoming,
    outgoing: direction === "left" ? V.perpLeft(incoming) : V.perpRight(incoming),
  };
}

/** Amorce droite ajoutée devant un bord de jour qui commence au coin d'un tournant (mm). */
const CORNER_STUB: Mm = 1;

/**
 * Bord de jour qui commence (ou finit) exactement au coin K d'un tournant (volée de départ ou
 * d'arrivée sans partie droite côté jour) : une amorce droite de `CORNER_STUB` dans la direction
 * de la volée entrante (sortante) est ajoutée, pour que la parallèle contourne K par un arc
 * (sinon la parallèle commencerait après le tournant).
 */
function cornerStubs(curve: Curve2, corners: readonly NewelCorner[]): Curve2 {
  const segs = [...curve.segments];
  if (segs.length === 0) return curve;
  const a = segStart(segs[0]!);
  const b = segEnd(segs[segs.length - 1]!);
  const atStart = corners.find((c) => V.distance(a, c.k) <= 1e-6);
  const atEnd = corners.find((c) => V.distance(b, c.k) <= 1e-6);
  if (atStart) segs.unshift(lineSeg(V.addScaled(a, atStart.incoming, -CORNER_STUB), a));
  if (atEnd) segs.push(lineSeg(b, V.addScaled(b, atEnd.outgoing, CORNER_STUB)));
  return { segments: segs };
}

/**
 * Bord de jour ramené au coin K pour chaque poteau d'angle : la suite de segments dont une
 * extrémité est sur le contour du poteau (à moins de `reach` de K) est remplacée par la droite
 * de la volée entrante jusqu'à K, puis celle de la volée sortante (les deux bords du jour passent
 * par K). Une courbe qui commence (ou finit) sur le poteau part de la projection de son origine
 * sur la droite entrante (ou finit sur la projection de sa fin sur la droite sortante).
 */
function squareNewels(
  curve: Curve2,
  corners: readonly NewelCorner[],
  others: readonly Vec2[],
): Curve2 {
  let segs: CurveSeg[] = [...curve.segments];
  for (const c of corners) {
    // Les coins des autres tournants (volée intermédiaire courte) ne font pas partie du poteau.
    const near = (p: Vec2): boolean =>
      V.distance(p, c.k) <= c.reach &&
      !others.some((k) => V.distance(k, c.k) > GEOM_EPS && V.distance(p, k) <= 1e-6);
    const touches = segs.map((sg) => near(segStart(sg)) || near(segEnd(sg)));
    const i0 = touches.indexOf(true);
    if (i0 < 0) continue;
    let i1 = i0;
    while (i1 + 1 < segs.length && touches[i1 + 1]) i1++;
    const first = segs[i0]!;
    const last = segs[i1]!;
    const a0 = segStart(first);
    const b1 = segEnd(last);
    const A = near(a0) ? V.addScaled(c.k, c.incoming, V.dot(V.sub(a0, c.k), c.incoming)) : a0;
    const B = near(b1) ? V.addScaled(c.k, c.outgoing, V.dot(V.sub(b1, c.k), c.outgoing)) : b1;
    const repl = [lineSeg(A, c.k), lineSeg(c.k, B)].filter((sg) => segLength(sg) > GEOM_EPS);
    segs = [...segs.slice(0, i0), ...repl, ...segs.slice(i1 + 1)];
  }
  return { segments: segs.filter((sg) => segLength(sg) > GEOM_EPS) };
}

// ------------------------------------------------------------------ Nez sur la trace

/**
 * Abscisse σ de l'intersection de la ligne de nez (Q → R) avec la trace : point du segment
 * [Q ; R] (à la tolérance près) le plus proche du nez précédent ; à défaut, intersection avec
 * les prolongements tangents de la trace (nez de départ ou d'arrivée au bout de la trace).
 */
function nosingOnTrace(
  k: NosingLine,
  curve: Curve2,
  length: Mm,
  P: (s: Mm) => Vec2,
  T: (s: Mm) => Vec2,
  previous: Mm | undefined,
): Mm | null {
  const dir = V.sub(k.r, k.q);
  if (!(V.norm(dir) > GEOM_EPS)) return null;
  const line = { origin: k.q, dir };
  const inSegment = (t: number): boolean => t >= -NOSING_SEGMENT_TOL && t <= 1 + NOSING_SEGMENT_TOL;
  const hits = intersectLineCurve(line, curve).filter((h) => inSegment(h.t));
  const cands = hits.map((h) => h.s);
  // Prolongements tangents (σ < 0 et σ > L).
  for (const [s0, sign] of [
    [0, -1],
    [length, 1],
  ] as const) {
    const hit = lineHit(line, P(s0), T(s0));
    if (hit && inSegment(hit.t1) && hit.t2 * sign > -GEOM_EPS) cands.push(s0 + hit.t2);
  }
  if (cands.length === 0) return null;
  const ref = previous ?? 0;
  const after = cands.filter((s) => previous === undefined || s > previous + GEOM_EPS);
  const pool = after.length > 0 ? after : cands;
  return pool.reduce((best, s) => (Math.abs(s - ref) < Math.abs(best - ref) ? s : best));
}

function lineHit(
  line: { origin: Vec2; dir: Vec2 },
  p: Vec2,
  t: Vec2,
): { t1: number; t2: number } | null {
  const den = V.cross(line.dir, t);
  if (Math.abs(den) < 1e-12 * V.norm(line.dir)) return null;
  const w = V.sub(p, line.origin);
  return { t1: V.cross(w, t) / den, t2: V.cross(w, line.dir) / den };
}

/**
 * Courbe des nez sur la trace : Hermite monotone par (σ_k, z_k), nœud de palier ajouté,
 * prolongée linéairement (pentes des marches extrêmes).
 */
function nosingCurve(stepping: Stepping, sigma: readonly Mm[]): (s: Mm) => Mm {
  const n = sigma.length;
  const z = stepping.nosings.map((k) => k.z);
  const landing = new Set(stepping.treads.filter((t) => t.kind === "landing").map((t) => t.number));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k < n; k++) {
    xs.push(sigma[k]!);
    ys.push(z[k]!);
    if (k + 1 < n && landing.has(k + 1)) {
      const next = sigma[k + 1]!;
      const going = k + 2 < n ? sigma[k + 2]! - next : 0;
      const flatEnd = next - going;
      if (flatEnd > sigma[k]! + LANDING_EPS && flatEnd < next - LANDING_EPS) {
        xs.push(flatEnd);
        ys.push(z[k]!);
      }
    }
  }
  const m = xs.length;
  const s0 = (ys[1]! - ys[0]!) / (xs[1]! - xs[0]!);
  const s1 = (ys[m - 1]! - ys[m - 2]!) / (xs[m - 1]! - xs[m - 2]!);
  const f = monotoneHermite(xs, ys, s0, s1);
  const x0 = xs[0]!;
  const x1 = xs[m - 1]!;
  return (s) =>
    s < x0
      ? ys[0]! + Math.max(0, s0) * (s - x0)
      : s > x1
        ? ys[m - 1]! + Math.max(0, s1) * (s - x1)
        : f(s);
}

/** Écart minimal (mm) entre le nœud de palier inséré et les nez voisins. */
const LANDING_EPS = 1e-3;

/**
 * Pente nominale : médiane des pentes h / g des marches droites dont la portée sur la trace est
 * une droite ; sans partie droite (hélicoïdal, tournant continu) : pente moyenne nez 0 → nez N.
 */
function nominalSlope(
  curve: Curve2,
  cum: readonly Mm[],
  stepping: Stepping,
  sigma: readonly Mm[],
): number {
  const z = stepping.nosings.map((k) => k.z);
  const straightAt = (a: Mm, b: Mm): boolean =>
    curve.segments.some(
      (seg, i) => seg.kind === "line" && cum[i]! <= a + GEOM_EPS && cum[i + 1]! >= b - GEOM_EPS,
    ) ||
    (a >= cum.at(-1)! - GEOM_EPS && curve.segments.at(-1)!.kind === "line") ||
    (b <= GEOM_EPS && curve.segments[0]!.kind === "line");
  const slopes: number[] = [];
  for (const t of stepping.treads) {
    if (t.kind !== "straight") continue;
    const a = sigma[t.number - 1];
    const b = sigma[t.number];
    if (a === undefined || b === undefined || !(b - a > GEOM_EPS)) continue;
    if (!straightAt(a, b)) continue;
    slopes.push((z[t.number]! - z[t.number - 1]!) / (b - a));
  }
  if (slopes.length > 0) {
    slopes.sort((p, q) => p - q);
    return slopes[Math.floor(slopes.length / 2)]!;
  }
  const n = sigma.length;
  return (z[n - 1]! - z[0]!) / (sigma[n - 1]! - sigma[0]!);
}
