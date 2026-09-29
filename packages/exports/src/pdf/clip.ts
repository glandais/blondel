/**
 * Découpage géométrique des tracés de page par un rectangle (tuilage des gabarits 1:1).
 *
 * Les courbes de Bézier sont d'abord aplaties en segments (tolérance fixe, bien en deçà du
 * dixième de millimètre à l'échelle 1:1). Remplissage : chaque anneau est découpé par
 * Sutherland-Hodgman (le rectangle est convexe : le nombre d'enroulement de tout point intérieur
 * au rectangle est conservé, donc les règles « nonzero » et « evenodd » aussi) ; trait : chaque
 * segment est découpé par Liang-Barsky, pour ne pas tracer les bords artificiels du découpage.
 */
import type { PaintStyle, PathOp } from "./canvas.js";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface P {
  readonly x: number;
  readonly y: number;
}

/** Tolérance d'aplatissement des Bézier (mm). */
const FLATNESS = 0.02;

function flattenCubic(p0: P, p1: P, p2: P, p3: P, out: P[]): void {
  // Nombre de segments d'après la déviation maximale des points de contrôle.
  const d = Math.max(
    Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
    Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
  );
  const n = Math.min(256, Math.max(1, Math.ceil(Math.sqrt((0.75 * d) / FLATNESS))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

/** Sous-chemins aplatis : points et fermeture. */
export function flattenPath(ops: readonly PathOp[]): { pts: P[]; closed: boolean }[] {
  const subs: { pts: P[]; closed: boolean }[] = [];
  let cur: { pts: P[]; closed: boolean } | undefined;
  for (const o of ops) {
    if (o.op === "M") {
      cur = { pts: [{ x: o.x, y: o.y }], closed: false };
      subs.push(cur);
    } else if (o.op === "L") {
      if (!cur) continue;
      cur.pts.push({ x: o.x, y: o.y });
    } else if (o.op === "C") {
      if (!cur) continue;
      const p0 = cur.pts[cur.pts.length - 1]!;
      flattenCubic(p0, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }, { x: o.x, y: o.y }, cur.pts);
    } else if (cur) {
      cur.closed = true;
      const start = cur.pts[0]!;
      cur = { pts: [start], closed: false };
      subs.push(cur);
    }
  }
  return subs.filter((s) => s.pts.length >= 2 || s.closed);
}

/** Boîte englobante d'une liste d'opérations (points de contrôle compris). */
export function opsBounds(ops: readonly PathOp[]): Rect | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number): void => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const o of ops) {
    if (o.op === "Z") continue;
    add(o.x, o.y);
    if (o.op === "C") {
      add(o.x1, o.y1);
      add(o.x2, o.y2);
    }
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Sutherland-Hodgman : anneau découpé par le rectangle (vide si hors du rectangle). */
export function clipRing(ring: readonly P[], r: Rect): P[] {
  const edges: [(p: P) => boolean, (a: P, b: P) => P][] = [
    [(p) => p.x >= r.x, (a, b) => at(a, b, (r.x - a.x) / (b.x - a.x))],
    [(p) => p.x <= r.x + r.w, (a, b) => at(a, b, (r.x + r.w - a.x) / (b.x - a.x))],
    [(p) => p.y >= r.y, (a, b) => at(a, b, (r.y - a.y) / (b.y - a.y))],
    [(p) => p.y <= r.y + r.h, (a, b) => at(a, b, (r.y + r.h - a.y) / (b.y - a.y))],
  ];
  let out: P[] = [...ring];
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
    if (out.length === 0) return [];
  }
  return out;
}

function at(a: P, b: P, t: number): P {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Liang-Barsky : segment découpé par le rectangle (undefined si hors du rectangle). */
export function clipSegment(a: P, b: P, r: Rect): [P, P] | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const test = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (
    !test(-dx, a.x - r.x) ||
    !test(dx, r.x + r.w - a.x) ||
    !test(-dy, a.y - r.y) ||
    !test(dy, r.y + r.h - a.y)
  ) {
    return undefined;
  }
  return [at(a, b, t0), at(a, b, t1)];
}

const ringArea = (pts: readonly P[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};

/** Tracé découpé : opérations prêtes à peindre (vide si rien n'est visible). */
export interface ClippedPath {
  readonly ops: PathOp[];
  readonly style: PaintStyle;
}

/**
 * Découpe un tracé (remplissage et trait séparés) par `r`. Les traits en pointillés gardent
 * leur motif (la phase recommence à chaque segment découpé : écart d'aspect seulement).
 */
export function clipPath(ops: readonly PathOp[], style: PaintStyle, r: Rect): ClippedPath[] {
  const b = opsBounds(ops);
  if (b === undefined || !rectsIntersect(b, r)) return [];
  const subs = flattenPath(ops);
  const out: ClippedPath[] = [];
  if (style.fill !== undefined) {
    const fillOps: PathOp[] = [];
    for (const s of subs) {
      const ring = clipRing(s.pts, r);
      if (ring.length < 3 || ringArea(ring) < 1e-9) continue;
      fillOps.push({ op: "M", ...ring[0]! });
      for (const p of ring.slice(1)) fillOps.push({ op: "L", ...p });
      fillOps.push({ op: "Z" });
    }
    if (fillOps.length > 0) {
      const { stroke: _s, strokeOpacity: _so, lineWidth: _lw, dash: _d, ...fillStyle } = style;
      out.push({ ops: fillOps, style: fillStyle });
    }
  }
  if (style.stroke !== undefined) {
    const strokeOps: PathOp[] = [];
    let last: P | undefined;
    for (const s of subs) {
      const pts = s.closed ? [...s.pts, s.pts[0]!] : s.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const seg = clipSegment(pts[i]!, pts[i + 1]!, r);
        if (!seg) {
          last = undefined;
          continue;
        }
        const [a, c] = seg;
        if (last === undefined || Math.hypot(last.x - a.x, last.y - a.y) > 1e-9) {
          strokeOps.push({ op: "M", x: a.x, y: a.y });
        }
        strokeOps.push({ op: "L", x: c.x, y: c.y });
        last = c;
      }
      last = undefined;
    }
    if (strokeOps.length > 0) {
      const { fill: _f, fillOpacity: _fo, fillRule: _fr, ...strokeStyle } = style;
      out.push({ ops: strokeOps, style: strokeStyle });
    }
  }
  return out;
}

/** Translate des opérations de chemin. */
export function translateOps(ops: readonly PathOp[], dx: number, dy: number): PathOp[] {
  return ops.map((o) =>
    o.op === "Z"
      ? o
      : o.op === "C"
        ? {
            op: "C",
            x1: o.x1 + dx,
            y1: o.y1 + dy,
            x2: o.x2 + dx,
            y2: o.y2 + dy,
            x: o.x + dx,
            y: o.y + dy,
          }
        : { op: o.op, x: o.x + dx, y: o.y + dy },
  );
}
