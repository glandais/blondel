/**
 * Positions des nez sur la ligne de foulée Γ (équipartition des girons, B §0.3, §3.1).
 *
 * n hauteurs ⇒ n nez (k = 0 … n − 1) et n_g = n − 1 girons : le nez 0 est sur la ligne de
 * départ (s = 0), le nez n − 1 sur la ligne d'arrivée (s = |Γ|), la dernière hauteur arrive au
 * plancher.
 *
 * Sans palier : g = |Γ| / (n − 1) et s_k = k·g. Escalier droit à longueur `auto` : g est le
 * giron cible (`resolveTargetGoing`, targetGoing ou 630 − 2h), égal à |Γ|/(n − 1) par
 * construction du tracé.
 *
 * Paliers d'angle (`mode: "landing"`) [choix Blondel, à valider] : les nez sont posés **aux
 * bords du palier**, c'est-à-dire aux bornes [sStart ; sEnd] de la zone du tournant sur Γ
 * (bords du carré d'angle E × E pour un jour vif ou un poteau). Le palier est une « marche »
 * (`kind: "landing"`) de giron sEnd − sStart. Le giron nominal vaut
 * g = (longueur de Γ hors paliers) / (nombre de girons hors paliers), avec
 * n_g,droits = n − 1 − (nombre de paliers). Les girons sont répartis entre les parties droites
 * par la méthode du plus fort reste (m_j ≈ a_j / g) ; chaque partie droite est ensuite divisée
 * en m_j girons égaux a_j / m_j. Si les longueurs des volées ne sont pas des multiples de g,
 * les girons diffèrent d'une partie droite à l'autre : c'est signalé dans les notes (le
 * contrôle de conception compare chaque giron au giron nominal). Une partie droite trop courte
 * pour recevoir un giron (m_j = 0) est absorbée par le palier voisin.
 */
import type { Layout } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { curveLength } from "../geom2d/curve.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import { resolveTargetGoing } from "../layout/resolve.js";
import { fmt } from "../rules/check.js";
import { SteppingError } from "./errors.js";

export interface WalkPositions {
  /** Giron nominal sur la ligne de foulée. */
  readonly going: Mm;
  /** Abscisse de chaque nez sur Γ. */
  readonly s: readonly Mm[];
  /** Marches palières : indice k de la marche comprise entre les nez k et k + 1. */
  readonly landingTreads: ReadonlySet<number>;
  /** Tournant (indice) de chaque marche palière. */
  readonly landingTurnOf: ReadonlyMap<number, number>;
  readonly notes: readonly string[];
}

type Piece =
  | { readonly kind: "straight"; readonly length: Mm; count: number }
  | { readonly kind: "landing"; readonly end: Mm; readonly turn: number };

export function placeNosings(project: Project, layout: Layout, riserCount: number): WalkPositions {
  const n = riserCount;
  const L = curveLength(layout.walkline);
  const landings = layout.turns.filter((t) => t.mode === "landing");
  const notes: string[] = [];

  if (landings.length === 0) {
    let g = L / (n - 1);
    const legs = project.stair.layout.legs;
    if (legs.length === 1 && legs[0]!.length === "auto") {
      const target = resolveTargetGoing(project, n);
      if (Math.abs(target * (n - 1) - L) <= GEOM_EPS * Math.max(1, L)) g = target;
    }
    const s = Array.from({ length: n }, (_, k) => (k === n - 1 ? L : k * g));
    return { going: g, s, landingTreads: new Set(), landingTurnOf: new Map(), notes };
  }

  // Découpe de Γ : parties droites et paliers.
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const t of landings) {
    pieces.push({ kind: "straight", length: Math.max(0, t.sStart - cursor), count: 0 });
    pieces.push({ kind: "landing", end: t.sEnd, turn: t.index });
    cursor = t.sEnd;
  }
  pieces.push({ kind: "straight", length: Math.max(0, L - cursor), count: 0 });
  const straights = pieces.filter((p): p is Piece & { kind: "straight" } => p.kind === "straight");
  const straightGoings = n - 1 - landings.length;
  const straightLength = straights.reduce((acc, p) => acc + p.length, 0);
  if (straightGoings < 1 || !(straightLength > GEOM_EPS)) {
    throw new SteppingError(
      `Pas assez de hauteurs (${n}) pour ${landings.length} palier(s) : aucun giron droit possible.`,
    );
  }
  const g = straightLength / straightGoings;

  // Plus fort reste.
  const ideal = straights.map((p) => p.length / g);
  straights.forEach((p, i) => (p.count = Math.floor(ideal[i]! + 1e-9)));
  let rest = straightGoings - straights.reduce((acc, p) => acc + p.count, 0);
  const order = straights
    .map((p, i) => ({ i, frac: ideal[i]! - p.count }))
    .sort((a, b) => b.frac - a.frac);
  for (let r = 0; rest > 0; r = (r + 1) % order.length, rest--) straights[order[r]!.i]!.count++;

  const s: Mm[] = [0];
  const landingTreads = new Set<number>();
  const landingTurnOf = new Map<number, number>();
  const goings: Mm[] = [];
  let start = 0;
  for (const p of pieces) {
    if (p.kind === "straight") {
      if (p.count > 0) {
        const gj = p.length / p.count;
        goings.push(gj);
        for (let i = 1; i <= p.count; i++)
          s.push(i === p.count ? start + p.length : start + i * gj);
      }
      start += p.length;
    } else {
      landingTreads.add(s.length - 1);
      landingTurnOf.set(s.length - 1, p.turn);
      s.push(p.end);
      start = p.end;
    }
  }
  // Partie droite finale sans giron : le dernier palier s'étend jusqu'à l'arrivée.
  if (s[s.length - 1]! < L) s[s.length - 1] = L;
  if (s.length !== n) {
    throw new Error(`placeNosings : ${s.length} nez placés pour ${n} hauteurs`);
  }
  if (goings.some((gj) => Math.abs(gj - g) > GEOM_EPS)) {
    notes.push(
      `Paliers : les parties droites ne sont pas des multiples du giron nominal (${fmt(g)} mm) ; girons par partie droite : ${goings.map((x) => fmt(x)).join(" / ")} mm.`,
    );
  }
  if (straights.some((p) => p.count === 0 && p.length > GEOM_EPS)) {
    notes.push(
      "Paliers : une partie droite trop courte pour un giron est rattachée au palier voisin.",
    );
  }
  return { going: g, s, landingTreads, landingTurnOf, notes };
}
