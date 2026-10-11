/**
 * Repères des tronçons d'une cage (ADR-0010) : propagation du repère (u, r) de jonction en
 * jonction, dans le repère local du tracé (départ du premier tronçon sur le segment
 * (0,0)–(E,0), montée selon +Y, comme un escalier à volées).
 *
 * u est la direction de montée (unitaire) d'un tronçon et r la normale unitaire gauche → droite.
 * Une jonction d'angle θ (degrés signés, positif = à gauche en montant) fait tourner (u, r) de θ.
 * Les angles 0 et ±90° sont traités **exactement**, par permutation des composantes (aucun
 * cos / sin), pour l'égalité numérique avec le moteur à volées (`layout/layout.ts`) ; les autres
 * angles (lot 2) passeront par une rotation trigonométrique et ne sont pas encore pris en charge.
 *
 * ## Étendue d'un tronçon (`SectionFrame`)
 *
 * Le repère d'un tronçon couvre sa partie droite **et** les débords jusqu'au coin du mur W des
 * jonctions voisines (`lead`, `tail`) : c'est la longueur « au mur » d'une volée
 * (`LegSchema.length`), carrés d'angle E × E compris. À ±90°, chaque débord vaut E (largeur du
 * tronçon) ; deux tronçons successifs se recouvrent sur le carré d'angle.
 */
import type { Mm, Vec2 } from "../../model/primitives.js";
import * as V from "../../geom2d/vec.js";
import { msg } from "@blondel/i18n";
import { LayoutError } from "../errors.js";

/** Base d'un tronçon : direction de montée u et normale gauche → droite r (unitaires). */
export interface Basis {
  readonly u: Vec2;
  readonly r: Vec2;
}

/** Repère d'un tronçon, repère local du tracé. */
export interface SectionFrame {
  /**
   * Origine sur le bord **gauche**, au début de l'étendue du tronçon (ligne de départ de
   * l'escalier, ou début du carré d'angle de la jonction d'entrée).
   */
  readonly left: Vec2;
  readonly u: Vec2;
  readonly r: Vec2;
  /** Étendue le long de u : `lead` + partie droite + `tail` (longueur « au mur »). */
  readonly length: Mm;
  /** Débord avant la partie droite (jonction d'entrée), 0 au départ. */
  readonly lead: Mm;
  /** Débord après la partie droite (jonction de sortie), 0 à l'arrivée. */
  readonly tail: Mm;
}

/** Base de départ du tracé (montée selon +Y, gauche en x = 0). */
export const START_BASIS: Basis = { u: V.vec(0, 1), r: V.vec(1, 0) };

/** Vrai si la rotation de θ (degrés) est traitée exactement (0 et ±90°). */
export function isExactAngle(angle: number): boolean {
  return angle === 0 || angle === 90 || angle === -90;
}

/**
 * Base du tronçon sortant d'une jonction d'angle `angle` (degrés signés). Exacte pour 0 et ±90°
 * (permutation, mêmes opérations que `layout/layout.ts`) ; `undefined` pour un autre angle (pas
 * encore pris en charge, lot 2).
 */
export function rotateBasis(basis: Basis, angle: number): Basis | undefined {
  const { u, r } = basis;
  if (angle === 0) return basis;
  // À gauche : u' = −r, r' = u.
  if (angle === 90) return { u: V.scale(r, -1), r: u };
  // À droite : u' = r, r' = −u.
  if (angle === -90) return { u: r, r: V.scale(u, -1) };
  return undefined;
}

/** Point du tronçon à l'abscisse t (le long de u, depuis `left`) et à la distance o du bord gauche. */
export function at(frame: SectionFrame, t: Mm, o: Mm): Vec2 {
  return V.addScaled(V.addScaled(frame.left, frame.u, t), frame.r, o);
}

/** Jonction vue par la propagation des repères. */
export interface FrameJunction {
  /** Angle en degrés signés (0 ou ±90° au lot 1). */
  readonly angle: number;
}

/**
 * Repères des tronçons, de largeur constante `width`, à partir de leurs étendues « au mur »
 * (`lengths`, débords compris) et des jonctions (±90° seulement : l'appelant a refusé les
 * autres angles, sinon `LayoutError`). L'origine du tronçon sortant est celle de la volée
 * sortante du moteur à volées : à gauche, A' = A + (L − E)·u + E·r ; à droite, A' = A + L·u.
 */
export function buildFrames(
  lengths: readonly Mm[],
  junctions: readonly FrameJunction[],
  width: Mm,
): SectionFrame[] {
  const frames: SectionFrame[] = [];
  let left: Vec2 = V.vec(0, 0);
  let basis: Basis = START_BASIS;
  lengths.forEach((length, i) => {
    const lead = i > 0 ? width : 0;
    const tail = i < junctions.length ? width : 0;
    frames.push({ left, u: basis.u, r: basis.r, length, lead, tail });
    const junction = junctions[i];
    if (junction === undefined) return;
    const next = rotateBasis(basis, junction.angle);
    if (next === undefined || junction.angle === 0) {
      // Garde-fou : l'appelant n'appelle `buildFrames` qu'avec des jonctions à ±90°.
      throw new LayoutError(
        msg("layout.cage.angleNotYetSupported", {
          junction: i + 1,
          angle: String(junction.angle),
        }),
      );
    }
    left =
      junction.angle > 0
        ? V.addScaled(V.addScaled(left, basis.u, length - width), basis.r, width)
        : V.addScaled(left, basis.u, length);
    basis = next;
  });
  return frames;
}
