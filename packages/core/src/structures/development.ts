/**
 * Développé d'un limon droit (B §4.1, CHALLENGE G6).
 *
 * Repère du développé **(u, z)** : u = abscisse le long de la face de référence (face
 * intérieure, côté marches), dans le sens de la montée, origine au point `face.a` ; z =
 * altitude (sol fini bas = 0). La face étant plane et verticale, le développé est son élévation.
 * Le `FlatPattern` rendu est ensuite exprimé en (x, y) avec x ≥ 0, **vu depuis les marches**
 * (miroir de u pour un limon vu du côté où la montée va vers la gauche).
 *
 * - **Ligne des nez** : polyligne des points (σ_k, z_k) où les lignes de nez coupent le bord
 *   (C_i ou C_e) ; σ = abscisse le long de ce bord, commune à tous les limons d'un même côté
 *   (rives continues aux angles). Prolongée linéairement avant le premier nez et après le
 *   dernier. Sur un palier (marche `landing` entre les nez k et k + 1), elle reste de niveau à
 *   z_k jusqu'à un giron avant le nez de sortie, puis monte sur ce giron : même profil que les
 *   garde-corps (`guards/sides.ts`, `sideEdge`), voir `nosingPitchLine`.
 * - **Rives** : haute z = P(σ) + d_h, basse z = P(σ) − d_b (dépassements verticaux constants,
 *   « arasement », C §1.4) ; largeur perpendiculaire = (d_h + d_b)·cos α par morceau.
 * - **Extrémités** : départ au sol → coupe de niveau z = 0 (tout le limon est découpé par le
 *   sol bas) et coupe d'aplomb à u_lo ; arrivée → coupe d'aplomb contre le chevêtre à u_hi et
 *   coupe de niveau de la rive haute à d_h au-dessus du sol fini d'arrivée (dernier nez :
 *   arasement constant, C §1.4 ; B §4.1 « coupe de niveau à l'arrivée ») ; poteau → coupe
 *   d'aplomb contre la face du poteau, avec tenon facultatif ; angle mural → le limon est
 *   prolongé de l'épaisseur du limon voisin jusqu'à l'arête extérieure du coin (zone de
 *   l'assemblage à queues, C §1.9, queues non dessinées), rives de niveau dans cette zone
 *   (hauteurs identiques sur les deux limons du coin).
 * - **Mortaises** : une par marche (encastrement de la marche et de la contremarche placée sous
 *   son nez, B §4.1), plus la contremarche d'arrivée ; nez arrondi étiré de 1/sin β.
 */
import { msg, textMessage, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Tread } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import {
  PiecewiseLinear,
  area,
  clipHalfPlane,
  dedupe,
  minAreaRect,
  pointSegmentDistance,
  polygonDistance,
  removeCollinear,
  type OrientedBox,
} from "./geom.js";

export type StringerStart = "floor" | "newel" | "corner";
export type StringerEnd = "arrival" | "newel" | "corner";

/** Encastrement d'une marche (dessus/dessous) et de sa contremarche, en (u, z). */
export interface HousingSpec {
  /** Libellé de la mortaise (repère de la marche : `textMessage(mark)`). */
  readonly label: Message;
  /** Numéro de la marche portée (absent : contremarche d'arrivée seule). */
  readonly tread?: number;
  readonly treadPocket?: {
    readonly u0: Mm;
    readonly u1: Mm;
    readonly zBottom: Mm;
    readonly zTop: Mm;
    /** Abscisse u où la ligne de nez coupe la face (nez de la marche), si elle la coupe. */
    readonly noseU: Mm | null;
    /** sin β, β = angle en plan entre la ligne de nez et la face. */
    readonly sinBeta: number;
  };
  readonly riserPocket?: {
    readonly u0: Mm;
    readonly u1: Mm;
    readonly zBottom: Mm;
    readonly zTop: Mm;
  };
}

export interface Housing {
  readonly label: Message;
  readonly tread?: number;
  /** Contour(s) de la mortaise, (u, z). */
  readonly polygons: readonly Polygon2[];
  /** Rectangle d'encastrement de la marche seule (bois entre mortaises). */
  readonly treadRect?: Polygon2;
}

/** Contour d'une mortaise : marche (nez arrondi étiré) ∪ contremarche sous son nez. */
export function housingPolygons(spec: HousingSpec, noseRadius: Mm): Housing {
  const T = spec.treadPocket;
  const R = spec.riserPocket;
  const rect = (a: Mm, b: Mm, y0: Mm, y1: Mm): Vec2[] => [
    V.vec(a, y0),
    V.vec(b, y0),
    V.vec(b, y1),
    V.vec(a, y1),
  ];
  const base = { label: spec.label, ...(spec.tread !== undefined ? { tread: spec.tread } : {}) };
  if (!T) {
    return { ...base, polygons: R ? [rect(R.u0, R.u1, R.zBottom, R.zTop)] : [] };
  }
  const treadRect = rect(T.u0, T.u1, T.zBottom, T.zTop);
  // Arrondi du nez (coin haut côté nez), étiré horizontalement de 1/sin β (B §4.1).
  const front: "left" | "right" | null =
    T.noseU === null
      ? null
      : Math.abs(T.noseU - T.u0) <= Math.abs(T.noseU - T.u1)
        ? "left"
        : "right";
  const ry = Math.min(noseRadius, (T.zTop - T.zBottom) / 2);
  const rx = Math.min(noseRadius / Math.max(T.sinBeta, 0.05), (T.u1 - T.u0) / 2);
  const arc = (side: "left" | "right"): Vec2[] => {
    if (!(ry > 1e-6 && rx > 1e-6))
      return [side === "left" ? V.vec(T.u0, T.zTop) : V.vec(T.u1, T.zTop)];
    const pts: Vec2[] = [];
    const steps = 8;
    if (side === "right") {
      const c = V.vec(T.u1 - rx, T.zTop - ry);
      for (let i = 0; i <= steps; i++) {
        const t = ((Math.PI / 2) * i) / steps;
        pts.push(V.vec(c.x + rx * Math.cos(t), c.y + ry * Math.sin(t)));
      }
    } else {
      const c = V.vec(T.u0 + rx, T.zTop - ry);
      for (let i = 0; i <= steps; i++) {
        const t = Math.PI / 2 + ((Math.PI / 2) * i) / steps;
        pts.push(V.vec(c.x + rx * Math.cos(t), c.y + ry * Math.sin(t)));
      }
    }
    return pts;
  };
  const topRight = front === "right" ? arc("right") : [V.vec(T.u1, T.zTop)];
  const topLeft = front === "left" ? arc("left") : [V.vec(T.u0, T.zTop)];
  const overlap = R && R.u1 > T.u0 + 1e-6 && R.u0 < T.u1 - 1e-6;
  let outline: Vec2[];
  const polygons: Polygon2[] = [];
  if (R && overlap) {
    const y1 = T.zBottom;
    outline = [
      V.vec(R.u0, R.zBottom),
      V.vec(R.u1, R.zBottom),
      V.vec(R.u1, y1),
      V.vec(T.u1, y1),
      ...topRight,
      ...topLeft,
      V.vec(T.u0, y1),
      V.vec(R.u0, y1),
    ];
  } else {
    outline = [V.vec(T.u0, T.zBottom), V.vec(T.u1, T.zBottom), ...topRight, ...topLeft];
    if (R) polygons.push(rect(R.u0, R.u1, R.zBottom, R.zTop));
  }
  polygons.unshift(removeCollinear(outline));
  return { ...base, polygons, treadRect };
}

export interface StringerDevelopmentInput {
  /** Ligne des nez du côté du limon : σ ↦ z. */
  readonly pitch: PiecewiseLinear;
  /** Abscisse σ du point u = 0 de la face. */
  readonly sigmaA: Mm;
  readonly uLo: Mm;
  readonly uHi: Mm;
  readonly start: StringerStart;
  readonly end: StringerEnd;
  /** Dépassements verticaux au-dessus / au-dessous de la ligne des nez (d_h, d_b). */
  readonly upperOffset: Mm;
  readonly lowerOffset: Mm;
  readonly housings: readonly Housing[];
  /** Tenons aux extrémités contre un poteau (longueur, épaulements haut et bas). */
  readonly tenon?: { readonly length: Mm; readonly shoulder: Mm };
  /**
   * Zones de niveau : la ligne des nez (donc les rives) est gelée à sa valeur en `levelBefore`
   * pour u < levelBefore, et en `levelAfter` pour u > levelAfter (zone d'assemblage d'angle).
   */
  readonly levelBefore?: Mm;
  readonly levelAfter?: Mm;
  /** Coupe de niveau de la rive haute (altitude maximale du limon), ex. à l'arrivée. */
  readonly topCut?: Mm;
  /**
   * Coupe de niveau basse (altitude minimale du limon) ; absent : 0 (sol fini bas). Ex. limon
   * acier posé sur une platine de pied d'épaisseur e_p : `floorLevel` = e_p.
   */
  readonly floorLevel?: Mm;
}

/**
 * Ligne des nez d'un côté (σ le long de C_i ou C_e, z) : polyligne des nez, avec un palier de
 * niveau. Sur une marche `landing` entre les nez k et k + 1, un sommet (σ_{k+1} − g, z_k) est
 * inséré, g étant le giron suivant sur ce bord (σ_{k+2} − σ_{k+1}, nul à l'arrivée) : la ligne
 * reste à z_k sur le palier puis monte sur un giron jusqu'au nez de sortie. Convention identique
 * au profil des garde-corps (`sideEdge`), pour que les rives restent arasées au-dessus du palier.
 */
export function nosingPitchLine(
  nosings: readonly Pick<NosingLine, "sigmaInner" | "sigmaOuter" | "z">[],
  treads: readonly Pick<Tread, "number" | "kind">[],
  side: "inner" | "outer",
): PiecewiseLinear {
  const sigma = (k: number): Mm =>
    side === "inner" ? nosings[k]!.sigmaInner : nosings[k]!.sigmaOuter;
  const landing = new Set(treads.filter((t) => t.kind === "landing").map((t) => t.number));
  const knots: { x: Mm; y: Mm }[] = [];
  for (let k = 0; k < nosings.length; k++) {
    knots.push({ x: sigma(k), y: nosings[k]!.z });
    // Marche k + 1 (entre les nez k et k + 1) : palier.
    if (k + 1 < nosings.length && landing.has(k + 1)) {
      const next = sigma(k + 1);
      const going = k + 2 < nosings.length ? sigma(k + 2) - next : 0;
      const flatEnd = Math.max(sigma(k), next - going);
      if (flatEnd > sigma(k) + LANDING_EPS && flatEnd < next - LANDING_EPS) {
        knots.push({ x: flatEnd, y: nosings[k]!.z });
      }
    }
  }
  return new PiecewiseLinear(knots);
}

/** Écart minimal (mm) entre le sommet de palier inséré et les nez voisins. */
const LANDING_EPS = 1e-3;

/** Altitude de la ligne des nez à l'abscisse u, zones de niveau comprises. */
export function pitchAtU(
  input: Pick<StringerDevelopmentInput, "pitch" | "sigmaA" | "levelBefore" | "levelAfter">,
  u: Mm,
): Mm {
  let v = u;
  if (input.levelBefore !== undefined && v < input.levelBefore) v = input.levelBefore;
  if (input.levelAfter !== undefined && v > input.levelAfter) v = input.levelAfter;
  return input.pitch.at(input.sigmaA + v);
}

/** Polyligne (u croissants) plafonnée à z ≤ zMax (point de croisement inséré). */
function capPolyline(pts: readonly Vec2[], zMax: Mm): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) {
      const a = pts[i - 1]!;
      if ((a.y - zMax) * (p.y - zMax) < 0) {
        const t = (zMax - a.y) / (p.y - a.y);
        out.push(V.vec(a.x + t * (p.x - a.x), zMax));
      }
    }
    out.push(V.vec(p.x, Math.min(p.y, zMax)));
  }
  return dedupe(out);
}

export interface StringerDevelopment {
  /** Contour en (u, z), CCW, sans mortaise (les mortaises sont borgnes). */
  readonly outline: Polygon2;
  readonly housings: readonly Housing[];
  /** Rives (polylignes en (u, z) de u_lo à u_hi). */
  readonly upperRive: readonly Vec2[];
  readonly lowerRive: readonly Vec2[];
  /** Ligne des nez dans la fenêtre du limon. */
  readonly pitchLine: readonly Vec2[];
  /** Tenons dessinés (u de l'épaulement, z bas, z haut). */
  readonly tenons: readonly { u: Mm; zBottom: Mm; zTop: Mm; toward: -1 | 1 }[];
  /** Rectangle englobant orienté minimal (largeur de débit). */
  readonly box: OrientedBox;
  /** Largeur perpendiculaire minimale des rives (mm). */
  readonly minPerpendicularWidth: Mm;
  readonly uLo: Mm;
  readonly uHi: Mm;
}

/** Points de la polyligne u ↦ P(σ_A + u) + offset sur [uLo ; uHi] (nœuds compris). */
function rive(input: StringerDevelopmentInput, offset: Mm): Vec2[] {
  const { pitch, sigmaA, uLo, uHi } = input;
  const lo = Math.max(uLo, input.levelBefore ?? -Infinity);
  const hi = Math.min(uHi, input.levelAfter ?? Infinity);
  const inner = hi > lo ? pitch.knotsBetween(sigmaA + lo, sigmaA + hi).map((s) => s - sigmaA) : [];
  const breaks = [lo, hi].filter((u) => u > uLo + 1e-9 && u < uHi - 1e-9);
  const us = [uLo, ...inner, ...breaks, uHi].sort((a, b) => a - b);
  const pts = us.map((u) => V.vec(u, pitchAtU(input, u) + offset));
  return dedupe(pts);
}

export function developStringer(input: StringerDevelopmentInput): StringerDevelopment {
  const { uLo, uHi } = input;
  const rawUpper = rive(input, input.upperOffset);
  const upperRive = input.topCut !== undefined ? capPolyline(rawUpper, input.topCut) : rawUpper;
  const lowerRive = rive(input, -input.lowerOffset);
  const pitchLine = rive(input, 0);
  const tenons: { u: Mm; zBottom: Mm; zTop: Mm; toward: -1 | 1 }[] = [];

  // Extrémités : tenon contre un poteau.
  const endEdge = (u: Mm, toward: -1 | 1): Vec2[] => {
    const lo = lowerRive[toward === 1 ? lowerRive.length - 1 : 0]!.y;
    const hi = upperRive[toward === 1 ? upperRive.length - 1 : 0]!.y;
    const isNewel = toward === 1 ? input.end === "newel" : input.start === "newel";
    if (!isNewel || !input.tenon) return [];
    // Le contour est coupé par le sol bas (z ≥ 0) quelle que soit l'origine du limon : un limon
    // qui part d'un poteau proche du sol a aussi sa rive basse sous le sol au droit du poteau.
    const zb = Math.max(lo + input.tenon.shoulder, input.floorLevel ?? 0);
    const zt = hi - input.tenon.shoulder;
    if (!(zt - zb > 1) || !(input.tenon.length > 0)) return [];
    tenons.push({ u, zBottom: zb, zTop: zt, toward });
    const tip = u + toward * input.tenon.length;
    return toward === 1
      ? [V.vec(u, zb), V.vec(tip, zb), V.vec(tip, zt), V.vec(u, zt)]
      : [V.vec(u, zt), V.vec(tip, zt), V.vec(tip, zb), V.vec(u, zb)];
  };

  let outline: Vec2[] = [
    ...lowerRive,
    ...endEdge(uHi, 1),
    ...[...upperRive].reverse(),
    ...endEdge(uLo, -1),
  ];
  // Coupe de niveau sur le sol bas, et coupe de niveau haute (arrivée).
  outline = clipHalfPlane(outline, V.vec(0, input.floorLevel ?? 0), V.vec(0, 1));
  if (input.topCut !== undefined)
    outline = clipHalfPlane(outline, V.vec(0, input.topCut), V.vec(0, -1));
  outline = removeCollinear(dedupe(outline));

  // Largeur perpendiculaire minimale des rives.
  let minPerp = Infinity;
  for (let i = 0; i + 1 < pitchLine.length; i++) {
    const a = pitchLine[i]!;
    const b = pitchLine[i + 1]!;
    const du = b.x - a.x;
    if (du <= 1e-9) continue;
    const slope = (b.y - a.y) / du;
    minPerp = Math.min(
      minPerp,
      (input.upperOffset + input.lowerOffset) / Math.sqrt(1 + slope * slope),
    );
  }
  if (!Number.isFinite(minPerp)) minPerp = input.upperOffset + input.lowerOffset;

  return {
    outline,
    housings: input.housings,
    upperRive,
    lowerRive,
    pitchLine,
    tenons,
    box: minAreaRect(outline),
    minPerpendicularWidth: minPerp,
    uLo,
    uHi,
  };
}

/** Altitude d'une polyligne (u croissants) en u, `NaN` hors de son étendue. */
function polylineAt(line: readonly Vec2[], u: Mm): Mm {
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (u >= a.x - 1e-9 && u <= b.x + 1e-9) {
      return b.x - a.x > 1e-9 ? a.y + ((b.y - a.y) * (u - a.x)) / (b.x - a.x) : Math.max(a.y, b.y);
    }
  }
  return Number.NaN;
}

/**
 * Joue minimale : distance des sommets des mortaises aux rives (hors sol et extrémités),
 * **négative** si un sommet sort de la bande comprise entre les rives (mortaise débouchante :
 * dépassement d_h ou d_b saisi trop petit).
 */
export function minCheek(dev: StringerDevelopment): { value: Mm; label: Message } | null {
  let best: { value: Mm; label: Message } | null = null;
  for (const h of dev.housings) {
    for (const poly of h.polygons) {
      for (const p of poly) {
        const below = p.y < polylineAt(dev.lowerRive, p.x) - 1e-6;
        const above = p.y > polylineAt(dev.upperRive, p.x) + 1e-6;
        const sign = below || above ? -1 : 1;
        for (const riveLine of [dev.lowerRive, dev.upperRive]) {
          for (let i = 0; i + 1 < riveLine.length; i++) {
            const d = sign * pointSegmentDistance(p, riveLine[i]!, riveLine[i + 1]!);
            if (best === null || d < best.value) best = { value: d, label: h.label };
          }
        }
      }
    }
  }
  return best;
}

/** Bois minimal entre deux encastrements de marche successifs. */
export function minWoodBetween(dev: StringerDevelopment): { value: Mm; label: Message } | null {
  const rects = dev.housings
    .filter((h) => h.treadRect !== undefined && h.tread !== undefined)
    .sort((a, b) => a.tread! - b.tread!);
  let best: { value: Mm; label: Message } | null = null;
  for (let i = 0; i + 1 < rects.length; i++) {
    const a = rects[i]!;
    const b = rects[i + 1]!;
    if (b.tread! !== a.tread! + 1) continue;
    const d = polygonDistance(a.treadRect!, b.treadRect!);
    if (best === null || d < best.value)
      best = {
        value: d,
        label: msg("structure.common.housingPair", { first: a.label, second: b.label }),
      };
  }
  return best;
}

/** Vrai si tous les sommets des mortaises sont dans le contour (bord compris, à `tol` près). */
export function housingsInside(dev: StringerDevelopment, tol: Mm = 1e-3): boolean {
  return dev.housings.every((h) =>
    h.polygons.every((poly) =>
      poly.every((p) => pointInPolygon(p, dev.outline, tol) !== "outside"),
    ),
  );
}

export interface FlatOptions {
  readonly mirrored: boolean;
  readonly thickness: Mm;
  readonly depth: Mm;
  readonly mark: string;
  /** Description de la face de référence (`FlatPattern.reference.description`). */
  readonly referenceDescription: Message;
  /** Abscisses u des nez (traits de report) avec leur z. */
  readonly noses: readonly { u: Mm; z: Mm; index: number }[];
  /** Traits de joint aux extrémités (angle mural, poteau). */
  readonly joints: readonly { u: Mm; label: Message }[];
}

/** Changement de repère (u, z) → (x, y) du `FlatPattern`. */
export function flatTransform(dev: StringerDevelopment, mirrored: boolean): (p: Vec2) => Vec2 {
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const p of dev.outline) {
    uMin = Math.min(uMin, p.x);
    uMax = Math.max(uMax, p.x);
  }
  return mirrored ? (p) => V.vec(uMax - p.x, p.y) : (p) => V.vec(p.x - uMin, p.y);
}

/** Développé à plat (contour, mortaises, reports, repère). */
export function toFlatPattern(dev: StringerDevelopment, opts: FlatOptions): FlatPattern {
  const T = flatTransform(dev, opts.mirrored);
  const poly = (pts: readonly Vec2[]): Vec2[] => {
    const q = pts.map(T);
    return opts.mirrored ? q.reverse() : q;
  };
  const outer = poly(dev.outline);
  const lines: FlatPattern["lines"][number][] = [];
  // Mortaises.
  for (const h of dev.housings) {
    for (const pl of h.polygons) {
      const q = poly(pl);
      q.forEach((a, i) => {
        const b = q[(i + 1) % q.length]!;
        lines.push({
          kind: "mark",
          a,
          b,
          feature: "mortise",
          depth: opts.depth,
          ...(i === 0 ? { label: h.label } : {}),
        });
      });
    }
  }
  // Tenons : épaulement.
  for (const t of dev.tenons) {
    lines.push({
      kind: "mark",
      a: T(V.vec(t.u, t.zBottom)),
      b: T(V.vec(t.u, t.zTop)),
      feature: "tenon",
      label: msg("structure.common.flat.tenon"),
    });
  }
  // Ligne des nez.
  for (let i = 0; i + 1 < dev.pitchLine.length; i++) {
    lines.push({
      kind: "mark",
      a: T(dev.pitchLine[i]!),
      b: T(dev.pitchLine[i + 1]!),
      ...(i === 0 ? { label: msg("structure.common.flat.nosingLine") } : {}),
    });
  }
  // Traits de report des nez (aplomb, entre les rives).
  const riveAt = (line: readonly Vec2[], u: Mm): Mm => {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      if (u >= a.x - 1e-9 && u <= b.x + 1e-9) {
        return b.x - a.x > 1e-9 ? a.y + ((b.y - a.y) * (u - a.x)) / (b.x - a.x) : a.y;
      }
    }
    return Number.NaN;
  };
  for (const nose of opts.noses) {
    const lo = Math.max(riveAt(dev.lowerRive, nose.u), 0);
    const hi = riveAt(dev.upperRive, nose.u);
    if (!(hi > lo)) continue;
    lines.push({
      kind: "mark",
      a: T(V.vec(nose.u, lo)),
      b: T(V.vec(nose.u, hi)),
      // Repère du nez (non traduit).
      label: textMessage(`N${nose.index}`),
    });
  }
  for (const j of opts.joints) {
    const lo = Math.max(riveAt(dev.lowerRive, j.u), 0);
    const hi = riveAt(dev.upperRive, j.u);
    if (!(hi > lo)) continue;
    lines.push({ kind: "joint", a: T(V.vec(j.u, lo)), b: T(V.vec(j.u, hi)), label: j.label });
  }
  // Repère gravé, au milieu du limon, le long de la pente.
  const mid = (dev.uLo + dev.uHi) / 2;
  const yMid = (riveAt(dev.lowerRive, mid) + riveAt(dev.upperRive, mid)) / 2;
  const la = T(V.vec(mid - 20, yMid));
  const lb = T(V.vec(mid + 20, yMid));
  const [ta, tb] = opts.mirrored ? [lb, la] : [la, lb];
  lines.push({ kind: "text", a: ta, b: tb, label: textMessage(opts.mark) });
  return {
    outline: { outer, holes: [] },
    lines,
    thickness: opts.thickness,
    reference: { kind: "face", description: opts.referenceDescription },
  };
}

/** Aire du contour (mm²). */
export function developmentArea(dev: StringerDevelopment): number {
  return area(dev.outline);
}
