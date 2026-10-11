/**
 * Propriétés du moteur de cage sur des cages générées (sous-lot 2a, ADR-0010) : 2 à 5 tronçons
 * de largeur constante, angles dans ]−180°, 180°[ hors voisinage de ±180° (paliers droits et
 * ±90° compris), raccords de jour vifs, en arc ou en pan coupé, côté mur vifs ou en congé,
 * modes variés.
 *
 * - Γ continue (C0), de longueur égale à la somme des parties droites et des zones ;
 *   tangente continue (hors transitions d'un S / Z, anguleuses par construction) ;
 * - d_f respectée : distance de Γ au bord du jour de la jonction voisine sur les parties
 *   droites ;
 * - cumul des angles de jonction = rotation du dernier repère ;
 * - sans constat de recouvrement : C_i et C_e sans auto-intersection ni croisement mutuel, Γ
 *   à l'intérieur de l'emprise (congés côté mur jusqu'à plusieurs E compris) ;
 * - constat `sectionsOverlap` : oracle indépendant des pièces convexes, le contour de l'emprise
 *   n'est pas simple ;
 * - pièces convexes (`cagePieces`) convexes et d'aire positive ;
 * - invariance par placement (rotation, translation).
 *
 * La parité à ±90° avec le moteur à volées est vérifiée ailleurs, une seule fois :
 * `parity.test.ts` (tracés à volées) et `native.test.ts` (cages saisies, constats compris).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Message } from "@blondel/i18n";
import {
  curveLength,
  curvePointAt,
  curveTangentAt,
  cumulativeLengths,
  flattenCurve,
} from "../../geom2d/curve.js";
import { segmentIntersect } from "../../geom2d/intersect.js";
import { isConvex, pointInPolygon, signedArea } from "../../geom2d/polygon.js";
import { segEnd, segLength, segStart, segTangentAt, wrapPi } from "../../geom2d/segment.js";
import { GEOM_EPS } from "../../geom2d/tolerance.js";
import * as V from "../../geom2d/vec.js";
import type { Layout } from "../../model/derived.js";
import type { Curve2, Vec2 } from "../../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../../model/project.js";
import { LayoutError } from "../errors.js";
import { computeCageLayout } from "./cage.js";
import { buildFrames } from "./frames.js";
import { junctionGeom } from "./junction.js";
import { cagePieces } from "./overlap.js";

type JunctionInput = CageLayoutSpecInput["junctions"][number];

const angleArb = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: -170, max: 170 }).filter((a) => a !== 0) },
  { weight: 2, arbitrary: fc.constantFrom(90, -90) },
  { weight: 1, arbitrary: fc.constant(0) },
  {
    weight: 1,
    arbitrary: fc.double({ min: -170, max: 170, noNaN: true }).filter((a) => Math.abs(a) >= 0.01),
  },
);

const junctionArb: fc.Arbitrary<JunctionInput> = fc
  .record({
    angle: angleArb,
    mode: fc.constantFrom("winders" as const, "landing" as const, "radiating" as const),
    well: fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 300 }) }),
      fc.record({
        kind: fc.constant("chamfer" as const),
        setbackIn: fc.integer({ min: 1, max: 300 }),
        setbackOut: fc.integer({ min: 1, max: 300 }),
      }),
    ),
    wall: fc.oneof(
      fc.constant({ kind: "sharp" as const }),
      fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 4000 }) }),
    ),
    depth: fc.option(fc.integer({ min: 300, max: 1500 }), { nil: undefined }),
  })
  .map((j): JunctionInput => {
    if (j.angle === 0) {
      return { angle: 0, mode: "landing", ...(j.depth !== undefined ? { depth: j.depth } : {}) };
    }
    return { angle: j.angle, mode: j.mode, well: j.well, wall: j.wall };
  });

const cageArb: fc.Arbitrary<CageLayoutSpecInput> = fc
  .record({
    width: fc.integer({ min: 600, max: 1500 }),
    lengths: fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 2, maxLength: 5 }),
    junctions: fc.array(junctionArb, { minLength: 4, maxLength: 4 }),
  })
  .map((r) => ({
    kind: "cage" as const,
    sections: r.lengths.map((length) => ({
      axis: { kind: "straight" as const, length },
      width: r.width,
    })),
    junctions: r.junctions.slice(0, r.lengths.length - 1),
  }));

const placementArb = fc.record({
  x: fc.integer({ min: -5000, max: 5000 }),
  y: fc.integer({ min: -5000, max: 5000 }),
  rotation: fc.double({ min: -180, max: 180, noNaN: true }),
});

function project(layout: CageLayoutSpecInput, placement = { x: 0, y: 0, rotation: 0 }): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: placement.x, y: placement.y }, rotation: placement.rotation },
      layout,
    },
  });
}

/** Tracé, ou erreur de tracé (`LayoutError` seulement : toute autre exception fait échouer). */
function run(p: Project): Layout | LayoutError {
  try {
    return computeCageLayout(p, p.stair.layout as CageLayoutSpec);
  } catch (e) {
    if (e instanceof LayoutError) return e;
    throw e;
  }
}

/** Polyligne sans points consécutifs confondus. */
function polyline(curve: Curve2): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of flattenCurve(curve, 0.5)) {
    const last = pts[pts.length - 1];
    if (last === undefined || V.distance(last, p) > 1e-6) pts.push(p);
  }
  return pts;
}

/** Premier croisement entre arêtes non consécutives d'une polyligne ouverte, ou `null`. */
function selfIntersection(pts: readonly Vec2[]): [number, number] | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let j = i + 2; j + 1 < pts.length; j++) {
      if (segmentIntersect(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)) return [i, j];
    }
  }
  return null;
}

/** Premier croisement entre une arête de `a` et une arête de `b`, ou `null`. */
function crossing(a: readonly Vec2[], b: readonly Vec2[]): [number, number] | null {
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      if (segmentIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return [i, j];
    }
  }
  return null;
}

/** Premier croisement entre arêtes non voisines d'un polygone fermé, ou `null`. */
function closedSelfIntersection(poly: readonly Vec2[]): [number, number] | null {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentIntersect(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) {
        return [i, j];
      }
    }
  }
  return null;
}

const NUM_RUNS = 300;

describe("propriétés du moteur de cage (angles quelconques, raccords)", () => {
  it("calcul sans autre exception qu'une LayoutError ; tracé cohérent", () => {
    let computed = 0;
    let overlaps = 0;
    fc.assert(
      fc.property(cageArb, (spec) => {
        const p = project(spec);
        const out = run(p);
        if (out instanceof LayoutError) {
          expect(out.msg.key.startsWith("layout.")).toBe(true);
          return;
        }
        computed++;
        const layout = out;
        const df = layout.walklineOffset;
        // Γ continue (makeCurve l'a vérifié) ; longueur = parties droites + zones.
        const L = curveLength(layout.walkline);
        const sections = layout.sections!;
        expect(sections).toHaveLength(spec.sections.length);
        expect(layout.turns).toHaveLength(spec.junctions.length);
        const sum =
          sections.reduce((a, s) => a + (s.sEnd - s.sStart), 0) +
          layout.turns.reduce((a, t) => a + (t.sEnd - t.sStart), 0);
        expect(sum).toBeCloseTo(L, 6);
        expect(sections[0]!.sStart).toBe(0);
        expect(sections[sections.length - 1]!.sEnd).toBeCloseTo(L, 6);
        sections.forEach((s, i) => {
          const z = layout.turns[i];
          if (z !== undefined) {
            expect(z.sStart).toBe(s.sEnd);
            expect(sections[i + 1]!.sStart).toBe(z.sEnd);
          }
        });

        // Tangente continue aux raccords de Γ, hors transitions (S / Z).
        const transitions = layout.walklineTransitions ?? [];
        const cum = cumulativeLengths(layout.walkline);
        const segs = layout.walkline.segments;
        for (let k = 0; k + 1 < segs.length; k++) {
          const s = cum[k + 1]!;
          if (transitions.some((t) => Math.abs(t.sStart - s) < 1e-6 || Math.abs(t.sEnd - s) < 1e-6))
            continue;
          if (segLength(segs[k]!) <= 1e-9 || segLength(segs[k + 1]!) <= 1e-9) continue;
          const t0 = segTangentAt(segs[k]!, 1);
          const t1 = segTangentAt(segs[k + 1]!, 0);
          expect(V.distance(segEnd(segs[k]!), segStart(segs[k + 1]!))).toBeLessThan(1e-6);
          expect(V.distance(t0, t1)).toBeLessThan(1e-9);
        }

        // d_f respectée sur les parties droites, au droit des jonctions tournantes voisines.
        sections.forEach((sec, i) => {
          const across = V.normalize(V.sub(sec.start.right, sec.start.left));
          const u = V.perpLeft(across);
          const check = (s: number, side: "left" | "right" | undefined, line: typeof sec.start) => {
            if (side === undefined) return;
            const p0 = line[side];
            const g = curvePointAt(layout.walkline, s);
            expect(Math.abs(V.cross(u, V.sub(g, p0)))).toBeCloseTo(df, 6);
          };
          const prev = layout.turns[i - 1];
          const next = layout.turns[i];
          if (prev && prev.angle !== 0) check(sec.sStart, sec.startWellSide, sec.start);
          if (next && next.angle !== 0) check(sec.sEnd, sec.endWellSide, sec.end);
        });

        // Cumul des angles = rotation du dernier repère.
        const dir = (i: number): Vec2 => {
          const s = sections[i]!;
          return V.perpLeft(V.normalize(V.sub(s.start.right, s.start.left)));
        };
        const total = layout.turns.reduce((a, t) => a + t.angle!, 0);
        expect(wrapPi(V.signedAngle(dir(0), dir(sections.length - 1)) - total + 1e-12)).toBeCloseTo(
          0,
          9,
        );
        // La tangente de Γ en fin de tronçon suit le tronçon.
        const tEnd = curveTangentAt(layout.walkline, L);
        if (!transitions.some((t) => t.leg === sections.length - 1)) {
          expect(V.distance(tEnd, dir(sections.length - 1))).toBeLessThan(1e-9);
        }

        // Sans constat : C_i et C_e sans auto-intersection ni croisement mutuel, Γ dans
        // l'emprise (hors extrémités, sur les lignes de départ et d'arrivée).
        if (layout.errors === undefined) {
          const inner = polyline(layout.inner);
          const outer = polyline(layout.outer);
          expect(selfIntersection(inner)).toBeNull();
          expect(selfIntersection(outer)).toBeNull();
          expect(crossing(inner, outer)).toBeNull();
          for (let f = 1 / 64; f < 1; f += 1 / 64) {
            expect(pointInPolygon(curvePointAt(layout.walkline, f * L), layout.footprint)).toBe(
              "inside",
            );
          }
        }
        // Constat de recouvrement (pièces convexes) : oracle indépendant, le contour de
        // l'emprise (C_e puis C_i à l'envers) n'est pas simple. Recouvrements d'au moins 1 mm
        // dans chaque direction seulement : en deçà (pénétration de l'ordre de `GEOM_EPS`,
        // contact presque tangent), l'oracle n'est pas robuste.
        const significant = (e: Message): boolean =>
          e.key === "layout.cage.sectionsOverlap" &&
          Number(e.params?.x) >= 1 &&
          Number(e.params?.y) >= 1;
        if (layout.errors?.some(significant)) {
          overlaps++;
          expect(closedSelfIntersection(layout.footprint)).not.toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(computed).toBeGreaterThan(NUM_RUNS / 4);
    expect(overlaps).toBeGreaterThan(0);
  });

  it("pièces convexes du recouvrement : convexes, d'aire positive", () => {
    fc.assert(
      fc.property(cageArb, (spec) => {
        const p = project(spec);
        if (run(p) instanceof LayoutError) return;
        const cage = p.stair.layout as CageLayoutSpec;
        const width = cage.sections[0]!.width;
        const lengths = cage.sections.map((s) => (s.axis as { length: number }).length);
        const frames = buildFrames(lengths, cage.junctions, width);
        const pieces = cagePieces(
          frames,
          cage.junctions.map((j) => junctionGeom(j, width)),
          width,
        );
        for (const piece of pieces) {
          expect(signedArea(piece.polygon)).toBeGreaterThan(GEOM_EPS);
          expect(isConvex(piece.polygon)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("invariance par placement (rotation, translation)", () => {
    fc.assert(
      fc.property(cageArb, placementArb, (spec, placement) => {
        const a = run(project(spec));
        const b = run(project(spec, placement));
        if (a instanceof LayoutError || b instanceof LayoutError) {
          expect(b instanceof LayoutError ? b.msg : b).toEqual(
            a instanceof LayoutError ? a.msg : a,
          );
          return;
        }
        const rad = (placement.rotation * Math.PI) / 180;
        const toWorld = (p: Vec2): Vec2 => V.add(V.rotate(p, rad), V.vec(placement.x, placement.y));
        expect(b.errors).toEqual(a.errors);
        expect(b.notes).toEqual(a.notes);
        expect(curveLength(b.walkline)).toBeCloseTo(curveLength(a.walkline), 6);
        expect(curveLength(b.inner)).toBeCloseTo(curveLength(a.inner), 6);
        expect(curveLength(b.outer)).toBeCloseTo(curveLength(a.outer), 6);
        b.turns.forEach((t, i) => {
          const ta = a.turns[i]!;
          expect(t.sStart).toBeCloseTo(ta.sStart, 6);
          expect(t.sEnd).toBeCloseTo(ta.sEnd, 6);
          expect(t.angle).toBe(ta.angle);
          expect(V.distance(t.innerCorner, toWorld(ta.innerCorner))).toBeLessThan(1e-6);
          expect(V.distance(t.outerCorner, toWorld(ta.outerCorner))).toBeLessThan(1e-6);
        });
        b.sections!.forEach((s, i) => {
          const sa = a.sections![i]!;
          for (const line of ["start", "end"] as const) {
            for (const side of ["left", "right"] as const) {
              expect(V.distance(s[line][side], toWorld(sa[line][side]))).toBeLessThan(1e-6);
            }
          }
        });
        const L = curveLength(a.walkline);
        for (const f of [0, 0.37, 0.81, 1]) {
          expect(
            V.distance(curvePointAt(b.walkline, f * L), toWorld(curvePointAt(a.walkline, f * L))),
          ).toBeLessThan(1e-6);
        }
      }),
      { numRuns: 150 },
    );
  });
});
