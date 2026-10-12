/**
 * Adéquation de l'escalier au site (ADR-0010, plan E, sous-lot 3b) : `computeSiteFit` rend les
 * conflits (`SiteConflict`, `Model.siteFit`) de l'escalier tracé avec les murs, le contour de la
 * pièce, les obstacles, le dégagement d'arrivée et la dalle haute, et reprend l'échappée (règles
 * ECHAPPEE_* du contrôle) et le recouvrement de la cage sur elle-même. Fonction pure, sans
 * état global, tout en coordonnées du site.
 *
 * - **Emprise hors tout** (`stairGrossPieces`) : une pièce convexe par marche, enveloppe de sa
 *   surface de marche et des extrémités de ses lignes de nez prolongées de l'épaisseur latérale
 *   de la structure (`structureLateralThickness` : côté jour vers le vide, côté mur vers
 *   l'extérieur), coin extérieur d'un tournant décalé à angle vif ; hélicoïdal : arc extérieur
 *   au rayon R_e + épaisseur extérieure, couvert entre les deux nez (polygone circonscrit, pas
 *   de 2°), pas seulement aux extrémités des nez. Sans découpage : quadrilatère
 *   de chaque tronçon (`Layout.sections`), sans épaisseur. Même construction que l'emprise de
 *   l'assistant (`assistant/placement.ts`, `grossPieces`), généralisée à toute cage.
 * - **Un seul crible** (sous-lot 3c) : `footprintConflicts` (murs, contour, obstacles) et
 *   `arrivalClearanceConflicts` servent aussi à l'étage analytique de l'assistant, et l'étage
 *   complet de l'assistant rejette une proposition dont `Model.siteFit` contient une erreur.
 * - **Contact au nu** : un recouvrement d'au plus `ASSISTANT_DEFAULTS.contactTolerance` (0,5 mm,
 *   tolérance géométrique de l'assistant, pas une valeur métier) n'est pas un conflit : un
 *   escalier adossé à un mur, au contour ou à un obstacle est admis.
 * - **Mur** (`erreur`) : pièce qui recouvre le rectangle d'un mur (`wallPolygon`) ; zone =
 *   intersection. **Hors pièce** (`erreur`) : sommet d'une pièce hors du contour `site.room`, ou
 *   arête qui le croise. **Obstacles** (`erreur`) : poteau (rectangle tourné), poteau rond
 *   (disque), zone interdite (polygone simple triangulé). **Porte** (`avertissement`) : secteur
 *   de débattement d'un quart de tour autour des gonds, du côté `swing`, de rayon
 *   `workshop.siteFit.doorSwingRadius` (défaut : largeur de la porte). **Fenêtre** (`conseil`,
 *   décision F7) : marches dont l'emprise touche la baie (épaisseur du mur qui la porte, sinon le
 *   segment `a`–`b`) et dont le dessus est sous le linteau (l'escalier passe devant la fenêtre,
 *   sous son allège ou devant son vitrage).
 * - **Dégagement d'arrivée** (`avertissement`) : rectangle de la largeur hors tout de la ligne
 *   d'arrivée (dernier nez), de profondeur `workshop.siteFit.arrivalClearance` (défaut :
 *   emmarchement à l'arrivée, analogie PALIER_LONGUEUR_METIER, décision F7), contre les murs et
 *   les poteaux (droits et ronds), seuls éléments du site qui montent sur toute la hauteur ; les
 *   zones interdites, portes, fenêtres et le contour de la pièce décrivent le niveau bas et ne
 *   sont pas testés (QUESTIONS F15).
 * - **Dalle haute** : première marche au-dessus de la sous-face de la dalle hors de la trémie
 *   (`slabIntrusion`, critère repris de l'ancien crible de l'assistant) : `erreur` si la marche seule (surface et
 *   lignes de nez) sort de la trémie, `avertissement` si seule l'épaisseur latérale de la
 *   structure passe sous la dalle (limon le long d'un bord de trémie : entaille ou appui sur le
 *   chevêtre à prévoir). Quand c'est la ligne d'arrivée (dernier nez) qui sort, le message le
 *   dit (`site.fit.slabArrival`, `site.fit.slabStructureArrival`) : aucune marche n'y porte de
 *   numéro ; zone = emprise de la dernière marche.
 * - **Échappée** : chaque violation d'une règle ECHAPPEE_* du contrôle est reprise telle quelle
 *   (message, sévérité effective, `ruleId`), sans recalcul ; zone = marche concernée.
 * - **Recouvrement sur elle-même** (`erreur`) : constat du tracé `layout.cage.sectionsOverlap`
 *   (déjà dans `Model.errors`) localisé ; zone = intersection des boîtes des deux tronçons.
 *
 * Sévérités, sens de « devant une fenêtre », partage de la dalle en erreur / avertissement et
 * périmètre du dégagement d'arrivée : propositions « à valider » (QUESTIONS F15).
 */
import { dec, msg, type Message } from "@blondel/i18n";
import { ASSISTANT_DEFAULTS } from "../assistant/defaults.js";
import {
  convexHull,
  convexOverlap,
  convexSimpleOverlap,
  discOverlap,
  wallPolygon,
} from "../geom2d/collide.js";
import { curveLength, curveTangentAt } from "../geom2d/curve.js";
import { segmentIntersect } from "../geom2d/intersect.js";
import { bbox, ensureCCW, pointInPolygon } from "../geom2d/polygon.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import * as V from "../geom2d/vec.js";
import { ceilingOf, openingPolygon } from "../headroom/headroom.js";
import { clipConvex } from "../layout/cage/overlap.js";
import type {
  ComplianceReport,
  Layout,
  Model,
  RuleResult,
  SiteConflict,
  SiteConflictSeverity,
  Stepping,
} from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { Obstacle, Project, Site, Wall } from "../model/project.js";
import { structureLateralThickness } from "../structures/registry.js";
import { resolveSiteFitProfile, type SiteFitProfile } from "../workshop/siteFit.js";

/** Tolérance de contact au nu (mm), reprise de l'assistant (voir l'en-tête). */
export const SITE_FIT_CONTACT_TOL: Mm = ASSISTANT_DEFAULTS.contactTolerance;

/** Pas angulaire de la discrétisation des secteurs et disques (géométrie, pas métier). */
const ARC_SEGMENTS = 16;

/**
 * Pas angulaire maximal (rad) du polygone circonscrit à l'arc extérieur d'une marche
 * hélicoïdale : 2°, débord sur l'arc ≤ R · (1 / cos 1° − 1) ≈ 1,5e-4 · R, sous la tolérance de
 * contact jusqu'à R ≈ 3 m (géométrie, pas métier).
 */
const HELICAL_ARC_STEP = Math.PI / 90;

/** Pièce convexe de l'emprise hors tout. */
export interface GrossPiece {
  /** Polygone convexe CCW, repère du site. */
  readonly polygon: Polygon2;
  /** Marche portée (numéro 1 … n−1) et altitude de son dessus ; absents sans découpage. */
  readonly tread?: number;
  readonly z?: Mm;
}

/** Épaisseurs latérales hors emprise utile (côté jour, côté mur). */
export interface LateralThickness {
  readonly inner: Mm;
  readonly outer: Mm;
}

/** Épaisseurs latérales de la structure du projet (0 / 0 si inconnues ou invalides). */
export function projectLateralThickness(project: Project): LateralThickness {
  const { kind, params } = project.stair.structure;
  try {
    const t = structureLateralThickness(kind, params);
    if (t && Number.isFinite(t.inner) && Number.isFinite(t.outer))
      return { inner: Math.max(0, t.inner), outer: Math.max(0, t.outer) };
  } catch {
    // Paramètres illisibles : l'erreur est rapportée par l'étape de structure.
  }
  return { inner: 0, outer: 0 };
}

/** Emprise hors tout, une pièce convexe par marche (voir l'en-tête). */
export function stairGrossPieces(
  layout: Layout,
  stepping: Stepping | undefined,
  lateral: LateralThickness,
): GrossPiece[] {
  const out: GrossPiece[] = [];
  const nosings = stepping?.nosings ?? [];
  for (const t of stepping?.treads ?? []) {
    const pts: Vec2[] = [...t.walkingSurface];
    for (const nz of [nosings[t.number - 1], nosings[t.number]]) {
      if (!nz) continue;
      pts.push(V.addScaled(nz.q, nz.dir, -lateral.inner), V.addScaled(nz.r, nz.dir, lateral.outer));
    }
    // Coin extérieur (mur vif) d'un tournant porté par la marche : décalé à angle vif.
    for (const zone of layout.turns) {
      if (!t.walkingSurface.some((p) => V.distance(p, zone.outerCorner) <= 1e-6)) continue;
      const onInner = (zone.collarSide ?? layout.innerSide) !== layout.innerSide;
      const d = onInner ? lateral.inner : lateral.outer;
      const axis = V.sub(zone.outerCorner, zone.innerCorner);
      const len = V.norm(axis);
      if (!(d > 0) || !(len > 0)) continue;
      const half = Math.abs(zone.angle ?? Math.PI / 2) / 2;
      const reach = d / Math.max(Math.cos(half), 0.1);
      pts.push(V.addScaled(zone.outerCorner, axis, reach / len));
    }
    // Hélicoïdal : arc extérieur hors tout (R_e + épaisseur extérieure) entre les deux nez,
    // couvert par des points du polygone circonscrit (la corde sous-estimerait le limon).
    const h = layout.helical;
    const n0 = nosings[t.number - 1];
    const n1 = nosings[t.number];
    if (h && n0 && n1) {
      const radius = h.outerRadius + lateral.outer;
      const a0 = V.angleOf(V.sub(n0.r, h.center));
      const sweep = V.signedAngle(V.sub(n0.r, h.center), V.sub(n1.r, h.center));
      const m = Math.max(1, Math.ceil(Math.abs(sweep) / HELICAL_ARC_STEP));
      const step = sweep / m;
      const reach = radius / Math.cos(step / 2);
      for (let k = 0; k < m; k++)
        pts.push(V.addScaled(h.center, V.fromAngle(a0 + (k + 0.5) * step), reach));
    }
    const polygon = convexHull(pts);
    if (polygon.length >= 3) out.push({ polygon, tread: t.number, z: t.z });
  }
  if (out.length > 0) return out;
  for (const s of layout.sections ?? []) {
    const polygon = convexHull([s.start.left, s.start.right, s.end.right, s.end.left]);
    if (polygon.length >= 3) out.push({ polygon });
  }
  return out;
}

/**
 * Dalle haute : toute marche dont le dessus dépasse la sous-face de la dalle (z > H − ep) doit
 * être dans la trémie en plan — surface de marche visible et extrémités hors tout de ses lignes
 * de nez. Le débord de la pièce (`outline`) n'est pas contrôlé : la dernière marche passe
 * légitimement de son débord sous la contremarche d'arrivée, contre le chevêtre. Rend le
 * numéro de la première marche fautive (nez d'arrivée : n, au-delà de la dernière marche), ou
 * `null`. Déplacé de `assistant/placement.ts` au sous-lot 3c (seul crible : `computeSiteFit`).
 */
export function slabIntrusion(
  model: Pick<Model, "stepping">,
  opening: Polygon2,
  ceiling: Mm,
  innerThickness: Mm,
  outerThickness: Mm,
  tol: Mm,
): number | null {
  const inside = (p: Vec2): boolean => pointInPolygon(p, opening, tol) !== "outside";
  for (const tread of model.stepping.treads) {
    if (!(tread.z > ceiling + 1e-6)) continue;
    if (!tread.walkingSurface.every(inside)) return tread.number;
  }
  for (const nosing of model.stepping.nosings) {
    if (!(nosing.z > ceiling + 1e-6)) continue;
    const gi = V.addScaled(nosing.q, nosing.dir, -innerThickness);
    const go = V.addScaled(nosing.r, nosing.dir, outerThickness);
    // Le nez k porte le dessus de la marche k + 1.
    if (!inside(gi) || !inside(go)) return nosing.index + 1;
  }
  return null;
}

/** Rectangle (polygone CCW) d'une boîte. */
function boxPolygon(min: Vec2, max: Vec2): Polygon2 {
  return [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y },
  ];
}

/** Boîte englobante des points, en rectangle ; vide sans point. */
function boxOf(points: readonly Vec2[]): Polygon2 {
  if (points.length === 0) return [];
  const b = bbox(points);
  return boxPolygon(b.min, b.max);
}

/** Zone d'une collision : enveloppe des intersections convexes, sinon boîte de l'obstacle. */
function overlapZone(pieces: readonly GrossPiece[], obstacle: Polygon2): Polygon2 {
  const pts = pieces.flatMap((p) => clipConvex(p.polygon, ensureCCW(obstacle)));
  const hull = convexHull(pts);
  return hull.length >= 3 ? hull : boxOf(obstacle);
}

/** Polygone d'un disque (inscrit, `ARC_SEGMENTS` côtés). */
function discPolygon(center: Vec2, radius: Mm): Polygon2 {
  const out: Vec2[] = [];
  for (let k = 0; k < ARC_SEGMENTS; k++)
    out.push(V.addScaled(center, V.fromAngle((2 * Math.PI * k) / ARC_SEGMENTS), radius));
  return out;
}

/** Rectangle tourné d'un poteau. */
export function postPolygon(o: Extract<Obstacle, { kind: "post" }>): Polygon2 {
  const a = (o.rotation * Math.PI) / 180;
  const ux = V.fromAngle(a);
  const uy = V.perpLeft(ux);
  const hx = o.sizeX / 2;
  const hy = o.sizeY / 2;
  const at = (sx: number, sy: number): Vec2 =>
    V.add(o.center, V.add(V.scale(ux, sx * hx), V.scale(uy, sy * hy)));
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/**
 * Secteur de débattement d'une porte (polygone convexe) : gonds en `hinge`, vantail fermé le
 * long de la baie, ouvert d'un quart de tour du côté `swing` (vu de `a` vers `b`).
 */
export function doorSwingPolygon(o: Extract<Obstacle, { kind: "door" }>, radius: Mm): Polygon2 {
  const hinge = o.hinge === "a" ? o.a : o.b;
  const free = o.hinge === "a" ? o.b : o.a;
  const ab = V.sub(o.b, o.a);
  const len = V.norm(ab);
  if (!(len > 0) || !(radius > 0)) return [];
  const closed = V.scale(V.sub(free, hinge), 1 / len);
  const side =
    o.swing === "left" ? V.perpLeft(V.scale(ab, 1 / len)) : V.perpRight(V.scale(ab, 1 / len));
  const pts: Vec2[] = [hinge];
  const steps = ARC_SEGMENTS / 4;
  for (let k = 0; k <= steps; k++) {
    const phi = ((Math.PI / 2) * k) / steps;
    pts.push(
      V.add(
        hinge,
        V.add(V.scale(closed, radius * Math.cos(phi)), V.scale(side, radius * Math.sin(phi))),
      ),
    );
  }
  return ensureCCW(pts);
}

/**
 * Rectangle d'une baie de fenêtre : épaisseur du mur qui la porte (axe parallèle, `a` et `b` à
 * moins d'une demi-épaisseur de l'axe), sinon segment `a`–`b`.
 */
function windowPolygon(o: Extract<Obstacle, { kind: "window" }>, walls: readonly Wall[]): Polygon2 {
  const ab = V.sub(o.b, o.a);
  const len = V.norm(ab);
  for (const w of walls) {
    const wd = V.sub(w.b, w.a);
    const wl = V.norm(wd);
    if (!(wl > 0) || !(len > 0)) continue;
    if (Math.abs(V.cross(V.scale(wd, 1 / wl), V.scale(ab, 1 / len))) > 1e-6) continue;
    const off = (p: Vec2): number => Math.abs(V.cross(V.scale(wd, 1 / wl), V.sub(p, w.a)));
    const half = w.thickness / 2 + SITE_FIT_CONTACT_TOL;
    if (off(o.a) <= half && off(o.b) <= half) {
      // Baie ramenée sur l'axe du mur, épaisseur du mur.
      const u = V.scale(wd, 1 / wl);
      const pa = V.addScaled(w.a, u, V.dot(V.sub(o.a, w.a), u));
      const pb = V.addScaled(w.a, u, V.dot(V.sub(o.b, w.a), u));
      return wallPolygon({ id: w.id, a: pa, b: pb, thickness: w.thickness, loadBearing: false });
    }
  }
  return [o.a, o.b];
}

/** La pièce touche-t-elle la baie (contact au nu compris) sur une longueur de baie > tol ? */
function facesWindow(piece: Polygon2, bay: Polygon2, a: Vec2, b: Vec2): boolean {
  const ab = V.sub(b, a);
  const len = V.norm(ab);
  if (!(len > 0)) return false;
  const u = V.scale(ab, 1 / len);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of piece) {
    const d = V.dot(V.sub(p, a), u);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  if (Math.min(hi, len) - Math.max(lo, 0) <= SITE_FIT_CONTACT_TOL) return false;
  if (bay.length < 3) {
    // Baie sans épaisseur : distance de la pièce au segment.
    const inside = pointInPolygon(a, piece, SITE_FIT_CONTACT_TOL) !== "outside";
    if (inside) return true;
    const m = piece.length;
    for (let i = 0; i < m; i++) {
      const p = piece[i]!;
      const q = piece[(i + 1) % m]!;
      if (segmentIntersect(p, q, a, b)) return true;
      if (segmentDistance(p, a, b) <= SITE_FIT_CONTACT_TOL) return true;
      if (segmentDistance(a, p, q) <= SITE_FIT_CONTACT_TOL) return true;
      if (segmentDistance(b, p, q) <= SITE_FIT_CONTACT_TOL) return true;
    }
    return false;
  }
  return convexOverlap(piece, bay, -SITE_FIT_CONTACT_TOL);
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): Mm {
  const ab = V.sub(b, a);
  const l2 = V.normSq(ab);
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / l2));
  return V.distance(p, V.addScaled(a, ab, t));
}

/** Points d'une pièce hors du contour, et croisements de leurs arêtes ; vide si dedans. */
function outsideRoomPoints(piece: Polygon2, room: Polygon2): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of piece)
    if (pointInPolygon(p, room, SITE_FIT_CONTACT_TOL) === "outside") pts.push(p);
  const m = piece.length;
  const r = room.length;
  const crossings: Vec2[] = [];
  for (let i = 0; i < m; i++) {
    const p = piece[i]!;
    const q = piece[(i + 1) % m]!;
    for (let j = 0; j < r; j++) {
      const a = room[j]!;
      const b = room[(j + 1) % r]!;
      const hit = segmentIntersect(p, q, a, b);
      if (!hit) continue;
      // Croisement franc seulement : une extrémité sur l'autre segment est un contact.
      const lp = V.distance(p, q);
      const la = V.distance(a, b);
      const tolP = lp > 0 ? SITE_FIT_CONTACT_TOL / lp : 1;
      const tolA = la > 0 ? SITE_FIT_CONTACT_TOL / la : 1;
      if (hit.t > tolP && hit.t < 1 - tolP && hit.u > tolA && hit.u < 1 - tolA)
        crossings.push(hit.point);
    }
  }
  if (pts.length === 0 && crossings.length === 0) return [];
  // Sommets du contour entrés dans la pièce (contour rentrant qui coupe l'escalier).
  for (const a of room)
    if (pointInPolygon(a, piece, SITE_FIT_CONTACT_TOL) === "inside") pts.push(a);
  return [...pts, ...crossings];
}

/** Sévérité d'adéquation d'un résultat de règle. */
function severityOf(r: RuleResult): SiteConflictSeverity {
  return r.severity === "bloquant" ? "erreur" : r.severity;
}

/** Marche (surface) d'un résultat de règle localisé, sinon emprise entière (boîte). */
function ruleZone(r: RuleResult, layout: Layout, stepping: Stepping | undefined): Polygon2 {
  const loc = r.location;
  const treadNumber =
    loc.kind === "tread"
      ? loc.number
      : loc.kind === "nosing"
        ? loc.index + 1
        : loc.kind === "point" && loc.nosingIndex !== undefined
          ? loc.nosingIndex + 1
          : loc.kind === "part"
            ? loc.treadNumber
            : undefined;
  const treads = stepping?.treads ?? [];
  const t =
    treadNumber === undefined
      ? undefined
      : (treads.find((x) => x.number === treadNumber) ?? treads[treads.length - 1]);
  if (t && t.walkingSurface.length >= 3) return t.walkingSurface;
  if (loc.kind === "point") {
    const s = SITE_FIT_CONTACT_TOL * 100;
    return boxPolygon({ x: loc.at.x - s, y: loc.at.y - s }, { x: loc.at.x + s, y: loc.at.y + s });
  }
  return boxOf(layout.footprint);
}

/** Clé du constat du tracé « tronçons qui se superposent en plan ». */
const SECTIONS_OVERLAP_KEY = "layout.cage.sectionsOverlap";

/** Boîte d'un tronçon du tracé (lignes de départ et d'arrivée, centre d'un arc exclu). */
function sectionBox(layout: Layout, index: number): Polygon2 {
  const s = layout.sections?.[index];
  if (!s) return [];
  const pts = [s.start.left, s.start.right, s.end.left, s.end.right];
  if (s.arc) {
    // Axe en arc : points intermédiaires des bords (approche par excès, dix pas).
    const r0 = V.distance(s.start.left, s.arc.center);
    const r1 = V.distance(s.start.right, s.arc.center);
    const a0 = V.angleOf(V.sub(s.start.left, s.arc.center));
    for (let k = 1; k < 10; k++) {
      const a = a0 + (s.arc.sweep * k) / 10;
      pts.push(
        V.addScaled(s.arc.center, V.fromAngle(a), r0),
        V.addScaled(s.arc.center, V.fromAngle(a), r1),
      );
    }
  }
  return boxOf(pts);
}

function boxIntersection(a: Polygon2, b: Polygon2): Polygon2 {
  if (a.length === 0 || b.length === 0) return a.length > 0 ? a : b;
  const ba = bbox(a);
  const bb = bbox(b);
  const min = { x: Math.max(ba.min.x, bb.min.x), y: Math.max(ba.min.y, bb.min.y) };
  const max = { x: Math.min(ba.max.x, bb.max.x), y: Math.min(ba.max.y, bb.max.y) };
  if (!(max.x >= min.x) || !(max.y >= min.y)) return boxOf([...a, ...b]);
  return boxPolygon(min, max);
}

/** Paramètre numérique d'un message (entier attendu). */
function intParam(m: Message, name: string): number | undefined {
  const v = m.params?.[name];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isInteger(n) ? n : undefined;
}

/** Options de `computeSiteFit`. */
export interface SiteFitOptions {
  /** Contrôle de conception du modèle : violations ECHAPPEE_* reprises (échappée). */
  readonly compliance?: ComplianceReport;
  /** Épaisseurs latérales de la structure ; défaut : `projectLateralThickness(project)`. */
  readonly lateral?: LateralThickness;
}

/**
 * Conflits d'une emprise hors tout (pièces convexes, repère du site) avec les murs, le contour de
 * la pièce et les obstacles, dans l'ordre : murs, contour, obstacles (ordre du site). Les
 * fenêtres ne sont testées que pour les pièces qui portent une marche (`tread`, `z`). Partagé
 * par `siteGeometryConflicts` et le crible analytique de l'assistant (`assistant/propose.ts`).
 */
export function footprintConflicts(
  site: Site,
  pieces: readonly GrossPiece[],
  settings: SiteFitProfile,
): SiteConflict[] {
  const tol = SITE_FIT_CONTACT_TOL;
  const out: SiteConflict[] = [];

  // Murs.
  for (const wall of site.walls) {
    const wp = wallPolygon(wall);
    const hits = pieces.filter((p) => convexOverlap(p.polygon, wp, tol));
    if (hits.length === 0) continue;
    out.push({
      kind: "wall",
      severity: "erreur",
      message: msg("site.fit.wall", { wall: wall.id }),
      zone: overlapZone(hits, wp),
      targetId: wall.id,
    });
  }

  // Contour de la pièce.
  const room = site.room ? ensureCCW(site.room.points) : undefined;
  if (room && room.length >= 3) {
    const pts = pieces.flatMap((p) => outsideRoomPoints(p.polygon, room));
    if (pts.length > 0) {
      const hull = convexHull(pts);
      out.push({
        kind: "outsideRoom",
        severity: "erreur",
        message: msg("site.fit.outsideRoom"),
        zone: hull.length >= 3 ? hull : boxOf(pts),
      });
    }
  }

  // Obstacles.
  for (const o of site.obstacles ?? []) {
    switch (o.kind) {
      case "post": {
        const poly = postPolygon(o);
        const hits = pieces.filter((p) => convexOverlap(p.polygon, poly, tol));
        if (hits.length > 0)
          out.push({
            kind: "obstacle",
            severity: "erreur",
            message: msg("site.fit.post", { id: o.id }),
            zone: overlapZone(hits, poly),
            targetId: o.id,
          });
        break;
      }
      case "circularPost": {
        const hits = pieces.filter((p) => discOverlap(o.center, o.radius, p.polygon, tol));
        if (hits.length > 0)
          out.push({
            kind: "obstacle",
            severity: "erreur",
            message: msg("site.fit.circularPost", { id: o.id }),
            zone: overlapZone(hits, discPolygon(o.center, o.radius)),
            targetId: o.id,
          });
        break;
      }
      case "zone": {
        const hits = pieces.filter((p) => convexSimpleOverlap(p.polygon, o.points, tol));
        if (hits.length > 0) {
          const box = boxIntersection(boxOf(hits.flatMap((h) => h.polygon)), boxOf(o.points));
          out.push({
            kind: "obstacle",
            severity: "erreur",
            message: msg("site.fit.zone", { id: o.id }),
            zone: box,
            targetId: o.id,
          });
        }
        break;
      }
      case "door": {
        const radius = settings.doorSwingRadius ?? V.distance(o.a, o.b);
        const sector = doorSwingPolygon(o, radius);
        if (sector.length < 3) break;
        const hits = pieces.filter((p) => convexOverlap(p.polygon, sector, tol));
        if (hits.length > 0)
          out.push({
            kind: "doorSwing",
            severity: "avertissement",
            message: msg("site.fit.door", { id: o.id, radius: dec(radius, 0) }),
            zone: sector,
            targetId: o.id,
          });
        break;
      }
      case "window": {
        const bay = windowPolygon(o, site.walls);
        const facing = pieces.filter(
          (p) =>
            p.tread !== undefined &&
            p.z !== undefined &&
            p.z < o.head &&
            facesWindow(p.polygon, bay.length >= 3 ? bay : [], o.a, o.b),
        );
        if (facing.length > 0) {
          const nums = facing.map((p) => p.tread!);
          const from = Math.min(...nums);
          const to = Math.max(...nums);
          const params = { id: o.id, sill: dec(o.sill, 0), head: dec(o.head, 0) };
          out.push({
            kind: "window",
            severity: "conseil",
            message:
              from === to
                ? msg("site.fit.windowOne", { ...params, tread: from })
                : msg("site.fit.window", { ...params, from, to }),
            zone: bay.length >= 3 ? bay : boxOf([o.a, o.b]),
            targetId: o.id,
          });
        }
        break;
      }
    }
  }

  return out;
}

/**
 * Conflits du dégagement d'arrivée (`avertissement`) : rectangle `zone` (voir `arrivalZone`)
 * contre les murs et les poteaux (droits, ronds) seulement, éléments qui montent sur toute la
 * hauteur ; zones interdites, portes, fenêtres et contour décrivent le niveau bas (F15 (4)).
 */
export function arrivalClearanceConflicts(
  site: Site,
  zone: Polygon2,
  clearance: Mm,
): SiteConflict[] {
  const tol = SITE_FIT_CONTACT_TOL;
  const out: SiteConflict[] = [];
  const c = dec(clearance, 0);
  const blocked = (id: string, message: Message): void => {
    out.push({
      kind: "arrivalClearance",
      severity: "avertissement",
      message,
      zone,
      targetId: id,
    });
  };
  for (const wall of site.walls)
    if (convexOverlap(zone, wallPolygon(wall), tol))
      blocked(wall.id, msg("site.fit.arrival.wall", { wall: wall.id, clearance: c }));
  for (const o of site.obstacles ?? []) {
    const hit =
      o.kind === "post"
        ? convexOverlap(zone, postPolygon(o), tol)
        : o.kind === "circularPost"
          ? discOverlap(o.center, o.radius, zone, tol)
          : false;
    if (hit) blocked(o.id, msg("site.fit.arrival.obstacle", { id: o.id, clearance: c }));
  }
  return out;
}

/**
 * Conflits géométriques (tout sauf l'échappée), dans l'ordre : murs, contour, obstacles (ordre
 * du site), dégagement d'arrivée, dalle, recouvrement sur elle-même.
 */
export function siteGeometryConflicts(
  project: Project,
  layout: Layout,
  stepping?: Stepping,
  lateral: LateralThickness = projectLateralThickness(project),
): SiteConflict[] {
  const { site } = project;
  const tol = SITE_FIT_CONTACT_TOL;
  const settings = resolveSiteFitProfile(project.workshop?.siteFit);
  const pieces = stairGrossPieces(layout, stepping, lateral);
  const out: SiteConflict[] = [];

  out.push(...footprintConflicts(site, pieces, settings));

  // Dégagement d'arrivée.
  const arrival = arrivalZone(layout, stepping, lateral, settings.arrivalClearance);
  if (arrival) out.push(...arrivalClearanceConflicts(site, arrival.zone, arrival.clearance));

  // Dalle haute.
  const opening = openingPolygon(site.opening);
  if (opening && stepping && stepping.treads.length > 0) {
    const ceiling = ceilingOf(site);
    // Marches seules d'abord (erreur), puis structure comprise (avertissement).
    const bare = slabIntrusion({ stepping }, opening, ceiling, 0, 0, tol);
    const withStructure =
      bare === null && (lateral.inner > 0 || lateral.outer > 0)
        ? slabIntrusion({ stepping }, opening, ceiling, lateral.inner, lateral.outer, tol)
        : null;
    const found = bare ?? withStructure;
    if (found !== null) {
      // Numéro au-delà de la dernière marche : ligne d'arrivée (dernier nez), sans marche.
      const lastTread = stepping.treads[stepping.treads.length - 1]!.number;
      const arrivalLine = found > lastTread;
      const tread = arrivalLine ? lastTread : found;
      const t = stepping.treads.find((x) => x.number === tread);
      const piece = pieces.find((p) => p.tread === tread);
      const ceilingParam = dec(ceiling, 0);
      const message = arrivalLine
        ? msg(bare !== null ? "site.fit.slabArrival" : "site.fit.slabStructureArrival", {
            ceiling: ceilingParam,
          })
        : msg(bare !== null ? "site.fit.slab" : "site.fit.slabStructure", {
            tread,
            ceiling: ceilingParam,
          });
      out.push({
        kind: "slab",
        severity: bare !== null ? "erreur" : "avertissement",
        message,
        zone:
          bare !== null && !arrivalLine && t && t.walkingSurface.length >= 3
            ? t.walkingSurface
            : (piece?.polygon ?? boxOf(opening)),
      });
    }
  }

  // Recouvrement de la cage sur elle-même (constat du tracé).
  for (const e of layout.errors ?? []) {
    if (e.key !== SECTIONS_OVERLAP_KEY) continue;
    const a = intParam(e, "sectionA");
    const b = intParam(e, "sectionB");
    if (a === undefined || b === undefined) continue;
    out.push({
      kind: "selfOverlap",
      severity: "erreur",
      message: msg("site.fit.selfOverlap", { sectionA: a, sectionB: b }),
      zone: boxIntersection(sectionBox(layout, a - 1), sectionBox(layout, b - 1)),
    });
  }
  return out;
}

/**
 * Rectangle du dégagement d'arrivée : largeur hors tout de la ligne d'arrivée (dernier nez,
 * épaisseurs latérales comprises), profondeur `clearance` (défaut : emmarchement à l'arrivée)
 * dans le sens de la montée. `null` sans ligne d'arrivée.
 */
export function arrivalZone(
  layout: Layout,
  stepping: Stepping | undefined,
  lateral: LateralThickness,
  clearance: Mm | null,
): { readonly zone: Polygon2; readonly clearance: Mm } | null {
  const last = stepping?.nosings[stepping.nosings.length - 1];
  if (!last) return null;
  const width = V.distance(last.q, last.r);
  const depth = clearance ?? width;
  if (!(depth > GEOM_EPS) || !(width > GEOM_EPS)) return null;
  let up = V.perpLeft(last.dir);
  const length = curveLength(layout.walkline);
  if (length > 0) {
    const tangent = curveTangentAt(layout.walkline, length);
    if (V.dot(up, tangent) < 0) up = V.scale(up, -1);
  }
  const gi = V.addScaled(last.q, last.dir, -lateral.inner);
  const go = V.addScaled(last.r, last.dir, lateral.outer);
  // Le rectangle commence au nu de la ligne d'arrivée (contact au nu avec l'escalier).
  const zone = ensureCCW([gi, go, V.addScaled(go, up, depth), V.addScaled(gi, up, depth)]);
  return { zone, clearance: depth };
}

/** Violations des règles ECHAPPEE_* du contrôle, reprises en conflits (sans recalcul). */
export function headroomConflicts(
  compliance: ComplianceReport | undefined,
  layout: Layout,
  stepping?: Stepping,
): SiteConflict[] {
  const out: SiteConflict[] = [];
  for (const r of compliance?.results ?? []) {
    if (r.status !== "violation" || !r.ruleId.startsWith("ECHAPPEE_")) continue;
    out.push({
      kind: "headroom",
      severity: severityOf(r),
      message: r.message,
      zone: ruleZone(r, layout, stepping),
      ruleId: r.ruleId,
    });
  }
  return out;
}

/**
 * Conflits à lister à côté des cartes de règles (inspecteur, PDF) : tous sauf l'échappée
 * (`headroom`), déjà affichée par la carte de sa règle ECHAPPEE_*. `Model.siteFit` les garde
 * tous (calque des conflits de l'éditeur de plan).
 */
export function siteConflictsBesideRules(
  conflicts: readonly SiteConflict[] | undefined,
): SiteConflict[] {
  return (conflicts ?? []).filter((c) => c.kind !== "headroom");
}

/** Ordre des sévérités (erreurs d'abord) pour un tri stable. */
const SEVERITY_ORDER: Readonly<Record<SiteConflictSeverity, number>> = {
  erreur: 0,
  avertissement: 1,
  conseil: 2,
};

/** Trie les conflits par sévérité, ordre de détection conservé à sévérité égale. */
export function sortSiteConflicts(conflicts: readonly SiteConflict[]): SiteConflict[] {
  return conflicts
    .map((c, i) => ({ c, i }))
    .sort((a, b) => SEVERITY_ORDER[a.c.severity] - SEVERITY_ORDER[b.c.severity] || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Adéquation de l'escalier au site (voir l'en-tête) : conflits géométriques puis échappée,
 * triés par sévérité. Le pipeline enveloppe l'appel (`pipeline.internalError`, étape
 * « Adéquation au site ») : `buildModel` ne lève jamais.
 */
export function computeSiteFit(
  project: Project,
  layout: Layout,
  stepping?: Stepping,
  options: SiteFitOptions = {},
): SiteConflict[] {
  return sortSiteConflicts([
    ...siteGeometryConflicts(project, layout, stepping, options.lateral),
    ...headroomConflicts(options.compliance, layout, stepping),
  ]);
}
