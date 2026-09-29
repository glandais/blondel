import {
  buildModel,
  createProject,
  pointInPolygon,
  vec2,
  withHelicalCore,
  type Model,
  type Project,
  type Vec2,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportPlanDxf } from "../dxf/plan.js";
import { arcFromBulge } from "../path.js";
import { arcToBeziers } from "../pdf/svg-draw.js";
import { soffitIntervals, renderElevationSvg } from "../svg/elevation.js";
import { renderPlanSvg } from "../svg/plan.js";
import { pathData, toPx, type Viewport } from "../svg/svg.js";
import { readDxf } from "../testing/dxf-reader.js";
import { findAll, parseXml } from "../testing/xml.js";
import { buildPlanDrawing } from "./drawing.js";
import { helicalLabelPoint, helicalTurnCount } from "./helical.js";

/** Milieu de l'arc SVG `A` (paramétrage par extrémités) reconstruit selon SVG 1.1 F.6.5. */
function svgArcMid(d: string): Vec2 {
  const m = /^M([-\d.]+) ([-\d.]+)A([-\d.]+) ([-\d.]+) 0 ([01]) ([01]) ([-\d.]+) ([-\d.]+)$/.exec(
    d,
  );
  if (!m) throw new Error(`chemin inattendu : ${d}`);
  const [x1, y1, r, , large, sweep, x2, y2] = m.slice(1).map(Number) as number[];
  const ops = arcToBeziers(x1!, y1!, r!, r!, 0, large === 1, sweep === 1, x2!, y2!);
  // Point de la courbe de Bézier médiane à t = 0,5 (arcs ≤ 90° : une ou deux courbes).
  const mid = ops.length === 1 ? 0 : Math.floor(ops.length / 2);
  const c = ops[mid]!;
  if (c.op !== "C") throw new Error("courbe attendue");
  const prev = mid === 0 ? undefined : ops[mid - 1];
  const start: Vec2 = prev?.op === "C" ? { x: prev.x, y: prev.y } : { x: x1!, y: y1! };
  const t = ops.length === 1 ? 0.5 : 0;
  const b = (p0: number, p1: number, p2: number, p3: number) =>
    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;
  return { x: b(start.x, c.x1, c.x2, c.x), y: b(start.y, c.y1, c.y2, c.y) };
}

describe("arcs exacts du SVG (repère Y inversé)", () => {
  it("propriété : l'arc SVG passe par le milieu de l'arc du monde (sens trigonométrique et horaire)", () => {
    const vp: Viewport = { k: 1, minX: -2000, maxY: 2000, margin: 0 };
    fc.assert(
      fc.property(
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0.2, max: Math.PI - 0.05, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 200, max: 1500, noNaN: true }),
        (start, amount, ccw, radius) => {
          const sweep = ccw ? amount : -amount;
          const a = { x: radius * Math.cos(start), y: radius * Math.sin(start) };
          const b = { x: radius * Math.cos(start + sweep), y: radius * Math.sin(start + sweep) };
          const d = pathData(vp, {
            closed: false,
            vertices: [
              { ...a, bulge: Math.tan(sweep / 4) },
              { ...b, bulge: 0 },
            ],
          });
          const arc = arcFromBulge(a, b, Math.tan(sweep / 4));
          const worldMid = {
            x: arc.center.x + arc.radius * Math.cos(arc.startAngle + sweep / 2),
            y: arc.center.y + arc.radius * Math.sin(arc.startAngle + sweep / 2),
          };
          const expected = toPx(vp, worldMid);
          // Coordonnées arrondies à 0,01 px ; l'arc symétrique passerait à 2 flèches (≥ 2 mm).
          // Près du demi-cercle, le centre reconstruit par SVG amplifie l'arrondi des extrémités
          // (0,206 px mesuré à 175°, r = 700) : marge de 0,5 px, toujours loin des 2 mm.
          expect(vec2.distance(svgArcMid(d), expected)).toBeLessThan(0.5);
        },
      ),
      { numRuns: 200 },
    );
  });
});

function helicalProject(options: Parameters<typeof createProject>[1] = {}): Project {
  return withHelicalCore(createProject("helical", options));
}

/** Altitude de la ligne de pente (nez) à l'abscisse s, extrapolée aux extrémités. */
function slopeAt(m: Model, s: number): number {
  const pts = [...m.stepping.nosings].sort((a, b) => a.s - b.s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (s <= b.s || i + 2 === pts.length) return a.z + ((b.z - a.z) * (s - a.s)) / (b.s - a.s);
  }
  return pts[0]!.z;
}

/** Hélicoïdaux du préréglage : rayons, sens, rotation imposée (projets constructibles seulement). */
const helicalArb = fc
  .record({
    outerRadius: fc.integer({ min: 700, max: 1400 }),
    coreRadius: fc.integer({ min: 50, max: 150 }),
    direction: fc.constantFrom("left" as const, "right" as const),
    count: fc.option(fc.integer({ min: 8, max: 20 }), { nil: undefined }),
    rotation: fc.integer({ min: -180, max: 180 }),
  })
  .map((o) => {
    try {
      const p = createProject("helical", {
        outerRadius: o.outerRadius,
        coreRadius: o.coreRadius,
        direction: o.direction,
        ...(o.count !== undefined
          ? { patch: { stair: { layout: { sweep: { mode: "treadsPerTurn", count: o.count } } } } }
          : {}),
      });
      return {
        ...p,
        stair: { ...p.stair, placement: { origin: { x: 321, y: -123 }, rotation: o.rotation } },
      };
    } catch {
      return null;
    }
  })
  .filter((p): p is Project => p !== null);

describe("plan d'un hélicoïdal", () => {
  it("préréglage : secteurs à arcs exacts, numéros dans leur marche, palier, cotes R et E", () => {
    const project = helicalProject();
    const m = buildModel(project);
    const h = m.layout.helical!;
    const d = buildPlanDrawing(m, { project });
    expect(d.treads).toHaveLength(m.stepping.treads.length);
    for (const t of d.treads) {
      // Deux arcs concentriques (C_e puis C_i) d'un Δθ chacun.
      const bulges = t.surface.vertices.map((v) => v.bulge).filter((b) => b !== 0);
      expect(bulges).toHaveLength(2);
      for (const b of bulges) expect(Math.abs(b)).toBeCloseTo(Math.tan(h.stepAngle / 4), 12);
      const surface = m.stepping.treads.find((x) => x.number === t.number)!.walkingSurface;
      expect(pointInPolygon(t.label, surface)).toBe("inside");
    }
    expect(d.landing).toBeDefined();
    const r = d.dimensions.find((x) => x.role === "radius")!;
    expect(r.value).toBeCloseTo(h.outerRadius, 6);
    expect(r.text).toBe(`R ${h.outerRadius}`);
    expect(d.dimensions.find((x) => x.role === "width")!.value).toBeCloseTo(
      h.outerRadius - h.innerRadius,
      6,
    );
    // Pas de reculement « droit » du premier au dernier collet (ils sont sur le fût).
    expect(d.dimensions.some((x) => x.role === "run")).toBe(false);
    expect(d.cartouche.some((l) => l.startsWith("Hélicoïdal (à gauche) : R_e = 900 mm"))).toBe(
      true,
    );
    expect(d.cartouche.some((l) => l.startsWith("Palier d'arrivée en secteur"))).toBe(true);
  });

  it("propriété : numéros lisibles (un anneau par tour, dans la marche), emprise couvrant les marches", () => {
    fc.assert(
      fc.property(helicalArb, (project) => {
        const m = buildModel(project);
        const h = m.layout.helical!;
        const d = buildPlanDrawing(m, { project });
        const turns = helicalTurnCount(h);
        for (const t of d.treads) {
          const surface = m.stepping.treads.find((x) => x.number === t.number)!.walkingSurface;
          expect(pointInPolygon(t.label, surface)).toBe("inside");
          expect(vec2.distance(t.label, helicalLabelPoint(h, t.number))).toBe(0);
          // Marches superposées en plan (un tour d'écart) : numéros sur des anneaux distincts.
          const above = d.treads.find(
            (u) => Math.abs((u.number - t.number) * h.stepAngle - 2 * Math.PI) < 1e-9,
          );
          if (above && turns > 1) {
            expect(vec2.distance(t.label, above.label)).toBeGreaterThan(1);
          }
          for (const v of t.surface.vertices) {
            expect(v.x).toBeGreaterThanOrEqual(d.bounds.min.x - 1e-6);
            expect(v.y).toBeLessThanOrEqual(d.bounds.max.y + 1e-6);
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  it("SVG et DXF : palier d'arrivée dessiné, marches en arcs (renflements DXF)", () => {
    const project = helicalProject({ direction: "right" });
    const m = buildModel(project);
    const root = parseXml(renderPlanSvg(m, { project }));
    const landing = findAll(root, "path").filter((p) => p.attrs.class === "landing");
    expect(landing).toHaveLength(1);
    const treads = findAll(root, "path").filter((p) => p.attrs["data-tread"] !== undefined);
    expect(treads).toHaveLength(m.stepping.treads.length);
    for (const t of treads) expect(t.attrs.d).toMatch(/A/);
    const dxf = readDxf(exportPlanDxf(m, { project }));
    const onTreads = dxf.entities.flatMap((e) =>
      (e.type === "LWPOLYLINE" || e.type === "POLYLINE") && e.layer === "MARCHES" ? [e] : [],
    );
    // Marches + palier.
    expect(onTreads).toHaveLength(m.stepping.treads.length + 1);
    for (const p of onTreads) expect(p.vertices.some((v) => v.bulge !== 0)).toBe(true);
  });
});

describe("élévation d'un hélicoïdal : plafond formé par l'escalier", () => {
  it("sous-faces dessinées ; l'échappée mesurée est la plus petite hauteur sous elles", () => {
    const project = helicalProject();
    const m = buildModel(project);
    const L = m.stepping.run;
    const iv = soffitIntervals(m, -500, L + 500);
    expect(iv.length).toBeGreaterThan(0);
    let min = Infinity;
    for (const f of iv) {
      expect(f.b).toBeGreaterThan(f.a);
      expect(f.top).toBeGreaterThan(f.bottom);
      min = Math.min(min, f.bottom - slopeAt(m, f.b));
    }
    expect(m.headroom).toBeDefined();
    expect(min).toBeCloseTo(m.headroom!.min, 0);
    const root = parseXml(renderElevationSvg(m, { project }));
    const rects = findAll(root, "rect").filter((r) => r.attrs.class === "soffit");
    expect(rects).toHaveLength(iv.length);
    expect(findAll(root, "text").some((t) => t.text.startsWith("Plafond : sous-faces"))).toBe(true);
  });

  it("escalier à volées : aucune sous-face", () => {
    const project = createProject("quarter-left");
    const m = buildModel(project);
    expect(soffitIntervals(m, -500, m.stepping.run + 500)).toEqual([]);
    const root = parseXml(renderElevationSvg(m, { project }));
    expect(findAll(root, "rect").some((r) => r.attrs.class === "soffit")).toBe(false);
  });
});
