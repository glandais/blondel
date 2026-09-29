import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Object3D, Plane, Vector3 } from "three";
import {
  NO_SECTION,
  isClippedInScene,
  sectionPlane,
  signedDistance,
  type SectionAxis,
} from "./section.js";

const box = { min: { x: -500, y: 0, z: 0 }, max: { x: 1500, y: 3000, z: 2800 } };
const coord = fc.double({ min: -6000, max: 6000, noNaN: true });

describe("plan de coupe", () => {
  it("propriété : conserve exactement les points d'abscisse ≤ plan (≥ si inversé)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<SectionAxis>("x", "y", "z"),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        coord,
        coord,
        coord,
        (axis, t, flip, x, y, z) => {
          const plane = sectionPlane(axis, t, box, flip);
          const c = box.min[axis] + t * (box.max[axis] - box.min[axis]);
          const p = { x, y, z };
          const d = signedDistance(plane, p);
          expect(d).toBeCloseTo(((flip ? 1 : -1) * (p[axis] - c)) / 1000, 9);
          expect(Math.hypot(...plane.normal)).toBeCloseTo(1, 12);
        },
      ),
    );
  });

  it("désactivé : tout est conservé", () => {
    expect(signedDistance(NO_SECTION, { x: 1e5, y: -1e5, z: 1e5 })).toBeGreaterThan(0);
  });
});

describe("plan de coupe dans la scène three.js", () => {
  it("propriété : même résultat que three.js (Plane) sur un point transformé par le groupe racine de la vue (rotation −90° autour de X, échelle 1/1 000)", () => {
    // Groupe racine de Viewer3D, construit indépendamment de `toSceneVector`.
    const root = new Object3D();
    root.rotation.set(-Math.PI / 2, 0, 0);
    root.scale.setScalar(0.001);
    root.updateMatrixWorld(true);
    fc.assert(
      fc.property(
        fc.constantFrom<SectionAxis>("x", "y", "z"),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        coord,
        coord,
        coord,
        (axis, t, flip, x, y, z) => {
          const plane = sectionPlane(axis, t, box, flip);
          const three = new Plane(new Vector3(...plane.normal), plane.constant);
          const world = root.localToWorld(new Vector3(x, y, z));
          const d = three.distanceToPoint(world);
          expect(d).toBeCloseTo(signedDistance(plane, { x, y, z }), 9);
          // Partie conservée (≥ 0) : p_axe ≤ c, ou ≥ c si inversé.
          const c = box.min[axis] + t * (box.max[axis] - box.min[axis]);
          const v = { x, y, z }[axis];
          if (Math.abs(v - c) > 1e-6) {
            expect(isClippedInScene(plane, world)).toBe(flip ? v < c : v > c);
          }
        },
      ),
    );
  });

  it("désactivé : aucun point de la scène n'est découpé", () => {
    expect(isClippedInScene(NO_SECTION, { x: 50, y: 50, z: -50 })).toBe(false);
  });
});
