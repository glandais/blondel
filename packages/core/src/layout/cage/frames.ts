/**
 * Repères des tronçons d'une cage (ADR-0010) : propagation du repère (u, r) de jonction en
 * jonction, dans le repère local du tracé (départ du premier tronçon sur le segment
 * (0,0)–(E,0), montée selon +Y, comme un escalier à volées).
 *
 * u est la direction de montée (unitaire) d'un tronçon et r la normale unitaire gauche → droite.
 * Une jonction d'angle θ (degrés signés, positif = à gauche en montant) fait tourner (u, r) de θ.
 * Les angles 0 et ±90° sont traités **exactement**, par permutation des composantes (aucun
 * cos / sin), pour l'égalité numérique avec l'ancien moteur à volées
 * (`layout/legacyFlights.ts`) ; les autres angles (sous-lot 2a) passent par une rotation
 * trigonométrique (cos / sin). De même, tan(|θ|/2) et le balayage θ en radians valent
 * exactement 1 et ±π/2 à ±90° (`tanHalf`, `junctionSweep`) : `Math.tan(Math.PI / 4)` vaut
 * 0,9999999999999999 en float64, ce qui casserait la parité.
 *
 * ## Étendue d'un tronçon (`SectionFrame`)
 *
 * Le repère d'un tronçon couvre sa partie droite **et** les débords jusqu'au coin du mur W des
 * jonctions voisines (`lead`, `tail`) : c'est la longueur « au mur » d'une volée
 * (`LegSchema.length`), carrés d'angle E × E compris. Jonction tournante d'angle θ : débord
 * E·tan(|θ|/2) de part et d'autre (E à ±90°) ; deux tronçons successifs se recouvrent sur la
 * zone de jonction (« cerf-volant » K, K + E·n, W, K + E·n', `junction.ts`), qui redonne le
 * carré d'angle E × E à ±90°. Palier droit (θ = 0) : le palier, de profondeur `depth`
 * (défaut : E, décision F9), est porté par le débord de fin du tronçon entrant (`tail`) ; le
 * tronçon sortant commence à son bord (`lead` = 0).
 */
import type { Mm, Vec2 } from "../../model/primitives.js";
import * as V from "../../geom2d/vec.js";

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
  /** Partie droite saisie (`axis.length`, F11) : `length` − `lead` − `tail`. */
  readonly straight: Mm;
}

/** Base de départ du tracé (montée selon +Y, gauche en x = 0). */
export const START_BASIS: Basis = { u: V.vec(0, 1), r: V.vec(1, 0) };

/** Vrai si la rotation de θ (degrés) est traitée exactement (0 et ±90°). */
export function isExactAngle(angle: number): boolean {
  return angle === 0 || angle === 90 || angle === -90;
}

/**
 * Base du tronçon sortant d'une jonction d'angle `angle` (degrés signés, sens trigonométrique
 * vu de dessus). Exacte pour 0 et ±90° (permutation, mêmes opérations que l'ancien moteur,
 * `layout/legacyFlights.ts`) ; rotation trigonométrique sinon.
 */
export function rotateBasis(basis: Basis, angle: number): Basis {
  const { u, r } = basis;
  if (angle === 0) return basis;
  // À gauche : u' = −r, r' = u.
  if (angle === 90) return { u: V.scale(r, -1), r: u };
  // À droite : u' = r, r' = −u.
  if (angle === -90) return { u: r, r: V.scale(u, -1) };
  const a = (angle * Math.PI) / 180;
  return { u: V.rotate(u, a), r: V.rotate(r, a) };
}

/** tan(|θ|/2) d'une jonction (θ en degrés) : exactement 0 à 0° et 1 à ±90°. */
export function tanHalf(angle: number): number {
  if (angle === 0) return 0;
  if (angle === 90 || angle === -90) return 1;
  return Math.tan((Math.abs(angle) * Math.PI) / 360);
}

/** Balayage signé (rad) d'une jonction d'angle θ (degrés) : exactement ±π/2 à ±90°. */
export function junctionSweep(angle: number): number {
  if (angle === 90) return Math.PI / 2;
  if (angle === -90) return -Math.PI / 2;
  return (angle * Math.PI) / 180;
}

/** Point du tronçon à l'abscisse t (le long de u, depuis `left`) et à la distance o du bord gauche. */
export function at(frame: SectionFrame, t: Mm, o: Mm): Vec2 {
  return V.addScaled(V.addScaled(frame.left, frame.u, t), frame.r, o);
}

/** Jonction vue par la propagation des repères. */
export interface FrameJunction {
  /** Angle en degrés signés (|θ| < 180°, 0 = palier droit). */
  readonly angle: number;
  /** Profondeur d'un palier droit (angle 0) ; absente : largeur du tronçon (F9). */
  readonly depth?: Mm | undefined;
}

/** Débords d'une jonction : fin du tronçon entrant (`tail`) et début du tronçon sortant (`lead`). */
export interface Overhang {
  readonly tail: Mm;
  readonly lead: Mm;
}

/**
 * Débords d'une jonction de tronçons de largeur `width` : E·tan(|θ|/2) de part et d'autre d'une
 * jonction tournante (exactement E à ±90°) ; palier droit : profondeur du palier sur le tronçon
 * entrant, rien sur le tronçon sortant.
 */
export function junctionOverhang(junction: FrameJunction, width: Mm): Overhang {
  if (junction.angle === 0) return { tail: junction.depth ?? width, lead: 0 };
  const o = width * tanHalf(junction.angle);
  return { tail: o, lead: o };
}

/**
 * Repères des tronçons, de largeur constante `width`, à partir de leurs parties droites
 * (`straight`, `axis.length`) et des jonctions. L'étendue d'un tronçon est
 * `lead` + partie droite + `tail` (`junctionOverhang`). L'origine du tronçon sortant :
 * - à ±90°, celle de la volée sortante du moteur à volées (mêmes opérations) : à gauche,
 *   A' = A + (L − E)·u + E·r ; à droite, A' = A + L·u ;
 * - palier droit : A' = A + L·u (même direction) ;
 * - angle θ quelconque : la ligne de départ du tronçon sortant passe par le coin du jour K
 *   (fin de la partie droite du tronçon entrant, côté du jour), A' = K − o_j·r' − lead'·u'
 *   (o_j : distance du bord du jour au bord gauche, 0 ou E).
 */
export function buildFrames(
  straight: readonly Mm[],
  junctions: readonly FrameJunction[],
  width: Mm,
): SectionFrame[] {
  const frames: SectionFrame[] = [];
  let left: Vec2 = V.vec(0, 0);
  let basis: Basis = START_BASIS;
  const overhangs = junctions.map((j) => junctionOverhang(j, width));
  straight.forEach((s, i) => {
    const lead = i > 0 ? overhangs[i - 1]!.lead : 0;
    const tail = i < junctions.length ? overhangs[i]!.tail : 0;
    const length = lead + s + tail;
    frames.push({ left, u: basis.u, r: basis.r, length, lead, tail, straight: s });
    const junction = junctions[i];
    if (junction === undefined) return;
    const next = rotateBasis(basis, junction.angle);
    if (junction.angle === 90) {
      left = V.addScaled(V.addScaled(left, basis.u, length - width), basis.r, width);
    } else if (junction.angle === -90 || junction.angle === 0) {
      left = V.addScaled(left, basis.u, length);
    } else {
      const jour = junction.angle > 0 ? 0 : width;
      const k = V.addScaled(V.addScaled(left, basis.u, length - tail), basis.r, jour);
      left = V.addScaled(V.addScaled(k, next.r, -jour), next.u, -overhangs[i]!.lead);
    }
    basis = next;
  });
  return frames;
}
