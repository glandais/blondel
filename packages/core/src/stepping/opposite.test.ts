/**
 * Découpage des escaliers à deux quarts tournants de sens opposés (S / Z, CHALLENGE G1, G3) :
 * une zone par tournant, collet mesuré du côté du jour de chaque tournant, marche virtuelle
 * fixe dans la volée intermédiaire (au moins un giron, sinon erreur lisible), transition de la
 * ligne de foulée quand E > 1 200 mm.
 */
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { curveLength } from "../geom2d/curve.js";
import { findCrossings, nosingsCross } from "../balancing/postprocess.js";
import type { NosingLine } from "../model/derived.js";
import { fmt } from "../rules/check.js";
import { computeLayout } from "../layout/layout.js";
import { SteppingError } from "./errors.js";
import { findCrossingsOnSides } from "./sides.js";
import { computeStepping } from "./stepping.js";
import { makeSteppingProject, type SteppingShape } from "./test-helpers.js";

const S = (
  shape: Omit<SteppingShape, "directions">,
  directions: readonly ("left" | "right")[] = ["left", "right"],
) => makeSteppingProject({ ...shape, directions: [...directions] });

describe("découpage — S / Z", () => {
  const s = S({ width: 850, legs: [1390, 2400, 2000] });
  const layout = computeLayout(s);
  const st = computeStepping(s, layout);

  it("une zone par tournant, séparées par un nez fixe dans la volée intermédiaire", () => {
    expect(st.balancedZones.map((z) => z.turn)).toEqual([0, 1]);
    const [z1, z2] = st.balancedZones;
    expect(z1!.to).toBeLessThanOrEqual(z2!.from);
    const t1 = layout.turns[0]!;
    const t2 = layout.turns[1]!;
    // Nez fixe séparateur dans la partie droite intermédiaire.
    const sep = st.nosings[z2!.from]!;
    expect(sep.s).toBeGreaterThanOrEqual(t1.sEnd - 1e-6);
    expect(sep.s).toBeLessThanOrEqual(t2.sStart + 1e-6);
    expect(sep.balanced).toBe(false);
    expect(findCrossingsOnSides(layout, st.nosings)).toEqual([]);
  });

  it("collets mesurés du côté du jour de chaque tournant (second tournant : bord `outer`)", () => {
    const t2 = layout.turns[1]!;
    for (const t of st.treads) {
      const a = st.nosings[t.number - 1]!;
      const b = st.nosings[t.number]!;
      const mid = (a.s + b.s) / 2;
      const nearSecond = mid > (layout.turns[0]!.sEnd + t2.sStart) / 2;
      const chord = nearSecond ? V.distance(a.r, b.r) : V.distance(a.q, b.q);
      expect(t.colletChord).toBeCloseTo(chord, 9);
      expect(t.colletChord).toBeGreaterThan(0);
    }
    const winders2 = st.treads.filter(
      (t) => t.kind === "winder" && st.nosings[t.number]!.s > t2.sStart,
    );
    // Au second tournant, le collet (jour à droite) est bien plus court que le giron côté mur.
    for (const t of winders2) expect(t.colletChord).toBeLessThan(t.goingOuter);
    expect(Math.min(...st.treads.map((t) => t.colletChord))).toBeGreaterThan(100);
  });

  it("Z = miroir du S : mêmes zones, mêmes collets et girons côté mur", () => {
    const z = S({ width: 850, legs: [1390, 2400, 2000] }, ["right", "left"]);
    const sz = computeStepping(z, computeLayout(z));
    expect(sz.balancedZones).toEqual(st.balancedZones);
    sz.treads.forEach((t, i) => {
      expect(t.colletChord).toBeCloseTo(st.treads[i]!.colletChord, 6);
      expect(t.goingOuter).toBeCloseTo(st.treads[i]!.goingOuter, 6);
    });
  });

  it("volée intermédiaire de moins d'un giron : erreur lisible (CHALLENGE G3)", () => {
    const p = S({ width: 850, legs: [1390, 1900, 2500] });
    expect(() => computeStepping(p, computeLayout(p))).toThrow(SteppingError);
    expect(() => computeStepping(p, computeLayout(p))).toThrow(
      /sens opposés.*au moins un giron.*Allongez la volée 2/,
    );
  });

  it("volée intermédiaire courte mais palier : pas d'erreur (pas de balancement à séparer)", () => {
    const p = S({ width: 850, legs: [1390, 1900, 2500], mode: ["winders", "landing"] });
    expect(() => computeStepping(p, computeLayout(p))).not.toThrow();
  });

  it("E > 1 200 : transition de d_f signalée, nez de la volée intermédiaire perpendiculaires à la volée", () => {
    const p = S({ width: 1400, legs: [2500, 3800, 2600] });
    const lay = computeLayout(p);
    const sw = computeStepping(p, lay);
    const tr = lay.walklineTransitions![0]!;
    expect(sw.notes.some((n) => /raccord linéaire.*défaut à valider/.test(n))).toBe(true);
    // Nez parallèles, Γ oblique : profondeur réelle entre deux nez = g·cos θ, signalée.
    const g = sw.treads[0]!.going;
    const depth = fmt(g * Math.cos(tr.angle));
    expect(sw.notes.some((n) => n.includes(`n'y donne que ${depth} mm entre deux nez`))).toBe(true);
    for (let k = 0; k + 1 < sw.nosings.length; k++) {
      const a = sw.nosings[k]!;
      const b = sw.nosings[k + 1]!;
      if (a.s < tr.sStart + 1e-6 || b.s > tr.sEnd - 1e-6) continue;
      expect(Math.abs(V.dot(V.sub(b.p, a.p), tr.direction))).toBeCloseTo(g * Math.cos(tr.angle), 6);
    }
    const inside = sw.nosings.filter((n) => n.s > tr.sStart + 1e-6 && n.s < tr.sEnd - 1e-6);
    expect(inside.length).toBeGreaterThan(0);
    for (const n of inside) {
      expect(n.balanced).toBe(false);
      expect(Math.abs(V.dot(n.dir, tr.direction))).toBeLessThan(1e-9);
    }
    expect(findCrossingsOnSides(lay, sw.nosings)).toEqual([]);
    expect(sw.balancedZones).toHaveLength(2);
  });

  it("méthodes M0 et M1 et poteaux : zones sur les deux jours, sans croisement", () => {
    for (const method of ["M0", "M1"] as const) {
      const p = S({ width: 850, legs: [1390, 2400, 2000], balancing: { method } });
      const lay = computeLayout(p);
      const sm = computeStepping(p, lay);
      expect(sm.balancedZones.length, method).toBeGreaterThan(0);
      expect(findCrossingsOnSides(lay, sm.nosings), method).toEqual([]);
    }
    const p = S({
      width: 900,
      legs: [1500, 2500, 2100],
      inner: [
        { kind: "newel", size: 100 },
        { kind: "newel", size: 100 },
      ],
    });
    const lp = computeLayout(p);
    const sp = computeStepping(p, lp);
    expect(findCrossingsOnSides(lp, sp.nosings)).toEqual([]);
    expect(sp.treads.every((t) => t.colletChord > 0)).toBe(true);
  });
});

describe("K5 — contact toléré au seul collet, du côté du jour", () => {
  /** Ligne de nez minimale (Q sur C_i, R sur C_e) pour le contrôle K5. */
  const line = (qx: number, rx: number, sigmaInner: number, sigmaOuter: number): NosingLine => ({
    index: 0,
    s: 0,
    p: V.vec((qx + rx) / 2, 50),
    dir: V.normalize(V.vec(rx - qx, 100)),
    q: V.vec(qx, 0),
    r: V.vec(rx, 100),
    sigmaInner,
    sigmaOuter,
    z: 0,
    balanced: true,
  });

  it("R confondus (giron nul au mur) : croisement quand le jour est C_i (régression)", () => {
    const a = line(0, 100, 0, 50);
    const b = line(50, 100, 50, 50);
    expect(nosingsCross(a, b)).toBe(true);
    expect(nosingsCross(a, b, "inner")).toBe(true);
    // Jour sur C_e (second tournant d'un S, vu du tracé principal) : collet nul toléré.
    expect(nosingsCross(a, b, "outer")).toBe(false);
    expect(nosingsCross(a, b, "none")).toBe(true);
  });

  it("Q confondus : toléré au jour C_i, croisement si C_i est le mur (jour sur C_e)", () => {
    const a = line(0, 0, 0, 0);
    const b = line(0, 100, 0, 100);
    expect(nosingsCross(a, b)).toBe(false);
    expect(nosingsCross(a, b, "outer")).toBe(true);
    expect(nosingsCross(a, b, "none")).toBe(true);
    expect(findCrossings([a, b], 0, 1, () => "outer")).toEqual([{ i: 0, j: 1 }]);
    expect(findCrossings([a, b], 0, 1, (k) => (k === 0 ? "inner" : "outer"))).toEqual([
      { i: 0, j: 1 },
    ]);
  });

  it("S en M0 (jours vifs) : nez convergents aux deux coins K, sans croisement signalé", () => {
    const p = S({ width: 850, legs: [1390, 2400, 2000], balancing: { method: "M0" } });
    const lay = computeLayout(p);
    const st = computeStepping(p, lay);
    expect(findCrossingsOnSides(lay, st.nosings)).toEqual([]);
    expect(st.notes.some((n) => n.startsWith("K5"))).toBe(false);
    // Le second jour est sur C_e : vu comme C_i, le contact au coin K2 serait un croisement.
    expect(findCrossings(st.nosings).length).toBeGreaterThan(0);
  });
});

describe("S / Z — seuil d'un giron de partie droite intermédiaire (CHALLENGE G3)", () => {
  it("erreur si et seulement si la partie droite de Γ est plus courte qu'un giron", () => {
    let ok = 0;
    let ko = 0;
    for (let gap = 200; gap <= 320; gap += 3) {
      const p = S({ width: 850, legs: [1390, 1700 + gap, 2000] });
      const lay = computeLayout(p);
      const n = Math.round(p.site.floorToFloor / p.stair.stepping.targetRise);
      const going = curveLength(lay.walkline) / (n - 1);
      const straight = lay.turns[1]!.sStart - lay.turns[0]!.sEnd;
      expect(straight).toBeCloseTo(gap, 9);
      if (straight < going - 1e-6) {
        expect(() => computeStepping(p, lay), `gap ${gap}`).toThrow(/au moins un giron/);
        ko++;
      } else {
        const st = computeStepping(p, lay);
        expect(st.treads[0]!.going).toBeCloseTo(going, 9);
        expect(st.balancedZones.map((z) => z.turn)).toEqual([0, 1]);
        expect(st.balancedZones[0]!.to).toBeLessThanOrEqual(st.balancedZones[1]!.from);
        expect(findCrossingsOnSides(lay, st.nosings), `gap ${gap}`).toEqual([]);
        ok++;
      }
    }
    expect(ok).toBeGreaterThan(0);
    expect(ko).toBeGreaterThan(0);
  });
});
