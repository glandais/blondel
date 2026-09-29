/**
 * M2 (herse, B §3.4) et M6 (rotation paramétrée, B §3.8) : formules, bornes, post-traitement
 * commun et découpage complet.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ProjectSchema } from "../model/project.js";
import * as V from "../geom2d/vec.js";
import { computeLayout } from "../layout/layout.js";
import { computeStepping } from "../stepping/stepping.js";
import { ALL_TYPOLOGIES, makeSteppingProject, stairArb } from "../stepping/test-helpers.js";
import { findCrossingsOnSides } from "../stepping/sides.js";
import { findCrossings, monotonyBreaks } from "./postprocess.js";
import { herseAlphaBound, herseCollets, herseMap } from "./m2.js";
import { rotationWeight } from "./m6.js";

const DEG = Math.PI / 180;
const round = (xs: readonly number[]) => xs.map((x) => Math.round(x));
/** Arrondi au mm par plus fort reste (somme conservée, ADR-0003), comme les valeurs de B. */
function roundKeepingSum(xs: readonly number[]): number[] {
  const floors = xs.map(Math.floor);
  let rest = Math.round(xs.reduce((a, b) => a + b, 0)) - floors.reduce((a, b) => a + b, 0);
  const order = xs.map((x, i) => ({ i, f: x - floors[i]! })).sort((a, b) => b.f - a.f);
  for (const { i } of order) if (rest-- > 0) floors[i]! += 1;
  return floors;
}

describe("M2 — herse : formule fermée de B §3.4", () => {
  it("exemple numérique : 740 mm de collets, 5 girons de 225,8 mm, α = 20° → 195/166/144/125/110", () => {
    const c = herseCollets(740, 5, 225.8, 20 * DEG);
    expect(roundKeepingSum(c)).toEqual([195, 166, 144, 125, 110]);
    // Valeurs exactes : 195,25 / 166,39 / 143,48 / 125,00 / 109,88.
    [195.25, 166.39, 143.48, 125.0, 109.88].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 2));
    expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(740, 9);
  });

  it("autres angles vérifiés par B : 10°, 30°, 45° ; équipartition à α_eq ≈ 49° ; inversion à 60°", () => {
    expect(round(herseCollets(740, 5, 225.8, 10 * DEG))).toEqual([202, 168, 142, 122, 106]);
    expect(round(herseCollets(740, 5, 225.8, 30 * DEG))).toEqual([184, 163, 145, 130, 118]);
    expect(round(herseCollets(740, 5, 225.8, 45 * DEG))).toEqual([157, 152, 148, 143, 139]);
    const eq = herseAlphaBound(740, 5 * 225.8);
    expect(eq / DEG).toBeCloseTo(Math.acos(740 / 1129) / DEG, 12);
    expect(eq / DEG).toBeGreaterThan(49);
    expect(eq / DEG).toBeLessThan(49.1);
    const c = herseCollets(740, 5, 225.8, eq - 1e-9);
    for (const x of c) expect(x).toBeCloseTo(148, 3);
    // 60° : progression inversée (B : 118 / 131 / 145 / 162 / 183 ; exact 118,5 / 130,9 / …).
    const inv = herseCollets(740, 5, 225.8, 60 * DEG);
    [118, 131, 145, 162, 183].forEach((v, i) => expect(Math.abs(inv[i]! - v)).toBeLessThan(0.6));
    for (let i = 0; i + 1 < inv.length; i++) expect(inv[i + 1]!).toBeGreaterThan(inv[i]!);
  });

  it("α → 0 : progression homographique limite x_k = k·g·K/(k + K) (204/169/142/121/104)", () => {
    const c = herseCollets(740, 5, 225.8, 1e-7);
    expect(round(c)).toEqual([204, 169, 142, 121, 104]);
    // Premier collet toujours < g : saut inévitable en entrée de zone.
    const K = (5 * 740) / (5 * 225.8 - 740);
    expect(c[0]!).toBeLessThan(225.8);
    expect(c[0]!).toBeCloseTo((225.8 * K) / (1 + K), 3);
  });

  it("projection monotone de [0 ; W] sur [0 ; L_c] pour tout α dans ]0 ; α_eq[", () => {
    for (const a of [5, 15, 25, 35, 45]) {
      const x = herseMap(740, 1129, a * DEG);
      let prev = 0;
      for (let w = 10; w <= 1129; w += 10) {
        expect(x(w)).toBeGreaterThan(prev);
        prev = x(w);
      }
      expect(x(1129)).toBeCloseTo(740, 9);
    }
    expect(herseAlphaBound(1200, 1129)).toBe(0);
  });
});

describe("M6 — rotation paramétrée", () => {
  it("poids exp(−(d/λ)^p) : 1 à l'angle, décroissant, plat pour λ grand", () => {
    expect(rotationWeight(0, 2, 2)).toBe(1);
    expect(rotationWeight(1, 2, 2)).toBeGreaterThan(rotationWeight(2, 2, 2));
    expect(rotationWeight(3, 1e6, 2)).toBeCloseTo(1, 9);
  });
});

/** Quart tournant bas (préréglage « quarter-left ») avec une méthode donnée. */
function quarter(balancing: Record<string, unknown>, direction: "left" | "right" = "left") {
  const p = makeSteppingProject({
    width: 900,
    legs: [1440, 3060],
    direction,
    balancing: balancing as never,
  });
  const layout = computeLayout(p);
  return { layout, st: computeStepping(p, layout) };
}

describe("M2 et M6 dans le découpage (post-traitement commun)", () => {
  it("M2 : collets décroissants vers l'angle, borne α_eq rendue, saut de collet signalé", () => {
    const { st } = quarter({ method: "M2" });
    expect(st.balancedZones).toHaveLength(1);
    const z = st.balancedZones[0]!;
    expect(z.method).toBe("M2");
    expect(z.herseAlphaMax).toBeGreaterThan(20);
    expect(z.herseAlphaMax).toBeLessThan(90);
    expect(findCrossings(st.nosings)).toEqual([]);
    const chords = st.treads.slice(z.from, z.to).map((t) => t.colletChord);
    expect(monotonyBreaks(chords)).toEqual([]);
    expect(st.notes.some((n) => /herse \(M2\), α = 20°/.test(n))).toBe(true);
    if (z.ends!.includes("tangent")) {
      expect(st.notes.some((n) => /saut de collet en entrée de zone M2/.test(n))).toBe(true);
    }
    // Invariant B §3.1 : chaque nez pivote autour de son point sur Γ.
    for (const n of st.nosings) {
      expect(Math.abs(V.cross(n.dir, V.sub(n.p, n.q)))).toBeLessThan(1e-6);
    }
  });

  it("M2 : α au-delà de la borne → zone refusée avec la borne dans le message", () => {
    const { st } = quarter({ method: "M2", herseAngle: 89, windersPerSide: 3 });
    expect(st.balancedZones).toEqual([]);
    expect(st.notes.some((n) => /angle de herse 89\.0° hors de \]0 ; \d+\.\d°\[/.test(n))).toBe(
      true,
    );
  });

  it("M2 : un α plus grand aplatit la progression (collet minimal plus grand)", () => {
    const lo = quarter({ method: "M2", herseAngle: 5, windersPerSide: 3 }).st;
    const hi = quarter({ method: "M2", herseAngle: 30, windersPerSide: 3 }).st;
    const min = (st: typeof lo) => Math.min(...st.treads.map((t) => t.colletChord));
    expect(min(hi)).toBeGreaterThan(min(lo));
  });

  it("M6 : rotation répartie entre les nez fixes, sans croisement ; miroir gauche / droite", () => {
    const { st } = quarter({ method: "M6" });
    expect(st.balancedZones).toHaveLength(1);
    expect(st.balancedZones[0]!.method).toBe("M6");
    expect(findCrossings(st.nosings)).toEqual([]);
    expect(st.notes.some((n) => /rotation paramétrée \(M6\).*à valider/.test(n))).toBe(true);
    const z = st.balancedZones[0]!;
    // Angles des nez strictement croissants de φ_a à φ_b (au plus 90° pour un quart tournant).
    const ang = st.nosings.slice(z.from, z.to + 1).map((n) => Math.atan2(n.dir.y, n.dir.x));
    for (let i = 0; i + 1 < ang.length; i++) expect(ang[i + 1]!).toBeGreaterThan(ang[i]!);
    expect(ang[ang.length - 1]! - ang[0]!).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    const m = quarter({ method: "M6" }, "right").st;
    expect(m.balancedZones).toEqual(st.balancedZones);
    m.treads.forEach((t, i) => expect(t.colletChord).toBeCloseTo(st.treads[i]!.colletChord, 6));
  });

  it("M6 : portée très grande = rotation constante d'un nez au suivant (« gleichmäßig »)", () => {
    const { st } = quarter({ method: "M6", rotationReach: 50, windersPerSide: 3 });
    const z = st.balancedZones[0]!;
    const ang = st.nosings.slice(z.from, z.to + 1).map((n) => Math.atan2(n.dir.y, n.dir.x));
    const steps = ang.slice(1).map((a, i) => a - ang[i]!);
    const total = ang[ang.length - 1]! - ang[0]!;
    for (const d of steps) expect(Math.abs(d - total / steps.length)).toBeLessThan(2e-3);
  });
});

describe("M2 et M6 — propriétés (générateur contraint, S / Z compris)", () => {
  it("nez sur leur point de Γ, croisements signalés, α < borne de la zone (M2)", () => {
    fc.assert(
      fc.property(
        stairArb(undefined, ALL_TYPOLOGIES),
        fc.constantFrom("M2" as const, "M6" as const),
        fc.integer({ min: 5, max: 40 }),
        ({ project }, method, herseAngle) => {
          const p = ProjectSchema.parse({
            ...project,
            stair: {
              ...project.stair,
              balancing: { ...project.stair.balancing, method, herseAngle },
            },
          });
          const layout = computeLayout(p);
          const st = computeStepping(p, layout);
          for (const n of st.nosings) {
            expect(Math.abs(V.cross(n.dir, V.sub(n.p, n.q)))).toBeLessThan(1e-6);
          }
          for (const c of findCrossingsOnSides(layout, st.nosings)) {
            expect(
              st.notes.some((n) => n.startsWith(`K5 : les lignes de nez ${c.i} et ${c.j} `)),
            ).toBe(true);
          }
          for (const z of st.balancedZones) {
            expect(z.method).toBe(method);
            if (method === "M2") expect(z.herseAlphaMax!).toBeGreaterThan(herseAngle);
            else expect(z.herseAlphaMax).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 600_000);
});
