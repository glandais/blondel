import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { curveLength } from "../geom2d/curve.js";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { computeLayout } from "../layout/layout.js";
import { LayoutError } from "../layout/errors.js";
import { findCrossings, monotonyBreaks } from "../balancing/postprocess.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { BalancingSchema } from "../model/project.js";
import { SteppingError } from "./errors.js";
import { computeStepping, resolveM3Variant } from "./stepping.js";
import {
  COLLET_TIE_TOLERANCE,
  pickZone,
  WINDERS_PER_SIDE_MAX,
  zoneEndConditions,
  type ZoneEvaluation,
} from "./zones.js";
import { makeSteppingProject, type SteppingShape } from "./test-helpers.js";

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
    expect(low.notes.some((n) => n.includes("5 marches balancées demandées"))).toBe(true);
    expect(low.balancedZones[0]!.from).toBe(0);
  });

  it("choix automatique (CHALLENGE G3) : collet en corde maximal parmi les zones admissibles", () => {
    // Toute zone symétrique imposée (1 à 8 nez de chaque côté) est un candidat de l'énumération
    // automatique : le collet retenu en `auto` est au moins aussi grand (à 1 mm près).
    const minChord = (st: ReturnType<typeof run>["stepping"]) =>
      Math.min(...st.treads.map((t) => t.colletChord));
    for (const legs of [
      [2400, 2400],
      [1600, 3200],
    ]) {
      const auto = run({ width: 800, legs }).stepping;
      for (let w = 1; w <= WINDERS_PER_SIDE_MAX; w++) {
        const forced = run({ width: 800, legs, balancing: { windersPerSide: w } }).stepping;
        const regular = monotonyBreaks(forced.treads.map((t) => t.colletChord)).length === 0;
        if (!regular || findCrossings(forced.nosings).length > 0) continue;
        expect(minChord(auto), `${legs} w=${w}`).toBeGreaterThanOrEqual(
          minChord(forced) - COLLET_TIE_TOLERANCE,
        );
      }
    }
  });

  it("choix automatique : à collet égal (± 1 mm), le moins de nez balancés", () => {
    const cand = (from: number, to: number, minChord: number, offCenter = 0): ZoneEvaluation => ({
      zone: { turn: 0, from, to, collarSide: "left", ends: ["tangent", "tangent"] },
      ok: true,
      nosings: [],
      corrected: [],
      minChord,
      minArc: minChord,
      k5: true,
      k3: true,
      winders: to - from - 1,
      offCenter,
    });
    // 131,0 est à moins de 1 mm du maximum 131,8 : 3 nez balancés plutôt que 7.
    const few = cand(4, 8, 131);
    const many = cand(2, 10, 131.8);
    expect(pickZone([many, few, cand(5, 7, 90)])).toBe(few);
    // Au-delà de 1 mm, le collet maximal l'emporte même avec plus de nez balancés.
    const more = cand(2, 10, 132.2);
    expect(pickZone([few, more])).toBe(more);
    // Collet cible (100) non discriminant : le maximum est retenu même au-dessus de la cible.
    expect(pickZone([cand(5, 8, 105), cand(3, 10, 140)])!.zone.from).toBe(3);
    // Candidats non admissibles (K5, collet nul) ignorés ; aucun admissible → null.
    expect(pickZone([{ ...more, k5: false }, few])).toBe(few);
    expect(pickZone([{ ...more, minChord: 0, minArc: 0 }])).toBeNull();
    // Régularité (K3) prioritaire quand un candidat régulier existe.
    expect(pickZone([{ ...more, k3: false }, few])).toBe(few);
  });

  it("tolérance d'égalité des collets : paramètre du projet (défaut 1 mm, à valider)", () => {
    // Relecture : la tolérance était un seuil figé dans le code, sans source métier.
    const cand = (from: number, to: number, minChord: number): ZoneEvaluation => ({
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
    });
    const few = cand(4, 8, 131);
    const many = cand(2, 10, 131.8);
    expect(pickZone([many, few])).toBe(few);
    expect(pickZone([many, few], 0)).toBe(many);
    expect(pickZone([many, cand(5, 7, 90)], 50)!.winders).toBe(1);
    expect(() => pickZone([few], -1)).toThrow(RangeError);
    expect(() => pickZone([few], Number.NaN)).toThrow(RangeError);
    expect(BalancingSchema.parse({}).colletTieTolerance).toBeUndefined();
    expect(BalancingSchema.safeParse({ colletTieTolerance: -1 }).success).toBe(false);
    // Bout en bout (quart médian) : 0 = collet maximal pur ; très grande tolérance = le moins
    // de nez balancés parmi les zones régulières.
    const count = (st: ReturnType<typeof run>["stepping"]) =>
      st.nosings.filter((nl) => nl.balanced).length;
    const minChord = (st: ReturnType<typeof run>["stepping"]) =>
      Math.min(...st.treads.map((t) => t.colletChord));
    const legs = [2400, 2400];
    const byDefault = run({ width: 800, legs }).stepping;
    const pure = run({ width: 800, legs, balancing: { colletTieTolerance: 0 } }).stepping;
    const loose = run({ width: 800, legs, balancing: { colletTieTolerance: 1000 } }).stepping;
    expect(minChord(pure)).toBeGreaterThanOrEqual(minChord(byDefault) - 1e-6);
    expect(minChord(byDefault)).toBeGreaterThanOrEqual(minChord(pure) - COLLET_TIE_TOLERANCE);
    expect(count(loose)).toBeLessThan(count(byDefault));
  });

  it("borne de zone dans la partie tournante : extrémité libre, sinon tangente", () => {
    // Quart tournant médian à jour vif (arc de Γ : s ∈ [1 600 ; 2 228], girons de 273,4 mm),
    // 1 nez de chaque côté : nez fixes 5 (s = 1 367, partie droite → tangente) et 8
    // (s = 2 188, dans l'arc : aucune partie droite ne continue → libre).
    const inner = run({ width: 800, legs: [2400, 2400], balancing: { windersPerSide: 1 } });
    expect(inner.stepping.balancedZones[0]).toMatchObject({ from: 5, to: 8 });
    expect(inner.stepping.notes.some((n) => n.includes("extrémités tangente/libre"))).toBe(true);
    // 2 nez de chaque côté : nez fixes 4 et 9 dans les parties droites → tangentes.
    const outer = run({ width: 800, legs: [2400, 2400], balancing: { windersPerSide: 2 } });
    expect(outer.stepping.balancedZones[0]).toMatchObject({ from: 4, to: 9 });
    expect(outer.stepping.notes.some((n) => n.includes("extrémités tangente/tangente"))).toBe(true);
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
    // Tournant médian : collet maximal (CHALLENGE G3), la zone encadre le tournant.
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
    expect(st.notes.some((n) => n.includes("collet nul"))).toBe(true);
  });

  it("M1 : profil en V, jarret signalé, K3", () => {
    // Zone imposée (3 de chaque côté) : extrémités tangentes, donc jarret d'entrée de zone.
    const st = run({
      width: 800,
      legs: [2400, 2400],
      balancing: { method: "M1", windersPerSide: 3 },
    }).stepping;
    expect(st.balancedZones[0]!.method).toBe("M1");
    expect(st.notes.some((n) => n.includes("jarret"))).toBe(true);
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
    expect(stepping.notes.some((n) => n.includes("recoupe le jour"))).toBe(false);
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
    expect(st.notes.some((n) => n.includes("zone unique"))).toBe(true);
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
    expect(stepping.notes.some((n) => n.startsWith("Paliers :"))).toBe(true);
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
    expect(st.notes.some((n) => n.startsWith("K5 :"))).toBe(true);
  });

  it("surcharges orphelines : signalées, non appliquées", () => {
    const st = run({
      ...base,
      nosingOverrides: [
        { kind: "fixed", index: 99 },
        { kind: "angle", index: 42, angle: 3 },
      ],
    }).stepping;
    expect(st.notes.filter((n) => n.startsWith("Surcharge orpheline"))).toHaveLength(2);
    // Bornes : le nez n − 1 existe (non orphelin), le nez n n'existe pas.
    const n = st.riserCount;
    const edge = run({
      ...base,
      nosingOverrides: [
        { kind: "angle", index: n - 1, angle: 0 },
        { kind: "fixed", index: n },
      ],
    }).stepping;
    const orphans = edge.notes.filter((m) => m.startsWith("Surcharge orpheline"));
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
    expect(monotonyBreaks(winders.map((t) => t.colletChord))).toEqual([]);
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
