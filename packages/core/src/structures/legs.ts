/**
 * Reconstruction des volées droites et des faces porteuses à partir du tracé (`Layout`) et du
 * `LayoutSpec` du projet, selon les conventions de `layout/layout.ts` :
 *
 * - C_e (mur) est toujours à angle vif : **un segment de droite par volée**, de longueur L_i
 *   (longueur de la volée mesurée au mur), du coin mur précédent W_{i−1} au coin W_i ;
 * - la face interne du limon de jour de la volée i est la droite I_i + t·u_i, avec
 *   I_i = début du segment de C_e − E·n_i (n_i : normale intérieur → extérieur), limitée à
 *   t ∈ [t0 ; t1] : t0 = E + retrait du tournant précédent (0 au départ), t1 = L_i − E −
 *   retrait du tournant suivant (L_i à l'arrivée) ; retrait = a/2 pour un poteau de côté a,
 *   r pour un jour en arc, 0 pour un angle vif ;
 * - poteau (`newel`) : carré de côté a centré sur le coin intérieur K du tournant (ou décalé
 *   vers le jour de δ, `offset`), côtés parallèles aux volées qu'il relie ; retrait = a/2 + δ.
 */
import { cumulativeLengths } from "../geom2d/curve.js";
import { projectOnCurve } from "../geom2d/intersect.js";
import * as V from "../geom2d/vec.js";
import type { Layout } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { InnerCorner, Project } from "../model/project.js";
import { newelOffset, newelSetback } from "../layout/newel.js";
import { StructureError } from "./registry.js";

export interface LegGeometry {
  readonly index: number;
  /** Direction de montée (unitaire). */
  readonly u: Vec2;
  /** Normale unitaire intérieur (jour) → extérieur (mur). */
  readonly n: Vec2;
  /** Début de la volée côté mur (coin mur précédent, ou départ) et longueur au mur. */
  readonly outerStart: Vec2;
  readonly length: Mm;
  /** Abscisse de `outerStart` sur C_e. */
  readonly outerSigma0: Mm;
  /** Origine côté jour (sur la ligne de départ de la volée). */
  readonly innerOrigin: Vec2;
  /** Portée de la face interne du limon de jour, abscisses t le long de u depuis `innerOrigin`. */
  readonly innerT0: Mm;
  readonly innerT1: Mm;
  /** Abscisse sur C_i du point `innerOrigin + innerT0·u` (NaN si la face est dégénérée). */
  readonly innerSigma0: Mm;
}

export interface NewelGeometry {
  /** Indice du tournant. */
  readonly turn: number;
  /** Centre du poteau (K, ou K − δ·(n + u) pour un poteau décalé vers le jour). */
  readonly center: Vec2;
  readonly size: Mm;
  /** Décalage δ vers le jour (0 : centré sur K). */
  readonly offset: Mm;
  /**
   * Débord du poteau côté jour au-delà des faces internes des limons, s = a/2 + δ : largeur
   * disponible pour recevoir un limon de jour (`FAB_POTEAU_RECEPTION`).
   */
  readonly jourExtent: Mm;
  /** Axes du carré : normale et direction de montée de la volée entrante. */
  readonly n: Vec2;
  readonly u: Vec2;
}

export interface StairGeometry {
  readonly legs: readonly LegGeometry[];
  readonly newels: readonly NewelGeometry[];
  readonly width: Mm;
  /** Côté du jour : +1 à gauche, −1 à droite. */
  readonly sign: 1 | -1;
}

function setback(inner: InnerCorner): Mm {
  switch (inner.kind) {
    case "sharp":
      return 0;
    case "arc":
      return inner.radius;
    case "newel":
      return newelSetback(inner);
  }
}

/**
 * Volées et poteaux du tracé.
 *
 * @throws StructureError sur un S / Z (tournants de sens opposés : deux côtés de jour) ou si
 *   C_e ne compte pas un segment droit par volée (tracé incohérent avec `computeLayout`).
 */
export function stairGeometry(project: Project, layout: Layout): StairGeometry {
  const spec = project.stair.layout;
  const E = spec.width;
  const turns = spec.turns;
  const segs = layout.outer.segments;
  // S / Z : le jour du second tournant est porté par C_e (`layout.ts`) ; les limons sont
  // reconstruits ici avec un seul côté de jour (C_e = mur à angle vif) : non pris en charge.
  if (turns.some((t, j) => j > 0 && t.direction !== turns[j - 1]!.direction)) {
    throw new StructureError(
      "Escalier en S / Z (tournants de sens opposés) : limons non pris en charge par cette structure (un seul côté de jour) ; seules les marches, contremarches et paliers sont générés.",
    );
  }
  if (segs.length !== spec.legs.length || segs.some((s) => s.kind !== "line")) {
    throw new StructureError(
      "Tracé inattendu : le bord extérieur doit compter un segment droit par volée.",
    );
  }
  const sign: 1 | -1 = layout.innerSide === "left" ? 1 : -1;
  const cum = cumulativeLengths(layout.outer);
  const legs: LegGeometry[] = segs.map((seg, i) => {
    if (seg.kind !== "line") throw new StructureError("Segment de mur non droit.");
    const d = V.sub(seg.b, seg.a);
    const length = V.norm(d);
    const u = V.normalize(d);
    // Jour à gauche : n = perpRight(u) ; jour à droite : n = perpLeft(u).
    const n = sign === 1 ? V.perpRight(u) : V.perpLeft(u);
    const innerOrigin = V.addScaled(seg.a, n, -E);
    const t0 = i > 0 ? E + setback(turns[i - 1]!.inner) : 0;
    const t1 = i < turns.length ? length - E - setback(turns[i]!.inner) : length;
    const start = V.addScaled(innerOrigin, u, t0);
    const innerSigma0 =
      t1 - t0 > 1e-9 && layout.inner.segments.length > 0
        ? projectOnCurve(start, layout.inner).s
        : Number.NaN;
    return {
      index: i,
      u,
      n,
      outerStart: seg.a,
      length,
      outerSigma0: cum[i]!,
      innerOrigin,
      innerT0: t0,
      innerT1: t1,
      innerSigma0,
    };
  });
  const newels: NewelGeometry[] = [];
  turns.forEach((t, j) => {
    if (t.inner.kind !== "newel") return;
    const leg = legs[j]!;
    const zone = layout.turns[j];
    const k = zone ? zone.innerCorner : V.addScaled(leg.innerOrigin, leg.u, leg.length - E);
    const offset = newelOffset(t.inner);
    const center = V.sub(k, V.scale(V.add(leg.n, leg.u), offset));
    newels.push({
      turn: j,
      center,
      size: t.inner.size,
      offset,
      jourExtent: newelSetback(t.inner),
      n: leg.n,
      u: leg.u,
    });
  });
  return { legs, newels, width: E, sign };
}

/** Face verticale plane d'une pièce réceptrice (limon, poteau), vue en plan. */
export interface ReceivingFace {
  /** Pièce qui reçoit (id de la pièce). */
  readonly owner: string;
  readonly a: Vec2;
  readonly b: Vec2;
  /** Normale unitaire dirigée vers l'intérieur de la pièce réceptrice. */
  readonly into: Vec2;
}

/** Faces d'un poteau carré, dans l'ordre de parcours trigonométrique (vu de dessus). */
export function newelFaces(newel: NewelGeometry, owner: string): ReceivingFace[] {
  const h = newel.size / 2;
  const at = (a: number, b: number): Vec2 =>
    V.add(V.add(newel.center, V.scale(newel.n, a)), V.scale(newel.u, b));
  let corners = [at(-h, -h), at(h, -h), at(h, h), at(-h, h)];
  // Parcours trigonométrique : sinon on inverse (repère (n, u) indirect, jour à droite).
  if (V.cross(newel.n, newel.u) < 0) corners = [corners[0]!, corners[3]!, corners[2]!, corners[1]!];
  return corners.map((a, i) => {
    const b = corners[(i + 1) % 4]!;
    const mid = V.lerp(a, b, 0.5);
    return { owner, a, b, into: V.normalize(V.sub(newel.center, mid)) };
  });
}
