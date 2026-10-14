/**
 * `minAreaRect` indépendant du bruit d'arrondi (chantier `stable-tiebreaks`, S2, point 1) :
 * longueur, largeur, axe (sans retournement d'un demi-tour) et premier coin inchangés par un
 * bruit ≤ 1e-9 mm sur chaque coordonnée et par une rotation de l'ordre des sommets ; résultat
 * inchangé au bit près hors cas d'égalité (coins dans l'ordre canonique, depuis le plus petit
 * (u, v) du repère de l'axe).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import type { Vec2 } from "../model/primitives.js";
import { convexHull, minAreaRect, type OrientedBox } from "./geom.js";

// ------------------------------------------------------------------ copie figée d'avant S2

function legacyHull(points: readonly Vec2[]): Vec2[] {
  const p = [...points].sort((u, v) => u.x - v.x || u.y - v.y);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => V.cross(V.sub(a, o), V.sub(b, o));
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0)
      upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

interface LegacyCandidate {
  du: number;
  dv: number;
  area: number;
}

/** Copie figée de `minAreaRect` d'avant S2, et ses candidats (un par arête de l'enveloppe). */
function legacyMinAreaRect(points: readonly Vec2[]): {
  box: OrientedBox;
  candidates: LegacyCandidate[];
} {
  const hull = legacyHull(points);
  const candidates: LegacyCandidate[] = [];
  if (hull.length === 0)
    return { box: { length: 0, width: 0, axis: V.vec(1, 0), corners: [] }, candidates };
  let best: OrientedBox | null = null;
  let bestArea = Infinity;
  const edges = hull.length >= 2 ? hull.length : 1;
  for (let i = 0; i < edges; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const d = V.sub(b, a);
    const axis = V.norm(d) > 0 ? V.normalize(d) : V.vec(1, 0);
    const perp = V.perpLeft(axis);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of hull) {
      const u = V.dot(p, axis);
      const v = V.dot(p, perp);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const du = u1 - u0;
    const dv = v1 - v0;
    const area = du * dv;
    candidates.push({ du, dv, area });
    if (
      area < bestArea - 1e-6 ||
      (Math.abs(area - bestArea) <= 1e-6 && best && Math.min(du, dv) < best.width)
    ) {
      bestArea = area;
      const at = (u: number, v: number): Vec2 => V.add(V.scale(axis, u), V.scale(perp, v));
      const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
      best =
        du >= dv
          ? { length: du, width: dv, axis, corners }
          : { length: dv, width: du, axis: perp, corners };
    }
  }
  return { box: best!, candidates };
}

/**
 * Le tirage contient-il un quasi ex æquo que les deux versions tranchent différemment par
 * construction (écart non nul mais sous la tolérance de S2) ?
 */
function hasNearTie(c: readonly LegacyCandidate[]): boolean {
  const near = (a: number, b: number, tol: number): boolean => a !== b && Math.abs(a - b) <= tol;
  const minArea = Math.min(...c.map((x) => x.area));
  const ref = c.find((x) => x.area === minArea)!;
  const areaTol = 1e-6 * (Math.max(ref.du, ref.dv) + Math.min(ref.du, ref.dv));
  for (const x of c) {
    if (near(x.du, x.dv, 1e-6)) return true;
    if (x.area !== minArea && x.area - minArea <= areaTol) return true;
  }
  const widths = c.filter((x) => x.area === minArea).map((x) => Math.min(x.du, x.dv));
  return widths.some((w) => widths.some((u) => near(w, u, 1e-6)));
}

// ------------------------------------------------------------------ générateurs

const NOISE = 1e-9;

const noisy = (pts: readonly Vec2[], seeds: readonly number[]): Vec2[] =>
  pts.map((p, i) =>
    V.vec(
      p.x + NOISE * (seeds[(2 * i) % seeds.length]! * 2 - 1),
      p.y + NOISE * (seeds[(2 * i + 1) % seeds.length]! * 2 - 1),
    ),
  );

const rotated = <T>(ring: readonly T[], k: number): T[] => {
  const s = ((k % ring.length) + ring.length) % ring.length;
  return [...ring.slice(s), ...ring.slice(0, s)];
};

/**
 * Contours à ex æquo : rectangles (carrés compris) à cotes entières, n-gones réguliers
 * (n = 4, 6, 8), tournés d'un angle quelconque et translatés, avec des points posés sur les
 * arêtes ; contour CCW, et longueur du plus petit côté (`side`).
 */
const tiedShape = fc
  .record({
    kind: fc.constantFrom("rect", "square", "ngon4", "ngon6", "ngon8"),
    // Plus petit côté ≥ 10 mm : un bruit de 1e-9 mm incline un côté de longueur c de
    // 2√2 · 1e-9 / c radians et déplace le bout opposé du rectangle de L fois plus ; sous
    // 10 mm pour L = 3 m, ce déplacement atteindrait `GEOM_EPS` (limite documentée de
    // `minAreaRect`), au-delà de ce que le bruit d'arrondi réel produit (≈ 1e-13 relatif).
    w: fc.integer({ min: 10, max: 3000 }),
    h: fc.integer({ min: 10, max: 3000 }),
    angle: fc.oneof(
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
      fc.constantFrom(0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4),
    ),
    tx: fc.integer({ min: -5000, max: 5000 }),
    ty: fc.integer({ min: -5000, max: 5000 }),
    onEdges: fc.array(fc.double({ min: 0.05, max: 0.95, noNaN: true }), { maxLength: 4 }),
    // Sommets quasi confondus avec un coin (décalage de 1e-8 à 6e-7 mm sur chaque coordonnée,
    // donc à moins de `GEOM_EPS` du coin, mais à bien plus que le bruit) : le survivant de
    // l'élagage ne doit pas dépendre du bruit (constat de relecture S2).
    nearCorners: fc.array(
      fc.record({
        corner: fc.nat(),
        dx: fc.double({ min: 1e-8, max: 6e-7, noNaN: true }),
        dy: fc.double({ min: 1e-8, max: 6e-7, noNaN: true }),
        sx: fc.boolean(),
        sy: fc.boolean(),
      }),
      { maxLength: 3 },
    ),
  })
  .map(({ kind, w, h, angle, tx, ty, onEdges, nearCorners }) => {
    let base: Vec2[];
    let side: number;
    if (kind === "rect" || kind === "square") {
      const hh = kind === "square" ? w : h;
      base = [V.vec(0, 0), V.vec(w, 0), V.vec(w, hh), V.vec(0, hh)];
      side = Math.min(w, hh);
    } else {
      const n = Number(kind.slice(4));
      side = 2 * w * Math.sin(Math.PI / n);
      base = Array.from({ length: n }, (_, k) => V.fromAngle((2 * Math.PI * k) / n)).map((p) =>
        V.scale(p, w),
      );
    }
    const ring: Vec2[] = [];
    base.forEach((p, i) => {
      ring.push(p);
      const t = onEdges[i];
      if (t !== undefined) ring.push(V.lerp(p, base[(i + 1) % base.length]!, t));
    });
    for (const { corner, dx, dy, sx, sy } of nearCorners) {
      const c = base[corner % base.length]!;
      ring.push(V.vec(c.x + (sx ? dx : -dx), c.y + (sy ? dy : -dy)));
    }
    return { ring: ring.map((p) => V.add(V.rotate(p, angle), V.vec(tx, ty))), side };
  });

const intPoint = fc
  .record({ x: fc.integer({ min: -3000, max: 3000 }), y: fc.integer({ min: -3000, max: 3000 }) })
  .map(({ x, y }) => V.vec(x, y));

/** Coin de plus petit (u, v) dans le repère (axe, axe tourné d'un quart de tour à gauche). */
function canonicalCorner(box: OrientedBox): Vec2 {
  const perp = V.perpLeft(box.axis);
  const key = (c: Vec2): [number, number] => [V.dot(c, box.axis), V.dot(c, perp)];
  return [...box.corners].sort((a, b) => {
    const [ua, va] = key(a);
    const [ub, vb] = key(b);
    return Math.abs(ua - ub) > 1e-6 ? ua - ub : va - vb;
  })[0]!;
}

// ------------------------------------------------------------------ propriétés

describe("minAreaRect : départages indépendants du bruit", () => {
  it("hors égalité : identique au bit près à la version d'avant S2 (points entiers)", () => {
    fc.assert(
      fc.property(fc.array(intPoint, { minLength: 1, maxLength: 24 }), (pts) => {
        const legacy = legacyMinAreaRect(pts);
        fc.pre(!hasNearTie(legacy.candidates));
        const got = minAreaRect(pts);
        expect(got.length).toBe(legacy.box.length);
        expect(got.width).toBe(legacy.box.width);
        expect(got.axis).toEqual(legacy.box.axis);
        // Mêmes coins, dans le même ordre cyclique : seul le premier coin peut changer (ordre
        // canonique depuis le plus petit (u, v) du repère de l'axe).
        const n = legacy.box.corners.length;
        const shift = legacy.box.corners.findIndex(
          (c) => c === got.corners[0] || V.distance(c, got.corners[0]!) === 0,
        );
        expect(shift).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < n; i++)
          expect(got.corners[i]).toEqual(legacy.box.corners[(i + shift) % n]);
        expect(got.corners[0]).toEqual(canonicalCorner(got));
      }),
      { numRuns: 1000 },
    );
  });

  it("bruit ≤ 1e-9 et rotation de l'ordre des sommets : mêmes cotes, même axe, même coin", () => {
    fc.assert(
      fc.property(
        tiedShape,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 8, maxLength: 40 }),
        fc.nat(),
        ({ ring, side }, seeds, k) => {
          const ref = minAreaRect(ring);
          const got = minAreaRect(rotated(noisy(ring, seeds), k));
          // Le bruit incline une arête d'au plus 2√2 · 1e-9 / côté (radians) : cotes et coins du
          // rectangle bougent d'au plus cet angle fois (L + l), plus le bruit lui-même.
          const tol = 1e-6 + (3 * NOISE * (ref.length + ref.width)) / side;
          expect(Math.abs(got.length - ref.length)).toBeLessThanOrEqual(tol);
          expect(Math.abs(got.width - ref.width)).toBeLessThanOrEqual(tol);
          // Pas de demi-tour : axes confondus (et non opposés).
          expect(V.dot(got.axis, ref.axis)).toBeGreaterThanOrEqual(1 - 1e-9);
          // Même coin de départ (ordre canonique des coins).
          expect(V.distance(got.corners[0]!, ref.corners[0]!)).toBeLessThanOrEqual(tol);
          expect(got.corners[0]).toEqual(canonicalCorner(got));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("rectangle à bord gauche quasi vertical : l'ancien choix se retournait, le nouveau non", () => {
    // Rectangle 1000 × 200 tourné d'un quart de tour : bord gauche vertical, abscisses égales
    // au bruit près (l'ancienne version partait du sommet d'abscisse la plus petite).
    const base = [V.vec(0, 0), V.vec(200, 0), V.vec(200, 1000), V.vec(0, 1000)];
    const a = [V.vec(1e-12, 0), ...base.slice(1)];
    const b = [base[0]!, base[1]!, base[2]!, V.vec(1e-12, 1000)];
    expect(V.dot(legacyMinAreaRect(a).box.axis, legacyMinAreaRect(b).box.axis)).toBeLessThan(0);
    expect(minAreaRect(a).axis.y).toBeCloseTo(minAreaRect(b).axis.y, 12);
    expect(V.dot(minAreaRect(a).axis, minAreaRect(b).axis)).toBeGreaterThan(1 - 1e-12);
    expect(minAreaRect(a).length).toBeCloseTo(1000, 9);
    expect(minAreaRect(a).width).toBeCloseTo(200, 9);
  });

  it("sommet quasi confondu avec le coin de départ : pas de demi-tour par le bruit", () => {
    // Contre-exemple de relecture : (0, 0) et (0, 5e-7) quasi confondus au départ de la chaîne
    // monotone ; un bruit de 1e-12 sur une abscisse changeait le survivant de l'élagage, donc
    // l'inclinaison de l'arête vers (500, 0), et retournait le rectangle d'un demi-tour.
    const base = [V.vec(0, 0), V.vec(500, 0), V.vec(2000, 300), V.vec(0.001, 300), V.vec(0, 5e-7)];
    const shifted = base.map((p, i) => (i === 4 ? V.vec(p.x - 1e-12, p.y) : p));
    const a = minAreaRect(base);
    const b = minAreaRect(shifted);
    expect(V.dot(a.axis, b.axis)).toBeGreaterThan(1 - 1e-12);
    expect(convexHull(base).length).toBe(convexHull(shifted).length);
    expect(V.distance(convexHull(base)[0]!, convexHull(shifted)[0]!)).toBeLessThanOrEqual(1e-11);
  });

  it("coins : départ au plus petit (u, v) du repère de l'axe, CCW", () => {
    // Rectangle 200 × 1000 : la petite arête fournit l'axe par sa perpendiculaire.
    const box = minAreaRect([V.vec(0, 0), V.vec(200, 0), V.vec(200, 1000), V.vec(0, 1000)]);
    expect(box.corners[0]).toEqual(canonicalCorner(box));
    for (let i = 0; i < 4; i++) {
      const a = box.corners[i]!;
      const b = box.corners[(i + 1) % 4]!;
      const c = box.corners[(i + 2) % 4]!;
      expect(V.cross(V.sub(b, a), V.sub(c, b))).toBeGreaterThan(0);
    }
  });

  it("carré : axe de l'arête même quand la cote perpendiculaire la dépasse au bruit près", () => {
    const sq = [V.vec(0, 0), V.vec(100, 0), V.vec(100, 100 + 1e-10), V.vec(0, 100 + 1e-10)];
    expect(minAreaRect(sq).axis).toEqual(V.vec(1, 0));
    expect(minAreaRect(sq).length).toBeGreaterThanOrEqual(minAreaRect(sq).width);
  });
});
