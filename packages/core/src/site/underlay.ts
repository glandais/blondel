/**
 * Géométrie du calque de fond (jalon 7) : entités DXF simplifiées → segments du repère du site,
 * emprise, placement et calibration de l'image. Fonctions pures, sans DOM.
 */
import { arcSeg, lineSeg, segEnd, segStart } from "../geom2d/segment.js";
import * as V from "../geom2d/vec.js";
import type { BBox } from "../geom2d/polygon.js";
import type { CurveSeg, Mm, Vec2 } from "../model/primitives.js";
import type { DxfUnderlay, ImageUnderlay, UnderlayEntity, UnderlayPlacement } from "./schema.js";

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

/** Placement neutre (repère du calque = repère du site). */
export const IDENTITY_PLACEMENT: UnderlayPlacement = { origin: { x: 0, y: 0 }, rotation: 0 };

/** Point du repère du calque → point du repère du site. */
export function placePoint(placement: UnderlayPlacement, p: Vec2): Vec2 {
  const r = placement.rotation * DEG;
  const q = r === 0 ? p : V.rotate(p, r);
  return V.add(placement.origin, q);
}

/** Point du repère du site → point du repère du calque (inverse de `placePoint`). */
export function unplacePoint(placement: UnderlayPlacement, p: Vec2): Vec2 {
  const q = V.sub(p, placement.origin);
  const r = placement.rotation * DEG;
  return r === 0 ? q : V.rotate(q, -r);
}

/**
 * Segment (droite ou arc) du renflement DXF `bulge` = tan(θ/4) entre `a` et `b` ; θ > 0 : arc
 * trigonométrique. Renflement nul ou corde nulle : segment de droite.
 */
export function bulgeSegment(a: Vec2, b: Vec2, bulge: number): CurveSeg {
  const chord = V.distance(a, b);
  if (bulge === 0 || !(chord > 0) || !Number.isFinite(bulge)) return lineSeg(a, b);
  const theta = 4 * Math.atan(bulge);
  const radius = chord / (2 * Math.abs(Math.sin(theta / 2)));
  const u = V.scale(V.sub(b, a), 1 / chord);
  // Centre à gauche de la corde pour un arc trigonométrique de moins d'un demi-tour.
  const h = chord / 2 / Math.tan(theta / 2);
  const center = V.addScaled(V.lerp(a, b, 0.5), V.perpLeft(u), h);
  const start = Math.atan2(a.y - center.y, a.x - center.x);
  return arcSeg(center, radius, start, theta);
}

/** Segments d'une entité dans le repère du calque. */
export function entitySegments(e: UnderlayEntity): CurveSeg[] {
  switch (e.kind) {
    case "line":
      return [lineSeg(e.a, e.b)];
    case "polyline": {
      const out: CurveSeg[] = [];
      const n = e.points.length;
      const count = e.closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const a = e.points[i]!;
        const b = e.points[(i + 1) % n]!;
        if (V.distance(a, b) === 0) continue;
        out.push(bulgeSegment(a, b, e.bulges?.[i] ?? 0));
      }
      return out;
    }
    case "arc": {
      let sweep = (e.end - e.start) % 360;
      if (sweep <= 0) sweep += 360;
      return [arcSeg(e.center, e.radius, e.start * DEG, sweep * DEG)];
    }
    case "circle":
      return [arcSeg(e.center, e.radius, 0, TWO_PI)];
  }
}

/** Segment transporté par un placement (rotation puis translation). */
export function placeSegment(placement: UnderlayPlacement, seg: CurveSeg): CurveSeg {
  if (seg.kind === "line") {
    return lineSeg(placePoint(placement, seg.a), placePoint(placement, seg.b));
  }
  return arcSeg(
    placePoint(placement, seg.center),
    seg.radius,
    seg.startAngle + placement.rotation * DEG,
    seg.sweep,
  );
}

/** Tous les segments du calque DXF, dans le repère du site. */
export function underlaySegments(dxf: DxfUnderlay): CurveSeg[] {
  const out: CurveSeg[] = [];
  for (const e of dxf.entities) {
    for (const s of entitySegments(e)) out.push(placeSegment(dxf.placement, s));
  }
  return out;
}

/** Vrai si l'arc est un cercle complet. */
export function isFullCircle(seg: CurveSeg): boolean {
  return seg.kind === "arc" && Math.abs(seg.sweep) >= TWO_PI - 1e-9;
}

/** Points extrêmes d'un segment (extrémités, et points cardinaux atteints par un arc). */
function extremePoints(seg: CurveSeg): Vec2[] {
  if (seg.kind === "line") return [seg.a, seg.b];
  const pts = [segStart(seg), segEnd(seg)];
  const { center, radius, startAngle, sweep } = seg;
  for (let k = 0; k < 4; k++) {
    const phi = (k * Math.PI) / 2;
    // Écart orienté de l'angle de départ au point cardinal, dans le sens du balayage.
    let d = Math.sign(sweep) * (phi - startAngle);
    d = ((d % TWO_PI) + TWO_PI) % TWO_PI;
    if (d <= Math.abs(sweep) + 1e-12) {
      pts.push({ x: center.x + radius * Math.cos(phi), y: center.y + radius * Math.sin(phi) });
    }
  }
  return pts;
}

/** Boîte englobante exacte d'un ensemble de segments ; `null` s'il est vide. */
export function segmentsBounds(segments: readonly CurveSeg[]): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    for (const p of extremePoints(s)) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!(minX <= maxX)) return null;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** Boîte englobante d'un segment (utilisée par l'index d'accroche). */
export function segmentBounds(seg: CurveSeg): BBox {
  return segmentsBounds([seg])!;
}

/**
 * Placement qui amène le centre `from` (repère du calque) sur `to` (repère du site), à rotation
 * donnée : recentre un plan de masse en coordonnées lointaines (Lambert…) sur l'escalier.
 */
export function placementCentering(from: Vec2, to: Vec2, rotation = 0): UnderlayPlacement {
  const rotated = V.rotate(from, rotation * DEG);
  return { origin: V.sub(to, rotated), rotation };
}

// ------------------------------------------------------------------ Image calibrée

/**
 * Pixel de l'image (origine en haut à gauche, y vers le bas) → point du site :
 * P = O + R(rotation) · (s · x, −s · y), s = `mmPerPx`.
 */
export function imagePixelToSite(
  img: Pick<ImageUnderlay, "mmPerPx" | "placement">,
  px: Vec2,
): Vec2 {
  return placePoint(img.placement, { x: img.mmPerPx * px.x, y: -img.mmPerPx * px.y });
}

/** Point du site → pixel de l'image (inverse de `imagePixelToSite`). */
export function siteToImagePixel(img: Pick<ImageUnderlay, "mmPerPx" | "placement">, p: Vec2): Vec2 {
  const q = unplacePoint(img.placement, p);
  return { x: q.x / img.mmPerPx, y: -q.y / img.mmPerPx };
}

/** Coins de l'image dans le site (haut gauche, haut droit, bas droit, bas gauche). */
export function imageCorners(img: ImageUnderlay): Vec2[] {
  const w = img.widthPx;
  const h = img.heightPx;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => imagePixelToSite(img, p));
}

/** Erreur de calibration (points confondus, distance invalide). */
export class CalibrationError extends RangeError {
  override name = "CalibrationError";
}

/**
 * Calibration par deux points et une distance : `a` et `b` sont deux pixels de l'image dont la
 * distance réelle est `distance` (mm). L'échelle devient distance / |ab| (mm par pixel) ; le
 * point `a` garde sa position dans le site (l'image est mise à l'échelle autour de lui), la
 * rotation est conservée. Si `anchor` est donné, `a` est amené sur ce point du site.
 */
export function calibrateImage<T extends ImageUnderlay>(
  img: T,
  a: Vec2,
  b: Vec2,
  distance: Mm,
  anchor?: Vec2,
): T {
  const px = V.distance(a, b);
  if (!(px >= 1)) {
    throw new CalibrationError("calibration : les deux points doivent être distincts (≥ 1 pixel)");
  }
  if (!(distance > 0) || !Number.isFinite(distance)) {
    throw new CalibrationError("calibration : la distance doit être un nombre positif (mm)");
  }
  const mmPerPx = distance / px;
  const fixed = anchor ?? imagePixelToSite(img, a);
  const local = V.rotate({ x: mmPerPx * a.x, y: -mmPerPx * a.y }, img.placement.rotation * DEG);
  return {
    ...img,
    mmPerPx,
    placement: { ...img.placement, origin: V.sub(fixed, local) },
    calibration: { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, distance },
  };
}
