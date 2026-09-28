/**
 * Courbe décalée (offset) d'une `Curve2` à distance d, à gauche ou à droite du sens de parcours.
 *
 * Règles (cas essentiel : ligne de foulée = offset du bord intérieur, B §2.1) :
 * - segment droit → segment parallèle ;
 * - arc de rayon R → arc concentrique de rayon R ∓ d ; si le rayon devient négatif, l'arc
 *   disparaît et ses voisins sont raccordés comme à un sommet concave ; rayon exactement nul →
 *   pivot (arc de longueur nulle, retiré du résultat) ;
 * - sommet anguleux **convexe** du côté du décalage → arc de rayon d centré sur le sommet ;
 * - sommet anguleux **concave** → les deux décalés sont coupés à leur intersection (prolongés
 *   si besoin) ; un décalé entièrement « consommé » par la coupe est supprimé.
 *
 * Limites (voir LEDGER) : traitement local des raccords seulement ; les auto-intersections
 * globales (courbe qui revient à moins de 2d d'elle-même) ne sont pas éliminées. Demi-tour
 * exact (180°) non géré. Courbes ouvertes uniquement.
 */
import type { Curve2, CurveSeg, Mm } from "../model/primitives.js";
import { intersectSupports } from "./intersect.js";
import { arcSeg, lineSeg, segEnd, segLength, segStart, segSub, segTangentAt } from "./segment.js";
import { ANGLE_EPS, GEOM_EPS } from "./tolerance.js";
import * as V from "./vec.js";

export type Side = "left" | "right";

/** +1 à gauche, −1 à droite. */
export function sideSign(side: Side): 1 | -1 {
  return side === "left" ? 1 : -1;
}

/** Décalé d'un segment seul, ou null s'il dégénère (longueur nulle, rayon négatif). */
export function offsetSegment(seg: CurveSeg, d: Mm, side: Side): CurveSeg | null {
  const sg = sideSign(side);
  if (seg.kind === "line") {
    const dir = V.sub(seg.b, seg.a);
    const len = V.norm(dir);
    if (len <= GEOM_EPS) return null;
    const n = V.scale(V.perpLeft(dir), (sg * d) / len);
    return lineSeg(V.add(seg.a, n), V.add(seg.b, n));
  }
  if (seg.sweep === 0) return null;
  // À gauche d'un arc CCW = vers le centre.
  const r = seg.radius - sg * d * Math.sign(seg.sweep);
  if (r < -GEOM_EPS) return null;
  return arcSeg(seg.center, Math.max(0, r), seg.startAngle, seg.sweep);
}

export interface OffsetOptions {
  /** Écart maximal toléré entre deux décalés consécutifs pour les considérer jointifs. */
  readonly joinTol?: Mm;
}

export function offsetCurve(curve: Curve2, d: Mm, side: Side, options: OffsetOptions = {}): Curve2 {
  if (!(d >= 0)) throw new Error(`offsetCurve : distance invalide (${d})`);
  const joinTol = options.joinTol ?? 10 * GEOM_EPS;
  const sg = sideSign(side);
  // Un arc dont le rayon décalé est exactement nul est retiré : ses voisins se rejoignent au
  // centre (écart nul) ou sont raccordés comme à un sommet concave.
  const raw: CurveSeg[] = [];
  // Virage cumulé (jonctions + balayages des segments retirés) depuis le dernier décalé gardé :
  // `signedAngle` entre deux tangentes ne voit le virage que modulo 2π, il faut donc refuser
  // explicitement un virage total ≥ π (arc retiré de balayage ≥ 180°), sinon un sommet
  // concave serait pris pour un convexe.
  let lastTangent: ReturnType<typeof segTangentAt> | null = null;
  let turnAcc = 0;
  for (const s of curve.segments) {
    if (segLength(s) <= 0 && !(s.kind === "arc" && s.sweep !== 0)) continue; // sans direction
    const o = offsetSegment(s, d, side);
    const t0 = segTangentAt(s, 0);
    if (lastTangent !== null) turnAcc += V.signedAngle(lastTangent, t0);
    lastTangent = segTangentAt(s, 1);
    const kept = o !== null && !(o.kind === "arc" && o.radius === 0 && d > 0);
    if (!kept) {
      if (s.kind === "arc") turnAcc += s.sweep;
      continue;
    }
    if (raw.length > 0 && Math.abs(turnAcc) >= Math.PI - ANGLE_EPS) {
      throw new Error("offsetCurve : virage ≥ 180° entre deux décalés (demi-tour) non géré");
    }
    raw.push(o);
    turnAcc = 0;
  }
  if (raw.length === 0) throw new Error("offsetCurve : décalé entièrement dégénéré");

  const out: CurveSeg[] = [];
  for (const seg of raw) {
    let cur: CurveSeg | null = seg;
    while (cur) {
      const prev = out[out.length - 1];
      if (prev === undefined) {
        out.push(cur);
        break;
      }
      const pe = segEnd(prev);
      const cs = segStart(cur);
      if (V.distance(pe, cs) <= joinTol) {
        // Jointifs à la tolérance près : on recolle exactement quand un des deux est droit.
        if (cur.kind === "line") out.push(lineSeg(pe, cur.b));
        else if (prev.kind === "line") {
          out[out.length - 1] = lineSeg(prev.a, cs);
          out.push(cur);
        } else out.push(cur);
        break;
      }
      const t1 = segTangentAt(prev, 1);
      const t2 = segTangentAt(cur, 0);
      const turn = V.signedAngle(t1, t2);
      if (Math.abs(Math.abs(turn) - Math.PI) < ANGLE_EPS) {
        throw new Error("offsetCurve : demi-tour (180°) non géré");
      }
      if (sg * turn < 0) {
        // Sommet convexe côté décalage : arc de rayon d centré sur le sommet d'origine.
        const n1 = sg > 0 ? V.perpLeft(t1) : V.perpRight(t1);
        const vertex = V.addScaled(pe, n1, -d);
        out.push(arcSeg(vertex, d, V.angleOf(V.sub(pe, vertex)), turn));
        out.push(cur);
        break;
      }
      // Sommet concave : coupe à l'intersection des supports la plus proche de l'écart.
      const mid = V.lerp(pe, cs, 0.5);
      const hits = intersectSupports(prev, cur);
      if (hits.length === 0) {
        throw new Error("offsetCurve : raccord concave sans intersection");
      }
      let best = hits[0]!;
      for (const h of hits) if (V.distance(h.point, mid) < V.distance(best.point, mid)) best = h;
      const lp = segLength(prev);
      const lc = segLength(cur);
      if (best.ta * lp <= GEOM_EPS) {
        out.pop();
        continue;
      }
      if ((1 - best.tb) * lc <= GEOM_EPS) {
        cur = null;
        break;
      }
      out[out.length - 1] = segSub(prev, 0, best.ta);
      out.push(segSub(cur, best.tb, 1));
      break;
    }
  }
  const segs = out.filter((s) => segLength(s) > GEOM_EPS);
  return { segments: segs.length > 0 ? segs : [out[0]!] };
}
