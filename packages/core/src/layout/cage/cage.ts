/**
 * Moteur de tracé d'une cage (ADR-0010) : suite de tronçons reliés par des jonctions, bords C_i,
 * C_e et ligne de foulée Γ en forme fermée, jonction par jonction (CHALLENGE G1).
 *
 * Tronçons droits de largeur constante ; jonctions tournantes d'angle quelconque (|θ| < 180°,
 * marches balancées, palier d'angle ou marches rayonnantes ; jour vif, en arc, en pan coupé, ou
 * à poteau à ±90° seulement ; mur vif ou en congé) et paliers droits (θ = 0) : sous-lot 2a,
 * formes fermées dans `junction.ts`. Depuis le sous-lot 1c, c'est le seul moteur des tracés à
 * volées et des cages (`computeLayout`, `layout/layout.ts`) ; pour la cage issue de
 * `flightsToCage`, le résultat est **identique**, nombre pour nombre, à celui de l'ancien moteur
 * à volées (supprimé au sous-lot 2f ; parité figée en instantanés,
 * `parity.test.ts`) : les angles 0 et ±90° gardent leurs branches exactes (`frames.ts`) ;
 * `sections` et les champs `angle`, `well`, `wall` des tournants sont en plus. Largeur variable
 * et axe en arc (sous-lot 2b) : délégués au moteur général (`general.ts`, `needsGeneralEngine`),
 * qui rend le même tracé que ce fichier sur une cage de largeur constante (à 1e-6 mm près).
 *
 * Avertissements (`Layout.notes`, non bloquants, repris dans `Model.notes`) : jonction de plus
 * de `wallSharpWarningAngle` (paramètre de la cage, défaut `WALL_SHARP_WARNING_ANGLE`, « à
 * valider ») avec un mur vif (décision F4).
 *
 * Recouvrement en plan : boîte englobante du moteur à volées pour une cage issue de volées
 * (`degenerateFootprint`, parité des messages), pièces convexes pour une cage saisie
 * (`overlap.ts`).
 *
 * Conventions (repère local, côtés du jour, S / Z, raccords, palier d'angle, emprise) : celles
 * de `layout/layout.ts`, dont ce moteur reprend les formes fermées. Mesure de `axis.length` et
 * vocabulaire des erreurs selon l'origine de la cage (`CageOrigin`) : `section.ts`.
 */
import type {
  Layout,
  LayoutSection,
  TurnZone,
  WalklineTransition,
  ZeroLengthInnerCorner,
} from "../../model/derived.js";
import type { Curve2, CurveSeg, Mm, Vec2 } from "../../model/primitives.js";
import type { CageLayoutSpec, Project } from "../../model/project.js";
import { makeCurve, rotateCurve, translateCurve } from "../../geom2d/curve.js";
import { lineSeg } from "../../geom2d/segment.js";
import { GEOM_EPS } from "../../geom2d/tolerance.js";
import * as V from "../../geom2d/vec.js";
import { msg, type Message } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { walklineOffsetFor } from "../resolve.js";
import { resolveWalklineSide } from "../walklineSide.js";
import { at, buildFrames, type SectionFrame } from "./frames.js";
import {
  checkJunctionDomain,
  checkNewel,
  checkWallArc,
  collarNormal,
  junctionGeom,
  sideOffset,
  walklineArc,
  wallCorner,
  wallTurnSegments,
  WALL_SHARP_WARNING_ANGLE,
  wellCorner,
  wellTurnSegments,
  wideAngleNotes,
  type JunctionGeom,
  type Side,
  type TurnJunction,
} from "./junction.js";
import { cageOverlap, footprintOf } from "./overlap.js";
import { computeGeneralCageLayout } from "./general.js";
import { checkHelicalOrigin } from "./helicalChecks.js";
import {
  checkSectionCount,
  checkSectionExtents,
  checkSectionLength,
  edgeRange,
  resolveStraightLengths,
  walkRange,
  type CageOrigin,
  type SectionContext,
} from "./section.js";

/**
 * Vrai si la cage passe par le moteur général (`general.ts`) : un tronçon à axe en arc, ou une
 * largeur non uniforme (`widthEnd` ≠ `width`, ou tronçons de largeurs différentes). Les autres
 * cages (largeur constante, axes droits) gardent le calcul à largeur unique de ce fichier, dont
 * la parité avec le moteur à volées est exacte.
 */
export function needsGeneralEngine(spec: CageLayoutSpec): boolean {
  const width = spec.sections[0]?.width;
  return spec.sections.some(
    (s) =>
      s.axis.kind === "arc" ||
      s.width !== width ||
      (s.widthEnd !== undefined && s.widthEnd !== width),
  );
}

/** Options de `computeCageLayout`. */
export interface CageLayoutOptions {
  /**
   * Origine de la cage (`section.ts`) : `cage` (défaut) pour une cage saisie, erreurs
   * `layout.cage.*` en tronçons et en parties droites, borne `CAGE_MAX_SECTIONS` ; `flights`
   * pour une cage issue de `flightsToCage`, erreurs du moteur à volées à l'identique (parité),
   * sans borne du nombre de tronçons ; `helical` pour une cage issue d'un hélicoïdal
   * (`helicalToCage`, F10 sous-lot P1) : un tronçon à axe en arc dont le balayage peut
   * dépasser un tour, avec `core` et `arrival` (moteur général, `general.ts`).
   */
  readonly origin?: CageOrigin;
  /** Origine `helical` : fût central (`column`) ou jour central (`well`), vocabulaire des erreurs. */
  readonly core?: "column" | "well";
  /**
   * Origine `helical` : palier d'arrivée en secteur, prolongeant l'axe en arc au niveau du
   * plancher haut, de balayage signé `sweep` (degrés, signe du sens de montée). Absent : aucun.
   */
  readonly arrival?: { readonly sweep: number };
}

/**
 * Calcule le tracé d'une cage (bords, ligne de foulée, tournants, tronçons, emprise), en repère
 * monde. `project` fournit la ligne de foulée (`stair.walkline`), le placement, et, pour un
 * escalier droit, le bord de mesure automatique (murs du site, garde-corps) et la longueur
 * `auto` ; `spec` est la cage à calculer (celle du projet, ou celle d'un tracé à volées converti
 * par `flightsToCage`, avec `origin: "flights"`).
 *
 * @throws LayoutError si une jonction est hors domaine, si la topologie est incohérente ou si
 *   les cotes sont impossibles (largeur variable, axe en arc : voir `general.ts`)
 *   (pour une cage issue de volées : mêmes contrôles, dans le même ordre et avec les mêmes
 *   messages que le moteur à volées ; pour une cage issue d'un hélicoïdal, contrôles de
 *   `computeHelicalLayout` d'abord, `helicalChecks.ts`).
 */
export function computeCageLayout(
  project: Project,
  spec: CageLayoutSpec,
  options: CageLayoutOptions = {},
): Layout {
  const vocabulary: CageOrigin = options.origin ?? "cage";
  // Origine `helical` : contrôles de l'hélicoïdal d'origine avant tout autre (F10, P2).
  if (vocabulary === "helical") checkHelicalOrigin(project, spec, options.core);
  checkSectionCount(spec, vocabulary);
  spec.junctions.forEach((j, i) => checkJunctionDomain(j, i));
  // Largeur variable ou axe en arc (sous-lot 2b) : moteur général.
  if (needsGeneralEngine(spec)) return computeGeneralCageLayout(project, spec, options);
  const width = spec.sections[0]!.width;
  const junctions = spec.junctions.map((j) => junctionGeom(j, width));
  const straight = resolveStraightLengths(project, spec);
  const frames = buildFrames(
    straight,
    junctions.map((j) => ({
      angle: j.source.angle,
      depth: j.kind === "straight" ? j.depth : undefined,
    })),
    width,
  );
  checkSectionExtents(frames, vocabulary);

  /** Jonctions tournantes, avec leur indice de jonction. */
  const turning = junctions.flatMap((j, i) => (j.kind === "turn" ? [{ j, i }] : []));
  const firstTurn = turning[0];
  // Côté intérieur : jour du premier tournant (S / Z : le second tournant a son jour en face).
  const innerSide: Side = firstTurn?.j.side ?? "left";

  const df = walklineOffsetFor(project.stair.walkline, width);
  turning.forEach(({ j, i }) => checkNewel(j.well, i, df));

  const contexts: SectionContext[] = frames.map((frame, i) => ({
    frame,
    prev: i > 0 ? junctions[i - 1] : undefined,
    next: junctions[i],
  }));
  contexts.forEach((ctx, i) => checkSectionLength(ctx, i, width, vocabulary));

  const cornerOf = (i: number): Vec2 => {
    const j = junctions[i] as TurnJunction;
    return wellCorner(frames[i]!, j.side, width);
  };
  const normalOf = (i: number): Vec2 =>
    collarNormal(frames[i]!, (junctions[i] as TurnJunction).side);
  // Emprises dégénérées (dette D3), signalées sans bloquer le calcul (`Layout.errors`).
  const layoutErrors =
    vocabulary === "flights"
      ? degenerateFootprint(frames, junctions, width)
      : cageOverlap(frames, junctions, width);

  // Avertissements (décision F4) : grand angle avec un raccord côté mur vif ; seuil paramètre
  // du projet (`wallSharpWarningAngle`, défaut « à valider » `WALL_SHARP_WARNING_ANGLE`).
  const notes = wideAngleNotes(junctions, spec.wallSharpWarningAngle ?? WALL_SHARP_WARNING_ANGLE);

  /** Ajoute la droite [a, b] si elle n'est pas dégénérée ; renvoie la longueur ajoutée. */
  const pushLine = (segs: CurveSeg[], a: Vec2, b: Vec2): Mm => {
    const length = V.distance(a, b);
    if (length <= GEOM_EPS) return 0;
    segs.push(lineSeg(a, b));
    return length;
  };

  // ---------------------------------------------------------------- bords gauche et droit
  const edgeSegments = (side: Side): CurveSeg[] => {
    const segs: CurveSeg[] = [];
    const offset = sideOffset(side, width);
    contexts.forEach((ctx, i) => {
      const [t0, t1] = edgeRange(ctx, side);
      pushLine(segs, at(ctx.frame, t0, offset), at(ctx.frame, t1, offset));
      const next = ctx.next;
      if (next?.kind !== "turn") return;
      if (next.side === side) {
        segs.push(
          ...wellTurnSegments(
            next,
            cornerOf(i),
            ctx.frame.u,
            collarNormal(ctx.frame, next.side),
            frames[i + 1]!.u,
          ),
        );
      } else {
        segs.push(
          ...wallTurnSegments(
            next,
            wallCorner(ctx.frame, next.side, width),
            ctx.frame.u,
            collarNormal(ctx.frame, next.side),
          ),
        );
      }
    });
    return segs;
  };
  const leftSegs = edgeSegments("left");
  const rightSegs = edgeSegments("right");
  const innerSegs = innerSide === "left" ? leftSegs : rightSegs;
  const outerSegs = innerSide === "left" ? rightSegs : leftSegs;

  // ---------------------------------------------------------------- ligne de foulée Γ
  // Distance de Γ au bord gauche au droit d'une jonction tournante : d_f du côté de son jour.
  const turnOffset = (j: TurnJunction): Mm => (j.side === "left" ? df : width - df);
  // Escalier droit d'un seul tronçon : d_f mesurée depuis le bord choisi ou automatique
  // (décision A16). Escalier droit à paliers droits : bord choisi, sinon gauche (le bord
  // automatique, qui lit les murs, n'est mémoïsé que pour un tronçon unique : sous-lot 2c).
  const walklineSide =
    junctions.length === 0
      ? resolveWalklineSide(project, frames[0]!.length)
      : firstTurn === undefined
        ? (project.stair.walkline.side ?? "left")
        : undefined;
  const startOffset =
    firstTurn !== undefined ? turnOffset(firstTurn.j) : walklineSide === "right" ? width - df : df;
  // Au droit de chaque jonction ; un palier droit garde la distance de la jonction précédente.
  const junctionOffsets: Mm[] = [];
  junctions.forEach((j, i) => {
    junctionOffsets.push(
      j.kind === "turn" ? turnOffset(j) : i > 0 ? junctionOffsets[i - 1]! : startOffset,
    );
  });
  const walkSegs: CurveSeg[] = [];
  const zones: { sStart: Mm; sEnd: Mm }[] = [];
  const transitions: { leg: number; sStart: Mm; sEnd: Mm; o0: Mm; o1: Mm; angle: number }[] = [];
  let s = 0;
  contexts.forEach((ctx, i) => {
    const { frame, prev, next } = ctx;
    const [t0, t1] = walkRange(ctx);
    const o0 = prev !== undefined ? junctionOffsets[i - 1]! : startOffset;
    const o1 = next !== undefined ? junctionOffsets[i]! : o0;
    if (Math.abs(o1 - o0) > GEOM_EPS && !(t1 - t0 > GEOM_EPS)) {
      throw new LayoutError(
        vocabulary === "flights"
          ? msg("layout.legTooShortForTransition", {
              flight: i + 1,
              turnA: i,
              turnB: i + 1,
              offset: String(df),
            })
          : msg("layout.cage.sectionTooShortForTransition", {
              section: i + 1,
              junctionA: i,
              junctionB: i + 1,
              offset: String(df),
            }),
      );
    }
    const sBefore = s;
    s += pushLine(walkSegs, at(frame, t0, o0), at(frame, t1, o1));
    if (Math.abs(o1 - o0) > GEOM_EPS) {
      transitions.push({
        leg: i,
        sStart: sBefore,
        sEnd: s,
        o0,
        o1,
        angle: Math.atan2(Math.abs(o1 - o0), t1 - t0),
      });
    }
    if (next === undefined) return;
    const sStart = s;
    if (next.kind === "turn") {
      const arc = walklineArc(next, frame, width, df);
      walkSegs.push(arc.seg);
      s += arc.length;
    } else {
      // Palier droit : Γ droite sur la profondeur du palier.
      s += pushLine(walkSegs, at(frame, t1, o1), at(frame, frame.length, o1));
    }
    zones.push({ sStart, sEnd: s });
  });
  const walkLength = s;

  // Congés côté mur : ni Γ ni le bord du jour de la jonction ne coupent l'arc du congé (pan
  // coupé : Γ à distance ≥ d_f du pan par construction, `junction.ts`).
  turning.forEach(({ j, i }) =>
    checkWallArc(j, i, wallCorner(frames[i]!, j.side, width), frames[i]!.u, normalOf(i), [
      ...walkSegs,
      ...(j.side === "left" ? leftSegs : rightSegs),
    ]),
  );

  // ---------------------------------------------------------------- repère monde
  const { origin, rotation } = project.stair.placement;
  const angle = (rotation * Math.PI) / 180;
  const toWorld = (p: Vec2): Vec2 => V.add(V.rotate(p, angle), origin);
  const curveToWorld = (c: Curve2): Curve2 => translateCurve(rotateCurve(c, angle), origin);

  // Jour réduit à un point (quart tournant sans partie droite, angle vif) : courbe de longueur
  // nulle au coin ; signalement par le pipeline selon les murs (`zeroLengthJour.ts`).
  let zeroLengthInner: ZeroLengthInnerCorner[] | undefined;
  if (innerSegs.length === 0 && firstTurn !== undefined) {
    zeroLengthInner = [];
    turning.forEach(({ j, i }) => {
      if (j.side !== innerSide) return;
      zeroLengthInner!.push({
        corner: toWorld(cornerOf(i)),
        incoming: V.rotate(frames[i]!.u, angle),
        outgoing: V.rotate(frames[i + 1]!.u, angle),
      });
    });
    innerSegs.push(lineSeg(cornerOf(firstTurn.i), cornerOf(firstTurn.i)));
  }
  if (outerSegs.length === 0 && firstTurn !== undefined) {
    outerSegs.push(lineSeg(cornerOf(firstTurn.i), cornerOf(firstTurn.i)));
  }
  const inner = curveToWorld(makeCurve(innerSegs));
  const outer = curveToWorld(makeCurve(outerSegs));
  const walkline = curveToWorld(makeCurve(walkSegs));

  const innerOffset = sideOffset(innerSide, width);
  const outerOffset = width - innerOffset;
  const turnZones: TurnZone[] = junctions.map((j, i): TurnZone => {
    const frame = frames[i]!;
    if (j.kind === "straight") {
      // Palier droit : coins au début (côté intérieur) et à la fin (côté extérieur) du palier.
      return {
        index: i,
        direction: innerSide,
        mode: "landing",
        innerCorner: toWorld(at(frame, frame.length - frame.tail, innerOffset)),
        outerCorner: toWorld(at(frame, frame.length, outerOffset)),
        sStart: zones[i]!.sStart,
        sEnd: zones[i]!.sEnd,
        collarSide: innerSide,
        angle: 0,
        well: j.source.well,
        wall: j.source.wall,
      };
    }
    return {
      index: i,
      direction: j.side,
      mode: j.mode,
      innerCorner: toWorld(cornerOf(i)),
      outerCorner: toWorld(wallCorner(frame, j.side, width)),
      sStart: zones[i]!.sStart,
      sEnd: zones[i]!.sEnd,
      collarSide: j.side,
      angle: j.sweep,
      well: j.source.well,
      wall: j.source.wall,
    };
  });

  // Distances à `inner` (et non au bord gauche) des transitions.
  const fromInner = (o: Mm): Mm => (innerSide === "left" ? o : width - o);
  const walklineTransitions: WalklineTransition[] = transitions.map((tr) => ({
    leg: tr.leg,
    sStart: tr.sStart,
    sEnd: tr.sEnd,
    fromOffset: fromInner(tr.o0),
    toOffset: fromInner(tr.o1),
    direction: V.rotate(frames[tr.leg]!.u, angle),
    angle: tr.angle,
  }));

  const sections: LayoutSection[] = contexts.map((ctx, i) => {
    const { frame, prev, next } = ctx;
    const tStart = frame.lead;
    const tEnd = frame.length - frame.tail;
    const line = (t: Mm) => ({
      left: toWorld(at(frame, t, 0)),
      right: toWorld(at(frame, t, width)),
    });
    return {
      index: i,
      kind: "straight",
      start: line(tStart),
      end: line(tEnd),
      widthStart: width,
      widthEnd: width,
      ...(prev?.kind === "turn" ? { startWellSide: prev.side } : {}),
      ...(next?.kind === "turn" ? { endWellSide: next.side } : {}),
      sStart: i > 0 ? zones[i - 1]!.sEnd : 0,
      sEnd: next !== undefined ? zones[i]!.sStart : walkLength,
    };
  });

  return {
    inner,
    outer,
    walkline,
    walklineOffset: df,
    footprint: footprintOf(inner, outer),
    turns: turnZones,
    ...(layoutErrors.length > 0 ? { errors: layoutErrors } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(zeroLengthInner !== undefined ? { zeroLengthInner } : {}),
    innerSide,
    ...(walklineSide !== undefined ? { walklineSide } : {}),
    ...(walklineTransitions.length > 0 ? { walklineTransitions } : {}),
    sections,
  };
}

/**
 * Emprises dégénérées d'une cage **issue de volées** (jonctions de ±90°, tronçons alignés sur
 * les axes du repère local), mêmes constats et mêmes messages que le moteur à volées (une cage
 * saisie passe par `overlap.ts`) :
 * - deux jonctions successives de même sens dont le tronçon intermédiaire ne laisse aucun jour
 *   (partie droite nulle, jour à angle vif) : les tronçons qui se font face se touchent ;
 * - deux tronçons non consécutifs qui se superposent en plan (recouvrement d'aire non nulle de
 *   leurs rectangles hors tout).
 * Constats géométriques, sans seuil.
 */
function degenerateFootprint(
  frames: readonly SectionFrame[],
  turns: readonly JunctionGeom[],
  width: Mm,
): Message[] {
  const out: Message[] = [];
  const sideOf = (i: number): Side | undefined => {
    const t = turns[i]!;
    return t.kind === "turn" ? t.side : undefined;
  };
  for (let i = 0; i + 1 < turns.length; i++) {
    if (sideOf(i) !== sideOf(i + 1)) continue;
    const jour = frames[i + 1]!.length - 2 * width;
    if (jour <= GEOM_EPS) {
      out.push(
        msg("layout.flightsTouch", {
          turnA: i + 1,
          turnB: i + 2,
          flight: i + 2,
          length: String(frames[i + 1]!.length),
          before: i + 1,
          after: i + 3,
        }),
      );
    }
  }
  const box = (frame: SectionFrame): { lo: Vec2; hi: Vec2 } => {
    const a = at(frame, 0, 0);
    const b = at(frame, frame.length, width);
    return {
      lo: V.vec(Math.min(a.x, b.x), Math.min(a.y, b.y)),
      hi: V.vec(Math.max(a.x, b.x), Math.max(a.y, b.y)),
    };
  };
  const boxes = frames.map(box);
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 2; j < frames.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ox = Math.min(a.hi.x, b.hi.x) - Math.max(a.lo.x, b.lo.x);
      const oy = Math.min(a.hi.y, b.hi.y) - Math.max(a.lo.y, b.lo.y);
      if (ox > GEOM_EPS && oy > GEOM_EPS) {
        const x = String(Math.round(ox));
        const y = String(Math.round(oy));
        out.push(msg("layout.flightsOverlap", { flightA: i + 1, flightB: j + 1, x, y }));
      }
    }
  }
  return out;
}
