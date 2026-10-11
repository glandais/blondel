/**
 * Recouvrement en plan d'une cage saisie (ADR-0010, sous-lot 2a), pour tout angle de jonction :
 * l'emprise est découpée en **pièces convexes** (repère local du tracé), testées deux à deux par
 * le théorème de l'axe séparateur (`convexOverlap`, `geom2d/collide.ts`) :
 * - un quadrilatère par tronçon (sa partie droite, entre ses lignes de départ et d'arrivée),
 *   coupé par les congés côté mur voisins (un congé de rayon supérieur à E commence sur la
 *   partie droite) ;
 * - par jonction tournante, la zone de jonction (« cerf-volant » K, K + E·n, W, K + E·n',
 *   `junction.ts`), coin du mur arrondi par le congé côté mur s'il y en a un (cordes de l'arc :
 *   intersection de demi-plans), et l'ajout du raccord de jour : éventail de triangles depuis K
 *   jusqu'aux cordes de l'arc de jour (approche convexe par excès), triangle du pan coupé ; le
 *   poteau, qui entaille l'emprise, n'en retire rien (approche par excès) ;
 * - par palier droit, le rectangle du palier.
 *
 * Une pièce de tronçon appartient à ce tronçon ; une pièce de jonction aux deux tronçons qu'elle
 * relie (comme le carré d'angle appartient aux deux volées dans l'étendue « au mur » du moteur à
 * volées). Deux tronçons i et j (j ≥ i + 2 ; consécutifs aussi, sous-lot 2b, voir
 * `piecesOverlap`) se superposent si une pièce de l'un recouvre une
 * pièce de l'autre de plus de `GEOM_EPS` (un contact au nu n'est pas un recouvrement) ; les
 * dimensions signalées sont celles de la boîte englobante (axes du repère local) de la réunion
 * des intersections. À ±90°, tronçons et zones sont des rectangles alignés sur les axes et la
 * réunion des pièces d'un tronçon est son étendue « au mur » : mêmes constats que la boîte
 * englobante du moteur à volées (`layout/legacyFlights.ts`), gardée telle quelle pour une cage
 * issue de volées (parité des messages, `cage.ts`).
 *
 * Contact « bord à bord » (constat `sectionsTouch`) : deux jonctions tournantes successives de
 * même sens, à jour vif, dont le tronçon intermédiaire n'a aucune partie droite et dont les
 * angles totalisent 180° : les tronçons qui se font face se touchent sur toute leur largeur
 * (demi-tour à jour nul). Au-delà de 180°, ils se recouvrent (constat `sectionsOverlap`). Le
 * moteur général (`general.ts`) passe les balayages effectifs φ des bords du jour réels.
 */
import type { ArcSeg, Curve2, Mm, Polygon2, Vec2 } from "../../model/primitives.js";
import { flattenCurve, reverseCurve } from "../../geom2d/curve.js";
import { convexOverlap } from "../../geom2d/collide.js";
import { bbox, ensureCCW, signedArea } from "../../geom2d/polygon.js";
import { ANGLE_EPS, GEOM_EPS } from "../../geom2d/tolerance.js";
import * as V from "../../geom2d/vec.js";
import { msg, type Message } from "@blondel/i18n";
import { at, type SectionFrame } from "./frames.js";
import {
  collarNormal,
  wallCorner,
  wellCorner,
  wallTurnSegments,
  wellTurnSegments,
  type JunctionGeom,
  type TurnJunction,
} from "./junction.js";
import { mmText } from "./section.js";

/** Pièce convexe de l'emprise et tronçons auxquels elle appartient. */
export interface CagePiece {
  /** Polygone convexe CCW, repère local du tracé. */
  readonly polygon: Polygon2;
  /** Indices des tronçons (un pour une partie droite, deux pour une jonction). */
  readonly owners: readonly number[];
}

/** Pas angulaire maximal de la discrétisation des arcs en cordes (rad). */
const ARC_STEP = Math.PI / 32;

/** Points d'un arc (centre, rayon, angle de départ, balayage signé), extrémités comprises. */
function arcPoints(center: Vec2, radius: Mm, start: number, sweep: number): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP));
  const pts: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    pts.push(V.addScaled(center, V.fromAngle(start + (sweep * k) / n), radius));
  }
  return pts;
}

/**
 * Demi-plan : garde la partie de `poly` du côté de la droite (a, b) où se trouve `inside`
 * (Sutherland–Hodgman sur une arête).
 */
function clipHalfPlane(poly: readonly Vec2[], a: Vec2, b: Vec2, inside: Vec2): Vec2[] {
  const d = V.sub(b, a);
  const sign = Math.sign(V.cross(d, V.sub(inside, a))) || 1;
  const side = (p: Vec2): number => sign * V.cross(d, V.sub(p, a));
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) out.push(V.lerp(p, q, sp / (sp - sq)));
  }
  return out;
}

/** Intersection de deux polygones convexes CCW (vide si disjoints). */
export function clipConvex(subject: readonly Vec2[], clip: Polygon2): Vec2[] {
  let out: Vec2[] = [...subject];
  const m = clip.length;
  let c = V.vec(0, 0);
  for (const p of clip) c = V.add(c, p);
  c = V.scale(c, 1 / m);
  for (let i = 0; i < m && out.length > 0; i++) {
    out = clipHalfPlane(out, clip[i]!, clip[(i + 1) % m]!, c);
  }
  return out;
}

/**
 * Coupe `poly` par un arc convexe (`arc`) : demi-plans de ses cordes, côté du centre (approche
 * par défaut, les cordes étant dans le disque). Hors du secteur de l'arc, les prolongements des
 * cordes passent au-delà du bord qu'il raccorde (arc convexe) et ne retirent rien de la bande.
 */
export function clipByArc(poly: readonly Vec2[], arc: ArcSeg): Vec2[] {
  const pts = arcPoints(arc.center, arc.radius, arc.startAngle, arc.sweep);
  let out = [...poly];
  for (let i = 0; i + 1 < pts.length && out.length > 0; i++) {
    out = clipHalfPlane(out, pts[i]!, pts[i + 1]!, arc.center);
  }
  return out;
}

/**
 * Coupe `poly` par le congé côté mur de la jonction `j` (tronçon entrant `incoming`), s'il y en
 * a un (`clipByArc`).
 */
function clipByFillet(
  poly: readonly Vec2[],
  j: TurnJunction,
  incoming: SectionFrame,
  width: Mm,
): Vec2[] {
  const [fillet] = wallTurnSegments(
    j,
    wallCorner(incoming, j.side, width),
    incoming.u,
    collarNormal(incoming, j.side),
  );
  return fillet?.kind === "arc" ? clipByArc(poly, fillet) : [...poly];
}

/**
 * Éventail de triangles depuis `apex` jusqu'aux cordes de l'arc `arc` (jour en arc d'une
 * jonction, vu depuis le coin K : approche convexe par excès).
 */
export function arcFanPieces(apex: Vec2, arc: ArcSeg): Polygon2[] {
  const pts = arcPoints(arc.center, arc.radius, arc.startAngle, arc.sweep);
  const out: Polygon2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(ensureCCW([apex, pts[i]!, pts[i + 1]!]));
  return out;
}

/**
 * Pièces convexes d'un secteur de couronne (tronçon à axe en arc, sous-lot 2b) : éventail de
 * trapèzes isocèles entre les rayons `inner` et `outer` (0 < inner < outer), au pas angulaire
 * `ARC_STEP` au plus, depuis l'angle `start` sur le balayage signé `sweep`. Les cordes
 * approchent le secteur à moins d'une flèche près (de l'ordre de 0,1 % du rayon).
 */
export function annulusPieces(
  center: Vec2,
  inner: Mm,
  outer: Mm,
  start: number,
  sweep: number,
): Polygon2[] {
  const a = arcPoints(center, inner, start, sweep);
  const b = arcPoints(center, outer, start, sweep);
  const out: Polygon2[] = [];
  for (let i = 0; i + 1 < a.length; i++) out.push(ensureCCW([a[i]!, a[i + 1]!, b[i + 1]!, b[i]!]));
  return out;
}

/** Zone d'une jonction tournante (et ajout du raccord de jour), repère local. */
function turnPieces(
  j: TurnJunction,
  incoming: SectionFrame,
  outgoing: SectionFrame,
  width: Mm,
): Polygon2[] {
  const k = wellCorner(incoming, j.side, width);
  const w = wallCorner(incoming, j.side, width);
  const n = collarNormal(incoming, j.side);
  const n2 = collarNormal(outgoing, j.side);
  const u = incoming.u;
  const u2 = outgoing.u;
  // Coin du mur arrondi par le congé, s'il y en a un.
  const kite = clipByFillet(
    [k, V.addScaled(k, n, width), w, V.addScaled(k, n2, width)],
    j,
    incoming,
    width,
  );
  const pieces: Polygon2[] = kite.length >= 3 ? [ensureCCW(kite)] : [];
  const well = j.well;
  if (well.kind === "arc") {
    const [arc] = wellTurnSegments(j, k, u, n, u2);
    if (arc?.kind === "arc") pieces.push(...arcFanPieces(k, arc));
  } else if (well.kind === "chamfer") {
    pieces.push(
      ensureCCW([k, V.addScaled(k, u, -well.setbackIn), V.addScaled(k, u2, well.setbackOut)]),
    );
  }
  return pieces;
}

/**
 * Pièces convexes de l'emprise d'une cage (largeur constante `width`), repère local du tracé,
 * dans l'ordre de la montée ; chacune convexe, CCW et d'aire supérieure à `GEOM_EPS`
 * (propriété dans `free.property.test.ts`).
 */
export function cagePieces(
  frames: readonly SectionFrame[],
  junctions: readonly JunctionGeom[],
  width: Mm,
): CagePiece[] {
  const pieces: CagePiece[] = [];
  frames.forEach((frame, i) => {
    const t0 = frame.lead;
    const t1 = frame.length - frame.tail;
    if (t1 - t0 > GEOM_EPS) {
      // Partie droite, coupée par les congés côté mur voisins : au-delà d'un rayon de l'ordre
      // de E, leur arc commence avant la zone de jonction, sur la partie droite.
      let quad: Vec2[] = [
        at(frame, t0, 0),
        at(frame, t1, 0),
        at(frame, t1, width),
        at(frame, t0, width),
      ];
      const prev = junctions[i - 1];
      if (prev?.kind === "turn") quad = clipByFillet(quad, prev, frames[i - 1]!, width);
      const next = junctions[i];
      if (next?.kind === "turn") quad = clipByFillet(quad, next, frame, width);
      if (quad.length >= 3 && signedArea(ensureCCW(quad)) > GEOM_EPS) {
        pieces.push({ polygon: ensureCCW(quad), owners: [i] });
      }
    }
    const j = junctions[i];
    if (j === undefined) return;
    const owners = [i, i + 1];
    if (j.kind === "straight") {
      pieces.push({
        polygon: ensureCCW([
          at(frame, t1, 0),
          at(frame, frame.length, 0),
          at(frame, frame.length, width),
          at(frame, t1, width),
        ]),
        owners,
      });
      return;
    }
    // Pièces d'aire négligeable (éventail d'un jour en arc à très petit angle, cerf-volant
    // rogné par un congé) écartées : elles ne recouvrent rien de plus de `GEOM_EPS` et
    // fragiliseraient le test de l'axe séparateur.
    for (const polygon of turnPieces(j, frame, frames[i + 1]!, width)) {
      if (signedArea(polygon) > GEOM_EPS) pieces.push({ polygon, owners });
    }
  });
  return pieces;
}

/**
 * Constats d'emprise dégénérée d'une cage saisie : tronçons qui se touchent bord à bord
 * (`layout.cage.sectionsTouch`), puis tronçons non consécutifs qui se superposent en plan
 * (`layout.cage.sectionsOverlap`). Constats géométriques, sans seuil.
 */
export function cageOverlap(
  frames: readonly SectionFrame[],
  junctions: readonly JunctionGeom[],
  width: Mm,
): Message[] {
  const out = sectionsTouch(junctions, (i) => frames[i]!.straight);
  out.push(...piecesOverlap(cagePieces(frames, junctions, width), frames.length));
  return out;
}

/**
 * Constats de contact bord à bord (`layout.cage.sectionsTouch`) : deux jonctions tournantes
 * successives de même sens dont le tronçon intermédiaire n'a aucune partie droite
 * (`straight(i)`, longueur de la partie droite du tronçon `i` ; `undefined` pour un tronçon à
 * axe en arc, jamais concerné) et dont les angles totalisent 180°.
 */
export function sectionsTouch(
  junctions: readonly JunctionGeom[],
  straight: (section: number) => Mm | undefined,
): Message[] {
  const out: Message[] = [];
  for (let i = 0; i + 1 < junctions.length; i++) {
    const a = junctions[i]!;
    const b = junctions[i + 1]!;
    if (a.kind !== "turn" || b.kind !== "turn" || a.side !== b.side) continue;
    const length = straight(i + 1);
    if (length === undefined) continue;
    const halfTurn = Math.abs(Math.abs(a.sweep + b.sweep) - Math.PI) <= ANGLE_EPS;
    if (length <= GEOM_EPS && halfTurn) {
      out.push(
        msg("layout.cage.sectionsTouch", {
          junctionA: i + 1,
          junctionB: i + 2,
          section: i + 2,
          length: mmText(length),
          before: i + 1,
          after: i + 3,
        }),
      );
    }
  }
  return out;
}

/**
 * Constats de recouvrement en plan (`layout.cage.sectionsOverlap`) entre tronçons (`count`
 * tronçons), à partir des pièces convexes de l'emprise : une pièce de l'un recouvre une pièce
 * de l'autre de plus de `GEOM_EPS` ; dimensions de la boîte englobante (axes du repère local)
 * de la réunion des intersections. Tronçons non consécutifs : toutes leurs pièces ; tronçons
 * consécutifs a et a + 1 (sous-lot 2b : un axe en arc ou un bord incliné peut revenir sur le
 * tronçon voisin ou sur la jonction qui les relie) : seulement les pièces propres à a, à a + 1
 * et à la jonction qui les relie (propriétaires inclus dans {a, a + 1}), sauf les paires de
 * deux pièces de cette jonction ; les pièces des jonctions a − 1 et a + 1 relèvent des paires
 * non consécutives, déjà testées (sinon un recouvrement serait signalé deux fois). Une pièce
 * de jonction et une pièce propre voisine n'ont qu'un bord commun, sans recouvrement d'aire.
 * À largeur constante et axes droits, deux tronçons consécutifs ne se recouvrent jamais
 * (|θ| < 180°) : constats du sous-lot 2a inchangés (propriété dans `free.property.test.ts`).
 */
export function piecesOverlap(pieces: readonly CagePiece[], count: number): Message[] {
  const out: Message[] = [];
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const consecutive = b === a + 1;
      const local = (p: CagePiece): boolean => p.owners.every((o) => o === a || o === b);
      const hits: Vec2[] = [];
      for (const p of pieces) {
        if (!p.owners.includes(a)) continue;
        if (consecutive && !local(p)) continue;
        const pShared = p.owners.includes(b);
        for (const q of pieces) {
          if (q === p || !q.owners.includes(b)) continue;
          if (consecutive && (!local(q) || (pShared && q.owners.includes(a)))) continue;
          if (!convexOverlap(p.polygon, q.polygon, GEOM_EPS)) continue;
          hits.push(...clipConvex(p.polygon, q.polygon));
        }
      }
      if (hits.length === 0) continue;
      const box = bbox(hits);
      out.push(
        msg("layout.cage.sectionsOverlap", {
          sectionA: a + 1,
          sectionB: b + 1,
          x: String(Math.round(box.max.x - box.min.x)),
          y: String(Math.round(box.max.y - box.min.y)),
        }),
      );
    }
  }
  return out;
}

/** Emprise : C_e à l'endroit puis C_i à l'envers, polygone CCW sans points doublés. */
export function footprintOf(inner: Curve2, outer: Curve2): Polygon2 {
  const raw = [...flattenCurve(outer), ...flattenCurve(reverseCurve(inner))];
  const pts: Vec2[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (last === undefined || !V.equals(last, p)) pts.push(p);
  }
  while (pts.length > 1 && V.equals(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  return ensureCCW(pts);
}
