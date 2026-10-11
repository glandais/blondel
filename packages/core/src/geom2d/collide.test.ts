import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import type { Wall } from "../model/project.js";
import {
  convexHull,
  convexOverlap,
  convexSimpleOverlap,
  discOverlap,
  triangulateSimple,
  wallCollision,
  wallPolygon,
} from "./collide.js";
import { isConvex, pointInPolygon, signedArea } from "./polygon.js";
import * as V from "./vec.js";

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon2 => [
  V.vec(x0, y0),
  V.vec(x1, y0),
  V.vec(x1, y1),
  V.vec(x0, y1),
];

const wall = (a: Vec2, b: Vec2, thickness: number, id = "m1"): Wall => ({
  id,
  a,
  b,
  thickness,
  loadBearing: false,
});

const close = (p: Vec2, q: Vec2): void => {
  expect(p.x).toBeCloseTo(q.x, 9);
  expect(p.y).toBeCloseTo(q.y, 9);
};

describe("convexOverlap", () => {
  it("chevauchement franc", () => {
    expect(convexOverlap(rect(0, 0, 100, 100), rect(50, 50, 150, 150), 0)).toBe(true);
    expect(convexOverlap(rect(0, 0, 100, 100), rect(20, 20, 80, 80), 0)).toBe(true);
  });

  it("contact sur une face ou un coin : pas de collision", () => {
    expect(convexOverlap(rect(0, 0, 100, 100), rect(100, 0, 200, 100), 0)).toBe(false);
    expect(convexOverlap(rect(0, 0, 100, 100), rect(100, 30, 200, 60), 0)).toBe(false);
    expect(convexOverlap(rect(0, 0, 100, 100), rect(100, 100, 200, 200), 0)).toBe(false);
  });

  it("séparation", () => {
    expect(convexOverlap(rect(0, 0, 100, 100), rect(101, 0, 200, 100), 0)).toBe(false);
    // Triangles séparés seulement par un axe oblique (les boîtes englobantes se recouvrent).
    const t1: Polygon2 = [V.vec(0, 0), V.vec(100, 0), V.vec(0, 100)];
    const t2: Polygon2 = [V.vec(100, 100), V.vec(60, 100), V.vec(100, 60)];
    expect(convexOverlap(t1, t2, 0)).toBe(false);
  });

  it("tolérance : un recouvrement ≤ tol n'est pas une collision", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(99.5, 0, 200, 100);
    expect(convexOverlap(a, b, 1)).toBe(false);
    expect(convexOverlap(a, b, 0.5)).toBe(false);
    expect(convexOverlap(a, b, 0.1)).toBe(true);
  });

  it("arête dégénérée (sommet répété) ignorée", () => {
    const a: Polygon2 = [V.vec(0, 0), V.vec(100, 0), V.vec(100, 0), V.vec(100, 100), V.vec(0, 100)];
    expect(convexOverlap(a, rect(50, 50, 150, 150), 0)).toBe(true);
    expect(convexOverlap(a, rect(100, 0, 200, 100), 0)).toBe(false);
  });
});

describe("discOverlap", () => {
  const sq = rect(0, 0, 100, 100);

  it("centre intérieur : collision, même pour un rayon nul", () => {
    expect(discOverlap(V.vec(50, 50), 0, sq, 0)).toBe(true);
  });

  it("disque extérieur qui mord le polygone", () => {
    expect(discOverlap(V.vec(120, 50), 30, sq, 0)).toBe(true);
    // Près d'un coin : distance au coin √2·20 ≈ 28,3 < 30.
    expect(discOverlap(V.vec(120, 120), 30, sq, 0)).toBe(true);
  });

  it("disque tangent à une face ou éloigné : pas de collision", () => {
    expect(discOverlap(V.vec(130, 50), 30, sq, 0)).toBe(false);
    expect(discOverlap(V.vec(300, 300), 30, sq, 0)).toBe(false);
    expect(discOverlap(V.vec(121, 121), 29, sq, 0)).toBe(false);
  });

  it("tolérance", () => {
    // Pénétration de 1 mm.
    expect(discOverlap(V.vec(129, 50), 30, sq, 0.5)).toBe(true);
    expect(discOverlap(V.vec(129, 50), 30, sq, 1)).toBe(false);
    expect(discOverlap(V.vec(129, 50), 30, sq, 2)).toBe(false);
  });

  it("centre exactement sur une arête : collision si rayon > tol, sinon non", () => {
    // `pointInPolygon` rend « boundary » : la décision passe par la boucle des distances.
    expect(discOverlap(V.vec(100, 50), 1, sq, 0.5)).toBe(true);
    expect(discOverlap(V.vec(50, 0), 30, sq, 0)).toBe(true);
    expect(discOverlap(V.vec(100, 50), 0.5, sq, 0.5)).toBe(false);
    expect(discOverlap(V.vec(100, 50), 0, sq, 0)).toBe(false);
  });

  it("polygone tourné de 30° : décision par la face oblique", () => {
    const theta = Math.PI / 6;
    const rot = sq.map((q) => V.rotate(q, theta));
    // Normale sortante de la face issue de [(100,0),(100,100)] après rotation.
    const n = V.rotate(V.vec(1, 0), theta);
    const foot = V.rotate(V.vec(100, 50), theta);
    expect(discOverlap(V.addScaled(foot, n, 29), 30, rot, 0.5)).toBe(true);
    expect(discOverlap(V.addScaled(foot, n, 29.6), 30, rot, 0.5)).toBe(false);
    expect(discOverlap(V.addScaled(foot, n, 31), 30, rot, 0)).toBe(false);
    // Sens horaire : même décision.
    const cw = [...rot].reverse();
    expect(discOverlap(V.addScaled(foot, n, 29), 30, cw, 0.5)).toBe(true);
    expect(discOverlap(V.addScaled(foot, n, 31), 30, cw, 0)).toBe(false);
  });
});

describe("contact au nu et recouvrement (cas repris des tests de l'assistant)", () => {
  it("contact au nu : pas de collision ; recouvrement : collision", () => {
    const a = [V.vec(0, 0), V.vec(10, 0), V.vec(10, 10), V.vec(0, 10)];
    const b = [V.vec(10, 0), V.vec(20, 0), V.vec(20, 10), V.vec(10, 10)];
    const c = [V.vec(9, 0), V.vec(20, 0), V.vec(20, 10), V.vec(9, 10)];
    expect(convexOverlap(a, b, 0.5)).toBe(false);
    expect(convexOverlap(a, c, 0.5)).toBe(true);
    expect(discOverlap(V.vec(15, 5), 5, a, 0.5)).toBe(false);
    expect(discOverlap(V.vec(14, 5), 5, a, 0.5)).toBe(true);
  });
});

describe("wallPolygon et wallCollision", () => {
  it("mur axé sur x : rectangle de part et d'autre de l'axe", () => {
    const p = wallPolygon(wall(V.vec(0, 0), V.vec(1000, 0), 200));
    expect(p).toHaveLength(4);
    close(p[0]!, V.vec(0, 100));
    close(p[1]!, V.vec(1000, 100));
    close(p[2]!, V.vec(1000, -100));
    close(p[3]!, V.vec(0, -100));
  });

  it("mur de longueur nulle : rectangle dégénéré suivant x", () => {
    const p = wallPolygon(wall(V.vec(5, 5), V.vec(5, 5), 200));
    close(p[0]!, V.vec(105, 5));
    close(p[3]!, V.vec(-95, 5));
  });

  it("mur en biais à 45° : collision, contact au nu, séparation", () => {
    const w = wall(V.vec(0, 0), V.vec(1000, 1000), 200 * Math.SQRT2);
    const p = wallPolygon(w);
    // Faces parallèles à l'axe, à 100 √2 de part et d'autre : x − y = ±200.
    for (const q of p) expect(Math.abs(Math.abs(q.x - q.y) - 200)).toBeLessThan(1e-9);
    // Carré centré sur l'axe : collision.
    expect(wallCollision([rect(400, 400, 600, 600)], [w], 0)).toBe(w);
    // Triangle posé au nu de la face x − y = 200 : contact sans collision.
    const touching: Polygon2 = [V.vec(700, 500), V.vec(900, 500), V.vec(900, 700)];
    expect(convexOverlap(touching, p, 1e-6)).toBe(false);
    expect(wallCollision([touching], [w], 1e-6)).toBeNull();
    // Loin du mur.
    expect(wallCollision([rect(800, 0, 1000, 200)], [w], 0)).toBeNull();
  });

  it("rend le premier mur heurté, dans l'ordre des murs", () => {
    const w1 = wall(V.vec(0, 0), V.vec(0, 1000), 100, "a");
    const w2 = wall(V.vec(200, 0), V.vec(200, 1000), 100, "b");
    const pieces = [rect(1000, 0, 1100, 100), rect(-100, 100, 300, 200)];
    expect(wallCollision(pieces, [w2, w1], 0)?.id).toBe("b");
    expect(wallCollision(pieces, [w1, w2], 0)?.id).toBe("a");
    expect(wallCollision(pieces, [], 0)).toBeNull();
  });
});

/** Polygone convexe CCW : sommets sur un cercle, angles triés distincts. */
const convexPolygon = (): fc.Arbitrary<Polygon2> =>
  fc
    .record({
      cx: fc.double({ min: -3000, max: 3000, noNaN: true }),
      cy: fc.double({ min: -3000, max: 3000, noNaN: true }),
      r: fc.double({ min: 50, max: 2000, noNaN: true }),
      angles: fc.uniqueArray(fc.integer({ min: 0, max: 359 }), { minLength: 3, maxLength: 8 }),
    })
    .map(({ cx, cy, r, angles }) =>
      [...angles]
        .sort((a, b) => a - b)
        .map((d) =>
          V.vec(cx + r * Math.cos((d * Math.PI) / 180), cy + r * Math.sin((d * Math.PI) / 180)),
        ),
    )
    .filter((p) => Math.abs(polygonArea(p)) > 1);

function polygonArea(p: Polygon2): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += V.cross(p[i]!, p[(i + 1) % p.length]!);
  return s / 2;
}

/**
 * Marge de décision de `convexOverlap` (oracle indépendant) : minimum, sur les normales d'arêtes,
 * du recouvrement des projections moins `tol`. Proche de 0 : décision sensible à l'arrondi.
 */
function overlapMargin(a: Polygon2, b: Polygon2, tol: number): number {
  let m = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = V.sub(poly[(i + 1) % poly.length]!, poly[i]!);
      const l = Math.hypot(e.x, e.y);
      if (!(l > 0)) continue;
      const axis = V.vec(-e.y / l, e.x / l);
      const pa = a.map((p) => p.x * axis.x + p.y * axis.y);
      const pb = b.map((p) => p.x * axis.x + p.y * axis.y);
      const ov =
        Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
      m = Math.min(m, ov - tol);
    }
  }
  return m;
}

const tolArb = fc.double({ min: 0, max: 5, noNaN: true });

/** Inverse l'ordre des sommets (polygone parcouru dans l'autre sens). */
const orient = (p: Polygon2, flip: boolean): Polygon2 => (flip ? [...p].reverse() : p);

/** Polygone convexe dans un sens ou dans l'autre, tiré au hasard. */
const anyConvexPolygon = (): fc.Arbitrary<Polygon2> =>
  fc.tuple(convexPolygon(), fc.boolean()).map(([p, flip]) => orient(p, flip));

/**
 * Intersection de deux polygones convexes par découpage de Sutherland-Hodgman (oracle
 * indépendant du théorème de l'axe séparateur). Le polygone de découpe est remis dans le sens
 * trigonométrique.
 */
function convexIntersection(subject: Polygon2, clip: Polygon2): Polygon2 {
  const c = polygonArea(clip) < 0 ? [...clip].reverse() : clip;
  let out: Vec2[] = [...subject];
  for (let i = 0; i < c.length && out.length > 0; i++) {
    const p = c[i]!;
    const q = c[(i + 1) % c.length]!;
    const e = V.sub(q, p);
    if (!(Math.hypot(e.x, e.y) > 0)) continue;
    const side = (x: Vec2): number => V.cross(e, V.sub(x, p));
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const s0 = input[j]!;
      const s1 = input[(j + 1) % input.length]!;
      const d0 = side(s0);
      const d1 = side(s1);
      if (d0 >= 0) out.push(s0);
      if (d0 >= 0 !== d1 >= 0) out.push(V.lerp(s0, s1, d0 / (d0 - d1)));
    }
  }
  return out;
}

/**
 * Oracle du disque : distance du centre au bord du polygone convexe (quel que soit son sens) et
 * position strictement intérieure par demi-plans.
 */
function discOracle(center: Vec2, poly: Polygon2): { inside: boolean; dist: number } {
  const sgn = Math.sign(polygonArea(poly));
  let inside = true;
  let dist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ab = V.sub(b, a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    if (sgn * V.cross(ab, V.sub(center, a)) <= 0) inside = false;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, V.dot(V.sub(center, a), ab) / l2));
    dist = Math.min(dist, Math.hypot(center.x - (a.x + t * ab.x), center.y - (a.y + t * ab.y)));
  }
  return { inside, dist };
}

describe("propriétés de convexOverlap", () => {
  // Garde-fou de non-régression seulement : symétrique par construction (parcours de [a, b],
  // min / max), elle ne prouve rien de la justesse ; l'oracle de Sutherland-Hodgman s'en charge.
  it("symétrie", () => {
    fc.assert(
      fc.property(anyConvexPolygon(), anyConvexPolygon(), tolArb, (a, b, tol) => {
        expect(convexOverlap(a, b, tol)).toBe(convexOverlap(b, a, tol));
      }),
      { numRuns: 300 },
    );
  });

  it("invariance par translation et rotation communes", () => {
    fc.assert(
      fc.property(
        anyConvexPolygon(),
        anyConvexPolygon(),
        tolArb,
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (a, b, tol, theta, tx, ty) => {
          fc.pre(Math.abs(overlapMargin(a, b, tol)) > 1e-6);
          const move = (p: Polygon2): Polygon2 =>
            p.map((q) => V.add(V.rotate(q, theta), V.vec(tx, ty)));
          expect(convexOverlap(move(a), move(b), tol)).toBe(convexOverlap(a, b, tol));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("deux polygones séparés par une droite ne se chevauchent pas", () => {
    fc.assert(
      fc.property(
        anyConvexPolygon(),
        anyConvexPolygon(),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (a, b0, phi, gap) => {
          // Droite de normale d : a du côté ≤ s, b repoussé du côté ≥ s + gap.
          const d = V.vec(Math.cos(phi), Math.sin(phi));
          const s = Math.max(...a.map((p) => V.dot(p, d)));
          const shift = s + gap - Math.min(...b0.map((p) => V.dot(p, d)));
          const b = b0.map((p) => V.addScaled(p, d, shift));
          expect(convexOverlap(a, b, 1e-6)).toBe(false);
          expect(convexOverlap(b, a, 1e-6)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("un polygone d'aire non nulle recouvre sa copie", () => {
    fc.assert(
      fc.property(anyConvexPolygon(), (a) => {
        const b = a.map((p) => V.vec(p.x, p.y));
        expect(convexOverlap(a, b, 0)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("indépendance du sens de parcours des polygones", () => {
    fc.assert(
      fc.property(convexPolygon(), convexPolygon(), tolArb, (a, b, tol) => {
        const ref = convexOverlap(a, b, tol);
        const ra = orient(a, true);
        const rb = orient(b, true);
        expect(convexOverlap(ra, b, tol)).toBe(ref);
        expect(convexOverlap(a, rb, tol)).toBe(ref);
        expect(convexOverlap(ra, rb, tol)).toBe(ref);
      }),
      { numRuns: 300 },
    );
  });

  it("accord avec l'aire de l'intersection (Sutherland-Hodgman), hors marge proche de 0", () => {
    // b tiré près de a pour que les deux issues soient fréquentes.
    const pair = fc
      .tuple(
        anyConvexPolygon(),
        anyConvexPolygon(),
        fc.double({ min: -2500, max: 2500, noNaN: true }),
        fc.double({ min: -2500, max: 2500, noNaN: true }),
      )
      .map(([a, b0, dx, dy]) => {
        const shift = V.add(V.sub(a[0]!, b0[0]!), V.vec(dx, dy));
        return [a, b0.map((p) => V.add(p, shift))] as const;
      });
    let hit = 0;
    let miss = 0;
    fc.assert(
      fc.property(pair, ([a, b]) => {
        // Marge > 1e-3 : la largeur minimale de l'intersection dépasse 1e-3, son aire 5e-7.
        fc.pre(Math.abs(overlapMargin(a, b, 0)) > 1e-3);
        const area = Math.abs(polygonArea(convexIntersection(a, b)));
        const expected = area > 1e-7;
        if (expected) hit++;
        else miss++;
        expect(convexOverlap(a, b, 0)).toBe(expected);
      }),
      { numRuns: 500 },
    );
    expect(hit).toBeGreaterThan(0);
    expect(miss).toBeGreaterThan(0);
  });
});

describe("propriétés de discOverlap", () => {
  /** Polygone (des deux sens), disque tiré autour de son premier sommet, tolérance. */
  const discCase = fc
    .tuple(
      anyConvexPolygon(),
      fc.double({ min: -3000, max: 3000, noNaN: true }),
      fc.double({ min: -3000, max: 3000, noNaN: true }),
      fc.double({ min: 0, max: 1500, noNaN: true }),
      tolArb,
    )
    .map(([poly, dx, dy, radius, tol]) => ({
      poly,
      center: V.add(poly[0]!, V.vec(dx, dy)),
      radius,
      tol,
    }));

  /** Décision attendue et marge (hors marge proche de 0) par l'oracle indépendant. */
  const expectation = (
    center: Vec2,
    radius: number,
    poly: Polygon2,
    tol: number,
  ): { expected: boolean; margin: number } => {
    const { inside, dist } = discOracle(center, poly);
    if (inside) return { expected: true, margin: dist };
    return { expected: dist < radius - tol, margin: Math.min(dist, Math.abs(radius - tol - dist)) };
  };

  it("accord avec l'oracle : centre intérieur → collision ; distance > r − tol → aucune", () => {
    let inside = 0;
    let hit = 0;
    let miss = 0;
    fc.assert(
      fc.property(discCase, ({ poly, center, radius, tol }) => {
        const { expected, margin } = expectation(center, radius, poly, tol);
        fc.pre(margin > 1e-6);
        if (discOracle(center, poly).inside) inside++;
        else if (expected) hit++;
        else miss++;
        expect(discOverlap(center, radius, poly, tol)).toBe(expected);
      }),
      { numRuns: 500 },
    );
    expect(inside).toBeGreaterThan(0);
    expect(hit).toBeGreaterThan(0);
    expect(miss).toBeGreaterThan(0);
  });

  it("invariance par translation et rotation communes", () => {
    fc.assert(
      fc.property(
        discCase,
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        ({ poly, center, radius, tol }, theta, tx, ty) => {
          fc.pre(expectation(center, radius, poly, tol).margin > 1e-6);
          const move = (q: Vec2): Vec2 => V.add(V.rotate(q, theta), V.vec(tx, ty));
          expect(discOverlap(move(center), radius, poly.map(move), tol)).toBe(
            discOverlap(center, radius, poly, tol),
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("indépendance du sens de parcours du polygone", () => {
    fc.assert(
      fc.property(discCase, ({ poly, center, radius, tol }) => {
        // Hors marge de décision (centre à ~1e-13 du bord d'un polygone très plat : l'arrondi
        // dépend du sens de parcours ; contre-exemple du sous-lot 1b, graine -912011869).
        fc.pre(expectation(center, radius, poly, tol).margin > 1e-6);
        expect(discOverlap(center, radius, orient(poly, true), tol)).toBe(
          discOverlap(center, radius, poly, tol),
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe("enveloppe convexe, triangulation, recouvrement d'un polygone simple", () => {
  it("enveloppe convexe : CCW, convexe, contient tous les points", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -500, max: 500 }),
            y: fc.integer({ min: -500, max: 500 }),
          }),
          {
            minLength: 3,
            maxLength: 30,
          },
        ),
        (pts) => {
          const hull = convexHull(pts);
          if (hull.length === 0) return; // points alignés
          expect(signedArea(hull)).toBeGreaterThan(0);
          expect(isConvex(hull)).toBe(true);
          for (const p of pts) expect(pointInPolygon(p, hull, 1e-6)).not.toBe("outside");
        },
      ),
      { numRuns: 300 },
    );
    expect(convexHull([V.vec(0, 0), V.vec(1, 1), V.vec(2, 2)])).toEqual([]);
  });

  it("triangulation d'un polygone simple : aire conservée (L, U, sens horaire)", () => {
    const l: Polygon2 = [
      V.vec(0, 0),
      V.vec(300, 0),
      V.vec(300, 100),
      V.vec(100, 100),
      V.vec(100, 300),
      V.vec(0, 300),
    ];
    const u: Polygon2 = [
      V.vec(0, 0),
      V.vec(300, 0),
      V.vec(300, 300),
      V.vec(200, 300),
      V.vec(200, 100),
      V.vec(100, 100),
      V.vec(100, 300),
      V.vec(0, 300),
    ];
    for (const poly of [l, u, [...u].reverse()]) {
      const tris = triangulateSimple(poly);
      const area = tris.reduce((s, t) => s + signedArea(t), 0);
      expect(area).toBeCloseTo(Math.abs(signedArea(poly)), 6);
      for (const t of tris) expect(signedArea(t)).toBeGreaterThan(0);
    }
  });

  it("propriété : triangulation d'un polygone étoilé, aire conservée et triangles CCW", () => {
    // Polygone étoilé autour d'un centre (angles distincts triés, écart < 180°, rayons tirés),
    // donc simple, souvent non convexe ; parcouru dans un sens ou dans l'autre.
    const star = fc
      .record({
        cx: fc.double({ min: -3000, max: 3000, noNaN: true }),
        cy: fc.double({ min: -3000, max: 3000, noNaN: true }),
        angles: fc.uniqueArray(fc.integer({ min: 0, max: 359 }), { minLength: 3, maxLength: 14 }),
        radii: fc.array(fc.double({ min: 20, max: 2000, noNaN: true }), {
          minLength: 14,
          maxLength: 14,
        }),
        flip: fc.boolean(),
      })
      .filter(({ angles }) => {
        const a = [...angles].sort((x, y) => x - y);
        return a.every((v, i) => (i === 0 ? v + 360 - a[a.length - 1]! : v - a[i - 1]!) < 180);
      })
      .map(({ cx, cy, angles, radii, flip }) => {
        const poly = [...angles]
          .sort((x, y) => x - y)
          .map((deg, i) =>
            V.addScaled(V.vec(cx, cy), V.fromAngle((deg * Math.PI) / 180), radii[i]!),
          );
        return flip ? poly.reverse() : poly;
      });
    fc.assert(
      fc.property(star, (poly) => {
        const expected = Math.abs(signedArea(poly));
        const tris = triangulateSimple(poly);
        const area = tris.reduce((s, t) => s + signedArea(t), 0);
        expect(Math.abs(area - expected)).toBeLessThanOrEqual(1e-6 + 1e-9 * expected);
        for (const t of tris) expect(signedArea(t)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  it("recouvrement d'un polygone simple : le creux d'un U n'est pas recouvert", () => {
    const u: Polygon2 = [
      V.vec(0, 0),
      V.vec(300, 0),
      V.vec(300, 300),
      V.vec(200, 300),
      V.vec(200, 100),
      V.vec(100, 100),
      V.vec(100, 300),
      V.vec(0, 300),
    ];
    expect(convexSimpleOverlap(rect(120, 120, 180, 280), u, 0.5)).toBe(false);
    expect(convexSimpleOverlap(rect(120, 50, 180, 280), u, 0.5)).toBe(true);
    // Contact au nu (fond du creux) : pas un recouvrement.
    expect(convexSimpleOverlap(rect(120, 100, 180, 280), u, 0.5)).toBe(false);
  });
});
