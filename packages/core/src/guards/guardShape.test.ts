/**
 * Descripteur de forme des pièces de garde-corps (chantier guard-marks, G2a ; décisions G-Q2,
 * G-Q3) : propriétés de la comparaison sur des tronçons de bords générés (droite puis arc,
 * facettés comme la production à `GUARD_EDGE_CHORD_TOL`), puis cas des exemples.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { msg } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { flattenCurve, makeCurve } from "../geom2d/curve.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import type { Part } from "../model/derived.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { DEFAULT_WORKSHOP_PROFILE, resolveWorkshopProfile } from "../workshop/profile.js";
import {
  barShape,
  guardShapeDistance,
  panelShape,
  prismShape,
  sameGuardShape,
  type GuardMove,
  type GuardShape,
} from "./guardShape.js";
import { guardMarkEntryOfPart, guardShapeOfPart } from "./guardShape.testing.js";
import { groupGuardMarks, type GuardMarkEntry } from "./marks.js";
import {
  MarkRegistry,
  panelMember,
  sweptMember,
  verticalMember,
  type PartFactoryContext,
} from "./parts.js";
import { cumulative, dedupe, pointAt } from "./polyline.js";
import { GUARD_EDGE_CHORD_TOL } from "./sides.js";
import type { GuardSection } from "./spec.js";

// ------------------------------------------------------------------ générateurs

/**
 * Tracé en plan : droite de longueur `line` le long de +x depuis l'origine, puis arc tangent de
 * rayon `radius` et de balayage `sweep` (signe = sens), facetté à `tol`. Abscisse vraie s
 * (longueur le long de la courbe) ↔ abscisse x de la polyligne.
 */
interface Track {
  readonly pts: readonly Vec2[];
  readonly w: readonly number[];
  readonly line: Mm;
  readonly radius: Mm;
  readonly sign: number;
  readonly center: Vec2;
}

function track(line: Mm, radius: Mm, sweep: number, tol: Mm = GUARD_EDGE_CHORD_TOL): Track {
  const sign = Math.sign(sweep) || 1;
  const center = { x: line, y: sign * radius };
  const segs = [
    ...(line > 0 ? [{ kind: "line" as const, a: { x: 0, y: 0 }, b: { x: line, y: 0 } }] : []),
    {
      kind: "arc" as const,
      center,
      radius,
      startAngle: -sign * (Math.PI / 2),
      sweep,
    },
  ];
  const pts = dedupe(flattenCurve(makeCurve(segs), tol));
  return { pts, w: cumulative(pts), line, radius, sign, center };
}

/** Angle parcouru sur l'arc (≥ 0) du point p, déroulé près de l'estimation `guess`. */
function arcAngle(t: Track, p: Vec2, guess: number): number {
  const start = -t.sign * (Math.PI / 2);
  const a = t.sign * (Math.atan2(p.y - t.center.y, p.x - t.center.x) - start);
  let d = a - guess;
  d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  return guess + d;
}

/** Abscisse vraie d'un point de la polyligne d'abscisse x (cordes : angle depuis le centre). */
function trueS(t: Track, x: Mm): Mm {
  if (x <= t.line + 1e-9) return x;
  const p = pointAt(t.pts, t.w, x);
  return t.line + t.radius * arcAngle(t, p, (x - t.line) / t.radius);
}

/** Abscisse x de la polyligne du point d'abscisse vraie s (rayon depuis le centre ∩ corde). */
function polyX(t: Track, s: Mm): Mm {
  if (s <= t.line) return s;
  const th = (s - t.line) / t.radius;
  for (let i = 0; i + 1 < t.pts.length; i++) {
    if (t.w[i + 1]! <= t.line + 1e-9) continue;
    const tj = arcAngle(t, t.pts[i + 1]!, (t.w[i + 1]! - t.line) / t.radius);
    if (th > tj + 1e-12 && i + 2 < t.pts.length) continue;
    // Intersection du rayon d'angle th avec la corde [i, i+1].
    const start = -t.sign * (Math.PI / 2);
    const ang = start + t.sign * th;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const a = t.pts[i]!;
    const b = t.pts[i + 1]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    // a + u·e = c + r·d  ⇒  u = ((c − a) × d) / (e × d)
    const den = ex * dy - ey * dx;
    const u = ((t.center.x - a.x) * dy - (t.center.y - a.y) * dx) / den;
    return t.w[i]! + Math.min(1, Math.max(0, u)) * Math.hypot(ex, ey);
  }
  return t.w[t.w.length - 1]!;
}

interface Piece {
  readonly bottom: Vec3[];
  readonly top: Vec3[];
  readonly normals: Vec2[];
}

/**
 * Tronçon [s0 ; s1] (abscisses vraies) : stations aux sommets intérieurs, comme `subPath3`, et aux
 * abscisses `stations` (comptées depuis s0 : cassures du profil, comme `landingRaise`) ; bord
 * bas à z(s), haut à z(s) + h(s), s compté depuis s0.
 */
function piece(
  t: Track,
  s0: Mm,
  s1: Mm,
  z: (s: Mm) => Mm,
  h: (s: Mm) => Mm = () => 900,
  stations: readonly Mm[] = [],
): Piece {
  const c0 = polyX(t, s0);
  const c1 = polyX(t, s1);
  const inner = [
    ...t.w.filter((x) => x > c0 + 1e-6 && x < c1 - 1e-6),
    ...stations
      .filter((s) => s > 1e-3 && s < s1 - s0 - 1e-3)
      .map((s) => polyX(t, s0 + s))
      .filter((x) => t.w.every((wx) => Math.abs(wx - x) > 1e-6)),
  ].sort((p, q) => p - q);
  const xs = [c0, ...inner, c1];
  const bottom: Vec3[] = [];
  const top: Vec3[] = [];
  const normals: Vec2[] = [];
  for (const x of xs) {
    const p = pointAt(t.pts, t.w, x);
    const s = trueS(t, x) - s0;
    bottom.push({ x: p.x, y: p.y, z: z(s) });
    top.push({ x: p.x, y: p.y, z: z(s) + h(s) });
    const i = Math.min(
      t.pts.length - 2,
      Math.max(0, t.w.findIndex((wx) => wx > Math.min(Math.max(x, c0 + 1e-6), c1 - 1e-6)) - 1),
    );
    const dx = t.pts[i + 1]!.x - t.pts[i]!.x;
    const dy = t.pts[i + 1]!.y - t.pts[i]!.y;
    const l = Math.hypot(dx, dy);
    normals.push({ x: -dy / l, y: dx / l });
  }
  return { bottom, top, normals };
}

/** Déplacement propre du monde : rotation autour de z, translation, retournement éventuel. */
interface WorldMove {
  readonly angle: number;
  readonly dx: Mm;
  readonly dy: Mm;
  readonly dz: Mm;
  /** Rotation de 180° autour d'un axe horizontal (direction `axis`) : pièce posée à l'envers. */
  readonly flip: boolean;
  readonly axis: number;
  /** Lecture inversée des bords (sens de parcours arbitraire). */
  readonly reverse: boolean;
}

const worldMoveArb: fc.Arbitrary<WorldMove> = fc.record({
  angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  dx: fc.double({ min: -5000, max: 5000, noNaN: true }),
  dy: fc.double({ min: -5000, max: 5000, noNaN: true }),
  dz: fc.double({ min: -3000, max: 3000, noNaN: true }),
  flip: fc.boolean(),
  axis: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  reverse: fc.boolean(),
});

function applyMove(m: WorldMove, p: Vec3): Vec3 {
  let { x, y, z } = p;
  if (m.flip) {
    // Rotation de π autour de l'axe horizontal u : p_h → 2 (p_h·u) u − p_h, z → −z.
    const ux = Math.cos(m.axis);
    const uy = Math.sin(m.axis);
    const d = x * ux + y * uy;
    x = 2 * d * ux - x;
    y = 2 * d * uy - y;
    z = -z;
  }
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  return { x: c * x - s * y + m.dx, y: s * x + c * y + m.dy, z: z + m.dz };
}

function movedPiece(pc: Piece, m: WorldMove): { bottom: Vec3[]; top: Vec3[] } {
  const f = (e: Vec3[]): Vec3[] => {
    const out = e.map((p) => applyMove(m, p));
    return m.reverse ? out.reverse() : out;
  };
  // Posé à l'envers : l'ancien haut devient le bas.
  return m.flip
    ? { bottom: f(pc.top), top: f(pc.bottom) }
    : { bottom: f(pc.bottom), top: f(pc.top) };
}

const mirrorY = (e: readonly Vec3[]): Vec3[] => e.map((p) => ({ x: p.x, y: -p.y, z: p.z }));

/** Sommets alignés insérés (milieux 3D de chaque segment). */
const refine = (e: readonly Vec3[]): Vec3[] =>
  e.flatMap((q, i) =>
    i === 0
      ? [q]
      : [
          {
            x: (q.x + e[i - 1]!.x) / 2,
            y: (q.y + e[i - 1]!.y) / 2,
            z: (q.z + e[i - 1]!.z) / 2,
          },
          q,
        ],
  );

const sectionArb: fc.Arbitrary<GuardSection> = fc.oneof(
  fc.record({ kind: fc.constant("round" as const), diameter: fc.integer({ min: 4, max: 60 }) }),
  fc.record({
    kind: fc.constant("rect" as const),
    width: fc.integer({ min: 10, max: 80 }),
    height: fc.integer({ min: 10, max: 80 }),
  }),
);

/** Tracé et tronçon : droite puis arc, tronçon autour de la tangence ou dans l'arc. */
interface Setup {
  readonly line: Mm;
  readonly radius: Mm;
  readonly sweep: number;
  readonly s0: Mm;
  readonly len: Mm;
  readonly slope: number;
  /** Rehausse : pente supplémentaire au-delà de `kinkAt` (fraction de la longueur). */
  readonly kink: number;
  readonly kinkAt: number;
  /** Hauteur de panneau et rehausse du haut en trapèze. */
  readonly height: Mm;
  readonly raise: Mm;
}

const setupArb: fc.Arbitrary<Setup> = fc
  .record({
    line: fc.double({ min: 200, max: 1500, noNaN: true }),
    radius: fc.double({ min: 300, max: 3000, noNaN: true }),
    turn: fc.double({ min: 0.3, max: 2.5, noNaN: true }),
    ccw: fc.boolean(),
    before: fc.double({ min: 0, max: 1, noNaN: true }),
    len: fc.double({ min: 300, max: 2500, noNaN: true }),
    slope: fc.double({ min: -0.8, max: 0.8, noNaN: true }),
    kink: fc.oneof(fc.constant(0), fc.double({ min: -0.5, max: 0.5, noNaN: true })),
    kinkAt: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
    height: fc.double({ min: 300, max: 1100, noNaN: true }),
    raise: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 200, noNaN: true })),
  })
  .map((r) => {
    const sweep = (r.ccw ? 1 : -1) * r.turn;
    const total = r.line + r.radius * r.turn;
    const len = Math.min(r.len, total - 20);
    const s0 = r.before * (total - len - 10);
    return {
      line: r.line,
      radius: r.radius,
      sweep,
      s0,
      len,
      slope: r.slope,
      kink: r.kink,
      kinkAt: r.kinkAt,
      height: r.height,
      raise: r.raise,
    };
  });

const zOf =
  (u: Setup) =>
  (s: Mm): Mm =>
    u.slope * s + u.kink * Math.max(0, s - u.kinkAt * u.len);
const hOf =
  (u: Setup) =>
  (s: Mm): Mm =>
    u.height + u.raise * Math.min(1, Math.max(0, (s - 0.3 * u.len) / (0.2 * u.len)));

/** Station à la cassure du profil (rehausse) et aux cassures de la hauteur en trapèze. */
function setupPiece(u: Setup, t: Track = track(u.line, u.radius, u.sweep)): Piece {
  const stations = [
    ...(u.kink !== 0 ? [u.kinkAt * u.len] : []),
    ...(u.raise !== 0 ? [0.3 * u.len, 0.5 * u.len] : []),
  ];
  return piece(t, u.s0, u.s0 + u.len, zOf(u), hOf(u), stations);
}

const shapesOf = (pc: Piece, section: GuardSection, thickness: Mm): GuardShape[] => [
  barShape(pc.bottom, section),
  panelShape(pc.bottom, pc.top, thickness),
];

const RUNS = 60;

// ------------------------------------------------------------------ propriétés

describe("descripteur de forme : propriétés (G-Q2, G-Q3)", () => {
  it("réflexivité : d(A, A) ≤ 1e-9", () => {
    fc.assert(
      fc.property(setupArb, sectionArb, (u, sec) => {
        for (const A of shapesOf(setupPiece(u), sec, 10)) {
          expect(guardShapeDistance(A, A)).toBeLessThanOrEqual(1e-9);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("symétrie : d(A, B) = d(B, A)", () => {
    fc.assert(
      fc.property(
        setupArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.5, max: 1, noNaN: true }),
        (u, shift, scale) => {
          const t = track(u.line, u.radius, u.sweep);
          const v = { ...u, s0: u.s0 * shift, len: u.len * scale, slope: u.slope * scale };
          const a = setupPiece(u, t);
          const b = setupPiece(v, t);
          const sec: GuardSection = { kind: "round", diameter: 42 };
          const [Ab, Ap] = shapesOf(a, sec, 10);
          const [Bb, Bp] = shapesOf(b, sec, 10);
          for (const [A, B] of [
            [Ab!, Bb!],
            [Ap!, Bp!],
          ] as const) {
            const d = guardShapeDistance(A, B);
            // Symétrie aux arrondis près : 10⁻⁶ en relatif (1,1·10⁻⁵ mm mesuré à d ≈ 113 mm,
            // panneau retourné), sans effet près de T.
            expect(Math.abs(d - guardShapeDistance(B, A))).toBeLessThanOrEqual(1e-9 + 1e-6 * d);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("invariance par déplacement propre (rotation, translation, pièce retournée) : d ≤ 1e-6", () => {
    fc.assert(
      fc.property(setupArb, worldMoveArb, (u, m) => {
        const pc = setupPiece(u);
        const mv = movedPiece(pc, m);
        const sec: GuardSection = { kind: "rect", width: 40, height: 30 };
        // Barre : l'axe seul (retournée bout pour bout si `flip`).
        const bar = movedPiece({ ...pc, top: pc.bottom }, m).bottom;
        expect(
          guardShapeDistance(barShape(pc.bottom, sec), barShape(bar, sec)),
        ).toBeLessThanOrEqual(1e-6);
        expect(
          guardShapeDistance(panelShape(pc.bottom, pc.top, 10), panelShape(mv.bottom, mv.top, 10)),
        ).toBeLessThanOrEqual(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  it("miroir refusé pour un panneau cintré et rampant ; admis (d ≤ 1e-6) pour un panneau plan", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 300, max: 3000, noNaN: true }),
        fc.double({ min: (20 * Math.PI) / 180, max: 2, noNaN: true }),
        fc.boolean(),
        fc.double({ min: Math.tan((10 * Math.PI) / 180), max: 0.8, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 300, max: 1100, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        worldMoveArb,
        (radius, turn, ccw, slope, down, height, raiseRatio, m) => {
          const sweep = (ccw ? 1 : -1) * turn;
          // Tronçon cintré : tout l'arc (≥ 20°), au moins 600 mm.
          const t = track(0, Math.max(radius, 600 / turn), sweep);
          const len = t.radius * turn - 1;
          const z = (s: Mm): Mm => (down ? -slope : slope) * s;
          // Rehausse du haut au plus égale à la pente. Un bord haut de pente opposée au bord bas
          // (rehausse = 2 × pente, bord bas descendant) rend le panneau symétrique par rapport à
          // son plan médian, donc égal à son miroir à un déplacement près (graine 969663350 :
          // écart en miroir 0,5 mm) ; ici |pente bas + pente haut| ≥ pente, miroir ≥ 34 mm.
          const h = (s: Mm): Mm => height + raiseRatio * slope * s;
          const pc = piece(t, 0.5, len, z, h);
          const A = panelShape(pc.bottom, pc.top, 10);
          const M = panelShape(mirrorY(pc.bottom), mirrorY(pc.top), 10);
          expect(guardShapeDistance(A, M)).toBeGreaterThan(
            DEFAULT_WORKSHOP_PROFILE.identicalPartTolerance,
          );
          // Panneau plan (droit en plan), même profil, placé n'importe où.
          const flat = piece(track(len + 10, 1000, 0.5), 0, len, z, h);
          const fm = movedPiece(flat, { ...m, flip: false, reverse: false });
          expect(
            guardShapeDistance(
              panelShape(fm.bottom, fm.top, 10),
              panelShape(mirrorY(fm.bottom), mirrorY(fm.top), 10),
            ),
          ).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("sensibilité à T : un écart δ > T (longueur, hauteur, dénivelé) sépare les pièces", () => {
    fc.assert(
      fc.property(
        setupArb,
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0.01, max: 5, noNaN: true }),
        (u0, T, extra) => {
          const delta = T + extra;
          // Tronçon débutant dans la droite (allongé côté droite), pente ≥ 0,05, hauteur constante.
          const u: Setup = {
            ...u0,
            s0: Math.max(u0.s0, 20),
            slope: 0.05 + Math.abs(u0.slope),
            raise: 0,
          };
          const t = track(Math.max(u.line, u.s0 + 50), u.radius, u.sweep);
          const sec: GuardSection = { kind: "round", diameter: 12 };
          const base = setupPiece(u, t);
          const shift = Math.min(delta, u.s0);
          const kinkAt = u.kink !== 0 ? [u.kinkAt * u.len] : [];
          const longer = piece(
            t,
            u.s0 - shift,
            u.s0 + u.len,
            (s) => zOf(u)(s - shift),
            undefined,
            kinkAt.map((s) => s + shift),
          );
          const higher = piece(t, u.s0, u.s0 + u.len, zOf(u), (s) => hOf(u)(s) + delta, kinkAt);
          const steeper = piece(
            t,
            u.s0,
            u.s0 + u.len,
            (s) => zOf(u)(s) + (delta * s) / u.len,
            hOf(u),
            kinkAt,
          );
          const cases: [GuardShape, GuardShape, number][] = [
            [barShape(base.bottom, sec), barShape(longer.bottom, sec), Math.min(delta, u.s0)],
            [panelShape(base.bottom, base.top, 8), panelShape(higher.bottom, higher.top, 8), delta],
            [
              panelShape(base.bottom, base.top, 8),
              panelShape(steeper.bottom, steeper.top, 8),
              delta,
            ],
            [barShape(base.bottom, sec), barShape(steeper.bottom, sec), delta],
          ];
          for (const [A, B, dd] of cases) {
            expect(guardShapeDistance(A, B)).toBeGreaterThanOrEqual(dd - 1e-6);
            if (dd > T) expect(sameGuardShape(A, B, T)).toBe(false);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("insensibilité au nombre de stations : sommets alignés insérés", () => {
    fc.assert(
      fc.property(setupArb, setupArb, (u, v) => {
        const a = setupPiece(u);
        const b = setupPiece(v);
        const sec: GuardSection = { kind: "rect", width: 40, height: 40 };
        const A = barShape(a.bottom, sec);
        const Ar = barShape(refine(a.bottom), sec);
        const B = barShape(b.bottom, sec);
        expect(Math.abs(guardShapeDistance(A, B) - guardShapeDistance(Ar, B))).toBeLessThanOrEqual(
          1e-6,
        );
        expect(guardShapeDistance(A, Ar)).toBeLessThanOrEqual(1e-6);
        const P = panelShape(a.bottom, a.top, 10);
        const Pr = panelShape(refine(a.bottom), refine(a.top), 10);
        const Q = panelShape(b.bottom, b.top, 10);
        expect(Math.abs(guardShapeDistance(P, Q) - guardShapeDistance(Pr, Q))).toBeLessThanOrEqual(
          1e-6,
        );
        expect(guardShapeDistance(P, Pr)).toBeLessThanOrEqual(1e-6);
      }),
      { numRuns: RUNS },
    );
  });

  /**
   * Même arc facetté autrement : tracés droite + arc de balayages différents (cordes et phase
   * différentes) ou facettés à 0,1 mm, même tronçon physique (abscisses vraies). Le tronçon
   * couvre au moins 500 mm d'arc (plusieurs cordes entières).
   */
  const sameArcArb = fc
    .record({
      line: fc.double({ min: 200, max: 1500, noNaN: true }),
      radius: fc.double({ min: 300, max: 3000, noNaN: true }),
      ccw: fc.boolean(),
      onArc: fc.double({ min: 500, max: 1200, noNaN: true }),
      // Bout de droite dans le tronçon : 0 à 10 mm ou 150 à 200 mm, hors des longueurs de corde
      // (15 à 110 mm) ; une droite de la longueur d'une corde d'arc voisine serait prise pour un
      // arc (limite de la reconstruction, propre aux cordes égales de `flattenCurve`).
      before: fc.oneof(
        fc.double({ min: -200, max: -150, noNaN: true }),
        fc.double({ min: -10, max: 180, noNaN: true }),
      ),
      extra1: fc.double({ min: 0.02, max: 1, noNaN: true }),
      extra2: fc.double({ min: 0.02, max: 1, noNaN: true }),
      slope: fc.double({ min: -0.8, max: 0.8, noNaN: true }),
    })
    .map((r) => ({
      ...r,
      // Début du tronçon : dans la droite (avant la tangence) ou dans l'arc.
      s0: r.line + r.before,
      s1: r.line + r.onArc + Math.max(0, r.before),
      base: (r.onArc + Math.max(0, r.before) + 50) / r.radius,
    }));

  it("insensibilité au facettage : même arc coupé à deux phases, ou facetté à 0,5 et 0,1 (d ≤ 0,05)", () => {
    fc.assert(
      fc.property(sameArcArb, (r) => {
        const sg = r.ccw ? 1 : -1;
        // Tracés : balayages différents (cordes et phase différentes), puis facettage à 0,1 mm.
        const t1 = track(r.line, r.radius, sg * (r.base + r.extra1));
        const t2 = track(r.line, r.radius, sg * (r.base + r.extra2));
        const tf = track(r.line, r.radius, sg * (r.base + r.extra1), 0.1);
        const z = (s: Mm): Mm => r.slope * s;
        const sec: GuardSection = { kind: "round", diameter: 42 };
        const p1 = piece(t1, r.s0, r.s1, z);
        for (const t of [t2, tf]) {
          const p2 = piece(t, r.s0, r.s1, z);
          expect(
            guardShapeDistance(barShape(p1.bottom, sec), barShape(p2.bottom, sec)),
          ).toBeLessThanOrEqual(0.05);
          expect(
            guardShapeDistance(
              panelShape(p1.bottom, p1.top, 10),
              panelShape(p2.bottom, p2.top, 10),
            ),
          ).toBeLessThanOrEqual(0.05);
        }
      }),
      { numRuns: RUNS },
    );
  });

  const P = (x: Mm, y: Mm, z: Mm): Vec3 => ({ x, y, z });
  const ROUND: GuardSection = { kind: "round", diameter: 42 };
  const T0 = DEFAULT_WORKSHOP_PROFILE.identicalPartTolerance;

  it("sameGuardShape (minorant, arrêt précoce, G2b) ⇔ guardShapeDistance ≤ T + GEOM_EPS", () => {
    fc.assert(
      fc.property(
        setupArb,
        worldMoveArb,
        fc.record({
          // Écarts tirés sur une grille (les doubles de fast-check penchent vers 0).
          dLen: fc.integer({ min: -300, max: 300 }).map((x) => x / 100),
          dSlope: fc.integer({ min: -200, max: 200 }).map((x) => x / 1e5),
          dHeight: fc.integer({ min: -200, max: 200 }).map((x) => x / 100),
          // Écart de rayon à longueur égale : seul le résidu (recalage) le voit.
          dRadius: fc.integer({ min: -30, max: 30 }),
          // Écart de T autour de la distance (frontière), ou T quelconque.
          around: fc.oneof(
            fc.integer({ min: -50, max: 50 }).map((x) => x / 1000),
            fc.constantFrom(-1e-10, 0, 1e-10),
          ),
          tolFree: fc.oneof(
            fc.constant(null),
            fc.integer({ min: 0, max: 300 }).map((x) => x / 100),
          ),
        }),
        sectionArb,
        (u, m, r, sec) => {
          const v: Setup = {
            ...u,
            len: Math.max(50, u.len + r.dLen),
            slope: u.slope + r.dSlope,
            height: u.height + r.dHeight,
            radius: u.radius + r.dRadius,
          };
          const pa = setupPiece(u);
          const pb = movedPiece(setupPiece(v), m);
          for (const [A, B] of [
            [barShape(pa.bottom, sec), barShape(pb.bottom, sec)],
            [panelShape(pa.bottom, pa.top, 10), panelShape(pb.bottom, pb.top, 10)],
          ] as const) {
            const d = guardShapeDistance(A, B);
            const tol = r.tolFree ?? Math.max(0, d - GEOM_EPS + r.around);
            expect(sameGuardShape(A, B, tol), `d = ${d}, T = ${tol}`).toBe(d <= tol + GEOM_EPS);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("frontière : d = T réunit, d > T + GEOM_EPS sépare", () => {
    const sec: GuardSection = { kind: "rect", width: 80, height: 80 };
    expect(sameGuardShape(prismShape(sec, 858), prismShape(sec, 858 + T0), T0)).toBe(true);
    expect(sameGuardShape(prismShape(sec, 858), prismShape(sec, 858 + T0 + 1e-5), T0)).toBe(false);
  });

  it("cassure du profil z(s) hors sommet du tracé : lue exactement (rehausse décalée de 100 mm)", () => {
    const a = [P(0, 0, 0), P(1100, 0, 0), P(2000, 0, 500)];
    const b = [P(0, 0, 0), P(1000, 0, 0), P(1250, 0, 250 / 3), P(2000, 0, 500)];
    expect(guardShapeDistance(barShape(a, ROUND), barShape(b, ROUND))).toBeGreaterThan(10);
  });

  it("ressaut vertical : sa position compte, déplacements propres admis", () => {
    const step = (x: Mm): Vec3[] => [P(0, 0, 0), P(x, 0, 0), P(x, 0, 500), P(2000, 0, 500)];
    const a = barShape(step(1000), ROUND);
    expect(guardShapeDistance(a, barShape(step(1100), ROUND))).toBeGreaterThan(100);
    const top = (e: Vec3[]): Vec3[] => e.map((p) => ({ ...p, z: p.z + 900 }));
    const pa = { bottom: step(1000), top: top(step(1000)), normals: [] };
    for (const m of [
      { angle: 0.7, dx: 10, dy: -20, dz: 5, flip: false, axis: 0, reverse: true },
      { angle: -2, dx: 0, dy: 300, dz: 0, flip: true, axis: 1.1, reverse: false },
      { angle: 0, dx: 0, dy: 0, dz: 0, flip: true, axis: 0.3, reverse: true },
    ]) {
      const bar = movedPiece({ ...pa, top: pa.bottom }, m).bottom;
      expect(guardShapeDistance(a, barShape(bar, ROUND))).toBeLessThanOrEqual(1e-6);
      const mv = movedPiece(pa, m);
      expect(
        guardShapeDistance(panelShape(pa.bottom, pa.top, 10), panelShape(mv.bottom, mv.top, 10)),
      ).toBeLessThanOrEqual(1e-6);
    }
  });

  it("longueur développée : même plan, même dénivelé, profil en dents de scie de 0,3 mm séparé (Δ ≈ 9,9 mm)", () => {
    const n = 500;
    const straight = Array.from({ length: n + 1 }, (_, i) => P(2 * i, 0, 0.6 * i));
    const saw = straight.map((p, i) => ({ ...p, z: p.z + (i % 2 === 1 ? 0.3 : 0) }));
    expect(guardShapeDistance(barShape(straight, ROUND), barShape(saw, ROUND))).toBeGreaterThan(5);
  });

  it("tracé en plan seul : rayon différent, même longueur et même dénivelé, séparé", () => {
    const len = 1500;
    const bar = (r: Mm): GuardShape =>
      barShape(piece(track(0, r, len / r + 0.1), 0, len, (s) => 0.3 * s).bottom, ROUND);
    expect(guardShapeDistance(bar(1000), bar(1100))).toBeGreaterThan(T0);
  });

  it("bout droit non tangent à un arc : pas ramené sur le cercle", () => {
    // Arc de rayon 1000, cordes de 0,06 rad (flèche 0,45 mm), coupé à 0,8 corde (P2, bout
    // ramené sur le cercle) ou prolongé par une droite de même longueur déviée de 3 × 0,06 rad
    // au dernier sommet (P1, tronçon droit : son extrémité reste où elle est).
    const R = 1000;
    const tau = 0.06;
    const arc = Array.from({ length: 9 }, (_, i) =>
      P(R * Math.sin(i * tau), R - R * Math.cos(i * tau), 0.2 * R * i * tau),
    );
    const v8 = arc[8]!;
    const v9 = P(R * Math.sin(9 * tau), R - R * Math.cos(9 * tau), 0.2 * R * 9 * tau);
    const cut = P(
      v8.x + 0.8 * (v9.x - v8.x),
      v8.y + 0.8 * (v9.y - v8.y),
      v8.z + 0.8 * (v9.z - v8.z),
    );
    const dx = v9.x - v8.x;
    const dy = v9.y - v8.y;
    const c = Math.cos(2 * tau);
    const s = Math.sin(2 * tau);
    const bent = P(v8.x + 0.8 * (c * dx - s * dy), v8.y + 0.8 * (s * dx + c * dy), cut.z);
    expect(
      guardShapeDistance(barShape([...arc, cut], ROUND), barShape([...arc, bent], ROUND)),
    ).toBeGreaterThan(1);
  });

  it("polygone à cordes égales et angles droits : pas pris pour un arc (distance continue)", () => {
    const poly = (c: Mm): GuardShape =>
      barShape(
        [P(0, 0, 0), P(300, 0, 0), P(300, 500, 0), P(300 - c, 500, 0), P(300 - c, 200, 0)],
        ROUND,
      );
    expect(guardShapeDistance(poly(500), poly(499))).toBeLessThanOrEqual(1.5);
    expect(guardShapeDistance(poly(499), poly(498))).toBeLessThanOrEqual(1.5);
  });

  it("clés différentes (section, épaisseur, famille) : distance infinie", () => {
    const u: Setup = {
      line: 500,
      radius: 1000,
      sweep: 1,
      s0: 100,
      len: 1200,
      slope: 0.6,
      kink: 0,
      kinkAt: 0.5,
      height: 900,
      raise: 0,
    };
    const pc = setupPiece(u);
    const a = barShape(pc.bottom, { kind: "round", diameter: 42 });
    expect(guardShapeDistance(a, barShape(pc.bottom, { kind: "round", diameter: 40 }))).toBe(
      Infinity,
    );
    expect(
      guardShapeDistance(a, barShape(pc.bottom, { kind: "rect", width: 42, height: 42 })),
    ).toBe(Infinity);
    expect(
      guardShapeDistance(panelShape(pc.bottom, pc.top, 10), panelShape(pc.bottom, pc.top, 8)),
    ).toBe(Infinity);
    expect(guardShapeDistance(a, panelShape(pc.bottom, pc.top, 10))).toBe(Infinity);
    const sec: GuardSection = { kind: "rect", width: 80, height: 80 };
    expect(guardShapeDistance(prismShape(sec, 858), prismShape(sec, 858.4))).toBeCloseTo(0.4, 9);
    expect(guardShapeDistance(prismShape(sec, 858), a)).toBe(Infinity);
    expect(
      guardShapeDistance(
        prismShape(sec, 858),
        prismShape({ kind: "rect", width: 80, height: 40 }, 858),
      ),
    ).toBe(Infinity);
  });

  it("fidélité de l'aide de test : le descripteur relu dans la pièce est celui des entrées", () => {
    fc.assert(
      fc.property(setupArb, sectionArb, fc.integer({ min: 6, max: 30 }), (u, sec, thickness) => {
        const ctx: PartFactoryContext = {
          marks: new MarkRegistry(DEFAULT_WORKSHOP_PROFILE.identicalPartTolerance),
          profile: DEFAULT_WORKSHOP_PROFILE,
        };
        const common = {
          id: "x",
          prefix: "PN",
          category: "infill" as const,
          name: msg("part.glassPanel.name"),
          material: "glass" as const,
        };
        const pc = setupPiece(u);
        const panel = panelMember(ctx, common, pc.bottom, pc.top, pc.normals, thickness);
        const bar = sweptMember(ctx, { ...common, prefix: "LS" }, pc.bottom, sec);
        const post = verticalMember(
          ctx,
          { ...common, prefix: "PG" },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          sec,
          0,
          858,
        );
        expect(
          guardShapeDistance(guardShapeOfPart(panel)!, panelShape(pc.bottom, pc.top, thickness)),
        ).toBeLessThanOrEqual(1e-9);
        expect(
          guardShapeDistance(guardShapeOfPart(bar)!, barShape(pc.bottom, sec)),
        ).toBeLessThanOrEqual(1e-9);
        expect(guardShapeDistance(guardShapeOfPart(post)!, prismShape(sec, 858))).toBe(0);
      }),
      { numRuns: RUNS },
    );
  });
});

// ------------------------------------------------------------------ exemples

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const SUFFIX = ".blondel.json";
const readExample = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}${SUFFIX}`), "utf8"));

/** Pièces de garde-corps par repère, dans l'ordre de première apparition. */
function guardMarks(parts: readonly Part[]): Map<string, Part[]> {
  const out = new Map<string, Part[]>();
  for (const p of parts) {
    if (p.family !== "guards") continue;
    out.set(p.mark, [...(out.get(p.mark) ?? []), p]);
  }
  return out;
}

const shapeOf = (p: Part): GuardShape => {
  const s = guardShapeOfPart(p);
  expect(s, p.id).not.toBeNull();
  return s!;
};

describe("descripteur de forme : exemples", () => {
  it.each(["demo-helical-well", "demo-central-glulam"])(
    "%s : les deux PN1 sont la même pièce tournée de 180° dans son plan, pas son miroir",
    (name) => {
      const pn1 = buildModel(readExample(name), { memo: false }).parts.filter(
        (p) => p.family === "guards" && p.mark === "PN1",
      );
      expect(pn1).toHaveLength(2);
      const [a, b] = pn1.map(shapeOf);
      const d = (moves?: readonly GuardMove[]): number => guardShapeDistance(a!, b!, moves);
      expect(d()).toBeLessThanOrEqual(1e-6);
      expect(d(["flipped"])).toBeLessThanOrEqual(1e-6);
      expect(d(["same"])).toBeGreaterThan(0.5);
      expect(d(["mirror"])).toBeGreaterThan(100);
    },
  );

  it("demo-cage-oak-60 en câbles, hauteur d'étage + 23 mm : les deux câbles de l'ex-CA13 (éventail) sont séparés à T", () => {
    const j = JSON.parse(readFileSync(join(EXAMPLES_DIR, `demo-cage-oak-60${SUFFIX}`), "utf8"));
    j.guards.infill = { kind: "cables" };
    j.site.floorToFloor += 23;
    const p = parseProjectText(JSON.stringify(j));
    const parts = buildModel(p, { memo: false }).parts;
    const byId = (id: string): Part => {
      const x = parts.find((q) => q.id === id);
      expect(x, id).toBeDefined();
      return x!;
    };
    const pa = byId("guard-inner-1-cable-20");
    const pb = byId("guard-inner-1-cable-21");
    const [a, b] = [pa, pb].map(shapeOf);
    const T = resolveWorkshopProfile(p.workshop).identicalPartTolerance;
    expect(T).toBe(0.5);
    expect(sameGuardShape(a!, b!, T)).toBe(false);
    expect(guardShapeDistance(a!, b!)).toBeGreaterThan(1);
    // Repères distincts (G2b : regroupement à T ; l'ancien arrondi les réunissait en CA13).
    expect(pa.mark).toBe("CA13");
    expect(pb.mark).not.toBe(pa.mark);
  });

  /**
   * Règle du repérage (G2b) sur tous les exemples : chaque repère est un seul groupe autour de
   * son ancre (recalculée par `groupGuardMarks`), et aucune paire d'ancres de repères distincts
   * de même clé n'est identique à T (MC1 / MC2 des exemples droits réunies, G-Q5).
   */
  it("exemples : chaque repère tient à T autour de son ancre, aucun repère distinct identique à T", () => {
    const projects: [string, Project][] = [
      ...readdirSync(EXAMPLES_DIR)
        .filter((f) => f.endsWith(SUFFIX))
        .sort()
        .map(
          (f) =>
            [f.slice(0, -SUFFIX.length), readExample(f.slice(0, -SUFFIX.length))] as [
              string,
              Project,
            ],
        ),
      ["préréglage helical", createProject("helical")],
    ];
    const near: string[] = [];
    for (const [name, p] of projects) {
      const T = resolveWorkshopProfile(p.workshop).identicalPartTolerance;
      const marks = guardMarks(buildModel(p, { memo: false }).parts);
      const anchors: { mark: string; entry: GuardMarkEntry }[] = [];
      for (const [mark, ps] of marks) {
        const entries = ps.map((x) => {
          const e = guardMarkEntryOfPart(x);
          expect(e, `${name} ${x.id}`).not.toBeNull();
          return e!;
        });
        const groups = groupGuardMarks(entries, T);
        expect(groups, `${name} ${mark}`).toHaveLength(1);
        const anchor = entries[groups[0]!.anchor]!;
        for (const e of entries) {
          expect(sameGuardShape(anchor.shape, e.shape, T), `${name} ${mark} ${e.id}`).toBe(true);
        }
        anchors.push({ mark, entry: anchor });
      }
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const a = anchors[i]!;
          const b = anchors[j]!;
          if (a.entry.key !== b.entry.key) continue;
          if (sameGuardShape(a.entry.shape, b.entry.shape, T)) {
            near.push(`${name} ${a.mark}~${b.mark}`);
          }
        }
      }
    }
    expect(near).toEqual([]);
  });
});
