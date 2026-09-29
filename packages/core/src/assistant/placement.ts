/**
 * Calage d'un escalier à volées sur la trémie (CHALLENGE G8) et emprise hors tout (A3).
 *
 * - **Arrivée au bord de trémie** : la ligne d'arrivée (nez d'arrivée, bord extérieur de la
 *   dernière volée) est posée sur un côté de la trémie, la montée sortant de la trémie par ce
 *   côté (le plancher haut commence au-delà du côté).
 * - **Emprise dans la trémie ou le long des murs** : la largeur hors tout de la dernière volée
 *   (E + épaisseurs de l'intention de structure côté jour et côté extérieur) doit tenir sur ce
 *   côté ; elle est calée à l'une ou l'autre extrémité du côté, centrée, ou au nu d'un mur
 *   perpendiculaire au côté.
 * - **Emprise hors tout** en repère local : un rectangle par volée (E + épaisseurs, longueur de
 *   la volée) et le carré de chaque poteau d'angle — reconstruits comme `computeLayout`.
 */
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Model } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { FlightsLayoutSpec, Wall } from "../model/project.js";

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

/** Arrivée d'un tracé à volées, repère local. */
export interface ArrivalFrame {
  /** Point de Γ sur la ligne d'arrivée. */
  readonly walkPoint: Vec2;
  /** Direction de montée à l'arrivée (unitaire). */
  readonly dir: Vec2;
  /** Extrémités hors tout de la ligne d'arrivée (jour − épaisseur, extérieur + épaisseur). */
  readonly grossInner: Vec2;
  readonly grossOuter: Vec2;
}

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
    const h = turn.inner.size / 2;
    const at = (a: number, b: number): Vec2 => V.add(V.addScaled(k, leg.n, a), V.scale(leg.u, b));
    pieces.push([at(-h, -h), at(h, -h), at(h, h), at(-h, h)]);
  });
  return pieces;
}

/** Placement d'un escalier (repère du site) et description du calage. */
export interface Placement {
  readonly origin: Vec2;
  /** Degrés. */
  readonly rotation: number;
  /** Description française du calage. */
  readonly fit: string;
  /** Clé de calage (côté, alignement) stable d'un giron à l'autre. */
  readonly key: string;
}

/** Côté de trémie trop court pour la largeur hors tout (diagnostic). */
export interface PlacementMisfit {
  readonly needed: Mm;
  readonly available: Mm;
}

const snap = (v: number): number => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v);

/** Nom d'un côté de trémie d'après sa normale sortante. */
function edgeName(normal: Vec2, index: number): string {
  const eps = 1e-9;
  if (Math.abs(normal.x + 1) < eps) return "côté x min";
  if (Math.abs(normal.x - 1) < eps) return "côté x max";
  if (Math.abs(normal.y + 1) < eps) return "côté y min";
  if (Math.abs(normal.y - 1) < eps) return "côté y max";
  return `côté ${index + 1}`;
}

/**
 * Placements qui posent l'arrivée sur un côté de la trémie (polygone CCW) avec la largeur hors
 * tout contenue dans ce côté. `misfit` : plus grand côté essayé quand aucun ne convient.
 */
export function arrivalPlacements(
  frame: ArrivalFrame,
  opening: Polygon2,
  walls: readonly Wall[],
  tol: Mm,
): { readonly placements: Placement[]; readonly misfit: PlacementMisfit | null } {
  const placements: Placement[] = [];
  const seen = new Set<string>();
  let misfit: PlacementMisfit | null = null;
  const m = opening.length;
  for (let i = 0; i < m; i++) {
    const a = opening[i]!;
    const b = opening[(i + 1) % m]!;
    const len = V.distance(a, b);
    if (!(len > tol)) continue;
    const u = V.scale(V.sub(b, a), 1 / len);
    const out = V.perpRight(u);
    let deg = ((V.angleOf(out) - V.angleOf(frame.dir)) * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    const q = Math.round(deg / 90) * 90;
    if (Math.abs(deg - q) < 1e-7) deg = q % 360;
    const theta = (deg * Math.PI) / 180;
    const gi = V.rotate(frame.grossInner, theta);
    const go = V.rotate(frame.grossOuter, theta);
    const c1 = V.dot(gi, u);
    const c2 = V.dot(go, u);
    const lo = Math.min(c1, c2);
    const w = Math.abs(c2 - c1);
    if (w > len + tol) {
      if (misfit === null || len > misfit.available) misfit = { needed: w, available: len };
      continue;
    }
    const on = -V.dot(V.rotate(frame.walkPoint, theta), out);
    const name = edgeName(out, i);
    // Au nu d'un mur d'abord : à position égale, le libellé du mur l'emporte (dédoublonnage).
    const targets: { lo: number; label: string; key: string }[] = [];
    for (const wall of walls) {
      const wd = V.sub(wall.b, wall.a);
      const wl = V.norm(wd);
      if (!(wl > 0) || Math.abs(V.cross(V.scale(wd, 1 / wl), out)) > 1e-6) continue;
      const c = V.dot(V.sub(wall.a, a), u);
      const half = wall.thickness / 2;
      targets.push({ lo: c + half, label: `au nu du mur ${wall.id}`, key: `wall-${wall.id}+` });
      targets.push({ lo: c - half - w, label: `au nu du mur ${wall.id}`, key: `wall-${wall.id}-` });
    }
    targets.push(
      { lo: 0, label: "calé au début du côté", key: "start" },
      { lo: len - w, label: "calé à la fin du côté", key: "end" },
      { lo: Math.floor((len - w) / 2), label: "centré", key: "center" },
    );
    for (const t of targets) {
      if (t.lo < -tol || t.lo + w > len + tol) continue;
      const ou = t.lo - lo;
      const origin = V.add(a, V.add(V.scale(u, ou), V.scale(out, on)));
      const o = { x: snap(origin.x), y: snap(origin.y) };
      const id = `${o.x.toFixed(3)}|${o.y.toFixed(3)}|${deg}`;
      if (seen.has(id)) continue;
      seen.add(id);
      placements.push({
        origin: o,
        rotation: deg,
        fit: `arrivée sur le ${name} de la trémie, ${t.label}`,
        key: `${i}:${t.key}`,
      });
    }
  }
  return { placements, misfit };
}

/** Point du repère local placé dans le site. */
export function toWorld(p: Vec2, placement: { origin: Vec2; rotation: number }): Vec2 {
  return V.add(V.rotate(p, (placement.rotation * Math.PI) / 180), placement.origin);
}

/** Rectangle d'un mur (axe `a`–`b`, épaisseur totale). */
export function wallPolygon(wall: Wall): Polygon2 {
  const d = V.sub(wall.b, wall.a);
  const l = V.norm(d);
  const nrm = l > 0 ? V.scale(V.perpLeft(d), wall.thickness / 2 / l) : V.vec(wall.thickness / 2, 0);
  return [V.add(wall.a, nrm), V.add(wall.b, nrm), V.sub(wall.b, nrm), V.sub(wall.a, nrm)];
}

function project1(poly: Polygon2, axis: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = V.dot(p, axis);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/**
 * Deux polygones **convexes** se recouvrent-ils de plus de `tol` (théorème de l'axe
 * séparateur) ? Un contact au nu (recouvrement ≤ tol) n'est pas une collision.
 */
export function convexOverlap(a: Polygon2, b: Polygon2, tol: Mm): boolean {
  for (const poly of [a, b]) {
    const m = poly.length;
    for (let i = 0; i < m; i++) {
      const e = V.sub(poly[(i + 1) % m]!, poly[i]!);
      const l = V.norm(e);
      if (!(l > 0)) continue;
      const axis = V.scale(V.perpLeft(e), 1 / l);
      const [a0, a1] = project1(a, axis);
      const [b0, b1] = project1(b, axis);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
    }
  }
  return true;
}

/** Un disque recouvre-t-il un polygone convexe de plus de `tol` ? */
export function discOverlap(center: Vec2, radius: Mm, poly: Polygon2, tol: Mm): boolean {
  if (pointInPolygon(center, poly, 0) === "inside") return true;
  const m = poly.length;
  for (let i = 0; i < m; i++) {
    const a = poly[i]!;
    const ab = V.sub(poly[(i + 1) % m]!, a);
    const l2 = V.normSq(ab);
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, V.dot(V.sub(center, a), ab) / l2));
    if (V.distance(center, V.addScaled(a, ab, t)) < radius - tol) return true;
  }
  return false;
}

/** Premier mur heurté par l'emprise hors tout (pièces en repère du site), ou `null`. */
export function wallCollision(
  pieces: readonly Polygon2[],
  walls: readonly Wall[],
  tol: Mm,
): Wall | null {
  for (const wall of walls) {
    const wp = wallPolygon(wall);
    if (pieces.some((p) => convexOverlap(p, wp, tol))) return wall;
  }
  return null;
}

/**
 * Dalle haute : toute marche dont le dessus dépasse la sous-face de la dalle (z > H − ep) doit
 * être dans la trémie en plan — surface de marche visible et extrémités hors tout de ses lignes
 * de nez. Le débord de la pièce (`outline`) n'est pas contrôlé : la dernière marche passe
 * légitimement de son débord sous la contremarche d'arrivée, contre le chevêtre. Rend le
 * numéro de la première marche fautive, ou `null`.
 */
export function slabIntrusion(
  model: Model,
  opening: Polygon2,
  ceiling: Mm,
  innerThickness: Mm,
  outerThickness: Mm,
  tol: Mm,
): number | null {
  const inside = (p: Vec2): boolean => pointInPolygon(p, opening, tol) !== "outside";
  for (const tread of model.stepping.treads) {
    if (!(tread.z > ceiling + 1e-6)) continue;
    if (!tread.walkingSurface.every(inside)) return tread.number;
  }
  for (const nosing of model.stepping.nosings) {
    if (!(nosing.z > ceiling + 1e-6)) continue;
    const gi = V.addScaled(nosing.q, nosing.dir, -innerThickness);
    const go = V.addScaled(nosing.r, nosing.dir, outerThickness);
    // Le nez k porte le dessus de la marche k + 1.
    if (!inside(gi) || !inside(go)) return nosing.index + 1;
  }
  return null;
}
