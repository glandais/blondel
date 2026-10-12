/**
 * Arrivée et emprise hors tout d'un escalier à volées en repère local, pour l'étage analytique
 * de l'assistant (CHALLENGE G8, A3), sans découpage ni modèle :
 *
 * - **Arrivée** (`arrivalFrame`) : ligne d'arrivée (nez d'arrivée, bord extérieur de la dernière
 *   volée), extrémités hors tout (E + épaisseurs de l'intention de structure côté jour et côté
 *   extérieur) et direction de montée. Le calage sur les côtés de la trémie
 *   (`arrivalPlacements`) est dans `site/stairSnap.ts`, partagé avec les accroches de l'éditeur.
 * - **Emprise hors tout** (`grossPieces`) : un rectangle par volée (E + épaisseurs, longueur de
 *   la volée) et le carré de chaque poteau d'angle — reconstruits comme `computeLayout`. Elle
 *   passe par les mêmes contrôles que `Model.siteFit` (`footprintConflicts`, `site/fit.ts`).
 *
 * Sous-lot 3c : `arrivalPlacements`, `toWorld` et les types de calage sont passés dans
 * `site/stairSnap.ts`, `slabIntrusion` dans `site/fit.ts` (un seul crible).
 */
import * as V from "../geom2d/vec.js";
import { newelProtrusion, newelSetback } from "../layout/newel.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { FlightsLayoutSpec } from "../model/project.js";
import type { ArrivalFrame } from "../site/stairSnap.js";

/** Repère d'une volée (repère local du projet, placement nul), comme `computeLayout`. */
interface LegFrame {
  readonly inner: Vec2;
  readonly u: Vec2;
  readonly n: Vec2;
  readonly length: Mm;
}

function legFrames(spec: FlightsLayoutSpec, lengths: readonly Mm[]): LegFrame[] {
  const width = spec.width;
  const left = (spec.turns[0]?.direction ?? "left") === "left";
  let inner: Vec2 = left ? V.vec(0, 0) : V.vec(width, 0);
  let u: Vec2 = V.vec(0, 1);
  let n: Vec2 = left ? V.vec(1, 0) : V.vec(-1, 0);
  const out: LegFrame[] = [];
  lengths.forEach((length, i) => {
    out.push({ inner, u, n, length });
    if (i < spec.turns.length) {
      const k = V.addScaled(inner, u, length - width);
      const u2 = V.scale(n, -1);
      n = u;
      u = u2;
      inner = V.addScaled(k, u, -width);
    }
  });
  return out;
}

const legLengths = (spec: FlightsLayoutSpec): Mm[] =>
  spec.legs.map((l) => (typeof l.length === "number" ? l.length : 0));

/** Arrivée d'un tracé à volées, repère local (`walkPoint` : point de Γ sur la ligne d'arrivée). */
export function arrivalFrame(
  spec: FlightsLayoutSpec,
  walklineOffset: Mm,
  innerThickness: Mm,
  outerThickness: Mm,
): ArrivalFrame {
  const legs = legFrames(spec, legLengths(spec));
  const last = legs[legs.length - 1]!;
  const q = V.addScaled(last.inner, last.u, last.length);
  return {
    walkPoint: V.addScaled(q, last.n, walklineOffset),
    dir: last.u,
    grossInner: V.addScaled(q, last.n, -innerThickness),
    grossOuter: V.addScaled(q, last.n, spec.width + outerThickness),
  };
}

/** Emprise hors tout (repère local) : rectangles des volées et carrés des poteaux (convexes). */
export function grossPieces(
  spec: FlightsLayoutSpec,
  innerThickness: Mm,
  outerThickness: Mm,
): Polygon2[] {
  const legs = legFrames(spec, legLengths(spec));
  const pieces: Polygon2[] = legs.map((leg) => {
    const a = V.addScaled(leg.inner, leg.n, -innerThickness);
    const b = V.addScaled(leg.inner, leg.n, spec.width + outerThickness);
    return [a, b, V.addScaled(b, leg.u, leg.length), V.addScaled(a, leg.u, leg.length)];
  });
  spec.turns.forEach((turn, j) => {
    if (turn.inner.kind !== "newel") return;
    const leg = legs[j]!;
    const k = V.addScaled(leg.inner, leg.u, leg.length - spec.width);
    // Poteau [−s ; p]² dans la base (n, u) de K (`layout/newel.ts`).
    const s = newelSetback(turn.inner);
    const p = newelProtrusion(turn.inner);
    const at = (a: number, b: number): Vec2 => V.add(V.addScaled(k, leg.n, a), V.scale(leg.u, b));
    pieces.push([at(-s, -s), at(p, -s), at(p, p), at(-s, p)]);
  });
  return pieces;
}
