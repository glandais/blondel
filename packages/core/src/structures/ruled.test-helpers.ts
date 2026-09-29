/**
 * Outils de test : concordance entre le solide 3D « ruled » d'une pièce roulée et son développé
 * (fibre neutre). Les rails 3D sont reportés sur la fibre neutre (décalage de e/2 selon la
 * normale d'épaississement), puis dépliés à l'abscisse horizontale cumulée ; les rives basse et
 * haute ainsi obtenues doivent coïncider avec celles du contour développé.
 */
import type { Part } from "../model/derived.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";

/** Altitudes min et max du contour sur la verticale d'abscisse x (null hors du contour). */
function verticalSpan(outline: Polygon2, x: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const xmin = Math.min(a.x, b.x);
    const xmax = Math.max(a.x, b.x);
    if (x < xmin - 1e-9 || x > xmax + 1e-9) continue;
    const ys =
      Math.abs(b.x - a.x) < 1e-9 ? [a.y, b.y] : [a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)];
    for (const y of ys) {
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

/** Interpolation linéaire d'une polyligne (x croissants). */
function interp(pts: readonly Vec2[], x: number): number {
  if (x <= pts[0]!.x) return pts[0]!.y;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (x <= b.x) return b.x - a.x < 1e-12 ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return pts[pts.length - 1]!.y;
}

/**
 * Écart vertical maximal (mm) entre les rives du solide réglé et celles du développé, mesuré aux
 * sommets du contour développé et aux génératrices du solide. L'abscisse dépliée est remise à
 * l'échelle de la largeur du développé (erreur de corde des arcs) ; le sens du développé (miroir
 * ou non) est celui qui concorde le mieux.
 */
export function ruledFlatGap(part: Part): number {
  const solid = part.solid;
  if (solid.kind !== "ruled" || !part.flat) throw new Error("pièce roulée attendue");
  const half = solid.thickness / 2;
  const neutral = solid.a.map((p, i) => ({
    x: p.x + solid.normals[i]!.x * half,
    y: p.y + solid.normals[i]!.y * half,
  }));
  const d: number[] = [0];
  for (let i = 1; i < neutral.length; i++) {
    d.push(
      d[i - 1]! + Math.hypot(neutral[i]!.x - neutral[i - 1]!.x, neutral[i]!.y - neutral[i - 1]!.y),
    );
  }
  const outline = part.flat.outline.outer;
  const xs = outline.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const scale = (maxX - minX) / d[d.length - 1]!;
  const lower = d.map((u, i) => ({ x: u * scale, y: solid.a[i]!.z }));
  const upper = d.map((u, i) => ({ x: u * scale, y: solid.b[i]!.z }));
  const gapFor = (mirrored: boolean): number => {
    const toFlat = (u: number): number => (mirrored ? maxX - u : minX + u);
    const samples = [...lower.map((p) => p.x), ...xs.map((x) => (mirrored ? maxX - x : x - minX))];
    let gap = 0;
    for (const u of samples) {
      const span = verticalSpan(outline, toFlat(u));
      if (!span) continue;
      gap = Math.max(
        gap,
        Math.abs(interp(lower, u) - span.lo),
        Math.abs(interp(upper, u) - span.hi),
      );
    }
    return gap;
  };
  return Math.min(gapFor(false), gapFor(true));
}
