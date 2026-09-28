/**
 * Tracé : cas de référence (droit, quarts tournants, U, demi-tournant, palier, raccords de jour)
 * et erreurs explicites.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  curveEnd,
  curveLength,
  curvePointAt,
  curveStart,
  curveTangentAt,
  isContinuous,
} from "../geom2d/curve.js";
import { distanceToCurve } from "../geom2d/intersect.js";
import { offsetCurve } from "../geom2d/offset.js";
import { signedArea } from "../geom2d/polygon.js";
import { segStart } from "../geom2d/segment.js";
import type { Curve2, Vec2 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { LayoutError } from "./errors.js";
import { computeLayout } from "./layout.js";
import { getRule } from "../rules/table.js";
import {
  AUTO_GOING_MODULE,
  resolveLegLengths,
  resolveStraightRun,
  resolveWalklineOffset,
} from "./resolve.js";
import { makeProject } from "./test-helpers.js";

const EPS = 1e-6;
const expectPoint = (p: Vec2, x: number, y: number, tol = EPS): void => {
  expect(Math.abs(p.x - x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(p.y - y)).toBeLessThanOrEqual(tol);
};
/** Sommets (débuts de segments + fin) d'une courbe. */
const vertices = (c: Curve2): Vec2[] => [...c.segments.map(segStart), curveEnd(c)];

describe("computeLayout — escalier droit", () => {
  it("Γ au milieu, de longueur L, bords parallèles à distance E", () => {
    const layout = computeLayout(makeProject({ width: 900, legs: [3600] }));
    expect(layout.innerSide).toBe("left");
    expect(layout.walklineOffset).toBe(450);
    expect(curveLength(layout.walkline)).toBeCloseTo(3600, 9);
    expectPoint(curveStart(layout.walkline), 450, 0);
    expectPoint(curveEnd(layout.walkline), 450, 3600);
    expectPoint(curveStart(layout.inner), 0, 0);
    expectPoint(curveEnd(layout.inner), 0, 3600);
    expectPoint(curveStart(layout.outer), 900, 0);
    expectPoint(curveEnd(layout.outer), 900, 3600);
    expect(layout.turns).toEqual([]);
    expect(signedArea(layout.footprint)).toBeCloseTo(900 * 3600, 6);
  });

  it("longueur `auto` = reculement (n − 1)·g (n = arrondi(H / 175), g = 630 − 2h)", () => {
    const project = makeProject({ width: 800, legs: ["auto"], floorToFloor: 2700 });
    // n = 15, h = 180, g = 270, R = 14 × 270.
    expect(resolveStraightRun(project)).toBeCloseTo(3780, 9);
    expect(resolveLegLengths(project)).toEqual([resolveStraightRun(project)]);
    expect(curveLength(computeLayout(project).walkline)).toBeCloseTo(3780, 9);
  });

  it("longueur `auto` avec giron et nombre de hauteurs saisis", () => {
    const project = makeProject({ width: 800, legs: ["auto"] });
    const p: Project = {
      ...project,
      stair: {
        ...project.stair,
        stepping: { ...project.stair.stepping, riserCount: 16, targetGoing: 250 },
      },
    };
    expect(curveLength(computeLayout(p).walkline)).toBeCloseTo(15 * 250, 9);
  });

  it("option `legLengths` : longueurs résolues par l'appelant", () => {
    const project = makeProject({ width: 800, legs: ["auto"] });
    expect(curveLength(computeLayout(project, { legLengths: [3210] }).walkline)).toBeCloseTo(
      3210,
      9,
    );
  });

  it("ligne de foulée DTU à 600 mm au-delà de E = 1 200, ou saisie", () => {
    expect(computeLayout(makeProject({ width: 1200, legs: [3000] })).walklineOffset).toBe(600);
    expect(computeLayout(makeProject({ width: 1400, legs: [3000] })).walklineOffset).toBe(600);
    const layout = computeLayout(
      makeProject({ width: 1000, legs: [3000], walkline: { mode: "fromInner", distance: 350 } }),
    );
    expect(layout.walklineOffset).toBe(350);
    expectPoint(curveStart(layout.walkline), 350, 0);
  });

  it("placement : rotation (degrés, sens trigonométrique) puis translation", () => {
    const layout = computeLayout(
      makeProject({ width: 800, legs: [3000], origin: { x: 1000, y: 500 }, rotation: 90 }),
    );
    expectPoint(curveStart(layout.inner), 1000, 500);
    expectPoint(curveStart(layout.outer), 1000, 1300);
    expectPoint(curveEnd(layout.inner), -2000, 500);
    expectPoint(curveStart(layout.walkline), 1000, 900);
  });
});

describe("computeLayout — quart tournant", () => {
  it("gauche, angle vif : sommets, arc de Γ centré sur le coin, longueur exacte", () => {
    const layout = computeLayout(makeProject({ width: 800, legs: [2000, 1500] }));
    expect(layout.innerSide).toBe("left");
    const inner = vertices(layout.inner);
    expect(inner).toHaveLength(3);
    expectPoint(inner[0]!, 0, 0);
    expectPoint(inner[1]!, 0, 1200);
    expectPoint(inner[2]!, -700, 1200);
    const outer = vertices(layout.outer);
    expectPoint(outer[1]!, 800, 2000);
    expectPoint(outer[2]!, -700, 2000);
    // Γ : 1 200 + (π/2)·400 + 700.
    expect(curveLength(layout.walkline)).toBeCloseTo(1200 + 200 * Math.PI + 700, 9);
    const arc = layout.walkline.segments[1]!;
    expect(arc.kind).toBe("arc");
    if (arc.kind === "arc") {
      expectPoint(arc.center, 0, 1200);
      expect(arc.radius).toBe(400);
      expect(arc.sweep).toBeCloseTo(Math.PI / 2, 12);
    }
    const [turn] = layout.turns;
    expect(turn).toBeDefined();
    expectPoint(turn!.innerCorner, 0, 1200);
    expectPoint(turn!.outerCorner, 800, 2000);
    expect(turn!.sStart).toBeCloseTo(1200, 9);
    expect(turn!.sEnd).toBeCloseTo(1200 + 200 * Math.PI, 9);
    expect(turn!.mode).toBe("winders");
    expect(turn!.direction).toBe("left");
    // Aire utile : E·L1 + E·(L2 − E).
    expect(signedArea(layout.footprint)).toBeCloseTo(800 * 2000 + 800 * 700, 6);
  });

  it("droite, angle vif : image miroir", () => {
    const layout = computeLayout(
      makeProject({ width: 800, legs: [2000, 1500], direction: "right" }),
    );
    expect(layout.innerSide).toBe("right");
    const inner = vertices(layout.inner);
    expectPoint(inner[0]!, 800, 0);
    expectPoint(inner[1]!, 800, 1200);
    expectPoint(inner[2]!, 1500, 1200);
    const outer = vertices(layout.outer);
    expectPoint(outer[0]!, 0, 0);
    expectPoint(outer[1]!, 0, 2000);
    expectPoint(outer[2]!, 1500, 2000);
    expectPoint(curveStart(layout.walkline), 400, 0);
    expectPoint(curveEnd(layout.walkline), 1500, 1600);
    expect(curveLength(layout.walkline)).toBeCloseTo(1200 + 200 * Math.PI + 700, 9);
    expect(
      layout.walkline.segments[1]!.kind === "arc" && layout.walkline.segments[1]!.sweep,
    ).toBeCloseTo(-Math.PI / 2, 12);
    expect(signedArea(layout.footprint)).toBeGreaterThan(0);
  });

  it("formule : |Γ| = L1 + L2 − 2E + (π/2)·d_f (angle vif) pour plusieurs cas", () => {
    for (const [E, L1, L2, dir] of [
      [800, 1280, 3051, "left"],
      [900, 900, 900, "right"],
      [1300, 2500, 1800, "left"],
    ] as const) {
      const layout = computeLayout(makeProject({ width: E, legs: [L1, L2], direction: dir }));
      const df = layout.walklineOffset;
      expect(curveLength(layout.walkline)).toBeCloseTo(L1 + L2 - 2 * E + (Math.PI / 2) * df, 9);
    }
  });

  it("jour en arc de rayon r : Γ = arc de rayon r + d_f centré sur le centre du raccord", () => {
    const layout = computeLayout(
      makeProject({ width: 800, legs: [2000, 1500], inner: { kind: "arc", radius: 200 } }),
    );
    // |Γ| = L1 + L2 − 2E − 2r + (π/2)(r + d_f).
    expect(curveLength(layout.walkline)).toBeCloseTo(3500 - 1600 - 400 + 300 * Math.PI, 9);
    const inner = layout.inner.segments;
    expect(inner.map((s) => s.kind)).toEqual(["line", "arc", "line"]);
    const arc = inner[1]!;
    if (arc.kind === "arc") {
      expectPoint(arc.center, -200, 1000);
      expect(arc.radius).toBe(200);
    }
    const w = layout.walkline.segments[1]!;
    if (w.kind === "arc") {
      expectPoint(w.center, -200, 1000);
      expect(w.radius).toBe(600);
    }
    expect(layout.turns[0]!.sStart).toBeCloseTo(1000, 9);
    expect(layout.turns[0]!.sEnd - layout.turns[0]!.sStart).toBeCloseTo(300 * Math.PI, 9);
    // Coin intérieur = intersection (virtuelle) des faces internes.
    expectPoint(layout.turns[0]!.innerCorner, 0, 1200);
  });

  it("poteau : C_i suit le poteau côté escalier, Γ centré sur le coin (centre du poteau)", () => {
    const sharp = computeLayout(makeProject({ width: 800, legs: [2000, 1500] }));
    const newel = computeLayout(
      makeProject({ width: 800, legs: [2000, 1500], inner: { kind: "newel", size: 100 } }),
    );
    expect(newel.walkline).toEqual(sharp.walkline);
    const pts = vertices(newel.inner);
    const expected: [number, number][] = [
      [0, 0],
      [0, 1150],
      [50, 1150],
      [50, 1250],
      [-50, 1250],
      [-50, 1200],
      [-700, 1200],
    ];
    expect(pts).toHaveLength(expected.length);
    expected.forEach(([x, y], i) => expectPoint(pts[i]!, x, y));
    expect(curveLength(newel.inner)).toBeCloseTo(1150 + 50 + 100 + 100 + 50 + 650, 9);
    // Distance minimale de Γ au poteau : d_f − a·√2/2.
    expect(
      distanceToCurve({ x: 400 * Math.SQRT1_2, y: 1200 + 400 * Math.SQRT1_2 }, newel.inner),
    ).toBeCloseTo(400 - 50 * Math.SQRT2, 9);
  });

  it("angle vif : Γ coïncide avec le décalé générique de C_i (offsetCurve)", () => {
    for (const direction of ["left", "right"] as const) {
      const layout = computeLayout(makeProject({ width: 900, legs: [2400, 2000], direction }));
      const off = offsetCurve(layout.inner, 450, direction === "left" ? "right" : "left");
      expect(curveLength(off)).toBeCloseTo(curveLength(layout.walkline), 6);
      expectPoint(curveEnd(off), curveEnd(layout.walkline).x, curveEnd(layout.walkline).y);
    }
  });

  it("palier d'angle : même Γ que le balancé, zone [sStart, sEnd] = carré d'angle", () => {
    const winders = computeLayout(makeProject({ width: 800, legs: [2000, 1500] }));
    const landing = computeLayout(makeProject({ width: 800, legs: [2000, 1500], mode: "landing" }));
    expect(landing.walkline).toEqual(winders.walkline);
    const turn = landing.turns[0]!;
    expect(turn.mode).toBe("landing");
    // Perpendiculaires à Γ aux bornes de la zone = bords du carré E × E.
    const pA = curvePointAt(landing.walkline, turn.sStart);
    const tA = curveTangentAt(landing.walkline, turn.sStart);
    expectPoint(pA, 400, 1200);
    expectPoint(tA, 0, 1);
    const pB = curvePointAt(landing.walkline, turn.sEnd);
    const tB = curveTangentAt(landing.walkline, turn.sEnd);
    expectPoint(pB, 0, 1600);
    expectPoint(tB, -1, 0);
  });
});

describe("computeLayout — relecture : cas complémentaires", () => {
  it("jour en arc : Γ coïncide avec le décalé générique de C_i (B §2.1), gauche et droite", () => {
    for (const direction of ["left", "right"] as const) {
      for (const radius of [1, 50, 300]) {
        const layout = computeLayout(
          makeProject({
            width: 900,
            legs: [2400, 2600, 3000],
            direction,
            inner: { kind: "arc", radius },
          }),
        );
        const off = offsetCurve(layout.inner, 450, direction === "left" ? "right" : "left");
        const length = curveLength(layout.walkline);
        expect(curveLength(off)).toBeCloseTo(length, 6);
        for (const f of [0, 0.1, 0.33, 0.5, 0.8, 1]) {
          const p = curvePointAt(layout.walkline, f * length);
          const q = curvePointAt(off, f * length);
          expectPoint(q, p.x, p.y);
        }
      }
    }
  });

  it("palier d'angle et jour en arc : bornes de zone aux points de tangence (r avant K)", () => {
    const layout = computeLayout(
      makeProject({
        width: 800,
        legs: [2000, 1500],
        mode: "landing",
        inner: { kind: "arc", radius: 200 },
      }),
    );
    const turn = layout.turns[0]!;
    // K = (0, 1 200) ; tangence à 200 mm avant K sur chaque volée.
    expectPoint(curvePointAt(layout.walkline, turn.sStart), 400, 1000);
    expectPoint(curveTangentAt(layout.walkline, turn.sStart), 0, 1);
    expectPoint(curvePointAt(layout.walkline, turn.sEnd), -200, 1600);
    expectPoint(curveTangentAt(layout.walkline, turn.sEnd), -1, 0);
  });

  it("quatre volées (trois tournants de même sens) : |Γ| exacte, courbes continues", () => {
    for (const direction of ["left", "right"] as const) {
      const layout = computeLayout(
        makeProject({ width: 800, legs: [2000, 2000, 2000, 2500], direction }),
      );
      expect(curveLength(layout.walkline)).toBeCloseTo(8500 - 3 * 1600 + 3 * 200 * Math.PI, 9);
      expect(isContinuous(layout.inner)).toBe(true);
      expect(isContinuous(layout.outer)).toBe(true);
      expect(layout.turns.map((t) => t.index)).toEqual([0, 1, 2]);
      // Quatrième volée : montée selon ±X, retour vers le départ.
      const end = curveTangentAt(layout.walkline, curveLength(layout.walkline));
      expectPoint(end, direction === "left" ? 1 : -1, 0);
    }
  });

  it("module du giron `auto` (630) = valeur recommandée de BLONDEL_DTU dans rules.yaml", () => {
    expect(getRule("BLONDEL_DTU").recommande).toBe(AUTO_GOING_MODULE);
  });
});

describe("computeLayout — deux quarts (U) et demi-tournant", () => {
  it("U : volée centrale 2E + jour, |Γ| = ΣL − 4E + 2·(π/2)·d_f", () => {
    const layout = computeLayout(makeProject({ width: 800, legs: [2000, 2000, 1500] }));
    expect(curveLength(layout.walkline)).toBeCloseTo(5500 - 3200 + 400 * Math.PI, 9);
    const inner = vertices(layout.inner);
    expectPoint(inner[1]!, 0, 1200);
    expectPoint(inner[2]!, -400, 1200);
    expectPoint(inner[3]!, -400, 500);
    const outer = vertices(layout.outer);
    expectPoint(outer[3]!, -1200, 500);
    expect(layout.turns.map((t) => t.index)).toEqual([0, 1]);
    expect(layout.turns[1]!.sStart).toBeCloseTo(1200 + 200 * Math.PI + 400, 9);
    expectPoint(curveEnd(layout.walkline), -800, 500);
    expect(signedArea(layout.footprint)).toBeGreaterThan(0);
  });

  it("demi-tournant balancé à jour nul (mur d'échiffre) : deux arcs contigus", () => {
    const layout = computeLayout(makeProject({ width: 800, legs: [1500, 1600, 1500] }));
    expect(curveLength(layout.walkline)).toBeCloseTo(700 + 700 + 400 * Math.PI, 9);
    expect(layout.walkline.segments.map((s) => s.kind)).toEqual(["line", "arc", "arc", "line"]);
    expect(isContinuous(layout.walkline)).toBe(true);
    expect(layout.turns[0]!.sEnd).toBeCloseTo(layout.turns[1]!.sStart, 9);
    expectPoint(curveEnd(layout.walkline), -400, 0);
  });

  it("demi-tournant avec jour et poteaux", () => {
    const layout = computeLayout(
      makeProject({
        width: 900,
        legs: [2000, 2000, 2000],
        direction: "right",
        inner: { kind: "newel", size: 90 },
      }),
    );
    expect(curveLength(layout.walkline)).toBeCloseTo(6000 - 3600 + 450 * Math.PI, 9);
    expect(isContinuous(layout.inner)).toBe(true);
  });
});

describe("computeLayout — exemples du dépôt", () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
  const files = readdirSync(dir).filter((f) => f.endsWith(".blondel.json"));

  it.each(files)("%s : tracé calculé, |Γ| en forme fermée", (file) => {
    const project = parseProjectText(readFileSync(join(dir, file), "utf8"));
    const layout = computeLayout(project);
    const spec = project.stair.layout;
    // Préréglages : jour vif ou poteau (Γ identique), d_f = E/2 :
    // |Γ| = ΣL − 2E·(N − 1) + N·(π/2)·(E/2).
    const legs = resolveLegLengths(project);
    const N = spec.turns.length;
    const expected =
      legs.reduce((a, b) => a + b, 0) - 2 * spec.width * N + N * (Math.PI / 2) * (spec.width / 2);
    expect(spec.turns.every((t) => t.inner.kind !== "arc")).toBe(true);
    expect(resolveWalklineOffset(project)).toBe(spec.width / 2);
    expect(curveLength(layout.walkline)).toBeCloseTo(expected, 6);
    expect(layout.turns).toHaveLength(spec.turns.length);
  });
});

describe("computeLayout — erreurs explicites", () => {
  it("tournants de sens opposés (S/Z) : non supporté au MVP", () => {
    const p = makeProject({ width: 800, legs: [2000, 2000, 2000] });
    const turns = p.stair.layout.turns;
    const bad: Project = {
      ...p,
      stair: {
        ...p.stair,
        layout: { ...p.stair.layout, turns: [turns[0]!, { ...turns[1]!, direction: "right" }] },
      },
    };
    expect(() => computeLayout(bad)).toThrow(LayoutError);
    expect(() => computeLayout(bad)).toThrow(/non supporté au MVP/);
  });

  it("nombre de tournants incohérent", () => {
    const p = makeProject({ width: 800, legs: [2000, 2000] });
    const bad: Project = {
      ...p,
      stair: { ...p.stair, layout: { ...p.stair.layout, turns: [] } },
    };
    expect(() => computeLayout(bad)).toThrow(LayoutError);
  });

  it("`auto` hors escalier droit", () => {
    expect(() => computeLayout(makeProject({ width: 800, legs: ["auto", 2000] }))).toThrow(
      /escalier droit/,
    );
  });

  it("volée trop courte pour l'emmarchement et le raccord", () => {
    expect(() => computeLayout(makeProject({ width: 800, legs: [700, 2000] }))).toThrow(
      /volée 1 est trop courte/,
    );
    expect(() =>
      computeLayout(
        makeProject({ width: 800, legs: [900, 2000], inner: { kind: "arc", radius: 150 } }),
      ),
    ).toThrow(LayoutError);
    expect(() => computeLayout(makeProject({ width: 800, legs: [2000, 1500, 2000] }))).toThrow(
      /volée 2/,
    );
    // Limite exacte acceptée.
    expect(() => computeLayout(makeProject({ width: 800, legs: [800, 800] }))).not.toThrow();
  });

  it("ligne de foulée hors emmarchement ou traversant le poteau", () => {
    expect(() =>
      computeLayout(
        makeProject({ width: 800, legs: [3000], walkline: { mode: "fromInner", distance: 800 } }),
      ),
    ).toThrow(LayoutError);
    expect(() =>
      computeLayout(
        makeProject({
          width: 800,
          legs: [2000, 2000],
          inner: { kind: "newel", size: 100 },
          walkline: { mode: "fromInner", distance: 70 },
        }),
      ),
    ).toThrow(/poteau/);
  });

  it("longueurs résolues invalides", () => {
    const p = makeProject({ width: 800, legs: [2000, 2000] });
    expect(() => computeLayout(p, { legLengths: [2000] })).toThrow(LayoutError);
    expect(() => computeLayout(p, { legLengths: [2000, Number.NaN] })).toThrow(LayoutError);
  });

  it("giron `auto` non positif (hauteur de marche trop grande)", () => {
    const p = makeProject({ width: 800, legs: ["auto"], floorToFloor: 2700 });
    const bad: Project = {
      ...p,
      stair: { ...p.stair, stepping: { ...p.stair.stepping, riserCount: 2 } },
    };
    // h = 1 350, g = 630 − 2 700 < 0.
    expect(() => computeLayout(bad)).toThrow(/Giron cible non positif/);
  });

  it("nombre de hauteurs `auto` hors domaine", () => {
    const p = makeProject({ width: 800, legs: ["auto"], floorToFloor: 200 });
    expect(() => computeLayout(p)).toThrow(/hors domaine/);
  });
});
