import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { makeHelicalProject } from "../layout/helical-test-helpers.js";
import { computeLayout } from "../layout/layout.js";
import type { StructureContext } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { buildBasicParts } from "../parts/basic.js";
import { buildModel } from "../pipeline/build.js";
import { createProject } from "../project/presets.js";
import { computeStepping } from "../stepping/stepping.js";
import {
  buildHelicalCore,
  developHelicalStringer,
  HELICAL_CORE,
  HelicalCoreParamsSchema,
  withHelicalCore,
} from "./helicalCore.js";
import { minAreaRect } from "./geom.js";
import { getStructure } from "./index.js";

function context(project: Project): StructureContext {
  const layout = computeLayout(project);
  const stepping = computeStepping(project, layout);
  return {
    project,
    layout,
    stepping,
    baseParts: buildBasicParts(project, layout, stepping).parts,
  };
}

const params = (p: Record<string, unknown> = {}) => HelicalCoreParamsSchema.parse(p);

describe("développé du limon hélicoïdal (B §4.3)", () => {
  it("propriété : bande rectiligne, rive = hypoténuse √((r_n·Θ)² + (b·Θ)²)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 2000 }),
        fc.integer({ min: 4, max: 15 }),
        fc.double({ min: 0.5, max: 4 * Math.PI, noNaN: true }),
        fc.double({ min: 20, max: 400, noNaN: true }),
        fc.integer({ min: 150, max: 400 }),
        (radius, thickness, total, b, height) => {
          const dev = developHelicalStringer({
            innerRadius: radius,
            thickness,
            totalAngle: total,
            risePerRadian: b,
            topStart: 1000,
            height,
            floor: null,
          });
          const rn = radius + thickness / 2;
          expect(dev.neutralRadius).toBe(rn);
          expect(dev.span).toBeCloseTo(rn * total, 9);
          // Longueur de la rive développée = longueur de l'hélice 3D de rayon r_n.
          expect(dev.edgeLength).toBeCloseTo(Math.hypot(rn * total, b * total), 6);
          expect(dev.edgeLength).toBeCloseTo(total * Math.sqrt(rn * rn + b * b), 6);
          // Parallélogramme : rives parallèles de pente b / r_n, aire = hauteur × longueur σ.
          expect(dev.slope).toBeCloseTo(b / rn, 12);
          expect(Math.abs(signedArea(dev.outline))).toBeCloseTo(height * dev.span, 3);
          const [p0, p1, p2, p3] = dev.outline;
          const edges = [V.sub(p1!, p0!), V.sub(p2!, p1!), V.sub(p3!, p2!), V.sub(p0!, p3!)];
          const slanted = edges.filter((e) => Math.abs(e.x) > 1e-9);
          expect(slanted).toHaveLength(2);
          for (const e of slanted) {
            expect(e.y / e.x).toBeCloseTo(b / rn, 9);
            expect(V.norm(e)).toBeCloseTo(dev.edgeLength, 6);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("coupe au sol : aucun point sous z = 0", () => {
    const dev = developHelicalStringer({
      innerRadius: 900,
      thickness: 8,
      totalAngle: 7,
      risePerRadian: 350,
      topStart: 230,
      height: 250,
      floor: 0,
    });
    expect(Math.min(...dev.outline.map((p) => p.y))).toBeCloseTo(0, 9);
    expect(dev.outline.length).toBe(5);
  });
});

describe("plugin helical-core", () => {
  const helical = () => createProject("helical");

  it("est enregistré", () => {
    expect(getStructure("helical-core")).toBe(HELICAL_CORE);
  });

  it("fût tube acier, marches bois conservées, palier, main courante, porte-à-faux à justifier", () => {
    const ctx = context(helical());
    const { output, stringer } = buildHelicalCore(ctx, params());
    expect(stringer).toBeUndefined();
    expect(output.errors).toBeUndefined();
    const ids = output.parts.map((p) => p.id);
    expect(ids).toEqual(["helical-column", "landing-arrival", "helical-handrail"]);
    const column = output.parts[0]!;
    expect(column.material).toBe("steel-painted");
    expect(column.stock!.length).toBe(ctx.project.site.floorToFloor);
    expect(column.solid.kind === "extrusion" && column.solid.profile.holes.length).toBe(1);
    const cantilever = output.checks.find((c) => c.ruleId === "HELICOIDAL_PORTE_A_FAUX")!;
    expect(cantilever.status).toBe("violation");
    expect(cantilever.severity).toBe("avertissement");
    expect(cantilever.message).toMatch(/Justification requise/);
    expect(output.executionClass).toBe("EXC1");
  });

  it("justification fournie : contrôle conforme", () => {
    const { output } = buildHelicalCore(
      context(helical()),
      params({ cantileverJustification: "Note de calcul NC-042" }),
    );
    const c = output.checks.find((r) => r.ruleId === "HELICOIDAL_PORTE_A_FAUX")!;
    expect(c.status).toBe("ok");
    expect(c.message).toContain("NC-042");
  });

  it("main courante : hélice à la hauteur réglée au-dessus de la ligne des nez", () => {
    const ctx = context(helical());
    const h = ctx.layout.helical!;
    const { output } = buildHelicalCore(ctx, params({ handrail: { height: 900 } }));
    const rail = output.parts.find((p) => p.id === "helical-handrail")!;
    if (rail.solid.kind !== "sweep") throw new Error("balayage attendu");
    const first = rail.solid.path[0]!;
    const last = rail.solid.path[rail.solid.path.length - 1]!;
    expect(V.distance(first, h.center)).toBeCloseTo(h.outerRadius, 6);
    expect(first.z).toBeCloseTo(ctx.stepping.nosings[0]!.z + 900, 9);
    expect(last.z).toBeCloseTo(ctx.project.site.floorToFloor + 900, 9);
    const b = (last.z - first.z) / h.totalAngle;
    expect(rail.quantities["length_mm"]).toBeCloseTo(
      h.totalAngle * Math.hypot(h.outerRadius, b),
      6,
    );
  });

  it("limon extérieur : développé en fibre neutre, longueur de rive = hélice 3D", () => {
    const ctx = context(helical());
    const h = ctx.layout.helical!;
    const { output, stringer } = buildHelicalCore(
      ctx,
      params({ outerStringer: { enabled: true } }),
    );
    const part = output.parts.find((p) => p.id === "helical-stringer")!;
    expect(part.flat!.reference!.kind).toBe("neutral-fiber");
    expect(part.solid.kind).toBe("ruled");
    const rn = h.outerRadius + 4;
    const n = ctx.stepping.nosings;
    const b = (n[n.length - 1]!.z - n[0]!.z) / h.totalAngle;
    expect(stringer!.edgeLength).toBeCloseTo(h.totalAngle * Math.sqrt(rn * rn + b * b), 6);
    expect(part.quantities["length_mm"]).toBeCloseTo(stringer!.edgeLength, 9);
    // Un trait de traçage par marche, une génératrice de roulage par nez.
    expect(part.flat!.lines.filter((l) => l.kind === "mark")).toHaveLength(n.length - 1);
    expect(part.flat!.lines.filter((l) => l.kind === "roll")).toHaveLength(n.length);
    expect(output.checks.some((c) => c.ruleId === "FAB_ROULAGE_LIMON" && c.status === "ok")).toBe(
      true,
    );
  });

  it("limon : traits de marche à l'épaisseur réelle (tôle ou bois) sous chaque nez", () => {
    const ctx = context(helical());
    const n = ctx.stepping.nosings;
    for (const [treads, t] of [
      [{ material: "steel" as const, plateThickness: 8 }, 8],
      [{ material: "wood" as const }, ctx.project.stair.treads.thickness],
    ] as const) {
      const { output } = buildHelicalCore(
        ctx,
        params({ outerStringer: { enabled: true }, treads }),
      );
      const marks = output.parts
        .find((p) => p.id === "helical-stringer")!
        .flat!.lines.filter((l) => l.kind === "mark");
      marks.forEach((m, k) => {
        expect(m.b.y).toBeCloseTo(n[k]!.z, 9);
        expect(m.b.y - m.a.y).toBeCloseTo(t, 9);
      });
    }
  });

  it("marches en tôle : pièces `tread-N` remplacées, développé = contour", () => {
    const ctx = context(helical());
    const { output } = buildHelicalCore(ctx, params({ treads: { material: "steel" } }));
    const treads = output.parts.filter((p) => p.category === "tread");
    expect(treads.map((p) => p.id)).toEqual(ctx.stepping.treads.map((t) => `tread-${t.number}`));
    const h = ctx.layout.helical!;
    for (const t of treads) {
      expect(t.material).toBe("steel-painted");
      const outline = t.flat!.outline.outer;
      expect(Math.abs(signedArea(outline))).toBeGreaterThan(0);
      // Débit : rectangle orienté minimal qui contient la tôle, débord de nez compris
      // (relecture : R_e − r_f × R_e·Δθ ne contenait pas la tôle réelle).
      const stock = t.stock!;
      expect(stock.length * stock.width).toBeGreaterThanOrEqual(Math.abs(signedArea(outline)));
      expect(stock.length).toBeGreaterThan(h.outerRadius - h.innerRadius);
      const box = minAreaRect(outline);
      expect(stock.width).toBeCloseTo(box.width, 9);
    }
    const landing = output.parts.find((p) => p.id === "landing-arrival")!;
    expect(landing.stock!.length * landing.stock!.width).toBeGreaterThanOrEqual(
      Math.abs(signedArea(landing.flat!.outline.outer)),
    );
  });

  it("tracé à jour central ou à volées : erreur explicite, aucune pièce", () => {
    const well = makeHelicalProject({
      outerRadius: 1000,
      coreRadius: 200,
      core: "well",
      direction: "left",
      floorToFloor: 2700,
    });
    expect(buildHelicalCore(context(well), params()).output.errors![0]).toMatch(/fût central/);
    const straight = createProject("straight");
    const out = buildHelicalCore(context(straight), params()).output;
    expect(out.parts).toEqual([]);
    expect(out.errors![0]).toMatch(/hélicoïdaux/);
  });

  it("pipeline : modèle complet, erreurs du plugin reportées", () => {
    const m = buildModel(withHelicalCore(helical(), { treads: { material: "steel" } }));
    expect(m.errors).toEqual([]);
    expect(m.executionClass).toBe("EXC1");
    expect(m.parts.some((p) => p.id === "helical-column")).toBe(true);
    const bad = buildModel(withHelicalCore(createProject("straight")));
    expect(bad.errors.some((e) => e.includes("helical-core"))).toBe(true);
  });
});
