/**
 * Grandeurs communes aux stratégies de balancement, lues dans `BalancingInput`.
 */
import { MessageError, msg } from "@blondel/i18n";
import { curvePointAt, locate } from "../geom2d/curve.js";
import { projectOnCurve } from "../geom2d/intersect.js";
import type { Layout } from "../model/derived.js";
import type { BalancingInput } from "../model/plugins.js";
import type { Mm, Vec2 } from "../model/primitives.js";

export interface ZoneEnds {
  readonly a: number;
  readonly b: number;
  /** Abscisses sur le jour des collets des nez fixes a et b. */
  readonly sigmaA: Mm;
  readonly sigmaB: Mm;
}

/** Nez fixes de la zone et abscisses de leurs collets ; erreur si la zone est invalide. */
export function zoneEnds(input: BalancingInput): ZoneEnds {
  const { from: a, to: b } = input.zone;
  const na = input.nosings[a];
  const nb = input.nosings[b];
  if (!na || !nb || b - a < 2) {
    throw new MessageError(msg("balancing.error.invalidZone", { a, b }));
  }
  return { a, b, sigmaA: na.sigmaInner, sigmaB: nb.sigmaInner };
}

/** Lecture d'un paramètre numérique optionnel. */
export function numberParam(input: BalancingInput, key: string): number | undefined {
  const v = input.params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Pentes des marches adjacentes à la zone **sur le développé** du jour : Δz / Δσ de la marche
 * voisine (σ abscisses des collets sur le jour de développement), c'est-à-dire la pente réelle
 * du limon développé juste avant a et juste après b, à laquelle F doit se raccorder (K4). Dans
 * une partie droite (nez perpendiculaires, jour parallèle à Γ), Δσ = Δs et l'on retrouve
 * m = h/g (B §3.5). Quand la marche voisine est elle-même dans la partie tournante (borne de
 * zone imposée à l'intérieur du tournant), Δσ ≠ Δs et c'est Δz/Δσ qui assure la continuité.
 * Paramètres `startSlope`/`endSlope` prioritaires ; à défaut de marche voisine (ou si Δσ ≤ 0),
 * Δz / Δs, puis pente nominale rise / going.
 */
export function adjacentSlopes(input: BalancingInput): { start: number; end: number } {
  const { from: a, to: b } = input.zone;
  const nominal = input.rise / input.going;
  const slope = (i: number, j: number): number => {
    const ni = input.nosings[i];
    const nj = input.nosings[j];
    const zi = input.z[i];
    const zj = input.z[j];
    if (!ni || !nj || zi === undefined || zj === undefined) return nominal;
    const dSigma = nj.sigmaInner - ni.sigmaInner;
    if (dSigma > 0) return (zj - zi) / dSigma;
    const ds = nj.s - ni.s;
    return ds > 0 ? (zj - zi) / ds : nominal;
  };
  return {
    start: numberParam(input, "startSlope") ?? slope(a - 1, a),
    end: numberParam(input, "endSlope") ?? slope(b, b + 1),
  };
}

/** Indices des tournants couverts par la zone. */
export function zoneTurns(input: BalancingInput): number[] {
  const first = input.zone.turn;
  const last = input.zone.lastTurn ?? first;
  const out: number[] = [];
  for (let j = first; j <= last; j++) out.push(j);
  return out;
}

/** Milieu (abscisse sur Γ) de la partie tournante couverte par la zone. */
export function zoneMidS(layout: Layout, first: number, last: number): Mm {
  const t0 = layout.turns[first];
  const t1 = layout.turns[last];
  if (!t0 || !t1) {
    throw new MessageError(msg("balancing.error.unknownTurns", { first, last }));
  }
  return (t0.sStart + t1.sEnd) / 2;
}

/** Centre de l'arc de Γ du tournant j (centre du rayonnement M0). */
export function turnCenter(layout: Layout, j: number): Vec2 {
  const t = layout.turns[j];
  if (!t) throw new MessageError(msg("balancing.error.unknownTurn", { turn: j }));
  const seg = layout.walkline.segments[locate(layout.walkline, (t.sStart + t.sEnd) / 2).index];
  if (!seg || seg.kind !== "arc") {
    throw new MessageError(msg("balancing.error.walklineNotArc", { turn: j + 1 }));
  }
  return seg.center;
}

/**
 * Abscisse σ_A du « point d'angle » sur le jour : projection sur C_i du milieu de la partie
 * tournante de Γ (coin vif K, milieu de l'arc de jour, coin du poteau ; milieu de la volée
 * centrale pour une zone unique de 180°). Paramètre `cornerSigma` prioritaire.
 */
export function cornerSigma(input: BalancingInput): Mm {
  const given = numberParam(input, "cornerSigma");
  if (given !== undefined) return given;
  const turns = zoneTurns(input);
  const s = zoneMidS(input.layout, turns[0]!, turns[turns.length - 1]!);
  return projectOnCurve(curvePointAt(input.layout.walkline, s), input.layout.inner).s;
}
