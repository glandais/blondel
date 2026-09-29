/**
 * Zones de balancement par tournant `winders` (CHALLENGE G3, B §3.1, §3.11).
 *
 * - Nez fixes : premier (0), dernier (n − 1), bords des paliers, surcharges `fixed`, et une
 *   **marche virtuelle fixe** dans chaque volée intermédiaire qui contient au moins un giron
 *   entier entre deux tournants balancés (le nez le plus proche du milieu de la partie droite).
 *   Si la partie droite intermédiaire est plus courte qu'un giron (U serré, demi-tournant),
 *   les deux tournants forment une **zone unique** de 180°.
 * - Extrémités : `free` au départ (nez 0), à l'arrivée (nez n − 1), aux bords d'un palier, et
 *   quand la borne de zone tombe **dans la partie tournante** de Γ (s_a > début du tournant,
 *   s_b < fin du tournant : aucune partie droite ne continue, pas de pente à raccorder) ;
 *   `tangent` sinon (une partie droite continue).
 * - Nombre de marches balancées : nb nez balancés avant le milieu du tournant sur Γ, na après.
 *   `windersPerSide` numérique : nb = na = valeur (bornée par les nez fixes). `auto` :
 *   énumération des couples (nb, na) ∈ [0 ; 8]² (8 = maximum de `windersPerSide` dans le
 *   schéma) compatibles avec les nez fixes et avec l'**étendue maximale** K7
 *   (`maxBalancedExtent`, défaut `MAX_BALANCED_EXTENT` = 3,5 girons comptés depuis l'angle,
 *   d'après DIN 18065, source étrangère) ; chaque candidat est calculé par la stratégie puis
 *   mesuré. Candidats admissibles : solution trouvée, collets > 0 (corde et arc), aucune
 *   ligne de nez croisée (K5), aucune ligne de nez qui recoupe le jour avant son collet.
 *   Choix (CHALLENGE G3, corrigé le 2026-09-29 : maximiser le collet seul balançait toute une
 *   volée) :
 *   1. si des candidats atteignent le collet cible (`targetCollet`, collet minimal en corde) :
 *      parmi eux, les réguliers (K3 : collets monotones vers l'angle, en corde, et en arc hors
 *      poteau) s'il en existe, puis le **moins** de nez balancés, puis le plus grand collet ;
 *   2. sinon : le collet minimal en corde **maximal**, tous candidats admissibles confondus (la
 *      régularité ne fait pas perdre de collet) ; parmi les candidats à `colletTieTolerance`
 *      (défaut `COLLET_TIE_TOLERANCE` = 1 mm, à valider) du maximum, les réguliers s'il en
 *      existe, puis le moins de nez balancés, puis le plus grand collet ;
 *   3. départages : zone la mieux centrée sur le tournant, puis premier candidat de
 *      l'énumération — choix déterministe et invariant par miroir.
 *   Si aucun candidat de l'étendue K7 n'est admissible (étendue courte, jour étroit), le choix
 *   se fait parmi les zones plus étendues (repli signalé dans les notes) plutôt que de laisser
 *   les nez perpendiculaires (collet nul, lignes croisées au tournant).
 *   Le collet et K3 sont mesurés sur toutes les marches comprises entre les nez fixes
 *   encadrants. L'énumération se fait par nombre croissant de nez balancés et s'arrête dès
 *   qu'un nombre fournit un candidat régulier atteignant la cible (même choix que
 *   l'énumération complète, ADR-0006).
 * - M0 (rayonnant) en `auto` : la zone couvre exactement les nez situés sur l'arc de Γ.
 */
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Layout, NosingLine } from "../model/derived.js";
import type { BalancingStrategy, BalancingZone } from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import {
  applySolution,
  colletBetween,
  monotonyBreaks,
  noCrossing,
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
 * Conditions aux extrémités d'une zone [a ; b] : `free` si le nez est un nez libre (départ,
 * arrivée, bord de palier) ou s'il tombe **dans la partie tournante** du groupe (strictement
 * après le début du tournant pour a, strictement avant sa fin pour b) : aucune partie droite
 * ne continue au-delà, il n'y a donc pas de pente de limon à raccorder. `tangent` sinon.
 */
export function zoneEndConditions(
  ctx: Pick<ZoneContext, "seeds" | "freeNosings">,
  group: Pick<TurnGroup, "sStart" | "sEnd">,
  a: number,
  b: number,
): BalancingZone["ends"] {
  const sa = ctx.seeds[a]!.s;
  const sb = ctx.seeds[b]!.s;
  return [
    ctx.freeNosings.has(a) || sa > group.sStart + GEOM_EPS ? "free" : "tangent",
    ctx.freeNosings.has(b) || sb < group.sEnd - GEOM_EPS ? "free" : "tangent",
  ];
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
    ends: zoneEndConditions(ctx, group, a, b),
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
  const k5 = noCrossing(local);
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
 * Valeur par défaut de `BalancingSchema.colletTieTolerance` : écart de collet (mm) en deçà
 * duquel deux candidats sont jugés équivalents quand aucun candidat n'atteint le collet cible ;
 * parmi les candidats dont le collet minimal en corde est à moins de cette valeur du maximum,
 * on retient les réguliers (K3), puis le moins de nez balancés. [Choix Blondel, à valider : valeur donnée par l'orchestrateur, sans source
 * métier ; précision de traçage d'atelier.] Paramètre du projet, pas un seuil figé.
 */
export const COLLET_TIE_TOLERANCE: Mm = 1;

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
 * Choix parmi les candidats (voir l'en-tête du module, CHALLENGE G3 corrigé) : le moins de nez
 * balancés parmi les candidats qui atteignent `targetCollet` (réguliers K3 d'abord) ; sinon le
 * collet minimal en corde maximal, à `tieTolerance` près (réguliers d'abord, puis le moins de
 * nez balancés). Départages : plus grand collet, zone la mieux centrée sur le tournant (écart
 * |milieu de [s_a ; s_b] − milieu du tournant| sur Γ), puis ordre d'énumération (premier
 * candidat). La tolérance est appliquée **par rapport au maximum** (et non de proche en
 * proche), ce qui garde un choix transitif et invariant par miroir.
 */
export function pickZone(
  cands: readonly ZoneEvaluation[],
  targetCollet: Mm,
  tieTolerance: Mm = COLLET_TIE_TOLERANCE,
): ZoneEvaluation | null {
  if (!(tieTolerance >= 0)) {
    throw new RangeError(`Tolérance d'égalité des collets invalide : ${tieTolerance} mm.`);
  }
  if (!(targetCollet > 0)) {
    throw new RangeError(`Collet cible invalide : ${targetCollet} mm.`);
  }
  const admissible = cands.filter(isAdmissible);
  if (admissible.length === 0) return null;
  const reaching = admissible.filter((e) => reachesTarget(e, targetCollet));
  let pool: readonly ZoneEvaluation[];
  if (reaching.length > 0) pool = reaching;
  else {
    const best = Math.max(...admissible.map((e) => e.minChord));
    pool = admissible.filter((e) => e.minChord >= best - tieTolerance - PICK_EPS);
  }
  const regular = pool.filter((e) => e.k3);
  if (regular.length > 0) pool = regular;
  const key = (e: ZoneEvaluation) => [e.winders, -e.minChord, e.offCenter];
  return pool.reduce((acc, e) => (compareCriteria(key(e), key(acc)) < 0 ? e : acc));
}

/** Le collet minimal en corde du candidat atteint-il la cible (à `PICK_EPS` près) ? */
export function reachesTarget(e: ZoneEvaluation, targetCollet: Mm): boolean {
  return e.minChord >= targetCollet - PICK_EPS;
}

/**
 * Condition d'arrêt de l'énumération par nombre croissant de nez balancés : un candidat
 * admissible, régulier (K3) et atteignant la cible fixe le choix de `pickZone` à ce nombre.
 */
export function settlesChoice(e: ZoneEvaluation, targetCollet: Mm): boolean {
  return isAdmissible(e) && e.k3 && reachesTarget(e, targetCollet);
}

/**
 * Valeur par défaut de `BalancingSchema.maxBalancedExtent` (K7, B §2.4 et §3.1) : étendue
 * maximale des marches balancées dans une partie droite, en girons comptés depuis l'angle.
 * **Source étrangère** : DIN 18065 (norme allemande, citée via une source secondaire, confiance
 * moyenne) limite les marches balancées de la partie droite à 3,5 × a depuis l'angle ; aucune
 * valeur française trouvée. Valeur par défaut à valider, paramètre du projet.
 */
export const MAX_BALANCED_EXTENT = 3.5;

/**
 * Nombres maximaux de nez balancés avant (nb) et après (na) le milieu du tournant permis par
 * l'étendue K7 : la marche balancée la plus basse commence au nez fixe a = kL − nb, qui doit
 * rester à au plus `extent` girons de l'angle (début de la partie tournante de Γ), et de même
 * pour le nez fixe b = kR + na après la fin de la partie tournante (à `GEOM_EPS` près).
 */
export function extentLimits(
  group: Pick<TurnGroup, "sStart" | "sEnd">,
  s: readonly Mm[],
  bounds: Pick<ZoneBounds, "kL" | "kR">,
  going: Mm,
  extent: Mm,
): { before: number; after: number } {
  const reach = extent * going + GEOM_EPS;
  let before = 0;
  while (bounds.kL - before - 1 >= 0 && group.sStart - s[bounds.kL - before - 1]! <= reach) {
    before++;
  }
  let after = 0;
  while (bounds.kR + after + 1 < s.length && s[bounds.kR + after + 1]! - group.sEnd <= reach) {
    after++;
  }
  return { before, after };
}
