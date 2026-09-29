/**
 * K3 par angle (`cornerMonotonyBreaks`, `cornerPositions`) : une zone unique de 180° contourne
 * deux angles du jour, ses collets forment deux vallées séparées par une crête.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cornerMonotonyBreaks, cornerPositions, monotonyBreaks } from "../balancing/postprocess.js";
import { computeLayout } from "../layout/layout.js";
import { buildModel } from "../pipeline/build.js";
import { createProject } from "../project/presets.js";
import { computeStepping } from "./stepping.js";

describe("cornerMonotonyBreaks", () => {
  it("deux vallées autour de deux angles : aucune rupture (une seule vallée : rupture)", () => {
    // Préréglage demi-tournant, H = 2 550 (collets en corde mesurés avant correction).
    const c = [209, 151, 132, 124, 110, 124, 108, 151, 209];
    expect(monotonyBreaks(c)).toEqual([4]);
    expect(cornerMonotonyBreaks(c, [4, 6])).toEqual([]);
  });

  it("crête hors de l'intervalle entre les angles : rupture signalée", () => {
    // Troisième vallée (marche 2) avant le premier angle.
    const c = [200, 120, 150, 110, 130, 100, 200];
    expect(cornerMonotonyBreaks(c, [3, 5])).toEqual([1]);
  });

  it("au plus un angle : identique à monotonyBreaks", () => {
    const c = [200, 150, 90, 120, 110];
    expect(cornerMonotonyBreaks(c, [2])).toEqual(monotonyBreaks(c));
    expect(cornerMonotonyBreaks(c, [])).toEqual(monotonyBreaks(c));
    expect(cornerMonotonyBreaks(c, [2, 2])).toEqual(monotonyBreaks(c));
  });

  it("propriété : k vallées construites autour de k angles ne sont jamais rompues", () => {
    const valley = fc
      .tuple(
        fc.array(fc.double({ min: 0, max: 50, noNaN: true }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.double({ min: 0, max: 50, noNaN: true }), { minLength: 1, maxLength: 5 }),
        fc.double({ min: 20, max: 150, noNaN: true }),
      )
      .map(([down, up, bottom]) => {
        // Descente vers `bottom` puis remontée (sommes partielles de pas positifs).
        const left = down.map((_, i) => bottom + down.slice(i).reduce((a, b) => a + b, 0));
        const right = up.map((_, i) => bottom + up.slice(0, i + 1).reduce((a, b) => a + b, 0));
        return { values: [...left, bottom, ...right], min: left.length };
      });
    fc.assert(
      fc.property(fc.array(valley, { minLength: 1, maxLength: 3 }), (valleys) => {
        const values: number[] = [];
        const corners: number[] = [];
        for (const v of valleys) {
          corners.push(values.length + v.min);
          values.push(...v.values);
        }
        expect(cornerMonotonyBreaks(values, corners)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it("propriété : les ruptures par angle sont un sous-ensemble des pas de la suite", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 300, noNaN: true }), { minLength: 2, maxLength: 20 }),
        fc.array(fc.nat({ max: 19 }), { maxLength: 3 }),
        (values, corners) => {
          const b = cornerMonotonyBreaks(values, corners);
          for (const i of b) {
            expect(i).toBeGreaterThanOrEqual(0);
            expect(i).toBeLessThan(values.length - 1);
          }
          expect([...b].sort((x, y) => x - y)).toEqual(b);
          expect(new Set(b).size).toBe(b.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("cornerPositions", () => {
  it("marche au droit du milieu de chaque tournant, angles hors tronçon ignorés", () => {
    const s = [0, 100, 200, 300, 400];
    expect(cornerPositions(s, [150, 399, 500, -1])).toEqual([1, 3]);
    expect(cornerPositions(s, [400])).toEqual([3]);
    expect(cornerPositions([0], [0])).toEqual([]);
  });
});

describe("K3 par angle sur les préréglages demi-tournant et U", () => {
  const heights: number[] = [];
  for (let h = 2500; h <= 2900; h += 25) heights.push(h);

  it.each(["half-turn", "two-quarters-u"] as const)(
    "%s, H ∈ [2 500 ; 2 900] : aucune rupture K3 signalée par le découpage",
    (preset) => {
      for (const floorToFloor of heights) {
        for (const direction of ["left", "right"] as const) {
          const p = createProject(preset, { floorToFloor, direction });
          const st = computeStepping(p, computeLayout(p));
          const k3 = st.notes.filter((n) => n.startsWith("K3 :"));
          expect(k3, `${preset} H=${floorToFloor} ${direction}`).toEqual([]);
        }
      }
    },
  );
});

describe("G_COLLET_MONOTONE (contrôle de conception) sur les préréglages demi-tournant et U", () => {
  it.each(["half-turn", "two-quarters-u"] as const)(
    "%s, H ∈ [2 500 ; 2 900], deux sens : conforme, angles du jour comptés",
    (preset) => {
      for (let floorToFloor = 2500; floorToFloor <= 2900; floorToFloor += 50) {
        for (const direction of ["left", "right"] as const) {
          const m = buildModel(createProject(preset, { floorToFloor, direction }));
          const r = m.compliance.results.filter((x) => x.ruleId === "G_COLLET_MONOTONE");
          const tag = `${preset} H=${floorToFloor} ${direction}`;
          expect(
            r.map((x) => x.status),
            tag,
          ).toEqual(["ok"]);
          // Deux tournants : deux angles du jour, quelle que soit la découpe en zones (une
          // marche isolée entre deux zones n'ajoute pas d'angle).
          expect(r[0]!.message, tag).toContain("(2 angle(s) du jour)");
        }
      }
    },
  );
});
