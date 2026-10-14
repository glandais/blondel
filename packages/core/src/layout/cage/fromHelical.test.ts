/**
 * Conversion `helicalToCage` (F10, sous-lots P1 à P3) : correspondance champ à champ, placement
 * recalé à gauche et à droite, aller-retour par le schéma de cage sous un tour, erreurs de la
 * conversion suivie du moteur de cage identiques à celles de `computeLayout` (contrôles portés
 * dans le moteur en P2), `helicalLayoutOf` rendu par `computeLayout` et cohérent avec la
 * géométrie de la cage, pureté et déterminisme.
 *
 * Instantanés figés (`__snapshots__/fromHelical.test.ts.snap`, P3) : les erreurs et
 * `Layout.helical` (au bit) des cas du catalogue, enregistrés pendant que l'égalité stricte avec
 * l'ancien tracé hélicoïdal (copie figée `legacyHelical.ts`, retirée en P3) était encore
 * vérifiée au même passage (journal du chantier). **Un `-u` de ce test exige une justification
 * au journal**, ligne à ligne.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageError } from "@blondel/i18n";
import { CageLayoutSpecSchema, type HelicalLayoutSpec, type Project } from "../../model/project.js";
import { parseProjectText } from "../../project/parse.js";
import { computeLayout } from "../layout.js";

import { resolveRiserCount } from "../resolve.js";
import { makeHelicalProject } from "../helical-test-helpers.js";
import { computeCageLayout } from "./cage.js";
import { helicalLayoutOf, helicalToCage } from "./fromHelical.js";
import {
  compareValues,
  gapPaths,
  helicalParityShapeArb,
  type Gaps,
} from "./helical-parity-helpers.js";
import {
  HELICAL_PARITY_CASES,
  HELICAL_PARITY_ERROR_CASES,
} from "./helical-parity-cases-helpers.js";

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
      const arc = layout.sections![0]!.arc!;
      // Centre de l'hélicoïdal = origine du placement (axe vertical).
      expect(arc.center.x).toBeCloseTo(1234, 6);
      expect(arc.center.y).toBeCloseTo(-567, 6);
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

// Titre gardé tel quel : clé des instantanés figés (référence d'enregistrement : l'ancien tracé).
describe("helicalToCage + moteur de cage — erreurs (mêmes que l'ancien tracé)", () => {
  // Depuis P2, la conversion ne contrôle que n ; R_e > r_i, d_f et Δθ sont contrôlés par le
  // moteur de cage sous l'origine `helical` (`helicalChecks.ts`) : la chaîne conversion + tracé
  // rend la même erreur que `computeLayout` (nom, clé, paramètres), figée par l'instantané
  // (enregistré égal à celle de l'ancien tracé hélicoïdal).
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
    const expected = errorOf(() => computeLayout(p));
    expect(expected).not.toBeNull();
    expect(expected).toMatchSnapshot();
    expect(
      errorOf(() => {
        const c = helicalToCage(p);
        computeCageLayout(c.project, c.spec, c.options);
      }),
    ).toEqual(expected);
  });

  it("la conversion seule ne lève plus que n hors domaine", () => {
    for (const [name, make] of cases) {
      const err = errorOf(() => helicalToCage(make()));
      if (name === "n hors domaine") {
        expect(err).toMatchObject({ msg: { key: "layout.riserCountOutOfRange" } });
      } else expect(err, name).toBeNull();
    }
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

// Titre gardé tel quel (clé des instantanés figés) ; `Layout.helical` est un résumé dérivé (P3).
describe("helicalLayoutOf — champ de compatibilité `Layout.helical` (P2)", () => {
  it("rendu au bit par computeLayout", () => {
    fc.assert(
      fc.property(helicalParityShapeArb, (s) => {
        const p = makeHelicalProject(s);
        const spec = p.stair.layout as HelicalLayoutSpec;
        expect(computeLayout(p).helical).toStrictEqual(
          helicalLayoutOf(p, spec, resolveRiserCount(p)),
        );
      }),
      { numRuns: 200 },
    );
  });

  it.each([
    ...HELICAL_PARITY_CASES.map((c) => [c.name, c.project] as const),
    ...HELICAL_PARITY_ERROR_CASES.filter((c) => c.key.startsWith("stepping.")).map(
      (c) => [c.name, c.project] as const,
    ),
  ])("%s : `Layout.helical` figé au bit (instantané)", (_name, make) => {
    const p = make();
    const spec = p.stair.layout as HelicalLayoutSpec;
    const h = helicalLayoutOf(p, spec, resolveRiserCount(p));
    expect(h).toMatchSnapshot();
    expect(computeLayout(p).helical).toStrictEqual(h);
  });

  it("cohérent avec la géométrie de la cage (1e-6 mm, 1e-9 rad)", () => {
    // Deux sources (formule de `helicalLayoutOf`, géométrie de la cage) : centre, rayon et
    // balayage de l'axe, rayons des bords et de Γ, côté de Γ, fût ou jour, palier d'arrivée.
    fc.assert(
      fc.property(helicalParityShapeArb, (s) => {
        const p = makeHelicalProject(s);
        const layout = computeLayout(p);
        const h = layout.helical!;
        const sign = h.direction === "left" ? 1 : -1;
        const sec = layout.sections?.[0];
        expect(layout.sections?.length).toBe(1);
        expect(sec?.kind).toBe("arc");
        const radiusOf = (seg: (typeof layout.inner.segments)[number] | undefined): number =>
          seg?.kind === "arc" ? seg.radius : Number.NaN;
        const gaps: Gaps = new Map();
        compareValues(
          {
            center: h.center,
            radius: h.innerRadius,
            sweep: sign * h.totalAngle,
            inner: h.innerRadius,
            outer: h.outerRadius,
            walk: h.walklineRadius,
            side: h.direction,
            core: h.core,
            arrivalSweep: sign * h.landingAngle,
            arrivalOutline: h.landingOutline,
          },
          {
            center: sec?.arc?.center,
            radius: sec?.arc?.radius,
            sweep: sec?.arc?.sweep,
            inner: radiusOf(layout.inner.segments[0]),
            outer: radiusOf(layout.outer.segments[0]),
            walk: radiusOf(layout.walkline.segments[0]),
            side: layout.walklineSide,
            core: layout.helicalOrigin?.core,
            arrivalSweep: layout.helicalOrigin?.arrivalSweep,
            arrivalOutline: layout.helicalOrigin?.arrivalOutline,
          },
          "",
          gaps,
        );
        expect(gapPaths(gaps)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
