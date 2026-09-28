/** Aides partagées par les tests du tracé (non exportées par le paquet). */
import fc from "fast-check";
import type { InnerCorner, Project, ProjectInput } from "../model/project.js";
import { ProjectSchema, PROJECT_SCHEMA_VERSION } from "../model/project.js";

export interface StairShape {
  readonly width: number;
  readonly legs: readonly (number | "auto")[];
  readonly direction?: "left" | "right";
  readonly mode?: "winders" | "landing";
  readonly inner?: InnerCorner | readonly InnerCorner[];
  readonly walkline?: { mode: "dtu" } | { mode: "fromInner"; distance: number };
  readonly origin?: { x: number; y: number };
  readonly rotation?: number;
  readonly floorToFloor?: number;
}

/** Projet minimal valide pour un tracé donné. */
export function makeProject(shape: StairShape): Project {
  const turnCount = shape.legs.length - 1;
  const innerAt = (j: number): InnerCorner => {
    const inner = shape.inner ?? { kind: "sharp" };
    return Array.isArray(inner) ? inner[j]! : (inner as InnerCorner);
  };
  const input: ProjectInput = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    site: { floorToFloor: shape.floorToFloor ?? 2700, upperSlabThickness: 200 },
    stair: {
      placement: { origin: shape.origin ?? { x: 0, y: 0 }, rotation: shape.rotation ?? 0 },
      layout: {
        width: shape.width,
        legs: shape.legs.map((length) => ({ length })),
        turns: Array.from({ length: turnCount }, (_, j) => ({
          direction: shape.direction ?? "left",
          mode: shape.mode ?? "winders",
          inner: innerAt(j),
        })),
      },
      ...(shape.walkline ? { walkline: shape.walkline } : {}),
    },
  };
  return ProjectSchema.parse(input);
}

/** Retrait de la partie droite de C_i (même convention que le tracé). */
export function setbackOf(inner: InnerCorner): number {
  return inner.kind === "sharp" ? 0 : inner.kind === "arc" ? inner.radius : inner.size / 2;
}

/**
 * Générateur CONTRAINT de tracés valides : E ∈ [700 ; 1 500] (DTU milieu et 600 mm), 1 à 3
 * volées de même sens, raccords de jour quelconques compatibles avec d_f, longueurs ≥ minimum
 * requis + marge, placement quelconque. Les volées ne se recoupent pas en plan (≤ 2 tournants).
 */
export const stairShapeArb: fc.Arbitrary<StairShape> = fc
  .record({
    width: fc.integer({ min: 700, max: 1500 }),
    legCount: fc.integer({ min: 1, max: 3 }),
    direction: fc.constantFrom("left" as const, "right" as const),
    mode: fc.constantFrom("winders" as const, "landing" as const),
    innerKinds: fc.array(
      fc.oneof(
        fc.constant({ kind: "sharp" as const }),
        fc.record({ kind: fc.constant("arc" as const), radius: fc.integer({ min: 1, max: 400 }) }),
        fc.integer({ min: 30, max: 75 }).map((k) => ({ kind: "newel" as const, size: 2 * k })),
      ),
      { minLength: 2, maxLength: 2 },
    ),
    extras: fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: 3, maxLength: 3 }),
    useFromInner: fc.boolean(),
    fromInnerRatio: fc.double({ min: 0.3, max: 0.7, noNaN: true }),
    origin: fc.record({
      x: fc.integer({ min: -10000, max: 10000 }),
      y: fc.integer({ min: -10000, max: 10000 }),
    }),
    rotation: fc.integer({ min: -360, max: 360 }),
  })
  .map((r) => {
    const turns = r.innerKinds.slice(0, r.legCount - 1);
    const legs = Array.from({ length: r.legCount }, (_, i) => {
      const before = i > 0 ? r.width + setbackOf(turns[i - 1]!) : 0;
      const after = i < turns.length ? r.width + setbackOf(turns[i]!) : 0;
      return Math.max(1, before + after + r.extras[i]!);
    });
    const shape: StairShape = {
      width: r.width,
      legs,
      direction: r.direction,
      mode: r.mode,
      inner: turns.length > 0 ? turns : [{ kind: "sharp" }],
      origin: r.origin,
      rotation: r.rotation,
      ...(r.useFromInner
        ? {
            walkline: {
              mode: "fromInner" as const,
              distance: Math.round(r.width * r.fromInnerRatio),
            },
          }
        : {}),
    };
    return shape;
  });
