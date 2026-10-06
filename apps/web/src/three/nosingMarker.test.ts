import { buildModel, createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { NOSING_MARKER_SECTION_MM, nosingMarkerPose } from "./nosingMarker.js";

describe("repère 3D du nez d'arrivée (QUESTIONS A28)", () => {
  it("barre de Q à R, à l'altitude du nez, orientée selon la ligne de nez", () => {
    const pose = nosingMarkerPose({ q: { x: 0, y: 0 }, r: { x: 0, y: 900 }, z: 2800 })!;
    expect(pose.length).toBe(900);
    expect(pose.position).toEqual([0, 450, 2800 + NOSING_MARKER_SECTION_MM / 2]);
    expect(pose.rotationZ).toBeCloseTo(Math.PI / 2, 12);
  });

  it("ligne dégénérée : pas de barre", () => {
    expect(nosingMarkerPose({ q: { x: 1, y: 1 }, r: { x: 1, y: 1 }, z: 0 })).toBeNull();
    expect(nosingMarkerPose({ q: { x: 0, y: 0 }, r: { x: Number.NaN, y: 0 }, z: 0 })).toBeNull();
  });

  it("nez d'arrivée d'un préréglage : longueur = emmarchement mesuré entre les bords", () => {
    const model = buildModel(createProject("quarter-left"));
    const last = model.stepping.nosings[model.stepping.nosings.length - 1]!;
    const pose = nosingMarkerPose(last)!;
    expect(pose.length).toBeCloseTo(Math.hypot(last.r.x - last.q.x, last.r.y - last.q.y), 9);
    expect(pose.length).toBeGreaterThan(0);
    expect(pose.position[2]).toBeCloseTo(last.z + NOSING_MARKER_SECTION_MM / 2, 9);
  });
});
