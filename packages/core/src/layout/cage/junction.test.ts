/**
 * Jonctions d'angle quelconque et raccords d'une cage saisie (sous-lot 2a, ADR-0010) : cas
 * unitaires en forme fermée (45°, 60°, 120°, 150°, −30°, palier droit, pan coupé, congé côté
 * mur, jour en arc, poteau refusé hors de ±90°), recouvrements, garde-fou temporaire du
 * pipeline ; propriété du pan coupé (Γ à distance ≥ d_f par construction). Les propriétés sont dans `free.property.test.ts`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageError, msg, type Message, type MessageKey } from "@blondel/i18n";
import { curveLength, curvePointAt, curveStart } from "../../geom2d/curve.js";
import { isConvex, pointInPolygon, signedArea } from "../../geom2d/polygon.js";
import { lineSeg, segClosestPoint } from "../../geom2d/segment.js";
import { GEOM_EPS } from "../../geom2d/tolerance.js";
import * as V from "../../geom2d/vec.js";
import type { Layout } from "../../model/derived.js";
import type { ArcSeg, CurveSeg, Vec2 } from "../../model/primitives.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../../model/project.js";
import { buildModel } from "../../pipeline/build.js";
import { computeLayout } from "../layout.js";
import { computeCageLayout } from "./cage.js";
import { buildFrames } from "./frames.js";
import { junctionGeom, WALL_SHARP_WARNING_ANGLE } from "./junction.js";
import { cagePieces } from "./overlap.js";

function cageProject(layout: CageLayoutSpecInput, rotation = 0): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: { placement: { origin: { x: 0, y: 0 }, rotation }, layout },
  });
}

const cageOf = (p: Project): CageLayoutSpec => p.stair.layout as CageLayoutSpec;

function layoutOf(spec: CageLayoutSpecInput): Layout {
  const p = cageProject(spec);
  return computeCageLayout(p, cageOf(p));
}

function errorOf(spec: CageLayoutSpecInput): Message | undefined {
  const p = cageProject(spec);
  try {
    computeCageLayout(p, cageOf(p));
  } catch (e) {
    if (e instanceof MessageError) return e.msg;
    throw e;
  }
  return undefined;
}

const E = 900;
/** d_f DTU pour E ≤ 1 200 mm : milieu de l'emmarchement. */
const DF = E / 2;

type JunctionInput = CageLayoutSpecInput["junctions"][number];

function two(angle: number, junction: Partial<JunctionInput> = {}, a = 1000, b = 800) {
  return {
    kind: "cage" as const,
    sections: [
      { axis: { kind: "straight" as const, length: a }, width: E },
      { axis: { kind: "straight" as const, length: b }, width: E },
    ],
    junctions: [{ angle, mode: "winders" as const, ...junction }],
  };
}

const deg = (a: number): number => (a * Math.PI) / 180;
const close = (a: Vec2, b: Vec2, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

const arcs = (segs: readonly CurveSeg[]): ArcSeg[] =>
  segs.filter((s): s is ArcSeg => s.kind === "arc");

describe("jonction d'angle quelconque, jour et mur vifs", () => {
  it.each([45, 60, 120, -30, -135])("angle %s° : K, W, zone, Γ, bords", (angle) => {
    const layout = layoutOf(two(angle));
    const t = Math.tan(deg(Math.abs(angle)) / 2);
    const left = angle > 0;
    const sweep = deg(angle);
    const zone = layout.turns[0]!;
    expect(zone.angle).toBeCloseTo(sweep, 15);
    expect(zone.direction).toBe(left ? "left" : "right");
    // K : fin de la partie droite du premier tronçon, côté du jour.
    const k = V.vec(left ? 0 : E, 1000);
    close(zone.innerCorner, k);
    // W = K + E·n + E·tan(|θ|/2)·u.
    close(zone.outerCorner, V.vec(left ? E : 0, 1000 + E * t));
    // Ligne de départ du second tronçon par K, perpendiculaire à u' (rotation de θ).
    const [s0, s1] = layout.sections!;
    close(s0!.end.left, V.vec(0, 1000));
    close(left ? s1!.start.left : s1!.start.right, k);
    const u2 = V.rotate(V.vec(0, 1), sweep);
    const across = V.sub(s1!.start.right, s1!.start.left);
    expect(V.norm(across)).toBeCloseTo(E, 9);
    expect(V.dot(across, u2)).toBeCloseTo(0, 9);
    close(V.sub(s1!.end.left, s1!.start.left), V.scale(u2, 800));
    // Γ : arc de centre K, rayon d_f, balayage θ, entre deux droites.
    expect(zone.sEnd - zone.sStart).toBeCloseTo(DF * Math.abs(sweep), 9);
    expect(curveLength(layout.walkline)).toBeCloseTo(1000 + 800 + DF * Math.abs(sweep), 9);
    const [arc] = arcs(layout.walkline.segments);
    close(arc!.center, k);
    expect(arc!.radius).toBe(DF);
    expect(arc!.sweep).toBeCloseTo(sweep, 15);
    // Bords : jour anguleux en K (longueur des parties droites), mur jusqu'à W.
    expect(curveLength(layout.inner)).toBeCloseTo(1800, 9);
    expect(curveLength(layout.outer)).toBeCloseTo(1800 + 2 * E * t, 9);
    expect(layout.errors).toBeUndefined();
    expect(layout.notes).toBeUndefined();
  });

  it("150° avec mur vif : avertissement F4 (seuil « à valider ») ; mur en arc : aucun", () => {
    expect(WALL_SHARP_WARNING_ANGLE).toBe(135);
    expect(layoutOf(two(150)).notes).toEqual([
      msg("layout.cage.wallSharpWideAngle", { junction: 1, angle: "150", threshold: 135 }),
    ]);
    expect(layoutOf(two(-150)).notes).toHaveLength(1);
    expect(layoutOf(two(135)).notes).toBeUndefined();
    expect(layoutOf(two(150, { wall: { kind: "arc", radius: 100 } })).notes).toBeUndefined();
    // Avertissement repris dans `Model.notes`, pas dans `Model.errors`.
    const model = buildModel(cageProject(two(150)), { memo: false });
    expect(model.notes).toContainEqual(
      msg("layout.cage.wallSharpWideAngle", { junction: 1, angle: "150", threshold: 135 }),
    );
    expect(model.errors.map((e) => e.key)).not.toContain("layout.cage.wallSharpWideAngle");
  });

  it("seuil F4 réglé par le projet (`wallSharpWarningAngle`) : 120° averti au-delà de 100°", () => {
    const spec = { ...two(120), wallSharpWarningAngle: 100 };
    expect(layoutOf(spec).notes).toEqual([
      msg("layout.cage.wallSharpWideAngle", { junction: 1, angle: "120", threshold: 100 }),
    ]);
    expect(layoutOf({ ...two(150), wallSharpWarningAngle: 160 }).notes).toBeUndefined();
  });

  it("marches rayonnantes : zone marquée `radiating`", () => {
    const layout = layoutOf(two(60, { mode: "radiating" }));
    expect(layout.turns[0]!.mode).toBe("radiating");
  });

  it("placement tourné : même tracé, transformé", () => {
    const a = layoutOf(two(60));
    const p = cageProject(two(60), 30);
    const b = computeCageLayout(p, cageOf(p));
    close(curveStart(b.walkline), V.rotate(curveStart(a.walkline), deg(30)));
    close(curvePointAt(b.walkline, 1200), V.rotate(curvePointAt(a.walkline, 1200), deg(30)));
  });
});

describe("raccord de jour en arc à un angle quelconque", () => {
  it("60°, r = 200 : tangence à r·tan(30°) de K, Γ de rayon r + d_f", () => {
    const r = 200;
    const layout = layoutOf(two(60, { well: { kind: "arc", radius: r } }));
    const t = Math.tan(deg(30));
    const [wellArc] = arcs(layout.inner.segments);
    expect(wellArc!.radius).toBe(r);
    expect(wellArc!.sweep).toBeCloseTo(deg(60), 15);
    // Centre sur la bissectrice, à r des deux bords du jour : K − r·n − r·t·u.
    close(wellArc!.center, V.vec(-r, 1000 - r * t));
    const [walkArc] = arcs(layout.walkline.segments);
    close(walkArc!.center, wellArc!.center);
    expect(walkArc!.radius).toBe(r + DF);
    const zone = layout.turns[0]!;
    expect(zone.sEnd - zone.sStart).toBeCloseTo((r + DF) * deg(60), 9);
    // Bord du jour : parties droites raccourcies de r·t de part et d'autre, plus l'arc.
    expect(curveLength(layout.inner)).toBeCloseTo(1800 - 2 * r * t + r * deg(60), 9);
    expect(curveLength(layout.walkline)).toBeCloseTo(1800 - 2 * r * t + (r + DF) * deg(60), 9);
  });

  it("partie droite trop courte pour la tangence : `sectionTooShort` (retraits en r·tan(θ/2))", () => {
    const r = 1000;
    const t = Math.tan(deg(60));
    expect(errorOf(two(120, { well: { kind: "arc", radius: r } }, 1000, 800))).toEqual(
      msg("layout.cage.sectionTooShort", {
        section: 1,
        length: "1000",
        required: (r * t).toFixed(1),
      }),
    );
  });
});

describe("pan coupé (F6)", () => {
  it.each([90, -60])("%s° : bord du jour K − a·u → K + b·u', Γ comme un angle vif", (angle) => {
    const a = 120;
    const b = 200;
    const chamfer = layoutOf(
      two(angle, { well: { kind: "chamfer", setbackIn: a, setbackOut: b } }),
    );
    const sharp = layoutOf(two(angle));
    // Γ : arc de centre K, de rayon d_f, identique à l'angle vif.
    expect(chamfer.walkline).toStrictEqual(sharp.walkline);
    const k = sharp.turns[0]!.innerCorner;
    const u = V.vec(0, 1);
    const u2 = V.rotate(u, deg(angle));
    const p = V.addScaled(k, u, -a);
    const q = V.addScaled(k, u2, b);
    const pan = chamfer.inner.segments.find(
      (s) => s.kind === "line" && V.distance(s.a, p) < 1e-9 && V.distance(s.b, q) < 1e-9,
    );
    expect(pan).toBeDefined();
    expect(curveLength(chamfer.inner)).toBeCloseTo(1000 - a + V.distance(p, q) + 800 - b, 9);
    expect(chamfer.turns[0]!.well).toEqual({ kind: "chamfer", setbackIn: a, setbackOut: b });
  });

  it("propriété : Γ à distance ≥ d_f du pan quels que soient l'angle et les retraits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -179, max: 179 }).filter((a) => a !== 0),
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 600, max: 1500 }),
        (angle, a, b, width) => {
          const spec: CageLayoutSpecInput = {
            kind: "cage",
            sections: [
              { axis: { kind: "straight", length: 3000 }, width },
              { axis: { kind: "straight", length: 3000 }, width },
            ],
            junctions: [
              { angle, mode: "winders", well: { kind: "chamfer", setbackIn: a, setbackOut: b } },
            ],
          };
          const layout = layoutOf(spec);
          const k = layout.turns[0]!.innerCorner;
          const u = V.vec(0, 1);
          const pan = lineSeg(V.addScaled(k, u, -a), V.addScaled(k, V.rotate(u, deg(angle)), b));
          const zone = layout.turns[0]!;
          for (let f = 0; f <= 1; f += 1 / 32) {
            const g = curvePointAt(layout.walkline, zone.sStart + f * (zone.sEnd - zone.sStart));
            const d = V.distance(g, segClosestPoint(pan, g).point);
            expect(d).toBeGreaterThanOrEqual(layout.walklineOffset - 1e-9);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("retrait plus long que la partie droite : `sectionTooShort`", () => {
    expect(
      errorOf(two(60, { well: { kind: "chamfer", setbackIn: 1200, setbackOut: 10 } })),
    ).toEqual(msg("layout.cage.sectionTooShort", { section: 1, length: "1000", required: "1200" }));
  });
});

describe("raccord côté mur en arc (congé)", () => {
  it("90°, R = 300 : congé tangent aux deux bords côté mur", () => {
    const R = 300;
    const layout = layoutOf(two(90, { wall: { kind: "arc", radius: R } }));
    const [fillet] = arcs(layout.outer.segments);
    expect(fillet!.radius).toBe(R);
    // W = (E, 1000 + E) ; centre W − R·u − R·n.
    close(fillet!.center, V.vec(E - R, 1000 + E - R));
    expect(curveLength(layout.outer)).toBeCloseTo(
      1000 + E - R + (R * Math.PI) / 2 + (E - R + 800),
      9,
    );
    // Le coin du mur reste W (intersection des droites côté mur).
    close(layout.turns[0]!.outerCorner, V.vec(E, 1000 + E));
    expect(layout.turns[0]!.wall).toEqual({ kind: "arc", radius: R });
  });

  it("45°, R = 500 : tangence à R·tan(22,5°) de W", () => {
    const R = 500;
    const t = Math.tan(deg(22.5));
    const layout = layoutOf(two(45, { wall: { kind: "arc", radius: R } }));
    const [fillet] = arcs(layout.outer.segments);
    expect(fillet!.sweep).toBeCloseTo(deg(45), 15);
    const w = layout.turns[0]!.outerCorner;
    close(V.add(fillet!.center, V.vec(R, 0)), V.vec(w.x, w.y - R * t));
  });

  it("congé de grand rayon qui passe sous Γ : `wallArcCrossesWalkline`", () => {
    // 90°, E = 900, d_f = 450 : C = K + (E − R)(n + u) ; le point de Γ sur la bissectrice est
    // à (R − E)·√2 + d_f de C, plus que R dès R > 1 974 mm environ.
    const long = (angle: number, radius: number) =>
      two(angle, { wall: { kind: "arc", radius } }, 8000, 8000);
    expect(errorOf(long(90, 2000))).toEqual(
      msg("layout.cage.wallArcCrossesWalkline", { junction: 1, radius: "2000" }),
    );
    expect(errorOf(long(90, 1500))).toBeUndefined();
    expect(errorOf(long(120, 2000))?.key).toBe("layout.cage.wallArcCrossesWalkline");
    expect(errorOf(long(60, 5000))?.key).toBe("layout.cage.wallArcCrossesWalkline");
    expect(errorOf(long(-90, 3000))?.key).toBe("layout.cage.wallArcCrossesWalkline");
    // Accepté : Γ reste dans l'emprise.
    const layout = layoutOf(long(90, 1500));
    const L = curveLength(layout.walkline);
    // Hors extrémités (sur les lignes de départ et d'arrivée, au bord de l'emprise).
    for (let f = 1 / 64; f < 1; f += 1 / 64) {
      expect(pointInPolygon(curvePointAt(layout.walkline, f * L), layout.footprint)).toBe("inside");
    }
  });

  it("congé qui ne tient pas sur le bord du mur : `wallArcDoesNotFit`", () => {
    const m = errorOf(two(90, { wall: { kind: "arc", radius: 1500 } }, 100, 100));
    expect(m?.key).toBe("layout.cage.wallArcDoesNotFit");
    expect(m).toEqual(
      msg("layout.cage.wallArcDoesNotFit", {
        junction: 1,
        section: 1,
        required: "1500",
        available: "1000",
      }),
    );
  });
});

describe("palier droit (angle 0)", () => {
  const landing = (depth?: number) => ({
    kind: "cage" as const,
    sections: [
      { axis: { kind: "straight" as const, length: 1000 }, width: E },
      { axis: { kind: "straight" as const, length: 800 }, width: E },
    ],
    junctions: [{ angle: 0, mode: "landing" as const, ...(depth !== undefined ? { depth } : {}) }],
  });

  it.each([undefined, 1200])("profondeur %s (défaut : E, F9) : rectangle, Γ droite", (depth) => {
    const d = depth ?? E;
    const layout = layoutOf(landing(depth));
    const zone = layout.turns[0]!;
    expect(zone.angle).toBe(0);
    expect(zone.mode).toBe("landing");
    expect(zone.sStart).toBe(1000);
    expect(zone.sEnd).toBe(1000 + d);
    expect(layout.sections![1]!.start.left).toEqual(V.vec(0, 1000 + d));
    expect(layout.sections![1]!.sStart).toBe(1000 + d);
    expect(curveLength(layout.walkline)).toBe(1000 + d + 800);
    expect(layout.walkline.segments.every((s) => s.kind === "line")).toBe(true);
    expect(curveLength(layout.inner)).toBe(1000 + d + 800);
    expect(curveLength(layout.outer)).toBe(1000 + d + 800);
    expect(layout.errors).toBeUndefined();
  });

  it("escalier droit à paliers droits : Γ à d_f du bord choisi, sinon du bord gauche", () => {
    const W = 1500;
    const spec = (side?: "left" | "right"): Project =>
      ProjectSchema.parse({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        site: { floorToFloor: 2700, upperSlabThickness: 200 },
        stair: {
          placement: { origin: { x: 0, y: 0 }, rotation: 0 },
          ...(side !== undefined ? { walkline: { mode: "dtu", side } } : {}),
          layout: {
            kind: "cage",
            sections: [
              { axis: { kind: "straight", length: 1000 }, width: W },
              { axis: { kind: "straight", length: 800 }, width: W },
            ],
            junctions: [{ angle: 0, mode: "landing" }],
          },
        },
      });
    for (const [side, expected] of [
      [undefined, "left"],
      ["left", "left"],
      ["right", "right"],
    ] as const) {
      const p = spec(side);
      const layout = computeCageLayout(p, cageOf(p));
      const df = layout.walklineOffset;
      expect(df).not.toBe(W / 2);
      const x = expected === "left" ? df : W - df;
      expect(layout.walklineSide).toBe(expected);
      const L = curveLength(layout.walkline);
      for (let f = 0; f <= 1; f += 1 / 16) expect(curvePointAt(layout.walkline, f * L).x).toBe(x);
    }
  });

  it("palier droit entre deux quarts tournants : Γ continue, à d_f du jour", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [
        { axis: { kind: "straight", length: 1000 }, width: E },
        { axis: { kind: "straight", length: 300 }, width: E },
        { axis: { kind: "straight", length: 300 }, width: E },
        { axis: { kind: "straight", length: 800 }, width: E },
      ],
      junctions: [
        { angle: 90, mode: "winders" },
        { angle: 0, mode: "landing", depth: 1000 },
        { angle: 90, mode: "winders" },
      ],
    });
    expect(layout.turns.map((t) => t.angle)).toEqual([Math.PI / 2, 0, Math.PI / 2]);
    expect(curveLength(layout.walkline)).toBeCloseTo(
      1000 + 300 + 1000 + 300 + 800 + DF * Math.PI,
      9,
    );
    expect(layout.errors).toBeUndefined();
  });
});

describe("poteau sur un angle non droit (F5)", () => {
  const newel = { kind: "newel" as const, size: 90 };
  it("60° : refusé par le moteur et par computeLayout (vif, arc ou pan coupé proposés)", () => {
    expect(errorOf(two(60, { well: newel }))).toEqual(
      msg("layout.cage.newelAngle", { junction: 1, angle: "60" }),
    );
    expect(() => computeLayout(cageProject(two(60, { well: newel })))).toThrow(MessageError);
    try {
      computeLayout(cageProject(two(60, { well: newel })));
    } catch (e) {
      expect((e as MessageError).msg.key).toBe("layout.cage.newelAngle" satisfies MessageKey);
    }
  });
  it("computeLayout : refus dans l'ordre des jonctions (poteau à 60° avant poteau à 90°)", () => {
    const p = cageProject({
      kind: "cage",
      sections: [
        { axis: { kind: "straight", length: 1500 }, width: E },
        { axis: { kind: "straight", length: 1500 }, width: E },
        { axis: { kind: "straight", length: 1500 }, width: E },
      ],
      junctions: [
        { angle: 60, mode: "winders", well: newel },
        { angle: 90, mode: "winders", well: newel },
      ],
    });
    try {
      computeLayout(p);
      expect.unreachable();
    } catch (e) {
      expect((e as MessageError).msg).toEqual(
        msg("layout.cage.newelAngle", { junction: 1, angle: "60" }),
      );
    }
  });
  it("90° : calculé par le moteur (refus « pas encore » de computeLayout inchangé)", () => {
    expect(errorOf(two(90, { well: newel }))).toBeUndefined();
  });
});

describe("recouvrement en plan (overlap.ts)", () => {
  const straight = (length: number) => ({ axis: { kind: "straight" as const, length }, width: E });

  it("demi-tour à jour nul par 60° + 120° : tronçons bord à bord (`sectionsTouch`)", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1500), straight(0), straight(1500)],
      junctions: [
        { angle: 60, mode: "winders" },
        { angle: 120, mode: "winders" },
      ],
    });
    expect(layout.errors).toEqual([
      msg("layout.cage.sectionsTouch", {
        junctionA: 1,
        junctionB: 2,
        section: 2,
        length: "0",
        before: 1,
        after: 3,
      }),
    ]);
  });

  it("au-delà de 180° cumulés : `sectionsOverlap` seul", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(1500), straight(0), straight(1500)],
      junctions: [
        { angle: 100, mode: "winders" },
        { angle: 100, mode: "winders" },
      ],
    });
    expect(layout.errors?.map((e) => e.key)).toEqual(["layout.cage.sectionsOverlap"]);
  });

  it("triangle fermé (trois jonctions de 120°) : le dernier tronçon recouvre le premier", () => {
    const layout = layoutOf({
      kind: "cage",
      sections: [straight(2000), straight(2000), straight(2000), straight(2000)],
      junctions: [
        { angle: 120, mode: "landing", wall: { kind: "arc", radius: 200 } },
        { angle: 120, mode: "landing", wall: { kind: "arc", radius: 200 } },
        { angle: 120, mode: "landing", wall: { kind: "arc", radius: 200 } },
      ],
    });
    const pairs = (layout.errors ?? []).map((e) => [e.params?.sectionA, e.params?.sectionB]);
    expect(pairs).toContainEqual([1, 4]);
  });

  it("congé de grand rayon : la partie droite qu'il entame est coupée (pas de faux constat)", () => {
    // Contre-exemple trouvé par `free.property.test.ts` : le congé de R = 1 595 mm de la
    // jonction 3 commence sur la partie droite du tronçon 3 ; sans la coupe, le coin retiré
    // recouvrait le tronçon 1 (constat 1 × 10 mm alors que l'emprise est simple).
    const w = (length: number) => ({ axis: { kind: "straight" as const, length }, width: 600 });
    const layout = layoutOf({
      kind: "cage",
      sections: [w(50), w(12), w(405), w(382)],
      junctions: [
        { angle: 13, mode: "winders", wall: { kind: "arc", radius: 1 } },
        { angle: 169.96873915822985, mode: "winders", well: { kind: "arc", radius: 1 } },
        {
          angle: -42,
          mode: "winders",
          well: { kind: "chamfer", setbackIn: 1, setbackOut: 1 },
          wall: { kind: "arc", radius: 1595 },
        },
      ],
    });
    expect(layout.errors?.map((e) => e.key) ?? []).not.toContain("layout.cage.sectionsOverlap");
  });

  it("U ordinaire : aucun constat ; pièces convexes d'aire positive", () => {
    const spec: CageLayoutSpecInput = {
      kind: "cage",
      sections: [straight(1500), straight(400), straight(1500)],
      junctions: [
        { angle: 75, mode: "winders", well: { kind: "arc", radius: 100 } },
        { angle: 105, mode: "winders", well: { kind: "chamfer", setbackIn: 50, setbackOut: 80 } },
      ],
    };
    expect(layoutOf(spec).errors).toBeUndefined();
    const p = cageProject(spec);
    const geoms = cageOf(p).junctions.map((j) => junctionGeom(j, E));
    const frames = buildFrames([1500, 400, 1500], cageOf(p).junctions, E);
    const pieces = cagePieces(frames, geoms, E);
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) {
      expect(piece.polygon.length).toBeGreaterThanOrEqual(3);
      expect(signedArea(piece.polygon)).toBeGreaterThan(GEOM_EPS);
      expect(isConvex(piece.polygon)).toBe(true);
    }
  });
});

describe("pipeline : garde-fou temporaire de l'aval (sous-lot 2a, réduit au 2c, levé au 2d)", () => {
  it.each([
    ["angle quelconque", two(60)],
    ["palier droit", { ...two(0), junctions: [{ angle: 0, mode: "landing" as const }] }],
    ["pan coupé à 90°", two(90, { well: { kind: "chamfer", setbackIn: 50, setbackOut: 50 } })],
    ["congé côté mur à 90°", two(90, { wall: { kind: "arc", radius: 100 } })],
    ["marches rayonnantes à 90°", two(90, { mode: "radiating" })],
  ])(
    "%s : tracé et découpage rendus, garde-corps / échappée / règles sautés avec une erreur claire",
    (_name, spec) => {
      const model = buildModel(cageProject(spec), { memo: false });
      expect(model.errors.map((e) => e.key)).toEqual(["pipeline.cageDownstreamNotYetSupported"]);
      expect(model.layout.sections).toHaveLength(2);
      expect(model.layout.walkline.segments.length).toBeGreaterThan(0);
      // Sous-lot 2c : découpage, balancement et pièces de base calculés.
      expect(model.stepping.treads.length).toBeGreaterThan(0);
      expect(model.parts.length).toBeGreaterThan(0);
      expect(model.headroom).toBeUndefined();
    },
  );

  it("cage à ±90° sans ces fonctions : découpage produit (inchangé)", () => {
    const model = buildModel(cageProject(two(90)), { memo: false });
    expect(model.errors).toEqual([]);
    expect(model.stepping.treads.length).toBeGreaterThan(0);
  });
});
