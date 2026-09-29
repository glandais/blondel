import { buildModel, createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import type { Model } from "@blondel/core";
import fc from "fast-check";
import {
  distance,
  mainDimensions,
  measureAnnotation,
  pickPoint,
  pickedToMeasure,
  polylineMidpoint,
} from "./annotations.js";

describe("cotes 3D principales", () => {
  it("escalier droit : H = Σh, E = emmarchement, reculement = run", () => {
    const project = createProject("straight");
    const model = buildModel(project);
    const dims = mainDimensions(model);
    expect(dims.map((d) => d.id)).toEqual(["dim-H", "dim-E", "dim-run"]);
    const [H, E, run] = dims;
    expect(H!.points[1]!.z - H!.points[0]!.z).toBeCloseTo(project.site.floorToFloor, 6);
    expect(H!.label).toMatch(/^H = /);
    expect(distance(E!.points[0]!, E!.points[1]!)).toBeCloseTo(project.stair.layout.width, 3);
    let len = 0;
    for (let i = 1; i < run!.points.length; i++)
      len += distance(run!.points[i - 1]!, run!.points[i]!);
    expect(len).toBeCloseTo(model.stepping.run, 3);
  });

  it("mesure : longueur réelle, segment entre les points affichés", () => {
    const a = { shown: { x: 0, y: 0, z: 400 }, real: { x: 0, y: 0, z: 0 } };
    const b = { shown: { x: 300, y: 400, z: 400 }, real: { x: 300, y: 400, z: 0 } };
    expect(measureAnnotation([])).toBeUndefined();
    expect(measureAnnotation([a])?.label).toBe("");
    const m = measureAnnotation([a, b]);
    expect(m?.points).toEqual([a.shown, b.shown]);
    expect(m?.label).toMatch(/^500(,0)? mm$/);
    expect(polylineMidpoint([a.real, b.real])).toEqual({ x: 150, y: 200, z: 0 });
  });
});

describe("cotes et mesure : cas limites", () => {
  it("premier nez balancé (oblique) : l'emmarchement est pris sur le premier nez droit", () => {
    const project = createProject("straight");
    const model = buildModel(project);
    const [n0, ...rest] = model.stepping.nosings;
    // Nez 0 rendu oblique (balancé) : Q décalé le long du bord, Q–R plus long que la largeur.
    const oblique = {
      ...n0!,
      balanced: true,
      q: { x: n0!.q.x + 300 * n0!.dir.y, y: n0!.q.y - 300 * n0!.dir.x },
    };
    const skewed: Model = {
      ...model,
      stepping: { ...model.stepping, nosings: [oblique, ...rest] },
    };
    const E = mainDimensions(skewed).find((d) => d.id === "dim-E")!;
    expect(distance(E.points[0]!, E.points[1]!)).toBeCloseTo(project.stair.layout.width, 3);
    expect(E.points[0]!.z).toBe(rest[0]!.z);
  });

  it("propriété : le point mesuré suit la vue éclatée ; la longueur reste la longueur réelle", () => {
    const v = fc.record({
      x: fc.double({ min: -5000, max: 5000, noNaN: true }),
      y: fc.double({ min: -5000, max: 5000, noNaN: true }),
      z: fc.double({ min: -5000, max: 5000, noNaN: true }),
    });
    fc.assert(
      fc.property(v, v, v, v, v, v, (pa, pb, oa1, ob1, oa2, ob2) => {
        const at = (oa: typeof pa, ob: typeof pa) =>
          new Map([
            ["a", oa],
            ["b", ob],
          ]);
        const add = (p: typeof pa, o: typeof pa) => ({ x: p.x + o.x, y: p.y + o.y, z: p.z + o.z });
        // Clic sous l'éclatement 1 (positions affichées = réelles + décalage).
        const picked = [
          pickPoint("a", add(pa, oa1), at(oa1, ob1)),
          pickPoint("b", add(pb, ob1), at(oa1, ob1)),
        ];
        // Affichage sous l'éclatement 2.
        const shown = picked.map((p) => pickedToMeasure(p, at(oa2, ob2)));
        for (const [p, o, s] of [
          [pa, oa2, shown[0]!],
          [pb, ob2, shown[1]!],
        ] as const) {
          const e = add(p, o);
          expect(
            Math.abs(s.shown.x - e.x) + Math.abs(s.shown.y - e.y) + Math.abs(s.shown.z - e.z),
          ).toBeLessThan(1e-6);
        }
        const len = distance(shown[0]!.real, shown[1]!.real);
        expect(Math.abs(len - distance(pa, pb))).toBeLessThan(1e-6);
      }),
    );
  });
});
