/**
 * Garde-corps d'une cage saisie (ADR-0010, sous-lot 2d) : raccord de jour lu dans le tracé
 * (`TurnZone.well`, jamais dans `stair.layout.turns`, vide pour une cage), jour étroit entre
 * deux jonctions à ±90° (paliers droits intermédiaires compris), aucun jour étroit retenu pour
 * d'autres angles (garde-corps construit, côté de la sécurité).
 */
import { describe, expect, it } from "vitest";
import { computeCageLayout } from "../layout/cage/cage.js";
import { cageToFlights } from "../layout/cage/fromFlights.js";
import { computeLayout } from "../layout/layout.js";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpec,
  type CageLayoutSpecInput,
  type Project,
} from "../model/project.js";
import { computeStepping } from "../stepping/stepping.js";
import { computeGuards } from "./compute.js";
import { newelSetback } from "../layout/newel.js";
import { jourWidth, zoneWell } from "./jour.js";
import { sideEdge } from "./sides.js";

const straight = (length: number, width = 900) => ({
  axis: { kind: "straight" as const, length },
  width,
});

function cageProject(layout: CageLayoutSpecInput): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: 2700, upperSlabThickness: 200 },
    stair: { placement: { origin: { x: 0, y: 0 }, rotation: 0 }, layout },
    guards: {},
  });
}

function guardsOf(layout: CageLayoutSpecInput) {
  const project = cageProject(layout);
  const l = computeLayout(project);
  const st = computeStepping(project, l);
  return { project, layout: l, guards: computeGuards(project, l, st) };
}

describe("jour d'une cage", () => {
  it("U à deux jonctions de 90° et jour de 100 mm : jour étroit, pas de garde-corps de jour", () => {
    const { layout, guards } = guardsOf({
      kind: "cage",
      sections: [straight(1500), straight(100), straight(1500)],
      junctions: [
        { angle: 90, mode: "winders" },
        { angle: 90, mode: "winders" },
      ],
    });
    expect(jourWidth(layout, [])).toBeCloseTo(100, 9);
    expect(guards.narrowJour?.width).toBeCloseTo(100, 9);
    expect(guards.runs.filter((r) => r.side === "inner")).toEqual([]);
  });

  it("palier droit entre deux jonctions de 90° : jour = distance des coins, jour étroit", () => {
    const { layout, guards } = guardsOf({
      kind: "cage",
      sections: [straight(1500), straight(0), straight(0), straight(1500)],
      junctions: [
        { angle: 90, mode: "landing" },
        { angle: 0, mode: "landing", depth: 100 },
        { angle: 90, mode: "landing" },
      ],
    });
    expect(layout.turns).toHaveLength(3);
    expect(jourWidth(layout, [])).toBeCloseTo(100, 9);
    expect(guards.narrowJour).toBeDefined();
  });

  it("60° puis 120° (volées opposées, non perpendiculaires au jour) : aucun jour étroit, garde-corps de jour construit", () => {
    const { layout, guards } = guardsOf({
      kind: "cage",
      sections: [straight(1500), straight(100), straight(1500)],
      junctions: [
        { angle: 60, mode: "winders" },
        { angle: 120, mode: "winders" },
      ],
    });
    expect(jourWidth(layout, [])).toBe(Infinity);
    expect(guards.narrowJour).toBeUndefined();
    expect(guards.runs.filter((r) => r.kind === "rake" && r.side === "inner")).toHaveLength(1);
  });

  it("axe en arc entre deux jonctions de 90° : aucun jour étroit retenu", () => {
    const project = cageProject({
      kind: "cage",
      sections: [
        straight(1500),
        { axis: { kind: "arc", radius: 3000, sweep: 10 }, width: 900 },
        straight(1500),
      ],
      junctions: [
        { angle: 90, mode: "landing" },
        { angle: 90, mode: "landing" },
      ],
    });
    expect(jourWidth(computeLayout(project), [])).toBe(Infinity);
  });
});

describe("poteau d'angle d'une cage lu dans le tracé (`TurnZone.well`)", () => {
  it("jour à poteau à 90° : même bord et même poteau que le tracé à volées équivalent", () => {
    const cage = cageProject({
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: 90, mode: "winders", well: { kind: "newel", size: 100 } }],
    });
    // Moteur de cage seul : `computeLayout` refuse encore le poteau d'une cage saisie.
    const layout = computeCageLayout(cage, cage.stair.layout as CageLayoutSpec, {
      origin: "cage",
    });
    expect(cage.stair.layout.turns).toEqual([]);
    expect(zoneWell(layout.turns[0]!, cage.stair.layout.turns)).toEqual({
      kind: "newel",
      size: 100,
    });
    // Référence indépendante : tracé et découpage du projet à volées équivalent, calculés par
    // `computeLayout` (poteau lu dans `stair.layout.turns`).
    const flights = {
      ...cage,
      stair: { ...cage.stair, layout: cageToFlights(cage.stair.layout as CageLayoutSpec)! },
    };
    expect(flights.stair.layout.turns[0]!.inner).toEqual({ kind: "newel", size: 100 });
    const flightsLayout = computeLayout(flights);
    const reference = sideEdge(
      "inner",
      flightsLayout,
      computeStepping(flights, flightsLayout),
      flights,
    );
    const fromCage = sideEdge("inner", layout, computeStepping(flights, layout), cage);
    expect(reference.newels).toHaveLength(1);
    expect(fromCage.newels).toHaveLength(1);
    // Côté équivalent : 2 × débord côté jour du poteau de 100 mm (`newelSetback`).
    expect(fromCage.newels[0]!.size).toBeCloseTo(2 * newelSetback({ kind: "newel", size: 100 }), 9);
    expect(fromCage.newels[0]!.size).toBeCloseTo(reference.newels[0]!.size, 9);
    expect(fromCage.newels[0]!.u).toBeCloseTo(reference.newels[0]!.u, 9);
    expect(fromCage.newels[0]!.turn).toBe(reference.newels[0]!.turn);
    // Bord : le contour du poteau remplacé par le coin K, comme pour le tracé à volées.
    expect(fromCage.points).toHaveLength(reference.points.length);
    fromCage.points.forEach((q, i) => {
      expect(q.x).toBeCloseTo(reference.points[i]!.x, 6);
      expect(q.y).toBeCloseTo(reference.points[i]!.y, 6);
    });
  });

  it("repli : `TurnZone.well` absent, raccord lu dans le tournant du projet de même indice", () => {
    const flights = ProjectSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      site: { floorToFloor: 2700, upperSlabThickness: 200 },
      stair: {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout: cageToFlights({
          ...(cageProject({
            kind: "cage",
            sections: [straight(1500), straight(1500)],
            junctions: [{ angle: 90, mode: "winders", well: { kind: "newel", size: 120 } }],
          }).stair.layout as CageLayoutSpec),
        })!,
      },
    });
    const zone = computeLayout(flights).turns[0]!;
    const { well: _well, ...bare } = zone;
    expect(zoneWell(bare, flights.stair.layout.turns)).toEqual({ kind: "newel", size: 120 });
    expect(zoneWell(bare, [])).toBeUndefined();
  });
});
