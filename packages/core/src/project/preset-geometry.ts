/**
 * Géométrie simplifiée des préréglages (usage interne à `presets.ts` et aux tests).
 *
 * Ce n'est **pas** le calcul du tracé (`computeLayout`) : c'est une approximation suffisante
 * pour choisir des longueurs de volées et une trémie cohérentes, sous les hypothèses :
 * - tournants à 90° à angle vif (jour `sharp`) ;
 * - ligne de foulée au milieu de l'emmarchement (DTU : E ≤ 1 200 mm), soit le décalage du
 *   bord intérieur à d = E/2, arc de rayon d centré sur le coin intérieur (B §2.1) ;
 * - girons égaux sur la ligne de foulée, hauteurs égales (première marche non corrigée).
 *
 * Repère local (voir `LayoutSpecSchema`) : départ sur le segment (0,0)–(E,0), montée selon +Y,
 * x = 0 côté gauche. La longueur d'une volée est mesurée sur le bord extérieur des tournants
 * adjacents ; deux volées successives se recouvrent sur le carré d'angle E × E.
 */
import type { Vec2 } from "../model/primitives.js";

export type TurnDirection = "left" | "right";

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** Rotation de +90° (sens trigonométrique). */
const rotL = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
/** Rotation de −90°. */
const rotR = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });
const rotate = (a: Vec2, angle: number): Vec2 => ({
  x: a.x * Math.cos(angle) - a.y * Math.sin(angle),
  y: a.x * Math.sin(angle) + a.y * Math.cos(angle),
});

export interface LegFrame {
  /** Extrémité gauche de la ligne de départ de la volée. */
  readonly start: Vec2;
  /** Direction de montée (unitaire). */
  readonly u: Vec2;
  /** Normale vers la droite (unitaire). */
  readonly r: Vec2;
  readonly length: number;
}

export interface TurnFrame {
  readonly direction: TurnDirection;
  readonly innerCorner: Vec2;
  readonly outerCorner: Vec2;
  /** Direction de la volée qui arrive dans le tournant. */
  readonly u: Vec2;
  readonly r: Vec2;
}

export interface StairFrames {
  readonly width: number;
  readonly legs: readonly LegFrame[];
  readonly turns: readonly TurnFrame[];
}

/** Construit les repères des volées et des tournants (tournants à 90°). */
export function buildFrames(width: number, legLengths: readonly number[], turns: readonly TurnDirection[]): StairFrames {
  if (legLengths.length !== turns.length + 1) {
    throw new RangeError("Il faut exactement une volée de plus que de tournants.");
  }
  const legs: LegFrame[] = [];
  const turnFrames: TurnFrame[] = [];
  let start: Vec2 = { x: 0, y: 0 };
  let u: Vec2 = { x: 0, y: 1 };
  legLengths.forEach((length, i) => {
    const r = rotR(u);
    legs.push({ start, u, r, length });
    const direction = turns[i];
    if (direction === undefined) return;
    const left = start;
    const right = add(start, scale(r, width));
    if (direction === "left") {
      const outerCorner = add(right, scale(u, length));
      const innerCorner = add(left, scale(u, length - width));
      turnFrames.push({ direction, innerCorner, outerCorner, u, r });
      const u2 = rotL(u);
      start = add(outerCorner, scale(rotR(u2), -width));
      u = u2;
    } else {
      const outerCorner = add(left, scale(u, length));
      const innerCorner = add(right, scale(u, length - width));
      turnFrames.push({ direction, innerCorner, outerCorner, u, r });
      start = outerCorner;
      u = rotR(u);
    }
  });
  return { width, legs, turns: turnFrames };
}

/** Morceau de ligne de foulée : droit (dans une volée) ou arc (dans un tournant). */
export type WalkPiece =
  | { readonly kind: "line"; readonly leg: number; readonly t0: number; readonly t1: number }
  | { readonly kind: "arc"; readonly turn: number; readonly startDir: Vec2; readonly sweep: number };

export function walkPieceLength(frames: StairFrames, piece: WalkPiece): number {
  return piece.kind === "line" ? piece.t1 - piece.t0 : (Math.abs(piece.sweep) * frames.width) / 2;
}

/** Morceaux de la ligne de foulée (d = E/2), du départ vers l'arrivée. */
export function walkPieces(frames: StairFrames): WalkPiece[] {
  const { width, legs, turns } = frames;
  const pieces: WalkPiece[] = [];
  legs.forEach((leg, i) => {
    const t0 = i > 0 ? width : 0;
    const t1 = i < legs.length - 1 ? leg.length - width : leg.length;
    pieces.push({ kind: "line", leg: i, t0, t1 });
    const turn = turns[i];
    if (turn !== undefined) {
      const startDir = turn.direction === "left" ? turn.r : scale(turn.r, -1);
      pieces.push({ kind: "arc", turn: i, startDir, sweep: turn.direction === "left" ? Math.PI / 2 : -Math.PI / 2 });
    }
  });
  return pieces;
}

/** Longueur développée de la ligne de foulée. */
export function walklineLength(frames: StairFrames): number {
  return walkPieces(frames).reduce((acc, p) => acc + walkPieceLength(frames, p), 0);
}

export interface WalkSample {
  /** Distance à l'arrivée mesurée sur la ligne de foulée. */
  readonly fromArrival: number;
  readonly point: Vec2;
  /** Extrémités de la section transversale de la marche en ce point (bord intérieur → extérieur). */
  readonly section: readonly [Vec2, Vec2];
}

/**
 * Échantillonne la ligne de foulée depuis l'arrivée, sur une distance `maxDistance`
 * (pas ≤ `step`, extrémité exacte incluse).
 */
export function sampleFromArrival(frames: StairFrames, maxDistance: number, step = 5): WalkSample[] {
  const { width } = frames;
  const d = width / 2;
  const pieces = walkPieces(frames).reverse();
  const samples: WalkSample[] = [];
  let acc = 0;
  for (const piece of pieces) {
    const len = walkPieceLength(frames, piece);
    const covered = Math.min(len, maxDistance - acc);
    if (covered < 0) break;
    const count = Math.max(1, Math.ceil(covered / step));
    for (let j = 0; j <= count; j++) {
      const back = (covered * j) / count; // distance depuis la fin du morceau
      const f = len === 0 ? 1 : 1 - back / len; // fraction depuis le début du morceau
      if (piece.kind === "line") {
        const leg = frames.legs[piece.leg]!;
        const t = piece.t0 + f * (piece.t1 - piece.t0);
        const left = add(leg.start, scale(leg.u, t));
        const right = add(left, scale(leg.r, width));
        samples.push({ fromArrival: acc + back, point: add(left, scale(leg.r, d)), section: [left, right] });
      } else {
        const turn = frames.turns[piece.turn]!;
        const dir = rotate(piece.startDir, piece.sweep * f);
        const outerAxis = turn.direction === "left" ? turn.r : scale(turn.r, -1);
        const rho = width / Math.max(Math.abs(dot(dir, turn.u)), Math.abs(dot(dir, outerAxis)));
        samples.push({
          fromArrival: acc + back,
          point: add(turn.innerCorner, scale(dir, d)),
          section: [turn.innerCorner, add(turn.innerCorner, scale(dir, rho))],
        });
      }
    }
    acc += len;
    if (acc >= maxDistance) break;
  }
  return samples;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly sizeX: number;
  readonly sizeY: number;
}

/** Plus petit rectangle aligné, arrondi vers l'extérieur au multiple de `grid` mm. */
export function boundingRect(points: readonly Vec2[], grid = 10): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const eps = 1e-6;
  const x0 = Math.floor((Math.min(...xs) + eps) / grid) * grid;
  const y0 = Math.floor((Math.min(...ys) + eps) / grid) * grid;
  const x1 = Math.ceil((Math.max(...xs) - eps) / grid) * grid;
  const y1 = Math.ceil((Math.max(...ys) - eps) / grid) * grid;
  return { x: x0, y: y0, sizeX: x1 - x0, sizeY: y1 - y0 };
}

export function rectContains(rect: Rect, p: Vec2, tol = 1e-6): boolean {
  return (
    p.x >= rect.x - tol && p.x <= rect.x + rect.sizeX + tol && p.y >= rect.y - tol && p.y <= rect.y + rect.sizeY + tol
  );
}

/**
 * Distance horizontale, mesurée depuis le nez d'arrivée sur la ligne de foulée, sur laquelle
 * la trémie doit s'étendre : `L ≥ (e_min + ep)·g/h` (A §1.7, dérivation géométrique pour une
 * mesure verticale au-dessus de la ligne de pente).
 */
export function requiredOpeningLength(headroomMin: number, slabThickness: number, going: number, rise: number): number {
  return ((headroomMin + slabThickness) * going) / rise;
}
