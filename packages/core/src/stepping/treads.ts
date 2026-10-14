/**
 * Marches en plan (`Tread`) à partir des lignes de nez.
 *
 * La marche numéro t = k + 1 est comprise entre les nez k et k + 1 (k = 0 … n − 2) ; son dessus
 * est à l'altitude z_k du nez k.
 *
 * - `walkingSurface` : Q_k → (jour C_i de σ(Q_k) à σ(Q_{k+1}), arcs échantillonnés à 0,1 mm de
 *   flèche) → Q_{k+1} → R_{k+1} → (mur C_e de σ(R_{k+1}) à σ(R_k)) → R_k ; polygone CCW.
 * - `outline` [choix Blondel] : la pièce se prolonge sous le nez de la marche supérieure, de la
 *   valeur du débord `treads.nosing` : son bord arrière est la ligne de nez k + 1 décalée
 *   parallèlement de ce débord vers le haut de l'escalier (appui de la contremarche k + 1),
 *   coupée par C_i et C_e ou par la ligne de nez k + 2 si elle la rencontre avant ; au-delà des extrémités des bords (dernière marche), prolongement
 *   rectiligne. Débord nul : `outline` = `walkingSurface`.
 * - `going` : giron sur Γ (s_{k+1} − s_k) ; `colletArc` : σ(Q_{k+1}) − σ(Q_k) ; `colletChord` :
 *   |Q_{k+1} − Q_k| ; `goingOuter` : longueur **le long du mur** σ(R_{k+1}) − σ(R_k). Escalier
 *   en S ou en Z : collet et giron côté mur mesurés du côté du jour du tournant le plus proche
 *   (`sides.ts` : près d'un tournant de sens opposé, le jour est `outer` et le mur `inner`).
 * - `kind` : `landing` pour un palier ; `winder` si la marche appartient à une zone balancée,
 *   si l'un de ses nez est réorienté, si elle chevauche la partie courbe d'un tournant balancé,
 *   ou si elle recouvre un tronçon à axe en arc (décision F10 (1), cage saisie comprise :
 *   recouvrement strict, à `GEOM_EPS` près ; une marche qui ne touche l'arc qu'à un nez reste
 *   droite, une marche à cheval sur une limite droit / arc est dansante) ; `straight` sinon.
 *
 * Cage issue d'un hélicoïdal (`Layout.helicalOrigin`, F10 sous-lots P1 et P2, tout hélicoïdal
 * depuis la bascule) : marches dansantes
 * (`winder`) comme celles de l'hélicoïdal, par la règle de l'axe en arc ci-dessus (un seul
 * tronçon couvre toute Γ) ; bords échantillonnés comme un arc neuf partant du
 * nez (`arcEdge`, mêmes sommets que `arcPoints` de l'hélicoïdal, et non la sous-courbe coupée aux
 * jonctions des arcs élémentaires) ; contour de la dernière marche prolongé **sur le cercle**
 * au-delà de l'arrivée (angle asin(d / r), comme `helicalTreadOutline`) au lieu du prolongement
 * rectiligne ; intersections confondues d'un tour à l'autre départagées par l'abscisse attendue
 * (`firstHit`, `nearS`). Toute autre cage est inchangée.
 */
import { arcPoints } from "../geom2d/arc.js";
import { cumulativeLengths, curveTangentAt, flattenCurve, subCurve } from "../geom2d/curve.js";
import { intersectLines } from "../geom2d/intersect.js";
import { ensureCCW } from "../geom2d/polygon.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { firstHit } from "../balancing/postprocess.js";
import { collarSideAt, colletOnSide, wallGoingOnSide } from "./sides.js";
import type { Layout, NosingLine, Tread, TreadKind } from "../model/derived.js";
import type { ArcSeg, Curve2, Mm, Polygon2, Vec2 } from "../model/primitives.js";

/** Flèche maximale d'échantillonnage des arcs des bords (mm). */
const CHORD_TOL: Mm = 0.1;

function cleanPolygon(raw: readonly Vec2[]): Polygon2 {
  const pts: Vec2[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (last === undefined || !V.equals(last, p)) pts.push(p);
  }
  while (pts.length > 1 && V.equals(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  return ensureCCW(pts);
}

function edge(curve: Curve2, s0: Mm, s1: Mm): Vec2[] {
  return flattenCurve(subCurve(curve, s0, s1), CHORD_TOL);
}

/**
 * Bord d'une cage issue d'un hélicoïdal entre les abscisses `s0` et `s1` (éventuellement hors de
 * [0 ; |C|], prolongement sur le même cercle) : arc unique échantillonné par `arcPoints`, comme
 * l'hélicoïdal. `null` si la courbe n'est pas faite d'arcs cocycliques de même sens.
 */
function arcEdge(curve: Curve2, s0: Mm, s1: Mm): Vec2[] | null {
  const segs = curve.segments;
  const first = segs[0];
  if (first?.kind !== "arc" || !(first.radius > 0)) return null;
  const sign = Math.sign(first.sweep);
  for (const seg of segs) {
    if (
      seg.kind !== "arc" ||
      Math.sign(seg.sweep) !== sign ||
      Math.abs(seg.radius - first.radius) > GEOM_EPS ||
      V.distance(seg.center, first.center) > GEOM_EPS
    ) {
      return null;
    }
  }
  const cum = cumulativeLengths(curve);
  const angleAt = (s: Mm): number => {
    let i = 0;
    while (i + 1 < segs.length && s > cum[i + 1]!) i++;
    const seg = segs[i] as ArcSeg;
    return seg.startAngle + (sign * (s - cum[i]!)) / seg.radius;
  };
  return arcPoints(first.center, first.radius, angleAt(s0), (sign * (s1 - s0)) / first.radius);
}

/** `edge`, ou `arcEdge` pour une cage issue d'un hélicoïdal. */
function edgeOf(layout: Layout, curve: Curve2, s0: Mm, s1: Mm): Vec2[] {
  return (layout.helicalOrigin ? arcEdge(curve, s0, s1) : null) ?? edge(curve, s0, s1);
}

/** Surface entre deux lignes de nez, bornée par le jour et le mur. */
export function surfaceBetween(layout: Layout, a: NosingLine, b: NosingLine): Polygon2 {
  return cleanPolygon([
    ...edgeOf(layout, layout.inner, a.sigmaInner, b.sigmaInner),
    ...edgeOf(layout, layout.outer, b.sigmaOuter, a.sigmaOuter),
  ]);
}

/**
 * Contour de la pièce : surface prolongée de `depth` sous le nez supérieur `b`.
 *
 * Le bord arrière (ligne de nez `b` décalée de `depth`) est coupé sur C_i et C_e **ou sur la
 * ligne du nez suivant `c`** (segment Q_c R_c) si elle la rencontre avant, comme les
 * contremarches (`parts/basic.ts`). Sans cette seconde coupure, une ligne de nez passant par un
 * angle vif du jour et presque parallèle à la volée suivante (U, demi-tournant) ne recoupe C_i
 * que très loin, sous les marches suivantes. Coupure sur `c` côté jour : le contour suit C_i
 * jusqu'à Q_c puis la ligne `c` jusqu'au bord arrière (symétrique côté mur).
 */
export function outlineBetween(
  layout: Layout,
  a: NosingLine,
  b: NosingLine,
  depth: Mm,
  c?: NosingLine,
): Polygon2 {
  if (!(depth > GEOM_EPS)) return surfaceBetween(layout, a, b);
  const tangent = curveTangentAt(layout.walkline, b.s);
  let up = V.perpLeft(b.dir);
  if (V.dot(up, tangent) < 0) up = V.scale(up, -1);
  const origin = V.addScaled(b.p, up, depth);
  const helical = layout.helicalOrigin !== undefined;
  const qi = firstHit(
    origin,
    b.dir,
    layout.inner,
    "back",
    tangent,
    helical ? b.sigmaInner : undefined,
  );
  const ro = firstHit(
    origin,
    b.dir,
    layout.outer,
    "forward",
    tangent,
    helical ? b.sigmaOuter : undefined,
  );
  const qiOk = qi !== null && qi.s >= b.sigmaInner - GEOM_EPS;
  const roOk = ro !== null && ro.s >= b.sigmaOuter - GEOM_EPS;
  // Coupure par la ligne du nez suivant (paramètre t en mm, `dir` unitaire : t < 0 côté jour).
  let cutInner: Vec2 | null = null;
  let cutOuter: Vec2 | null = null;
  if (c) {
    const span = V.sub(c.r, c.q);
    const len = V.norm(span);
    const hit =
      len > GEOM_EPS ? intersectLines({ origin, dir: b.dir }, { origin: c.q, dir: span }) : null;
    const tol = len > GEOM_EPS ? GEOM_EPS / len : 0;
    if (hit && hit.t2 >= -tol && hit.t2 <= 1 + tol) {
      if (hit.t1 < 0 && (!qiOk || hit.t1 > qi.t)) cutInner = hit.point;
      if (hit.t1 > 0 && (!roOk || hit.t1 < ro.t)) cutOuter = hit.point;
    }
  }
  // Cage issue d'un hélicoïdal, au-delà de l'arrivée : prolongement sur le cercle du bord
  // (angle asin(d / r), `helicalTreadOutline`), au lieu du prolongement rectiligne.
  const beyondEnd = (curve: Curve2, sigma: Mm): Mm | null => {
    const last = curve.segments[curve.segments.length - 1];
    if (!helical || last?.kind !== "arc" || !(depth < last.radius)) return null;
    return sigma + last.radius * Math.asin(depth / last.radius);
  };
  const innerEnd = beyondEnd(layout.inner, b.sigmaInner);
  const outerEnd = beyondEnd(layout.outer, b.sigmaOuter);
  const innerPts = cutInner
    ? [...edgeOf(layout, layout.inner, a.sigmaInner, c!.sigmaInner), cutInner]
    : qiOk
      ? edgeOf(layout, layout.inner, a.sigmaInner, qi.s)
      : ((innerEnd !== null ? arcEdge(layout.inner, a.sigmaInner, innerEnd) : null) ?? [
          ...edge(layout.inner, a.sigmaInner, b.sigmaInner),
          V.addScaled(b.q, up, depth),
        ]);
  const outerPts = cutOuter
    ? [cutOuter, ...edgeOf(layout, layout.outer, c!.sigmaOuter, a.sigmaOuter)]
    : roOk
      ? edgeOf(layout, layout.outer, ro.s, a.sigmaOuter)
      : ((outerEnd !== null ? arcEdge(layout.outer, outerEnd, a.sigmaOuter) : null) ?? [
          V.addScaled(b.r, up, depth),
          ...edge(layout.outer, b.sigmaOuter, a.sigmaOuter),
        ]);
  return cleanPolygon([...innerPts, ...outerPts]);
}

export interface TreadContext {
  readonly layout: Layout;
  readonly nosings: readonly NosingLine[];
  readonly landingTreads: ReadonlySet<number>;
  /** Zones balancées retenues (nez fixes encadrants). */
  readonly zones: readonly { readonly from: number; readonly to: number }[];
  /** Parties courbes de Γ des tournants balancés. */
  readonly winderArcs: readonly { readonly sStart: Mm; readonly sEnd: Mm }[];
  readonly nosingDepth: Mm;
}

export function buildTreads(ctx: TreadContext): Tread[] {
  const { layout, nosings } = ctx;
  const arcSections = (layout.sections ?? []).filter((sec) => sec.kind === "arc");
  const treads: Tread[] = [];
  for (let k = 0; k + 1 < nosings.length; k++) {
    const a = nosings[k]!;
    const b = nosings[k + 1]!;
    let kind: TreadKind = "straight";
    if (ctx.landingTreads.has(k)) kind = "landing";
    else if (
      a.balanced ||
      b.balanced ||
      ctx.zones.some((zn) => zn.from <= k && k + 1 <= zn.to) ||
      ctx.winderArcs.some((w) => a.s < w.sEnd - GEOM_EPS && b.s > w.sStart + GEOM_EPS) ||
      // Tronçon à axe en arc (décision F10 (1)) : marche dansante dès qu'elle le recouvre
      // (cage saisie ou issue d'un hélicoïdal, dont l'unique tronçon couvre toute Γ).
      arcSections.some((sec) => a.s < sec.sEnd - GEOM_EPS && b.s > sec.sStart + GEOM_EPS)
    ) {
      kind = "winder";
    }
    // Collet du côté du jour du tournant voisin (S / Z : `outer` près du second tournant).
    const side = collarSideAt(layout, (a.s + b.s) / 2);
    const collet = colletOnSide(layout, a, b, side);
    treads.push({
      number: k + 1,
      kind,
      z: a.z,
      walkingSurface: surfaceBetween(layout, a, b),
      outline: outlineBetween(layout, a, b, ctx.nosingDepth, nosings[k + 2]),
      going: b.s - a.s,
      colletArc: collet.arc,
      colletChord: collet.chord,
      goingOuter: wallGoingOnSide(layout, a, b, side),
    });
  }
  return treads;
}
