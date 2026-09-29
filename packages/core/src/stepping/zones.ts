/**
 * Zones de balancement par tournant `winders` (CHALLENGE G3, B §3.1, §3.11).
 *
 * - Nez fixes : premier (0), dernier (n − 1), bords des paliers, surcharges `fixed`, et une
 *   **marche virtuelle fixe** dans chaque volée intermédiaire qui contient au moins un giron
 *   entier entre deux tournants balancés (le nez le plus proche du milieu de la partie droite).
 *   Si la partie droite intermédiaire est plus courte qu'un giron (U serré, demi-tournant),
 *   les deux tournants forment une **zone unique** de 180° — jamais entre deux tournants de
 *   sens opposés (S / Z : jours de part et d'autre, zone séparée par tournant).
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
 *      parmi eux, les réguliers (K3 : collets monotones vers chaque angle du jour — une vallée
 *      par angle dans une zone unique de 180° —, en corde, et en arc hors poteau) s'il en existe, puis le **moins** de nez balancés, puis le plus grand collet ;
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
import type {
  BalancingInput,
  BalancingStrategy,
  BalancingZone,
  ZoneContinuation,
} from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import {
  applySolution,
  colletBetween,
  cornerMonotonyBreaks,
  cornerPositions,
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
  /**
   * Milieux sur Γ de chaque tournant du groupe (un angle du jour par tournant) : K3 est évalué
   * **par angle** (`cornerMonotonyBreaks`), une zone unique de 180° ayant deux vallées (angles
   * hors de la plage des nez de la zone ignorés, comme dans le contrôle de conception).
   */
  readonly corners: readonly Mm[];
  /**
   * Nez fixes « de poteau » qui bornent le groupe (zones par angle, voir `groupWinderTurns`).
   * Absent : aucun.
   */
  readonly posts?: readonly number[];
  /** Côté du jour des tournants du groupe (tous du même côté). */
  readonly side: "left" | "right";
  /**
   * Un tournant du groupe a un poteau d'angle : le limon est interrompu par le poteau (deux
   * pièces assemblées dans le poteau), la courbe F n'est pas prolongée à travers le tournant
   * (`zoneContinuation`). Absent : aucun poteau.
   */
  readonly newel?: true;
}

/**
 * Nez fixe imposé par un poteau d'angle (B §3.1 : « marche imposée par un poteau » ; K6 :
 * marche d'angle de préférence sur la bissectrice) : nez de la partie tournante de Γ le plus
 * proche du milieu du tournant. Γ y est un arc centré sur le poteau, la ligne perpendiculaire
 * vise donc le centre du poteau. `-1` : aucun nez strictement dans la partie tournante.
 */
export function postNosing(s: readonly Mm[], sStart: Mm, sEnd: Mm): number {
  const mid = (sStart + sEnd) / 2;
  let best = -1;
  s.forEach((sk, k) => {
    if (!(sk > sStart + GEOM_EPS && sk < sEnd - GEOM_EPS)) return;
    if (best < 0 || Math.abs(sk - mid) < Math.abs(s[best]! - mid)) best = k;
  });
  return best;
}

/** Options de `groupWinderTurns`. */
export interface GroupOptions {
  /** Indices des tournants à **poteau d'angle** (`inner.kind = "newel"`). */
  readonly posts?: ReadonlySet<number>;
  /**
   * Zones **par angle** au droit des poteaux : le nez du poteau (`postNosing`) devient fixe et
   * libre (les deux limons sont des pièces distinctes assemblées dans le poteau, B §1 : aucun
   * raccord de pente à travers le poteau) ; le tournant est balancé par **deux** zones, une de
   * chaque côté du poteau, et deux poteaux voisins ne forment jamais une zone unique de 180°.
   */
  readonly perAngle?: boolean;
  /** Nez libres (complétés par les nez de poteau). */
  readonly free?: Set<number>;
}

/**
 * Regroupe les tournants balancés (zone unique si la partie droite intermédiaire mesure moins
 * d'un giron) et ajoute les marches virtuelles fixes aux nez fixes. Tournant à poteau
 * (`options.posts`) : nez du poteau fixe, un groupe de chaque côté du poteau (le groupe d'après
 * peut fusionner avec celui d'avant le poteau suivant, entre deux nez de poteau).
 */
export function groupWinderTurns(
  layout: Layout,
  s: readonly Mm[],
  going: Mm,
  fixed: Set<number>,
  options: GroupOptions = {},
): TurnGroup[] {
  const winders = layout.turns.filter((t) => t.mode === "winders");
  type Segment = {
    turn: number;
    sStart: Mm;
    sEnd: Mm;
    corner: Mm;
    post?: number;
    /** Premier segment du tournant (raccord possible avec le groupe précédent). */
    head: boolean;
    /** Côté du jour du tournant. */
    side: "left" | "right";
  };
  const segments: Segment[] = [];
  for (const t of winders) {
    const mid = (t.sStart + t.sEnd) / 2;
    const side = t.collarSide ?? t.direction;
    const kc =
      options.perAngle && options.posts?.has(t.index) ? postNosing(s, t.sStart, t.sEnd) : -1;
    if (kc < 0) {
      segments.push({
        turn: t.index,
        sStart: t.sStart,
        sEnd: t.sEnd,
        corner: mid,
        head: true,
        side,
      });
      continue;
    }
    fixed.add(kc);
    options.free?.add(kc);
    const sk = s[kc]!;
    segments.push({
      turn: t.index,
      sStart: t.sStart,
      sEnd: sk,
      corner: mid,
      post: kc,
      head: true,
      side,
    });
    segments.push({
      turn: t.index,
      sStart: sk,
      sEnd: t.sEnd,
      corner: mid,
      post: kc,
      head: false,
      side,
    });
  }
  const groups: {
    first: number;
    last: number;
    sStart: Mm;
    sEnd: Mm;
    corners: Mm[];
    posts: number[];
    /** Le groupe se termine au nez d'un poteau (segment « après le poteau »). */
    endsAtPost: boolean;
    newel: boolean;
    side: "left" | "right";
  }[] = [];
  for (const seg of segments) {
    const prev = groups[groups.length - 1];
    if (seg.head && prev && prev.last === seg.turn - 1) {
      const gapStart = prev.sEnd;
      const gapEnd = seg.sStart;
      const fixedInside = [...fixed].some(
        (k) => s[k]! > gapStart - GEOM_EPS && s[k]! < gapEnd + GEOM_EPS,
      );
      // Entre deux poteaux, le limon intermédiaire est une seule pièce droite, assemblée dans
      // les deux poteaux : une zone entre les deux nez de poteau, sans marche virtuelle fixe.
      const betweenPosts = seg.post !== undefined && prev.endsAtPost;
      // S / Z : jamais de zone unique à travers deux jours opposés (le découpage refuse une
      // partie droite intermédiaire de moins d'un giron, CHALLENGE G3).
      const sameSide = seg.side === prev.side;
      if ((gapEnd - gapStart < going - GEOM_EPS || betweenPosts) && !fixedInside && sameSide) {
        prev.last = seg.turn;
        prev.sEnd = seg.sEnd;
        prev.endsAtPost = false;
        if (options.posts?.has(seg.turn)) prev.newel = true;
        if (!prev.corners.includes(seg.corner)) prev.corners.push(seg.corner);
        if (seg.post !== undefined) prev.posts.push(seg.post);
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
    groups.push({
      first: seg.turn,
      last: seg.turn,
      sStart: seg.sStart,
      sEnd: seg.sEnd,
      corners: [seg.corner],
      posts: seg.post !== undefined ? [seg.post] : [],
      endsAtPost: seg.post !== undefined && !seg.head,
      newel: options.posts?.has(seg.turn) ?? false,
      side: seg.side,
    });
  }
  return groups.map(({ posts, endsAtPost: _endsAtPost, newel, ...g }) => ({
    ...g,
    sMid: (g.sStart + g.sEnd) / 2,
    ...(posts.length > 0 ? { posts } : {}),
    ...(newel ? { newel: true as const } : {}),
  }));
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
 * Prolongement de la courbe F au-delà d'une extrémité libre **située dans la partie tournante**
 * (`BalancingZone.continuation`) : les nez non balancés qui suivent la borne sont des points
 * fixes du limon développé, que F doit traverser sans cassure. Le prolongement s'arrête au
 * premier nez de la partie droite (`tangent` : pente de la marche suivante), ou à un nez fixe
 * (borne encadrante, poteau, départ, arrivée, palier : `free`). Une extrémité libre par nature
 * (nez libre) n'est pas prolongée.
 */
export function zoneContinuation(
  ctx: Pick<ZoneContext, "seeds" | "freeNosings">,
  group: Pick<TurnGroup, "sStart" | "sEnd">,
  a: number,
  b: number,
  ends: BalancingZone["ends"],
  range: { readonly lo: number; readonly hi: number },
): NonNullable<BalancingZone["continuation"]> | undefined {
  const n = ctx.seeds.length;
  const free = ctx.freeNosings;
  let before: ZoneContinuation | null = null;
  let after: ZoneContinuation | null = null;
  if (ends[0] === "free" && !free.has(a) && a > 0) {
    const list: number[] = [];
    let end: "tangent" | "free" = "free";
    for (let k = a - 1; k >= 0; k--) {
      list.push(k);
      if (ctx.seeds[k]!.s <= group.sStart + GEOM_EPS) {
        end = k > 0 && !free.has(k) ? "tangent" : "free";
        break;
      }
      if (free.has(k) || k <= range.lo) break;
    }
    before = { nosings: list, end };
  }
  if (ends[1] === "free" && !free.has(b) && b < n - 1) {
    const list: number[] = [];
    let end: "tangent" | "free" = "free";
    for (let k = b + 1; k < n; k++) {
      list.push(k);
      if (ctx.seeds[k]!.s >= group.sEnd - GEOM_EPS) {
        end = k < n - 1 && !free.has(k) ? "tangent" : "free";
        break;
      }
      if (free.has(k) || k >= range.hi) break;
    }
    after = { nosings: list, end };
  }
  return before || after ? [before, after] : undefined;
}

/** Entrée des stratégies pour une zone (tracé de développement, nez initiaux). */
export function balancingInput(ctx: ZoneContext, zone: BalancingZone): BalancingInput {
  return {
    layout: ctx.devLayout,
    nosings: ctx.devNosings,
    zone,
    z: ctx.z,
    rise: ctx.rise,
    going: ctx.going,
    params: ctx.params,
  };
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
  const ends = zoneEndConditions(ctx, group, a, b);
  const continuation = group.newel
    ? undefined
    : zoneContinuation(ctx, group, a, b, ends, {
        lo: Math.min(range.lo, a),
        hi: Math.max(range.hi, b),
      });
  let zone: BalancingZone = {
    turn: group.first,
    ...(group.last !== group.first ? { lastTurn: group.last } : {}),
    from: a,
    to: b,
    collarSide: ctx.collarSide,
    ends,
    ...(continuation ? { continuation } : {}),
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
    solution = ctx.strategy.solve(balancingInput(ctx, zone));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  // Prolongement abandonné par la stratégie (spline non croissante) : zone déclarée sans.
  if (zone.continuation && (solution.kind !== "sigma" || solution.continued !== true)) {
    const { continuation: _dropped, ...plain } = zone;
    zone = plain;
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
  // K3 **par angle** (une vallée autour de chaque angle du jour) sur les cordes (grandeur du
  // contrôle de conception) et, sauf jour de développement virtuel (poteau : l'arc réel
  // contourne le poteau), sur les arcs.
  const virtualJour = ctx.devLayout.inner !== ctx.layout.inner;
  const corners = cornerPositions(
    local.map((nl) => nl.s),
    group.corners,
  );
  const k3 =
    cornerMonotonyBreaks(chords, corners).length === 0 &&
    (virtualJour || cornerMonotonyBreaks(arcs, corners).length === 0);
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
