/** Aides partagées par les tests de l'hélicoïdal (non exportées par le paquet). */
import fc from "fast-check";
import {
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  type Opening,
  type Project,
  type ProjectInput,
} from "../model/project.js";

export interface HelicalShape {
  readonly outerRadius: number;
  readonly coreRadius: number;
  readonly core?: "column" | "well";
  readonly direction: "left" | "right";
  /** Nombre de marches par tour, ou angle total (degrés) si `totalAngle` est donné. */
  readonly treadsPerTurn?: number;
  readonly totalAngle?: number;
  readonly startAngle?: number;
  readonly landingAngle?: number;
  readonly floorToFloor: number;
  readonly riserCount?: number;
  readonly treadThickness?: number;
  readonly nosing?: number;
  readonly walklineFromInner?: number;
  readonly origin?: { x: number; y: number };
  readonly rotation?: number;
  readonly opening?: Opening;
  readonly firstRiseOffset?: number;
}

/** Projet hélicoïdal minimal valide. */
export function makeHelicalProject(shape: HelicalShape): Project {
  const input: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: {
      floorToFloor: shape.floorToFloor,
      upperSlabThickness: 200,
      ...(shape.opening ? { opening: shape.opening } : {}),
    },
    stair: {
      placement: { origin: shape.origin ?? { x: 0, y: 0 }, rotation: shape.rotation ?? 0 },
      layout: {
        kind: "helical",
        direction: shape.direction,
        outerRadius: shape.outerRadius,
        core: { kind: shape.core ?? "column", radius: shape.coreRadius },
        sweep:
          shape.totalAngle !== undefined
            ? { mode: "angle", degrees: shape.totalAngle }
            : { mode: "treadsPerTurn", count: shape.treadsPerTurn ?? 12 },
        startAngle: shape.startAngle ?? 0,
        ...(shape.landingAngle ? { landing: { angle: shape.landingAngle } } : {}),
      },
      ...(shape.walklineFromInner !== undefined
        ? { walkline: { mode: "fromInner", distance: shape.walklineFromInner } }
        : {}),
      stepping: {
        ...(shape.riserCount !== undefined ? { riserCount: shape.riserCount } : {}),
        firstRiseOffset: shape.firstRiseOffset ?? 0,
      },
      treads: {
        thickness: shape.treadThickness ?? 40,
        nosing: shape.nosing ?? 10,
        risers: "none",
      },
    },
    compliance: { contexts: ["bois_dtu", "logement_interieur", "helicoidal"] },
  };
  return ProjectSchema.parse(input);
}

/**
 * Générateur CONTRAINT d'hélicoïdaux : R_e ∈ [700 ; 1 500], fût ou jour de 40 à 300 mm,
 * E ≥ 400 mm, 6 à 20 marches par tour, H ∈ [2 200 ; 3 500], n ∈ [8 ; 24], épaisseur de marche
 * ∈ [20 ; 60] < h, débord ∈ [0 ; 30], placement quelconque.
 */
export const helicalShapeArb: fc.Arbitrary<HelicalShape> = fc
  .record({
    coreRadius: fc.integer({ min: 40, max: 300 }),
    width: fc.integer({ min: 400, max: 1200 }),
    core: fc.constantFrom("column" as const, "well" as const),
    direction: fc.constantFrom("left" as const, "right" as const),
    treadsPerTurn: fc.integer({ min: 6, max: 20 }),
    startAngle: fc.integer({ min: -180, max: 180 }),
    floorToFloor: fc.integer({ min: 2200, max: 3500 }),
    riserCount: fc.integer({ min: 12, max: 22 }),
    treadThickness: fc.integer({ min: 20, max: 60 }),
    nosing: fc.integer({ min: 0, max: 30 }),
    origin: fc.record({
      x: fc.integer({ min: -5000, max: 5000 }),
      y: fc.integer({ min: -5000, max: 5000 }),
    }),
    rotation: fc.integer({ min: -180, max: 180 }),
  })
  .map((r) => ({
    outerRadius: r.coreRadius + r.width,
    coreRadius: r.coreRadius,
    core: r.core,
    direction: r.direction,
    treadsPerTurn: r.treadsPerTurn,
    startAngle: r.startAngle,
    floorToFloor: r.floorToFloor,
    riserCount: r.riserCount,
    treadThickness: r.treadThickness,
    nosing: r.nosing,
    origin: r.origin,
    rotation: r.rotation,
  }));
