/**
 * Descripteur de forme des pièces de garde-corps et comparaison « identiques à T près, à un
 * déplacement près » (chantier guard-marks, sous-lot G2a ; décisions G-Q2 et G-Q3).
 *
 * Familles :
 * - **prisme** (poteau PG, balustre BA) : section et hauteur ;
 * - **barre** (lisse LS, câble CA, main courante MC) : axe 3D **non décalé** (profil z(s) et tracé
 *   en plan), section ;
 * - **panneau** (PN) : bords bas et haut **non décalés** (bord bas z(s), hauteur h(s), tracé en
 *   plan), épaisseur ; jamais les faces facettées du solide (décalées selon les normales de
 *   segment, longueur dépendant du nombre de stations).
 *
 * Comparaison : clés égales (section ou épaisseur ; la nature et le matériau restent dans la clé
 * du regroupement), puis distance = plus petite, sur les déplacements admis, du plus grand de :
 * - **résidu de forme** : recalage par rotation autour de la verticale et translation (Kabsch 2D
 *   pondéré par Simpson sur la réunion des abscisses, centrées au milieu des pièces), écart
 *   maximal sur la réunion des échantillons et aux extrémités. Ce recalage n'est pas le meilleur
 *   au sens du maximum, il en majore l'écart : il peut séparer des pièces à peine sous T, jamais
 *   en réunir à tort ;
 * - **termes intrinsèques** : écart de longueur (en plan ; et développée pour une barre), de
 *   dénivelé (de chaque bord), et, pour un panneau, plus grand écart de hauteur h(s). Une cote qui
 *   diffère de δ donne ainsi un écart δ (sens de F10), là où le recalage seul rendrait δ / 2.
 *
 * Déplacements propres (G-Q3) : même sens ; lecture inversée (bout pour bout en plan) ; rotation
 * de 180° autour d'un axe horizontal (dans le plan d'un panneau plan, autour de l'axe radial d'un
 * panneau cintré : z opposé, lecture inversée, bords bas et haut échangés ; pour une barre, le
 * retournement bout pour bout) ; et leur composée. Modulo une rotation autour de la verticale
 * (absorbée par le recalage), ce sont les seuls. Le miroir est refusé ; une pièce plane (ou
 * cintrée de niveau) est sa propre image miroir à un déplacement près, l'exception « miroir
 * admis pour une pièce plane » vient donc d'elle-même.
 *
 * Arcs facettés : les bords sont mis en polyligne à `GUARD_EDGE_CHORD_TOL` (0,5 mm, sans lien avec T) ;
 * deux tronçons du même arc coupés à des endroits différents diffèrent en plan d'autant. Chaque
 * bord est donc reconstruit avant comparaison : sommets alignés en plan retirés (insensibilité au
 * nombre de stations), cordes intérieures de même longueur qu'une voisine = arc (angle = déviation
 * au sommet commun) si la flèche par corde est celle du facettage, bouts coupés ramenés sur le
 * cercle de la corde voisine, z lu à l'abscisse d'origine (cassures de pente et ressauts verticaux
 * échantillonnés exactement).
 *
 * Limites (constats CG12) : un tronçon droit de la longueur d'une corde d'arc voisine (à 10⁻³
 * près) est pris pour un arc ; une pièce de moins de trois cordes sur un arc n'est pas
 * reconstruite (l'écart de facettage, jusqu'à la flèche, reste entier). La distance n'est pas
 * transitive : un regroupement doit comparer à un représentant, pas enchaîner les paires.
 *
 * Fonctions pures, sans texte affiché ; elles ne lèvent pas (données dégénérées : distance finie
 * ou `Infinity`). Non exportées par `guards/index.ts`.
 */
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Mm, Vec3 } from "../model/primitives.js";
import { GUARD_EDGE_CHORD_TOL } from "./sides.js";
import { sectionLabel, type GuardSection } from "./spec.js";

/** Bord échantillonné (après reconstruction des arcs), origine au début du premier bord. */
export type GuardEdge = readonly Vec3[];

/** Descripteur de forme comparable d'une pièce de garde-corps. */
export type GuardShape =
  /** Poteau, balustre : section (clé) et hauteur. */
  | { readonly kind: "prism"; readonly key: string; readonly length: Mm }
  /** Lisse, câble, main courante : axe non décalé. */
  | { readonly kind: "bar"; readonly key: string; readonly edges: readonly [GuardEdge] }
  /** Panneau : bords bas et haut non décalés. */
  | {
      readonly kind: "panel";
      readonly key: string;
      readonly edges: readonly [GuardEdge, GuardEdge];
    };

/**
 * Déplacements : les quatre propres (`GUARD_MOVES`) et le miroir (refusé, pour les tests).
 * - `same` : (x, y, z) ;
 * - `turned` : (−x, −y, z), lecture inversée (rotation autour de la verticale) ;
 * - `flipped` : (−x, y, −z), lecture inversée, bords échangés (rotation de 180° autour d'un axe
 *   horizontal : dans le plan d'un panneau, autour de l'axe radial d'un panneau cintré) ;
 * - `turnedFlipped` : (x, −y, −z), bords échangés (composée des deux précédents) ;
 * - `mirror` : (x, −y, z).
 */
export type GuardMove = "same" | "turned" | "flipped" | "turnedFlipped" | "mirror";

/** Les quatre déplacements propres (miroir exclu, décision G-Q3). */
export const GUARD_MOVES: readonly GuardMove[] = ["same", "turned", "flipped", "turnedFlipped"];

// ------------------------------------------------------------------ constantes géométriques

/** Déviation (rad) sous laquelle un sommet est aligné en plan avec ses voisins (retiré). */
const ALIGNED_TURN = 1e-9;
/** Écart de pente (mm / mm) au-delà duquel un sommet est une cassure du profil z(s). */
const Z_KINK = 1e-9;
/**
 * Écart relatif de longueur sous lequel deux cordes voisines sont égales (même arc) : les cordes
 * du contour de trémie sont bruitées (± 0,01 mm sur 75 mm).
 */
const CHORD_REL = 1e-3;
/** Écart relatif de déviation admis au sommet d'un bout coupé (déviation bruitée ± 2·10⁻⁴ rad). */
const END_TURN_REL = 0.05;
/** Marge relative sur la flèche d'un arc facetté (déviations bruitées au sommet). */
const ARC_SAGITTA_REL = 0.05;
/** Échantillons par corde reconstruite. */
const SUBDIVISIONS = 8;
/** Longueur (mm) sous laquelle une corde ou une abscisse est nulle. */
const TINY = 1e-9;

// ------------------------------------------------------------------ constructeurs

/** Clé d'une section de barre ou de prisme : comme le début de la signature des repères. */
function sectionKey(section: GuardSection): string {
  return `${section.kind}${sectionLabel(section)}`;
}

/** Prisme vertical (poteau, balustre) : section et hauteur `depth`. */
export function prismShape(section: GuardSection, depth: Mm): GuardShape {
  return { kind: "prism", key: sectionKey(section), length: depth };
}

/** Barre (lisse, câble, main courante) balayée le long de l'axe non décalé `path`. */
export function barShape(path: readonly Vec3[], section: GuardSection): GuardShape {
  const [e] = toOrigin([reconstruct(path)]);
  return { kind: "bar", key: sectionKey(section), edges: [e!] };
}

/** Panneau d'épaisseur `thickness` entre ses bords non décalés `bottom` et `top`. */
export function panelShape(
  bottom: readonly Vec3[],
  top: readonly Vec3[],
  thickness: Mm,
): GuardShape {
  const [b, t] = toOrigin([reconstruct(bottom), reconstruct(top)]);
  return { kind: "panel", key: String(thickness), edges: [b!, t!] };
}

/** Translation : origine au premier point du premier bord (conditionnement numérique). */
function toOrigin(edges: readonly (readonly Vec3[])[]): Vec3[][] {
  const o = edges[0]?.[0] ?? { x: 0, y: 0, z: 0 };
  return edges.map((e) => e.map((p) => ({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z })));
}

// ------------------------------------------------------------------ comparaison

/**
 * Distance de forme (mm) : plus petite, sur les déplacements `moves`, de l'écart de forme et des
 * écarts intrinsèques. `Infinity` si les familles ou les clés diffèrent.
 */
export function guardShapeDistance(
  a: GuardShape,
  b: GuardShape,
  moves: readonly GuardMove[] = GUARD_MOVES,
): number {
  if (a.kind !== b.kind || a.key !== b.key) return Infinity;
  if (a.kind === "prism" || b.kind === "prism") {
    return a.kind === "prism" && b.kind === "prism" ? Math.abs(a.length - b.length) : Infinity;
  }
  const panel = a.kind === "panel";
  let best = Infinity;
  for (const m of moves) {
    const B = moved(b.edges, m, panel);
    const d = Math.max(residual(a.edges, B, panel), intrinsic(a.edges, B, panel));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Pièces identiques à `tol` près (et `GEOM_EPS`, comme `groupIdenticalFlats`) : même résultat
 * que `guardShapeDistance(a, b) <= tol + GEOM_EPS` (min sur les déplacements de max(résidu,
 * intrinsèque) ≤ lim ⇔ un déplacement a ses deux termes ≤ lim), calculé au plus court (G2b,
 * regroupement des repères recalculé à chaque saisie) :
 * 1. minorant sans déplacement : l'écart de longueur en plan du premier bord (terme d'`intrinsic`)
 *    ne dépend du déplacement que par l'échange des bords ; s'il dépasse lim pour chaque bord
 *    candidat, aucun déplacement ne convient ;
 * 2. par déplacement, les termes intrinsèques (linéaires) d'abord, le résidu (recalage) ensuite ;
 *    arrêt au premier déplacement accepté.
 */
export function sameGuardShape(a: GuardShape, b: GuardShape, tol: Mm): boolean {
  if (a.kind !== b.kind || a.key !== b.key) return false;
  const lim = tol + GEOM_EPS;
  if (a.kind === "prism" || b.kind === "prism") {
    return a.kind === "prism" && b.kind === "prism" && Math.abs(a.length - b.length) <= lim;
  }
  const panel = a.kind === "panel";
  // Minorant : marge relative (ordre de sommation inversé par la lecture à rebours), pour ne
  // jamais écarter un déplacement que le calcul complet accepterait.
  const La = planLength(a.edges[0]);
  if (La !== null) {
    const candidates = panel ? b.edges : [b.edges[0]];
    const slack = lim + 1e-9 * (1 + La);
    if (
      candidates.every((e) => {
        const Lb = planLength(e);
        return Lb !== null && Math.abs(La - Lb) > slack;
      })
    ) {
      return false;
    }
  }
  for (const m of GUARD_MOVES) {
    const B = moved(b.edges, m, panel);
    if (!(intrinsic(a.edges, B, panel) <= lim)) continue;
    if (residual(a.edges, B, panel) <= lim) return true;
  }
  return false;
}

/** Longueurs en plan des bords déjà mesurés (les descripteurs sont immuables). */
const planLengths = new WeakMap<GuardEdge, number>();

/** Longueur en plan d'un bord ; `null` pour un bord vide (pas de minorant). */
function planLength(e: GuardEdge): number | null {
  if (e.length === 0) return null;
  let L = planLengths.get(e);
  if (L === undefined) {
    L = last(abscissae(e, true));
    planLengths.set(e, L);
  }
  return L;
}

/** Bords déplacés (lecture éventuellement inversée, bords bas et haut échangés). */
function moved(edges: readonly GuardEdge[], m: GuardMove, panel: boolean): GuardEdge[] {
  const map = (f: (p: Vec3) => Vec3, reverse: boolean, swap: boolean): GuardEdge[] => {
    const es = edges.map((e) => {
      const x = e.map(f);
      return reverse ? x.reverse() : x;
    });
    return swap && panel ? [...es].reverse() : es;
  };
  switch (m) {
    case "same":
      return [...edges];
    case "turned":
      return map((p) => ({ x: -p.x, y: -p.y, z: p.z }), true, false);
    case "flipped":
      return map((p) => ({ x: -p.x, y: p.y, z: -p.z }), true, true);
    case "turnedFlipped":
      return map((p) => ({ x: p.x, y: -p.y, z: -p.z }), false, true);
    case "mirror":
      return map((p) => ({ x: p.x, y: -p.y, z: p.z }), false, false);
  }
}

// ------------------------------------------------------------------ abscisses et points

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Abscisses cumulées, en plan ou développées. */
function abscissae(e: readonly Vec3[], plan: boolean): number[] {
  const s = [0];
  for (let i = 1; i < e.length; i++) {
    const a = e[i - 1]!;
    const b = e[i]!;
    s.push(s[i - 1]! + (plan ? Math.hypot(b.x - a.x, b.y - a.y) : dist3(a, b)));
  }
  return s;
}

/**
 * Point à l'abscisse x (bornée aux extrémités), interpolation linéaire sur le premier segment
 * qui atteint x (recherche dichotomique : O(log n), la comparaison reste en O(n log n)). À un
 * ressaut vertical (abscisses égales), le point d'avant le ressaut.
 */
function pointAtS(e: readonly Vec3[], s: readonly number[], x: number): Vec3 {
  if (e.length === 0) return { x: 0, y: 0, z: 0 };
  if (x <= s[0]!) return e[0]!;
  if (x > last(s)) return last(e);
  // Plus petit i ≥ 1 tel que s[i] ≥ x.
  let lo = 1;
  let hi = e.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid]! >= x) hi = mid;
    else lo = mid + 1;
  }
  const i = lo;
  const h = s[i]! - s[i - 1]!;
  const t = h < TINY ? 0 : (x - s[i - 1]!) / h;
  const a = e[i - 1]!;
  const b = e[i]!;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
}

const last = <T>(xs: readonly T[]): T => xs[xs.length - 1]!;

/** Abscisses d'échantillonnage communes, centrées au milieu des pièces, dans [−L/2 ; L/2]. */
function commonAbscissae(
  sa: readonly (readonly number[])[],
  ca: number,
  sb: readonly (readonly number[])[],
  cb: number,
  half: number,
): number[] {
  const raw: number[] = [-half, half];
  for (const s of sa) for (const x of s) raw.push(x - ca);
  for (const s of sb) for (const x of s) raw.push(x - cb);
  const xs = raw.filter((x) => x >= -half - TINY && x <= half + TINY).sort((p, q) => p - q);
  const out: number[] = [];
  for (const x of xs) {
    const c = Math.min(half, Math.max(-half, x));
    if (out.length === 0 || c - last(out) > TINY) out.push(c);
  }
  return out;
}

/**
 * Résidu de forme : B recalé sur A par rotation autour de la verticale et translation (Kabsch 2D
 * en plan, translation en z), pondéré par Simpson sur la réunion des abscisses de tous les bords
 * (centrées au milieu de la pièce : lecture symétrique), puis écart maximal aux échantillons et
 * aux extrémités de chaque bord.
 */
function residual(A: readonly GuardEdge[], B: readonly GuardEdge[], panel: boolean): number {
  const sa = A.map((e) => abscissae(e, panel));
  const sb = B.map((e) => abscissae(e, panel));
  const La = last(sa[0]!);
  const Lb = last(sb[0]!);
  const half = Math.min(La, Lb) / 2;
  const xs = commonAbscissae(sa, La / 2, sb, Lb / 2, half);
  const ws: number[] = [];
  const pa: Vec3[] = [];
  const pb: Vec3[] = [];
  for (let k = 0; k < A.length; k++) {
    for (let i = 1; i < xs.length; i++) {
      const x0 = xs[i - 1]!;
      const x1 = xs[i]!;
      const h = x1 - x0;
      for (const [x, w] of [
        [x0, h / 6],
        [(x0 + x1) / 2, (4 * h) / 6],
        [x1, h / 6],
      ] as const) {
        ws.push(w);
        pa.push(pointAtS(A[k]!, sa[k]!, x + La / 2));
        pb.push(pointAtS(B[k]!, sb[k]!, x + Lb / 2));
      }
    }
  }
  const W = ws.reduce((p, q) => p + q, 0);
  const ca = { x: 0, y: 0, z: 0 };
  const cb = { x: 0, y: 0, z: 0 };
  if (W > 0) {
    ws.forEach((w, i) => {
      ca.x += w * pa[i]!.x;
      ca.y += w * pa[i]!.y;
      ca.z += w * pa[i]!.z;
      cb.x += w * pb[i]!.x;
      cb.y += w * pb[i]!.y;
      cb.z += w * pb[i]!.z;
    });
    for (const c of [ca, cb]) {
      c.x /= W;
      c.y /= W;
      c.z /= W;
    }
  } else {
    // Pièce sans longueur : recalage sur le premier point.
    Object.assign(ca, A[0]![0] ?? ca);
    Object.assign(cb, B[0]![0] ?? cb);
  }
  let sd = 0;
  let sc = 0;
  ws.forEach((w, i) => {
    const ax = pa[i]!.x - ca.x;
    const ay = pa[i]!.y - ca.y;
    const bx = pb[i]!.x - cb.x;
    const by = pb[i]!.y - cb.y;
    sd += w * (bx * ax + by * ay);
    sc += w * (bx * ay - by * ax);
  });
  const th = Math.atan2(sc, sd);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const T = (p: Vec3): Vec3 => {
    const x = p.x - cb.x;
    const y = p.y - cb.y;
    return { x: ca.x + c * x - s * y, y: ca.y + s * x + c * y, z: p.z - cb.z + ca.z };
  };
  let d = 0;
  for (let k = 0; k < A.length; k++) {
    const ea = A[k]!;
    const eb = B[k]!;
    for (const x of xs) {
      d = Math.max(d, dist3(pointAtS(ea, sa[k]!, x + La / 2), T(pointAtS(eb, sb[k]!, x + Lb / 2))));
    }
    if (ea.length > 0 && eb.length > 0) {
      d = Math.max(d, dist3(ea[0]!, T(eb[0]!)), dist3(last(ea), T(last(eb))));
    }
  }
  return d;
}

/**
 * Écarts intrinsèques : longueur en plan (et développée pour une barre), dénivelé de chaque bord,
 * et pour un panneau plus grand écart de hauteur h(s) = z haut − z bas.
 */
function intrinsic(A: readonly GuardEdge[], B: readonly GuardEdge[], panel: boolean): number {
  const a0 = A[0]!;
  const b0 = B[0]!;
  if (a0.length === 0 || b0.length === 0) return a0.length === b0.length ? 0 : Infinity;
  const sa = abscissae(a0, true);
  const sb = abscissae(b0, true);
  const La = last(sa);
  const Lb = last(sb);
  let d = Math.abs(La - Lb);
  // Dénivelé de chaque bord (bas et haut : la comparaison reste symétrique quand un
  // déplacement échange les bords).
  for (let k = 0; k < A.length; k++) {
    const ea = A[k]!;
    const eb = B[k]!;
    if (ea.length === 0 || eb.length === 0) continue;
    d = Math.max(d, Math.abs(last(ea).z - ea[0]!.z - (last(eb).z - eb[0]!.z)));
  }
  if (!panel) return Math.max(d, Math.abs(last(abscissae(a0, false)) - last(abscissae(b0, false))));
  const a1 = A[1]!;
  const b1 = B[1]!;
  const ta = abscissae(a1, true);
  const tb = abscissae(b1, true);
  const half = Math.min(La, Lb) / 2;
  const xs = commonAbscissae([sa, ta], La / 2, [sb, tb], Lb / 2, half);
  for (const x of xs) {
    const ha = pointAtS(a1, ta, x + La / 2).z - pointAtS(a0, sa, x + La / 2).z;
    const hb = pointAtS(b1, tb, x + Lb / 2).z - pointAtS(b0, sb, x + Lb / 2).z;
    d = Math.max(d, Math.abs(ha - hb));
  }
  return d;
}

// ------------------------------------------------------------------ reconstruction des arcs

/** Déviation signée (rad) en b du chemin a → b → c, en plan. */
function turn(a: Vec3, b: Vec3, c: Vec3): number {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const bx = c.x - b.x;
  const by = c.y - b.y;
  // Segment nul en plan (ressaut vertical) : pas de déviation (atan2(0, −0) vaudrait π).
  if (Math.hypot(ax, ay) < TINY || Math.hypot(bx, by) < TINY) return 0;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

/**
 * Bord reconstruit : arcs facettés rendus à leur cercle, `SUBDIVISIONS` échantillons par corde,
 * plus un échantillon à chaque cassure du profil z(s) ; z lu sur le bord d'origine à son abscisse
 * en plan.
 */
function reconstruct(e: readonly Vec3[]): Vec3[] {
  const n0 = e.length;
  if (n0 < 3) return e.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const s0 = abscissae(e, true);
  const zAt = (x: number): number => pointAtS(e, s0, x).z;
  // Cassures du profil z(s) : abscisses gardées comme échantillons.
  const kinks: number[] = [];
  for (let i = 1; i + 1 < n0; i++) {
    const h0 = s0[i]! - s0[i - 1]!;
    const h1 = s0[i + 1]! - s0[i]!;
    if (h0 < TINY || h1 < TINY) continue;
    const p0 = (e[i]!.z - e[i - 1]!.z) / h0;
    const p1 = (e[i + 1]!.z - e[i]!.z) / h1;
    if (Math.abs(p1 - p0) > Z_KINK) kinks.push(s0[i]!);
  }
  // Ressauts verticaux (sommets consécutifs de même abscisse en plan, z différents) : rendus par
  // deux échantillons à la même abscisse, z avant puis z après ; sans eux, le ressaut serait
  // lissé entre deux échantillons et sa position perdue.
  const jumps: { s: number; z0: number; z1: number }[] = [];
  let jumpEnd = -1;
  for (let i = 1; i < n0; i++) {
    if (s0[i]! - s0[i - 1]! >= TINY || Math.abs(e[i]!.z - e[i - 1]!.z) <= TINY) continue;
    if (jumpEnd === i - 1 && jumps.length > 0) last(jumps).z1 = e[i]!.z;
    else jumps.push({ s: s0[i]!, z0: e[i - 1]!.z, z1: e[i]!.z });
    kinks.push(s0[i]!);
    jumpEnd = i;
  }
  kinks.sort((p, q) => p - q);
  // Sommets non alignés en plan.
  const idx = [0];
  for (let i = 1; i + 1 < n0; i++) {
    if (Math.abs(turn(e[last(idx)]!, e[i]!, e[i + 1]!)) > ALIGNED_TURN) idx.push(i);
  }
  idx.push(n0 - 1);
  const V = idx.map((i) => e[i]!);
  const S = idx.map((i) => s0[i]!);
  const m = V.length;
  const chord = (k: number): number => Math.hypot(V[k + 1]!.x - V[k]!.x, V[k + 1]!.y - V[k]!.y);
  const tau = (i: number): number => turn(V[i - 1]!, V[i]!, V[i + 1]!);
  const same = (a: number, b: number): boolean =>
    a >= 0 &&
    b >= 0 &&
    a <= m - 2 &&
    b <= m - 2 &&
    Math.abs(chord(a) - chord(b)) <= CHORD_REL * Math.max(chord(a), chord(b));
  // Arc admis seulement si sa flèche par corde est celle d'un facettage (≤ `GUARD_EDGE_CHORD_TOL`,
  // marge de bruit) : un polygone à cordes égales (contour à angles droits) reste un polygone.
  const facetted = (k: number, t: number): number =>
    (chord(k) / 2) * Math.tan(Math.abs(t) / 4) <= GUARD_EDGE_CHORD_TOL * (1 + ARC_SAGITTA_REL)
      ? t
      : 0;
  // Angle d'arc de chaque corde (0 : droite). Cordes intérieures seulement.
  const th = new Array<number>(m - 1).fill(0);
  for (let k = 1; k <= m - 3; k++) {
    if (k - 1 >= 1 && same(k - 1, k)) th[k] = facetted(k, tau(k));
    else if (k + 1 <= m - 3 && same(k, k + 1)) th[k] = facetted(k, tau(k + 1));
  }
  const P: Vec3[] = V.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  // Bout coupé (corde k, voisine nb, sommet commun vi, extrémité ei) : ramené sur le cercle de
  // la voisine si sa corde n'est pas plus longue et si la déviation au sommet commun est celle
  // de l'arc ; sinon il reste droit (sommet de tangence, tronçon droit).
  const endFix = (k: number, nb: number, vi: number, ei: number): void => {
    const t = th[nb] ?? 0;
    if (nb < 1 || nb > m - 3 || t === 0) return;
    if (Math.abs(tau(vi) - t) > END_TURN_REL * Math.abs(t)) return;
    if (chord(k) > chord(nb) * (1 + CHORD_REL)) return;
    const cc = chord(nb);
    const rho = cc / (2 * Math.sin(Math.abs(t) / 2));
    const h = rho * Math.cos(t / 2);
    const a = V[nb]!;
    const b = V[nb + 1]!;
    const ux = (b.x - a.x) / cc;
    const uy = (b.y - a.y) / cc;
    const sg = Math.sign(t);
    const ox = (a.x + b.x) / 2 - sg * uy * h;
    const oy = (a.y + b.y) / 2 + sg * ux * h;
    const E = V[ei]!;
    const r = Math.hypot(E.x - ox, E.y - oy);
    if (!(r > TINY) || !Number.isFinite(rho)) return;
    P[ei] = { x: ox + (rho * (E.x - ox)) / r, y: oy + (rho * (E.y - oy)) / r, z: E.z };
    const a0 = Math.atan2(P[ei]!.y - oy, P[ei]!.x - ox);
    const a1 = Math.atan2(V[vi]!.y - oy, V[vi]!.x - ox);
    let d = ei < vi ? a1 - a0 : a0 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    th[k] = d;
  };
  if (m >= 4) {
    endFix(0, 1, 1, 0);
    endFix(m - 2, m - 3, m - 2, m - 1);
  }
  const out: Vec3[] = [];
  let ki = 0;
  let ji = 0;
  for (let k = 0; k + 1 < m; k++) {
    const a = P[k]!;
    const b = P[k + 1]!;
    const t = th[k]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const span = S[k + 1]! - S[k]!;
    const fs: number[] = [];
    for (let j = k === 0 ? 0 : 1; j <= SUBDIVISIONS; j++) fs.push(j / SUBDIVISIONS);
    while (ki < kinks.length && kinks[ki]! <= S[k + 1]! + TINY) {
      const x = kinks[ki++]!;
      if (span > TINY && x > S[k]! + TINY && x < S[k + 1]! - TINY) fs.push((x - S[k]!) / span);
    }
    fs.sort((p, q) => p - q);
    // Fractions confondues (cassure au droit d'une subdivision) : un seul échantillon.
    for (let j = fs.length - 1; j > 0; j--) if (fs[j]! - fs[j - 1]! <= 1e-12) fs.splice(j, 1);
    const arc = Math.abs(t) >= 1e-12 && L >= TINY;
    const rho = arc ? L / (2 * Math.sin(Math.abs(t) / 2)) : 0;
    const h = rho * Math.cos(t / 2);
    const ux = L >= TINY ? (b.x - a.x) / L : 0;
    const uy = L >= TINY ? (b.y - a.y) / L : 0;
    const sg = Math.sign(t);
    const ox = (a.x + b.x) / 2 - sg * uy * h;
    const oy = (a.y + b.y) / 2 + sg * ux * h;
    const a0 = Math.atan2(a.y - oy, a.x - ox);
    for (const f of fs) {
      const x = S[k]! + f * span;
      const z = f === 0 ? a.z : f === 1 ? b.z : zAt(x);
      while (ji < jumps.length && jumps[ji]!.s < x - TINY) ji++;
      const jump = ji < jumps.length && jumps[ji]!.s <= x + TINY ? jumps[ji++] : undefined;
      let px: number;
      let py: number;
      if (!arc) {
        px = a.x + f * (b.x - a.x);
        py = a.y + f * (b.y - a.y);
      } else {
        const ang = a0 + t * f;
        px = ox + rho * Math.cos(ang);
        py = oy + rho * Math.sin(ang);
      }
      if (jump) out.push({ x: px, y: py, z: jump.z0 }, { x: px, y: py, z: jump.z1 });
      else out.push({ x: px, y: py, z });
    }
  }
  return out;
}
