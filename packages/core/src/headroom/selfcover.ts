/**
 * Échappée avec **auto-recouvrement** (jalon 5a, CHALLENGE G4) : plafonds = dalle haute hors
 * trémie (s'il y a une trémie) + sous-faces de l'escalier lui-même (`Stepping.soffits` : marches
 * du tour supérieur et palier d'arrivée d'un hélicoïdal).
 *
 * Convention (décision Q4) : échappée **verticale** au-dessus de la ligne de pente sur Γ ; sur
 * la largeur, au-dessus du nez (altitude z_k) le long de chaque segment de nez Q_k R_k.
 *
 * Une sous-face ne compte au-dessus d'un point de Γ d'abscisse s que si la pièce commence plus
 * loin dans la montée (`sStart > s`) et couvre le point en plan : la marche sur laquelle on se
 * tient et les précédentes (dont le débord de nez de la marche inférieure) sont exclues, les
 * marches d'un tour plus haut comptent. Une collision (sous-face plus basse que la ligne de pente)
 * donne une échappée négative, jamais ignorée.
 *
 * Calcul exact : Γ est coupée aux côtés de la trémie, aux côtés des contours des sous-faces
 * (intersections analytiques droite / arc) et aux abscisses `sStart` ; sur chaque morceau le
 * plafond est constant et la ligne de pente croissante : le minimum est atteint à la borne haute
 * (limite à gauche). Même découpage des segments de nez (les contours des sous-faces sont des
 * polygones : arcs discrétisés à 0,1 mm de flèche, côtés rayonnants exacts).
 */
import { cumulativeLengths, curveLength, curvePointAt } from "../geom2d/curve.js";
import { intersectLineCurve, segmentIntersect } from "../geom2d/intersect.js";
import { bbox, pointInPolygon, type BBox } from "../geom2d/polygon.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { HeadroomOnWidth, Layout, Soffit, Stepping } from "../model/derived.js";
import type { Curve2, Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { HeadroomAnalysis, HeadroomOnWalkline } from "./headroom.js";
import { slopeProfileOf, slopeZ } from "./profile.js";

export interface SelfCoverInput {
  readonly layout: Layout;
  readonly stepping: Stepping;
  readonly soffits: readonly Soffit[];
  /** Dalle haute (trémie et altitude de sa sous-face) ; `null` sans trémie. */
  readonly slab: { readonly opening: Polygon2; readonly ceiling: Mm } | null;
  /** Altitude de la sous-face de la dalle (rapportée même sans trémie). */
  readonly ceiling: Mm;
  /** Intervalles de Γ sous la dalle (vide sans trémie). */
  readonly covered: readonly { readonly s0: Mm; readonly s1: Mm }[];
}

interface Ceiling {
  readonly outline: Polygon2;
  readonly box: BBox;
  readonly z: Mm;
  readonly sStart: Mm;
}

const inBox = (p: Vec2, b: BBox): boolean =>
  p.x >= b.min.x - GEOM_EPS &&
  p.x <= b.max.x + GEOM_EPS &&
  p.y >= b.min.y - GEOM_EPS &&
  p.y <= b.max.y + GEOM_EPS;

/** Côtés d'un polygone fermé. */
function edgesOf(poly: Polygon2): [Vec2, Vec2][] {
  return poly.map((a, i) => [a, poly[(i + 1) % poly.length]!]);
}

/** Abscisses des intersections de Γ avec les côtés d'un polygone. */
function crossings(curve: Curve2, poly: Polygon2): Mm[] {
  const out: Mm[] = [];
  for (const [a, b] of edgesOf(poly)) {
    const dir = V.sub(b, a);
    const len = V.norm(dir);
    if (!(len > GEOM_EPS)) continue;
    const tol = GEOM_EPS / len;
    for (const hit of intersectLineCurve({ origin: a, dir }, curve)) {
      if (hit.t >= -tol && hit.t <= 1 + tol) out.push(hit.s);
    }
  }
  return out;
}

/**
 * Plafond le plus bas au-dessus du point `p` pour une pièce de référence d'abscisse `s` :
 * dalle (hors trémie) et sous-faces des pièces commençant après `s` qui couvrent `p` (bord de
 * la sous-face compris, du côté de la sécurité). `null` : aucun plafond.
 */
function ceilingAt(
  p: Vec2,
  s: Mm,
  slab: SelfCoverInput["slab"],
  ceilings: readonly Ceiling[],
): Mm | null {
  let best: Mm | null = null;
  if (slab && pointInPolygon(p, slab.opening) === "outside") best = slab.ceiling;
  for (const c of ceilings) {
    if (!(c.sStart > s + GEOM_EPS) || (best !== null && c.z >= best)) continue;
    if (!inBox(p, c.box)) continue;
    // Bord compris : sans débord de nez et avec N entier, la ligne de nez k est portée par le
    // bord arrière de la marche du tour supérieur (sinon plafond manqué sur la largeur).
    if (pointInPolygon(p, c.outline) !== "outside") best = c.z;
  }
  return best;
}

/** Échappée sur Γ avec auto-recouvrement. */
function walklineHeadroom(input: SelfCoverInput, ceilings: readonly Ceiling[]) {
  const curve = input.layout.walkline;
  const L = curveLength(curve);
  if (!(L > 0)) return undefined;
  const profile = slopeProfileOf(input.stepping);
  const cuts: Mm[] = [0, L, ...cumulativeLengths(curve)];
  if (input.slab) cuts.push(...crossings(curve, input.slab.opening));
  for (const c of ceilings) {
    cuts.push(...crossings(curve, c.outline));
    cuts.push(c.sStart);
  }
  const sorted = cuts.filter((s) => s >= 0 && s <= L).sort((x, y) => x - y);
  let best: HeadroomOnWalkline | undefined;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const s0 = sorted[i]!;
    const s1 = sorted[i + 1]!;
    if (!(s1 - s0 > GEOM_EPS)) continue;
    const mid = (s0 + s1) / 2;
    const top = ceilingAt(curvePointAt(curve, mid), mid, input.slab, ceilings);
    if (top === null) continue;
    // Borne haute : limite à gauche de la ligne de pente (croissante sur le morceau).
    const z = slopeZ(profile, s1, "left");
    const min = top - z;
    if (best === undefined || min < best.min) {
      const p = curvePointAt(curve, s1);
      best = { min, at: { x: p.x, y: p.y, z }, s: s1 };
    }
  }
  return best;
}

/** Échappée sur la largeur des marches (segments de nez) avec auto-recouvrement. */
function widthHeadroom(
  input: SelfCoverInput,
  ceilings: readonly Ceiling[],
): HeadroomOnWidth | undefined {
  let best: HeadroomOnWidth | undefined;
  for (const nosing of input.stepping.nosings) {
    const { q, r } = nosing;
    const length = V.distance(q, r);
    if (!(length > GEOM_EPS)) continue;
    const above = ceilings.filter((c) => c.sStart > nosing.s + GEOM_EPS);
    const cuts: number[] = [0, 1];
    const polys = input.slab
      ? [input.slab.opening, ...above.map((c) => c.outline)]
      : above.map((c) => c.outline);
    for (const poly of polys) {
      for (const [a, b] of edgesOf(poly)) {
        const hit = segmentIntersect(q, r, a, b);
        if (hit) cuts.push(hit.t);
      }
    }
    cuts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u0 = cuts[i]!;
      const u1 = cuts[i + 1]!;
      if (!((u1 - u0) * length > GEOM_EPS)) continue;
      const mid = V.lerp(q, r, (u0 + u1) / 2);
      const top = ceilingAt(mid, nosing.s, input.slab, above);
      if (top === null) continue;
      const min = top - nosing.z;
      if (best === undefined || min < best.min) {
        best = { min, at: { x: mid.x, y: mid.y, z: nosing.z }, nosing: nosing.index };
      }
    }
  }
  return best;
}

/**
 * Échappée au droit de chaque nez : plafond le plus bas au-dessus de P_k (dalle hors trémie,
 * sous-faces des pièces commençant après le nez qui le couvrent en plan, bord compris) moins
 * l'altitude z_k ; `null` si aucun plafond ne couvre P_k.
 */
function nosingsHeadroom(input: SelfCoverInput, ceilings: readonly Ceiling[]): (Mm | null)[] {
  return input.stepping.nosings.map((nosing) => {
    const top = ceilingAt(nosing.p, nosing.s, input.slab, ceilings);
    return top === null ? null : top - nosing.z;
  });
}

/** Analyse d'échappée avec les sous-faces de l'escalier (voir l'en-tête du module). */
export function selfCoveredHeadroom(input: SelfCoverInput): HeadroomAnalysis {
  const ceilings: Ceiling[] = input.soffits
    .filter((s) => s.outline.length >= 3)
    .map((s) => ({ outline: s.outline, box: bbox(s.outline), z: s.z, sStart: s.sStart }));
  const walkline = walklineHeadroom(input, ceilings);
  const width = widthHeadroom(input, ceilings);
  return {
    ceiling: input.ceiling,
    opening: input.slab?.opening ?? null,
    covered: input.covered,
    atNosings: nosingsHeadroom(input, ceilings),
    ...(walkline ? { walkline } : {}),
    ...(width ? { width } : {}),
  };
}
