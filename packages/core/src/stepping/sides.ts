/**
 * Côtés du jour d'un escalier à volées (S / Z, CHALLENGE G1).
 *
 * `Layout.inner` est le bord du côté du jour du premier tournant ; dans un escalier en S ou en
 * Z, le jour d'un tournant de sens opposé est porté par `Layout.outer`. Les stratégies de
 * balancement et le post-traitement commun travaillent toujours sur `layout.inner` (σ des
 * collets) : pour un tournant dont le jour est sur `outer`, le découpage leur présente une
 * **vue retournée** du tracé (`flipLayout` : bords échangés), et retourne les lignes de nez
 * (`flipNosing` : Q ↔ R, direction opposée), puis remet le résultat dans le repère du tracé.
 */
import * as V from "../geom2d/vec.js";
import {
  colletBetween,
  findCrossings,
  type Collet,
  type Crossing,
  type NosingSeed,
} from "../balancing/postprocess.js";
import type { Layout, NosingLine } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";

export type Side = "left" | "right";

/** Côté opposé. */
export const otherSide = (side: Side): Side => (side === "left" ? "right" : "left");

/** Côté du jour du tournant j (`TurnZone.collarSide`, à défaut son sens). */
export function turnCollarSide(layout: Layout, j: number): Side {
  const t = layout.turns[j];
  return t?.collarSide ?? t?.direction ?? layout.innerSide;
}

/**
 * Côté du jour au droit de l'abscisse s de Γ : celui du tournant le plus proche (distance de s
 * à [sStart ; sEnd], premier tournant à égalité) ; `layout.innerSide` sans tournant.
 */
export function collarSideAt(layout: Layout, s: Mm): Side {
  let best = -1;
  let bestD = Infinity;
  layout.turns.forEach((t, j) => {
    const d = Math.max(0, t.sStart - s, s - t.sEnd);
    if (d < bestD) {
      best = j;
      bestD = d;
    }
  });
  return best < 0 ? layout.innerSide : turnCollarSide(layout, best);
}

/** Vue retournée du tracé : bords échangés, côté intérieur opposé. */
export function flipLayout(layout: Layout): Layout {
  return {
    ...layout,
    inner: layout.outer,
    outer: layout.inner,
    innerSide: otherSide(layout.innerSide),
  };
}

/** Ligne de nez vue depuis l'autre bord (involution). */
export function flipNosing(nl: NosingLine): NosingLine {
  return {
    ...nl,
    dir: V.scale(nl.dir, -1),
    q: nl.r,
    r: nl.q,
    sigmaInner: nl.sigmaOuter,
    sigmaOuter: nl.sigmaInner,
  };
}

/** Germe de nez vu depuis l'autre bord (perpendiculaire orientée vers l'autre bord). */
export function flipSeed(seed: NosingSeed): NosingSeed {
  return { ...seed, perpendicular: V.scale(seed.perpendicular, -1) };
}

/**
 * Collet de la marche comprise entre les nez a et b, mesuré du côté `side` : sur `inner` si
 * c'est `layout.innerSide`, sinon sur `outer` (jour d'un tournant de sens opposé).
 */
export function colletOnSide(layout: Layout, a: NosingLine, b: NosingLine, side: Side): Collet {
  if (side === layout.innerSide) return colletBetween(a, b);
  return { arc: b.sigmaOuter - a.sigmaOuter, chord: V.distance(a.r, b.r) };
}

/** Longueur de la marche le long du bord opposé au jour `side` (giron côté mur). */
export function wallGoingOnSide(layout: Layout, a: NosingLine, b: NosingLine, side: Side): Mm {
  return side === layout.innerSide ? b.sigmaOuter - a.sigmaOuter : b.sigmaInner - a.sigmaInner;
}

/**
 * Croisements K5 de lignes de nez du tracé principal, contact toléré au collet **du côté du jour
 * du tournant voisin** de chaque nez (`collarSideAt`) : Q confondus près d'un jour sur `inner`,
 * R confondus près d'un jour sur `outer` (S / Z). Un contact au mur reste un croisement.
 */
export function findCrossingsOnSides(layout: Layout, nosings: readonly NosingLine[]): Crossing[] {
  return findCrossings(nosings, 0, nosings.length - 1, (k) =>
    collarSideAt(layout, nosings[k]!.s) === layout.innerSide ? "inner" : "outer",
  );
}
