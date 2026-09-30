/**
 * Contrôle des solides dégénérés (dette D3) : une pièce dont le `SolidDesc` ne peut pas être
 * maillé correctement est signalée dans `Model.errors` au lieu de disparaître de l'aperçu 3D
 * sans message.
 *
 * - extrusion de profondeur nulle (ou non finie) ;
 * - surface réglée d'épaisseur nulle, ou dont une section (a, b, b + e·n, a + e·n) est plate,
 *   extrémités comprises (limon qui finit « en pointe ») ;
 * - balayage : moins de deux points distincts, demi-tour, onglets qui se croisent de façon
 *   irréductible (virage trop serré pour la section ou proche de 180°), parties éloignées du
 *   chemin qui se touchent (spires). Un pli local **réductible** n'est pas signalé : segment
 *   intermédiaire plus court que ses onglets entre deux virages rapprochés, dont la fusion des
 *   extrémités en son milieu résout le croisement (artefact de discrétisation d'un cintrage,
 *   quelques millimètres, rendu tel quel par `@blondel/geometry`).
 *
 * Les critères des balayages sont **sûrs** (aucune fausse alarme) : ils portent sur le disque
 * inscrit dans la section autour de l'axe (rayon r_in, 0 si l'axe est hors matière : seul le
 * demi-tour est alors vu). Aucun seuil métier, aucune limite d'angle : constats géométriques
 * seulement. `@blondel/geometry` maille quand même un balayage auto-intersecté (replié) et refuse
 * les autres cas (message de maillage).
 */
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import type { Part, SolidDesc } from "../model/derived.js";
import type { Shape2, Vec2, Vec3 } from "../model/primitives.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";

const cache = new WeakMap<SolidDesc, Message | null>();

/** Au-delà (garde-fou de `@blondel/geometry`), la recherche de contact est omise. */
const MAX_CONTACT_POINTS = 10_000;

/**
 * Clés des balayages auto-intersectés : maillés quand même par `@blondel/geometry` (replié), à
 * la différence des autres problèmes (pièce non maillée).
 */
const SELF_INTERSECTION_KEYS: readonly MessageKey[] = [
  "part.solid.sweepSelfIntersectingEnd",
  "part.solid.sweepSelfIntersecting",
  "part.solid.sweepSegmentsTouch",
];

/** Vrai si le problème est un balayage auto-intersecté (maillé replié sur lui-même). */
export function isSelfIntersection(problem: Message): boolean {
  return SELF_INTERSECTION_KEYS.includes(problem.key);
}

/** Problème du solide, ou `undefined` s'il est maillable. Mémoïsé par identité. */
export function solidProblem(desc: SolidDesc): Message | undefined {
  const hit = cache.get(desc);
  if (hit !== undefined) return hit ?? undefined;
  const problem = computeProblem(desc);
  cache.set(desc, problem ?? null);
  return problem;
}

/** Messages lisibles des pièces dont le solide est dégénéré (ordre des pièces). */
export function checkSolids(parts: readonly Part[]): Message[] {
  const out: Message[] = [];
  for (const part of parts) {
    const problem = solidProblem(part.solid);
    if (problem !== undefined) {
      // Balayage auto-intersecté : maillé tel quel (replié) ; autres cas : non maillés.
      const effect = msg(
        part.solid.kind === "sweep" && isSelfIntersection(problem)
          ? "part.solid.effectFolded"
          : "part.solid.effectMissing",
      );
      out.push(msg("part.solid.problem", { mark: part.mark, name: part.name, problem, effect }));
    }
  }
  return out;
}

function computeProblem(desc: SolidDesc): Message | undefined {
  switch (desc.kind) {
    case "extrusion":
      return Number.isFinite(desc.depth) && Math.abs(desc.depth) > 1e-9
        ? undefined
        : msg("part.solid.extrusionZeroDepth");
    case "ruled":
      return ruledProblem(desc.a, desc.b, desc.thickness, desc.normals);
    case "sweep":
      return sweepProblem(desc.path, desc.section);
  }
}

// ------------------------------------------------------------------ vecteurs 3D

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

// ------------------------------------------------------------------ surface réglée

function ruledProblem(
  a: readonly Vec3[],
  b: readonly Vec3[],
  thickness: number,
  normals: readonly Vec2[],
): Message | undefined {
  if (a.length < 2 || b.length !== a.length || normals.length !== a.length) {
    return msg("part.solid.ruledInconsistent");
  }
  if (!(Number.isFinite(thickness) && Math.abs(thickness) > 1e-9)) {
    return msg("part.solid.ruledZeroThickness");
  }
  for (let i = 0; i < a.length; i++) {
    const n = normals[i]!;
    const l = Math.hypot(n.x, n.y);
    if (!(l > 0 && Number.isFinite(l))) {
      return msg("part.solid.ruledZeroNormal", { point: String(i + 1) });
    }
    const ab = sub(b[i]!, a[i]!);
    const off: Vec3 = { x: (n.x / l) * thickness, y: (n.y / l) * thickness, z: 0 };
    const lab = norm(ab);
    if (lab <= GEOM_EPS || norm(cross(ab, off)) <= 1e-9 * lab * Math.abs(thickness)) {
      return i === 0 || i === a.length - 1
        ? msg("part.solid.ruledFlatSectionEnd")
        : msg("part.solid.ruledFlatSection", { point: String(i + 1) });
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ balayage

/** Rayon du disque centré sur l'axe inscrit dans la section (0 si l'axe est hors matière). */
function inradius(section: Shape2): number {
  const inside = (ring: readonly Vec2[]): boolean => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[i]!;
      const q = ring[j]!;
      if (p.y > 0 !== q.y > 0 && 0 < ((q.x - p.x) * (0 - p.y)) / (q.y - p.y) + p.x) c = !c;
    }
    return c;
  };
  if (!inside(section.outer) || section.holes.some(inside)) return 0;
  let r = Infinity;
  for (const ring of [section.outer, ...section.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, -(p.x * dx + p.y * dy) / l2)) : 0;
      r = Math.min(r, Math.hypot(p.x + t * dx, p.y + t * dy));
    }
  }
  return Number.isFinite(r) ? r : 0;
}

/** Distance entre les segments [p1, q1] et [p2, q2] (3D). */
function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  const c = dot(d1, r);
  const b = dot(d1, d2);
  const den = a * e - b * b;
  s = den > 1e-12 * a * e ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = Math.max(0, Math.min(1, -c / a));
  } else if (t > 1) {
    t = 1;
    s = Math.max(0, Math.min(1, (b - c) / a));
  }
  return norm(sub(add(p1, scale(d1, s)), add(p2, scale(d2, t))));
}

/** Coordonnées arrondies au millimètre d'un point (paramètres x, y, z des messages). */
function pointParams(p: Vec3): { x: string; y: string; z: string } {
  return { x: String(Math.round(p.x)), y: String(Math.round(p.y)), z: String(Math.round(p.z)) };
}

function sweepProblem(pathIn: readonly Vec3[], section: Shape2): Message | undefined {
  const path: Vec3[] = [];
  for (const p of pathIn) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      return msg("part.solid.sweepNonFinite");
    }
    const last = path[path.length - 1];
    if (!last || norm(sub(p, last)) > GEOM_EPS) path.push(p);
  }
  if (path.length < 2) return msg("part.solid.sweepTooFewPoints");
  const r = inradius(section);
  // Plis locaux : un segment plus court que ses onglets (virages rapprochés) est fusionné en
  // son milieu tant que la fusion résout le croisement ; il ne reste que les plis irréductibles.
  for (let guard = path.length; guard > 0; guard--) {
    const k = crossedSegment(path, r);
    if (k === undefined) break;
    if (k < 0) return msg("part.solid.sweepUTurn", { point: String(-k) });
    const P = path[k]!;
    const W = k === 0 ? path[1]! : P; // sommet du virage (intérieur au chemin)
    if (k === 0 || k === path.length - 2) {
      return msg("part.solid.sweepSelfIntersectingEnd", pointParams(W));
    }
    const merged = scale(add(P, path[k + 1]!), 0.5);
    path.splice(k, 2, merged);
    // La fusion doit **résoudre** le croisement : les segments qui touchent le point fusionné
    // (k − 1 et k) ne se croisent plus. Sinon le virage est irréductible (épingle au milieu du
    // chemin, dont les fusions successives effaceraient la trace : faux négatif).
    const again = crossedSegment(path, r, [k - 1, k]);
    if (again !== undefined) {
      return msg("part.solid.sweepSelfIntersecting", pointParams(merged));
    }
  }
  const m = path.length;
  const L: number[] = [];
  for (let k = 0; k + 1 < m; k++) L.push(norm(sub(path[k + 1]!, path[k]!)));
  // Contact entre parties éloignées (spires) : distance d'axe < 2·r_in entre deux segments
  // séparés, le long du chemin, de plus de π·r_in (en deçà, voisinage d'un même virage).
  if (r > 0 && m <= MAX_CONTACT_POINTS) {
    const hit = contact(path, L, r);
    if (hit) {
      return msg("part.solid.sweepSegmentsTouch", {
        a: String(hit[0] + 1),
        b: String(hit[1] + 1),
      });
    }
  }
  return undefined;
}

/**
 * Premier segment dont les coupes d'onglet se croisent pour le disque inscrit |w| ≤ r :
 * t_fin − t_début = L − w·(M1 / (T·M1) − M0 / (T·M0)), minimum L − r·|projection| sur le plan
 * normal (M : tangente moyenne au sommet, tangente aux extrémités). `undefined` : aucun ;
 * négatif (−k) : demi-tour au point k. `only` : segments examinés (défaut : tous).
 */
function crossedSegment(
  path: readonly Vec3[],
  r: number,
  only?: readonly number[],
): number | undefined {
  const m = path.length;
  const T: Vec3[] = [];
  const L: number[] = [];
  for (let k = 0; k + 1 < m; k++) {
    const d = sub(path[k + 1]!, path[k]!);
    L.push(norm(d));
    T.push(unit(d));
  }
  for (let k = 1; k < T.length; k++) {
    if (dot(T[k - 1]!, T[k]!) < -1 + 1e-9) return -(k + 1);
  }
  const M = (k: number): Vec3 =>
    k === 0 ? T[0]! : k === m - 1 ? T[m - 2]! : unit(add(T[k - 1]!, T[k]!));
  for (let k = 0; k < T.length; k++) {
    if (only && !only.includes(k)) continue;
    const t = T[k]!;
    const m0 = M(k);
    const m1 = M(k + 1);
    const g = sub(scale(m1, 1 / dot(t, m1)), scale(m0, 1 / dot(t, m0)));
    const gp = norm(sub(g, scale(t, dot(g, t))));
    if (!(L[k]! - r * gp > GEOM_EPS)) return k;
  }
  return undefined;
}

/**
 * Première paire de segments (a, b), b ≥ a + 2, séparés le long du chemin de plus de π·r et
 * dont les axes sont à moins de 2·r. Candidats par grille régulière : chaque segment est inscrit
 * dans les cellules de sa boîte élargie de r (cellule = max(2·r, longueur médiane des
 * segments) ; un segment qui couvrirait plus de 64 cellules est confronté à tous).
 */
function contact(path: readonly Vec3[], L: readonly number[], r: number): [number, number] | null {
  const n = L.length;
  const s: number[] = [0];
  for (const l of L) s.push(s[s.length - 1]! + l);
  const sorted = [...L].sort((x, y) => x - y);
  const cell = Math.max(2 * r, sorted[Math.floor(n / 2)]!);
  const grid = new Map<number, number[]>();
  const big: number[] = [];
  const cellsOf: number[][] = [];
  const hash = (i: number, j: number, k: number): number =>
    ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) | 0;
  for (let q = 0; q < n; q++) {
    const p0 = path[q]!;
    const p1 = path[q + 1]!;
    const i0 = Math.floor((Math.min(p0.x, p1.x) - r) / cell);
    const i1 = Math.floor((Math.max(p0.x, p1.x) + r) / cell);
    const j0 = Math.floor((Math.min(p0.y, p1.y) - r) / cell);
    const j1 = Math.floor((Math.max(p0.y, p1.y) + r) / cell);
    const k0 = Math.floor((Math.min(p0.z, p1.z) - r) / cell);
    const k1 = Math.floor((Math.max(p0.z, p1.z) + r) / cell);
    const cells: number[] = [];
    if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > 64) {
      big.push(q);
    } else {
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++)
          for (let k = k0; k <= k1; k++) {
            const h = hash(i, j, k);
            cells.push(h);
            const list = grid.get(h);
            if (list) list.push(q);
            else grid.set(h, [q]);
          }
    }
    cellsOf.push(cells);
  }
  const seen = new Int32Array(n).fill(-1);
  const test = (a: number, b: number): boolean => {
    const [x, y] = a < b ? [a, b] : [b, a];
    if (y < x + 2 || s[y]! - s[x + 1]! < Math.PI * r) return false;
    return segmentDistance(path[x]!, path[x + 1]!, path[y]!, path[y + 1]!) < 2 * r - GEOM_EPS;
  };
  for (let a = 0; a < n; a++) {
    for (const h of cellsOf[a]!) {
      for (const b of grid.get(h)!) {
        if (b <= a || seen[b] === a) continue;
        seen[b] = a;
        if (test(a, b)) return [a, b];
      }
    }
  }
  for (const a of big)
    for (let b = 0; b < n; b++) if (b !== a && test(a, b)) return a < b ? [a, b] : [b, a];
  return null;
}
