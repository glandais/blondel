/**
 * Chemins plans à arcs exacts, communs au SVG et au DXF.
 *
 * Un chemin est une suite de sommets ; chaque sommet porte le **renflement** (bulge DXF) du
 * tronçon qui part de lui : 0 = droite, tan(balayage / 4) = arc (positif = sens trigonométrique).
 * Les arcs restent exacts dans les deux formats (pas de discrétisation).
 */
import { reverseCurve, segEnd, segLength, segStart, vec2 } from "@blondel/core";
import type { Curve2, CurveSeg, Mm, Polygon2, Vec2 } from "@blondel/core";

export interface PathVertex {
  readonly x: Mm;
  readonly y: Mm;
  /** Renflement du tronçon vers le sommet suivant. */
  readonly bulge: number;
}

export interface PlanPath {
  readonly vertices: readonly PathVertex[];
  readonly closed: boolean;
}

/** Tolérance de fusion des sommets confondus (mm). */
const MERGE_TOL = 1e-6;

function segmentsToVertices(segments: readonly CurveSeg[]): PathVertex[] {
  const out: PathVertex[] = [];
  let last: Vec2 | undefined;
  for (const seg of segments) {
    if (segLength(seg) <= MERGE_TOL) continue; // pivots (rayon nul) et segments dégénérés
    const a = segStart(seg);
    const bulge = seg.kind === "arc" ? Math.tan(seg.sweep / 4) : 0;
    // Courbe discontinue (ne devrait pas arriver) : on relie par un tronçon droit.
    if (last !== undefined && vec2.distance(last, a) > MERGE_TOL) {
      out.push({ x: last.x, y: last.y, bulge: 0 });
    }
    out.push({ x: a.x, y: a.y, bulge });
    last = segEnd(seg);
  }
  if (last !== undefined) out.push({ x: last.x, y: last.y, bulge: 0 });
  return out;
}

/** Chemin ouvert suivant une courbe composée (arcs de balayage ≥ 360° découpés à l'export). */
export function curvePath(curve: Curve2): PlanPath {
  return { vertices: splitLargeArcs(segmentsToVertices(curve.segments), false), closed: false };
}

/** Chemin fermé d'un polygone (tous tronçons droits). */
export function polygonPath(poly: Polygon2): PlanPath {
  const vertices: PathVertex[] = [];
  for (const p of poly) {
    const prev = vertices[vertices.length - 1];
    if (prev !== undefined && vec2.distance(prev, p) <= MERGE_TOL) continue;
    vertices.push({ x: p.x, y: p.y, bulge: 0 });
  }
  const first = vertices[0];
  const lastV = vertices[vertices.length - 1];
  if (vertices.length > 1 && first && lastV && vec2.distance(first, lastV) <= MERGE_TOL) {
    vertices.pop();
  }
  return { vertices, closed: true };
}

/**
 * Contour fermé entre deux bords de même sens (jour puis mur parcouru à l'envers), fermé par
 * la ligne d'arrivée et la ligne de départ. Les arcs des bords sont conservés.
 */
export function bandContour(inner: Curve2, outer: Curve2): PlanPath {
  const a = segmentsToVertices(inner.segments);
  const b = segmentsToVertices(reverseCurve(outer).segments);
  const joined: PathVertex[] = [];
  for (const v of [...a, ...b]) {
    const prev = joined[joined.length - 1];
    if (prev !== undefined && vec2.distance(prev, v) <= MERGE_TOL) {
      // Sommet commun : on garde le renflement du tronçon sortant.
      joined[joined.length - 1] = { x: prev.x, y: prev.y, bulge: v.bulge };
      continue;
    }
    joined.push(v);
  }
  const first = joined[0];
  const lastV = joined[joined.length - 1];
  if (joined.length > 1 && first && lastV && vec2.distance(first, lastV) <= MERGE_TOL) {
    joined.pop();
  }
  return { vertices: splitLargeArcs(joined, true), closed: true };
}

/**
 * Découpe les tronçons en arc de balayage > 180° en deux (un renflement > 1 reste valide en
 * DXF, mais l'arc SVG a besoin d'un drapeau « grand arc » et un cercle complet est impossible).
 */
function splitLargeArcs(vertices: readonly PathVertex[], closed: boolean): PathVertex[] {
  const out: PathVertex[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const v = vertices[i]!;
    const next = vertices[(i + 1) % n];
    const hasNext = closed || i < n - 1;
    if (!hasNext || next === undefined || Math.abs(v.bulge) <= 1) {
      out.push(v);
      continue;
    }
    const sweep = 4 * Math.atan(v.bulge);
    const arc = arcFromBulge(v, next, v.bulge);
    const mid = {
      x: arc.center.x + arc.radius * Math.cos(arc.startAngle + sweep / 2),
      y: arc.center.y + arc.radius * Math.sin(arc.startAngle + sweep / 2),
    };
    const half = Math.tan(sweep / 8);
    out.push({ x: v.x, y: v.y, bulge: half }, { x: mid.x, y: mid.y, bulge: half });
  }
  return out;
}

/** Arc (centre, rayon, angle de départ, balayage) décrit par deux sommets et un renflement. */
export function arcFromBulge(
  a: Vec2,
  b: Vec2,
  bulge: number,
): { center: Vec2; radius: Mm; startAngle: number; sweep: number } {
  const sweep = 4 * Math.atan(bulge);
  const chord = vec2.distance(a, b);
  const radius = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  // Centre : milieu de corde + normale gauche × (distance signée du centre à la corde).
  const mid = vec2.lerp(a, b, 0.5);
  const u = vec2.normalize(vec2.sub(b, a));
  const h = chord / 2 / Math.tan(sweep / 2);
  const center = vec2.add(mid, vec2.scale(vec2.perpLeft(u), h));
  const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
  return { center, radius, startAngle, sweep };
}

/** Points de la polyligne (sommets seuls, sans discrétiser les arcs). */
export function pathPoints(path: PlanPath): Vec2[] {
  return path.vertices.map((v) => ({ x: v.x, y: v.y }));
}

/** Points extrêmes d'un chemin, arcs compris (échantillonnage des arcs à 16 pas). */
export function pathExtentPoints(path: PlanPath): Vec2[] {
  const pts: Vec2[] = [];
  const n = path.vertices.length;
  path.vertices.forEach((v, i) => {
    pts.push(v);
    const next = path.vertices[(i + 1) % n];
    if (v.bulge === 0 || next === undefined || (!path.closed && i === n - 1)) return;
    const arc = arcFromBulge(v, next, v.bulge);
    for (let k = 1; k < 16; k++) {
      const t = arc.startAngle + (arc.sweep * k) / 16;
      pts.push({
        x: arc.center.x + arc.radius * Math.cos(t),
        y: arc.center.y + arc.radius * Math.sin(t),
      });
    }
  });
  return pts;
}
