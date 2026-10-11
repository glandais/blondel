/**
 * Échappée d'une cage saisie (ADR-0010, sous-lot 2d) : cumul de balayage, détection de
 * l'auto-recouvrement, sous-faces des marches et passage par `selfCoveredHeadroom`.
 */
import { describe, expect, it } from "vitest";
import { computeLayout } from "../layout/layout.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { computeStepping } from "../stepping/stepping.js";
import {
  cageMaxSweep,
  cageOutlineDefect,
  cageOutlineReach,
  cageSelfCovers,
  cageSoffits,
} from "./cage.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import { computeHeadroom } from "./headroom.js";

const straight = (length: number, width = 900) => ({
  axis: { kind: "straight" as const, length },
  width,
});

function cageProject(
  layout: CageLayoutSpecInput,
  site: Record<string, unknown> = {},
  floorToFloor = 2700,
): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor, upperSlabThickness: 200, ...site },
    stair: { placement: { origin: { x: 0, y: 0 }, rotation: 0 }, layout },
  });
}

/**
 * Croisement : trois paliers d'angle de 90° à gauche (270°) ; le quatrième tronçon repasse
 * au-dessus du premier, à angle droit (constat du tracé `layout.cage.sectionsOverlap`). Les
 * lignes de nez de chaque tronçon sont parallèles aux bords de l'autre : extrémités des nez sans
 * ambiguïté (voir le journal du sous-lot 2d pour les recouvrements parallèles).
 */
const CROSSOVER: CageLayoutSpecInput = {
  kind: "cage",
  sections: [straight(3000), straight(600), straight(600), straight(2400)],
  junctions: [
    { angle: 90, mode: "landing" },
    { angle: 90, mode: "landing" },
    { angle: 90, mode: "landing" },
  ],
};

/** Spirale carrée : cinq tronçons, quatre paliers d'angle de 90° à gauche (un tour, balayage seul). */
const SPIRAL: CageLayoutSpecInput = {
  kind: "cage",
  sections: [straight(1800), straight(900), straight(900), straight(900), straight(1800)],
  junctions: [
    { angle: 90, mode: "landing" },
    { angle: 90, mode: "landing" },
    { angle: 90, mode: "landing" },
    { angle: 90, mode: "landing" },
  ],
};

describe("cumul de balayage d'une cage", () => {
  it("somme signée des jonctions et des arcs, au plus loin le long de la montée", () => {
    const spec = (s: CageLayoutSpecInput) => cageProject(s).stair.layout as CageLayoutSpec;
    expect(cageMaxSweep(spec(SPIRAL))).toBe(360);
    expect(
      cageMaxSweep(
        spec({
          kind: "cage",
          sections: [straight(1000), straight(1000), straight(1000)],
          junctions: [
            { angle: 120, mode: "winders" },
            { angle: -120, mode: "winders" },
          ],
        }),
      ),
    ).toBe(120);
    expect(
      cageMaxSweep(
        spec({
          kind: "cage",
          sections: [
            { axis: { kind: "arc", radius: 2000, sweep: -200 }, width: 900 },
            straight(500),
          ],
          junctions: [{ angle: -170, mode: "winders" }],
        }),
      ),
    ).toBe(370);
  });
});

describe("cage qui repasse au-dessus d'elle-même", () => {
  it("spirale d'un tour : détectée par le cumul de balayage", () => {
    const project = cageProject(SPIRAL, {}, 5400);
    expect(cageSelfCovers(project.stair.layout as CageLayoutSpec, computeLayout(project))).toBe(
      true,
    );
  });

  it("croisement à angle droit : détecté, sous-faces de chaque marche, échappée sous l'escalier lui-même", () => {
    const project = cageProject(CROSSOVER, {}, 5400);
    const layout = computeLayout(project);
    const spec = project.stair.layout as CageLayoutSpec;
    expect(cageMaxSweep(spec)).toBe(270);
    expect(layout.errors?.map((e) => e.key)).toEqual(["layout.cage.sectionsOverlap"]);
    expect(cageSelfCovers(spec, layout)).toBe(true);
    const stepping = computeStepping(project, layout);
    const thickness = project.stair.treads.thickness;
    const soffits = cageSoffits(stepping, thickness);
    expect(soffits).toHaveLength(stepping.treads.length);
    soffits.forEach((f, i) => {
      const t = stepping.treads[i]!;
      expect(f.z).toBe(t.z - thickness);
      expect(f.sStart).toBe(stepping.nosings[t.number - 1]!.s);
      expect(f.tread).toBe(t.number);
    });
    // Sans trémie, aucun plafond de dalle : l'échappée n'est due qu'au quatrième tronçon.
    expect(computeHeadroom(project.site, layout, stepping)).toBeNull();
    const h = computeHeadroom(project.site, layout, stepping, soffits);
    expect(h).not.toBeNull();
    const w = h!.walkline!;
    expect(w).toBeDefined();
    // Point critique sur le premier tronçon, à la sortie de dessous le quatrième.
    expect(w.s).toBeLessThan(layout.turns[0]!.sStart);
    expect(w.min).toBeGreaterThan(0);
    // Minimum = sous-face d'une marche du quatrième tronçon qui couvre le point − ligne de pente.
    const s4 = layout.turns[2]!.sEnd;
    const above = soffits.filter(
      (f) =>
        f.sStart >= s4 - 1e-6 && pointInPolygon({ x: w.at.x, y: w.at.y }, f.outline) !== "outside",
    );
    expect(above.length).toBeGreaterThan(0);
    expect(w.min).toBeCloseTo(Math.min(...above.map((f) => f.z)) - w.at.z, 9);
    // Nez couverts : ceux du premier tronçon sous le quatrième seulement.
    const covered = h!.atNosings.flatMap((v, k) => (v === null ? [] : [k]));
    expect(covered.length).toBeGreaterThan(0);
    for (const k of covered) expect(stepping.nosings[k]!.s).toBeLessThan(layout.turns[0]!.sStart);
    // Pipeline : même échappée, sans exception.
    const model = buildModel(project, { memo: false });
    expect(model.headroom?.min).toBe(w.min);
    expect(model.headroomAtNosings).toEqual(h!.atNosings);
  });

  it("cage qui ne se recouvre pas (60°, palier droit, arc de 90°) : aucune sous-face", () => {
    for (const layout of [
      {
        kind: "cage" as const,
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 60, mode: "winders" as const }],
      },
      {
        kind: "cage" as const,
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 0, mode: "landing" as const }],
      },
      {
        kind: "cage" as const,
        sections: [{ axis: { kind: "arc" as const, radius: 1500, sweep: 90 }, width: 900 }],
        junctions: [],
      },
    ]) {
      const project = cageProject(layout);
      expect(cageSelfCovers(project.stair.layout as CageLayoutSpec, computeLayout(project))).toBe(
        false,
      );
      // Sans trémie ni auto-recouvrement : pas d'échappée.
      expect(buildModel(project, { memo: false }).headroom).toBeUndefined();
    }
  });
});

describe("contours de marches non fiables (cage qui se recouvre)", () => {
  /**
   * Cages qui se recouvrent autrement que par un croisement à angle droit : des lignes de nez
   * s'arrêtent sur le bord d'une autre partie de la cage (`balancing/postprocess.ts`,
   * `firstHit`), des contours de marche sortent de leur portion d'escalier ; une sous-face
   * fausse couvrirait la marche voisine (échappée de −épaisseur, constat de relecture du 2d).
   */
  const UNRELIABLE: Record<string, CageLayoutSpecInput> = {
    "deux arcs opposés après une jonction de 170°": {
      kind: "cage",
      sections: [
        { axis: { kind: "arc", radius: 1500, sweep: -200 }, width: 900 },
        { axis: { kind: "arc", radius: 1500, sweep: 200 }, width: 900 },
      ],
      junctions: [{ angle: 170, mode: "winders" }],
    },
    "spirale de paliers d'angle (recouvrement parallèle)": {
      kind: "cage",
      sections: [
        straight(1500),
        straight(1200),
        straight(1200),
        straight(1200),
        straight(1200),
        straight(1500),
      ],
      junctions: [1, 2, 3, 4, 5].map(() => ({ angle: 90, mode: "landing" as const })),
    },
    "spirale carrée d'un tour": SPIRAL,
  };

  it.each(Object.entries(UNRELIABLE))(
    "%s : contour détecté, échappée non calculée (erreur claire, pas de valeur fausse)",
    (_n, spec) => {
      const project = cageProject(spec, {}, 5400);
      const model = buildModel(project, { memo: false });
      const cage = project.stair.layout as CageLayoutSpec;
      expect(cageSelfCovers(cage, model.layout)).toBe(true);
      const tread = cageOutlineDefect(
        model.stepping,
        model.layout,
        cageOutlineReach(cage, project.stair.treads.nosing),
      );
      expect(tread).not.toBeNull();
      expect(model.errors).toContainEqual({
        key: "headroom.error.cageTreadOutline",
        params: { tread },
      });
      expect(model.headroom).toBeUndefined();
      expect(model.headroomAtNosings).toBeUndefined();
    },
  );

  it("croisement à angle droit : contours fiables, échappée calculée", () => {
    const project = cageProject(CROSSOVER, {}, 5400);
    const model = buildModel(project, { memo: false });
    const cage = project.stair.layout as CageLayoutSpec;
    expect(
      cageOutlineDefect(
        model.stepping,
        model.layout,
        cageOutlineReach(cage, project.stair.treads.nosing),
      ),
    ).toBeNull();
    expect(model.errors.map((e) => e.key)).toEqual(["layout.cage.sectionsOverlap"]);
    expect(model.headroom?.min).toBeGreaterThan(0);
  });
});

describe("échappée sous une trémie, cage quelconque", () => {
  it.each<[string, CageLayoutSpecInput]>([
    [
      "60°",
      {
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 60, mode: "winders" }],
      },
    ],
    [
      "palier droit",
      {
        kind: "cage",
        sections: [straight(1500), straight(1500)],
        junctions: [{ angle: 0, mode: "landing", depth: 900 }],
      },
    ],
    [
      "arc de 90°",
      {
        kind: "cage",
        sections: [{ axis: { kind: "arc", radius: 1500, sweep: 90 }, width: 900 }],
        junctions: [],
      },
    ],
  ])(
    "%s : échappée exacte sur Γ, minimum à la borne haute d'un intervalle sous la dalle",
    (_n, spec) => {
      // Trémie couvrant la seconde moitié de Γ : dalle au-dessus du départ.
      const base = cageProject(spec);
      const layout0 = computeLayout(base);
      const pts = layout0.footprint;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.round(Math.min(...xs)) - 500;
      const maxX = Math.round(Math.max(...xs)) + 500;
      const minY = Math.round(Math.min(...ys)) - 500;
      const maxY = Math.round(Math.max(...ys)) + 500;
      const midY = Math.round((minY + maxY) / 2);
      // Trémie = moitié haute de la boîte englobante en y (l'escalier monte vers +y au départ).
      const opening = {
        kind: "rect" as const,
        x: minX,
        y: midY,
        sizeX: maxX - minX,
        sizeY: maxY - midY,
      };
      const project = cageProject(spec, { opening });
      const model = buildModel(project, { memo: false });
      expect(model.errors).toEqual([]);
      const layout = model.layout;
      const st = model.stepping;
      const h = computeHeadroom(project.site, layout, st)!;
      expect(h).not.toBeNull();
      if (h.walkline) {
        // Minimum = plafond − altitude de la ligne de pente à la sortie de la dalle.
        expect(h.walkline.min).toBeCloseTo(h.ceiling - h.walkline.at.z, 9);
        expect(h.covered.some((c) => Math.abs(c.s1 - h.walkline!.s) < 1e-6)).toBe(true);
        expect(model.headroom?.min).toBe(h.walkline.min);
      }
      expect(h.atNosings).toHaveLength(st.nosings.length);
    },
  );
});
