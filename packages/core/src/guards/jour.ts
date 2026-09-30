/**
 * Largeur du jour (vide central d'un U ou d'un demi-tournant) : entre deux tournants
 * consécutifs de même sens, la première et la troisième volée se font face ; le jour est la
 * distance entre les deux coins intérieurs (longueur du bord intérieur de la volée centrale),
 * diminuée des demi-côtés des poteaux d'angle qui y débordent. Sert à décider si un garde-corps
 * de jour est construit : sous la sphère T1 (`GC_GABARIT_T1_2024.max`, 110 mm), pas de
 * garde-corps de jour (décision de l'utilisateur 2026-09-29, QUESTIONS A10 : `GC_OBLIGATOIRE` en
 * conseil) ; au-dessus, la collision des poteaux des deux garde-corps de jour est contrôlée
 * (`GC_POTEAUX_JOUR`, avertissement).
 */
import type { Message, MessageKey } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import type { Layout } from "../model/derived.js";
import type { Mm, Vec2 } from "../model/primitives.js";
import type { Turn } from "../model/project.js";
import { newelSetback } from "../layout/newel.js";
import { findRule } from "../rules/table.js";
import { pointAt } from "./polyline.js";

/**
 * Clés de la remarque (`Model.notes`) d'un garde-corps de jour non généré (jour plus étroit que
 * la sphère T1), seule ou suivie du garde-corps partiel : repère stable pour `suggestFixes`
 * (correction « côté jour → mur »), à tester par `isNarrowJourNote`.
 */
export const NARROW_JOUR_NOTE_KEYS: readonly MessageKey[] = [
  "guard.narrowJour.note",
  "guard.narrowJour.partial",
];

/** Vrai si `m` est la remarque d'un garde-corps de jour non généré (voir `NARROW_JOUR_NOTE_KEYS`). */
export function isNarrowJourNote(m: Message): boolean {
  return NARROW_JOUR_NOTE_KEYS.includes(m.key);
}

/**
 * Seuil (mm) sous lequel le jour est jugé trop étroit pour un garde-corps de jour : diamètre de
 * la sphère T1 lu dans rules.yaml (`GC_GABARIT_T1_2024.max`) ; `null` si la règle est absente.
 */
export function narrowJourThreshold(): Mm | null {
  return findRule("GC_GABARIT_T1_2024")?.max ?? null;
}

/**
 * Débord d'un jour de tournant dans le vide central : demi-côté d'un poteau (plus son décalage
 * vers le jour), 0 sinon.
 */
function protrusion(turn: Turn | undefined): Mm {
  return turn?.inner.kind === "newel" ? newelSetback(turn.inner) : 0;
}

/**
 * Largeur minimale du jour (mm) entre tournants consécutifs de même sens ; `Infinity` sans
 * tel couple (droit, quart tournant, tournants de sens opposés). `turns` : tournants du projet
 * (`stair.layout.turns`), dans l'ordre de `layout.turns`.
 */
export function jourWidth(layout: Layout, turns: readonly Turn[]): Mm {
  let best = Infinity;
  for (let j = 0; j + 1 < layout.turns.length; j++) {
    const a = layout.turns[j]!;
    const b = layout.turns[j + 1]!;
    if (a.direction !== b.direction) continue;
    const w =
      V.distance(a.innerCorner, b.innerCorner) -
      protrusion(turns[a.index]) -
      protrusion(turns[b.index]);
    if (w < best) best = w;
  }
  return best;
}

/**
 * Emprise en plan d'un jour plus étroit que `threshold` (couple de tournants de même sens) :
 * bande entre les bords intérieurs des deux volées qui se font face, limitée à la plus courte
 * des deux (revue A10 du 2026-09-29). Au-delà, la volée la plus longue borde un vide ouvert :
 * la chute n'y est pas « dans le jour ».
 */
export interface NarrowJourZone {
  /** Coins intérieurs des deux tournants. */
  readonly a: Vec2;
  readonly b: Vec2;
  /** Direction unitaire de a vers b. */
  readonly u: Vec2;
  /** Direction unitaire des volées qui se font face, depuis le segment ab vers le jour. */
  readonly d: Vec2;
  /** Longueur de la bande le long de `d` (bord intérieur de la plus courte des deux volées). */
  readonly length: Mm;
  /** Tolérance latérale (poteaux d'angle, arrondis du bord) : `threshold`. */
  readonly tol: Mm;
}

/**
 * Bandes des jours plus étroits que `threshold` ; `innerEdge` : bord intérieur de l'escalier
 * (polyligne), pour borner chaque bande à la volée la plus courte.
 */
export function narrowJourZones(
  layout: Layout,
  turns: readonly Turn[],
  threshold: Mm,
  innerEdge: readonly Vec2[],
): NarrowJourZone[] {
  const out: NarrowJourZone[] = [];
  for (let j = 0; j + 1 < layout.turns.length; j++) {
    const ta = layout.turns[j]!;
    const tb = layout.turns[j + 1]!;
    if (ta.direction !== tb.direction) continue;
    const w =
      V.distance(ta.innerCorner, tb.innerCorner) -
      protrusion(turns[ta.index]) -
      protrusion(turns[tb.index]);
    if (!(w < threshold)) continue;
    const a = ta.innerCorner;
    const b = tb.innerCorner;
    const len = V.distance(a, b);
    if (!(len > 1e-9)) continue;
    const u = V.normalize(V.sub(b, a));
    const n = V.perpLeft(u);
    // La volée centrale (côté des coins extérieurs) est d'un côté de ab, le jour de l'autre.
    const d = V.dot(V.sub(ta.outerCorner, a), n) > 0 ? V.scale(n, -1) : n;
    const tol = threshold;
    let extA = 0;
    let extB = 0;
    for (const p of innerEdge) {
      const s = V.dot(V.sub(p, a), u);
      const t = V.dot(V.sub(p, a), d);
      if (t < -tol || s < -tol || s > len + tol) continue;
      // Bord de la volée côté a ou côté b (le plus proche des deux).
      if (s <= len / 2) extA = Math.max(extA, t);
      else extB = Math.max(extB, t);
    }
    out.push({ a, b, u, d, length: Math.min(extA, extB), tol });
  }
  return out;
}

/** Vrai si le point `p` (plan) est dans l'emprise d'un des jours étroits. */
export function inNarrowJour(p: Vec2, zones: readonly NarrowJourZone[]): boolean {
  return zones.some((z) => {
    const s = V.dot(V.sub(p, z.a), z.u);
    const t = V.dot(V.sub(p, z.a), z.d);
    const len = V.distance(z.a, z.b);
    return s >= -z.tol && s <= len + z.tol && t >= -z.tol && t <= z.length + 1e-6;
  });
}

/** Pas d'échantillonnage (mm) du bord pour repérer l'entrée et la sortie d'un jour étroit. */
const SPLIT_SAMPLE_STEP = 5;
/** Précision (mm) de la recherche par dichotomie de la limite du jour le long du bord. */
const SPLIT_PRECISION = 1e-4;

/**
 * Parties de la portion [from ; to] du bord (polyligne `points`, abscisses cumulées `cum`) qui
 * sont **hors** de l'emprise des jours étroits `zones` (décision A10 du 2026-09-30 : garde-corps
 * partiel sur l'intervalle de la volée qui borde un vide hors du jour). Le bord est échantillonné
 * tous les `SPLIT_SAMPLE_STEP` mm, chaque changement étant affiné par dichotomie. Rend les
 * sous-intervalles dans l'ordre ; vide si toute la portion est dans le jour.
 */
export function outsideNarrowJour(
  points: readonly Vec2[],
  cum: readonly number[],
  from: Mm,
  to: Mm,
  zones: readonly NarrowJourZone[],
): { from: Mm; to: Mm }[] {
  const out = (u: Mm): boolean => !inNarrowJour(pointAt(points, cum, u), zones);
  const boundary = (a: Mm, b: Mm): Mm => {
    // out(a) ≠ out(b) : dichotomie.
    const oa = out(a);
    let lo = a;
    let hi = b;
    while (hi - lo > SPLIT_PRECISION) {
      const mid = (lo + hi) / 2;
      if (out(mid) === oa) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const result: { from: Mm; to: Mm }[] = [];
  if (!(to > from)) return result;
  const steps = Math.max(1, Math.ceil((to - from) / SPLIT_SAMPLE_STEP));
  let prevU = from;
  let prevOut = out(from);
  let start: Mm | null = prevOut ? from : null;
  for (let i = 1; i <= steps; i++) {
    const u = i === steps ? to : from + ((to - from) * i) / steps;
    const o = out(u);
    if (o !== prevOut) {
      const x = boundary(prevU, u);
      if (o) start = x;
      else if (start !== null) {
        result.push({ from: start, to: x });
        start = null;
      }
    }
    prevU = u;
    prevOut = o;
  }
  if (start !== null) result.push({ from: start, to });
  return result;
}
