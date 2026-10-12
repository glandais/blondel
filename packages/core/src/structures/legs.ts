/**
 * Reconstruction des faces porteuses (limons droits) et des poteaux à partir du tracé
 * (`Layout`) seul : tronçons (`Layout.sections`) et jonctions (`Layout.turns` : angle, raccord
 * côté jour `well`, côté mur `wall`), sans relire le `LayoutSpec` du projet (ADR-0010, sous-lot
 * 6a). Un tracé à volées passe par le même chemin que la cage saisie (le moteur de cage calcule
 * les deux, `layout/layout.ts`) et donne, nombre pour nombre, les faces d'avant le sous-lot 6a
 * (parité stricte, `legs.parity.test.ts`).
 *
 * **Tronçon i** (axe droit) :
 * - face côté mur : le segment droit de C_e qui porte la partie droite du tronçon côté mur, de
 *   longueur L_i « au mur » (coin mur précédent W_{i−1} → coin W_i ; un palier droit est porté
 *   par le tronçon entrant, comme dans le moteur de cage, `layout/cage/frames.ts`) ;
 * - face côté jour, **largeur uniforme** (tous les tronçons de même largeur constante : volées,
 *   cage sans largeur variable) : forme fermée, droite I_i + t·u_i avec I_i = début de la face
 *   mur − E·n_i (n_i : normale jour → mur), limitée à t ∈ [t0 ; t1] : t0 = débord de la jonction
 *   d'entrée (0 au départ), t1 = L_i − débord de la jonction de sortie (L_i à l'arrivée) ;
 *   débord = E·tan(|θ|/2) (exactement E à ±90°, 0 sur un palier droit) + retrait du raccord du
 *   jour : a/2 + δ pour un poteau de côté a, r·tan(|θ|/2) pour un jour en arc (r à ±90°), retrait
 *   haut ou bas d'un pan coupé, 0 pour un angle vif ;
 * - face côté jour, **largeur variable** (trapèze, tronçons de largeurs différentes) : le segment
 *   droit de C_i qui porte la partie droite du tronçon côté jour (bord incliné compris), tel que
 *   le moteur de cage l'a calculé.
 *
 * **Jonctions** (entre les faces des tronçons j et j + 1, d'un même côté) :
 * - tournant, côté mur à angle vif : coin W, angle **rentrant** vu des marches ; côté mur en
 *   congé : non pris en charge (`structure.common.legs.wallSegmentNotStraight`) ;
 * - tournant, côté jour : angle vif ou arc → extrémités « ouvertes » (`open`, limon de jour non
 *   construit par un limon droit, `jourIssues`) ; poteau → extrémités contre le poteau ; pan
 *   coupé → face droite propre au pan (`junction`), angles **saillants** vus des marches à ses
 *   deux bouts ;
 * - palier droit : bords alignés → deux faces raccordées bout à bout au milieu du palier
 *   (`splice`, F16 (3)) ; une seule face continue seulement si une des parties droites voisines
 *   est de longueur nulle (raccord impossible) ; bords presque alignés, écart (`landingGap`) au
 *   plus la tolérance d'alignement (`StairGeometryOptions`, profil d'atelier, F16 (6), sous-lot
 *   6a2), et angle des faces borné (|sin α| · épaisseur du limon au plus la tolérance) →
 *   fusionnés : raccord au milieu du palier, chaque face prolongée le long de la droite de
 *   son tronçon (`LandingMerge` : la pièce encastrée est ramenée sur la face par le plugin) ;
 *   au-delà, bords non alignés (largeurs ou ancrages différents) → face propre au bord du palier,
 *   reliée aux faces voisines par des angles rentrants ou saillants.
 *
 * Angle entre deux faces droites consécutives d'un même côté : rentrant (la face suivante
 * repart vers les marches, le limon voisin doit être prolongé jusqu'à l'arête extérieure du coin,
 * de e·tan(φ/2), e à 90°) ou saillant (les deux limons s'arrêtent au coin, zone d'assemblage
 * dans l'épaisseur commune) ; φ = angle entre les deux faces (|θ| de la jonction à largeur
 * uniforme, exact à ±90°).
 *
 * Poteau (`newel`, tracé à volées seulement : refusé en amont sur une cage saisie) : carré de
 * côté a centré sur le coin intérieur K du tournant (ou décalé vers le jour de δ, `offset`), côtés
 * parallèles aux volées qu'il relie ; retrait = a/2 + δ.
 */
import { msg } from "@blondel/i18n";
import { cumulativeLengths } from "../geom2d/curve.js";
import { projectOnCurve } from "../geom2d/intersect.js";
import * as V from "../geom2d/vec.js";
import type { Layout, LayoutSection, TurnZone } from "../model/derived.js";
import type { Curve2, Mm, Rad, Vec2 } from "../model/primitives.js";
import type { Project, WellJoint } from "../model/project.js";
import { newelOffset, newelSetback } from "../layout/newel.js";
import { StructureError } from "./registry.js";

export interface LegGeometry {
  readonly index: number;
  /** Direction de montée (unitaire) : direction de la face côté mur. */
  readonly u: Vec2;
  /** Normale unitaire intérieur (jour) → extérieur (mur), de la face côté mur. */
  readonly n: Vec2;
  /** Début de la volée côté mur (coin mur précédent, ou départ) et longueur au mur. */
  readonly outerStart: Vec2;
  readonly length: Mm;
  /** Abscisse de `outerStart` sur C_e. */
  readonly outerSigma0: Mm;
  /** Origine côté jour (sur la ligne de départ de la volée). */
  readonly innerOrigin: Vec2;
  /**
   * Portée de la face interne du limon de jour, abscisses t le long de `innerDir` depuis
   * `innerOrigin`.
   */
  readonly innerT0: Mm;
  readonly innerT1: Mm;
  /** Abscisse sur C_i du point `innerOrigin + innerT0·innerDir` (NaN si la face est dégénérée). */
  readonly innerSigma0: Mm;
  /**
   * Direction (unitaire) de la face côté jour : `u` à largeur uniforme, direction du bord incliné
   * d'un tronçon à largeur variable (sous-lot 6a).
   */
  readonly innerDir: Vec2;
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

/** Côté d'une face porteuse : jour (C_i) ou mur (C_e). */
export type FaceSide = "inner" | "outer";

/**
 * Extrémité d'une face porteuse :
 * - `floor` / `arrival` : départ et arrivée de l'escalier ;
 * - `newel` : contre un poteau (tournant `turn`) ;
 * - `corner` : angle avec la face voisine du même côté, rentrant (`concave`) ou saillant, d'angle
 *   φ entre les deux faces (`tanHalf` = tan(φ/2), exactement 1 à 90°) ;
 * - `open` : raccord du jour qu'un limon droit ne sait pas suivre (angle vif, arc : `jourIssues`) ;
 * - `splice` : raccord bout à bout au milieu d'un palier droit, entre deux faces alignées.
 */
export type FaceEnd =
  | { readonly kind: "floor" }
  | { readonly kind: "arrival" }
  | { readonly kind: "newel"; readonly turn: number }
  | {
      readonly kind: "corner";
      readonly concave: boolean;
      readonly tanHalf: number;
      /** Jonction de l'angle (indice dans `Layout.turns`). */
      readonly junction: number;
    }
  | { readonly kind: "open"; readonly junction: number }
  /**
   * Raccord bout à bout de deux limons alignés au milieu d'un palier droit (limons de rampe
   * arrêtés dans la partie de niveau, sous-lot 6a, à valider : QUESTIONS F16). `gap` : écart des
   * bords fusionnés à la tolérance d'alignement près (`LandingMerge`), absent s'ils sont alignés.
   */
  | { readonly kind: "splice"; readonly junction: number; readonly gap?: Mm };

/**
 * Bords d'un palier droit presque alignés, fusionnés à la tolérance d'alignement près
 * (`StairGeometryOptions.landingAlignmentTolerance`, QUESTIONS F16 (6)) : le bord réel du palier
 * [`a` ; `b`] n'est porté par aucune face ; ses points sont ramenés sur la face d'avant
 * (`before`, jusqu'au milieu du palier) ou d'après (`after`), d'au plus `gap` / 2.
 */
export interface LandingMerge {
  readonly junction: number;
  readonly side: FaceSide;
  /** Bout du bord du palier sur la face d'avant (fin de la partie droite du tronçon entrant). */
  readonly a: Vec2;
  /** Bout du bord du palier sur la face d'après (début de la partie droite suivante). */
  readonly b: Vec2;
  /** Écart des deux bords (mm), ≤ tolérance (voir `landingGap`). */
  readonly gap: Mm;
  /** Droites des deux faces raccordées (origine, direction unitaire). */
  readonly before: { readonly a: Vec2; readonly dir: Vec2 };
  readonly after: { readonly a: Vec2; readonly dir: Vec2 };
}

/**
 * Face verticale plane d'un limon droit, vue en plan : u ∈ [0 ; `length`] depuis `a` le long de
 * `dir` ; σ = `sigmaA` + u sur le bord (C_i ou C_e).
 */
export interface EdgeFace {
  readonly side: FaceSide;
  readonly a: Vec2;
  readonly dir: Vec2;
  /** Normale unitaire vers l'épaisseur du limon (hors emprise utile : jour ou mur). */
  readonly into: Vec2;
  readonly length: Mm;
  /** Abscisse de `a` sur le bord du côté (NaN si la face est dégénérée). */
  readonly sigmaA: Mm;
  /**
   * Tronçons dont la face porte la partie droite, dans l'ordre ; vide pour une face propre à une
   * jonction. Plusieurs seulement le long d'un palier droit à bords alignés dont une partie droite
   * voisine est de longueur nulle (raccord au milieu du palier impossible) ; sinon un seul.
   */
  readonly sections: readonly number[];
  /** Face propre à une jonction (pan coupé, bord de palier droit non aligné). */
  readonly junction?: number;
  /** Nature de la face propre à une jonction. */
  readonly junctionKind?: "chamfer" | "landing";
  readonly start: FaceEnd;
  readonly end: FaceEnd;
}

/** Raccord du jour qu'aucun limon droit ne suit (erreur du plugin). */
export interface JourIssue {
  readonly junction: number;
  readonly kind: "sharp" | "arc";
}

export interface StairGeometry {
  readonly legs: readonly LegGeometry[];
  readonly newels: readonly NewelGeometry[];
  /** Faces porteuses des deux côtés, dans l'ordre de la montée (jour avant mur à rang égal). */
  readonly faces: readonly EdgeFace[];
  /** Jonctions dont le jour (angle vif, arc) n'est suivi par aucun limon droit. */
  readonly jourIssues: readonly JourIssue[];
  /** Paliers droits dont les bords presque alignés sont fusionnés (vide sans tolérance). */
  readonly landingMerges: readonly LandingMerge[];
  /** Plus petite largeur (largeur uniforme : l'emmarchement). */
  readonly width: Mm;
  /** Plus grande largeur des tronçons (domaine des règles de moyens). */
  readonly maxWidth: Mm;
  /** Côté du jour : +1 à gauche, −1 à droite. */
  readonly sign: 1 | -1;
}

/** Tolérance de pose d'un point sur un segment, et d'alignement de deux faces (mm, sans unité). */
const ON_EDGE_TOL = 1e-6;
const ALIGN_TOL = 1e-9;

/** Réglages de la reconstruction des faces. */
export interface StairGeometryOptions {
  /**
   * Tolérance d'alignement des bords d'un palier droit (mm, profil d'atelier
   * `wood.landingAlignmentTolerance`, QUESTIONS F16 (6)) ; absente ou 0 : alignement exact
   * seulement (`ALIGN_TOL`), comme avant le sous-lot 6a2.
   */
  readonly landingAlignmentTolerance?: Mm;
  /**
   * Épaisseur des limons (mm) : borne aussi l'angle α entre les deux faces fusionnées,
   * |sin α| · épaisseur ≤ tolérance (ouverture du raccord bout à bout sur l'épaisseur du limon),
   * sans quoi un palier très court ramènerait un vrai angle à un raccord ; absente : 0 (pas de
   * borne d'angle, la tolérance doit alors rester nulle).
   */
  readonly stringerThickness?: Mm;
}

/**
 * Écart (mm) entre les bords de part et d'autre d'un palier droit (QUESTIONS F16 (6)) : plus
 * grande distance d'un bout du bord du palier à la droite de la face de l'autre côté du palier,
 * max(d(B, droite d'avant), d(A, droite d'après)), A : fin de la face d'avant, B : début de la
 * face d'après. Il somme l'écart latéral et l'écart angulaire ramené sur la longueur du palier
 * (d(B, droite d'avant) ≈ décalage latéral + |AB|·sin α, α : angle entre les deux faces) ; 0
 * pour des bords alignés. `null` si les deux faces ne vont pas dans le même sens ou si le palier
 * n'avance pas de A à B.
 */
export function landingGap(
  before: { readonly a: Vec2; readonly dir: Vec2 },
  a: Vec2,
  after: { readonly a: Vec2; readonly dir: Vec2 },
  b: Vec2,
): Mm | null {
  if (!(V.dot(before.dir, after.dir) > 0)) return null;
  if (!(
    V.dot(V.sub(b, a), before.dir) > ON_EDGE_TOL && V.dot(V.sub(b, a), after.dir) > ON_EDGE_TOL
  ))
    return null;
  return Math.max(
    Math.abs(V.cross(before.dir, V.sub(b, before.a))),
    Math.abs(V.cross(after.dir, V.sub(a, after.a))),
  );
}

/** Angle signé d'une jonction (rad), ±π/2 à défaut. */
function zoneAngle(z: TurnZone): Rad {
  return z.angle ?? (z.direction === "left" ? Math.PI / 2 : -Math.PI / 2);
}

/** tan(|θ|/2) d'une jonction (rad) : exactement 0 à 0 et 1 à ±π/2 (`layout/cage/frames.ts`). */
export function tanHalfAngle(angle: Rad): number {
  if (angle === 0) return 0;
  if (angle === Math.PI / 2 || angle === -Math.PI / 2) return 1;
  return Math.tan(Math.abs(angle) / 2);
}

/** tan(φ/2) de l'angle φ ∈ [0 ; π] entre deux directions unitaires. */
function tanHalfBetween(d0: Vec2, d1: Vec2): number {
  const phi = Math.atan2(Math.abs(V.cross(d0, d1)), V.dot(d0, d1));
  return Math.tan(phi / 2);
}

/** Retrait de la face du jour depuis K, à l'entrée (`in` : tronçon entrant) ou à la sortie. */
function wellSetback(well: WellJoint | undefined, angle: Rad, end: "in" | "out"): Mm {
  if (!well) return 0;
  switch (well.kind) {
    case "sharp":
      return 0;
    case "arc":
      return well.radius * tanHalfAngle(angle);
    case "newel":
      return newelSetback(well);
    case "chamfer":
      return end === "in" ? well.setbackIn : well.setbackOut;
  }
}

/** Indice du segment droit de `curve` qui porte `p` (le plus parallèle à `dir`), sinon −1. */
function lineSegmentAt(curve: Curve2, p: Vec2, dir: Vec2 | null): number {
  let best = -1;
  let bestPar = -Infinity;
  curve.segments.forEach((s, k) => {
    if (s.kind !== "line") return;
    const ab = V.sub(s.b, s.a);
    const len = V.norm(ab);
    if (!(len > 0)) return;
    const d = V.scale(ab, 1 / len);
    const w = V.sub(p, s.a);
    const along = V.dot(w, d);
    if (Math.abs(V.cross(d, w)) > ON_EDGE_TOL * Math.max(1, len)) return;
    if (along < -ON_EDGE_TOL || along > len + ON_EDGE_TOL) return;
    const par = dir ? Math.abs(V.dot(d, dir)) : 0;
    if (best < 0 || par > bestPar + 1e-12) {
      best = k;
      bestPar = par;
    }
  });
  return best;
}

/** Morceau de face (partie droite d'un tronçon, pan coupé, bord de palier), avant fusion. */
interface Piece {
  readonly a: Vec2;
  readonly dir: Vec2;
  readonly length: Mm;
  readonly sigmaA: Mm;
  readonly section?: number;
  readonly junction?: number;
  readonly junctionKind?: "chamfer" | "landing";
}

const endOf = (p: Piece): Vec2 => V.addScaled(p.a, p.dir, p.length);

/** Côté (`left` / `right`) d'une ligne de tronçon. */
const sideKey = (jourLeft: boolean, side: FaceSide): "left" | "right" =>
  (side === "inner") === jourLeft ? "left" : "right";

/**
 * Faces porteuses, poteaux et volées (rétrocompatibles) du tracé.
 *
 * @throws StructureError sur un S / Z (tournants de sens opposés : deux côtés de jour), sur un
 *   tronçon à axe en arc ou un raccord côté mur en congé (pas de limon droit), ou si un tronçon
 *   n'a pas de segment droit de C_e (tracé incohérent avec `computeLayout`).
 */
export function stairGeometry(
  _project: Project,
  layout: Layout,
  options: StairGeometryOptions = {},
): StairGeometry {
  const alignTol = options.landingAlignmentTolerance ?? 0;
  const alignThickness = options.stringerThickness ?? 0;
  const sections: readonly LayoutSection[] = layout.sections ?? [];
  const zones = layout.turns;
  if (sections.length === 0 || zones.length !== sections.length - 1) {
    throw new StructureError(msg("structure.common.legs.unexpectedOuterEdge"));
  }
  // S / Z : le jour du second tournant est porté par C_e (`layout.ts`) ; les limons sont
  // reconstruits ici avec un seul côté de jour (C_e = mur) : non pris en charge.
  const turning = zones.filter((z) => zoneAngle(z) !== 0);
  if (turning.some((z, j) => j > 0 && z.direction !== turning[j - 1]!.direction)) {
    throw new StructureError(msg("structure.common.legs.oppositeTurns"));
  }
  if (sections.some((s) => s.kind !== "straight")) {
    throw new StructureError(msg("structure.common.legs.unexpectedOuterEdge"));
  }
  const sign: 1 | -1 = layout.innerSide === "left" ? 1 : -1;
  const jourLeft = sign === 1;
  const E0 = sections[0]!.widthStart;
  const uniform = sections.every((s) => s.widthStart === E0 && s.widthEnd === E0);
  const widths = sections.flatMap((s) => [s.widthStart, s.widthEnd]);
  const last = sections.length - 1;

  // 1. Face côté mur de chaque tronçon : segment droit de C_e.
  const outerCum = cumulativeLengths(layout.outer);
  const outerIdx = sections.map((s) => {
    const k = sideKey(jourLeft, "outer");
    const p0 = s.start[k];
    const p1 = s.end[k];
    const d = V.distance(p0, p1) > ON_EDGE_TOL ? V.normalize(V.sub(p1, p0)) : null;
    const idx = lineSegmentAt(layout.outer, V.lerp(p0, p1, 0.5), d);
    if (idx < 0) throw new StructureError(msg("structure.common.legs.unexpectedOuterEdge"));
    return idx;
  });
  const outerPieces: Piece[] = outerIdx.map((k, i) => {
    const seg = layout.outer.segments[k]!;
    if (seg.kind !== "line")
      throw new StructureError(msg("structure.common.legs.wallSegmentNotStraight"));
    const d = V.sub(seg.b, seg.a);
    return {
      a: seg.a,
      dir: V.normalize(d),
      length: V.norm(d),
      sigmaA: outerCum[k]!,
      section: i,
    };
  });
  // Jour à gauche : n = perpRight(u) ; jour à droite : n = perpLeft(u).
  const normalOf = (u: Vec2): Vec2 => (jourLeft ? V.perpRight(u) : V.perpLeft(u));

  // 2. Face côté jour de chaque tronçon.
  const innerCum = cumulativeLengths(layout.inner);
  const legs: LegGeometry[] = [];
  const innerPieces: Piece[] = sections.map((s, i) => {
    const out = outerPieces[i]!;
    const u = out.dir;
    const n = normalOf(u);
    let innerOrigin: Vec2;
    let innerDir: Vec2;
    let t0: Mm;
    let t1: Mm;
    let innerSigma0: Mm;
    if (uniform) {
      const E = E0;
      const before = i > 0 ? zones[i - 1]! : null;
      const after = i < last ? zones[i]! : null;
      const reach = (z: TurnZone, end: "in" | "out"): Mm => {
        const a = zoneAngle(z);
        return E * tanHalfAngle(a) + wellSetback(z.well, a, end);
      };
      innerOrigin = V.addScaled(out.a, n, -E);
      innerDir = u;
      t0 = before ? reach(before, "out") : 0;
      t1 = after ? out.length - reach(after, "in") : out.length;
      const start = V.addScaled(innerOrigin, u, t0);
      innerSigma0 =
        t1 - t0 > 1e-9 && layout.inner.segments.length > 0
          ? projectOnCurve(start, layout.inner).s
          : Number.NaN;
    } else {
      const k = sideKey(jourLeft, "inner");
      const p0 = s.start[k];
      const p1 = s.end[k];
      const d = V.distance(p0, p1) > ON_EDGE_TOL ? V.normalize(V.sub(p1, p0)) : null;
      const idx = lineSegmentAt(layout.inner, V.lerp(p0, p1, 0.5), d);
      const seg = idx >= 0 ? layout.inner.segments[idx]! : null;
      if (seg && seg.kind === "line") {
        innerOrigin = seg.a;
        innerDir = V.normalize(V.sub(seg.b, seg.a));
        t0 = 0;
        t1 = V.distance(seg.a, seg.b);
        innerSigma0 = innerCum[idx]!;
      } else {
        // Partie droite sans segment propre (largeur nulle) : face dégénérée.
        innerOrigin = p0;
        innerDir = d ?? u;
        t0 = 0;
        t1 = 0;
        innerSigma0 = Number.NaN;
      }
    }
    legs.push({
      index: i,
      u,
      n,
      outerStart: out.a,
      length: out.length,
      outerSigma0: out.sigmaA,
      innerOrigin,
      innerT0: t0,
      innerT1: t1,
      innerSigma0,
      innerDir,
    });
    return {
      a: V.addScaled(innerOrigin, innerDir, t0),
      dir: innerDir,
      length: t1 - t0,
      sigmaA: innerSigma0,
      section: i,
    };
  });

  // 3. Jonctions : liaisons entre faces, faces propres aux pans coupés et aux bords de palier.
  const jourIssues: JourIssue[] = [];
  const landingMerges: LandingMerge[] = [];
  const faces: EdgeFace[] = [];
  for (const side of ["inner", "outer"] as const) {
    const pieces = side === "inner" ? innerPieces : outerPieces;
    const curve = side === "inner" ? layout.inner : layout.outer;
    const into = (dir: Vec2): Vec2 =>
      side === "inner" ? V.scale(normalOf(dir), -1) : normalOf(dir);
    const sigmaOf = (p: Vec2): Mm =>
      curve.segments.length > 0 ? projectOnCurve(p, curve).s : Number.NaN;
    /** Milieu du palier droit `j` sur ce côté (fin et début des parties droites voisines). */
    const landingMiddle = (j: number, sd: FaceSide): Vec2 => {
      const k = sideKey(jourLeft, sd);
      return V.lerp(sections[j]!.end[k], sections[j + 1]!.start[k], 0.5);
    };
    /** Coupe en `m` deux morceaux alignés ; `null` si `m` n'est pas strictement dans chacun. */
    const splice = (
      before: Piece,
      after: Piece,
      m: Vec2,
    ): { before: Piece; after: Piece } | null => {
      const l0 = V.dot(V.sub(m, before.a), before.dir);
      const t = V.dot(V.sub(m, after.a), after.dir);
      const l1 = after.length - t;
      if (!(l0 > ON_EDGE_TOL && l1 > ON_EDGE_TOL)) return null;
      const a1 = V.addScaled(after.a, after.dir, t);
      return {
        before: { ...before, length: l0 },
        after: { ...after, a: a1, length: l1, sigmaA: sigmaOf(a1) },
      };
    };
    /** Face droite propre à une jonction, de `a` à `b`. */
    const own = (a: Vec2, b: Vec2, j: number, kind: "chamfer" | "landing"): Piece => {
      const d = V.sub(b, a);
      return {
        a,
        dir: V.normalize(d),
        length: V.norm(d),
        sigmaA: sigmaOf(a),
        junction: j,
        junctionKind: kind,
      };
    };
    // Morceaux dans l'ordre de la montée ; links[k] relie seq[k] et seq[k + 1].
    const seq: Piece[] = [pieces[0]!];
    const links: Link[] = [];
    const append = (link: Link, piece: Piece): void => {
      links.push(link);
      seq.push(piece);
    };
    for (let i = 1; i < pieces.length; i++) {
      const j = i - 1;
      const z = zones[j]!;
      const angle = zoneAngle(z);
      const prev = seq[seq.length - 1]!;
      const piece = pieces[i]!;
      if (angle === 0) {
        // Palier droit : bord du palier s'il n'est porté par aucun des deux tronçons (largeurs ou
        // ancrages différents), puis liaisons (alignées : raccord au milieu du palier).
        const a = endOf(prev);
        const edge = V.distance(a, piece.a) > ON_EDGE_TOL ? own(a, piece.a, j, "landing") : null;
        const viaEdge = edge ? linkBetween(prev, edge, into, j) : null;
        const toPiece = linkBetween(edge ?? prev, piece, into, j);
        const spliced =
          (viaEdge === null || viaEdge.kind === "aligned") && toPiece.kind === "aligned"
            ? splice(prev, piece, landingMiddle(j, side))
            : null;
        // Bords presque alignés (écart ≤ tolérance d'alignement, F16 (6)) : fusionnés, raccord
        // au milieu du palier, chaque limon le long de la face de son tronçon prolongée. L'angle
        // des deux faces est borné à part (ouverture du raccord sur l'épaisseur du limon) : sur
        // un palier très court, l'écart seul laisserait passer un vrai angle.
        const gap =
          spliced === null &&
          alignTol > 0 &&
          prev.section !== undefined &&
          prev.length > ON_EDGE_TOL &&
          piece.length > ON_EDGE_TOL
            ? landingGap(prev, a, piece, piece.a)
            : null;
        const skew = Math.abs(V.cross(prev.dir, piece.dir)) * alignThickness;
        const near =
          gap !== null && gap <= alignTol + ALIGN_TOL && skew <= alignTol + ALIGN_TOL
            ? splice(prev, piece, landingMiddle(j, side))
            : null;
        if (spliced) {
          // Bords alignés d'un tronçon à l'autre : raccord au milieu du palier (F16).
          seq[seq.length - 1] = spliced.before;
          append({ kind: "splice", junction: j }, spliced.after);
        } else if (near && gap !== null) {
          landingMerges.push({
            junction: j,
            side,
            a,
            b: piece.a,
            gap,
            before: { a: near.before.a, dir: near.before.dir },
            after: { a: near.after.a, dir: near.after.dir },
          });
          seq[seq.length - 1] = near.before;
          append({ kind: "splice", junction: j, gap }, near.after);
        } else {
          if (edge && viaEdge) append(viaEdge, edge);
          append(toPiece, piece);
        }
      } else if (side === "outer") {
        if (z.wall?.kind === "arc")
          throw new StructureError(msg("structure.common.legs.wallSegmentNotStraight"));
        const tanHalf = uniform ? tanHalfAngle(angle) : tanHalfBetween(prev.dir, piece.dir);
        append({ kind: "corner", concave: true, tanHalf, junction: j }, piece);
      } else {
        const well: WellJoint = z.well ?? { kind: "sharp" };
        if (well.kind === "sharp" || well.kind === "arc") {
          jourIssues.push({ junction: j, kind: well.kind });
          append({ kind: "open", junction: j }, piece);
        } else if (well.kind === "newel") {
          append({ kind: "newel", turn: j }, piece);
        } else {
          // Pan coupé : face droite propre, angles saillants à ses deux bouts.
          // Une partie droite de longueur nulle (tronçon à 2 × retrait) reste une face à part,
          // reliée par des angles : jamais fusionnée avec les pans (corde dans le vide du jour).
          const pan = own(endOf(prev), piece.a, j, "chamfer");
          append(linkBetween(prev, pan, into, j, false), pan);
          append(linkBetween(pan, piece, into, j, false), piece);
        }
      }
    }
    // 4. Faces : morceaux alignés fusionnés (palier droit à bords alignés sans raccord possible).
    let startEnd: FaceEnd = { kind: "floor" };
    let k = 0;
    while (k < seq.length) {
      const group: Piece[] = [seq[k]!];
      while (k < links.length && links[k]!.kind === "aligned") group.push(seq[++k]!);
      const link = k < links.length ? links[k]! : null;
      const endEnd: FaceEnd = link === null ? { kind: "arrival" } : (link as FaceEnd);
      const face = mergeFace(group, into, sigmaOf);
      const head = group[0]!;
      const sectionsOf = group.flatMap((p) => (p.section !== undefined ? [p.section] : []));
      faces.push({
        side,
        ...face,
        sections: sectionsOf,
        ...(sectionsOf.length === 0 && head.junction !== undefined
          ? { junction: head.junction, junctionKind: head.junctionKind! }
          : {}),
        start: startEnd,
        end: endEnd,
      });
      startEnd = endEnd;
      k++;
    }
  }
  // Ordre des faces : rang de la montée (tronçon i → 2i, jonction j → 2j + 1), jour avant mur.
  const rank = (f: EdgeFace): number =>
    f.sections.length > 0 ? 2 * f.sections[0]! : 2 * (f.junction ?? 0) + 1;
  faces.sort((x, y) => rank(x) - rank(y) || (x.side === y.side ? 0 : x.side === "inner" ? -1 : 1));

  // 5. Poteaux (tracé à volées : refusés en amont sur une cage saisie).
  const newels: NewelGeometry[] = [];
  zones.forEach((z, j) => {
    const well = z.well;
    if (well?.kind !== "newel") return;
    const leg = legs[j]!;
    const offset = newelOffset(well);
    const center = V.sub(z.innerCorner, V.scale(V.add(leg.n, leg.u), offset));
    newels.push({
      turn: j,
      center,
      size: well.size,
      offset,
      jourExtent: newelSetback(well),
      n: leg.n,
      u: leg.u,
    });
  });
  return {
    legs,
    newels,
    faces,
    jourIssues,
    landingMerges,
    width: Math.min(...widths),
    maxWidth: Math.max(...widths),
    sign,
  };
}

/** Liaison entre deux morceaux consécutifs d'un même côté. */
type Link = FaceEnd | { readonly kind: "aligned" };

/**
 * Liaison entre deux morceaux consécutifs d'un même côté : alignés (même droite, ou, sur un palier
 * droit seulement, morceau de longueur nulle : fusionnés en une face), sinon angle rentrant (la
 * face suivante repart vers les marches, à l'opposé de l'épaisseur du limon) ou saillant. Sur une
 * jonction tournante (`zeroAligned` faux), seules les directions comptent : un morceau de longueur
 * nulle entre deux pans coupés reste une face à part, sans quoi la fusion tirerait une corde.
 */
function linkBetween(
  prev: Piece,
  next: Piece,
  into: (dir: Vec2) => Vec2,
  junction: number,
  zeroAligned = true,
): Link {
  if (zeroAligned && (prev.length <= ON_EDGE_TOL || next.length <= ON_EDGE_TOL))
    return { kind: "aligned" };
  if (Math.abs(V.cross(prev.dir, next.dir)) <= ALIGN_TOL && V.dot(prev.dir, next.dir) > 0)
    return { kind: "aligned" };
  return {
    kind: "corner",
    concave: V.dot(next.dir, into(prev.dir)) < 0,
    tanHalf: tanHalfBetween(prev.dir, next.dir),
    junction,
  };
}

/** Face d'un groupe de morceaux alignés : le morceau seul tel quel, sinon de bout en bout. */
function mergeFace(
  group: readonly Piece[],
  into: (dir: Vec2) => Vec2,
  sigmaOf: (p: Vec2) => Mm,
): { a: Vec2; dir: Vec2; into: Vec2; length: Mm; sigmaA: Mm } {
  const real = group.filter((p) => p.length > ON_EDGE_TOL);
  if (real.length <= 1) {
    const p = real[0] ?? group[0]!;
    return { a: p.a, dir: p.dir, into: into(p.dir), length: p.length, sigmaA: p.sigmaA };
  }
  const a = real[0]!.a;
  const d = V.sub(endOf(real[real.length - 1]!), a);
  const dir = V.normalize(d);
  const sigmaA = Number.isFinite(real[0]!.sigmaA) ? real[0]!.sigmaA : sigmaOf(a);
  return { a, dir, into: into(dir), length: V.norm(d), sigmaA };
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
