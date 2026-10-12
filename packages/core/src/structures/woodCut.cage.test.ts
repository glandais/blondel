/**
 * Crémaillères (`wood-cut`) sur une cage saisie (ADR-0010, sous-lot 6b) : un tronçon droit, de
 * largeur constante (mêmes pièces que la volée droite équivalente) ou variable (crémaillères
 * sous les bords inclinés d'un trapèze, faces du tracé `StairGeometry.faces`, coupe en biais
 * des dents signalée, domaine FCBA lu sur la plus longue crémaillère). Toute jonction reste
 * refusée : un tournant par le plugin (escalier droit seulement, comme en volées), un palier
 * droit par le garde-fou (`structure.cageUnsupported`, seule la fonction nommée).
 */
import fc from "fast-check";
import { msg, translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { CAGE_FEATURE_LABELS } from "../model/cageFeatures.js";
import type { Model } from "../model/derived.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { area, clipHalfPlane } from "./geom.js";
import { stairGeometry } from "./legs.js";
import { structureCageFeatures } from "./registry.js";
import { WoodCutParamsSchema, buildWoodCut, type CutResult } from "./woodCut.js";

const FR = translatorFor("fr");

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

function project(layout: unknown, params: Record<string, unknown> = {}): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2600, upperSlabThickness: 200 },
    stair: {
      placement: { origin: { x: 0, y: 0 }, rotation: 0 },
      layout,
      structure: { kind: "wood-cut", params },
    },
  });
}

function cut(p: Project): { m: Model; r: CutResult } {
  const m = buildModel(p, { memo: false });
  const r = buildWoodCut(
    { project: p, layout: m.layout, stepping: m.stepping },
    WoodCutParamsSchema.parse(p.stair.structure.params ?? {}),
  );
  return { m, r };
}

const keys = (m: Model): string[] => m.errors.map((e) => e.key);

/** Aire de la marche au-dessus de la crémaillère (bande de son épaisseur en plan). */
function areaOver(m: Model, r: CutResult, mark: string, tread: number): number {
  const c = r.carriages.find((x) => x.part.mark === mark)!;
  const solid = c.part.solid;
  if (solid.kind !== "extrusion") throw new Error("extrusion attendue");
  const o = V.vec(solid.frame.origin.x, solid.frame.origin.y);
  const into = V.vec(solid.frame.zAxis.x, solid.frame.zAxis.y);
  const t = m.stepping.treads.find((x) => x.number === tread)!;
  let poly = clipHalfPlane(t.outline, o, into);
  poly = clipHalfPlane(poly, V.addScaled(o, into, solid.depth), V.scale(into, -1));
  return poly.length >= 3 ? area(poly) : 0;
}

describe("wood-cut sur une cage saisie (sous-lot 6b)", () => {
  it("capacités : largeur variable seulement (un tronçon droit), axe en arc refusé", () => {
    expect(structureCageFeatures("wood-cut")).toEqual(["variableWidth"]);
  });

  it("tronçon droit de largeur constante : mêmes pièces, contrôles et remarques que la volée droite", () => {
    const cage = cut(project({ kind: "cage", sections: [straight(3200)], junctions: [] }));
    const flights = cut(project({ width: 900, legs: [{ length: 3200 }], turns: [] }));
    expect(keys(cage.m)).toEqual([]);
    expect(cage.m.parts).toStrictEqual(flights.m.parts);
    expect(cage.r.output).toStrictEqual(flights.r.output);
  });

  it("trapèze : crémaillères sous les bords inclinés, dents coupées en biais, FCBA sur la plus longue", () => {
    const p = project({ kind: "cage", sections: [straight(3200, 900, 1200)], junctions: [] });
    const { m, r } = cut(p);
    expect(keys(m)).toEqual([]);
    expect(r.carriages.map((c) => c.part.mark)).toEqual(["CI1", "CE1"]);
    const geo = stairGeometry(p, m.layout);
    for (const c of r.carriages) {
      const side = c.part.mark === "CI1" ? "inner" : "outer";
      const face = geo.faces.find((f) => f.side === side)!;
      const solid = c.part.solid;
      if (solid.kind !== "extrusion") throw new Error("extrusion attendue");
      // Crémaillère parallèle au bord de l'emmarchement, épaisseur vers le bord.
      expect(
        Math.abs(V.cross(V.vec(solid.frame.xAxis.x, solid.frame.xAxis.y), face.dir)),
      ).toBeLessThan(1e-12);
      expect(V.dot(V.vec(solid.frame.zAxis.x, solid.frame.zAxis.y), face.into)).toBeCloseTo(1, 12);
    }
    // Au moins un bord incliné : remarque de coupe en biais, angle lisible.
    const skew = r.output.notes.filter((n) => n.key === "structure.woodCut.note.skewTeeth");
    expect(skew.length).toBeGreaterThan(0);
    for (const n of skew) expect(FR.t(n)).toMatch(/incliné de \d+,\d°/);
    // Chaque marche repose sur les deux crémaillères.
    for (const t of m.stepping.treads) {
      expect(areaOver(m, r, "CI1", t.number), `M${t.number}`).toBeGreaterThan(0);
      expect(areaOver(m, r, "CE1", t.number), `M${t.number}`).toBeGreaterThan(0);
    }
  });

  it("domaine FCBA : projection de la plus longue crémaillère (bord incliné), du côté de la sécurité", () => {
    // Ligne de foulée d'environ 3 443 mm (dans le domaine, ≤ 3 456 mm) ; bord droit ancré à
    // gauche, l'autre bord incliné de 600 mm (crémaillère d'environ 3 495 mm, hors domaine).
    const p = project(
      { kind: "cage", sections: [{ ...straight(3440, 900, 1500), anchor: "left" }], junctions: [] },
      { strengthClass: "C30", material: "wood-pine" },
    );
    const { m, r } = cut(p);
    expect(keys(m)).toEqual([]);
    const walk = Math.abs(m.stepping.nosings.at(-1)!.s - m.stepping.nosings[0]!.s);
    expect(walk).toBeLessThan(3456);
    expect(r.fcbaUnusable?.key).toBe("structure.woodCut.fcba.run");
    // Même ligne de foulée à largeur constante : dans le domaine.
    const flat = cut(
      project(
        { kind: "cage", sections: [straight(3440, 900)], junctions: [] },
        { strengthClass: "C30", material: "wood-pine" },
      ),
    );
    expect(flat.r.fcbaUnusable).toBeUndefined();
  });

  it("jonction : tournant refusé par le plugin, palier droit par le garde-fou (seule fonction nommée)", () => {
    const turn = buildModel(
      project({
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 90, mode: "winders" }],
      }),
      { memo: false },
    );
    expect(keys(turn)).toEqual(["structure.woodCut.turningUnsupported"]);
    const landing = buildModel(
      project({
        kind: "cage",
        sections: [straight(1890), straight(1620)],
        junctions: [{ angle: 0, mode: "landing", depth: 1000 }],
      }),
      { memo: false },
    );
    expect(keys(landing)).toEqual(["structure.cageUnsupported"]);
    expect(landing.errors[0]!.params?.reason).toEqual(
      msg("structure.cageUnsupported.features", {
        features: msg(CAGE_FEATURE_LABELS.straightLanding),
      }),
    );
  });

  it("propriété : tronçon droit tiré (largeur variable), jamais d'exception, deux crémaillères qui portent chaque marche", () => {
    const arb = fc.record({
      length: fc.integer({ min: 1500, max: 3400 }),
      width: fc.integer({ min: 800, max: 1200 }),
      widthEnd: fc.option(fc.integer({ min: 800, max: 1200 }), { nil: undefined }),
      anchor: fc.constantFrom(undefined, "left" as const, "right" as const, "center" as const),
    });
    let built = 0;
    fc.assert(
      fc.property(arb, (a) => {
        const p = project({
          kind: "cage",
          sections: [
            {
              ...straight(a.length, a.width, a.widthEnd),
              ...(a.anchor ? { anchor: a.anchor } : {}),
            },
          ],
          junctions: [],
        });
        let res!: { m: Model; r: CutResult };
        expect(() => (res = cut(p))).not.toThrow();
        const { m, r } = res;
        expect(keys(m)).not.toContain("structure.cageUnsupported");
        if (m.stepping.treads.length === 0) return;
        built++;
        expect(keys(m)).toEqual([]);
        expect(r.carriages.map((c) => c.part.mark)).toEqual(["CI1", "CE1"]);
        for (const c of r.carriages) {
          expect(c.part.stock!.length).toBeGreaterThan(0);
          expect(area(c.outline)).toBeGreaterThan(0);
          expect(c.residual).toBeGreaterThan(0);
        }
        // Assemblages : chaque crémaillère porte chaque marche, et la marche repose sur elle.
        const assemblies = r.output.assemblies ?? [];
        for (const t of m.stepping.treads) {
          for (const mark of ["CI1", "CE1"]) {
            const id = r.carriages.find((c) => c.part.mark === mark)!.part.id;
            expect(
              assemblies.some(
                (x) =>
                  "partId" in x.a &&
                  x.a.partId === id &&
                  "treadNumber" in x.b &&
                  x.b.treadNumber === t.number,
              ),
            ).toBe(true);
            expect(areaOver(m, r, mark, t.number), `${mark} M${t.number}`).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 80, seed: 9 },
    );
    expect(built).toBeGreaterThan(40);
  });
});
