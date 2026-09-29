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
import { readFileSync } from "node:fs";
import * as V from "../geom2d/vec.js";
import { parseProjectText } from "../project/parse.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { computeStepping } from "./stepping.js";
import { postNosing } from "./zones.js";

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

describe("poteaux d'angle : zones par angle (G_COLLET_MONOTONE corrigé par le balancement)", () => {
  const withNewels = (p: Project, size = 100): Project => {
    const layout = p.stair.layout;
    if (layout.kind === "helical") throw new Error("tracé à volées attendu");
    return ProjectSchema.parse({
      ...p,
      stair: {
        ...p.stair,
        layout: {
          ...layout,
          turns: layout.turns.map((t) => ({ ...t, inner: { kind: "newel", size } })),
        },
      },
    });
  };

  it("U à deux poteaux, H ∈ [2 500 ; 2 900], deux sens : collets monotones et ≥ 100 mm", () => {
    for (let floorToFloor = 2500; floorToFloor <= 2900; floorToFloor += 50) {
      for (const direction of ["left", "right"] as const) {
        const tag = `H=${floorToFloor} ${direction}`;
        const m = buildModel(
          withNewels(createProject("two-quarters-u", { floorToFloor, direction })),
        );
        const r = m.compliance.results.filter((x) => x.ruleId === "G_COLLET_MONOTONE");
        expect(
          r.filter((x) => x.status === "violation").map((x) => x.message),
          tag,
        ).toEqual([]);
        const winders = m.stepping.treads.filter((t) => t.kind === "winder");
        expect(Math.min(...winders.map((t) => t.colletChord)), tag).toBeGreaterThanOrEqual(
          100 - 1e-6,
        );
        expect(
          m.stepping.notes.filter((n) => n.startsWith("K3 :")),
          tag,
        ).toEqual([]);
      }
    }
  });

  it("demi-tournant à deux poteaux : zones par angle retenues si plus régulières sur tout le tournant (marche du poteau comprise), un nez fixe par poteau", () => {
    let retained = 0;
    for (let floorToFloor = 2500; floorToFloor <= 2900; floorToFloor += 50) {
      const p = withNewels(createProject("half-turn", { floorToFloor }));
      const layout = computeLayout(p);
      const st = computeStepping(p, layout);
      const tag = `H=${floorToFloor}`;
      const note = st.notes.find((n) => /zones par angle retenues/.test(n));
      if (!note) continue;
      retained++;
      // Retenues parce qu'elles réduisent le nombre de ruptures mesurées sur les tournants
      // entiers ; ruptures restantes signalées dans la remarque.
      const left = /(\d+) rupture\(s\) restante/.exec(note);
      const before = /\((\d+) rupture\(s\)\)/.exec(note);
      expect(before, tag).not.toBeNull();
      expect(Number(left?.[1] ?? 0), tag).toBeLessThan(Number(before![1]));
      // Nez de poteau : le plus proche du milieu de chaque tournant, perpendiculaire à Γ (arc
      // centré sur le poteau : la ligne vise le centre du poteau) et borne de deux zones.
      for (const t of layout.turns) {
        const mid = (t.sStart + t.sEnd) / 2;
        const kc = postNosing(
          st.nosings.map((k) => k.s),
          t.sStart,
          t.sEnd,
        );
        expect(kc, tag).toBeGreaterThan(0);
        const nl = st.nosings[kc]!;
        expect(Math.abs(nl.s - mid), tag).toBeLessThanOrEqual(st.going / 2 + 1e-6);
        const toCorner = V.sub(t.innerCorner, nl.p);
        expect(Math.abs(V.cross(nl.dir, toCorner)) / V.norm(toCorner), tag).toBeLessThan(1e-6);
        expect(
          st.balancedZones.some((z) => z.to === kc) || st.balancedZones.some((z) => z.from === kc),
          tag,
        ).toBe(true);
      }
    }
    expect(retained).toBeGreaterThan(0);
  });

  it("zones par angle rejetées si la marche du poteau (entre deux zones) casse K3 (régression)", () => {
    // Contre-exemple du générateur : U, poteau au 1er tournant ; les zones par angle, régulières
    // zone par zone, laissaient entre elles une marche de poteau à 25 mm de collet (après 186).
    const p = ProjectSchema.parse({
      schemaVersion: 1,
      name: "U à poteau",
      rulesVersion: 1,
      site: { floorToFloor: 3062, lowerFinish: 0, upperFinish: 0, upperSlabThickness: 200 },
      stair: {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout: {
          width: 1147,
          legs: [{ length: 1590 }, { length: 2562 }, { length: 2919 }],
          turns: [
            { direction: "left", mode: "winders", inner: { kind: "newel", size: 90 } },
            { direction: "left", mode: "winders", inner: { kind: "sharp" } },
          ],
        },
        walkline: { mode: "dtu" },
        stepping: { riserCount: "auto", targetRise: 175, targetGoing: "auto", firstRiseOffset: 0 },
        balancing: { method: "M1", variant: "cubic", windersPerSide: "auto", targetCollet: 100 },
        treads: { thickness: 40, nosing: 30, risers: "full", riserThickness: 20 },
        structure: { kind: "none", params: {} },
      },
      compliance: { contexts: ["bois_dtu", "logement_interieur"], profile: "strict" },
    });
    const st = computeStepping(p, computeLayout(p));
    expect(st.notes.some((n) => /zones par angle retenues/.test(n))).toBe(false);
    // Marches du 1er tournant (nez 0 à 6) : aucun collet effondré au droit du poteau.
    const chords = st.treads.slice(0, 6).map((t) => t.colletChord);
    expect(Math.min(...chords)).toBeGreaterThan(90);
  });

  it("quart tournant à poteau déjà régulier (cas d'acceptation n° 1) : zone d'un seul tenant", () => {
    const text = readFileSync(
      new URL("../../../../examples/acceptance-01-quart-tournant.blondel.json", import.meta.url),
      "utf8",
    );
    const p = parseProjectText(text);
    const st = computeStepping(p, computeLayout(p));
    expect(st.notes.filter((n) => n.startsWith("K3 :"))).toEqual([]);
    expect(st.notes.some((n) => /au poteau|zones par angle/.test(n))).toBe(false);
    expect(st.balancedZones.map((z) => [z.from, z.to])).toEqual([[0, 4]]);
  });
});
