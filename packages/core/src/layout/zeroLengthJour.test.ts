import { messageEquals, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import type { Vec2 } from "../model/primitives.js";
import { ProjectSchema, type Project, type Wall } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { computeLayout } from "./layout.js";
import { makeProject, type StairShape } from "./test-helpers.js";
import { ZERO_LENGTH_JOUR_ERROR, zeroLengthJourAgainstWall } from "./zeroLengthJour.js";

/**
 * Bord du jour de longueur nulle (quart tournant sans partie droite, L1 = L2 = E, angle vif) :
 * erreur sauf contre un mur (QUESTIONS D3, décision de l'utilisateur du 2026-09-30).
 * Tournant à gauche, placement neutre : K = (0, 0), volée entrante vers +y, sortante vers −x,
 * quadrant vide x < 0, y < 0.
 */
const SHAPE: StairShape = { width: 900, legs: [900, 900] };

const wall = (id: string, a: Vec2, b: Vec2, thickness = 200): Wall => ({
  id,
  a,
  b,
  thickness,
  loadBearing: false,
});

/** Angle de mur au coin K = (0, 0), côté vide (axes à −e/2, nus au droit du bord du jour). */
const CORNER_WALLS: readonly Wall[] = [
  wall("w1", V.vec(-100, -1500), V.vec(-100, -100)),
  wall("w2", V.vec(-100, -100), V.vec(-1500, -100)),
];

function withSite(p: Project, walls: readonly Wall[], guards?: unknown): Project {
  return ProjectSchema.parse({
    ...p,
    site: { ...p.site, walls },
    ...(guards !== undefined ? { guards } : {}),
  });
}

const zeroJourErrors = (p: Project): Message[] =>
  buildModel(p).errors.filter((e) => messageEquals(e, ZERO_LENGTH_JOUR_ERROR));

describe("bord du jour de longueur nulle contre un mur (D3, décision du 2026-09-30)", () => {
  it("le tracé décrit le bord dégénéré (coin et directions) sans le signaler lui-même", () => {
    const layout = computeLayout(makeProject(SHAPE));
    expect(layout.errors).toBeUndefined();
    expect(layout.zeroLengthInner).toEqual([
      { corner: { x: 0, y: 0 }, incoming: { x: 0, y: 1 }, outgoing: { x: -1, y: 0 } },
    ]);
    // Bord non dégénéré : rien.
    expect(computeLayout(makeProject({ width: 900, legs: [1500, 900] })).zeroLengthInner).toBe(
      undefined,
    );
  });

  it("contre un angle de mur : aucune erreur ; même géométrie côté vide : erreur conservée", () => {
    expect(zeroJourErrors(makeProject(SHAPE))).toHaveLength(1);
    const against = withSite(makeProject(SHAPE), CORNER_WALLS);
    expect(buildModel(against).errors).toEqual([]);
    // Un seul des deux murs suffit à fermer le quadrant vide au coin.
    expect(zeroJourErrors(withSite(makeProject(SHAPE), [CORNER_WALLS[0]!]))).toEqual([]);
    expect(zeroJourErrors(withSite(makeProject(SHAPE), [CORNER_WALLS[1]!]))).toEqual([]);
  });

  it("garde-corps activés : mur détecté (auto), côté imposé respecté", () => {
    expect(buildModel(withSite(makeProject(SHAPE), CORNER_WALLS, {})).errors).toEqual([]);
    expect(zeroJourErrors(withSite(makeProject(SHAPE), [], {}))).toHaveLength(1);
    // `void` imposé : erreur malgré les murs ; `wall` imposé : aucune erreur sans mur.
    expect(
      zeroJourErrors(withSite(makeProject(SHAPE), CORNER_WALLS, { flight: { inner: "void" } })),
    ).toHaveLength(1);
    expect(zeroJourErrors(withSite(makeProject(SHAPE), [], { flight: { inner: "wall" } }))).toEqual(
      [],
    );
  });

  it("murs qui ne ferment pas le coin : erreur conservée", () => {
    const cases: readonly (readonly Wall[])[] = [
      // Mur du côté des marches (le long du départ, nu à y = 0 côté escalier) : pas côté vide.
      [wall("in", V.vec(100, 100), V.vec(800, 100))],
      // Mur parallèle au prolongement du bord, mais trop loin (nu à 300 mm > tolérance 100 mm).
      [wall("far", V.vec(-400, -1500), V.vec(-400, -100))],
      // Mur sur la bonne droite, mais qui s'arrête à 500 mm du coin.
      [wall("short", V.vec(-100, -1500), V.vec(-100, -600))],
      // Mur de cage côté extérieur (côté mur de l'escalier).
      [wall("outer", V.vec(1000, -200), V.vec(1000, 1000))],
    ];
    for (const walls of cases) {
      expect(zeroJourErrors(withSite(makeProject(SHAPE), walls))).toHaveLength(1);
    }
  });

  it("tournant à droite, placement tourné et déplacé : repère monde", () => {
    const origin = V.vec(2000, -3000);
    const rotation = 90;
    const shape: StairShape = { ...SHAPE, direction: "right", origin, rotation };
    const p = makeProject(shape);
    // Tournant à droite, repère local : K = (900, 0), quadrant vide x > 900, y < 0.
    const angle = (rotation * Math.PI) / 180;
    const w = (x: number, y: number): Vec2 => V.add(V.rotate(V.vec(x, y), angle), origin);
    const local = [
      wall("r1", w(1000, -1500), w(1000, -100)),
      wall("r2", w(1000, -100), w(2400, -100)),
    ];
    const layout = computeLayout(p);
    expect(layout.zeroLengthInner).toHaveLength(1);
    expect(zeroLengthJourAgainstWall(p, layout)).toBe(false);
    expect(zeroJourErrors(p)).toHaveLength(1);
    const against = withSite(p, local);
    expect(zeroLengthJourAgainstWall(against, computeLayout(against))).toBe(true);
    expect(buildModel(against).errors).toEqual([]);
  });
});
