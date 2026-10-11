/**
 * Jonctions d'une cage (ADR-0010), en forme fermée, largeurs égales de part et d'autre
 * (sous-lot 2a ; la largeur variable vient au 2b).
 *
 * ## Jonction tournante d'angle θ (degrés signés, 0 < |θ| < 180°)
 *
 * Repère : celui du tronçon entrant (`SectionFrame`), d'étendue L (débords compris), de largeur
 * E, de direction u ; n est la normale jour → mur de ce tronçon, u' et n' celles du tronçon
 * sortant (rotation de θ). t = tan(|θ|/2), exactement 1 à ±90° (`frames.ts`).
 * - **K** (coin du jour) = intersection des droites de bord du jour entrante et sortante : fin
 *   de la partie droite du tronçon entrant, côté du jour (`wellCorner`).
 * - **W** (coin du mur) = intersection des droites côté mur : K + E·n + E·t·u (`wallCorner`,
 *   fin de l'étendue du tronçon entrant ; début de celle du tronçon sortant).
 * - **Zone de jonction** (« cerf-volant ») : K, K + E·n, W, K + E·n', délimitée par la
 *   perpendiculaire à u par K (arrivée du tronçon entrant), la perpendiculaire à u' par K
 *   (départ du tronçon sortant) et les bords côté mur ; c'est exactement le carré d'angle E × E
 *   à ±90°.
 * - **Raccords de jour** (`well`) :
 *   - vif : bord du jour anguleux en K ; Γ = arc de centre K, de rayon d_f, de balayage θ ;
 *   - arc de rayon r : centre sur la bissectrice, à r du bord, points de tangence à r·t de K ;
 *     Γ = arc de même centre, de rayon r + d_f ;
 *   - pan coupé (décision F6 du 2026-10-11) : segment du bord du jour de K − `setbackIn`·u à
 *     K + `setbackOut`·u' ; Γ comme un angle vif (arc de centre K, rayon d_f), le pan coupé
 *     n'étant qu'une forme du bord du jour. Γ est à distance ≥ d_f du pan **par construction**,
 *     sans contrôle : vus de K, les points du pan sont dans le secteur du jour (de −u à u',
 *     ouverture π − |θ|) et ceux de Γ dans le secteur opposé (de n à n', ouverture |θ|), à au
 *     moins 90° l'un de l'autre (n ⟂ u, n' ⟂ u') ; pour P sur le pan et Q sur Γ, l'angle PKQ
 *     est donc ≥ 90° et |PQ|² ≥ |KP|² + d_f² ≥ d_f² (propriété dans `junction.test.ts`) ;
 *   - poteau : à ±90° seulement (décision F5 du 2026-10-11, `checkWellAngle`), formes du moteur
 *     à volées (`layout/layout.ts`, « Raccords de jour »).
 * - **Raccord côté mur** (`wall`) : vif (coin W) ou congé de rayon R tangent aux deux droites
 *   côté mur, centre sur la bissectrice, points de tangence à R·t de W ; Γ et le bord du jour
 *   doivent rester hors du coin retiré par le congé (`checkWallArc`).
 * - **Avertissement F4** : au-delà de `WALL_SHARP_WARNING_ANGLE` avec un mur vif.
 *
 * À ±90°, les formes fermées et l'ordre des opérations sont ceux de l'ancien moteur à volées
 * (`layout/legacyFlights.ts`) : égalité numérique (parité, `parity.test.ts`).
 *
 * ## Palier droit (θ = 0, mode `landing`)
 *
 * Rectangle de profondeur `depth` (défaut : E, décision F9), porté par le débord de fin du
 * tronçon entrant (`frames.ts`) ; Γ y est droite. Raccords vifs seulement (schéma).
 */
import type { CurveSeg, Mm, Vec2 } from "../../model/primitives.js";
import type { CageJunction, WallJoint, WellJoint } from "../../model/project.js";
import { arcSeg, lineSeg } from "../../geom2d/segment.js";
import { intersectSupports } from "../../geom2d/intersect.js";
import { ANGLE_EPS } from "../../geom2d/tolerance.js";
import * as V from "../../geom2d/vec.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "../errors.js";
import { newelOffset, newelProtrusion, newelSetback } from "../newel.js";
import { at, junctionSweep, rotateBasis, tanHalf, type SectionFrame } from "./frames.js";

export type Side = "left" | "right";

/**
 * Seuil par défaut (degrés) au-delà duquel une jonction à raccord côté mur **vif** reçoit un
 * avertissement (décision F4 du 2026-10-11 : avertissement, pas erreur). **Valeur non sourcée,
 * « à valider »** : proposée par la question F4 (`docs/QUESTIONS.md`). Paramètre du projet :
 * `wallSharpWarningAngle` de la cage (`CageLayoutSpecSchema`), cette constante n'en étant que
 * le défaut (comme `COLLET_TIE_TOLERANCE` pour `balancing.colletTieTolerance`).
 */
export const WALL_SHARP_WARNING_ANGLE = 135;

/** Jonction tournante (angle non nul), précalculée. */
export interface TurnJunction {
  readonly kind: "turn";
  /** Côté du jour (et sens) : gauche si l'angle est positif. */
  readonly side: Side;
  readonly mode: "winders" | "landing" | "radiating";
  /** Angle en degrés signés. */
  readonly angle: number;
  /** tan(|θ|/2), exactement 1 à ±90°. */
  readonly tanHalf: number;
  /** Balayage signé (rad), exactement ±π/2 à ±90°. */
  readonly sweep: number;
  readonly well: WellJoint;
  readonly wall: WallJoint;
  readonly source: CageJunction;
}

/** Palier droit (angle 0). */
export interface StraightJunction {
  readonly kind: "straight";
  /** Profondeur du palier (défaut : largeur, F9). */
  readonly depth: Mm;
  readonly source: CageJunction;
}

export type JunctionGeom = TurnJunction | StraightJunction;

/** Côté du jour (et sens) d'une jonction tournante : gauche si l'angle est positif. */
export function junctionSide(junction: Pick<CageJunction, "angle">): Side {
  return junction.angle > 0 ? "left" : "right";
}

/** Jonction précalculée (`width` : largeur, profondeur par défaut d'un palier droit). */
export function junctionGeom(junction: CageJunction, width: Mm): JunctionGeom {
  if (junction.angle === 0) {
    return { kind: "straight", depth: junction.depth ?? width, source: junction };
  }
  return {
    kind: "turn",
    side: junctionSide(junction),
    mode: junction.mode,
    angle: junction.angle,
    tanHalf: tanHalf(junction.angle),
    sweep: junctionSweep(junction.angle),
    well: junction.well,
    wall: junction.wall,
    source: junction,
  };
}

/**
 * Poteau d'angle sur une jonction d'angle autre que ±90° : refusé (décision F5 du 2026-10-11).
 * @throws LayoutError (`layout.cage.newelAngle`) sinon.
 */
export function checkWellAngle(junction: CageJunction, index: number): void {
  if (junction.well.kind === "newel" && junction.angle !== 90 && junction.angle !== -90) {
    throw new LayoutError(
      msg("layout.cage.newelAngle", { junction: index + 1, angle: String(junction.angle) }),
    );
  }
}

/** Retrait du bord du jour sur le tronçon **entrant**, depuis K. */
export function wellSetbackIn(j: TurnJunction): Mm {
  const well = j.well;
  switch (well.kind) {
    case "sharp":
      return 0;
    case "arc":
      return well.radius * j.tanHalf;
    case "newel":
      return newelSetback(well);
    case "chamfer":
      return well.setbackIn;
  }
}

/** Retrait du bord du jour sur le tronçon **sortant**, depuis K. */
export function wellSetbackOut(j: TurnJunction): Mm {
  const well = j.well;
  switch (well.kind) {
    case "sharp":
      return 0;
    case "arc":
      return well.radius * j.tanHalf;
    case "newel":
      return newelSetback(well);
    case "chamfer":
      return well.setbackOut;
  }
}

/** Retrait de la partie droite de Γ de part et d'autre de K (tangence d'un jour en arc, 0 sinon). */
export function walkSetback(j: TurnJunction): Mm {
  return j.well.kind === "arc" ? j.well.radius * j.tanHalf : 0;
}

/** Retrait du bord côté mur de part et d'autre de W (tangence du congé, 0 pour un mur vif). */
export function wallSetback(j: TurnJunction): Mm {
  return j.wall.kind === "arc" ? j.wall.radius * j.tanHalf : 0;
}

/**
 * Contrôles d'un poteau d'angle (jonction `index`, 0 = première) : décalage δ < a/2 et ligne de
 * foulée hors du poteau (d_f > p·√2), mêmes messages que le moteur à volées.
 * @throws LayoutError sinon.
 */
export function checkNewel(well: WellJoint, index: number, df: Mm): void {
  if (well.kind !== "newel") return;
  const offset = newelOffset(well);
  if (!(offset < well.size / 2)) {
    throw new LayoutError(
      msg("layout.newelOffsetTooLarge", {
        turn: index + 1,
        offset: String(offset),
        halfSize: String(well.size / 2),
      }),
    );
  }
  // Sommet du poteau côté marches (p, p) : le plus proche de Γ (arc de rayon d_f centré en K).
  const reach = newelProtrusion(well) * Math.SQRT2;
  if (!(df > reach)) {
    throw new LayoutError(
      msg("layout.walklineCrossesNewel", {
        turn: index + 1,
        offset: String(df),
        size: String(well.size),
        required: reach.toFixed(1),
      }),
    );
  }
}

/** Distance du bord gauche au bord `side` (0 ou E). */
export function sideOffset(side: Side, width: Mm): Mm {
  return side === "left" ? 0 : width;
}

/** Coin intérieur K (intersection des bords côté jour), repère local. */
export function wellCorner(frame: SectionFrame, side: Side, width: Mm): Vec2 {
  return at(frame, frame.length - frame.tail, sideOffset(side, width));
}

/** Coin du mur W (intersection des bords côté mur, angle vif), repère local. */
export function wallCorner(frame: SectionFrame, side: Side, width: Mm): Vec2 {
  return at(frame, frame.length, side === "left" ? width : 0);
}

/** Normale unitaire jour → mur du tronçon entrant. */
export function collarNormal(frame: SectionFrame, side: Side): Vec2 {
  return side === "left" ? frame.r : V.scale(frame.r, -1);
}

/** Direction de montée du tronçon sortant. */
export function outgoingDirection(frame: SectionFrame, j: TurnJunction): Vec2 {
  return rotateBasis({ u: frame.u, r: frame.r }, j.angle).u;
}

/**
 * Segments du bord du jour propres à la jonction (entre la fin de la partie droite du tronçon
 * entrant et le début de celle du tronçon sortant), repère local. `k` : coin K ; `u` : direction
 * du tronçon entrant ; `n` : normale jour → mur de ce tronçon ; `u2` : direction du tronçon
 * sortant.
 */
export function wellTurnSegments(j: TurnJunction, k: Vec2, u: Vec2, n: Vec2, u2: Vec2): CurveSeg[] {
  const well = j.well;
  switch (well.kind) {
    case "sharp":
      return [];
    case "arc": {
      const r = well.radius;
      const center = V.sub(V.sub(k, V.scale(n, r)), V.scale(u, r * j.tanHalf));
      return [arcSeg(center, r, V.angleOf(n), j.sweep)];
    }
    case "chamfer":
      return [lineSeg(V.addScaled(k, u, -well.setbackIn), V.addScaled(k, u2, well.setbackOut))];
    case "newel": {
      // Coordonnées (α, β) dans la base (n, u) centrée sur K ; poteau α, β ∈ [−s ; p]
      // (s = a/2 + δ côté jour, p = a/2 − δ côté marches, `newel.ts`). ±90° seulement (F5).
      const s = newelSetback(well);
      const p = newelProtrusion(well);
      const pt = (a: number, b: number): Vec2 => V.add(V.add(k, V.scale(n, a)), V.scale(u, b));
      const pts = [pt(0, -s), pt(p, -s), pt(p, p), pt(-s, p), pt(-s, 0)];
      const segs: CurveSeg[] = [];
      for (let i = 0; i + 1 < pts.length; i++) segs.push(lineSeg(pts[i]!, pts[i + 1]!));
      return segs;
    }
  }
}

/**
 * Segments du bord côté mur propres à la jonction : rien pour un angle vif (coin W), congé de
 * rayon R (centre W − R·t·u − R·n, balayage θ) sinon. `w` : coin W.
 */
export function wallTurnSegments(j: TurnJunction, w: Vec2, u: Vec2, n: Vec2): CurveSeg[] {
  if (j.wall.kind !== "arc") return [];
  const radius = j.wall.radius;
  const center = V.sub(V.addScaled(w, u, -radius * j.tanHalf), V.scale(n, radius));
  return [arcSeg(center, radius, V.angleOf(n), j.sweep)];
}

/**
 * Arc de la ligne de foulée Γ dans la jonction : centre F = K − r·n − r·t·u (r : rayon du
 * raccord de jour en arc, 0 sinon, donc K pour un angle vif, un pan coupé ou un poteau), rayon
 * r + d_f, balayage θ. Rend le segment et sa longueur.
 */
export function walklineArc(
  j: TurnJunction,
  frame: SectionFrame,
  width: Mm,
  df: Mm,
): { readonly seg: CurveSeg; readonly length: Mm } {
  const r = j.well.kind === "arc" ? j.well.radius : 0;
  const n = collarNormal(frame, j.side);
  const center = V.sub(
    V.sub(wellCorner(frame, j.side, width), V.scale(n, r)),
    V.scale(frame.u, r * j.tanHalf),
  );
  const radius = r + df;
  const exact = j.angle === 90 || j.angle === -90;
  return {
    seg: arcSeg(center, radius, V.angleOf(n), j.sweep),
    length: exact ? (radius * Math.PI) / 2 : radius * Math.abs(j.sweep),
  };
}

/**
 * Congé côté mur (jonction `index`) : le contrôle des points de tangence sur les bords
 * (`wallArcDoesNotFit`, `section.ts`) ne suffit pas. Au-delà d'un rayon de l'ordre de E, le
 * centre C = W − R·t·u − R·n passe du côté du jour et l'arc du congé peut couper Γ, voire le
 * bord du jour : emprise non simple, mur au travers de la ligne de foulée. Le congé retire de
 * l'emprise le « coin » compris entre son arc et W. Γ et le bord du jour partent du départ du
 * premier tronçon, hors de ce coin (qui commence au point de tangence, sur le bord côté mur) ;
 * étant continus, ils n'y entrent qu'en coupant l'arc du congé (le coin est connexe et contient
 * des points des deux côtés de Γ dès qu'il atteint Γ) : il suffit donc qu'aucun segment de Γ
 * ni du bord du jour (`curves`, repère local) ne coupe ni ne touche cet arc. `w` : coin W ;
 * `u`, `n` : direction et normale jour → mur du tronçon entrant.
 * @throws LayoutError (`layout.cage.wallArcCrossesWalkline`) sinon.
 */
export function checkWallArc(
  j: TurnJunction,
  index: number,
  w: Vec2,
  u: Vec2,
  n: Vec2,
  curves: readonly CurveSeg[],
): void {
  const [fillet] = wallTurnSegments(j, w, u, n);
  if (fillet === undefined) return;
  const within = (t: number): boolean => t >= -ANGLE_EPS && t <= 1 + ANGLE_EPS;
  const hit = curves.some((seg) =>
    intersectSupports(seg, fillet).some((h) => within(h.ta) && within(h.tb)),
  );
  if (hit) {
    const radius = j.wall.kind === "arc" ? j.wall.radius : 0;
    throw new LayoutError(
      msg("layout.cage.wallArcCrossesWalkline", { junction: index + 1, radius: String(radius) }),
    );
  }
}
