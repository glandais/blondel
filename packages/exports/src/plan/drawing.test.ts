import { pointInPolygon, vec2, type Model, type Vec2 } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layoutArb } from "../testing/arbitraries.js";
import { layoutModel, layoutProject, sampleProject, straightModel } from "../testing/fixtures.js";
import { buildPlanDrawing, dimensionGeometry } from "./drawing.js";

/** Milieu de la ligne de cote (après décalage). */
function dimLineMid(d: ReturnType<typeof buildPlanDrawing>["dimensions"][number]): Vec2 {
  return vec2.addScaled(vec2.lerp(d.a, d.b, 0.5), d.normal, d.offset);
}

/** Emmarchement de conception : largeur de la ligne de départ du tracé. */
function departureWidth(m: Model): number {
  const a = m.layout.inner.segments[0]!;
  const b = m.layout.outer.segments[0]!;
  const pa = a.kind === "line" ? a.a : a.center;
  const pb = b.kind === "line" ? b.a : b.center;
  return vec2.distance(pa, pb);
}

function checkDrawing(m: Model): void {
  const d = buildPlanDrawing(m);
  const fp = m.layout.footprint;
  // Numéros de marche dans leur marche.
  for (const t of d.treads) {
    const surface = m.stepping.treads.find((x) => x.number === t.number)!.walkingSurface;
    expect(pointInPolygon(t.label, surface)).toBe("inside");
  }
  for (const dim of d.dimensions) {
    const mid = dimLineMid(dim);
    if (dim.role === "going") {
      // Giron coté dans l'escalier, entre le jour et la ligne de foulée.
      expect(pointInPolygon(mid, fp)).toBe("inside");
    } else {
      // Emmarchement, volées, reculement : hors de l'emprise (lisibles).
      expect(pointInPolygon(mid, fp)).toBe("outside");
    }
  }
  // Emmarchement E = largeur de la ligne de départ, même si le premier nez est balancé.
  const w = d.dimensions.find((x) => x.role === "width")!;
  expect(Math.abs(w.value - departureWidth(m))).toBeLessThan(1e-6);
  expect(d.cartouche.some((l) => l.startsWith("Emmarchement E = "))).toBe(true);
  // Flèche de montée : pointe à l'arrivée de la ligne de foulée, orientée vers l'arrivée.
  const tip = d.arrow.vertices[0]!;
  const end = d.walkline.vertices[d.walkline.vertices.length - 1]!;
  expect(vec2.distance(tip, end)).toBeLessThan(1e-9);
}

describe("buildPlanDrawing sur des tracés réels (computeLayout)", () => {
  it("quart tournant à droite, jour en arc, placement tourné", () => {
    const m = layoutModel(
      layoutProject({
        width: 900,
        legs: [2600, 2400],
        direction: "right",
        inner: { kind: "arc", radius: 150 },
        origin: { x: 1234, y: -567 },
        rotation: 37,
      }),
      { riserCount: 17 },
    );
    expect(m.layout.innerSide).toBe("right");
    checkDrawing(m);
    // Contour à arc exact : le jour en arc garde un renflement non nul.
    const d = buildPlanDrawing(m);
    expect(d.contour.vertices.some((v) => v.bulge !== 0)).toBe(true);
  });

  it("quart tournant bas : premier nez balancé, E reste la largeur de départ", () => {
    // Zone balancée « libre » au départ (M3, CHALLENGE G3) : le nez 0 est incliné, |q₀r₀| > E.
    const base = layoutModel(layoutProject({ width: 900, legs: [1500, 3200] }), {
      riserCount: 16,
    });
    const n0 = base.stepping.nosings[0]!;
    const q = { x: 0, y: 150 };
    const tilted = { ...n0, q, dir: vec2.normalize(vec2.sub(n0.r, q)), balanced: true };
    const m: Model = {
      ...base,
      stepping: { ...base.stepping, nosings: [tilted, ...base.stepping.nosings.slice(1)] },
    };
    expect(vec2.distance(tilted.q, tilted.r)).toBeGreaterThan(910);
    checkDrawing(m);
    const d = buildPlanDrawing(m);
    expect(d.cartouche).toContain("Emmarchement E = 900 mm");
  });

  it("droit tourné : reculement et volée hors de l'emprise", () => {
    const m = layoutModel(layoutProject({ width: 800, legs: [3600], rotation: 180 }), {
      riserCount: 15,
    });
    checkDrawing(m);
  });

  it("propriété : cotes lisibles, numéros dans les marches, E exact", () => {
    fc.assert(
      fc.property(layoutArb, (m) => checkDrawing(m)),
      { numRuns: 80 },
    );
  });

  it("géométrie de cote : lignes d'attache du côté du décalage", () => {
    const m = layoutModel(layoutProject({ width: 900, legs: [3000] }), { riserCount: 14 });
    const d = buildPlanDrawing(m);
    for (const dim of d.dimensions) {
      const g = dimensionGeometry(dim, d.textHeight);
      for (const [p, q] of g.extensions) {
        const side = vec2.dot(vec2.sub(q, p), dim.normal);
        expect(Math.sign(side)).toBe(Math.sign(dim.offset));
      }
    }
  });
});

describe("buildPlanDrawing : trémie du modèle (QUESTIONS D5)", () => {
  it("trémie lue dans Model.upperFloor sans option project, projet en repli", () => {
    const m = straightModel({});
    const opening = [
      { x: 0, y: 1000 },
      { x: 900, y: 1000 },
      { x: 900, y: 3000 },
      { x: 0, y: 3000 },
    ];
    expect(buildPlanDrawing(m).opening).toBeUndefined();
    const withFloor = buildPlanDrawing({ ...m, upperFloor: { slabThickness: 200, opening } });
    expect(withFloor.opening).toBeDefined();
    const fromProject = buildPlanDrawing(m, { project: sampleProject() });
    expect(fromProject.opening).toBeDefined();
    // Modèle sans trémie : le projet n'est pas relu (le modèle fait foi).
    expect(
      buildPlanDrawing({ ...m, upperFloor: { slabThickness: 200 } }, { project: sampleProject() })
        .opening,
    ).toBeUndefined();
  });
});
