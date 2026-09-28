/**
 * Zones de balancement par tournant `winders` (CHALLENGE G3, B §3.1, §3.11).
 *
 * - Nez fixes : premier (0), dernier (n − 1), bords des paliers, surcharges `fixed`, et une
 *   **marche virtuelle fixe** dans chaque volée intermédiaire qui contient au moins un giron
 *   entier entre deux tournants balancés (le nez le plus proche du milieu de la partie droite).
 *   Si la partie droite intermédiaire est plus courte qu'un giron (U serré, demi-tournant),
 *   les deux tournants forment une **zone unique** de 180°.
 * - Extrémités : `free` au départ (nez 0), à l'arrivée (nez n − 1) et aux bords d'un palier ;
 *   `tangent` sinon (une partie droite continue).
 * - Nombre de marches balancées : nb nez balancés avant le milieu du tournant sur Γ, na après.
 *   `windersPerSide` numérique : nb = na = valeur (bornée par les nez fixes). `auto` :
 *   énumération de tous les couples (nb, na) ∈ [0 ; 8]² compatibles avec les nez fixes (8 =
 *   maximum de `windersPerSide` dans le schéma) ; chaque candidat est calculé par la stratégie
 *   puis mesuré. Candidats admissibles : solution trouvée, collets > 0 (corde et arc), aucune
 *   ligne de nez croisée (K5), aucune ligne de nez qui recoupe le jour avant son collet. Choix [interprétation de CHALLENGE G3 et de `BalancingSchema`] :
 *   0. on ne garde que les candidats « réguliers » s'il en existe : collets monotones vers
 *      l'angle (K3, en corde, et en arc hors poteau) ;
 *   1. si des candidats atteignent `targetCollet` (collet minimal **mesuré en corde**), on
 *      retient le plus petit nombre de nez balancés (à égalité, le plus grand collet) ;
 *   2. sinon, celui qui **maximise** le collet minimal en corde (à égalité, le moins de nez
 *      balancés) ;
 *   3. égalités (collets comparés à 1e-6 mm près) : zone la mieux centrée sur le tournant,
 *      puis premier candidat de l'énumération — choix déterministe et invariant par miroir.
 *   Le collet et K3 sont mesurés sur toutes les marches comprises entre les nez fixes
 *   encadrants.
 * - M0 (rayonnant) en `auto` : la zone couvre exactement les nez situés sur l'arc de Γ.
 */
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Layout, NosingLine } from "../model/derived.js";
import type { BalancingStrategy, BalancingZone } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import {
  applySolution,
  colletBetween,
  findCrossings,
  monotonyBreaks,
  type NosingSeed,
} from "../balancing/postprocess.js";

/** Maximum de `windersPerSide` (`BalancingSchema`) : borne de l'énumération. */
export const WINDERS_PER_SIDE_MAX = 8;

/** Groupe de tournants balancés traités par une même zone. */
export interface TurnGroup {
  readonly first: number;
  readonly last: number;
  /** Milieu de la partie tournante sur Γ. */
  readonly sMid: Mm;
  readonly sStart: Mm;
  readonly sEnd: Mm;
}

/**
 * Regroupe les tournants balancés (zone unique si la partie droite intermédiaire mesure moins
 * d'un giron) et ajoute les marches virtuelles fixes aux nez fixes.
 */
export function groupWinderTurns(
  layout: Layout,
  s: readonly Mm[],
  going: Mm,
  fixed: Set<number>,
): TurnGroup[] {
  const winders = layout.turns.filter((t) => t.mode === "winders");
  const groups: { first: number; last: number; sStart: Mm; sEnd: Mm }[] = [];
  for (const t of winders) {
    const prev = groups[groups.length - 1];
    if (prev && prev.last === t.index - 1) {
      const gapStart = prev.sEnd;
      const gapEnd = t.sStart;
      const fixedInside = [...fixed].some(
        (k) => s[k]! > gapStart - GEOM_EPS && s[k]! < gapEnd + GEOM_EPS,
      );
      if (gapEnd - gapStart < going - GEOM_EPS && !fixedInside) {
        prev.last = t.index;
        prev.sEnd = t.sEnd;
        continue;
      }
      if (!fixedInside) {
        // Marche virtuelle fixe : nez de la partie droite le plus proche de son milieu.
        const mid = (gapStart + gapEnd) / 2;
        let best = -1;
        s.forEach((sk, k) => {
          if (sk < gapStart - GEOM_EPS || sk > gapEnd + GEOM_EPS) return;
          if (best < 0 || Math.abs(sk - mid) < Math.abs(s[best]! - mid)) best = k;
        });
        if (best >= 0) fixed.add(best);
      }
    }
    groups.push({ first: t.index, last: t.index, sStart: t.sStart, sEnd: t.sEnd });
  }
  return groups.map((g) => ({ ...g, sMid: (g.sStart + g.sEnd) / 2 }));
}

export interface ZoneBounds {
  /** Dernier nez avant (ou au) milieu du tournant, et le suivant. */
  readonly kL: number;
  readonly kR: number;
  /** Nez fixes encadrants (bornes de a et b). */
  readonly lo: number;
  readonly hi: number;
}

export function zoneBounds(
  group: TurnGroup,
  s: readonly Mm[],
  fixed: ReadonlySet<number>,
): ZoneBounds {
  let kL = 0;
  for (let k = 0; k < s.length; k++) if (s[k]! <= group.sMid) kL = k;
  const kR = Math.min(s.length - 1, kL + 1);
  let lo = 0;
  let hi = s.length - 1;
  for (const f of fixed) {
    if (f <= kL && f > lo) lo = f;
    if (f >= kR && f < hi) hi = f;
  }
  return { kL, kR, lo, hi };
}

export interface ZoneContext {
  readonly layout: Layout;
  /** Tracé vu par les stratégies : jour de développement (`development.ts`). */
  readonly devLayout: Layout;
  /** Nez initiaux mesurés sur le jour de développement (σ des collets). */
  readonly devNosings: readonly NosingLine[];
  readonly seeds: readonly NosingSeed[];
  /** Nez courants (perpendiculaires hors zones déjà traitées). */
  readonly nosings: readonly NosingLine[];
  readonly z: readonly Mm[];
  readonly rise: Mm;
  readonly going: Mm;
  readonly strategy: BalancingStrategy;
  readonly params: Readonly<Record<string, unknown>>;
  readonly freeNosings: ReadonlySet<number>;
  readonly collarSide: "left" | "right";
}

export interface ZoneEvaluation {
  readonly zone: BalancingZone;
  readonly ok: boolean;
  readonly reason?: string;
  /** Lignes des nez from+1 … to−1. */
  readonly nosings: readonly NosingLine[];
  readonly corrected: readonly number[];
  readonly minChord: Mm;
  readonly minArc: Mm;
  readonly k5: boolean;
  readonly k3: boolean;
  readonly winders: number;
  /** Décentrement de la zone : |(s_a + s_b)/2 − milieu du tournant| sur Γ (départage). */
  readonly offCenter: Mm;
}

/**
 * Calcule et mesure une zone candidate [a ; b]. Les collets, K5 et K3 sont mesurés sur toutes
 * les marches comprises entre les nez fixes encadrants [lo ; hi] (les marches du tournant
 * laissées hors de la zone comptent : un nez rayonnant au coin vif donne un collet nul).
 */
export function evaluateZone(
  ctx: ZoneContext,
  group: TurnGroup,
  a: number,
  b: number,
  range: { readonly lo: number; readonly hi: number },
): ZoneEvaluation {
  const zone: BalancingZone = {
    turn: group.first,
    ...(group.last !== group.first ? { lastTurn: group.last } : {}),
    from: a,
    to: b,
    collarSide: ctx.collarSide,
    ends: [
      ctx.freeNosings.has(a) ? "free" : "tangent",
      ctx.freeNosings.has(b) ? "free" : "tangent",
    ],
  };
  const offCenter = Math.abs((ctx.seeds[a]!.s + ctx.seeds[b]!.s) / 2 - group.sMid);
  const fail = (reason: string): ZoneEvaluation => ({
    zone,
    ok: false,
    reason,
    nosings: [],
    corrected: [],
    minChord: -Infinity,
    minArc: -Infinity,
    k5: false,
    k3: false,
    winders: b - a - 1,
    offCenter,
  });
  let solution;
  try {
    solution = ctx.strategy.solve({
      layout: ctx.devLayout,
      nosings: ctx.devNosings,
      zone,
      z: ctx.z,
      rise: ctx.rise,
      going: ctx.going,
      params: ctx.params,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const applied = applySolution(ctx.layout, ctx.seeds, zone, solution, ctx.devLayout.inner);
  if (!applied.ok) return fail(applied.reason);
  const lo = Math.min(range.lo, a);
  const hi = Math.max(range.hi, b);
  const local = ctx.nosings.slice(lo, hi + 1);
  applied.nosings.forEach((nl) => (local[nl.index - lo] = nl));
  const collets = local.slice(0, -1).map((nl, i) => colletBetween(nl, local[i + 1]!));
  const chords = collets.map((c) => c.chord);
  const arcs = collets.map((c) => c.arc);
  const k5 = findCrossings(local).length === 0;
  // K3 sur les cordes (grandeur du contrôle de conception) et, sauf jour de développement
  // virtuel (poteau : l'arc réel contourne le poteau), sur les arcs.
  const virtualJour = ctx.devLayout.inner !== ctx.layout.inner;
  const k3 =
    monotonyBreaks(chords).length === 0 && (virtualJour || monotonyBreaks(arcs).length === 0);
  return {
    zone,
    ok: true,
    nosings: applied.nosings,
    corrected: applied.corrected,
    minChord: Math.min(...chords),
    minArc: Math.min(...arcs),
    k5,
    k3,
    winders: b - a - 1,
    offCenter,
  };
}

/**
 * Candidat admissible : solution, collets > 0 en corde et en arc, K5, et aucune ligne de nez
 * qui recoupe le jour avant le collet calculé (la ligne traverserait le vide du jour).
 */
export function isAdmissible(e: ZoneEvaluation): boolean {
  return e.ok && e.k5 && e.corrected.length === 0 && e.minChord > GEOM_EPS && e.minArc > GEOM_EPS;
}

/** Tolérance de comparaison des collets entre candidats (bruit d'arrondi, mm). */
const PICK_EPS: Mm = 1e-6;

/**
 * Comparaison lexicographique de critères numériques « plus petit = meilleur », à `PICK_EPS`
 * près : négatif si `x` est meilleur que `y`, 0 si indiscernables.
 */
function compareCriteria(x: readonly number[], y: readonly number[]): number {
  for (let i = 0; i < x.length; i++) {
    const d = x[i]! - y[i]!;
    if (Math.abs(d) > PICK_EPS) return d;
  }
  return 0;
}

/**
 * Choix parmi les candidats (voir l'en-tête du module). Les comparaisons de collets se font à
 * `PICK_EPS` près et les égalités sont départagées de façon déterministe : zone la mieux
 * centrée sur le tournant (écart |milieu de [s_a ; s_b] − milieu du tournant| sur Γ), puis
 * ordre d'énumération (premier candidat). Sans cette tolérance, deux candidats symétriques
 * (tournant médian) ou équivalents (nez déjà quasi perpendiculaires) étaient départagés par le
 * bruit d'arrondi : l'escalier et son miroir gauche/droite recevaient des zones différentes.
 */
export function pickZone(
  cands: readonly ZoneEvaluation[],
  targetCollet: Mm,
): ZoneEvaluation | null {
  const admissible = cands.filter(isAdmissible);
  if (admissible.length === 0) return null;
  const quality = admissible.filter((e) => e.k3);
  const pool = quality.length > 0 ? quality : admissible;
  const reaching = pool.filter((e) => e.minChord >= targetCollet - GEOM_EPS);
  const key =
    reaching.length > 0
      ? (e: ZoneEvaluation) => [e.winders, -e.minChord, e.offCenter]
      : (e: ZoneEvaluation) => [-e.minChord, e.winders, e.offCenter];
  const candidates = reaching.length > 0 ? reaching : pool;
  return candidates.reduce((best, e) => (compareCriteria(key(e), key(best)) < 0 ? e : best));
}
