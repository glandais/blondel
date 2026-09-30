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
import { CheckCollector } from "./checks.js";
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

  it("justification fournie : l'avertissement reste, justification jointe (A12)", () => {
    const { output } = buildHelicalCore(
      context(helical()),
      params({ cantileverJustification: "Note de calcul NC-042" }),
    );
    const c = output.checks.find((r) => r.ruleId === "HELICOIDAL_PORTE_A_FAUX")!;
    // Décision A12 (2026-09-30) : une justification n'est pas une vérification.
    expect(c.status).toBe("violation");
    expect(c.severity).toBe("avertissement");
    expect(c.message).not.toMatch(/Justification requise/);
    expect(c.message).toContain("NC-042");
    // Justification portée par le résultat (reprise dans le dossier PDF, décision A12).
    expect(c.justification).toBe("Note de calcul NC-042");
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

  it("tracé à volées : erreur explicite, aucune pièce", () => {
    const straight = createProject("straight");
    const out = buildHelicalCore(context(straight), params()).output;
    expect(out.parts).toEqual([]);
    expect(out.errors![0]).toMatch(/hélicoïdaux/);
  });

  describe("hélicoïdal à jour central (limons hélicoïdaux intérieur et extérieur)", () => {
    const well = (over: Partial<Parameters<typeof makeHelicalProject>[0]> = {}) =>
      makeHelicalProject({
        outerRadius: 1000,
        coreRadius: 200,
        core: "well",
        direction: "left",
        floorToFloor: 2700,
        ...over,
      });

    it("pas de fût ; limons LI1 (face r_j, plat vers l'axe) et LE1 (face R_e) ; pas de porte-à-faux", () => {
      const ctx = context(well());
      const res = buildHelicalCore(ctx, HELICAL_CORE.defaults(ctx));
      expect(res.output.errors ?? []).toEqual([]);
      const ids = res.output.parts.map((p) => p.id);
      expect(ids).not.toContain("helical-column");
      expect(ids).toContain("helical-stringer-inner");
      expect(ids).toContain("helical-stringer");
      const e = 8;
      expect(res.innerStringer!.neutralRadius).toBeCloseTo(200 - e / 2, 9);
      expect(res.stringer!.neutralRadius).toBeCloseTo(1000 + e / 2, 9);
      // Développé en bande : même montée par radian, pente b / r_n (plus raide à l'intérieur).
      const h = ctx.layout.helical!;
      const rise = ctx.stepping.nosings.at(-1)!.z - ctx.stepping.nosings[0]!.z;
      const b = rise / h.totalAngle;
      expect(res.innerStringer!.slope).toBeCloseTo(b / (200 - e / 2), 9);
      expect(res.innerStringer!.span).toBeCloseTo((200 - e / 2) * h.totalAngle, 6);
      expect(res.innerStringer!.edgeLength).toBeCloseTo(
        h.totalAngle * Math.hypot(200 - e / 2, b),
        6,
      );
      // Solide : épaississement vers l'axe pour LI1, vers l'extérieur pour LE1.
      const li = res.output.parts.find((p) => p.id === "helical-stringer-inner")!;
      const le = res.output.parts.find((p) => p.id === "helical-stringer")!;
      if (li.solid.kind !== "ruled" || le.solid.kind !== "ruled") throw new Error("ruled");
      const radial = (solid: typeof li.solid, i: number) => {
        const p = solid.a[i]!;
        const d = V.sub({ x: p.x, y: p.y }, h.center);
        return V.dot(solid.normals[i]!, V.scale(d, 1 / V.norm(d)));
      };
      for (let i = 0; i < li.solid.a.length; i += 7) {
        expect(radial(li.solid, i)).toBeCloseTo(-1, 9);
        expect(radial(le.solid, i)).toBeCloseTo(1, 9);
        const p = li.solid.a[i]!;
        expect(V.distance({ x: p.x, y: p.y }, h.center)).toBeCloseTo(200, 6);
      }
      expect(li.flat?.reference?.kind).toBe("neutral-fiber");
      expect(li.section).toMatch(/roulé R 192/);
      // Marches portées des deux côtés : pas de contrôle de porte-à-faux.
      expect(res.output.checks.some((c) => c.ruleId === "HELICOIDAL_PORTE_A_FAUX")).toBe(false);
      // Rouleuse contrôlée sur les deux limons.
      const roll = res.output.checks.filter((c) => c.ruleId === "FAB_ROULAGE_LIMON");
      expect(roll.map((c) => c.location)).toEqual(
        expect.arrayContaining([
          { kind: "part", partId: "helical-stringer-inner" },
          { kind: "part", partId: "helical-stringer" },
        ]),
      );
    });

    it("limon extérieur désactivé : porte-à-faux sur le limon intérieur, justification requise", () => {
      const ctx = context(well());
      const res = buildHelicalCore(ctx, params({ outerStringer: { enabled: false } }));
      const cant = res.output.checks.filter((c) => c.ruleId === "HELICOIDAL_PORTE_A_FAUX");
      expect(cant).toHaveLength(1);
      expect(cant[0]!.status).toBe("violation");
      expect(cant[0]!.message).toMatch(/limon intérieur/);
    });

    it("jour plus étroit que l'épaisseur du limon : erreur explicite", () => {
      const ctx = context(well({ coreRadius: 60 }));
      const out = buildHelicalCore(ctx, params({ innerStringer: { thickness: 60 } })).output;
      expect(out.parts).toEqual([]);
      expect(out.errors![0]).toMatch(/limon intérieur/);
    });

    it("pipeline : jour central, modèle complet sans erreur (défauts du plugin)", () => {
      const m = buildModel(withHelicalCore(well()));
      expect(m.errors).toEqual([]);
      expect(m.parts.filter((p) => p.category === "stringer").map((p) => p.mark)).toEqual([
        "LI1",
        "LE1",
      ]);
    });

    it("propriété : limon intérieur, bande développée exacte pour r_j, e, N quelconques", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 150, max: 500 }),
          fc.integer({ min: 4, max: 12 }),
          fc.integer({ min: 10, max: 20 }),
          (rj, e, n) => {
            const ctx = context(well({ coreRadius: rj, treadsPerTurn: n }));
            const res = buildHelicalCore(ctx, params({ innerStringer: { thickness: e } }));
            expect(res.output.errors ?? []).toEqual([]);
            const dev = res.innerStringer!;
            const h = ctx.layout.helical!;
            expect(dev.neutralRadius).toBeCloseTo(rj - e / 2, 9);
            expect(dev.span).toBeCloseTo((rj - e / 2) * h.totalAngle, 6);
            expect(Math.abs(signedArea(dev.outline))).toBeGreaterThan(0);
            for (const p of dev.outline) expect(p.y).toBeGreaterThanOrEqual(-1e-9);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  it("marches en tôle (décision A11) : contremarches bois retirées, VIDE_ENTRE_MARCHES évalué", () => {
    const project = helical();
    expect(project.stair.treads.risers).toBe("full");
    // Marches bois : contremarches de base conservées, règle sans objet.
    const wood = buildModel(withHelicalCore(project), { memo: false });
    expect(wood.parts.some((p) => p.category === "riser")).toBe(true);
    const woodGap = wood.compliance.results.filter((r) => r.ruleId === "VIDE_ENTRE_MARCHES");
    expect(woodGap.every((r) => r.status === "ok" && r.measured === undefined)).toBe(true);
    // Marches en tôle : plus aucune contremarche, vide h − t_tôle contrôlé marche par marche.
    const t = 8;
    const m = buildModel(
      withHelicalCore(project, { treads: { material: "steel", plateThickness: t } }),
      { memo: false },
    );
    expect(m.errors).toEqual([]);
    expect(m.parts.filter((p) => p.category === "riser")).toEqual([]);
    const gaps = m.compliance.results.filter((r) => r.ruleId === "VIDE_ENTRE_MARCHES");
    expect(gaps).toHaveLength(m.stepping.rises.length - 1);
    for (const g of gaps) {
      expect(g.status).toBe("violation");
      expect(g.measured).toBeCloseTo(m.stepping.rises[1]! - t, 6);
      expect(g.message).toMatch(/^Marches en tôle de 8 mm sans contremarche/);
    }
    // Débord de nez : sans objet sans contremarche (évalué par le plugin, pas par le moteur).
    const nose = m.compliance.results.filter((r) => r.ruleId.startsWith("DEBORD_NEZ_"));
    expect(nose.length).toBeGreaterThan(0);
    for (const r of nose) expect(r.message).toMatch(/Sans objet/);
    expect((m.notes ?? []).some((n) => /contremarche\(s\) bois de base supprimée/.test(n))).toBe(
      true,
    );
  });

  it("relecture : contextes des contrôles du plugin = ceux du moteur (helicoidal_fut)", () => {
    // Le plugin réévalue des règles de rules.yaml (décision A11) : ses contextes actifs doivent
    // être ceux du moteur, y compris le contexte déduit du fût central (QUESTIONS A5).
    const project = withHelicalCore(helical());
    expect(project.stair.layout.kind === "helical" && project.stair.layout.core.kind).toBe(
      "column",
    );
    const { stepping } = context(project);
    const checks = new CheckCollector(project, stepping);
    expect(checks.activeContexts.has("helicoidal_fut")).toBe(true);
    expect(checks.yamlRule("G_COLLET_MIN")).toBeNull();
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

describe("plugins réservés aux escaliers à volées, sur un tracé hélicoïdal", () => {
  it.each(["wood-housed", "wood-cut", "steel-flat", "steel-profile", "steel-curved"])(
    "%s : erreur « réservée aux escaliers à volées », aucune pièce",
    (kind) => {
      const p = createProject("helical");
      const m = buildModel({ ...p, stair: { ...p.stair, structure: { kind, params: {} } } });
      const errors = m.errors.filter((e) => e.includes(kind));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/réservée aux escaliers à volées/);
      expect(errors[0]).toMatch(/helical-core/);
      expect(m.errors.some((e) => /segment droit par volée|Tracé inattendu/.test(e))).toBe(false);
      // Pièces de base seulement (marches, contremarches, palier) : aucune pièce du plugin.
      expect(m.parts.every((x) => ["tread", "riser", "landing"].includes(x.category))).toBe(true);
    },
  );
});
