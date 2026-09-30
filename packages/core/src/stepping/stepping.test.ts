import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { curveLength } from "../geom2d/curve.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import { findCrossings, monotonyBreaks } from "../balancing/postprocess.js";
import { parseProjectText } from "../project/parse.js";
import { createProject, PRESET_IDS } from "../project/presets.js";
import { BalancingSchema } from "../model/project.js";
import { SteppingError } from "./errors.js";
import { computeStepping, resolveM3Variant } from "./stepping.js";
import {
  COLLET_TIE_TOLERANCE,
  extentLimits,
  MAX_BALANCED_EXTENT,
  pickZone,
  WINDERS_PER_SIDE_MAX,
  groupWinderTurns,
  zoneEndConditions,
  type ZoneEvaluation,
} from "./zones.js";
import { makeSteppingProject, type SteppingShape } from "./test-helpers.js";
import { frList } from "../i18n.test-helpers.js";

const EXAMPLES_DIR = new URL("../../../../examples/", import.meta.url);

function run(shape: SteppingShape) {
  const project = makeSteppingProject(shape);
  const layout = computeLayout(project);
  return { project, layout, stepping: computeStepping(project, layout) };
}

describe("hauteurs", () => {
  it("n = arrondi(H / 175), h = H / n, Σh = H", () => {
    const { stepping } = run({ width: 800, legs: ["auto"], floorToFloor: 2650 });
    expect(stepping.riserCount).toBe(15);
    expect(stepping.rise).toBeCloseTo(2650 / 15, 12);
    for (const h of stepping.rises) expect(h).toBeCloseTo(2650 / 15, 12);
    expect(Math.abs(stepping.rises.reduce((a, b) => a + b, 0) - 2650)).toBeLessThan(1e-9);
    stepping.nosings.forEach((n, k) => expect(n.z).toBeCloseTo(((k + 1) * 2650) / 15, 9));
    expect(stepping.nosings[14]!.z).toBe(2650);
  });

  it("première hauteur corrigée (firstRiseOffset), les autres (H − h₁)/(n − 1)", () => {
    const { stepping } = run({
      width: 800,
      legs: ["auto"],
      floorToFloor: 2700,
      stepping: { riserCount: 15, firstRiseOffset: -20 },
    });
    expect(stepping.rises[0]).toBe(160);
    for (const h of stepping.rises.slice(1)) expect(h).toBeCloseTo(2540 / 14, 12);
    expect(stepping.nosings[0]!.z).toBe(160);
    expect(stepping.nosings[14]!.z).toBe(2700);
    expect(Math.abs(stepping.rises.reduce((a, b) => a + b, 0) - 2700)).toBeLessThan(1e-9);
  });

  it("erreurs : correction de première marche impossible, n hors domaine", () => {
    const p = makeSteppingProject({
      width: 800,
      legs: [4000],
      stepping: { riserCount: 2, firstRiseOffset: -2000 },
    });
    expect(() => computeStepping(p, computeLayout(p))).toThrow(SteppingError);
    const q = makeSteppingProject({ width: 800, legs: [4000], floorToFloor: 200 });
    expect(() => computeStepping(q, computeLayout(q))).toThrow(LayoutError);
  });
});

describe("escalier droit", () => {
  it("longueur auto : g = 630 − 2h, reculement (n − 1)·g, marches rectangulaires E × g", () => {
    const { stepping, layout } = run({
      width: 900,
      legs: ["auto"],
      floorToFloor: 2700,
      treads: { nosing: 30 },
    });
    expect(stepping.going).toBe(630 - 2 * 180);
    expect(stepping.blondel).toBe(630);
    expect(stepping.run).toBeCloseTo(14 * 270, 9);
    expect(stepping.run).toBeCloseTo(curveLength(layout.walkline), 9);
    expect(stepping.balancedZones).toEqual([]);
    expect(stepping.notes).toEqual([]);
    expect(stepping.treads).toHaveLength(14);
    for (const t of stepping.treads) {
      expect(t.kind).toBe("straight");
      expect(t.going).toBeCloseTo(270, 9);
      expect(t.colletArc).toBeCloseTo(270, 9);
      expect(t.colletChord).toBeCloseTo(270, 9);
      expect(t.goingOuter).toBeCloseTo(270, 9);
      expect(signedArea(t.walkingSurface)).toBeCloseTo(900 * 270, 6);
      expect(signedArea(t.outline)).toBeCloseTo(900 * 300, 6);
      expect(t.z).toBe(stepping.nosings[t.number - 1]!.z);
    }
    // Nez perpendiculaires : Q sur le jour (x = 0), R sur le mur (x = E), direction +x.
    for (const n of stepping.nosings) {
      expect(n.q.x).toBeCloseTo(0, 9);
      expect(n.r.x).toBeCloseTo(900, 9);
      expect(n.dir.x).toBeCloseTo(1, 12);
      expect(n.balanced).toBe(false);
    }
  });

  it("longueur fixée : g = |Γ| / (n − 1)", () => {
    const { stepping } = run({ width: 800, legs: [3500], floorToFloor: 2700 });
    expect(stepping.going).toBeCloseTo(3500 / 14, 12);
  });
});

describe("quart tournant balancé (M3)", () => {
  it("zone autour du tournant, marches balancées, K5, collet ≥ cible, symétrie gauche/droite", () => {
    const left = run({ width: 900, legs: [2000, 2900], direction: "left" }).stepping;
    const right = run({ width: 900, legs: [2000, 2900], direction: "right" }).stepping;
    expect(left.balancedZones).toHaveLength(1);
    const z = left.balancedZones[0]!;
    expect(z.method).toBe("M3-cubic");
    expect(findCrossings(left.nosings)).toEqual([]);
    const winders = left.treads.filter((t) => t.kind === "winder");
    expect(winders.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...winders.map((t) => t.colletChord))).toBeGreaterThanOrEqual(100);
    expect(monotonyBreaks(winders.map((t) => t.colletChord))).toEqual([]);
    for (let k = z.from + 1; k < z.to; k++) expect(left.nosings[k]!.balanced).toBe(true);
    // Miroir : mêmes collets, mêmes zones.
    expect(right.balancedZones).toEqual(left.balancedZones);
    right.treads.forEach((t, i) => {
      expect(t.colletChord).toBeCloseTo(left.treads[i]!.colletChord, 6);
      expect(t.goingOuter).toBeCloseTo(left.treads[i]!.goingOuter, 6);
    });
  });

  it("miroir gauche/droite : candidats symétriques départagés sans bruit d'arrondi", () => {
    // Tournant médian à jour en arc : les zones [3 ; 8] et [6 ; 11] sont images l'une de
    // l'autre (nez 7 au milieu du tournant) ; le choix ne doit pas dépendre du sens.
    for (const method of ["M1", "M3"] as const) {
      const shape: SteppingShape = {
        width: 800,
        legs: [2400, 2400],
        inner: { kind: "arc", radius: 200 },
        balancing: { method },
      };
      const left = run({ ...shape, direction: "left" }).stepping;
      const right = run({ ...shape, direction: "right" }).stepping;
      expect(right.balancedZones, method).toEqual(left.balancedZones);
      right.treads.forEach((t, i) =>
        expect(t.colletChord, method).toBeCloseTo(left.treads[i]!.colletChord, 6),
      );
    }
  });

  it("invariance par placement (rotation, translation)", () => {
    const a = run({ width: 850, legs: [1800, 3000] }).stepping;
    const b = run({
      width: 850,
      legs: [1800, 3000],
      origin: { x: 1234, y: -567 },
      rotation: 37,
    }).stepping;
    expect(b.balancedZones).toEqual(a.balancedZones);
    b.treads.forEach((t, i) => {
      expect(t.colletChord).toBeCloseTo(a.treads[i]!.colletChord, 6);
      expect(signedArea(t.walkingSurface)).toBeCloseTo(signedArea(a.treads[i]!.walkingSurface), 3);
    });
  });

  it("variante auto : cubique, quintique pour une structure débillardée (Q7)", () => {
    const p = makeSteppingProject({ width: 900, legs: [2000, 2900] });
    expect(resolveM3Variant(p)).toBe("cubic");
    const q = makeSteppingProject({
      width: 900,
      legs: [2000, 2900],
      structure: { kind: "debillarde-bois", params: {} },
    });
    expect(resolveM3Variant(q)).toBe("quintic");
    const st = computeStepping(q, computeLayout(q));
    expect(st.balancedZones[0]!.method).toBe("M3-quintic");
    const forced = makeSteppingProject({
      width: 900,
      legs: [2000, 2900],
      structure: { kind: "debillarde-bois", params: {} },
      balancing: { variant: "cubic" },
    });
    expect(resolveM3Variant(forced)).toBe("cubic");
  });

  it("windersPerSide imposé : taille de zone ; borné par les nez fixes (note)", () => {
    const st = run({ width: 900, legs: [2000, 2900], balancing: { windersPerSide: 2 } }).stepping;
    const z = st.balancedZones[0]!;
    expect(z.to - z.from - 1).toBe(4);
    const low = run({ width: 900, legs: [1000, 3900], balancing: { windersPerSide: 5 } }).stepping;
    expect(frList(low.notes).some((n) => n.includes("5 marches balancées demandées"))).toBe(true);
    expect(low.balancedZones[0]!.from).toBe(0);
  });

  it("choix automatique (CHALLENGE G3 corrigé) : le moins de nez balancés atteignant la cible", () => {
    // Toute zone symétrique imposée (w nez de chaque côté) plus petite que la zone retenue en
    // `auto` n'atteint pas le collet cible avec des collets réguliers et sans croisement (ou
    // sort de l'étendue K7, ce qui n'est pas testé ici : elle serait alors plus grande).
    const minChord = (st: ReturnType<typeof run>["stepping"]) =>
      Math.min(...st.treads.map((t) => t.colletChord));
    const count = (st: ReturnType<typeof run>["stepping"]) =>
      st.nosings.filter((nl) => nl.balanced).length;
    for (const legs of [
      [2400, 2400],
      [1600, 3200],
    ]) {
      const auto = run({ width: 800, legs }).stepping;
      expect(minChord(auto), `${legs}`).toBeGreaterThanOrEqual(100);
      for (let w = 1; 2 * w < count(auto); w++) {
        const forced = run({ width: 800, legs, balancing: { windersPerSide: w } }).stepping;
        const regular = monotonyBreaks(forced.treads.map((t) => t.colletChord)).length === 0;
        const ok = regular && findCrossings(forced.nosings).length === 0;
        expect(ok && minChord(forced) >= 100, `${legs} w=${w}`).toBe(false);
      }
    }
  });

  it("choix automatique : collet cible plus exigeant → zone au moins aussi grande", () => {
    const count = (st: ReturnType<typeof run>["stepping"]) =>
      st.nosings.filter((nl) => nl.balanced).length;
    const legs = [2400, 2400];
    let prev = 0;
    for (const targetCollet of [1, 60, 100, 140, 180]) {
      const st = run({ width: 800, legs, balancing: { targetCollet } }).stepping;
      expect(count(st), `cible ${targetCollet}`).toBeGreaterThanOrEqual(prev);
      prev = count(st);
    }
    // Cible inaccessible : collet maximal dans l'étendue, signalé.
    const high = run({ width: 800, legs, balancing: { targetCollet: 400 } }).stepping;
    expect(frList(high.notes).some((n) => n.includes("collet cible de 400 mm non atteint"))).toBe(
      true,
    );
    // La note n'invoque l'étendue que si elle a écarté des zones (relecture : message trompeur).
    expect(
      frList(high.notes).some((n) => n.includes("étendue de balancement limitée à 3,5 girons")),
    ).toBe(true);
    const wide = run({
      width: 800,
      legs,
      balancing: { targetCollet: 400, maxBalancedExtent: 100 },
    }).stepping;
    expect(frList(wide.notes).some((n) => n.includes("aucune zone possible ne l'atteint"))).toBe(
      true,
    );
    expect(frList(wide.notes).some((n) => n.includes("étendue de balancement limitée"))).toBe(
      false,
    );
  });

  const cand = (
    from: number,
    to: number,
    minChord: number,
    extra: Partial<ZoneEvaluation> = {},
  ): ZoneEvaluation => ({
    zone: { turn: 0, from, to, collarSide: "left", ends: ["tangent", "tangent"] },
    ok: true,
    nosings: [],
    corrected: [],
    minChord,
    minArc: minChord,
    k5: true,
    k3: true,
    winders: to - from - 1,
    offCenter: 0,
    ...extra,
  });

  it("pickZone : cible atteinte → le moins de nez balancés (réguliers d'abord)", () => {
    // Régression constatée en ligne : maximiser le collet balançait toute une volée.
    const few = cand(4, 8, 131);
    const many = cand(2, 10, 180);
    expect(pickZone([many, few, cand(5, 7, 90)], 100)).toBe(few);
    // À nombre égal, le plus grand collet.
    expect(pickZone([cand(4, 8, 120), cand(3, 7, 150), cand(5, 9, 101)], 100)!.zone.from).toBe(3);
    // Parmi les candidats qui atteignent la cible, les réguliers (K3) d'abord.
    expect(pickZone([cand(4, 8, 131, { k3: false }), many], 100)).toBe(many);
    // Un candidat régulier sous la cible ne l'emporte pas sur un irrégulier qui l'atteint.
    const irregular = cand(4, 8, 131, { k3: false });
    expect(pickZone([irregular, cand(2, 10, 95)], 100)).toBe(irregular);
    // Candidats non admissibles (K5, collet nul, nez corrigé) ignorés ; aucun admissible → null.
    expect(pickZone([cand(4, 8, 131, { k5: false }), many], 100)).toBe(many);
    expect(pickZone([cand(4, 8, 131, { corrected: [5] }), many], 100)).toBe(many);
    expect(pickZone([cand(2, 10, 0)], 100)).toBeNull();
  });

  it("pickZone : cible non atteinte → collet maximal, la régularité ne sacrifie pas le collet", () => {
    // Ledger (revue J1-J2) : demi-tournant E = 1 200, zone régulière à 28 mm retenue au lieu
    // d'une zone irrégulière (K5 respecté) à 83 mm.
    const regular28 = cand(4, 12, 28);
    const irregular83 = cand(1, 13, 83, { k3: false });
    expect(pickZone([regular28, irregular83], 100)).toBe(irregular83);
    // À `colletTieTolerance` (1 mm) du maximum : réguliers d'abord, puis le moins de nez.
    const regular825 = cand(2, 12, 82.5);
    expect(pickZone([regular28, irregular83, regular825], 100)).toBe(regular825);
    const few = cand(4, 8, 131);
    const many = cand(2, 10, 131.8);
    expect(pickZone([many, few], 200)).toBe(few);
    // Au-delà de la tolérance, le collet maximal l'emporte même avec plus de nez balancés.
    const more = cand(2, 10, 132.2);
    expect(pickZone([few, more], 200)).toBe(more);
  });

  it("tolérance d'égalité des collets : paramètre du projet (défaut 1 mm, à valider)", () => {
    const few = cand(4, 8, 131);
    const many = cand(2, 10, 131.8);
    expect(pickZone([many, few], 200)).toBe(few);
    expect(pickZone([many, few], 200, 0)).toBe(many);
    expect(pickZone([many, cand(5, 7, 90)], 200, 50)!.winders).toBe(1);
    expect(() => pickZone([few], 200, -1)).toThrow(RangeError);
    expect(() => pickZone([few], 200, Number.NaN)).toThrow(RangeError);
    expect(() => pickZone([few], 0)).toThrow(RangeError);
    expect(BalancingSchema.parse({}).colletTieTolerance).toBeUndefined();
    expect(BalancingSchema.safeParse({ colletTieTolerance: -1 }).success).toBe(false);
    // Bout en bout (quart médian, cible inaccessible) : 0 = collet maximal pur ; très grande
    // tolérance = le moins de nez balancés.
    const count = (st: ReturnType<typeof run>["stepping"]) =>
      st.nosings.filter((nl) => nl.balanced).length;
    const minChord = (st: ReturnType<typeof run>["stepping"]) =>
      Math.min(...st.treads.map((t) => t.colletChord));
    const legs = [2400, 2400];
    const balancing = { targetCollet: 400 };
    const byDefault = run({ width: 800, legs, balancing }).stepping;
    const pure = run({
      width: 800,
      legs,
      balancing: { ...balancing, colletTieTolerance: 0 },
    }).stepping;
    const loose = run({
      width: 800,
      legs,
      balancing: { ...balancing, colletTieTolerance: 1000 },
    }).stepping;
    expect(minChord(pure)).toBeGreaterThanOrEqual(minChord(byDefault) - 1e-6);
    expect(minChord(byDefault)).toBeGreaterThanOrEqual(minChord(pure) - COLLET_TIE_TOLERANCE);
    expect(count(loose)).toBeLessThan(count(byDefault));
  });

  it("étendue K7 : paramètre maxBalancedExtent (défaut 3,5 girons depuis l'angle, DIN 18065)", () => {
    expect(MAX_BALANCED_EXTENT).toBe(3.5);
    expect(BalancingSchema.parse({}).maxBalancedExtent).toBeUndefined();
    expect(BalancingSchema.safeParse({ maxBalancedExtent: 0 }).success).toBe(false);
    // Fonction pure : nez à s = 0, 100, …, 1 000 ; tournant [450 ; 550], kL = 5, kR = 6 ;
    // giron 100, étendue 2 : nez fixes jusqu'à s = 250 avant et 750 après.
    const s = Array.from({ length: 11 }, (_, k) => 100 * k);
    expect(extentLimits({ sStart: 450, sEnd: 550 }, s, { kL: 5, kR: 6 }, 100, 2)).toEqual({
      before: 2,
      after: 1,
    });
    expect(extentLimits({ sStart: 450, sEnd: 550 }, s, { kL: 5, kR: 6 }, 100, 100)).toEqual({
      before: 5,
      after: 4,
    });
    // Bout en bout : cible inaccessible, la zone s'étend jusqu'à l'étendue et pas au-delà.
    const legs = [2400, 2400];
    for (const maxBalancedExtent of [1.5, 2.5, 3.5, 6]) {
      const { stepping, layout } = run({
        width: 800,
        legs,
        balancing: { targetCollet: 400, maxBalancedExtent },
      });
      const z = stepping.balancedZones[0]!;
      const turn = layout.turns[0]!;
      const reach = maxBalancedExtent * stepping.going + 1e-6;
      expect(turn.sStart - stepping.nosings[z.from]!.s).toBeLessThanOrEqual(reach);
      expect(stepping.nosings[z.to]!.s - turn.sEnd).toBeLessThanOrEqual(reach);
    }
  });

  it("borne de zone dans la partie tournante : extrémité libre, sinon tangente", () => {
    // Quart tournant médian à jour vif (arc de Γ : s ∈ [1 600 ; 2 228], girons de 273,4 mm),
    // 1 nez de chaque côté : nez fixes 5 (s = 1 367, partie droite → tangente) et 8
    // (s = 2 188, dans l'arc : aucune partie droite ne continue → libre).
    const inner = run({ width: 800, legs: [2400, 2400], balancing: { windersPerSide: 1 } });
    expect(inner.stepping.balancedZones[0]).toMatchObject({ from: 5, to: 8 });
    expect(frList(inner.stepping.notes).some((n) => n.includes("extrémités tangente/libre"))).toBe(
      true,
    );
    // 2 nez de chaque côté : nez fixes 4 et 9 dans les parties droites → tangentes.
    const outer = run({ width: 800, legs: [2400, 2400], balancing: { windersPerSide: 2 } });
    expect(outer.stepping.balancedZones[0]).toMatchObject({ from: 4, to: 9 });
    expect(
      frList(outer.stepping.notes).some((n) => n.includes("extrémités tangente/tangente")),
    ).toBe(true);
    // Fonction pure : bornes sur les limites de l'arc (à GEOM_EPS) = tangentes.
    const seeds = [0, 100, 200, 300, 400].map((s) => ({ s }));
    const ctx = { seeds, freeNosings: new Set<number>() } as unknown as Parameters<
      typeof zoneEndConditions
    >[0];
    expect(zoneEndConditions(ctx, { sStart: 100, sEnd: 300 }, 1, 3)).toEqual([
      "tangent",
      "tangent",
    ]);
    expect(zoneEndConditions(ctx, { sStart: 50, sEnd: 350 }, 1, 3)).toEqual(["free", "free"]);
    expect(zoneEndConditions(ctx, { sStart: 150, sEnd: 250 }, 0, 4)).toEqual([
      "tangent",
      "tangent",
    ]);
    const withFree = { ...ctx, freeNosings: new Set([0]) };
    expect(zoneEndConditions(withFree, { sStart: 150, sEnd: 250 }, 0, 4)).toEqual([
      "free",
      "tangent",
    ]);
    // Zone unique de 180° : une borne dans la courte partie droite intermédiaire [180 ; 220]
    // n'est pas dans la partie tournante, une partie droite continue → tangente (D3).
    const u = { sStart: 50, sEnd: 350, straights: [{ sStart: 180, sEnd: 220 }] };
    expect(zoneEndConditions(ctx, u, 2, 3)).toEqual(["tangent", "free"]);
    expect(zoneEndConditions(ctx, u, 1, 2)).toEqual(["free", "tangent"]);
    expect(zoneEndConditions(ctx, u, 1, 3)).toEqual(["free", "free"]);
  });

  it("zone unique de 180° : la partie droite intermédiaire est déclarée dans le groupe (D3)", () => {
    const layout = computeLayout(
      makeSteppingProject({ width: 800, legs: [2400, 1700, 2400], floorToFloor: 3000 }),
    );
    const [t0, t1] = layout.turns;
    const groups = groupWinderTurns(layout, [], 250, new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.straights).toHaveLength(1);
    expect(groups[0]!.straights![0]!.sStart).toBeCloseTo(t0!.sEnd, 9);
    expect(groups[0]!.straights![0]!.sEnd).toBeCloseTo(t1!.sStart, 9);
    // Tournants éloignés (partie droite ≥ un giron) : deux groupes, aucune partie droite.
    const far = computeLayout(
      makeSteppingProject({ width: 800, legs: [2400, 2400, 2400], floorToFloor: 3000 }),
    );
    const apart = groupWinderTurns(far, [], 250, new Set());
    expect(apart).toHaveLength(2);
    expect(apart.every((g) => g.straights === undefined)).toBe(true);
  });

  it("borne d'énumération = maximum de windersPerSide du schéma", () => {
    expect(BalancingSchema.safeParse({ windersPerSide: WINDERS_PER_SIDE_MAX }).success).toBe(true);
    expect(BalancingSchema.safeParse({ windersPerSide: WINDERS_PER_SIDE_MAX + 1 }).success).toBe(
      false,
    );
  });

  it("quart tournant bas (départ libre), haut (arrivée libre), médian", () => {
    // Tournant à moins d'un giron du départ (resp. de l'arrivée) : la zone est bornée par le
    // départ (resp. l'arrivée), à un nez près.
    const low = run({ width: 800, legs: [1000, 3800] }).stepping;
    expect(low.balancedZones[0]!.from).toBeLessThanOrEqual(1);
    expect(low.treads[0]!.kind).toBe("winder");
    const high = run({ width: 800, legs: [3800, 1000] }).stepping;
    expect(high.balancedZones[0]!.to).toBeGreaterThanOrEqual(high.riserCount - 2);
    expect(high.treads[high.treads.length - 1]!.kind).toBe("winder");
    const mid = run({ width: 800, legs: [2400, 2400] }).stepping;
    // Tournant médian : collet cible atteint (CHALLENGE G3), la zone encadre le tournant.
    const z = mid.balancedZones[0]!;
    expect(z.from).toBeLessThan(7);
    expect(z.to).toBeGreaterThan(7);
    expect(Math.min(...mid.treads.map((t) => t.colletChord))).toBeGreaterThanOrEqual(100);
    for (const st of [low, high, mid]) {
      expect(findCrossings(st.nosings)).toEqual([]);
      for (const t of st.treads.filter((t) => t.kind === "winder")) {
        expect(t.colletChord).toBeGreaterThan(0);
      }
    }
  });

  it("jour en arc : M0 rayonnant donne c = g·r_j / r_f sur l'arc (B §3.2)", () => {
    const r = 300;
    const { stepping, layout } = run({
      width: 800,
      legs: [2400, 2400],
      inner: { kind: "arc", radius: r },
      balancing: { method: "M0" },
    });
    const turn = layout.turns[0]!;
    const inArc = stepping.treads.filter(
      (t) =>
        stepping.nosings[t.number - 1]!.s >= turn.sStart - 1e-9 &&
        stepping.nosings[t.number]!.s <= turn.sEnd + 1e-9,
    );
    expect(inArc.length).toBeGreaterThan(0);
    for (const t of inArc) expect(t.colletArc).toBeCloseTo((stepping.going * r) / (r + 400), 6);
    expect(stepping.balancedZones[0]!.method).toBe("M0");
  });

  it("M0 à angle vif : collet nul signalé", () => {
    const st = run({ width: 800, legs: [2400, 2400], balancing: { method: "M0" } }).stepping;
    expect(frList(st.notes).some((n) => n.includes("collet nul"))).toBe(true);
  });

  it("M1 : profil en V, jarret signalé, K3", () => {
    // Zone imposée (3 de chaque côté) : extrémités tangentes, donc jarret d'entrée de zone.
    const st = run({
      width: 800,
      legs: [2400, 2400],
      balancing: { method: "M1", windersPerSide: 3 },
    }).stepping;
    expect(st.balancedZones[0]!.method).toBe("M1");
    expect(frList(st.notes).some((n) => n.includes("jarret"))).toBe(true);
    const z = st.balancedZones[0]!;
    const c = st.treads.filter((t) => t.number - 1 >= z.from && t.number <= z.to);
    expect(monotonyBreaks(c.map((t) => t.colletArc))).toEqual([]);
  });

  it("poteau : collet mesuré sur le contour réel, jour de développement virtuel", () => {
    const { stepping, layout } = run({
      width: 800,
      legs: [1280, 3051],
      inner: { kind: "newel", size: 100 },
    });
    expect(findCrossings(stepping.nosings)).toEqual([]);
    // Chaque collet Q est sur le bord réel (contour du poteau ou limon).
    for (const n of stepping.nosings) {
      const inner = layout.inner;
      const d = Math.min(
        ...inner.segments.map((s) =>
          s.kind === "line"
            ? Math.abs(V.cross(V.normalize(V.sub(s.b, s.a)), V.sub(n.q, s.a)))
            : Infinity,
        ),
      );
      expect(d).toBeLessThan(1e-6);
    }
    expect(frList(stepping.notes).some((n) => n.includes("recoupe le jour"))).toBe(false);
  });
});

describe("U et demi-tournant", () => {
  it("U à volée centrale longue : deux zones, marche virtuelle fixe entre elles", () => {
    const st = run({ width: 800, legs: [1800, 2400, 1800], floorToFloor: 2800 }).stepping;
    expect(st.balancedZones).toHaveLength(2);
    const [z1, z2] = st.balancedZones;
    expect(z1!.turn).toBe(0);
    expect(z2!.turn).toBe(1);
    expect(z1!.to).toBeLessThanOrEqual(z2!.from);
    expect(findCrossings(st.nosings)).toEqual([]);
  });

  it("demi-tournant (volée centrale < 1 giron) : zone unique de 180°", () => {
    const st = run({ width: 800, legs: [1600, 1800, 1600], floorToFloor: 2700 }).stepping;
    expect(st.balancedZones).toHaveLength(1);
    expect(frList(st.notes).some((n) => n.includes("zone unique"))).toBe(true);
    expect(findCrossings(st.nosings)).toEqual([]);
    for (const t of st.treads.filter((t) => t.kind === "winder")) {
      expect(t.colletChord).toBeGreaterThan(0);
    }
  });
});

describe("paliers", () => {
  it("palier d'angle : nez aux bords du palier, marche palière, girons égaux si les volées sont des multiples de g", () => {
    // E = 900, d_f = 450, n = 15 : 14 girons dont le palier, soit 13 girons droits de 270 mm
    // répartis en 2 + 11 (parties droites de Γ = L − E).
    const { stepping, layout } = run({
      width: 900,
      legs: [900 + 2 * 270, 900 + 11 * 270],
      mode: "landing",
      floorToFloor: 2700,
    });
    const turn = layout.turns[0]!;
    expect(stepping.going).toBeCloseTo(270, 9);
    const landing = stepping.treads.filter((t) => t.kind === "landing");
    expect(landing).toHaveLength(1);
    const k = landing[0]!.number - 1;
    expect(stepping.nosings[k]!.s).toBeCloseTo(turn.sStart, 9);
    expect(stepping.nosings[k + 1]!.s).toBeCloseTo(turn.sEnd, 9);
    expect(landing[0]!.going).toBeCloseTo((Math.PI / 2) * 450, 9);
    // Jour vif : le palier est le carré d'angle E × E.
    expect(signedArea(landing[0]!.walkingSurface)).toBeCloseTo(900 * 900, 3);
    for (const t of stepping.treads.filter((t) => t.kind !== "landing")) {
      expect(t.going).toBeCloseTo(270, 9);
      expect(t.kind).toBe("straight");
    }
    expect(stepping.balancedZones).toEqual([]);
    expect(stepping.notes).toEqual([]);
  });

  it("volées non multiples du giron : girons par partie droite, signalé", () => {
    const { stepping } = run({
      width: 900,
      legs: [900 + 2 * 270 + 100, 900 + 11 * 270],
      mode: "landing",
      floorToFloor: 2700,
    });
    expect(frList(stepping.notes).some((n) => n.startsWith("Paliers :"))).toBe(true);
    const goings = stepping.treads.filter((t) => t.kind !== "landing").map((t) => t.going);
    expect(Math.max(...goings) - Math.min(...goings)).toBeGreaterThan(1);
    expect(stepping.run).toBeCloseTo(stepping.nosings[14]!.s, 9);
  });

  it("palier au départ (volée 1 = E) : la première marche est le palier", () => {
    const { stepping } = run({ width: 900, legs: [900, 900 + 13 * 270], mode: "landing" });
    expect(stepping.treads[0]!.kind).toBe("landing");
    expect(stepping.nosings[0]!.s).toBe(0);
    for (const t of stepping.treads.slice(1)) expect(t.going).toBeCloseTo(270, 9);
  });

  it("pas assez de hauteurs pour les paliers : erreur", () => {
    const p = makeSteppingProject({
      width: 900,
      legs: [900, 900],
      mode: "landing",
      stepping: { riserCount: 2 },
    });
    expect(() => computeStepping(p, computeLayout(p))).toThrow(SteppingError);
  });
});

describe("surcharges du mode expert", () => {
  const base: SteppingShape = { width: 900, legs: [2000, 2900] };

  it("nez fixe : borne de zone", () => {
    const free = run(base).stepping;
    const z = free.balancedZones[0]!;
    const k = z.from + 1;
    const st = run({ ...base, nosingOverrides: [{ kind: "fixed", index: k }] }).stepping;
    expect(st.nosings[k]!.balanced).toBe(false);
    const zz = st.balancedZones[0]!;
    expect(zz.from).toBeGreaterThanOrEqual(k);
  });

  it("angle imposé : ligne tournée autour de P_k, K5 contrôlé", () => {
    const st = run({ ...base, nosingOverrides: [{ kind: "angle", index: 2, angle: 5 }] }).stepping;
    const ref = run(base).stepping;
    const n = st.nosings[2]!;
    const r = ref.nosings[2]!;
    expect(n.p).toEqual(r.p);
    expect(n.balanced).toBe(true);
    const perp = V.vec(1, 0); // volée 1 : perpendiculaire = +x
    expect((V.signedAngle(perp, n.dir) * 180) / Math.PI).toBeCloseTo(5, 9);
    expect(st.treads[1]!.kind).toBe("winder");
  });

  it("angle imposé : même sens pour un escalier et son miroir (sens du tournant)", () => {
    const o = { nosingOverrides: [{ kind: "angle" as const, index: 2, angle: 5 }] };
    const left = run({ ...base, ...o, direction: "left" }).stepping;
    const right = run({ ...base, ...o, direction: "right" }).stepping;
    right.treads.forEach((t, i) => {
      expect(t.colletChord).toBeCloseTo(left.treads[i]!.colletChord, 6);
      expect(t.goingOuter).toBeCloseTo(left.treads[i]!.goingOuter, 6);
    });
    // Angle positif : le bout côté mur avance vers l'arrivée, le collet recule (référence :
    // la même ligne perpendiculaire à Γ, angle imposé nul).
    const ref = run({
      ...base,
      nosingOverrides: [{ kind: "angle" as const, index: 2, angle: 0 }],
    }).stepping;
    expect(left.nosings[2]!.sigmaOuter).toBeGreaterThan(ref.nosings[2]!.sigmaOuter);
    expect(left.nosings[2]!.sigmaInner).toBeLessThan(ref.nosings[2]!.sigmaInner);
  });

  it("angle imposé qui croise la ligne voisine : K5 signalé", () => {
    const st = run({ ...base, nosingOverrides: [{ kind: "angle", index: 3, angle: 60 }] }).stepping;
    expect(findCrossings(st.nosings).length).toBeGreaterThan(0);
    expect(frList(st.notes).some((n) => n.startsWith("K5 :"))).toBe(true);
  });

  it("surcharges orphelines : signalées, non appliquées", () => {
    const st = run({
      ...base,
      nosingOverrides: [
        { kind: "fixed", index: 99 },
        { kind: "angle", index: 42, angle: 3 },
      ],
    }).stepping;
    expect(frList(st.notes).filter((n) => n.startsWith("Surcharge orpheline"))).toHaveLength(2);
    // Bornes : le nez n − 1 existe (non orphelin), le nez n n'existe pas.
    const n = st.riserCount;
    const edge = run({
      ...base,
      nosingOverrides: [
        { kind: "angle", index: n - 1, angle: 0 },
        { kind: "fixed", index: n },
      ],
    }).stepping;
    const orphans = frList(edge.notes).filter((m) => m.startsWith("Surcharge orpheline"));
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toContain(`nez ${n} `);
    expect(st.balancedZones).toEqual(run(base).stepping.balancedZones);
  });
});

describe("marches (polygones)", () => {
  it("surface CCW contenant le point milieu de Γ ; contour = surface + débord", () => {
    const { stepping, layout } = run({ width: 900, legs: [2000, 2900], treads: { nosing: 20 } });
    for (const t of stepping.treads) {
      const a = stepping.nosings[t.number - 1]!;
      const b = stepping.nosings[t.number]!;
      expect(signedArea(t.walkingSurface)).toBeGreaterThan(0);
      const mid = V.lerp(V.lerp(a.q, b.q, 0.5), V.lerp(a.r, b.r, 0.5), 0.5);
      expect(pointInPolygon(mid, t.walkingSurface)).not.toBe("outside");
      expect(signedArea(t.outline)).toBeGreaterThan(signedArea(t.walkingSurface));
      for (const p of t.walkingSurface) {
        expect(pointInPolygon(p, layout.footprint, 1e-3)).not.toBe("outside");
      }
    }
    // Somme des surfaces = emprise.
    const total = stepping.treads.reduce((s, t) => s + signedArea(t.walkingSurface), 0);
    expect(total).toBeCloseTo(signedArea(layout.footprint), 0);
  });
});

describe("exemples du dépôt", () => {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json"));
  it.each(files)("%s : découpage calculé sans croisement", (file) => {
    const project = parseProjectText(readFileSync(new URL(file, EXAMPLES_DIR), "utf8"));
    const layout = computeLayout(project);
    const st = computeStepping(project, layout);
    expect(Math.abs(st.rises.reduce((a, b) => a + b, 0) - project.site.floorToFloor)).toBeLessThan(
      1e-6,
    );
    expect(findCrossings(st.nosings)).toEqual([]);
    expect(st.treads).toHaveLength(st.riserCount - 1);
  });

  it("cas d'acceptation n° 1 : quart tournant bas à poteau, collet ≥ 100 mm", () => {
    const project = parseProjectText(
      readFileSync(new URL("acceptance-01-quart-tournant.blondel.json", EXAMPLES_DIR), "utf8"),
    );
    const st = computeStepping(project, computeLayout(project));
    const winders = st.treads.filter((t) => t.kind === "winder");
    expect(Math.min(...winders.map((t) => t.colletChord))).toBeGreaterThanOrEqual(100);
    // Zone minimale atteignant la cible (CHALLENGE G3 corrigé) : nez 0 → 4 (3 nez balancés),
    // dans l'étendue K7. Poteau d'angle : K3 en corde non garanti (aucun candidat régulier,
    // la corde de la marche d'angle coupe le poteau ; ledger §2).
    expect(st.balancedZones.map((z) => [z.from, z.to])).toEqual([[0, 4]]);
    expect(monotonyBreaks(winders.map((t) => t.colletArc).slice(0, 4))).toEqual([]);
  });
});

describe("contour de marche coupé au nez suivant (intégration)", () => {
  it("two-quarters-u : le contour de M5 ne file pas sous la volée suivante", () => {
    // Régression (ledger §3, [review:pipeline → core:stepping]) : la ligne du nez 5 passe par
    // l'angle vif du jour et est presque parallèle à la 3e volée ; le débord derrière ce nez
    // ne recoupait le jour qu'en (−400 ; −70,7), au-delà du nez 6.
    // Volées de l'ancien préréglage U (1 120 / 2 100 / 2 625), figées : le préréglage place
    // désormais le premier tournant à 2 girons du départ et n'expose plus ce cas.
    const project = createProject("two-quarters-u", {
      patch: { stair: { layout: { legs: [1120, 2100, 2625].map((length) => ({ length })) } } },
    });
    const layout = computeLayout(project);
    const st = computeStepping(project, layout);
    // Le cas étudié : nez 5 fixe, par l'angle vif du premier tournant.
    expect(st.nosings[5]!.balanced).toBe(false);
    expect(st.nosings[5]!.q.x).toBeCloseTo(-400, 6);
    const m5 = st.treads[4]!;
    const union = [m5.walkingSurface, st.treads[5]!.walkingSurface];
    for (const v of m5.outline) {
      expect(
        union.some((poly) => pointInPolygon(v, poly, 1e-2) !== "outside"),
        `sommet (${v.x.toFixed(1)} ; ${v.y.toFixed(1)}) hors de M5 ∪ M6`,
      ).toBe(true);
    }
    expect(Math.min(...m5.outline.map((v) => v.y))).toBeGreaterThan(-1e-6);
  });
});

describe("préréglages : étendue du balancement (non-régression, CHALLENGE G3 corrigé)", () => {
  // Régression constatée en ligne le 2026-09-29 : le quart tournant balançait les nez 2 → 12
  // (toute la seconde volée). Chaque zone automatique reste dans l'étendue K7 (3,5 girons
  // depuis l'angle) : nez fixes encadrants à au plus 3,5 girons du début / de la fin de la
  // partie tournante, et nombre de nez balancés ≤ nombre de nez dans cette étendue.
  const cases: [string, Parameters<typeof createProject>[1]][] = [];
  for (const id of PRESET_IDS) {
    for (const width of [undefined, 700, 1000, 1200]) {
      for (const floorToFloor of [2500, 2700, 2900]) {
        cases.push([`${id} E=${width ?? "défaut"} H=${floorToFloor}`, { width, floorToFloor }]);
      }
    }
  }
  it.each(cases)("%s", (label, options) => {
    const id = label.split(" ")[0] as (typeof PRESET_IDS)[number];
    const project = createProject(id, options);
    const layout = computeLayout(project);
    const st = computeStepping(project, layout);
    const reach = MAX_BALANCED_EXTENT * st.going + 1e-6;
    for (const z of st.balancedZones) {
      const sFrom = st.nosings[z.from]!.s;
      const sTo = st.nosings[z.to]!.s;
      const sStart = layout.turns[z.turn]!.sStart;
      // Dernier tournant de la zone (zone unique de 180° : le suivant).
      const sEnd = Math.max(...layout.turns.filter((t) => t.sStart < sTo).map((t) => t.sEnd));
      expect(sStart - sFrom, label).toBeLessThanOrEqual(reach);
      expect(sTo - sEnd, label).toBeLessThanOrEqual(reach);
      const balanced = st.nosings.filter((nl) => nl.index > z.from && nl.index < z.to).length;
      const bound = st.nosings.filter((nl) => nl.s > sStart - reach && nl.s < sEnd + reach).length;
      expect(balanced, label).toBeLessThanOrEqual(bound);
    }
  });

  it.each(cases)(
    "%s : arrêt anticipé de l'énumération = énumération complète",
    (label, options) => {
      // Relecture : l'équivalence n'était vérifiée que par un test temporaire supprimé.
      const id = label.split(" ")[0] as (typeof PRESET_IDS)[number];
      const project = createProject(id, options);
      const layout = computeLayout(project);
      expect(computeStepping(project, layout), label).toEqual(
        computeStepping(project, layout, { exhaustiveZoneSearch: true }),
      );
    },
  );

  it.each(cases.filter(([label]) => label.startsWith("quarter-")))(
    "%s : aucune zone symétrique plus petite n'atteint la cible (zone minimale G3)",
    (label, options) => {
      const id = label.split(" ")[0] as (typeof PRESET_IDS)[number];
      const project = createProject(id, options);
      const layout = computeLayout(project);
      const st = computeStepping(project, layout);
      const count = st.nosings.filter((nl) => nl.balanced).length;
      const target = project.stair.balancing.targetCollet;
      if (Math.min(...st.treads.map((t) => t.colletChord)) < target - 1e-6) return;
      const reach = MAX_BALANCED_EXTENT * st.going + 1e-6;
      const turn = layout.turns[0]!;
      for (let w = 1; 2 * w < count; w++) {
        const p = {
          ...project,
          stair: { ...project.stair, balancing: { ...project.stair.balancing, windersPerSide: w } },
        };
        const f = computeStepping(p, layout);
        const z = f.balancedZones[0];
        if (!z) continue;
        const within =
          turn.sStart - f.nosings[z.from]!.s <= reach && f.nosings[z.to]!.s - turn.sEnd <= reach;
        const ok =
          within &&
          f.nosings.filter((nl) => nl.balanced).length < count &&
          monotonyBreaks(f.treads.map((t) => t.colletChord)).length === 0 &&
          monotonyBreaks(f.treads.map((t) => t.colletArc)).length === 0 &&
          findCrossings(f.nosings).length === 0 &&
          !frList(f.notes).some((n) => n.includes("recoupe le jour"));
        expect(
          ok && Math.min(...f.treads.map((t) => t.colletChord)) >= target - 1e-6,
          `${label} w=${w}`,
        ).toBe(false);
      }
    },
  );

  it("aucune zone admissible dans l'étendue K7 : repli au-delà, signalé (pas de nez perpendiculaires)", () => {
    // Relecture : U à étendue de 0,5 giron — les deux tournants restaient perpendiculaires,
    // collets nuls (marches 3, 4, 7, 8), alors que des zones plus étendues sont admissibles.
    for (const maxBalancedExtent of [0.1, 0.5]) {
      const base = createProject("two-quarters-u");
      const project = {
        ...base,
        stair: { ...base.stair, balancing: { ...base.stair.balancing, maxBalancedExtent } },
      };
      const layout = computeLayout(project);
      const st = computeStepping(project, layout);
      const ctx = frList(st.notes).join("\n");
      expect(st.balancedZones, ctx).toHaveLength(2);
      expect(
        frList(st.notes).filter((n) => n.includes("étendue dépassée")),
        ctx,
      ).toHaveLength(2);
      expect(
        frList(st.notes).some((n) => n.includes("aucun balancement admissible")),
        ctx,
      ).toBe(false);
      expect(findCrossings(st.nosings), ctx).toEqual([]);
      expect(Math.min(...st.treads.map((t) => t.colletChord)), ctx).toBeGreaterThan(0);
      expect(computeStepping(project, layout, { exhaustiveZoneSearch: true })).toEqual(st);
    }
    // Étendue suffisante : pas de repli.
    const project = createProject("two-quarters-u");
    const st = computeStepping(project, computeLayout(project));
    expect(frList(st.notes).some((n) => n.includes("étendue dépassée"))).toBe(false);
  });

  it("quart tournant gauche / droit (préréglage) : pas toute la seconde volée", () => {
    for (const id of ["quarter-left", "quarter-right"] as const) {
      const project = createProject(id);
      const st = computeStepping(project, computeLayout(project));
      const balanced = st.nosings.filter((nl) => nl.balanced).length;
      expect(balanced, id).toBeLessThanOrEqual(6);
      expect(st.balancedZones[0]!.to, id).toBeLessThanOrEqual(7);
      expect(Math.min(...st.treads.map((t) => t.colletChord)), id).toBeGreaterThanOrEqual(100);
    }
  });
});
