/**
 * Géométrie d'affichage et de saisie du plan « Site et saisie » (jalon 7) : chemins SVG du
 * calque DXF, contours des murs, cadrage, conversion écran ↔ site, candidats d'accroche du
 * projet et état du tracé en cours. Fonctions pures (testées sous Node) ; le calcul métier
 * (accroches, trémie, relevé) est celui du cœur (`@blondel/core`, `site/`).
 *
 * Convention d'affichage : le SVG dessine en coordonnées du site (mm, y vers le haut) dans un
 * groupe `scale(1, -1)` ; le `viewBox` est donc exprimé en (x, −y).
 */
import {
  bbox,
  entitySegments,
  flattenCurve,
  imageCorners,
  openingPolygon,
  placeSegment,
  segmentsBounds,
  type BBox,
  type CurveSeg,
  type DxfUnderlay,
  type Model,
  type Project,
  type SnapCandidate,
  type Vec2,
  type Wall,
} from "@blondel/core";

const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();

/**
 * Chemin SVG (`d`) d'un segment, en coordonnées du site. Les arcs sont écrits avec le drapeau
 * de balayage 1 pour un arc trigonométrique : dans le groupe `scale(1, -1)`, le sens positif du
 * repère local est le sens trigonométrique du site. Un cercle complet = deux demi-arcs.
 */
export function segmentPath(seg: CurveSeg, move = true): string {
  if (seg.kind === "line") {
    return `${move ? `M${n2(seg.a.x)} ${n2(seg.a.y)}` : ""}L${n2(seg.b.x)} ${n2(seg.b.y)}`;
  }
  const { center: c, radius: r, startAngle: a0, sweep } = seg;
  const at = (t: number): Vec2 => ({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  const p0 = at(a0);
  const head = move ? `M${n2(p0.x)} ${n2(p0.y)}` : "";
  const flag = sweep > 0 ? 1 : 0;
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-9) {
    const mid = at(a0 + Math.PI);
    return `${head}A${n2(r)} ${n2(r)} 0 0 ${flag} ${n2(mid.x)} ${n2(mid.y)}A${n2(r)} ${n2(r)} 0 0 ${flag} ${n2(p0.x)} ${n2(p0.y)}`;
  }
  const p1 = at(a0 + sweep);
  const large = Math.abs(sweep) > Math.PI ? 1 : 0;
  return `${head}A${n2(r)} ${n2(r)} 0 ${large} ${flag} ${n2(p1.x)} ${n2(p1.y)}`;
}

/** Chemin SVG unique de tout le calque DXF (un seul élément, même pour 5 000 entités). */
export function dxfPathData(dxf: DxfUnderlay): string {
  const parts: string[] = [];
  for (const e of dxf.entities) {
    const segs = entitySegments(e).map((s) => placeSegment(dxf.placement, s));
    let last: Vec2 | null = null;
    for (const s of segs) {
      const start = s.kind === "line" ? s.a : null;
      const cont =
        start !== null &&
        last !== null &&
        Math.abs(start.x - last.x) + Math.abs(start.y - last.y) < 1e-6;
      parts.push(segmentPath(s, !cont));
      last = s.kind === "line" ? s.b : null;
    }
  }
  return parts.join("");
}

/** Contour d'un mur (axe `a`–`b`, nus à ± épaisseur / 2). */
export function wallOutline(w: Wall): Vec2[] {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * (w.thickness / 2);
  const ny = (dx / L) * (w.thickness / 2);
  return [
    { x: w.a.x + nx, y: w.a.y + ny },
    { x: w.b.x + nx, y: w.b.y + ny },
    { x: w.b.x - nx, y: w.b.y - ny },
    { x: w.a.x - nx, y: w.a.y - ny },
  ];
}

/** Attribut `points` d'un polygone ou d'une polyligne. */
export function pointsAttr(pts: readonly Vec2[]): string {
  return pts.map((p) => `${n2(p.x)},${n2(p.y)}`).join(" ");
}

/** Contour de l'escalier et lignes de nez (pour le repérage pendant la saisie). */
export function stairOverlay(model: Model): {
  footprint: Vec2[];
  nosings: [Vec2, Vec2][];
  walkline: Vec2[];
} {
  return {
    footprint: [...model.layout.footprint],
    nosings: model.stepping.nosings.map((n) => [n.q, n.r]),
    walkline:
      model.layout.walkline.segments.length > 0 ? flattenCurve(model.layout.walkline, 1) : [],
  };
}

function union(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
  };
}

/** Emprise de ce qui est affiché : escalier, trémie, murs, calque DXF, image. */
export function siteBounds(
  project: Project,
  model: Model | null,
  includeUnderlay = true,
): BBox | null {
  let b: BBox | null = null;
  const pts: Vec2[] = [];
  if (model && model.layout.footprint.length > 0) pts.push(...model.layout.footprint);
  const opening = openingPolygon(project.site.opening);
  if (opening) pts.push(...opening);
  for (const w of project.site.walls) pts.push(...wallOutline(w));
  if (pts.length > 0) b = bbox(pts);
  const u = project.site.underlay;
  if (includeUnderlay && u?.dxf) {
    b = union(
      b,
      segmentsBounds(
        u.dxf.entities
          .flatMap((e) => entitySegments(e))
          .map((s) => placeSegment(u.dxf!.placement, s)),
      ),
    );
  }
  if (includeUnderlay && u?.image) b = union(b, bbox(imageCorners(u.image)));
  return b;
}

/** Cadrage : centre et demi-largeur (mm) de la vue. */
export interface ViewBox {
  readonly cx: number;
  readonly cy: number;
  /** Largeur visible (mm). */
  readonly width: number;
}

/** Vue qui contient `b` avec une marge relative, pour un rapport largeur / hauteur donné. */
export function fitView(b: BBox | null, aspect: number, margin = 0.08): ViewBox {
  if (!b) return { cx: 0, cy: 0, width: 5000 };
  const w = Math.max(b.max.x - b.min.x, 1);
  const h = Math.max(b.max.y - b.min.y, 1);
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const width = Math.max(w, h * a) * (1 + 2 * margin);
  return { cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2, width };
}

/** Attribut `viewBox` (repère retourné : y SVG = −y du site). */
export function viewBoxAttr(v: ViewBox, aspect: number): string {
  const h = v.width / (aspect > 0 && Number.isFinite(aspect) ? aspect : 1);
  return `${n2(v.cx - v.width / 2)} ${n2(-v.cy - h / 2)} ${n2(v.width)} ${n2(h)}`;
}

/** Zoom de facteur `k` (> 1 : rapproche) autour du point `p` du site, qui reste fixe. */
export function zoomAt(v: ViewBox, p: Vec2, k: number): ViewBox {
  const width = Math.min(Math.max(v.width / k, 50), 5_000_000);
  const r = width / v.width;
  return { cx: p.x + (v.cx - p.x) * r, cy: p.y + (v.cy - p.y) * r, width };
}

/**
 * Point du site sous le pointeur : (u, v) = position relative dans l'élément (0 à 1, v vers le
 * bas) ; l'élément SVG garde le rapport de la vue (`preserveAspectRatio="none"` inutile).
 */
export function screenToSite(v: ViewBox, aspect: number, u: number, w: number): Vec2 {
  const h = v.width / (aspect > 0 && Number.isFinite(aspect) ? aspect : 1);
  return { x: v.cx - v.width / 2 + u * v.width, y: v.cy + h / 2 - w * h };
}

/** Points d'accroche propres au projet : sommets de trémie, extrémités des murs, tracé en cours. */
export function projectSnapPoints(project: Project, draft: readonly Vec2[] = []): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const opening = openingPolygon(project.site.opening);
  if (opening) for (const p of opening) out.push({ point: p, kind: "point" });
  for (const w of project.site.walls) {
    out.push({ point: w.a, kind: "point" }, { point: w.b, kind: "point" });
    for (const p of wallOutline(w)) out.push({ point: p, kind: "endpoint" });
  }
  for (const p of draft) out.push({ point: p, kind: "point" });
  return out;
}

/** Segments d'accroche propres au projet : côtés de la trémie et nus des murs. */
export function projectSnapSegments(project: Project): CurveSeg[] {
  const segs: CurveSeg[] = [];
  const ring = (pts: readonly Vec2[]) => {
    for (let i = 0; i < pts.length; i++) {
      segs.push({ kind: "line", a: pts[i]!, b: pts[(i + 1) % pts.length]! });
    }
  };
  const opening = openingPolygon(project.site.opening);
  if (opening) ring(opening);
  for (const w of project.site.walls) ring(wallOutline(w));
  return segs;
}

// ------------------------------------------------------------------ Tracé en cours

export type PlanTool = "pan" | "opening" | "wall" | "calibrate";

/** Libellé français d'un type d'accroche (bulle d'aide). */
export const SNAP_LABELS: Readonly<Record<SnapCandidate["kind"], string>> = {
  endpoint: "Extrémité",
  midpoint: "Milieu",
  intersection: "Intersection",
  center: "Centre",
  point: "Sommet",
};

/**
 * Clic de tracé de trémie : ajoute le point, ou ferme le contour si l'on revient sur le premier
 * sommet (à moins de `closeRadius`) avec au moins trois sommets ; avec moins de trois sommets,
 * ce retour est ignoré.
 */
export function openingClick(
  draft: readonly Vec2[],
  p: Vec2,
  closeRadius: number,
): { readonly draft: Vec2[]; readonly closed: boolean } {
  const first = draft[0];
  if (first && Math.hypot(p.x - first.x, p.y - first.y) <= closeRadius) {
    // Retour sur le premier sommet : ferme le contour s'il en a trois, sinon clic ignoré (un
    // sommet répété donnerait un contour replié, refusé à la fermeture).
    return { draft: [...draft], closed: draft.length >= 3 };
  }
  const last = draft[draft.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6)
    return { draft: [...draft], closed: false };
  return { draft: [...draft, p], closed: false };
}

/**
 * Ligne tracée d'un mur (QUESTIONS A24, décision du 2026-09-29) : l'axe (deux clics, défaut,
 * convention `WallSchema`) ou un nu, dont le côté du mur est donné par un **troisième clic**
 * (au lieu d'une liste gauche / droite).
 */
export type WallTraceMode = "axis" | "face";

/**
 * Côté du tracé `a` → `b` où se trouve `p` (`left` : à gauche dans le sens du tracé, convention
 * `WallTraceReference` du cœur) ; `null` si `p` est sur la droite du tracé (à `tolerance` près)
 * ou si le tracé est de longueur nulle.
 */
export function wallFaceSide(a: Vec2, b: Vec2, p: Vec2, tolerance = 1e-6): "left" | "right" | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (!(L > 0)) return null;
  // Distance signée de p à la droite (a, b), positive à gauche.
  const d = (dx * (p.y - a.y) - dy * (p.x - a.x)) / L;
  if (Math.abs(d) <= tolerance) return null;
  return d > 0 ? "left" : "right";
}

/**
 * Contour d'un mur tracé au nu `a`–`b`, le corps du mur du côté `side` (aperçu avant le
 * troisième clic ; l'axe enregistré est déduit par `withWall` du cœur).
 */
export function faceWallOutline(
  a: Vec2,
  b: Vec2,
  thickness: number,
  side: "left" | "right",
): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const k = ((side === "left" ? 1 : -1) * thickness) / L;
  const n = { x: -dy * k, y: dx * k };
  return [a, b, { x: b.x + n.x, y: b.y + n.y }, { x: a.x + n.x, y: a.y + n.y }];
}

/** Résultat d'un clic de l'outil « Tracer un mur ». */
export type WallClick =
  | { readonly kind: "draft"; readonly draft: Vec2[] }
  | {
      readonly kind: "commit";
      readonly a: Vec2;
      readonly b: Vec2;
      readonly reference: "axis" | "left" | "right";
    }
  | { readonly kind: "ignored"; readonly draft: Vec2[]; readonly reason: string };

/**
 * Clic de tracé de mur : à l'axe, deux clics (extrémités) ; au nu, deux clics (extrémités du
 * nu) puis un troisième du côté du mur. Un point répété, ou un troisième clic sur la ligne du
 * nu, est ignoré avec un motif.
 */
export function wallClick(draft: readonly Vec2[], p: Vec2, mode: WallTraceMode): WallClick {
  const [a, b] = draft;
  if (!a) return { kind: "draft", draft: [p] };
  if (!b) {
    if (Math.hypot(p.x - a.x, p.y - a.y) < 1) {
      return {
        kind: "ignored",
        draft: [...draft],
        reason: "Second point confondu avec le premier.",
      };
    }
    return mode === "axis"
      ? { kind: "commit", a, b: p, reference: "axis" }
      : { kind: "draft", draft: [a, p] };
  }
  const side = wallFaceSide(a, b, p);
  if (!side) {
    return {
      kind: "ignored",
      draft: [...draft],
      reason: "Cliquer d'un côté du nu tracé : le côté où se trouve le mur.",
    };
  }
  return { kind: "commit", a, b, reference: side };
}

// ------------------------------------------------------------------ Réglages d'import

/**
 * Épaisseur proposée pour un mur tracé (mm), modifiable avant le tracé. Valeur de saisie de
 * l'interface, sans source métier : **à valider** (docs/LEDGER.md).
 */
export const DEFAULT_WALL_THICKNESS_MM = 200;

/** Plus grand côté (pixels) d'une image de fond enregistrée ; au-delà, elle est réduite. */
export const IMAGE_MAX_SIDE_PX = 4096;

/**
 * Distance (mm) au-delà de laquelle un plan DXF est jugé « lointain » (coordonnées
 * géographiques, Lambert…) et recentré sur l'escalier à l'import.
 */
export const FAR_UNDERLAY_MM = 100_000;

/** Unités proposées quand le DXF n'indique pas la sienne. */
export const UNIT_CHOICES: readonly { readonly mm: number; readonly label: string }[] = [
  { mm: 1, label: "Millimètre" },
  { mm: 10, label: "Centimètre" },
  { mm: 1000, label: "Mètre" },
  { mm: 25.4, label: "Pouce" },
  { mm: 304.8, label: "Pied" },
];

const center = (b: BBox): Vec2 => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 });

/** Distance d'un point à une boîte englobante (0 à l'intérieur). */
function distanceToBox(p: Vec2, b: BBox): number {
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
  const dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y);
  return Math.hypot(dx, dy);
}

/**
 * Placement initial d'un plan DXF : tel quel s'il est proche de l'escalier (repère d'architecte
 * local), sinon recentré sur l'escalier (plan en coordonnées lointaines).
 */
export function defaultDxfPlacement(
  bounds: BBox | null,
  stair: BBox | null,
): { origin: Vec2; rotation: number } {
  if (!bounds || !stair) return { origin: { x: 0, y: 0 }, rotation: 0 };
  const target = center(stair);
  if (distanceToBox(target, bounds) <= FAR_UNDERLAY_MM) {
    return { origin: { x: 0, y: 0 }, rotation: 0 };
  }
  const c = center(bounds);
  return { origin: { x: target.x - c.x, y: target.y - c.y }, rotation: 0 };
}

/**
 * Échelle et placement provisoires d'une image importée, avant calibration : image centrée sur
 * l'escalier, trois fois plus large que lui (au moins 8 m). Simple aide au repérage.
 */
export function defaultImagePlacement(
  widthPx: number,
  heightPx: number,
  stair: BBox | null,
): { mmPerPx: number; placement: { origin: Vec2; rotation: number } } {
  const c = stair ? center(stair) : { x: 0, y: 0 };
  const span = stair
    ? Math.max(8000, 3 * Math.max(stair.max.x - stair.min.x, stair.max.y - stair.min.y))
    : 8000;
  const mmPerPx = span / Math.max(1, widthPx);
  return {
    mmPerPx,
    placement: {
      origin: { x: c.x - (widthPx * mmPerPx) / 2, y: c.y + (heightPx * mmPerPx) / 2 },
      rotation: 0,
    },
  };
}
