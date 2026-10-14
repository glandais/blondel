/**
 * Moteur général d'une cage (ADR-0010, sous-lot 2b) : **largeur variable** (trapèze, axe droit)
 * et **axe en arc**, avec les jonctions d'angle quelconque et les raccords du sous-lot 2a.
 * `computeCageLayout` (`cage.ts`) ne l'appelle que pour une cage qui en a besoin
 * (`needsGeneralEngine`) : les cages de largeur constante à axes droits gardent le calcul à
 * largeur unique, dont la parité avec le moteur à volées est exacte. Sur ces cages, ce moteur
 * rend le même tracé à 1e-6 mm près (propriété dans `free.property.test.ts`).
 *
 * ## Tronçon droit à largeur variable
 *
 * Le bord d'ancrage (`anchor` : gauche, droite, ou `center` par défaut = axe médian) est droit,
 * dans la direction u du repère du tronçon ; `axis.length` est sa partie droite, mesurée sur
 * lui (F11). Les lignes de départ et d'arrivée sont perpendiculaires à u ; la largeur, mesurée
 * sur ces lignes, vaut `width` au départ et `widthEnd` à l'arrivée, interpolée linéairement
 * entre les deux : les bords gauche et droit sont rectilignes (avec `center`, ils s'ouvrent
 * symétriquement). Un tronçon de largeur variable doit avoir une partie droite non nulle.
 *
 * ## Tronçon à axe en arc (largeur constante)
 *
 * `radius` est mesuré sur le bord d'ancrage (F11), le balayage `sweep` est signé (positif = à
 * gauche en montant, centre de courbure à gauche). Les bords sont des arcs concentriques de
 * rayons R ± (distance du bord d'ancrage à chaque bord) ; le bord intérieur doit garder un
 * rayon strictement positif (`layout.cage.arcRadiusTooSmall`). Le repère tourne du balayage le
 * long du tronçon ; à ses extrémités, il est la tangente, et les lignes de départ et d'arrivée
 * sont radiales. Les jonctions voisines d'un axe en arc ont des raccords vifs (jour et mur :
 * `layout.cage.arcSectionSharpJoints`, un arc de raccord tangent à un bord courbe n'est pas
 * une forme fermée du sous-lot).
 *
 * ## Jonction tournante entre deux largeurs
 *
 * Le repère du tronçon sortant est celui du tronçon entrant (tangente à l'arrivée) tourné de θ ;
 * sa ligne de départ passe par **K**, extrémité du bord du jour du tronçon entrant : K est
 * l'intersection des bords du jour prolongés. **W** est l'intersection des bords côté mur
 * prolongés, qui ne sont plus forcément parallèles à u (`layout.cage.wallEdgesDegenerate` si
 * elle n'est pas au-delà des deux lignes de jonction). Zone de jonction : K, extrémité
 * côté mur de la ligne d'arrivée, W, extrémité côté mur de la ligne de départ. Les raccords se
 * construisent sur les **bords réels** : jour vif, en arc ou en pan coupé sur les bords du jour
 * (angle effectif φ entre eux, qui doit tourner dans le sens de θ :
 * `layout.cage.wellEdgesAngle`), congé côté mur sur les bords côté mur (angle ψ). Le poteau
 * reste limité à un angle effectif de ±90° (F5).
 *
 * ## Palier droit entre deux largeurs
 *
 * Profondeur `depth` (défaut : largeur d'arrivée du tronçon entrant, F9) ; le bord d'ancrage
 * du tronçon sortant prolonge le bord (ou l'axe) de même nom du tronçon entrant ; les bords du
 * palier relient les extrémités des deux lignes.
 *
 * ## Ligne de foulée Γ
 *
 * Décision F1 du 2026-10-11, option (a), aux jonctions tournantes ; les extensions marquées
 * « F12 » sont des propositions « à valider » (`docs/QUESTIONS.md`, F12).
 *
 * - (F1) À chaque jonction tournante, d_f suit la règle du DTU (`walklineOffsetFor`) sur la
 *   plus petite des largeurs à la jonction (fin du tronçon entrant, début du sortant) ; Γ y est
 *   un arc de centre K (jour vif, pan coupé, poteau ; F6) ou du centre du jour en arc, de rayon
 *   d_f (+ r), **tangent aux bords du jour réels** : ses points de tangence sont à d_f de ces
 *   bords.
 * - (F1) Entre deux jonctions tournantes, Γ est le segment qui relie les points de tangence des
 *   arcs voisins (généralisation du raccord linéaire d'un S / Z).
 * - Premier ou dernier tronçon droit voisin d'une jonction tournante : Γ prolonge la tangente
 *   de l'arc jusqu'à la ligne de départ (ou d'arrivée), sans angle.
 * - (F12) Palier droit, et extrémités d'un escalier sans jonction tournante : d_f selon le DTU
 *   sur la plus petite des largeurs au palier (sur la largeur locale à une extrémité), mesurée
 *   le long de la ligne transversale depuis le bord de mesure : côté du jour de la jonction
 *   tournante précédente, sinon bord de mesure du départ (`startSide` : jour de la première
 *   jonction tournante ; sinon `walklineSide`, décision A16, choisi ou automatique pour un
 *   seul tronçon droit, puis côté intérieur de la courbure du premier arc, puis gauche). Γ peut
 *   être anguleuse aux limites d'un palier droit, où le découpage ne place aucun nez. Un
 *   tronçon droit sans partie droite voisin d'un palier droit ou d'une extrémité reporte le
 *   changement de d_f sur le palier (Γ réduite à un point dans le tronçon).
 * - `Layout.walklineTransitions` : partie droite où Γ est **anguleuse au raccord avec l'arc
 *   d'une jonction tournante voisine** (Γ non parallèle au bord du jour de cette jonction) ;
 *   `direction` = ce bord du jour (à l'entrée, sinon à la sortie), qui est la direction du
 *   tronçon à largeur constante. Une Γ oblique sans angle (trapèze seul, extrémité d'escalier)
 *   ou anguleuse seulement à la limite d'un palier droit n'est pas une transition.
 * - (F12) **Axe en arc** : Γ est un arc concentrique, à distance constante des bords. Une
 *   jonction tournante voisine impose sa distance (d_f mesurée depuis son jour) ; deux
 *   jonctions tournantes voisines qui imposent des distances différentes sont refusées
 *   (`layout.cage.arcWalklineTransition` : une transition demande une partie droite) ; sans
 *   jonction tournante voisine, d_f suit la règle du DTU sur la largeur du tronçon, mesurée
 *   depuis le même bord de mesure qu'un palier droit (côté du jour de la jonction tournante
 *   précédente, sinon `startSide`) : Γ ne change pas de bord en traversant un palier droit
 *   voisin d'un arc. `Layout.walklineSide` = `startSide` pour toute cage sans jonction
 *   tournante.
 * - (F12) Raccords vifs seulement (jour et mur) aux jonctions voisines d'un axe en arc.
 *
 * La ligne de mesure réglementaire reste distincte (sous-lot 2d).
 *
 * ## Recouvrement en plan
 *
 * Pièces convexes (`overlap.ts`) : trapèze de chaque partie droite (coupé par les congés côté
 * mur voisins), éventail de trapèzes isocèles d'un axe en arc, deux triangles par zone de
 * jonction (K, ligne d'arrivée, W ; K, W, ligne de départ, coupés par le congé), éventail du
 * jour en arc, triangle du pan coupé, trapèze d'un palier droit. Contact bord à bord
 * (`sectionsTouch`) : critère du demi-tour appliqué aux balayages effectifs φ des bords du
 * jour réels (un bord du jour incliné laisse un jour triangulaire, sans contact sur toute la
 * largeur).
 */
import type {
  Layout,
  LayoutSection,
  TurnZone,
  WalklineTransition,
  ZeroLengthInnerCorner,
} from "../../model/derived.js";
import type { ArcSeg, Curve2, CurveSeg, Mm, Polygon2, Vec2 } from "../../model/primitives.js";
import type { CageLayoutSpec, Project } from "../../model/project.js";
import { discPolygon, sectorRing, splitArc } from "../../geom2d/arc.js";
import { makeCurve, rotateCurve, translateCurve } from "../../geom2d/curve.js";
import { intersectLines } from "../../geom2d/intersect.js";
import { ensureCCW, signedArea } from "../../geom2d/polygon.js";
import { arcSeg, lineSeg, segEnd, segStart } from "../../geom2d/segment.js";
import { ANGLE_EPS, GEOM_EPS } from "../../geom2d/tolerance.js";
import * as V from "../../geom2d/vec.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { walklineOffsetFor } from "../resolve.js";
import { resolveWalklineSide } from "../walklineSide.js";
import type { CageLayoutOptions } from "./cage.js";
import { rotateBasis, START_BASIS } from "./frames.js";
import {
  checkNewel,
  checkWallArc,
  junctionGeom,
  wallSetback,
  wallTurnSegments,
  WALL_SHARP_WARNING_ANGLE,
  wellSetbackIn,
  wellSetbackOut,
  wellTurnSegments,
  wideAngleNotes,
  type JunctionGeom,
  type Side,
  type TurnJunction,
} from "./junction.js";
import {
  annulusPieces,
  arcFanPieces,
  clipByArc,
  footprintOf,
  piecesOverlap,
  sectionsTouch,
  type CagePiece,
} from "./overlap.js";
import { mmText, resolveStraightLengths } from "./section.js";

type Anchor = "left" | "right" | "center";

/** Tronçon placé, repère local du tracé (départ du premier tronçon : bord gauche en (0, 0)). */
interface PlacedSection {
  readonly index: number;
  readonly kind: "straight" | "arc";
  readonly anchor: Anchor;
  /** Largeurs au départ et à l'arrivée. */
  readonly w0: Mm;
  readonly w1: Mm;
  /** Point d'ancrage, direction de montée u et normale gauche → droite r, au départ. */
  readonly a0: Vec2;
  readonly u0: Vec2;
  readonly r0: Vec2;
  /** Mêmes grandeurs à l'arrivée (égales au départ, translation exceptée, pour un axe droit). */
  readonly a1: Vec2;
  readonly u1: Vec2;
  readonly r1: Vec2;
  /** Longueur sur le bord d'ancrage (partie droite, ou longueur d'arc). */
  readonly length: Mm;
  /** Axe en arc : centre, rayon d'ancrage, balayage signé (rad), sens (+1 : centre à gauche). */
  readonly arc?: {
    readonly center: Vec2;
    readonly radius: Mm;
    readonly sweep: number;
    readonly sign: 1 | -1;
  };
}

/** Jonction tournante placée (raccords construits sur les bords réels). */
interface PlacedTurn {
  readonly kind: "turn";
  /** Jonction d'origine (angle θ du repère). */
  readonly j: TurnJunction;
  readonly side: Side;
  /** Coin du jour K, directions des bords du jour entrant (a1) et sortant (a2). */
  readonly k: Vec2;
  readonly a1: Vec2;
  readonly a2: Vec2;
  /** Normale jour → mur du bord du jour entrant. */
  readonly m1: Vec2;
  /** Jonction effective côté jour : balayage φ entre les bords du jour. */
  readonly well: TurnJunction;
  /** d_f de la jonction (F1). */
  readonly df: Mm;
  /** Arc de Γ dans la jonction, et sa longueur. */
  readonly walk: ArcSeg;
  readonly walkLength: Mm;
  /** Coin du mur W, directions des bords côté mur entrant (b1) et sortant (b2). */
  readonly w: Vec2;
  readonly b1: Vec2;
  readonly b2: Vec2;
  /** Normale jour → mur du bord côté mur entrant. */
  readonly nw1: Vec2;
  /** Extrémités côté mur des lignes d'arrivée (entrant) et de départ (sortant). */
  readonly p1: Vec2;
  readonly p2: Vec2;
  /** Jonction effective côté mur : balayage ψ entre les bords côté mur. */
  readonly wall: TurnJunction;
  /** Congé côté mur, s'il y en a un. */
  readonly fillet?: ArcSeg | undefined;
}

/** Palier droit placé. */
interface PlacedLanding {
  readonly kind: "straight";
  /** Bord de mesure de Γ et d_f au palier (F1). */
  readonly side: Side;
  readonly df: Mm;
}

type PlacedJunction = PlacedTurn | PlacedLanding;

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/** Décalage (le long de r, depuis le point d'ancrage) du bord gauche pour la largeur `w`. */
function anchorLeft(anchor: Anchor, w: Mm): Mm {
  return anchor === "left" ? 0 : anchor === "right" ? -w : -w / 2;
}

/** Décalage (le long de r, depuis le point d'ancrage) du bord `side` pour la largeur `w`. */
function edgeOffset(anchor: Anchor, w: Mm, side: Side): Mm {
  const left = anchorLeft(anchor, w);
  return side === "left" ? left : left + w;
}

/**
 * Distance (signée, positive vers l'intérieur) du bord d'ancrage d'un tronçon en arc de largeur
 * `w` à son bord intérieur de courbure (à gauche si `sweepDeg` > 0, à droite sinon) : le bord
 * intérieur a pour rayon `radius − arcInnerReach(…)`, qui doit rester strictement positif
 * (`layout.cage.arcRadiusTooSmall`). Partagé avec les mutateurs (`cageEdit.ts`).
 */
export function arcInnerReach(anchor: Anchor | undefined, w: Mm, sweepDeg: number): Mm {
  const sign = sweepDeg > 0 ? 1 : -1;
  return -sign * edgeOffset(anchor ?? "center", w, sign > 0 ? "left" : "right");
}

/** Extrémité `side` de la ligne de départ (`end` = 0) ou d'arrivée (`end` = 1). */
function crossPoint(sec: PlacedSection, end: 0 | 1, side: Side): Vec2 {
  return end === 0
    ? V.addScaled(sec.a0, sec.r0, edgeOffset(sec.anchor, sec.w0, side))
    : V.addScaled(sec.a1, sec.r1, edgeOffset(sec.anchor, sec.w1, side));
}

/**
 * Direction (unitaire) du bord `side` au départ ou à l'arrivée : u lui-même (même objet)
 * quand ce bord est parallèle au bord d'ancrage, ce qui permet de reconnaître une jonction
 * sans inclinaison et d'y garder les valeurs exactes de θ.
 */
function edgeDir(sec: PlacedSection, end: 0 | 1, side: Side): Vec2 {
  if (sec.kind === "arc") return end === 0 ? sec.u0 : sec.u1;
  const d0 = edgeOffset(sec.anchor, sec.w0, side);
  const d1 = edgeOffset(sec.anchor, sec.w1, side);
  if (d0 === d1) return sec.u0;
  return V.normalize(V.addScaled(V.scale(sec.u0, sec.length), sec.r0, d1 - d0));
}

/** Normale unitaire jour → mur d'une direction de bord, pour un jour du côté `side`. */
function wallward(dir: Vec2, side: Side): Vec2 {
  return side === "left" ? V.perpRight(dir) : V.perpLeft(dir);
}

/** Point de la ligne transversale `end` à `d` du bord `side`, mesuré le long de la ligne. */
function alongCross(sec: PlacedSection, end: 0 | 1, side: Side, d: Mm): Vec2 {
  const r = end === 0 ? sec.r0 : sec.r1;
  return V.addScaled(crossPoint(sec, end, side), r, side === "left" ? d : -d);
}

/** Angle en degrés pour un message, au dixième. */
const degText = (rad: number): string => ((rad * 180) / Math.PI).toFixed(1);

/**
 * Jonction effective entre deux directions de bord : θ et tan(|θ|/2) exacts quand les bords
 * sont parallèles aux repères (`exact`), sinon angle signé φ entre les directions, qui doit
 * tourner dans le sens de θ, sans atteindre 180°. `undefined` sinon.
 */
function effective(j: TurnJunction, d1: Vec2, d2: Vec2, exact: boolean): TurnJunction | undefined {
  if (exact) return j;
  const sweep = V.signedAngle(d1, d2);
  const ok =
    Math.sign(sweep) === Math.sign(j.angle) &&
    Math.abs(sweep) > ANGLE_EPS &&
    Math.abs(sweep) < Math.PI - ANGLE_EPS;
  return ok ? { ...j, sweep, tanHalf: Math.tan(Math.abs(sweep) / 2) } : undefined;
}

/**
 * Place les tronçons (repère local) : propagation du repère et des points d'ancrage de jonction
 * en jonction.
 * @throws LayoutError si un tronçon est invalide (longueur, largeur variable sans partie
 *   droite, balayage, largeur variable sur un arc, rayon trop petit). `fullTurns` (cage issue
 *   d'un hélicoïdal, origine `helical`) : balayage d'un axe en arc accepté au-delà d'un tour.
 */
function placeSections(
  spec: CageLayoutSpec,
  lengths: readonly Mm[],
  fullTurns = false,
): PlacedSection[] {
  const out: PlacedSection[] = [];
  const first = spec.sections[0]!;
  let u = START_BASIS.u;
  let r = START_BASIS.r;
  let a0 = V.vec(-anchorLeft(first.anchor ?? "center", first.width), 0);
  spec.sections.forEach((s, i) => {
    const anchor: Anchor = s.anchor ?? "center";
    const w0 = s.width;
    const w1 = s.widthEnd ?? s.width;
    let sec: PlacedSection;
    if (s.axis.kind === "straight") {
      const length = lengths[i]!;
      // Étendue non nulle (comme à largeur constante, `checkSectionExtents`) : un tronçon sans
      // partie droite doit déborder dans une jonction tournante d'entrée, ou porter une jonction
      // de sortie.
      const extent =
        length > 0 ||
        (i > 0 && spec.junctions[i - 1]!.angle !== 0) ||
        spec.junctions[i] !== undefined;
      if (!(Number.isFinite(length) && length >= 0 && extent)) {
        throw new LayoutError(
          msg("layout.cage.invalidSectionLength", { section: i + 1, length: String(length) }),
        );
      }
      if (w1 !== w0 && !(length > GEOM_EPS)) {
        throw new LayoutError(
          msg("layout.cage.variableWidthZeroLength", {
            section: i + 1,
            width: String(w0),
            widthEnd: String(w1),
          }),
        );
      }
      sec = {
        index: i,
        kind: "straight",
        anchor,
        w0,
        w1,
        a0,
        u0: u,
        r0: r,
        a1: V.addScaled(a0, u, length),
        u1: u,
        r1: r,
        length,
      };
    } else {
      if (s.widthEnd !== undefined) {
        throw new LayoutError(msg("layout.cage.arcVariableWidth", { section: i + 1 }));
      }
      const deg = s.axis.sweep;
      if (!(Math.abs(deg) > 0 && (fullTurns ? Number.isFinite(deg) : Math.abs(deg) < 360))) {
        throw new LayoutError(
          msg("layout.cage.sweepOutOfRange", { section: i + 1, sweep: String(deg) }),
        );
      }
      const sweep = (deg * Math.PI) / 180;
      const sign: 1 | -1 = sweep > 0 ? 1 : -1;
      const radius = s.axis.radius;
      // Bord intérieur de la courbure : à gauche si l'arc tourne à gauche.
      const reach = -arcInnerReach(anchor, w0, deg);
      if (!(radius + reach > GEOM_EPS)) {
        throw new LayoutError(
          msg("layout.cage.arcRadiusTooSmall", {
            section: i + 1,
            radius: String(radius),
            width: String(w0),
            required: mmText(-reach),
          }),
        );
      }
      const center = V.addScaled(a0, r, -sign * radius);
      sec = {
        index: i,
        kind: "arc",
        anchor,
        w0,
        w1: w0,
        a0,
        u0: u,
        r0: r,
        a1: V.rotate(a0, sweep, center),
        u1: V.rotate(u, sweep),
        r1: V.rotate(r, sweep),
        length: lengths[i]!,
        arc: { center, radius, sweep, sign },
      };
    }
    out.push(sec);
    const j = spec.junctions[i];
    const next = spec.sections[i + 1];
    if (j === undefined || next === undefined) return;
    const nextAnchor: Anchor = next.anchor ?? "center";
    if (j.angle === 0) {
      // Palier droit : le bord (ou l'axe) d'ancrage du tronçon sortant prolonge celui de même
      // nom du tronçon entrant.
      const ref =
        nextAnchor === "center"
          ? anchorLeft(anchor, w1) + w1 / 2
          : edgeOffset(anchor, w1, nextAnchor);
      const depth = j.depth ?? w1;
      a0 = V.addScaled(V.addScaled(sec.a1, sec.r1, ref), sec.u1, depth);
      u = sec.u1;
      r = sec.r1;
    } else {
      // Jonction tournante : la ligne de départ du tronçon sortant passe par K.
      const side: Side = j.angle > 0 ? "left" : "right";
      const basis = rotateBasis({ u: sec.u1, r: sec.r1 }, j.angle);
      const k = crossPoint(sec, 1, side);
      a0 = V.addScaled(k, basis.r, -edgeOffset(nextAnchor, next.width, side));
      u = basis.u;
      r = basis.r;
    }
  });
  return out;
}

/**
 * Jonctions placées : raccords sur les bords réels, coin du mur, arc de Γ (d_f de la jonction).
 * @throws LayoutError si une jonction est impossible avec les largeurs saisies.
 */
function placeJunctions(
  project: Project,
  spec: CageLayoutSpec,
  sections: readonly PlacedSection[],
  geoms: readonly JunctionGeom[],
): PlacedJunction[] {
  const walkline = project.stair.walkline;
  // Bord de mesure d'un palier droit : côté du jour de la jonction tournante précédente (de la
  // première au départ), sinon bord de mesure de l'escalier droit.
  let chainSide = startSide(project, spec, sections, geoms);
  return geoms.map((g, i): PlacedJunction => {
    const sin = sections[i]!;
    const sout = sections[i + 1]!;
    const df = walklineOffsetFor(walkline, Math.min(sin.w1, sout.w0));
    if (g.kind === "straight") {
      return { kind: "straight", side: chainSide, df };
    }
    const j = g;
    const side = j.side;
    chainSide = side;
    if (
      (sin.kind === "arc" || sout.kind === "arc") &&
      (j.well.kind !== "sharp" || j.wall.kind !== "sharp")
    ) {
      throw new LayoutError(msg("layout.cage.arcSectionSharpJoints", { junction: i + 1 }));
    }
    const k = crossPoint(sin, 1, side);
    const a1 = edgeDir(sin, 1, side);
    const a2 = edgeDir(sout, 0, side);
    const well = effective(j, a1, a2, a1 === sin.u1 && a2 === sout.u0);
    if (well === undefined) {
      throw new LayoutError(
        msg("layout.cage.wellEdgesAngle", {
          junction: i + 1,
          angle: degText(V.signedAngle(a1, a2)),
          expected: String(j.angle),
        }),
      );
    }
    // Poteau : angle effectif de ±90° seulement (F5).
    if (j.well.kind === "newel" && well !== j) {
      throw new LayoutError(
        msg("layout.cage.newelAngle", { junction: i + 1, angle: degText(well.sweep) }),
      );
    }
    checkNewel(j.well, i, df);
    const m1 = wallward(a1, side);
    const rw = j.well.kind === "arc" ? j.well.radius : 0;
    const center = V.sub(V.sub(k, V.scale(m1, rw)), V.scale(a1, rw * well.tanHalf));
    const radius = rw + df;
    const walk = arcSeg(center, radius, V.angleOf(m1), well.sweep);
    const quarter = well === j && (j.angle === 90 || j.angle === -90);
    const walkLength = quarter ? (radius * Math.PI) / 2 : radius * Math.abs(well.sweep);

    const wallSide = other(side);
    const p1 = crossPoint(sin, 1, wallSide);
    const p2 = crossPoint(sout, 0, wallSide);
    const b1 = edgeDir(sin, 1, wallSide);
    const b2 = edgeDir(sout, 0, wallSide);
    const hit = intersectLines({ origin: p1, dir: b1 }, { origin: p2, dir: b2 });
    const wallEff = effective(j, b1, b2, b1 === sin.u1 && b2 === sout.u0);
    if (
      hit === null ||
      hit.t1 < -GEOM_EPS ||
      hit.t2 > GEOM_EPS ||
      (j.wall.kind === "arc" && wallEff === undefined)
    ) {
      throw new LayoutError(msg("layout.cage.wallEdgesDegenerate", { junction: i + 1 }));
    }
    const wall = wallEff ?? j;
    const nw1 = wallward(b1, side);
    // Zone de jonction valide : W du côté du mur des deux bords du jour ; Γ (arc de centre F,
    // de rayon r + d_f) du côté du jour des deux bords côté mur.
    const kw = V.sub(hit.point, k);
    if (!(V.dot(kw, m1) > GEOM_EPS && V.dot(kw, wallward(a2, side)) > GEOM_EPS)) {
      throw new LayoutError(msg("layout.cage.wallEdgesDegenerate", { junction: i + 1 }));
    }
    const clearance = (p: Vec2, n: Vec2): Mm => V.dot(V.sub(p, center), n) - radius;
    if (!(clearance(p1, nw1) > GEOM_EPS && clearance(p2, wallward(b2, side)) > GEOM_EPS)) {
      throw new LayoutError(
        msg("layout.cage.walklineOutsideFootprint", { junction: i + 1, offset: mmText(df) }),
      );
    }
    const [fillet] = wallTurnSegments(wall, hit.point, b1, nw1);
    return {
      kind: "turn",
      j,
      side,
      k,
      a1,
      a2,
      m1,
      well,
      df,
      walk,
      walkLength,
      w: hit.point,
      b1,
      b2,
      nw1,
      p1,
      p2,
      wall,
      fillet: fillet?.kind === "arc" ? fillet : undefined,
    };
  });
}

/**
 * Bord de mesure de Γ au départ : côté du jour de la première jonction tournante ; sinon bord
 * choisi ou automatique d'un escalier droit d'un seul tronçon droit (décision A16) ; sinon bord
 * choisi, puis côté intérieur de la courbure du premier axe en arc, puis gauche.
 */
function startSide(
  project: Project,
  spec: CageLayoutSpec,
  sections: readonly PlacedSection[],
  geoms: readonly JunctionGeom[],
): Side {
  const firstTurn = geoms.find((g): g is TurnJunction => g.kind === "turn");
  if (firstTurn !== undefined) return firstTurn.side;
  if (spec.junctions.length === 0 && sections[0]!.kind === "straight") {
    return resolveWalklineSide(project, sections[0]!.length);
  }
  const chosen = project.stair.walkline.side;
  if (chosen !== undefined) return chosen;
  const arc = sections.find((s) => s.arc !== undefined)?.arc;
  return arc !== undefined && arc.sign < 0 ? "right" : "left";
}

/** Côté intérieur (`Layout.innerSide`) : jour de la première jonction tournante, sinon de la courbure du premier arc, sinon gauche. */
function innerSideOf(
  sections: readonly PlacedSection[],
  junctions: readonly PlacedJunction[],
): Side {
  const firstTurn = junctions.find((j): j is PlacedTurn => j.kind === "turn");
  if (firstTurn !== undefined) return firstTurn.side;
  const arc = sections.find((s) => s.arc !== undefined)?.arc;
  return arc !== undefined && arc.sign < 0 ? "right" : "left";
}

/** Γ dans un tronçon : extrémités, bords de référence, et segment d'arc (axe en arc). */
interface SectionWalk {
  readonly g0: Vec2;
  readonly g1: Vec2;
  /** Directions des bords depuis lesquels d_f est mesurée au départ et à l'arrivée. */
  readonly ref0: Vec2;
  readonly ref1: Vec2;
  readonly arc?: ArcSeg;
}

/**
 * Point de la ligne transversale `end` de `sec` sur la droite (p, d) : prolongement de la
 * tangente d'un arc de Γ. Doit rester strictement dans l'emmarchement.
 * @throws LayoutError (`layout.walklineOutsideWidth`) sinon.
 */
function extendTo(sec: PlacedSection, end: 0 | 1, p: Vec2, d: Vec2, side: Side): Vec2 {
  const left = crossPoint(sec, end, "left");
  const r = end === 0 ? sec.r0 : sec.r1;
  const w = end === 0 ? sec.w0 : sec.w1;
  const hit = intersectLines({ origin: p, dir: d }, { origin: left, dir: r });
  const o = hit === null ? Number.NaN : V.dot(V.sub(hit.point, left), r);
  if (hit === null || !(o > 0 && o < w)) {
    const fromSide = side === "left" ? o : w - o;
    throw new LayoutError(
      msg("layout.walklineOutsideWidth", { offset: mmText(fromSide), width: mmText(w) }),
    );
  }
  return hit.point;
}

/** Γ dans chaque tronçon (règles F1, voir l'en-tête). */
function sectionWalks(
  project: Project,
  sections: readonly PlacedSection[],
  junctions: readonly PlacedJunction[],
  start: Side,
): SectionWalk[] {
  const walkline = project.stair.walkline;
  return sections.map((sec, i): SectionWalk => {
    const prev = junctions[i - 1];
    const next = junctions[i];
    if (sec.arc !== undefined) {
      // Distance de Γ au bord gauche, imposée par les jonctions tournantes voisines.
      const imposed = (j: PlacedJunction | undefined): Mm | undefined =>
        j?.kind === "turn" ? (j.side === "left" ? j.df : sec.w0 - j.df) : undefined;
      const oPrev = imposed(prev);
      const oNext = imposed(next);
      if (oPrev !== undefined && oNext !== undefined && Math.abs(oPrev - oNext) > GEOM_EPS) {
        throw new LayoutError(
          msg("layout.cage.arcWalklineTransition", {
            section: i + 1,
            junctionA: i,
            junctionB: i + 1,
            offsetA: mmText(oPrev),
            offsetB: mmText(oNext),
          }),
        );
      }
      // Sans jonction tournante voisine (F12) : bord de mesure des paliers droits voisins
      // (même règle de côté de part et d'autre d'un palier), sinon du départ.
      const side: Side =
        prev?.kind === "straight" ? prev.side : next?.kind === "straight" ? next.side : start;
      const df = walklineOffsetFor(walkline, sec.w0);
      const o = oPrev ?? oNext ?? (side === "left" ? df : sec.w0 - df);
      const g0 = V.addScaled(crossPoint(sec, 0, "left"), sec.r0, o);
      const { center, radius, sweep, sign } = sec.arc;
      const arc = arcSeg(
        center,
        radius + sign * (anchorLeft(sec.anchor, sec.w0) + o),
        V.angleOf(V.sub(g0, center)),
        sweep,
      );
      return { g0, g1: segEnd(arc), ref0: sec.u0, ref1: sec.u1, arc };
    }
    let g0: Vec2;
    let ref0: Vec2;
    if (prev?.kind === "turn") {
      g0 = segEnd(prev.walk);
      ref0 = prev.a2;
    } else if (prev !== undefined) {
      g0 = alongCross(sec, 0, prev.side, prev.df);
      ref0 = edgeDir(sec, 0, prev.side);
    } else if (next?.kind === "turn") {
      g0 = extendTo(sec, 0, segStart(next.walk), next.a1, next.side);
      ref0 = next.a1;
    } else {
      g0 = alongCross(sec, 0, start, walklineOffsetFor(walkline, sec.w0));
      ref0 = edgeDir(sec, 0, start);
    }
    let g1: Vec2;
    let ref1: Vec2;
    if (next?.kind === "turn") {
      g1 = segStart(next.walk);
      ref1 = next.a1;
    } else if (next !== undefined) {
      g1 = alongCross(sec, 1, next.side, next.df);
      ref1 = edgeDir(sec, 1, next.side);
    } else if (prev?.kind === "turn") {
      g1 = extendTo(sec, 1, segEnd(prev.walk), prev.a2, prev.side);
      ref1 = prev.a2;
    } else {
      // Arrivée de l'escalier (après un palier droit, ou escalier sans jonction).
      const side = prev !== undefined ? prev.side : start;
      g1 = alongCross(sec, 1, side, walklineOffsetFor(walkline, sec.w1));
      ref1 = edgeDir(sec, 1, side);
    }
    // Tronçon sans partie droite voisin d'un palier droit ou d'une extrémité (F12) : le
    // changement de d_f est reporté sur le palier, Γ est réduite à un point dans le tronçon.
    if (sec.length <= GEOM_EPS) {
      if (prev?.kind !== "turn") g0 = g1;
      else if (next?.kind !== "turn") g1 = g0;
    }
    return { g0, g1, ref0, ref1 };
  });
}

/** Vrai si les directions unitaires `a` et `b` sont parallèles (même sens). */
const parallel = (a: Vec2, b: Vec2): boolean => Math.abs(V.cross(a, b)) <= 1e-9 && V.dot(a, b) > 0;

/** Partie droite du bord `side` d'un tronçon droit, entre les raccords de ses jonctions. */
interface StraightEdge {
  /** Extrémités de la partie droite (après les retraits des raccords). */
  readonly start: Vec2;
  readonly end: Vec2;
  /** Longueur du bord réel entre ses coins (K, W, ou extrémités des lignes), le long du bord. */
  readonly available: Mm;
  /** Retraits des raccords au départ et à l'arrivée, mesurés sur le bord réel. */
  readonly back0: Mm;
  readonly back1: Mm;
  /** Numéro (1 = première) de la jonction dont le congé côté mur porte sur ce bord. */
  readonly fillet?: number | undefined;
  /** Congé d'entrée prolongé sur le palier droit suivant (le bord du palier est absorbé). */
  readonly merged: boolean;
}

function straightEdge(
  side: Side,
  sections: readonly PlacedSection[],
  junctions: readonly PlacedJunction[],
  i: number,
): StraightEdge {
  const sec = sections[i]!;
  const prev = junctions[i - 1];
  const next = junctions[i];
  const p0 = crossPoint(sec, 0, side);
  const p1 = crossPoint(sec, 1, side);
  let fullStart = p0;
  let back0 = 0;
  let start = p0;
  let fillet: number | undefined;
  if (prev?.kind === "turn") {
    if (prev.side === side) {
      fullStart = prev.k;
      back0 = wellSetbackOut(prev.well);
      start = V.addScaled(prev.k, prev.a2, back0);
    } else {
      fullStart = prev.w;
      back0 = wallSetback(prev.wall);
      start = V.addScaled(prev.w, prev.b2, back0);
      if (back0 > 0) fillet = i;
    }
  }
  let fullEnd = p1;
  let back1 = 0;
  let end = p1;
  if (next?.kind === "turn") {
    if (next.side === side) {
      fullEnd = next.k;
      back1 = wellSetbackIn(next.well);
      end = V.addScaled(next.k, next.a1, -back1);
    } else {
      fullEnd = next.w;
      back1 = wallSetback(next.wall);
      end = V.addScaled(next.w, next.b1, -back1);
      if (back1 > 0) fillet = i + 1;
    }
  }
  const d = edgeDir(sec, 0, side);
  let merged = false;
  if (next?.kind === "straight" && V.dot(V.sub(p1, start), d) < -GEOM_EPS) {
    // Congé de la jonction d'entrée qui finit au-delà de la ligne d'arrivée : il empiète sur le
    // palier droit suivant quand le bord du palier prolonge celui du tronçon (le palier fait
    // partie de l'étendue du tronçon entrant, comme à largeur constante).
    const q = crossPoint(sections[i + 1]!, 0, side);
    const along = V.sub(q, p1);
    if (Math.abs(V.cross(d, along)) <= GEOM_EPS * Math.max(1, V.norm(along))) {
      fullEnd = q;
      end = q;
      merged = true;
    }
  }
  return {
    start,
    end,
    available: V.dot(V.sub(fullEnd, fullStart), d),
    back0,
    back1,
    fillet,
    merged,
  };
}

/**
 * Faisabilité des tronçons droits, tronçon par tronçon (même ordre que le moteur à largeur
 * unique, `checkSectionLength`) : la partie droite contient les retraits des raccords de jour
 * voisins, quel que soit leur côté (retraits projetés sur u, la partie droite étant mesurée sur
 * le bord d'ancrage : sur un bord incliné, le retrait mesuré sur le bord réel avance de moins le
 * long de u) ; puis chaque bord, gauche puis droit, contient ses retraits, mesurés sur le bord
 * réel.
 * @throws LayoutError sinon : `layout.cage.sectionTooShort`, ou `layout.cage.wallArcDoesNotFit`
 *   pour un bord qui porte un congé côté mur. Les cotes de ce dernier sont celles du bord réel
 *   entre ses coins (K, W), hors débords « au mur » que compte le moteur à largeur unique : à
 *   largeur constante, même refus, cotes plus petites de ces débords.
 */
function checkSectionEdges(
  sections: readonly PlacedSection[],
  junctions: readonly PlacedJunction[],
): void {
  sections.forEach((sec, i) => {
    if (sec.arc !== undefined) return;
    const prev = junctions[i - 1];
    const next = junctions[i];
    // Avance le long de u d'un retrait mesuré sur un bord de direction `d` (exacte, 1, quand
    // le bord est parallèle au bord d'ancrage).
    const along = (d: Vec2): number => (d === sec.u0 ? 1 : V.dot(d, sec.u0));
    const required =
      (prev?.kind === "turn" ? wellSetbackOut(prev.well) * along(prev.a2) : 0) +
      (next?.kind === "turn" ? wellSetbackIn(next.well) * along(next.a1) : 0);
    if (sec.length < required - GEOM_EPS) {
      throw new LayoutError(
        msg("layout.cage.sectionTooShort", {
          section: i + 1,
          length: mmText(sec.length),
          required: mmText(required),
        }),
      );
    }
    for (const side of ["left", "right"] as const) {
      const e = straightEdge(side, sections, junctions, i);
      if (e.available - e.back0 - e.back1 >= -GEOM_EPS) continue;
      const needed = mmText(e.back0 + e.back1);
      throw new LayoutError(
        e.fillet === undefined
          ? msg("layout.cage.sectionTooShort", {
              section: i + 1,
              length: mmText(e.available),
              required: needed,
            })
          : msg("layout.cage.wallArcDoesNotFit", {
              junction: e.fillet,
              section: i + 1,
              required: needed,
              available: mmText(e.available),
            }),
      );
    }
  });
}

/**
 * Bords gauche et droit (`side`), repère local : parties droites (avec les retraits des
 * raccords), arcs des axes en arc, raccords de jour et congés côté mur, bords des paliers.
 * Appelé après `checkSectionEdges`. `split` (origine `helical`) : arcs des axes découpés en
 * arcs élémentaires d'au plus 90° (`splitArc`, comme l'hélicoïdal), pour qu'un balayage de plus
 * d'un tour reste lisible par les algorithmes génériques (intersections, sous-courbes).
 */
function edgeSegments(
  side: Side,
  sections: readonly PlacedSection[],
  junctions: readonly PlacedJunction[],
  split = false,
): CurveSeg[] {
  const segs: CurveSeg[] = [];
  const pushLine = (a: Vec2, b: Vec2): void => {
    if (V.distance(a, b) > GEOM_EPS) segs.push(lineSeg(a, b));
  };
  sections.forEach((sec, i) => {
    const prev = junctions[i - 1];
    const next = junctions[i];
    let merged = false;
    if (sec.arc !== undefined) {
      // Raccords vifs seulement autour d'un axe en arc : le bord du jour part de K, le bord
      // côté mur prolonge l'arc par sa tangente jusqu'au coin W.
      const p0 = crossPoint(sec, 0, side);
      if (prev?.kind === "turn" && prev.side !== side) pushLine(prev.w, p0);
      const { center, radius, sweep, sign } = sec.arc;
      const rho = radius + sign * edgeOffset(sec.anchor, sec.w0, side);
      const a0 = V.angleOf(V.sub(p0, center));
      if (split) segs.push(...splitArc(center, rho, a0, sweep));
      else segs.push(arcSeg(center, rho, a0, sweep));
      if (next?.kind === "turn" && next.side !== side) pushLine(crossPoint(sec, 1, side), next.w);
    } else {
      const e = straightEdge(side, sections, junctions, i);
      merged = e.merged;
      pushLine(e.start, e.end);
    }
    if (next?.kind === "turn") {
      if (next.side === side)
        segs.push(...wellTurnSegments(next.well, next.k, next.a1, next.m1, next.a2));
      else if (next.fillet !== undefined) segs.push(next.fillet);
    } else if (next !== undefined && !merged) {
      pushLine(crossPoint(sec, 1, side), crossPoint(sections[i + 1]!, 0, side));
    }
  });
  return segs;
}

/** Pièces convexes de l'emprise (repère local), dans l'ordre de la montée. */
function generalPieces(
  sections: readonly PlacedSection[],
  junctions: readonly PlacedJunction[],
): CagePiece[] {
  const pieces: CagePiece[] = [];
  const push = (poly: readonly Vec2[], owners: readonly number[]): void => {
    if (poly.length < 3) return;
    const polygon = ensureCCW([...poly]);
    if (signedArea(polygon) > GEOM_EPS) pieces.push({ polygon, owners });
  };
  sections.forEach((sec, i) => {
    const prev = junctions[i - 1];
    const next = junctions[i];
    if (sec.arc !== undefined) {
      const { center, radius, sweep, sign } = sec.arc;
      const rhoL = radius + sign * edgeOffset(sec.anchor, sec.w0, "left");
      const rhoR = radius + sign * edgeOffset(sec.anchor, sec.w0, "right");
      const start = V.angleOf(V.sub(sec.a0, center));
      for (const p of annulusPieces(
        center,
        Math.min(rhoL, rhoR),
        Math.max(rhoL, rhoR),
        start,
        sweep,
      )) {
        push(p, [i]);
      }
    } else if (sec.length > GEOM_EPS) {
      let quad: Vec2[] = [
        crossPoint(sec, 0, "left"),
        crossPoint(sec, 1, "left"),
        crossPoint(sec, 1, "right"),
        crossPoint(sec, 0, "right"),
      ];
      if (prev?.kind === "turn" && prev.fillet !== undefined) quad = clipByArc(quad, prev.fillet);
      if (next?.kind === "turn" && next.fillet !== undefined) quad = clipByArc(quad, next.fillet);
      push(quad, [i]);
    }
    if (next === undefined) return;
    const owners = [i, i + 1];
    const out = sections[i + 1]!;
    if (next.kind === "straight") {
      push(
        [
          crossPoint(sec, 1, "left"),
          crossPoint(sec, 1, "right"),
          crossPoint(out, 0, "right"),
          crossPoint(out, 0, "left"),
        ],
        owners,
      );
      return;
    }
    for (const tri of [
      [next.k, next.p1, next.w],
      [next.k, next.w, next.p2],
    ]) {
      push(next.fillet !== undefined ? clipByArc(tri, next.fillet) : tri, owners);
    }
    const well = next.j.well;
    if (well.kind === "arc") {
      const [arc] = wellTurnSegments(next.well, next.k, next.a1, next.m1, next.a2);
      if (arc?.kind === "arc") for (const p of arcFanPieces(next.k, arc)) push(p, owners);
    } else if (well.kind === "chamfer") {
      push(
        [
          next.k,
          V.addScaled(next.k, next.a1, -well.setbackIn),
          V.addScaled(next.k, next.a2, well.setbackOut),
        ],
        owners,
      );
    }
  });
  return pieces;
}

/** Géométrie placée d'une cage générale (repère local). */
interface GeneralGeometry {
  readonly sections: readonly PlacedSection[];
  readonly geoms: readonly JunctionGeom[];
  readonly junctions: readonly PlacedJunction[];
}

function placeCage(project: Project, spec: CageLayoutSpec, fullTurns = false): GeneralGeometry {
  const lengths = resolveStraightLengths(project, spec);
  const sections = placeSections(spec, lengths, fullTurns);
  const geoms = spec.junctions.map((j, i) => junctionGeom(j, sections[i]!.w1));
  const junctions = placeJunctions(project, spec, sections, geoms);
  return { sections, geoms, junctions };
}

/**
 * Pièces convexes de l'emprise d'une cage générale (repère local du tracé) : celles que teste
 * le recouvrement en plan (propriétés dans `free.property.test.ts`).
 * @throws LayoutError comme `computeGeneralCageLayout`, si la cage ne se place pas.
 */
export function generalCagePieces(project: Project, spec: CageLayoutSpec): CagePiece[] {
  const g = placeCage(project, spec);
  return generalPieces(g.sections, g.junctions);
}

/**
 * Tracé d'une cage générale (largeur variable, axe en arc), repère monde. L'appelant
 * (`computeCageLayout`) a contrôlé le nombre de tronçons et de jonctions et le domaine des
 * jonctions.
 * @throws LayoutError si une cote est impossible (voir l'en-tête et les clés
 *   `layout.cage.*`).
 *
 * Origine `helical` (`options.origin`, cage issue d'un hélicoïdal, F10 sous-lot P1) : balayage
 * d'un axe en arc accepté au-delà d'un tour ; arcs des bords et de Γ découpés à 90° au plus
 * (`splitArc`) ; emprise en secteur de couronne, ou disque de R_e troué du disque de r_i au-delà
 * d'un tour, palier d'arrivée compris (`options.arrival`), comme l'ancien tracé hélicoïdal ;
 * `Layout.helicalOrigin` (fût ou jour, palier d'arrivée). Sans effet sur toute autre cage.
 */
export function computeGeneralCageLayout(
  project: Project,
  spec: CageLayoutSpec,
  options: CageLayoutOptions = {},
): Layout {
  const helical = options.origin === "helical";
  const { sections, geoms, junctions } = placeCage(project, spec, helical);
  const start = startSide(project, spec, sections, geoms);
  const innerSide = innerSideOf(sections, junctions);
  const turning = junctions.flatMap((j, i) => (j.kind === "turn" ? [{ j, i }] : []));
  const firstTurn = turning[0];

  checkSectionEdges(sections, junctions);
  const leftSegs = edgeSegments("left", sections, junctions, helical);
  const rightSegs = edgeSegments("right", sections, junctions, helical);
  const innerSegs = innerSide === "left" ? leftSegs : rightSegs;
  const outerSegs = innerSide === "left" ? rightSegs : leftSegs;

  // ---------------------------------------------------------------- ligne de foulée Γ
  const walks = sectionWalks(project, sections, junctions, start);
  const walkSegs: CurveSeg[] = [];
  const zones: { sStart: Mm; sEnd: Mm }[] = [];
  const transitions: WalklineTransition[] = [];
  const pushLine = (a: Vec2, b: Vec2): Mm => {
    const length = V.distance(a, b);
    if (length <= GEOM_EPS) return 0;
    walkSegs.push(lineSeg(a, b));
    return length;
  };
  let s = 0;
  const transitionsLocal: {
    leg: number;
    sStart: Mm;
    sEnd: Mm;
    o0: Mm;
    o1: Mm;
    direction: Vec2;
    angle: number;
  }[] = [];
  sections.forEach((sec, i) => {
    const walk = walks[i]!;
    const next = junctions[i];
    const sBefore = s;
    if (walk.arc !== undefined) {
      const { center, radius, startAngle, sweep } = walk.arc;
      if (helical) walkSegs.push(...splitArc(center, radius, startAngle, sweep));
      else walkSegs.push(walk.arc);
      s += walk.arc.radius * Math.abs(walk.arc.sweep);
    } else {
      const delta = V.sub(walk.g1, walk.g0);
      const length = V.norm(delta);
      const dir = length > GEOM_EPS ? V.scale(delta, 1 / length) : sec.u0;
      // Transition : Γ anguleuse au raccord avec l'arc d'une jonction tournante voisine (pas
      // à une extrémité d'escalier ni à la limite d'un palier droit, voir l'en-tête).
      const prev = junctions[i - 1];
      const angular0 = prev?.kind === "turn" && !parallel(dir, walk.ref0);
      const angular1 = next?.kind === "turn" && !parallel(dir, walk.ref1);
      const oblique = angular0 || angular1;
      const along = V.dot(delta, sec.u0);
      if (oblique && !(along > GEOM_EPS)) {
        throw new LayoutError(
          msg("layout.cage.sectionTooShortForTransition", {
            section: i + 1,
            junctionA: i,
            junctionB: i + 1,
            offset: mmText(firstTurn?.j.df ?? walklineOffsetFor(project.stair.walkline, sec.w0)),
          }),
        );
      }
      if (along < -GEOM_EPS) {
        throw new LayoutError(
          msg("layout.cage.sectionTooShort", {
            section: i + 1,
            length: mmText(sec.length),
            required: mmText(sec.length - along),
          }),
        );
      }
      s += pushLine(walk.g0, walk.g1);
      if (oblique && length > GEOM_EPS) {
        const direction = angular0 ? walk.ref0 : walk.ref1;
        const innerAt = (end: 0 | 1, g: Vec2): Mm => {
          const r = end === 0 ? sec.r0 : sec.r1;
          return V.dot(
            V.sub(g, crossPoint(sec, end, innerSide)),
            innerSide === "left" ? r : V.scale(r, -1),
          );
        };
        transitionsLocal.push({
          leg: i,
          sStart: sBefore,
          sEnd: s,
          o0: innerAt(0, walk.g0),
          o1: innerAt(1, walk.g1),
          direction,
          angle: Math.abs(V.signedAngle(direction, dir)),
        });
      }
    }
    if (next === undefined) return;
    const sStart = s;
    if (next.kind === "turn") {
      walkSegs.push(next.walk);
      s += next.walkLength;
    } else {
      // Palier droit : Γ droite de l'arrivée du tronçon entrant au départ du sortant.
      s += pushLine(walk.g1, walks[i + 1]!.g0);
    }
    zones.push({ sStart, sEnd: s });
  });
  const walkLength = s;

  // Congés côté mur : ni Γ ni le bord du jour ne coupent l'arc du congé.
  turning.forEach(({ j, i }) =>
    checkWallArc(j.wall, i, j.w, j.b1, j.nw1, [
      ...walkSegs,
      ...(j.side === "left" ? leftSegs : rightSegs),
    ]),
  );

  // Emprise dégénérée (contact, recouvrement) et avertissements F4.
  const layoutErrors = [
    // Demi-tour à jour nul : balayages effectifs φ des bords du jour réels (θ exact quand ils
    // ne sont pas inclinés).
    ...sectionsTouch(
      geoms.map((g, i) => {
        const j = junctions[i]!;
        return g.kind === "turn" && j.kind === "turn" ? { ...g, sweep: j.well.sweep } : g;
      }),
      (i) => (sections[i]!.kind === "straight" ? sections[i]!.length : undefined),
    ),
    ...piecesOverlap(generalPieces(sections, junctions), sections.length),
  ];
  const notes = wideAngleNotes(geoms, spec.wallSharpWarningAngle ?? WALL_SHARP_WARNING_ANGLE);

  // ---------------------------------------------------------------- repère monde
  const { origin, rotation } = project.stair.placement;
  const angle = (rotation * Math.PI) / 180;
  const toWorld = (p: Vec2): Vec2 => V.add(V.rotate(p, angle), origin);
  const curveToWorld = (c: Curve2): Curve2 => translateCurve(rotateCurve(c, angle), origin);

  let zeroLengthInner: ZeroLengthInnerCorner[] | undefined;
  if (innerSegs.length === 0 && firstTurn !== undefined) {
    zeroLengthInner = [];
    turning.forEach(({ j, i }) => {
      if (j.side !== innerSide) return;
      zeroLengthInner!.push({
        corner: toWorld(j.k),
        incoming: V.rotate(sections[i]!.u1, angle),
        outgoing: V.rotate(sections[i + 1]!.u0, angle),
      });
    });
    innerSegs.push(lineSeg(firstTurn.j.k, firstTurn.j.k));
  }
  if (outerSegs.length === 0 && firstTurn !== undefined) {
    outerSegs.push(lineSeg(firstTurn.j.k, firstTurn.j.k));
  }
  const inner = curveToWorld(makeCurve(innerSegs));
  const outer = curveToWorld(makeCurve(outerSegs));
  const walkline = curveToWorld(makeCurve(walkSegs));

  const outerSide = other(innerSide);
  const turnZones: TurnZone[] = junctions.map((j, i): TurnZone => {
    const g = geoms[i]!;
    if (j.kind === "straight") {
      return {
        index: i,
        direction: innerSide,
        mode: "landing",
        innerCorner: toWorld(crossPoint(sections[i]!, 1, innerSide)),
        outerCorner: toWorld(crossPoint(sections[i + 1]!, 0, outerSide)),
        sStart: zones[i]!.sStart,
        sEnd: zones[i]!.sEnd,
        collarSide: innerSide,
        angle: 0,
        well: g.source.well,
        wall: g.source.wall,
        walklineOffset: j.df,
      };
    }
    return {
      index: i,
      direction: j.side,
      mode: j.j.mode,
      innerCorner: toWorld(j.k),
      outerCorner: toWorld(j.w),
      sStart: zones[i]!.sStart,
      sEnd: zones[i]!.sEnd,
      collarSide: j.side,
      angle: j.j.sweep,
      well: g.source.well,
      wall: g.source.wall,
      walklineOffset: j.df,
    };
  });

  for (const tr of transitionsLocal) {
    transitions.push({
      leg: tr.leg,
      sStart: tr.sStart,
      sEnd: tr.sEnd,
      fromOffset: tr.o0,
      toOffset: tr.o1,
      direction: V.rotate(tr.direction, angle),
      angle: tr.angle,
    });
  }

  const layoutSections: LayoutSection[] = sections.map((sec, i) => {
    const prev = junctions[i - 1];
    const next = junctions[i];
    const line = (end: 0 | 1) => ({
      left: toWorld(crossPoint(sec, end, "left")),
      right: toWorld(crossPoint(sec, end, "right")),
    });
    return {
      index: i,
      kind: sec.kind,
      start: line(0),
      end: line(1),
      widthStart: sec.w0,
      widthEnd: sec.w1,
      ...(prev?.kind === "turn" ? { startWellSide: prev.side } : {}),
      ...(next?.kind === "turn" ? { endWellSide: next.side } : {}),
      sStart: i > 0 ? zones[i - 1]!.sEnd : 0,
      sEnd: next !== undefined ? zones[i]!.sStart : walkLength,
      ...(sec.arc !== undefined
        ? {
            arc: {
              center: toWorld(sec.arc.center),
              radius: sec.arc.radius,
              sweep: sec.arc.sweep,
            },
          }
        : {}),
    };
  });

  // d_f : première jonction tournante, sinon départ (`TurnZone.walklineOffset` par jonction).
  const df = firstTurn?.j.df ?? walklineOffsetFor(project.stair.walkline, sections[0]!.w0);

  // Origine `helical` : emprise et palier d'arrivée de l'hélicoïdal.
  const ring =
    helical && sections.length === 1 && sections[0]!.arc !== undefined
      ? helicalRing(sections[0]!, options, toWorld, angle)
      : undefined;

  return {
    inner,
    outer,
    walkline,
    walklineOffset: df,
    footprint: ring?.footprint ?? footprintOf(inner, outer),
    ...(ring?.footprintHoles ? { footprintHoles: ring.footprintHoles } : {}),
    turns: turnZones,
    ...(layoutErrors.length > 0 ? { errors: layoutErrors } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(zeroLengthInner !== undefined ? { zeroLengthInner } : {}),
    innerSide,
    // Bord de mesure de d_f sans jonction tournante (escalier droit, paliers droits, arc).
    ...(firstTurn === undefined ? { walklineSide: start } : {}),
    ...(transitions.length > 0 ? { walklineTransitions: transitions } : {}),
    sections: layoutSections,
    ...(helical
      ? {
          helicalOrigin: {
            core: options.core ?? "column",
            arrivalSweep: ring?.arrivalSweep ?? 0,
            ...(ring?.arrivalOutline ? { arrivalOutline: ring.arrivalOutline } : {}),
          },
        }
      : {}),
  };
}

/**
 * Emprise d'une cage issue d'un hélicoïdal (un tronçon à axe en arc, repère monde), comme
 * l'ancien tracé hélicoïdal : secteur de couronne des marches et du palier d'arrivée si leur balayage
 * cumulé reste sous un tour, sinon disque de R_e troué du disque de r_i (`footprintHoles`) ;
 * contour du palier d'arrivée (secteur au-delà de l'arrivée de l'arc), s'il y en a un.
 */
function helicalRing(
  sec: PlacedSection,
  options: CageLayoutOptions,
  toWorld: (p: Vec2) => Vec2,
  rotation: number,
): {
  footprint: Polygon2;
  footprintHoles?: Polygon2[];
  arrivalSweep: number;
  arrivalOutline?: Polygon2;
} {
  const { center, radius, sweep, sign } = sec.arc!;
  const rhoL = radius + sign * edgeOffset(sec.anchor, sec.w0, "left");
  const rhoR = radius + sign * edgeOffset(sec.anchor, sec.w0, "right");
  const rIn = Math.min(rhoL, rhoR);
  const rOut = Math.max(rhoL, rhoR);
  const c = toWorld(center);
  const start = V.angleOf(V.sub(sec.a0, center)) + rotation;
  const landing = options.arrival ? (Math.abs(options.arrival.sweep) * Math.PI) / 180 : 0;
  const arrivalOutline =
    landing > 0 ? sectorRing(c, rIn, rOut, start + sweep, sign * landing) : undefined;
  const covered = Math.abs(sweep) + landing;
  const partial = covered < 2 * Math.PI - 1e-9;
  return {
    footprint: partial ? sectorRing(c, rIn, rOut, start, sign * covered) : discPolygon(c, rOut),
    ...(!partial && rIn > 0 ? { footprintHoles: [discPolygon(c, rIn)] } : {}),
    arrivalSweep: sign * landing,
    ...(arrivalOutline ? { arrivalOutline } : {}),
  };
}
