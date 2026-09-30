/**
 * Étape 2 du pipeline : le **tracé** (`computeLayout(project) → Layout`).
 *
 * Topologie explicite (docs/CHALLENGE.md G1) : N volées droites reliées par N − 1 tournants à
 * 90°, de même sens (quart tournant, U, demi-tournant) ou de sens opposés (S / Z). Les deux
 * bords et la ligne de foulée Γ sont construits **en forme fermée**, tournant par tournant
 * (droite / arc / droite), sans décalage générique de courbe.
 *
 * ## Repère local (voir `LayoutSpecSchema`)
 *
 * Départ sur le segment (0,0)–(E,0), montée selon +Y, x = 0 côté gauche. Pour chaque volée on
 * note A son origine sur le bord **gauche** (sur sa ligne de départ), u sa direction de montée
 * et r la normale unitaire gauche → droite. La longueur L d'une volée est mesurée hors tout le
 * long de u, carrés d'angle compris (c'est la longueur au mur pour un quart tournant ou un U) :
 * deux volées successives se recouvrent sur le carré d'angle E × E. Tournant à gauche :
 * u' = −r, coin intérieur K = A + (L − E)·u (bord gauche), coin du mur W = A + L·u + E·r.
 * Tournant à droite : u' = r, K = A + (L − E)·u + E·r (bord droit), W = A + L·u.
 *
 * ## Côtés du jour, S / Z (CHALLENGE G1)
 *
 * Chaque tournant a son jour (collet) du côté de son sens (`TurnZone.collarSide`). Chaque bord
 * porte le raccord de jour des tournants de son côté et l'angle vif du mur des autres.
 * `Layout.inner` est le bord du côté du jour du **premier** tournant (`innerSide`) et
 * `Layout.outer` l'autre, sur toute la montée : dans un S / Z, le jour du second tournant est
 * donc porté par `outer`.
 *
 * Ligne de foulée d'un S / Z : d_f est mesurée depuis le jour du tournant voisin. Quand
 * d_f = E/2 (E ≤ 1 200 mm en DTU), Γ reste au milieu, sans transition. Sinon (E > 1 200 mm :
 * 600 mm du côté intérieur, ou distance saisie) la position change de côté dans la volée
 * intermédiaire : **raccord linéaire** de d_f le long de la partie droite de cette volée
 * [défaut Blondel, DTU muet, point en suspens du ledger] — Γ y est un segment oblique, anguleux
 * à ses extrémités (`Layout.walklineTransitions`, angle signalé par le découpage). Une volée
 * intermédiaire sans partie droite de Γ est alors refusée (`LayoutError`) ; une partie droite
 * de moins d'un giron est refusée par le découpage (CHALLENGE G3 : pas de zone unique à travers
 * deux jours opposés).
 *
 * Escalier droit (décision A16) : d_f est mesurée depuis le bord gauche ou droit
 * (`stair.walkline.side`, sinon côté de la main courante principale, `walklineSide.ts`),
 * rendu dans `Layout.walklineSide` ; `innerSide` reste `left`.
 *
 * ## Raccords de jour (par tournant)
 *
 * - `sharp` : C_i a un angle vif en K ; Γ est l'arc de rayon d_f centré sur K (B §2.1 : « arc
 *   de cercle dont le centre est le point à l'intersection des faces internes des limons »).
 * - `arc` (rayon r) : C_i est raccordé par un arc de rayon r tangent aux deux faces internes,
 *   de centre F = K − r·n − r·u (dans le jour) ; Γ est l'arc concentrique de rayon r + d_f.
 *   Les parties droites de C_i et de Γ s'arrêtent à r avant K (points de tangence).
 * - `newel` (poteau carré de côté a, centré sur K, contrat `InnerCornerSchema`) : C_i suit le
 *   contour du poteau côté escalier (deux décrochements de a/2 dans les volées, puis les deux
 *   faces du poteau tournées vers l'escalier) ; Γ est l'arc de rayon d_f centré sur K, c'est-à-
 *   dire sur le point d'intersection des faces internes des limons (règle DTU ci-dessus), qui
 *   est ici le centre du poteau. Γ est donc identique au cas `sharp` ; sa distance au poteau
 *   est d_f − a·√2/2 au droit du coin du poteau (on exige d_f > a·√2/2).
 *   Poteau **décalé vers le jour** de δ (`offset`, poteau élargi des profilés, décision A13) :
 *   même contour avec des décrochements de s = a/2 + δ le long des faces et un débord de
 *   p = a/2 − δ côté marches (`newel.ts`) ; on exige δ < a/2 et d_f > p·√2.
 *
 * Le bord du mur reste toujours à angle vif en W.
 *
 * ## Palier d'angle (`mode: "landing"`)
 *
 * Choix : Γ garde **le même arc** que pour des marches balancées (et non un tracé en L). La
 * ligne de foulée ne dépend ainsi que de l'épure (même Γ quand on bascule balancé ↔ palier,
 * cf. CHALLENGE P2), reste continue en tangente et à distance d_f du jour. La zone du palier
 * est l'intervalle [sStart, sEnd] de la partie courbe : avec un jour à angle vif, les droites
 * perpendiculaires à Γ en sStart et sEnd sont exactement les bords du carré d'angle E × E.
 * Le découpage ne place aucun nez strictement à l'intérieur de cet intervalle.
 *
 * ## Emprise (`footprint`)
 *
 * Surface utile entre C_i et C_e, fermée par les lignes de départ et d'arrivée (polygone CCW,
 * arcs discrétisés à 0,1 mm de flèche). Le poteau et les limons (hors emmarchement utile,
 * CHALLENGE A3) n'en font pas partie.
 */
import type { Layout, TurnZone, WalklineTransition } from "../model/derived.js";
import type { Curve2, CurveSeg, Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { InnerCorner, Project, Turn } from "../model/project.js";
import {
  flattenCurve,
  makeCurve,
  reverseCurve,
  rotateCurve,
  translateCurve,
} from "../geom2d/curve.js";
import { ensureCCW } from "../geom2d/polygon.js";
import { arcSeg, lineSeg } from "../geom2d/segment.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { LayoutError } from "./errors.js";
import { newelOffset, newelProtrusion, newelSetback } from "./newel.js";
import { computeHelicalLayout } from "./helical.js";
import { resolveLegLengths, resolveWalklineOffset } from "./resolve.js";
import { resolveWalklineSide } from "./walklineSide.js";

export interface LayoutOptions {
  /**
   * Longueurs des volées déjà résolues (bord extérieur, mm). Remplacent celles du projet
   * (utile à l'assistant ou quand l'appelant a résolu `auto` lui-même). Sinon :
   * `resolveLegLengths(project)`.
   */
  readonly legLengths?: readonly Mm[];
}

/** Repère d'une volée dans le repère local. */
interface LegFrame {
  /** Origine sur le bord **gauche** (dans le sens de la montée), sur la ligne de départ. */
  readonly left: Vec2;
  /** Direction de montée (unitaire). */
  readonly u: Vec2;
  /** Normale unitaire gauche → droite. */
  readonly r: Vec2;
  readonly length: Mm;
}

/** Retrait de la partie droite de C_i de part et d'autre du coin intérieur K. */
function innerSetback(inner: InnerCorner): Mm {
  switch (inner.kind) {
    case "sharp":
      return 0;
    case "arc":
      return inner.radius;
    case "newel":
      return newelSetback(inner);
  }
}

/** Retrait de la partie droite de Γ de part et d'autre de K (rayon du raccord de jour). */
function walkSetback(inner: InnerCorner): Mm {
  return inner.kind === "arc" ? inner.radius : 0;
}

const legLabel = (i: number): string => `volée ${i + 1}`;

type Side = "left" | "right";

/**
 * Calcule le tracé (bords, ligne de foulée, tournants, emprise) d'un projet, en repère monde.
 * Un tracé hélicoïdal (`kind: "helical"`) est délégué à `computeHelicalLayout`.
 *
 * @throws LayoutError si la topologie n'est pas prise en charge (nombre de tournants
 *   incohérent, `auto` hors escalier droit) ou si les cotes sont impossibles (volée trop courte
 *   pour ses raccords ou pour la transition de la ligne de foulée d'un S, ligne de foulée hors
 *   emmarchement ou traversant un poteau).
 */
export function computeLayout(project: Project, options: LayoutOptions = {}): Layout {
  const spec = project.stair.layout;
  // Tracé hélicoïdal (jalon 5a) : forme fermée propre, `layout/helical.ts`.
  if (spec.kind === "helical") return computeHelicalLayout(project, spec);
  const width = spec.width;
  const turns = spec.turns;
  const legCount = spec.legs.length;

  if (turns.length !== legCount - 1) {
    throw new LayoutError(
      `Le tracé doit compter exactement un tournant de moins que de volées (${legCount} volées, ${turns.length} tournants).`,
    );
  }
  const lengths = options.legLengths ? [...options.legLengths] : resolveLegLengths(project);
  if (lengths.length !== legCount) {
    throw new LayoutError(
      `${lengths.length} longueurs de volées fournies pour ${legCount} volées.`,
    );
  }
  lengths.forEach((l, i) => {
    if (!(Number.isFinite(l) && l > 0)) {
      throw new LayoutError(`Longueur de la ${legLabel(i)} invalide (${l} mm).`);
    }
  });

  // Côté intérieur : jour du premier tournant (S / Z : le second tournant a son jour en face).
  const innerSide: Side = turns[0]?.direction ?? "left";

  const df = resolveWalklineOffset(project);
  for (const [j, t] of turns.entries()) {
    if (t.inner.kind === "newel") {
      const offset = newelOffset(t.inner);
      if (!(offset < t.inner.size / 2)) {
        throw new LayoutError(
          `Tournant ${j + 1} : le décalage du poteau vers le jour (${offset} mm) doit rester inférieur à son demi-côté (${t.inner.size / 2} mm).`,
        );
      }
      // Sommet du poteau côté marches (p, p) : le plus proche de Γ (arc de rayon d_f centré en K).
      const reach = newelProtrusion(t.inner) * Math.SQRT2;
      if (!(df > reach)) {
        throw new LayoutError(
          `Tournant ${j + 1} : la ligne de foulée (${df} mm du jour) traverse le poteau de ${t.inner.size} mm (il faut plus de ${reach.toFixed(1)} mm).`,
        );
      }
    }
  }

  // Repères des volées (bord gauche). Tournant à gauche : u' = −r, le coin intérieur K est sur
  // le bord gauche ; à droite : u' = r, K est sur le bord droit. Dans les deux cas K est à
  // l'abscisse L − E de la volée entrante et E de la volée sortante.
  const legs: LegFrame[] = [];
  {
    let left: Vec2 = V.vec(0, 0);
    let u: Vec2 = V.vec(0, 1);
    let r: Vec2 = V.vec(1, 0);
    lengths.forEach((length, i) => {
      legs.push({ left, u, r, length });
      const turn = turns[i];
      if (turn !== undefined) {
        if (turn.direction === "left") {
          left = V.addScaled(V.addScaled(left, u, length - width), r, width);
          const u2 = V.scale(r, -1);
          r = u;
          u = u2;
        } else {
          left = V.addScaled(left, u, length);
          const u2 = r;
          r = V.scale(u, -1);
          u = u2;
        }
      }
    });
  }

  // Longueur disponible de chaque volée pour ses parties droites.
  legs.forEach((leg, i) => {
    const before = i > 0 ? width + innerSetback(turns[i - 1]!.inner) : 0;
    const after = i < turns.length ? width + innerSetback(turns[i]!.inner) : 0;
    const required = before + after;
    if (leg.length < required - GEOM_EPS) {
      throw new LayoutError(
        `La ${legLabel(i)} est trop courte : ${leg.length} mm mesurés au mur, il faut au moins ${required} mm (emmarchement et raccords de jour).`,
      );
    }
  });

  /** Point de la volée i à l'abscisse t (le long de u) et à la distance o du bord gauche. */
  const at = (leg: LegFrame, t: Mm, o: Mm): Vec2 =>
    V.addScaled(V.addScaled(leg.left, leg.u, t), leg.r, o);

  // Emprises dégénérées (dette D3), signalées sans bloquer le calcul (`Layout.errors`).
  const layoutErrors = degenerateFootprint(legs, turns, width, at);
  /** Coin intérieur K du tournant j (intersection des faces internes des limons). */
  const cornerOf = (j: number): Vec2 => {
    const leg = legs[j]!;
    return at(leg, leg.length - width, turns[j]!.direction === "left" ? 0 : width);
  };
  /** Coin extérieur W du tournant j (mur, angle vif). */
  const wallCornerOf = (j: number): Vec2 => {
    const leg = legs[j]!;
    return at(leg, leg.length, turns[j]!.direction === "left" ? width : 0);
  };
  /** Normale unitaire jour → mur de la volée entrante du tournant j. */
  const collarNormal = (j: number): Vec2 =>
    turns[j]!.direction === "left" ? legs[j]!.r : V.scale(legs[j]!.r, -1);

  /** Ajoute la droite [a, b] si elle n'est pas dégénérée ; renvoie la longueur ajoutée. */
  const pushLine = (segs: CurveSeg[], a: Vec2, b: Vec2): Mm => {
    const length = V.distance(a, b);
    if (length <= GEOM_EPS) return 0;
    segs.push(lineSeg(a, b));
    return length;
  };

  // ---------------------------------------------------------------- bords gauche et droit
  // Chaque bord est le jour des tournants de son côté (raccord de jour, retraits) et le mur
  // (angle vif) des tournants de l'autre côté.
  const edgeSegments = (side: Side): CurveSeg[] => {
    const segs: CurveSeg[] = [];
    const offset = side === "left" ? 0 : width;
    legs.forEach((leg, i) => {
      const prev = i > 0 ? turns[i - 1]! : undefined;
      const next = i < turns.length ? turns[i]! : undefined;
      const t0 =
        prev === undefined ? 0 : prev.direction === side ? width + innerSetback(prev.inner) : 0;
      const t1 =
        next === undefined
          ? leg.length
          : next.direction === side
            ? leg.length - width - innerSetback(next.inner)
            : leg.length;
      pushLine(segs, at(leg, t0, offset), at(leg, t1, offset));
      if (next !== undefined && next.direction === side) {
        segs.push(...innerTurnSegments(next, cornerOf(i), leg.u, collarNormal(i)));
      }
    });
    return segs;
  };
  const leftSegs = edgeSegments("left");
  const rightSegs = edgeSegments("right");
  const innerSegs = innerSide === "left" ? leftSegs : rightSegs;
  const outerSegs = innerSide === "left" ? rightSegs : leftSegs;

  // ---------------------------------------------------------------- ligne de foulée Γ
  // Distance de Γ au bord gauche au droit du tournant j : d_f du côté de son jour.
  const walkOffsetAt = (j: number): Mm => (turns[j]!.direction === "left" ? df : width - df);
  // Escalier droit : d_f mesurée depuis le bord choisi ou automatique (décision A16,
  // `walklineSide.ts`) ; `innerSide` reste `left`.
  const walklineSide = turns.length === 0 ? resolveWalklineSide(project, lengths[0]!) : undefined;
  const startOffset =
    turns.length > 0 ? walkOffsetAt(0) : walklineSide === "right" ? width - df : df;
  const walkSegs: CurveSeg[] = [];
  const zones: { sStart: Mm; sEnd: Mm }[] = [];
  const transitions: { leg: number; sStart: Mm; sEnd: Mm; o0: Mm; o1: Mm; angle: number }[] = [];
  let s = 0;
  legs.forEach((leg, i) => {
    const prev = i > 0 ? turns[i - 1]! : undefined;
    const next = i < turns.length ? turns[i]! : undefined;
    const t0 = prev !== undefined ? width + walkSetback(prev.inner) : 0;
    const t1 = next !== undefined ? leg.length - width - walkSetback(next.inner) : leg.length;
    const o0 = prev !== undefined ? walkOffsetAt(i - 1) : startOffset;
    const o1 = next !== undefined ? walkOffsetAt(i) : o0;
    if (Math.abs(o1 - o0) > GEOM_EPS && !(t1 - t0 > GEOM_EPS)) {
      throw new LayoutError(
        `La ${legLabel(i)} est trop courte pour la transition de la ligne de foulée entre les tournants ${i} et ${i + 1} (sens opposés, ligne de foulée à ${df} mm du jour) : il faut une partie droite.`,
      );
    }
    // Abscisse cumulée sur les segments réellement ajoutés : [sStart, sEnd] reste cohérent
    // avec le paramétrage de la courbe même quand une partie droite est dégénérée.
    const sBefore = s;
    s += pushLine(walkSegs, at(leg, t0, o0), at(leg, t1, o1));
    if (Math.abs(o1 - o0) > GEOM_EPS) {
      transitions.push({
        leg: i,
        sStart: sBefore,
        sEnd: s,
        o0,
        o1,
        angle: Math.atan2(Math.abs(o1 - o0), t1 - t0),
      });
    }
    if (next !== undefined) {
      const r = walkSetback(next.inner);
      const n = collarNormal(i);
      const center = V.sub(V.sub(cornerOf(i), V.scale(n, r)), V.scale(leg.u, r));
      const radius = r + df;
      const sign = next.direction === "left" ? 1 : -1;
      walkSegs.push(arcSeg(center, radius, V.angleOf(n), (sign * Math.PI) / 2));
      const sStart = s;
      s += (radius * Math.PI) / 2;
      zones.push({ sStart, sEnd: s });
    }
  });

  // ---------------------------------------------------------------- repère monde
  const { origin, rotation } = project.stair.placement;
  const angle = (rotation * Math.PI) / 180;
  const toWorld = (p: Vec2): Vec2 => V.add(V.rotate(p, angle), origin);
  const curveToWorld = (c: Curve2): Curve2 => translateCurve(rotateCurve(c, angle), origin);

  // Jour réduit à un point (quart tournant sans partie droite, angle vif) : courbe de
  // longueur nulle au coin, pour garder un `Curve2` non vide.
  if (innerSegs.length === 0) {
    layoutErrors.push(
      "Bord du jour de longueur nulle (tournant sans partie droite de part et d'autre, jour à angle vif) : les limons et garde-corps de jour n'ont pas d'appui ; allonger une volée ou prévoir un poteau.",
    );
    innerSegs.push(lineSeg(cornerOf(0), cornerOf(0)));
  }
  if (outerSegs.length === 0) outerSegs.push(lineSeg(cornerOf(0), cornerOf(0)));
  const inner = curveToWorld(makeCurve(innerSegs));
  const outer = curveToWorld(makeCurve(outerSegs));
  const walkline = curveToWorld(makeCurve(walkSegs));

  const turnZones: TurnZone[] = turns.map((t, j) => ({
    index: j,
    direction: t.direction,
    mode: t.mode,
    innerCorner: toWorld(cornerOf(j)),
    outerCorner: toWorld(wallCornerOf(j)),
    sStart: zones[j]!.sStart,
    sEnd: zones[j]!.sEnd,
    collarSide: t.direction,
  }));

  // Distances à `inner` (et non au bord gauche) des transitions.
  const fromInner = (o: Mm): Mm => (innerSide === "left" ? o : width - o);
  const walklineTransitions: WalklineTransition[] = transitions.map((tr) => ({
    leg: tr.leg,
    sStart: tr.sStart,
    sEnd: tr.sEnd,
    fromOffset: fromInner(tr.o0),
    toOffset: fromInner(tr.o1),
    direction: V.rotate(legs[tr.leg]!.u, angle),
    angle: tr.angle,
  }));

  return {
    inner,
    outer,
    walkline,
    walklineOffset: df,
    footprint: footprintOf(inner, outer),
    turns: turnZones,
    ...(layoutErrors.length > 0 ? { errors: layoutErrors } : {}),
    innerSide,
    ...(walklineSide !== undefined ? { walklineSide } : {}),
    ...(walklineTransitions.length > 0 ? { walklineTransitions } : {}),
  };
}

/**
 * Segments du jour propres au tournant (entre la fin de la partie droite de la volée entrante
 * et le début de celle de la volée sortante), repère local. `u` : direction de la volée
 * entrante ; `n` : normale unitaire jour → mur de cette volée.
 */
function innerTurnSegments(turn: Turn, k: Vec2, u: Vec2, n: Vec2): CurveSeg[] {
  const inner = turn.inner;
  const turnSign = turn.direction === "left" ? 1 : -1;
  switch (inner.kind) {
    case "sharp":
      return [];
    case "arc": {
      const r = inner.radius;
      const center = V.sub(V.sub(k, V.scale(n, r)), V.scale(u, r));
      return [arcSeg(center, r, V.angleOf(n), (turnSign * Math.PI) / 2)];
    }
    case "newel": {
      // Coordonnées (α, β) dans la base (n, u) centrée sur K ; poteau α, β ∈ [−s ; p]
      // (s = a/2 + δ côté jour, p = a/2 − δ côté marches, `newel.ts`).
      const s = newelSetback(inner);
      const p = newelProtrusion(inner);
      const pt = (a: number, b: number): Vec2 => V.add(V.add(k, V.scale(n, a)), V.scale(u, b));
      const pts = [pt(0, -s), pt(p, -s), pt(p, p), pt(-s, p), pt(-s, 0)];
      const segs: CurveSeg[] = [];
      for (let i = 0; i + 1 < pts.length; i++) segs.push(lineSeg(pts[i]!, pts[i + 1]!));
      return segs;
    }
  }
}

/**
 * Emprises dégénérées d'un tracé à volées (repère local, volées alignées sur les axes) :
 * - deux tournants successifs de même sens (U, demi-tournant) dont la volée intermédiaire ne
 *   laisse aucun jour (L = 2E, jour à angle vif) : les volées qui se font face se touchent et
 *   le bord du jour revient sur lui-même (emprise « à fente », polygone non simple) ;
 * - deux volées non consécutives qui se superposent en plan (trois tournants ou plus de même
 *   sens) : recouvrement d'aire non nulle de leurs rectangles hors tout ; l'emprise n'est pas un
 *   polygone simple et l'échappée sous la volée supérieure n'est pas calculée (`Stepping.soffits`
 *   ne porte que l'hélicoïdal).
 * Constats géométriques, sans seuil.
 */
function degenerateFootprint(
  legs: readonly LegFrame[],
  turns: readonly Turn[],
  width: Mm,
  at: (leg: LegFrame, t: Mm, o: Mm) => Vec2,
): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    if (turns[i]!.direction !== turns[i + 1]!.direction) continue;
    const jour = legs[i + 1]!.length - 2 * width;
    if (jour <= GEOM_EPS) {
      out.push(
        `Tournants ${i + 1} et ${i + 2} : la ${legLabel(i + 1)} (${legs[i + 1]!.length} mm, deux fois l'emmarchement) ne laisse aucun jour, les ${legLabel(i)} et ${legLabel(i + 2)} se touchent (emprise dégénérée) ; allonger la ${legLabel(i + 1)} ou prévoir un poteau.`,
      );
    }
  }
  const box = (leg: LegFrame): { lo: Vec2; hi: Vec2 } => {
    const a = at(leg, 0, 0);
    const b = at(leg, leg.length, width);
    return {
      lo: V.vec(Math.min(a.x, b.x), Math.min(a.y, b.y)),
      hi: V.vec(Math.max(a.x, b.x), Math.max(a.y, b.y)),
    };
  };
  const boxes = legs.map(box);
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 2; j < legs.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ox = Math.min(a.hi.x, b.hi.x) - Math.max(a.lo.x, b.lo.x);
      const oy = Math.min(a.hi.y, b.hi.y) - Math.max(a.lo.y, b.lo.y);
      if (ox > GEOM_EPS && oy > GEOM_EPS) {
        out.push(
          `Les ${legLabel(i)} et ${legLabel(j)} se superposent en plan (${Math.round(ox)} × ${Math.round(oy)} mm) : emprise non simple, et l'échappée de l'une sous l'autre n'est pas contrôlée (auto-recouvrement calculé pour l'hélicoïdal seulement).`,
        );
      }
    }
  }
  return out;
}

/** Emprise : C_e à l'endroit puis C_i à l'envers, polygone CCW sans points doublés. */
function footprintOf(inner: Curve2, outer: Curve2): Polygon2 {
  const raw = [...flattenCurve(outer), ...flattenCurve(reverseCurve(inner))];
  const pts: Vec2[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (last === undefined || !V.equals(last, p)) pts.push(p);
  }
  while (pts.length > 1 && V.equals(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  return ensureCCW(pts);
}
