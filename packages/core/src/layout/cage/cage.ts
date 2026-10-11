/**
 * Moteur de tracé d'une cage (ADR-0010) : suite de tronçons reliés par des jonctions, bords C_i,
 * C_e et ligne de foulée Γ en forme fermée, jonction par jonction (CHALLENGE G1).
 *
 * Lot 1 (sous-lot 1b) : tronçons droits de largeur constante et jonctions tournantes à ±90°
 * (marches balancées ou palier d'angle ; jour vif, en arc ou à poteau éventuellement décalé ;
 * mur vif), c'est-à-dire exactement ce qu'exprime un tracé à volées. Depuis le sous-lot 1c,
 * c'est le seul moteur des tracés à volées et des cages (`computeLayout`, `layout/layout.ts`) ;
 * pour la cage issue de `flightsToCage`, le résultat est **identique**, nombre pour nombre, à
 * celui de l'ancien moteur à volées (copie figée `layout/legacyFlights.ts`, réservée aux tests,
 * parité `parity.test.ts`) ; `sections` et les champs `angle`, `well`, `wall` des tournants
 * sont en plus. Les autres fonctions de la cage (angle
 * quelconque, palier droit, largeur variable, axe en arc, pan coupé, mur en arc, marches
 * rayonnantes) sont refusées par une `LayoutError` claire, en attendant le lot 2.
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
import type { Curve2, CurveSeg, Mm, Polygon2, Vec2 } from "../../model/primitives.js";
import {
  CAGE_MAX_SECTIONS,
  type CageJunction,
  type CageLayoutSpec,
  type Project,
} from "../../model/project.js";
import {
  flattenCurve,
  makeCurve,
  reverseCurve,
  rotateCurve,
  translateCurve,
} from "../../geom2d/curve.js";
import { ensureCCW } from "../../geom2d/polygon.js";
import { lineSeg } from "../../geom2d/segment.js";
import { GEOM_EPS } from "../../geom2d/tolerance.js";
import * as V from "../../geom2d/vec.js";
import { msg, type Message } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { walklineOffsetFor } from "../resolve.js";
import { resolveWalklineSide } from "../walklineSide.js";
import { at, buildFrames, type SectionFrame } from "./frames.js";
import {
  checkNewel,
  collarNormal,
  junctionSide,
  supportedWell,
  walklineArc,
  wallCorner,
  wellCorner,
  wellTurnSegments,
  type Side,
  type SupportedWell,
} from "./junction.js";
import {
  checkSectionLength,
  edgeRange,
  resolveStraightLengths,
  sectionExtents,
  walkRange,
  type CageOrigin,
  type SectionContext,
} from "./section.js";

/** Jonction tournante prise en charge au lot 1. */
interface Turning {
  readonly side: Side;
  readonly mode: "winders" | "landing";
  readonly well: SupportedWell;
  readonly source: CageJunction;
}

/**
 * Refuse les fonctions de la cage pas encore calculées (lot 2) et rend les jonctions tournantes.
 * La borne de calcul `CAGE_MAX_SECTIONS` (F8) ne vaut que pour une cage saisie : un tracé à
 * volées n'a pas de borne du nombre de volées (`FlightsLayoutSpecSchema`) et doit rester calculé
 * à l'identique ; une cage issue de volées doit seulement avoir au moins un tronçon.
 * @throws LayoutError (`layout.cage.*`) au premier tronçon ou à la première jonction refusés.
 */
function supportedTurns(spec: CageLayoutSpec, origin: CageOrigin): { width: Mm; turns: Turning[] } {
  const n = spec.sections.length;
  if (n < 1 || (origin === "cage" && n > CAGE_MAX_SECTIONS)) {
    throw new LayoutError(msg("layout.cage.sectionCount", { count: n, max: CAGE_MAX_SECTIONS }));
  }
  if (spec.junctions.length !== n - 1) {
    throw new LayoutError(
      msg("layout.cage.junctionCountMismatch", { sections: n, junctions: spec.junctions.length }),
    );
  }
  const width = spec.sections[0]!.width;
  spec.sections.forEach((s, i) => {
    if (s.axis.kind === "arc") {
      throw new LayoutError(msg("layout.cage.arcAxisNotYetSupported", { section: i + 1 }));
    }
    if (s.width !== width || (s.widthEnd !== undefined && s.widthEnd !== width)) {
      throw new LayoutError(msg("layout.cage.variableWidthNotYetSupported", { section: i + 1 }));
    }
  });
  const turns = spec.junctions.map((j, i): Turning => {
    if (j.angle !== 90 && j.angle !== -90) {
      throw new LayoutError(
        msg("layout.cage.angleNotYetSupported", { junction: i + 1, angle: String(j.angle) }),
      );
    }
    if (j.mode === "radiating") {
      throw new LayoutError(msg("layout.cage.radiatingNotYetSupported", { junction: i + 1 }));
    }
    if (j.wall.kind !== "sharp") {
      throw new LayoutError(msg("layout.cage.wallArcNotYetSupported", { junction: i + 1 }));
    }
    return { side: junctionSide(j), mode: j.mode, well: supportedWell(j, i), source: j };
  });
  return { width, turns };
}

/** Options de `computeCageLayout`. */
export interface CageLayoutOptions {
  /**
   * Origine de la cage (`section.ts`) : `cage` (défaut) pour une cage saisie, erreurs
   * `layout.cage.*` en tronçons et en parties droites, borne `CAGE_MAX_SECTIONS` ; `flights`
   * pour une cage issue de `flightsToCage`, erreurs du moteur à volées à l'identique (parité),
   * sans borne du nombre de tronçons.
   */
  readonly origin?: CageOrigin;
}

/**
 * Calcule le tracé d'une cage (bords, ligne de foulée, tournants, tronçons, emprise), en repère
 * monde. `project` fournit la ligne de foulée (`stair.walkline`), le placement, et, pour un
 * escalier droit, le bord de mesure automatique (murs du site, garde-corps) et la longueur
 * `auto` ; `spec` est la cage à calculer (celle du projet, ou celle d'un tracé à volées converti
 * par `flightsToCage`, avec `origin: "flights"`).
 *
 * @throws LayoutError si une fonction de la cage n'est pas encore prise en charge (lot 2), si la
 *   topologie est incohérente ou si les cotes sont impossibles (pour une cage issue de volées :
 *   mêmes contrôles, dans le même ordre et avec les mêmes messages que le moteur à volées).
 */
export function computeCageLayout(
  project: Project,
  spec: CageLayoutSpec,
  options: CageLayoutOptions = {},
): Layout {
  const vocabulary: CageOrigin = options.origin ?? "cage";
  const { width, turns } = supportedTurns(spec, vocabulary);
  const extents = sectionExtents(resolveStraightLengths(project, spec), width, vocabulary);

  // Côté intérieur : jour du premier tournant (S / Z : le second tournant a son jour en face).
  const innerSide: Side = turns[0]?.side ?? "left";

  const df = walklineOffsetFor(project.stair.walkline, width);
  turns.forEach((t, j) => checkNewel(t.well, j, df));

  const frames = buildFrames(
    extents,
    turns.map((t) => ({ angle: t.source.angle })),
    width,
  );
  const contexts: SectionContext[] = frames.map((frame, i) => ({
    frame,
    prev: i > 0 ? turns[i - 1] : undefined,
    next: turns[i],
  }));
  contexts.forEach((ctx, i) => checkSectionLength(ctx, i, width, vocabulary));

  // Emprises dégénérées (dette D3), signalées sans bloquer le calcul (`Layout.errors`).
  const layoutErrors = degenerateFootprint(frames, turns, width, vocabulary);
  const cornerOf = (j: number): Vec2 => wellCorner(frames[j]!, turns[j]!.side, width);

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
    const offset = side === "left" ? 0 : width;
    contexts.forEach((ctx, i) => {
      const [t0, t1] = edgeRange(ctx, side, width);
      pushLine(segs, at(ctx.frame, t0, offset), at(ctx.frame, t1, offset));
      const next = ctx.next;
      if (next !== undefined && next.side === side) {
        segs.push(
          ...wellTurnSegments(
            next.well,
            next.side,
            cornerOf(i),
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
  // Distance de Γ au bord gauche au droit de la jonction j : d_f du côté de son jour.
  const walkOffsetAt = (j: number): Mm => (turns[j]!.side === "left" ? df : width - df);
  // Escalier droit : d_f mesurée depuis le bord choisi ou automatique (décision A16).
  const walklineSide = turns.length === 0 ? resolveWalklineSide(project, extents[0]!) : undefined;
  const startOffset =
    turns.length > 0 ? walkOffsetAt(0) : walklineSide === "right" ? width - df : df;
  const walkSegs: CurveSeg[] = [];
  const zones: { sStart: Mm; sEnd: Mm }[] = [];
  const transitions: { leg: number; sStart: Mm; sEnd: Mm; o0: Mm; o1: Mm; angle: number }[] = [];
  let s = 0;
  contexts.forEach((ctx, i) => {
    const { frame, prev, next } = ctx;
    const [t0, t1] = walkRange(ctx, width);
    const o0 = prev !== undefined ? walkOffsetAt(i - 1) : startOffset;
    const o1 = next !== undefined ? walkOffsetAt(i) : o0;
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
    if (next !== undefined) {
      const arc = walklineArc(next.well, next.side, frame, width, df);
      walkSegs.push(arc.seg);
      const sStart = s;
      s += arc.length;
      zones.push({ sStart, sEnd: s });
    }
  });
  const walkLength = s;

  // ---------------------------------------------------------------- repère monde
  const { origin, rotation } = project.stair.placement;
  const angle = (rotation * Math.PI) / 180;
  const toWorld = (p: Vec2): Vec2 => V.add(V.rotate(p, angle), origin);
  const curveToWorld = (c: Curve2): Curve2 => translateCurve(rotateCurve(c, angle), origin);

  // Jour réduit à un point (quart tournant sans partie droite, angle vif) : courbe de longueur
  // nulle au coin ; signalement par le pipeline selon les murs (`zeroLengthJour.ts`).
  let zeroLengthInner: ZeroLengthInnerCorner[] | undefined;
  if (innerSegs.length === 0) {
    zeroLengthInner = [];
    turns.forEach((t, j) => {
      if (t.side !== innerSide) return;
      zeroLengthInner!.push({
        corner: toWorld(cornerOf(j)),
        incoming: V.rotate(frames[j]!.u, angle),
        outgoing: V.rotate(frames[j + 1]!.u, angle),
      });
    });
    innerSegs.push(lineSeg(cornerOf(0), cornerOf(0)));
  }
  if (outerSegs.length === 0) outerSegs.push(lineSeg(cornerOf(0), cornerOf(0)));
  const inner = curveToWorld(makeCurve(innerSegs));
  const outer = curveToWorld(makeCurve(outerSegs));
  const walkline = curveToWorld(makeCurve(walkSegs));

  const turnZones: TurnZone[] = turns.map((t, j) => ({
    index: j,
    direction: t.side,
    mode: t.mode,
    innerCorner: toWorld(cornerOf(j)),
    outerCorner: toWorld(wallCorner(frames[j]!, t.side, width)),
    sStart: zones[j]!.sStart,
    sEnd: zones[j]!.sEnd,
    collarSide: t.side,
    angle: ((t.side === "left" ? 1 : -1) * Math.PI) / 2,
    well: t.source.well,
    wall: t.source.wall,
  }));

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
      ...(prev !== undefined ? { startWellSide: prev.side } : {}),
      ...(next !== undefined ? { endWellSide: next.side } : {}),
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
    ...(zeroLengthInner !== undefined ? { zeroLengthInner } : {}),
    innerSide,
    ...(walklineSide !== undefined ? { walklineSide } : {}),
    ...(walklineTransitions.length > 0 ? { walklineTransitions } : {}),
    sections,
  };
}

/**
 * Emprises dégénérées d'une cage à jonctions de ±90° (tronçons alignés sur les axes du repère
 * local), mêmes constats que le moteur à volées (et mêmes messages pour une cage issue de
 * volées ; pour une cage saisie, messages `layout.cage.*` en tronçons, longueur de partie
 * droite) :
 * - deux jonctions successives de même sens dont le tronçon intermédiaire ne laisse aucun jour
 *   (partie droite nulle, jour à angle vif) : les tronçons qui se font face se touchent ;
 * - deux tronçons non consécutifs qui se superposent en plan (recouvrement d'aire non nulle de
 *   leurs rectangles hors tout).
 * Constats géométriques, sans seuil. (Lot 2 : découpage de l'emprise en pièces convexes.)
 */
function degenerateFootprint(
  frames: readonly SectionFrame[],
  turns: readonly Turning[],
  width: Mm,
  origin: CageOrigin,
): Message[] {
  const out: Message[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    if (turns[i]!.side !== turns[i + 1]!.side) continue;
    const jour = frames[i + 1]!.length - 2 * width;
    if (jour <= GEOM_EPS) {
      out.push(
        origin === "flights"
          ? msg("layout.flightsTouch", {
              turnA: i + 1,
              turnB: i + 2,
              flight: i + 2,
              length: String(frames[i + 1]!.length),
              before: i + 1,
              after: i + 3,
            })
          : msg("layout.cage.sectionsTouch", {
              junctionA: i + 1,
              junctionB: i + 2,
              section: i + 2,
              length: String(jour),
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
        out.push(
          origin === "flights"
            ? msg("layout.flightsOverlap", { flightA: i + 1, flightB: j + 1, x, y })
            : msg("layout.cage.sectionsOverlap", { sectionA: i + 1, sectionB: j + 1, x, y }),
        );
      }
    }
  }
  return out;
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
