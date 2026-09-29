/**
 * Étape 2 du pipeline : le **tracé** (`computeLayout(project) → Layout`).
 *
 * Topologie explicite (docs/CHALLENGE.md G1) : N volées droites reliées par N − 1 tournants à
 * 90°, tous du même sens. Le bord intérieur C_i (jour), le bord extérieur C_e (mur) et la ligne
 * de foulée Γ sont construits **en forme fermée**, tournant par tournant (droite / arc / droite),
 * sans décalage générique de courbe.
 *
 * ## Repère local (voir `LayoutSpecSchema`)
 *
 * Départ sur le segment (0,0)–(E,0), montée selon +Y, x = 0 côté gauche. Pour chaque volée on
 * note I son origine côté intérieur (sur sa ligne de départ), u sa direction de montée et n la
 * normale unitaire allant de l'intérieur vers l'extérieur. Un tournant vers l'intérieur donne
 * u' = −n et n' = u. La longueur L d'une volée est mesurée sur le bord **extérieur** : deux
 * volées successives se recouvrent sur le carré d'angle E × E, le coin extérieur (mur) est
 * W = I + E·n + L·u et le coin intérieur (intersection des faces internes des limons) est
 * K = I + (L − E)·u.
 *
 * ## Raccords de jour (par tournant)
 *
 * - `sharp` : C_i a un angle vif en K ; Γ est l'arc de rayon d_f centré sur K (B §2.1 : « arc
 *   de cercle dont le centre est le point à l'intersection des faces internes des limons »).
 * - `arc` (rayon r) : C_i est raccordé par un arc de rayon r tangent aux deux faces internes,
 *   de centre F = K − r·n − r·u (dans le jour) ; Γ est l'arc concentrique de rayon r + d_f.
 *   Les parties droites de C_i et de Γ s'arrêtent à r avant K (points de tangence).
 * - `newel` (poteau carré de côté a, centré sur K, contrat `InnerCornerSchema`) : C_i suit le
 *   contour du poteau côté escalier (deux décrochements de a/2 dans les volées, puis les deux
 *   faces du poteau tournées vers l'escalier) ; Γ est l'arc de rayon d_f centré sur K, c'est-à-
 *   dire sur le point d'intersection des faces internes des limons (règle DTU ci-dessus), qui
 *   est ici le centre du poteau. Γ est donc identique au cas `sharp` ; sa distance au poteau
 *   est d_f − a·√2/2 au droit du coin du poteau (on exige d_f > a·√2/2).
 *
 * Le bord extérieur (mur) reste toujours à angle vif en W.
 *
 * ## Palier d'angle (`mode: "landing"`)
 *
 * Choix : Γ garde **le même arc** que pour des marches balancées (et non un tracé en L). La
 * ligne de foulée ne dépend ainsi que de l'épure (même Γ quand on bascule balancé ↔ palier,
 * cf. CHALLENGE P2), reste continue en tangente et à distance d_f du jour. La zone du palier
 * est l'intervalle [sStart, sEnd] de la partie courbe : avec un jour à angle vif, les droites
 * perpendiculaires à Γ en sStart et sEnd sont exactement les bords du carré d'angle E × E.
 * Le découpage ne place aucun nez strictement à l'intérieur de cet intervalle.
 *
 * ## Emprise (`footprint`)
 *
 * Surface utile entre C_i et C_e, fermée par les lignes de départ et d'arrivée (polygone CCW,
 * arcs discrétisés à 0,1 mm de flèche). Le poteau et les limons (hors emmarchement utile,
 * CHALLENGE A3) n'en font pas partie.
 */
import type { Layout, TurnZone } from "../model/derived.js";
import type { Curve2, CurveSeg, Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { InnerCorner, Project, Turn } from "../model/project.js";
import {
  flattenCurve,
  makeCurve,
  reverseCurve,
  rotateCurve,
  translateCurve,
} from "../geom2d/curve.js";
import { ensureCCW } from "../geom2d/polygon.js";
import { arcSeg, lineSeg } from "../geom2d/segment.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { LayoutError } from "./errors.js";
import { computeHelicalLayout } from "./helical.js";
import { resolveLegLengths, resolveWalklineOffset } from "./resolve.js";

export interface LayoutOptions {
  /**
   * Longueurs des volées déjà résolues (bord extérieur, mm). Remplacent celles du projet
   * (utile à l'assistant ou quand l'appelant a résolu `auto` lui-même). Sinon :
   * `resolveLegLengths(project)`.
   */
  readonly legLengths?: readonly Mm[];
}

/** Repère d'une volée dans le repère local. */
interface LegFrame {
  /** Origine côté intérieur, sur la ligne de départ de la volée. */
  readonly inner: Vec2;
  /** Direction de montée (unitaire). */
  readonly u: Vec2;
  /** Normale unitaire intérieur → extérieur. */
  readonly n: Vec2;
  readonly length: Mm;
}

/** Retrait de la partie droite de C_i de part et d'autre du coin intérieur K. */
function innerSetback(inner: InnerCorner): Mm {
  switch (inner.kind) {
    case "sharp":
      return 0;
    case "arc":
      return inner.radius;
    case "newel":
      return inner.size / 2;
  }
}

/** Retrait de la partie droite de Γ de part et d'autre de K (rayon du raccord de jour). */
function walkSetback(inner: InnerCorner): Mm {
  return inner.kind === "arc" ? inner.radius : 0;
}

const legLabel = (i: number): string => `volée ${i + 1}`;

/**
 * Calcule le tracé (bords, ligne de foulée, tournants, emprise) d'un projet, en repère monde.
 * Un tracé hélicoïdal (`kind: "helical"`) est délégué à `computeHelicalLayout`.
 *
 * @throws LayoutError si la topologie n'est pas prise en charge (tournants de sens opposés,
 *   nombre de tournants incohérent, `auto` hors escalier droit) ou si les cotes sont
 *   impossibles (volée trop courte pour ses raccords, ligne de foulée hors emmarchement ou
 *   traversant un poteau).
 */
export function computeLayout(project: Project, options: LayoutOptions = {}): Layout {
  const spec = project.stair.layout;
  // Tracé hélicoïdal (jalon 5a) : forme fermée propre, `layout/helical.ts`.
  if (spec.kind === "helical") return computeHelicalLayout(project, spec);
  const width = spec.width;
  const turns = spec.turns;
  const legCount = spec.legs.length;

  if (turns.length !== legCount - 1) {
    throw new LayoutError(
      `Le tracé doit compter exactement un tournant de moins que de volées (${legCount} volées, ${turns.length} tournants).`,
    );
  }
  const lengths = options.legLengths ? [...options.legLengths] : resolveLegLengths(project);
  if (lengths.length !== legCount) {
    throw new LayoutError(
      `${lengths.length} longueurs de volées fournies pour ${legCount} volées.`,
    );
  }
  lengths.forEach((l, i) => {
    if (!(Number.isFinite(l) && l > 0)) {
      throw new LayoutError(`Longueur de la ${legLabel(i)} invalide (${l} mm).`);
    }
  });

  // Côté intérieur : sens des tournants (tous identiques au MVP).
  const firstDir = turns[0]?.direction;
  if (turns.some((t) => t.direction !== firstDir)) {
    throw new LayoutError(
      "Tournants de sens opposés (escalier en S ou en Z) : non supporté au MVP.",
    );
  }
  const innerSide = firstDir ?? "left";
  const turnSign = innerSide === "left" ? 1 : -1;

  const df = resolveWalklineOffset(project);
  for (const [j, t] of turns.entries()) {
    if (t.inner.kind === "newel") {
      const reach = (t.inner.size * Math.SQRT2) / 2;
      if (!(df > reach)) {
        throw new LayoutError(
          `Tournant ${j + 1} : la ligne de foulée (${df} mm du jour) traverse le poteau de ${t.inner.size} mm (il faut plus de ${reach.toFixed(1)} mm).`,
        );
      }
    }
  }

  // Repères des volées.
  const legs: LegFrame[] = [];
  {
    let inner: Vec2 = innerSide === "left" ? V.vec(0, 0) : V.vec(width, 0);
    let u: Vec2 = V.vec(0, 1);
    let n: Vec2 = innerSide === "left" ? V.vec(1, 0) : V.vec(-1, 0);
    lengths.forEach((length, i) => {
      legs.push({ inner, u, n, length });
      if (i < turns.length) {
        const k = V.addScaled(inner, u, length - width);
        const u2 = V.scale(n, -1);
        n = u;
        u = u2;
        inner = V.addScaled(k, u, -width);
      }
    });
  }

  // Longueur disponible de chaque volée pour ses parties droites.
  legs.forEach((leg, i) => {
    const before = i > 0 ? width + innerSetback(turns[i - 1]!.inner) : 0;
    const after = i < turns.length ? width + innerSetback(turns[i]!.inner) : 0;
    const required = before + after;
    if (leg.length < required - GEOM_EPS) {
      throw new LayoutError(
        `La ${legLabel(i)} est trop courte : ${leg.length} mm mesurés au mur, il faut au moins ${required} mm (emmarchement et raccords de jour).`,
      );
    }
  });

  const cornerOf = (i: number): Vec2 => {
    const leg = legs[i]!;
    return V.addScaled(leg.inner, leg.u, leg.length - width);
  };

  // ---------------------------------------------------------------- bord intérieur C_i
  const innerSegs: CurveSeg[] = [];
  /** Ajoute la droite [a, b] si elle n'est pas dégénérée ; renvoie la longueur ajoutée. */
  const pushLine = (segs: CurveSeg[], a: Vec2, b: Vec2): Mm => {
    const length = V.distance(a, b);
    if (length <= GEOM_EPS) return 0;
    segs.push(lineSeg(a, b));
    return length;
  };
  legs.forEach((leg, i) => {
    const t0 = i > 0 ? width + innerSetback(turns[i - 1]!.inner) : 0;
    const t1 = i < turns.length ? leg.length - width - innerSetback(turns[i]!.inner) : leg.length;
    pushLine(innerSegs, V.addScaled(leg.inner, leg.u, t0), V.addScaled(leg.inner, leg.u, t1));
    const turn = turns[i];
    if (turn !== undefined) innerSegs.push(...innerTurnSegments(turn, cornerOf(i), leg, turnSign));
  });

  // ---------------------------------------------------------------- ligne de foulée Γ
  const walkSegs: CurveSeg[] = [];
  const zones: { sStart: Mm; sEnd: Mm }[] = [];
  let s = 0;
  legs.forEach((leg, i) => {
    const t0 = i > 0 ? width + walkSetback(turns[i - 1]!.inner) : 0;
    const t1 = i < turns.length ? leg.length - width - walkSetback(turns[i]!.inner) : leg.length;
    const base = V.addScaled(leg.inner, leg.n, df);
    // Abscisse cumulée sur les segments réellement ajoutés : [sStart, sEnd] reste cohérent
    // avec le paramétrage de la courbe même quand une partie droite est dégénérée.
    s += pushLine(walkSegs, V.addScaled(base, leg.u, t0), V.addScaled(base, leg.u, t1));
    const turn = turns[i];
    if (turn !== undefined) {
      const r = walkSetback(turn.inner);
      const center = V.sub(V.sub(cornerOf(i), V.scale(leg.n, r)), V.scale(leg.u, r));
      const radius = r + df;
      walkSegs.push(arcSeg(center, radius, V.angleOf(leg.n), (turnSign * Math.PI) / 2));
      const sStart = s;
      s += (radius * Math.PI) / 2;
      zones.push({ sStart, sEnd: s });
    }
  });

  // ---------------------------------------------------------------- bord extérieur C_e
  const outerSegs: CurveSeg[] = [];
  legs.forEach((leg) => {
    const start = V.addScaled(leg.inner, leg.n, width);
    pushLine(outerSegs, start, V.addScaled(start, leg.u, leg.length));
  });

  // ---------------------------------------------------------------- repère monde
  const { origin, rotation } = project.stair.placement;
  const angle = (rotation * Math.PI) / 180;
  const toWorld = (p: Vec2): Vec2 => V.add(V.rotate(p, angle), origin);
  const curveToWorld = (c: Curve2): Curve2 => translateCurve(rotateCurve(c, angle), origin);

  // Jour réduit à un point (quart tournant sans partie droite, angle vif) : courbe de
  // longueur nulle au coin, pour garder un `Curve2` non vide.
  if (innerSegs.length === 0) innerSegs.push(lineSeg(cornerOf(0), cornerOf(0)));
  const inner = curveToWorld(makeCurve(innerSegs));
  const outer = curveToWorld(makeCurve(outerSegs));
  const walkline = curveToWorld(makeCurve(walkSegs));

  const turnZones: TurnZone[] = turns.map((t, j) => {
    const leg = legs[j]!;
    const outerCorner = V.addScaled(V.addScaled(leg.inner, leg.n, width), leg.u, leg.length);
    return {
      index: j,
      direction: t.direction,
      mode: t.mode,
      innerCorner: toWorld(cornerOf(j)),
      outerCorner: toWorld(outerCorner),
      sStart: zones[j]!.sStart,
      sEnd: zones[j]!.sEnd,
    };
  });

  return {
    inner,
    outer,
    walkline,
    walklineOffset: df,
    footprint: footprintOf(inner, outer),
    turns: turnZones,
    innerSide,
  };
}

/**
 * Segments de C_i propres au tournant (entre la fin de la partie droite de la volée entrante
 * et le début de celle de la volée sortante), repère local.
 */
function innerTurnSegments(turn: Turn, k: Vec2, leg: LegFrame, turnSign: number): CurveSeg[] {
  const { u, n } = leg;
  const inner = turn.inner;
  switch (inner.kind) {
    case "sharp":
      return [];
    case "arc": {
      const r = inner.radius;
      const center = V.sub(V.sub(k, V.scale(n, r)), V.scale(u, r));
      return [arcSeg(center, r, V.angleOf(n), (turnSign * Math.PI) / 2)];
    }
    case "newel": {
      // Coordonnées (α, β) dans la base (n, u) centrée sur K ; poteau |α|, |β| ≤ a/2.
      const h = inner.size / 2;
      const at = (a: number, b: number): Vec2 => V.add(V.add(k, V.scale(n, a)), V.scale(u, b));
      const pts = [at(0, -h), at(h, -h), at(h, h), at(-h, h), at(-h, 0)];
      const segs: CurveSeg[] = [];
      for (let i = 0; i + 1 < pts.length; i++) segs.push(lineSeg(pts[i]!, pts[i + 1]!));
      return segs;
    }
  }
}

/** Emprise : C_e à l'endroit puis C_i à l'envers, polygone CCW sans points doublés. */
function footprintOf(inner: Curve2, outer: Curve2): Polygon2 {
  const raw = [...flattenCurve(outer), ...flattenCurve(reverseCurve(inner))];
  const pts: Vec2[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (last === undefined || !V.equals(last, p)) pts.push(p);
  }
  while (pts.length > 1 && V.equals(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  return ensureCCW(pts);
}
