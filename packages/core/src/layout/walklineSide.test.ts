import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { flattenCurve } from "../geom2d/curve.js";
import * as V from "../geom2d/vec.js";
import { buildModel } from "../pipeline/build.js";
import { ProjectSchema, type Project, type Wall } from "../model/project.js";
import { computeLayout } from "./layout.js";
import { makeProject } from "./test-helpers.js";
import { autoWalklineSide, resolveWalklineSide, straightSideKinds } from "./walklineSide.js";

const L = 4000;

/** Escalier droit E = 1 400 (d_f = 600 mm, DTU) avec murs et garde-corps facultatifs. */
function straight(
  over: {
    walls?: Wall[];
    side?: "left" | "right";
    guards?: unknown;
    rotation?: number;
    width?: number;
    walkline?: { mode: "fromInner"; distance: number };
  } = {},
): Project {
  const base = makeProject({
    width: over.width ?? 1400,
    legs: [L],
    ...(over.rotation !== undefined
      ? { rotation: over.rotation, origin: { x: 500, y: -300 } }
      : {}),
  });
  const walkline = over.walkline ?? { mode: "dtu" as const };
  return ProjectSchema.parse({
    ...base,
    site: { ...base.site, walls: over.walls ?? [] },
    stair: {
      ...base.stair,
      walkline: over.side !== undefined ? { ...walkline, side: over.side } : walkline,
    },
    ...(over.guards !== undefined ? { guards: over.guards } : {}),
  });
}

/** Mur d'axe x = `x` (repère local, placement nul), le long de toute la volée. */
const wallAt = (id: string, x: number): Wall => ({
  id,
  a: { x, y: 0 },
  b: { x, y: L },
  thickness: 200,
  loadBearing: false,
});
/** Mur au nu du bord gauche (axe à x = −100) ou droit (axe à x = E + 100). */
const leftWall = wallAt("g", -100);
const rightWall = (e = 1400): Wall => wallAt("d", e + 100);

/** Abscisse locale (x) de la ligne de foulée d'un escalier droit sans rotation. */
const walkX = (p: Project): number => flattenCurve(computeLayout(p).walkline)[0]!.x;

describe("bord de mesure de la ligne de foulée d'un escalier droit (A16)", () => {
  it("sans mur ni choix : bord gauche (à défaut), comportement antérieur", () => {
    const p = straight();
    expect(autoWalklineSide(p, L)).toBe("left");
    const layout = computeLayout(p);
    expect(layout.walklineSide).toBe("left");
    expect(layout.innerSide).toBe("left");
    expect(walkX(p)).toBeCloseTo(600, 9);
  });

  it("mur à gauche, vide à droite : côté vide (garde-corps, main courante principale)", () => {
    const p = straight({ walls: [leftWall] });
    expect(straightSideKinds(p, L)).toEqual({ left: "wall", right: "void" });
    expect(autoWalklineSide(p, L)).toBe("right");
    expect(walkX(p)).toBeCloseTo(800, 9);
    const layout = computeLayout(p);
    expect(layout.walklineSide).toBe("right");
    expect(layout.walklineOffset).toBe(600);
    // Les côtés inner / outer (garde-corps, structures) ne changent pas de sens.
    expect(layout.innerSide).toBe("left");
  });

  it("mur à droite, vide à gauche : côté vide (gauche)", () => {
    expect(autoWalklineSide(straight({ walls: [rightWall()] }), L)).toBe("left");
  });

  it("deux murs : côté de la main courante murale (droit en automatique, imposable)", () => {
    const walls = [leftWall, rightWall()];
    expect(autoWalklineSide(straight({ walls }), L)).toBe("right");
    expect(
      autoWalklineSide(straight({ walls, guards: { handrail: { wallSides: "inner" } } }), L),
    ).toBe("left");
    expect(
      autoWalklineSide(straight({ walls, guards: { handrail: { wallSides: "both" } } }), L),
    ).toBe("left");
  });

  it("nature imposée des côtés par les garde-corps (void / wall) prioritaire sur les murs", () => {
    const p = straight({ guards: { flight: { inner: "wall" } } });
    expect(straightSideKinds(p, L)).toEqual({ left: "wall", right: "void" });
    expect(autoWalklineSide(p, L)).toBe("right");
  });

  it("mur partiel : le côté garde une portion vide (garde-corps), il reste vide", () => {
    const partial: Wall = { ...leftWall, b: { x: -100, y: L / 2 } };
    expect(straightSideKinds(straight({ walls: [partial] }), L).left).toBe("void");
  });

  it("choix explicite de l'utilisateur prioritaire sur l'automatique", () => {
    const p = straight({ walls: [leftWall], side: "left" });
    expect(resolveWalklineSide(p, L)).toBe("left");
    expect(walkX(p)).toBeCloseTo(600, 9);
    expect(walkX(straight({ side: "right" }))).toBeCloseTo(800, 9);
  });

  it("distance imposée mesurée depuis le bord choisi", () => {
    const p = straight({ side: "right", walkline: { mode: "fromInner", distance: 450 } });
    expect(walkX(p)).toBeCloseTo(950, 9);
    expect(computeLayout(p).walklineOffset).toBe(450);
  });

  it("E ≤ 1 200 mm : ligne au milieu quel que soit le bord", () => {
    expect(walkX(straight({ width: 900, side: "right" }))).toBeCloseTo(450, 9);
  });

  it("tracé à tournants : réglage sans effet, pas de walklineSide", () => {
    const q = makeProject({ width: 1400, legs: [3000, 3000] });
    const withSide = ProjectSchema.parse({
      ...q,
      stair: { ...q.stair, walkline: { mode: "dtu", side: "right" } },
    });
    const a = computeLayout(q);
    const b = computeLayout(withSide);
    expect(b.walklineSide).toBeUndefined();
    expect(flattenCurve(b.walkline)).toEqual(flattenCurve(a.walkline));
  });

  it("la règle LF_POSITION_DTU_LARGE est respectée quel que soit le bord", () => {
    for (const p of [straight({ walls: [leftWall] }), straight({ side: "right" })]) {
      const m = buildModel(p);
      const r = m.compliance.results.find((x) => x.ruleId === "LF_POSITION_DTU_LARGE");
      expect(r?.status).toBe("ok");
    }
  });

  it("cache du pipeline : ajouter un mur (même tracé) recalcule le bord automatique", () => {
    // Relecture adverse : les clés de l'étape « tracé » ne lisaient ni les murs ni les
    // garde-corps ; le tracé mémoïsé gardait l'ancien bord.
    const p0 = straight();
    expect(buildModel(p0).layout?.walklineSide).toBe("left");
    const p1: Project = { ...p0, site: { ...p0.site, walls: [leftWall] } };
    expect(p1.stair).toBe(p0.stair);
    expect(buildModel(p1).layout?.walklineSide).toBe("right");
    const p2: Project = {
      ...p1,
      guards: ProjectSchema.parse({ ...p1, guards: { flight: { inner: "void" } } }).guards!,
    };
    expect(buildModel(p2).layout?.walklineSide).toBe("left");
  });

  it("propriété : Γ est à d_f du bord de mesure (rotation et placement quelconques)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1250, max: 2000 }),
        fc.constantFrom<"left" | "right" | undefined>("left", "right", undefined),
        fc.integer({ min: -180, max: 180 }),
        fc.boolean(),
        (width, side, rotation, wallLeft) => {
          const base = straight({
            width,
            rotation,
            ...(side !== undefined ? { side } : {}),
          });
          // Mur du côté gauche, en repère monde (même placement que l'escalier).
          const angle = (rotation * Math.PI) / 180;
          const toW = (x: number, y: number) =>
            V.add(V.rotate(V.vec(x, y), angle), base.stair.placement.origin);
          const p = wallLeft
            ? ProjectSchema.parse({
                ...base,
                site: {
                  ...base.site,
                  walls: [{ ...leftWall, a: toW(-100, 0), b: toW(-100, L) }],
                },
              })
            : base;
          const layout = computeLayout(p);
          const expected = side ?? (wallLeft ? "right" : "left");
          expect(layout.walklineSide).toBe(expected);
          const edge = expected === "left" ? layout.inner : layout.outer;
          const g0 = flattenCurve(layout.walkline)[0]!;
          const e0 = flattenCurve(edge)[0]!;
          expect(V.distance(g0, e0)).toBeCloseTo(600, 6);
        },
      ),
      { numRuns: 60 },
    );
  });
});
