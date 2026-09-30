/**
 * Géométrie du limon porteur débillardé (B §5, jalon 5b) : développement des fibres d'une face
 * cylindrique en forme fermée, courbe des nez F(σ) issue du balancement M3, naissances,
 * cassure de pente résiduelle.
 *
 * Conventions :
 * - la **face de référence** du limon de jour est C_i (bord du jour = face côté marches, limon
 *   hors emprise utile, CHALLENGE A3) ; le limon occupe la bande [0 ; e] du côté du jour ;
 * - σ = abscisse curviligne sur C_i (celle des collets `NosingLine.sigmaInner` et du
 *   développement M3, B §3.5) ; au-delà des extrémités de C_i, la courbe est prolongée par sa
 *   tangente (σ < 0 avant le départ, σ > |C_i| après l'arrivée) ;
 * - une **fibre** est la courbe parallèle à C_i décalée de `offset` vers le jour (0 = face côté
 *   marches, e/2 = fibre neutre, e = face côté jour). Sur une droite, σ_fibre avance comme σ ;
 *   sur un arc de rayon r (face), σ_fibre = (r ∓ offset)·θ — « − » quand le centre de l'arc est
 *   du côté du jour (cas du limon de jour : fibre intérieure plus courte), « + » sinon (B §5.1 :
 *   σ_± = ∫ (1 ∓ κ·e/2) dσ, ici en forme fermée par morceaux).
 */
import { msg, MessageError, type Message } from "@blondel/i18n";
import { zoneProfile } from "../balancing/m3.js";
import { evalProfile, evalSpline } from "../balancing/profile.js";
import type { EndCondition, M3Variant } from "../balancing/profile.js";
import { cumulativeLengths, curvePointAt, curveTangentAt } from "../geom2d/curve.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import type { Layout, NosingLine, Stepping } from "../model/derived.js";
import type { Curve2, Mm, Rad, Vec2 } from "../model/primitives.js";

export type JourSide = "left" | "right";

// ------------------------------------------------------------------ Courbe prolongée

/** Point de C_i en σ, prolongé par la tangente au-delà des extrémités. */
export function pointAtExtended(curve: Curve2, cum: readonly Mm[], sigma: Mm): Vec2 {
  const L = cum[cum.length - 1] ?? 0;
  if (sigma < 0) return V.addScaled(curvePointAt(curve, 0), curveTangentAt(curve, 0), sigma);
  if (sigma > L) return V.addScaled(curvePointAt(curve, L), curveTangentAt(curve, L), sigma - L);
  return curvePointAt(curve, sigma);
}

/** Tangente unitaire de C_i en σ (bornée aux extrémités). */
export function tangentAtExtended(curve: Curve2, cum: readonly Mm[], sigma: Mm): Vec2 {
  const L = cum[cum.length - 1] ?? 0;
  return curveTangentAt(curve, Math.min(L, Math.max(0, sigma)));
}

/** Normale horizontale unitaire dirigée vers le jour (dans l'épaisseur du limon de jour). */
export function jourNormal(tangent: Vec2, jour: JourSide): Vec2 {
  return jour === "left" ? V.perpLeft(tangent) : V.perpRight(tangent);
}

// ------------------------------------------------------------------ Fibres

/** Morceau (droite ou arc) du développement d'une fibre. */
export interface FiberPiece {
  readonly kind: "line" | "arc";
  /** Abscisses sur la face de référence (C_i). */
  readonly sigma0: Mm;
  readonly sigma1: Mm;
  /** Abscisses développées sur la fibre. */
  readonly fiber0: Mm;
  readonly fiber1: Mm;
  /** Arc : rayon de la face de référence, rayon de la fibre, angle balayé (valeur absolue). */
  readonly faceRadius?: Mm;
  readonly fiberRadius?: Mm;
  readonly angle?: Rad;
  /** Arc : centre du côté du jour (fibre plus courte que la face). */
  readonly concave?: boolean;
}

export interface FiberDevelopment {
  /** Décalage de la fibre vers le jour (0 = face côté marches). */
  readonly offset: Mm;
  readonly pieces: readonly FiberPiece[];
  /** Longueur de C_i et longueur développée de la fibre. */
  readonly faceLength: Mm;
  readonly fiberLength: Mm;
  /** σ (face) → abscisse développée sur la fibre (prolongée de pente 1 hors de C_i). */
  toFiber(sigma: Mm): Mm;
  /** Réciproque de `toFiber`. */
  toFace(x: Mm): Mm;
}

/**
 * Développement en forme fermée d'une fibre décalée de `offset` vers le jour (`jour` : côté du
 * jour par rapport au sens de la montée). Lève une erreur si la fibre traverse le centre d'un
 * arc (offset ≥ rayon, côté concave).
 */
export function fiberDevelopment(curve: Curve2, offset: Mm, jour: JourSide): FiberDevelopment {
  const pieces: FiberPiece[] = [];
  let sigma = 0;
  let fiber = 0;
  for (const seg of curve.segments) {
    if (seg.kind === "line") {
      const len = V.distance(seg.a, seg.b);
      pieces.push({
        kind: "line",
        sigma0: sigma,
        sigma1: sigma + len,
        fiber0: fiber,
        fiber1: fiber + len,
      });
      sigma += len;
      fiber += len;
    } else {
      const angle = Math.abs(seg.sweep);
      const len = seg.radius * angle;
      // Jour à gauche : l'arc qui tourne à gauche (balayage positif) a son centre côté jour.
      const concave = seg.sweep > 0 === (jour === "left");
      const fiberRadius = concave ? seg.radius - offset : seg.radius + offset;
      if (!(fiberRadius >= 0) && len > GEOM_EPS) {
        throw new MessageError(
          msg("structure.steelCurved.error.fiberBeyondCenter", {
            offset: String(offset),
            radius: String(seg.radius),
          }),
        );
      }
      const flen = fiberRadius * angle;
      pieces.push({
        kind: "arc",
        sigma0: sigma,
        sigma1: sigma + len,
        fiber0: fiber,
        fiber1: fiber + flen,
        faceRadius: seg.radius,
        fiberRadius,
        angle,
        concave,
      });
      sigma += len;
      fiber += flen;
    }
  }
  const faceLength = sigma;
  const fiberLength = fiber;
  const toFiber = (s: Mm): Mm => {
    if (s <= 0) return s;
    if (s >= faceLength) return fiberLength + (s - faceLength);
    for (const p of pieces) {
      if (s <= p.sigma1 + 1e-12) {
        const d = p.sigma1 - p.sigma0;
        return d > 0 ? p.fiber0 + ((p.fiber1 - p.fiber0) * (s - p.sigma0)) / d : p.fiber0;
      }
    }
    return fiberLength;
  };
  const toFace = (x: Mm): Mm => {
    if (x <= 0) return x;
    if (x >= fiberLength) return faceLength + (x - fiberLength);
    for (const p of pieces) {
      if (x <= p.fiber1 + 1e-12) {
        const d = p.fiber1 - p.fiber0;
        return d > 0 ? p.sigma0 + ((p.sigma1 - p.sigma0) * (x - p.fiber0)) / d : p.sigma0;
      }
    }
    return faceLength;
  };
  return { offset, pieces, faceLength, fiberLength, toFiber, toFace };
}

/** Longueur développée d'un arc de rayon R (axe) sur une fibre décalée de ±d : (R ∓ d)·θ. */
export function arcFiberLength(axisRadius: Mm, angle: Rad, towardCenter: Mm): Mm {
  return (axisRadius - towardCenter) * Math.abs(angle);
}

/** Naissance : jonction de deux morceaux de courbure différente (droite / arc, arc / arc). */
export interface Naissance {
  readonly sigma: Mm;
  readonly before: "line" | "arc";
  readonly after: "line" | "arc";
  /** Rayon (face) de l'arc voisin (le premier des deux s'ils sont tous deux des arcs). */
  readonly radius: Mm;
}

export function naissances(curve: Curve2): Naissance[] {
  const cum = cumulativeLengths(curve);
  const out: Naissance[] = [];
  const segs = curve.segments;
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]!;
    const b = segs[i]!;
    const differ =
      a.kind !== b.kind ||
      (a.kind === "arc" &&
        b.kind === "arc" &&
        (Math.abs(a.radius - b.radius) > GEOM_EPS ||
          !V.equals(a.center, b.center) ||
          Math.sign(a.sweep) !== Math.sign(b.sweep)));
    if (!differ) continue;
    const arc = a.kind === "arc" ? a : b.kind === "arc" ? b : null;
    out.push({ sigma: cum[i]!, before: a.kind, after: b.kind, radius: arc ? arc.radius : 0 });
  }
  return out;
}

// ------------------------------------------------------------------ Courbe des nez F(σ)

/** Zone de F : courbe M3 reconstituée, ou interpolation monotone (M0, M1, repli). */
export interface ProfileZone {
  readonly from: number;
  readonly to: number;
  readonly sigmaA: Mm;
  readonly sigmaB: Mm;
  readonly kind: "m3" | "interpolated";
  readonly variant?: M3Variant;
  readonly ends?: readonly [EndCondition, EndCondition];
  /** Écart maximal |F(σ_k) − z_k| sur les nez intermédiaires de la zone (mm). */
  readonly residual: Mm;
}

export interface NosingProfile {
  /** F(σ) : altitude de la courbe des nez sur le développé de C_i. */
  at(sigma: Mm): Mm;
  readonly zones: readonly ProfileZone[];
  /** Nœuds (σ_k, z_k) des nez, σ croissants. */
  readonly knots: readonly Vec2[];
  readonly notes: readonly Message[];
}

/** Hermite cubique monotone (Fritsch–Carlson) avec pentes d'extrémité imposées. */
function monotoneHermite(
  xs: readonly number[],
  ys: readonly number[],
  startSlope: number,
  endSlope: number,
): (x: number) => number {
  const n = xs.length;
  const secants: number[] = [];
  for (let i = 0; i + 1 < n; i++) secants.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  const d: number[] = new Array<number>(n).fill(0);
  d[0] = startSlope;
  d[n - 1] = endSlope;
  for (let i = 1; i + 1 < n; i++) {
    const a = secants[i - 1]!;
    const b = secants[i]!;
    d[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  // Bornes de Fritsch–Carlson (monotonie) aux extrémités.
  for (const [i, s] of [
    [0, secants[0]!],
    [n - 1, secants[n - 2]!],
  ] as const) {
    if (s <= 0) d[i] = 0;
    else d[i] = Math.min(Math.max(d[i]!, 0), 3 * s);
  }
  return (x) => {
    let i = 0;
    while (i + 2 < n && x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * h * d[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * h * d[i + 1]!
    );
  };
}

/**
 * Courbe des nez F(σ) sur le développé de C_i (B §5.1) : dans chaque zone balancée en M3, la
 * courbe cubique ou quintique de la stratégie, **reconstituée** à partir de la zone retenue par
 * le découpage (nez fixes a et b, extrémités et prolongement de `Stepping.balancedZones`, sinon
 * règles de `stepping/zones.ts`, pentes des marches voisines sur le développé ; même fonction
 * `zoneProfile` que la stratégie) et vérifiée sur les nez intermédiaires ; au-delà d'une borne
 * libre située dans la partie tournante, la spline prolongée à travers les nez fixes jusqu'à la
 * partie droite (F dérivable à la borne) ; ailleurs, droite par morceaux entre les nez (parties
 * droites : pente h/g), prolongée linéairement avant le premier et après le dernier nez. Zones
 * M0 / M1, ou courbe
 * non reconstituée (écart > 0,05 mm) : interpolation cubique monotone (C1) par les nez, signalée.
 */
export function nosingProfile(layout: Layout, stepping: Stepping): NosingProfile {
  const nosings = stepping.nosings;
  const n = nosings.length;
  const notes: Message[] = [];
  const knots = nosings.map((k) => V.vec(k.sigmaInner, k.z));
  const nominal = stepping.rise / stepping.going;
  const landingEdge = (k: number): boolean =>
    stepping.treads.some((t) => t.kind === "landing" && (t.number === k || t.number === k + 1));
  const slope = (i: number, j: number): number => {
    const ni: NosingLine | undefined = nosings[i];
    const nj: NosingLine | undefined = nosings[j];
    if (!ni || !nj) return nominal;
    const dSigma = nj.sigmaInner - ni.sigmaInner;
    if (dSigma > 0) return (nj.z - ni.z) / dSigma;
    const ds = nj.s - ni.s;
    return ds > 0 ? (nj.z - ni.z) / ds : nominal;
  };
  const zones: (ProfileZone & { readonly f: (s: Mm) => Mm })[] = [];
  /** Prolongements de F hors des zones (spline M3 à travers les nez fixes du tournant). */
  const extensions: { readonly sigmaA: Mm; readonly sigmaB: Mm; readonly f: (s: Mm) => Mm }[] = [];
  for (const bz of stepping.balancedZones) {
    const a = bz.from;
    const b = bz.to;
    const na = nosings[a];
    const nb = nosings[b];
    if (!na || !nb || b - a < 2) continue;
    const sigmaA = na.sigmaInner;
    const sigmaB = nb.sigmaInner;
    const delta = sigmaB - sigmaA;
    if (!(delta > GEOM_EPS)) continue;
    const startSlope = slope(a - 1, a);
    const endSlope = slope(b, b + 1);
    const interior = nosings.slice(a + 1, b);
    const residualOf = (f: (s: Mm) => Mm): Mm =>
      interior.reduce((m, k) => Math.max(m, Math.abs(f(k.sigmaInner) - k.z)), 0);
    const interpolated = (): ProfileZone & { readonly f: (s: Mm) => Mm } => {
      const pts = nosings.slice(a, b + 1);
      const f = monotoneHermite(
        pts.map((k) => k.sigmaInner),
        pts.map((k) => k.z),
        startSlope,
        endSlope,
      );
      return {
        from: a,
        to: b,
        sigmaA,
        sigmaB,
        kind: "interpolated",
        residual: residualOf(f),
        f,
      };
    };
    const m3 = /^M3-(cubic|quintic)$/.exec(bz.method);
    if (!m3) {
      zones.push(interpolated());
      notes.push(
        msg("structure.steelCurved.note.zoneNotM3", { from: a, to: b, method: bz.method }),
      );
      continue;
    }
    const variant = m3[1] as M3Variant;
    // Extrémités retenues par le découpage (`Stepping.balancedZones[].ends`) ; à défaut, règles
    // de `stepping/zones.ts` (`zoneEndConditions`) : libre au départ, à l'arrivée, aux bords
    // d'un palier, ou dans la partie tournante du groupe de tournants de la zone.
    const winders = layout.turns.filter((t) => t.mode === "winders");
    const first = winders.find((t) => t.index === bz.turn);
    let last = first;
    for (const t of winders) {
      if (first && t.index > first.index && t.sStart < nb.s && last && t.index === last.index + 1)
        last = t;
    }
    const ends: readonly [EndCondition, EndCondition] = bz.ends ?? [
      a === 0 || landingEdge(a) || (first !== undefined && na.s > first.sStart + GEOM_EPS)
        ? "free"
        : "tangent",
      b === n - 1 || landingEdge(b) || (last !== undefined && nb.s < last.sEnd - GEOM_EPS)
        ? "free"
        : "tangent",
    ];
    // Même construction que la stratégie M3 (`zoneProfile`), prolongement compris : F est la
    // spline passant par les nez fixes qui suivent une borne libre dans la partie tournante.
    const built = zoneProfile({
      layout,
      nosings,
      zone: {
        turn: bz.turn,
        from: a,
        to: b,
        collarSide: layout.innerSide,
        ends,
        ...(bz.continuation ? { continuation: bz.continuation } : {}),
      },
      z: nosings.map((k) => k.z),
      rise: stepping.rise,
      going: stepping.going,
      params: { variant },
    });
    if ("reason" in built) {
      zones.push(interpolated());
      notes.push(
        msg("structure.steelCurved.note.zoneNotRebuilt", {
          from: a,
          to: b,
          method: bz.method,
          reason: built.reason,
        }),
      );
      continue;
    }
    const { profile, spline } = built;
    const f = (s: Mm): Mm => na.z + delta * evalProfile(profile, (s - sigmaA) / delta);
    const residual = residualOf(f);
    if (residual > 0.05) {
      zones.push(interpolated());
      notes.push(
        msg("structure.steelCurved.note.zoneResidual", {
          from: a,
          to: b,
          method: bz.method,
          residual: residual.toFixed(2),
        }),
      );
      continue;
    }
    zones.push({ from: a, to: b, sigmaA, sigmaB, kind: "m3", variant, ends, residual, f });
    // Prolongement (nez fixes de la partie tournante) : morceaux de la spline hors [a ; b].
    if (spline) {
      const knots = spline.spec.knots;
      const g = (s: Mm): Mm => na.z + delta * evalSpline(spline, (s - sigmaA) / delta);
      const lo = sigmaA + delta * knots[0]!.t;
      const hi = sigmaA + delta * knots[knots.length - 1]!.t;
      if (lo < sigmaA - GEOM_EPS) extensions.push({ sigmaA: lo, sigmaB: sigmaA, f: g });
      if (hi > sigmaB + GEOM_EPS) extensions.push({ sigmaA: sigmaB, sigmaB: hi, f: g });
    }
  }
  zones.sort((x, y) => x.sigmaA - y.sigmaA);
  const xs = knots.map((k) => k.x);
  const linear = (s: Mm): Mm => {
    if (n === 1) return knots[0]!.y;
    let i: number;
    if (s <= xs[0]!) i = 0;
    else if (s >= xs[n - 1]!) i = n - 2;
    else {
      i = 0;
      while (i + 2 < n && s > xs[i + 1]!) i++;
    }
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const y0 = knots[i]!.y;
    const y1 = knots[i + 1]!.y;
    return x1 - x0 > GEOM_EPS ? y0 + ((y1 - y0) * (s - x0)) / (x1 - x0) : Math.max(y0, y1);
  };
  const at = (s: Mm): Mm => {
    for (const z of zones) if (s >= z.sigmaA && s <= z.sigmaB) return z.f(s);
    for (const e of extensions) if (s >= e.sigmaA && s <= e.sigmaB) return e.f(s);
    return linear(s);
  };
  return {
    at,
    zones: zones.map(({ f: _f, ...z }) => z),
    knots,
    notes,
  };
}

// ------------------------------------------------------------------ Cassure de pente

/** Cassure de pente d'une fibre à une naissance (degrés) : |atan(pente après) − atan(avant)|. */
export interface SlopeBreak {
  readonly offset: Mm;
  readonly before: number;
  readonly after: number;
  readonly degrees: number;
}

/**
 * Pentes développées de part et d'autre de la naissance σ_n sur la fibre `dev` (B §5.3 : la
 * pente développée d'une fibre sur l'arc vaut F'(σ)·dσ/dσ_fibre, différente sur chaque face) ;
 * différences finies unilatérales de pas `h` (mm, sur la face de référence).
 */
export function slopeBreakAt(
  F: (s: Mm) => Mm,
  dev: FiberDevelopment,
  sigma: Mm,
  h: Mm = 0.5,
): SlopeBreak {
  const x = dev.toFiber(sigma);
  const before = (F(sigma) - F(sigma - h)) / (x - dev.toFiber(sigma - h));
  const after = (F(sigma + h) - F(sigma)) / (dev.toFiber(sigma + h) - x);
  const degrees = (Math.abs(Math.atan(after) - Math.atan(before)) * 180) / Math.PI;
  return { offset: dev.offset, before, after, degrees };
}
