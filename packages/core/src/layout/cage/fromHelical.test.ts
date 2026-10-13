/**
 * Conversion `helicalToCage` (F10, sous-lot P1) : correspondance champ à champ, placement
 * recalé à gauche et à droite, aller-retour par le schéma de cage sous un tour, erreurs
 * identiques à celles de `computeHelicalLayout`, pureté et déterminisme. La parité des moteurs
 * est dans `helicalParity.test.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageError } from "@blondel/i18n";
import { CageLayoutSpecSchema, type HelicalLayoutSpec, type Project } from "../../model/project.js";
import { parseProjectText } from "../../project/parse.js";
import { computeHelicalLayout } from "../helical.js";
import { makeHelicalProject } from "../helical-test-helpers.js";
import { computeCageLayout } from "./cage.js";
import { helicalToCage } from "./fromHelical.js";
import { helicalParityShapeArb } from "./helical-parity-helpers.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../examples");
const j5a = (): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, "j5a-helicoidal.blondel.json"), "utf8"));

/** Erreur comparable (nom, clé, paramètres), ou `null`. */
function errorOf(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (e) {
    return e instanceof MessageError ? { name: e.name, msg: e.msg } : String(e);
  }
}

describe("helicalToCage — correspondance", () => {
  it("j5a : un tronçon à axe en arc, ancré sur l'axe, options de l'hélicoïdal", () => {
    const p = j5a();
    const h = p.stair.layout as HelicalLayoutSpec;
    const { project, spec, options } = helicalToCage(p);
    // n = 2 750 / 175 → 16 ; N = 13 : Θ = 15 · 360 / 13.
    expect(spec).toEqual({
      kind: "cage",
      sections: [
        { axis: { kind: "arc", radius: 70, sweep: (15 * 360) / 13 }, width: 880, anchor: "left" },
      ],
      junctions: [],
      width: 880,
      legs: [],
      turns: [],
    });
    expect(options).toEqual({ origin: "helical", core: "column", arrival: { sweep: 45 } });
    expect(project.stair.layout).toBe(spec);
    expect(project.stair.placement).toEqual({ origin: { x: 70, y: 0 }, rotation: 0 });
    expect(project.stair.walkline).toEqual({ mode: "dtu", side: "left" });
    // Tout le reste est repris tel quel.
    expect(project.site).toBe(p.site);
    expect(project.stair.stepping).toBe(p.stair.stepping);
    expect(project.stair.treads).toBe(p.stair.treads);
    expect(project.stair.structure).toBe(p.stair.structure);
    expect(project.stair.nosingOverrides).toBe(p.stair.nosingOverrides);
    expect(project.stair.balancing).toBe(p.stair.balancing);
    expect(h.kind).toBe("helical");
  });

  it.each([
    ["left", 1],
    ["right", -1],
  ] as const)(
    "sens %s : centre monde = axe de l'hélicoïdal, rayon de départ à α",
    (direction, sign) => {
      const p = makeHelicalProject({
        outerRadius: 1100,
        coreRadius: 150,
        direction,
        totalAngle: 300,
        startAngle: 37,
        floorToFloor: 2800,
        riserCount: 16,
        origin: { x: 1234, y: -567 },
        rotation: -110,
      });
      const { project, spec, options } = helicalToCage(p);
      const alpha = ((37 - 110) * Math.PI) / 180;
      const reach = direction === "left" ? 150 : 1100;
      expect(project.stair.placement.rotation).toBe(direction === "left" ? -73 : -253);
      expect(project.stair.placement.origin.x).toBeCloseTo(1234 + reach * Math.cos(alpha), 9);
      expect(project.stair.placement.origin.y).toBeCloseTo(-567 + reach * Math.sin(alpha), 9);
      expect(spec.sections[0]!.axis).toEqual({ kind: "arc", radius: 150, sweep: sign * 300 });
      expect(spec.sections[0]!.anchor).toBe(direction);
      const layout = computeCageLayout(project, spec, options);
      const ref = computeHelicalLayout(p, p.stair.layout as HelicalLayoutSpec).helical!;
      const arc = layout.sections![0]!.arc!;
      expect(arc.center.x).toBeCloseTo(ref.center.x, 6);
      expect(arc.center.y).toBeCloseTo(ref.center.y, 6);
      expect(layout.innerSide).toBe(direction);
      expect(layout.walklineSide).toBe(direction);
    },
  );

  it("mode `treadsPerTurn` : Θ figé au n du projet", () => {
    const p = makeHelicalProject({
      outerRadius: 1000,
      coreRadius: 100,
      direction: "left",
      treadsPerTurn: 12,
      floorToFloor: 2800,
      riserCount: 13,
    });
    expect(helicalToCage(p).spec.sections[0]!.axis).toEqual({
      kind: "arc",
      radius: 100,
      sweep: 360,
    });
  });

  it("le côté de Γ choisi dans le projet source est remplacé par le côté de l'axe", () => {
    const p = makeHelicalProject({
      outerRadius: 1000,
      coreRadius: 100,
      direction: "right",
      floorToFloor: 2800,
      walklineFromInner: 400,
    });
    const src: Project = {
      ...p,
      stair: { ...p.stair, walkline: { mode: "fromInner", distance: 400, side: "left" } },
    };
    expect(helicalToCage(src).project.stair.walkline).toEqual({
      mode: "fromInner",
      distance: 400,
      side: "right",
    });
  });
});

describe("helicalToCage — schéma de cage", () => {
  it("sous un tour, la cage rendue passe le schéma de cage sans modification (aller-retour)", () => {
    fc.assert(
      fc.property(helicalParityShapeArb, (s) => {
        const p = makeHelicalProject(s);
        const { spec } = helicalToCage(p);
        const sweep = Math.abs((spec.sections[0]!.axis as { sweep: number }).sweep);
        if (sweep < 360) expect(CageLayoutSpecSchema.parse(spec)).toEqual(spec);
        else expect(CageLayoutSpecSchema.safeParse(spec).success).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe("helicalToCage — erreurs (mêmes que computeHelicalLayout)", () => {
  const base = {
    outerRadius: 1000,
    coreRadius: 100,
    direction: "left" as const,
    floorToFloor: 2800,
  };
  const cases: readonly [string, () => Project][] = [
    [
      "angle par marche ≥ 180°",
      () => makeHelicalProject({ ...base, totalAngle: 400, riserCount: 3 }),
    ],
    [
      "ligne de foulée hors emmarchement",
      () => makeHelicalProject({ ...base, walklineFromInner: 900 }),
    ],
    [
      "R_e ≤ r_i (hors schéma)",
      () => {
        const p = makeHelicalProject(base);
        const l = p.stair.layout as HelicalLayoutSpec;
        return { ...p, stair: { ...p.stair, layout: { ...l, outerRadius: 100, width: 0 } } };
      },
    ],
    [
      "n hors domaine",
      () => {
        const p = makeHelicalProject(base);
        return {
          ...p,
          stair: {
            ...p.stair,
            stepping: { ...p.stair.stepping, riserCount: "auto", targetRise: 10 },
          },
        };
      },
    ],
  ];
  it.each(cases)("%s", (_name, make) => {
    const p = make();
    const expected = errorOf(() => computeHelicalLayout(p, p.stair.layout as HelicalLayoutSpec));
    expect(expected).not.toBeNull();
    expect(errorOf(() => helicalToCage(p))).toEqual(expected);
  });

  it("tracé non hélicoïdal refusé", () => {
    const p = j5a();
    const { project } = helicalToCage(p);
    expect(errorOf(() => helicalToCage(project))).toMatchObject({ name: "LayoutError" });
  });
});

describe("helicalToCage — pureté", () => {
  it("déterministe, sans modifier le projet source", () => {
    fc.assert(
      fc.property(helicalParityShapeArb, (s) => {
        const p = makeHelicalProject(s);
        const before = JSON.stringify(p);
        const a = helicalToCage(p);
        const b = helicalToCage(p);
        expect(a).toEqual(b);
        expect(JSON.stringify(p)).toBe(before);
      }),
      { numRuns: 200 },
    );
  });
});
