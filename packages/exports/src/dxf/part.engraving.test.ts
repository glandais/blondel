/**
 * Repère gravé (`engravingPoint`) indépendant du bruit d'arrondi (chantier `stable-tiebreaks`,
 * S2, point 3) : même point (à 1e-6 mm près) et même dégagement malgré un bruit ≤ 1e-9 mm sur
 * chaque coordonnée et une rotation de l'ordre des sommets (contour et trous) ; résultat
 * inchangé au bit près hors ex æquo à la tolérance.
 */
import { bbox, pointInPolygon, type Shape2, type Vec2 } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { closedLoops, engravingPoint } from "./part.js";

// ------------------------------------------------------------------ copie figée d'avant S2

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function clearance(
  shape: Shape2,
  p: Vec2,
  avoid: readonly (readonly [Vec2, Vec2])[],
  loops: readonly (readonly Vec2[])[] = [],
): number {
  if (pointInPolygon(p, shape.outer) !== "inside") return -1;
  if (shape.holes.some((h) => h.length >= 3 && pointInPolygon(p, h) !== "outside")) return -1;
  if (loops.some((l) => pointInPolygon(p, l) !== "outside")) return -1;
  let d = Infinity;
  for (const ring of [shape.outer, ...shape.holes]) {
    for (let i = 0; i < ring.length; i++) {
      d = Math.min(d, distanceToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!));
    }
  }
  for (const [a, b] of avoid) d = Math.min(d, distanceToSegment(p, a, b));
  return d;
}

/**
 * `engravingPoint` d'avant S2 (premier point balayé de dégagement strictement meilleur), et
 * `nearTie` : à une passe, un point balayé avant le retenu est à moins de 1e-6 sous lui (cas
 * que S2 tranche autrement, par construction).
 */
function legacyEngravingPoint(
  shape: Shape2,
  avoid: readonly (readonly [Vec2, Vec2])[] = [],
): { at: Vec2; clearance: number; nearTie: boolean } {
  const box = bbox(shape.outer);
  const loops = closedLoops(avoid);
  let best = { at: { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }, d: -1 };
  best.d = clearance(shape, best.at, avoid, loops);
  let hx = (box.max.x - box.min.x) / 48;
  let hy = (box.max.y - box.min.y) / 48;
  let cx = best.at.x;
  let cy = best.at.y;
  let nearTie = false;
  for (let pass = 0; pass < 4; pass++) {
    const seen: number[] = [best.d];
    for (let i = -24; i <= 24; i++) {
      for (let j = -24; j <= 24; j++) {
        const p = { x: cx + i * hx, y: cy + j * hy };
        const d = clearance(shape, p, avoid, loops);
        seen.push(d);
        if (d > best.d) best = { at: p, d };
      }
    }
    const first = seen.indexOf(best.d);
    if (seen.slice(0, first).some((d) => d >= best.d - 1e-6)) nearTie = true;
    cx = best.at.x;
    cy = best.at.y;
    hx /= 12;
    hy /= 12;
  }
  return { at: best.at, clearance: Math.max(0, best.d), nearTie };
}

// ------------------------------------------------------------------ générateurs

const NOISE = 1e-9;
const v = (x: number, y: number): Vec2 => ({ x, y });

const rotateOrder = <T>(ring: readonly T[], k: number): T[] => {
  const s = ((k % ring.length) + ring.length) % ring.length;
  return [...ring.slice(s), ...ring.slice(0, s)];
};

function transformShape(shape: Shape2, f: (p: Vec2) => Vec2): Shape2 {
  return { outer: shape.outer.map(f), holes: shape.holes.map((h) => h.map(f)) };
}

/**
 * Formes à ex æquo (cotes entières) : rectangles et bandes, pièces en L, n-gones réguliers,
 * rectangles percés ; tournées d'un quart de tour (axes de symétrie sur la grille : ex æquo
 * exacts) ou d'un angle quelconque, puis translatées.
 */
const tiedShape = fc
  .record({
    kind: fc.constantFrom("rect", "band", "L", "ngon6", "ngon8", "holed"),
    w: fc.integer({ min: 40, max: 3000 }),
    h: fc.integer({ min: 20, max: 600 }),
    angle: fc.oneof(
      fc.constantFrom(0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2),
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    ),
    tx: fc.integer({ min: -3000, max: 3000 }),
    ty: fc.integer({ min: -3000, max: 3000 }),
  })
  .map(({ kind, w, h, angle, tx, ty }): Shape2 => {
    let shape: Shape2;
    switch (kind) {
      case "rect":
        shape = { outer: [v(0, 0), v(w, 0), v(w, h), v(0, h)], holes: [] };
        break;
      case "band":
        shape = { outer: [v(0, 0), v(w, 0), v(w, 0 + h / 4), v(0, h / 4)], holes: [] };
        break;
      case "L": {
        const t = Math.max(10, Math.round(h / 2));
        shape = {
          outer: [v(0, 0), v(w, 0), v(w, t), v(t, t), v(t, w), v(0, w)],
          holes: [],
        };
        break;
      }
      case "ngon6":
      case "ngon8": {
        const n = Number(kind.slice(4));
        shape = {
          outer: Array.from({ length: n }, (_, k) =>
            v(w * Math.cos((2 * Math.PI * k) / n), w * Math.sin((2 * Math.PI * k) / n)),
          ),
          holes: [],
        };
        break;
      }
      default: {
        const H = h + 60;
        shape = {
          outer: [v(0, 0), v(w, 0), v(w, H), v(0, H)],
          holes: [[v(w / 4, 20), v(w / 4, H - 20), v(w / 2, H - 20), v(w / 2, 20)]],
        };
      }
    }
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return transformShape(shape, (p) => v(c * p.x - s * p.y + tx, s * p.x + c * p.y + ty));
  });

const noiseSeeds = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
  minLength: 8,
  maxLength: 40,
});

function noisyRotated(shape: Shape2, seeds: readonly number[], k: number): Shape2 {
  let n = 0;
  const jitter = (p: Vec2): Vec2 => {
    const dx = seeds[n++ % seeds.length]! * NOISE;
    const dy = seeds[n++ % seeds.length]! * NOISE;
    return v(p.x + dx, p.y + dy);
  };
  const s = transformShape(shape, jitter);
  return { outer: rotateOrder(s.outer, k), holes: s.holes.map((h) => rotateOrder(h, k + 1)) };
}

/** Polygone simple générique (étoilé autour de l'origine), cotes entières. */
const genericShape = fc
  .array(fc.integer({ min: 100, max: 2000 }), { minLength: 3, maxLength: 9 })
  .map((radii): Shape2 => {
    const n = radii.length;
    return {
      outer: radii.map((r, k) =>
        v(
          Math.round(r * Math.cos((2 * Math.PI * k) / n)),
          Math.round(r * Math.sin((2 * Math.PI * k) / n)),
        ),
      ),
      holes: [],
    };
  });

// ------------------------------------------------------------------ propriétés

describe("engravingPoint : départage indépendant du bruit", () => {
  it("bruit ≤ 1e-9 et rotation de l'ordre des sommets : même point, même dégagement", () => {
    fc.assert(
      fc.property(tiedShape, noiseSeeds, fc.nat(), (shape, seeds, k) => {
        const ref = engravingPoint(shape);
        const got = engravingPoint(noisyRotated(shape, seeds, k));
        expect(Math.hypot(got.at.x - ref.at.x, got.at.y - ref.at.y)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(got.clearance - ref.clearance)).toBeLessThanOrEqual(1e-6);
      }),
      { numRuns: 150 },
    );
  });

  it("hors ex æquo à 1e-6 : identique au bit près à la version d'avant S2", () => {
    fc.assert(
      fc.property(genericShape, (shape) => {
        const legacy = legacyEngravingPoint(shape);
        fc.pre(!legacy.nearTie);
        expect(engravingPoint(shape)).toEqual({ at: legacy.at, clearance: legacy.clearance });
      }),
      { numRuns: 150 },
    );
  });

  it("bande verticale : l'ancien point dépendait du bruit, le nouveau non", () => {
    // Bande 2000 × 100 tournée d'un quart de tour (cos ≈ 6e-17) : sa ligne médiane est ex æquo.
    const c = Math.cos(Math.PI / 2);
    const s = Math.sin(Math.PI / 2);
    const band: Shape2 = {
      outer: [v(0, 0), v(2000, 0), v(2000, 100), v(0, 100)].map((p) =>
        v(c * p.x - s * p.y, s * p.x + c * p.y),
      ),
      holes: [],
    };
    const variants = [0, 1, 2, 3].map((k) =>
      noisyRotated(
        band,
        [0.3, -0.7, 0.9, -0.1, 0.5, -0.5, 0.2, 0.8].map((x) => (x * (k + 1)) / 4),
        k,
      ),
    );
    const now = variants.map((sh) => engravingPoint(sh).at);
    for (const p of now) expect(Math.hypot(p.x - now[0]!.x, p.y - now[0]!.y)).toBeLessThan(1e-6);
    for (const sh of variants) expect(engravingPoint(sh).clearance).toBeCloseTo(50, 6);
    const before = variants.map((sh) => legacyEngravingPoint(sh).at);
    const spread = Math.max(
      ...before.map((p) => Math.hypot(p.x - before[0]!.x, p.y - before[0]!.y)),
    );
    expect(spread).toBeGreaterThan(0.01);
  });
});
