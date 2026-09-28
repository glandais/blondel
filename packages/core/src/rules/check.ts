/**
 * Outils communs aux évaluateurs : comparaison aux bornes, agrégation par élément, volées.
 */
import type { Location, Stepping, Tread } from "../model/derived.js";
import type { Polygon2 } from "../model/primitives.js";
import type { EvaluatorContext, Finding } from "./types.js";

/**
 * Tolérance **numérique** (mm) des comparaisons, pour absorber les erreurs d'arrondi float64
 * (ex. H / n). Ce n'est pas une tolérance métier.
 */
export const NUMERIC_EPS = 1e-6;

export const STAIR: Location = { kind: "stair" };

/** Formatage français d'une grandeur (1 décimale au plus, virgule décimale). */
export function fmt(x: number, digits = 1): string {
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return String(r).replace(".", ",");
}

export interface Bounds {
  readonly min: number | null;
  readonly max: number | null;
  /** Borne haute stricte (`<`) plutôt que large (`<=`). */
  readonly strictMax?: boolean;
  /** Borne basse stricte (`>`) plutôt que large (`>=`). */
  readonly strictMin?: boolean;
}

export function boundsOf(ctx: EvaluatorContext): Bounds {
  return { min: ctx.rule.min, max: ctx.rule.max };
}

/** Vrai si `v` respecte les bornes (à la tolérance numérique près ; une égalité viole une borne stricte). */
export function within(v: number, b: Bounds): boolean {
  if (b.min !== null) {
    if (b.strictMin ? !(v > b.min + NUMERIC_EPS) : v < b.min - NUMERIC_EPS) return false;
  }
  if (b.max !== null) {
    if (b.strictMax ? !(v < b.max - NUMERIC_EPS) : v > b.max + NUMERIC_EPS) return false;
  }
  return true;
}

/** Écart hors bornes (0 si conforme), pour désigner l'élément le plus défavorable. */
export function excess(v: number, b: Bounds): number {
  let e = 0;
  if (b.min !== null) e = Math.max(e, b.min - v);
  if (b.max !== null) e = Math.max(e, v - b.max);
  return e;
}

export function boundsText(b: Bounds, unit: string | null): string {
  const u = unit && unit !== "ratio" ? ` ${unit}` : "";
  if (b.min !== null && b.max !== null) return `entre ${fmt(b.min, 2)} et ${fmt(b.max, 2)}${u}`;
  if (b.min !== null) return `${b.strictMin ? ">" : "≥"} ${fmt(b.min, 2)}${u}`;
  if (b.max !== null) return `${b.strictMax ? "<" : "≤"} ${fmt(b.max, 2)}${u}`;
  return "sans borne";
}

/** Contrôle d'une valeur unique. */
export function checkValue(
  ctx: EvaluatorContext,
  value: number,
  label: string,
  opts: { bounds?: Bounds; location?: Location } = {},
): Finding {
  const b = opts.bounds ?? boundsOf(ctx);
  if (Number.isNaN(value)) return notEvaluated(`${label} : valeur non calculable (NaN).`, opts.location ?? STAIR);
  const ok = within(value, b);
  const unit = ctx.rule.unite;
  const u = unit && unit !== "ratio" ? ` ${unit}` : "";
  return {
    status: ok ? "ok" : "violation",
    measured: value,
    min: b.min,
    max: b.max,
    location: opts.location ?? STAIR,
    message: `${label} : ${fmt(value, 2)}${u} (attendu ${boundsText(b, unit)}).`,
  };
}

export interface Item {
  readonly value: number;
  readonly location: Location;
  /** Libellé de l'élément (ex. « marche 3 »). */
  readonly label: string;
}

/**
 * Contrôle d'une série d'éléments : un constat `violation` par élément non conforme, ou un seul
 * constat `ok` à l'échelle de l'escalier portant la valeur la plus défavorable.
 * Série vide : un constat `ok` « sans objet ».
 */
export function checkItems(
  ctx: EvaluatorContext,
  items: readonly Item[],
  quantity: string,
  opts: { bounds?: Bounds; emptyMessage?: string } = {},
): Finding[] {
  const b = opts.bounds ?? boundsOf(ctx);
  if (items.length === 0) return [notApplicable(opts.emptyMessage ?? `Sans objet : aucun élément concerné (${quantity}).`)];
  const unit = ctx.rule.unite;
  const u = unit && unit !== "ratio" ? ` ${unit}` : "";
  // Une valeur non calculable (NaN) passerait toutes les comparaisons : elle est signalée à part.
  const nan = items.filter((it) => Number.isNaN(it.value));
  if (nan.length > 0) {
    return nan.map((it) => notEvaluated(`${quantity}, ${it.label} : valeur non calculable (NaN).`, it.location));
  }
  const bad = items.filter((it) => !within(it.value, b));
  if (bad.length > 0) {
    return bad.map((it) => ({
      status: "violation" as const,
      measured: it.value,
      min: b.min,
      max: b.max,
      location: it.location,
      message: `${quantity}, ${it.label} : ${fmt(it.value, 2)}${u} (attendu ${boundsText(b, unit)}).`,
    }));
  }
  // Élément le plus proche d'une borne.
  let worst = items[0]!;
  let worstMargin = Infinity;
  for (const it of items) {
    const m = Math.min(
      b.min !== null ? it.value - b.min : Infinity,
      b.max !== null ? b.max - it.value : Infinity,
    );
    if (m < worstMargin) {
      worstMargin = m;
      worst = it;
    }
  }
  return [
    {
      status: "ok",
      measured: worst.value,
      min: b.min,
      max: b.max,
      location: STAIR,
      message: `${quantity} conforme sur ${items.length} élément(s) ; valeur la plus défavorable ${fmt(worst.value, 2)}${u} (${worst.label}), attendu ${boundsText(b, unit)}.`,
    },
  ];
}

/** Constat « sans objet » : la règle est applicable mais la situation ne se présente pas. */
export function notApplicable(message: string): Finding {
  return { status: "ok", location: STAIR, message };
}

/** Constat « non évalué » avec explication (donnée manquante, contrôle partiel). */
export function notEvaluated(message: string, location: Location = STAIR): Finding {
  return { status: "non-evaluee", location, message };
}

// ------------------------------------------------------------------ Volées

export interface Flight {
  /** Numéro de volée (1 …). */
  readonly number: number;
  /** Indices (0-based) des hauteurs de la volée ; la hauteur i arrive au nez i. */
  readonly riseIndices: readonly number[];
  readonly riserCount: number;
  readonly height: number;
}

/**
 * Découpe l'escalier en volées séparées par les paliers : la hauteur i (0-based) arrive sur la
 * marche i+1 ; si cette marche est un palier, la volée se termine avec cette hauteur.
 */
export function flightsOf(stepping: Stepping): Flight[] {
  const landingNumbers = new Set(stepping.treads.filter((t) => t.kind === "landing").map((t) => t.number));
  const flights: Flight[] = [];
  let current: number[] = [];
  const push = (): void => {
    if (current.length === 0) return;
    const height = current.reduce((s, i) => s + (stepping.rises[i] ?? 0), 0);
    flights.push({ number: flights.length + 1, riseIndices: current, riserCount: current.length, height });
    current = [];
  };
  stepping.rises.forEach((_, i) => {
    current.push(i);
    if (landingNumbers.has(i + 1)) push();
  });
  push();
  return flights;
}

/** Localisation d'une hauteur de marche : le nez auquel elle arrive. */
export function riseLocation(i: number): Location {
  return { kind: "nosing", index: i };
}

export function treadLocation(t: Tread): Location {
  return { kind: "tread", number: t.number };
}

export function treadsOfKind(stepping: Stepping, kind: Tread["kind"]): Tread[] {
  return stepping.treads.filter((t) => t.kind === kind);
}

// ------------------------------------------------------------------ Géométrie légère

/** Largeur minimale d'un polygone (épaisseur minimale de son enveloppe convexe). */
export function minWidth(poly: Polygon2): number {
  const hull = convexHull(poly);
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    let far = 0;
    for (const p of hull) far = Math.max(far, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len);
    best = Math.min(best, far);
  }
  return Number.isFinite(best) ? best : 0;
}

function convexHull(pts: Polygon2): { x: number; y: number }[] {
  const p = [...pts].sort((u, v) => u.x - v.x || u.y - v.y);
  if (p.length < 3) return p;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
