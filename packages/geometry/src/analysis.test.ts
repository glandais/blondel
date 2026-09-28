import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bbox, checkManifold, signedVolume, surfaceArea, unionBbox } from "./analysis.js";
import { meshExtrusion } from "./extrude.js";
import { flipMesh, mergeMeshes, type Mesh } from "./mesh.js";
import { identityFrame, rect } from "./testing.js";

const box = (x: number, w: number): Mesh => meshExtrusion(identityFrame, { outer: rect(x, 0, w, w), holes: [] }, w);

describe("analyses", () => {
  it("bbox, aire, volume d'un cube", () => {
    const m = box(0, 10);
    expect(bbox(m)).toEqual({ min: { x: -5, y: -5, z: 0 }, max: { x: 5, y: 5, z: 10 } });
    expect(surfaceArea(m)).toBeCloseTo(600, 6);
    expect(signedVolume(m)).toBeCloseTo(1000, 6);
    expect(bbox({ positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) })).toBeNull();
  });

  it("flipMesh : volume opposé, orientation incohérente détectée si un seul triangle est retourné", () => {
    const m = box(0, 10);
    expect(signedVolume(flipMesh(m))).toBeCloseTo(-1000, 6);
    expect(checkManifold(flipMesh(m)).ok).toBe(true);
    const indices = m.indices.slice();
    [indices[1], indices[2]] = [indices[2]!, indices[1]!];
    const r = checkManifold({ ...m, indices });
    expect(r.ok).toBe(false);
    expect(r.misorientedEdges).toBe(3);
  });

  it("maillage ouvert : arêtes de bord détectées", () => {
    const m = box(0, 10);
    const r = checkManifold({ ...m, indices: m.indices.slice(3) });
    expect(r.ok).toBe(false);
    expect(r.boundaryEdges).toBe(3);
  });

  it("arête partagée par 4 triangles : non-variété", () => {
    // Deux cubes partageant une arête : variété après soudure ? Non.
    const a = box(0, 10);
    const b = meshExtrusion(identityFrame, { outer: rect(10, 10, 10, 10), holes: [] }, 10);
    const r = checkManifold(mergeMeshes([a, b]));
    expect(r.nonManifoldEdges).toBeGreaterThan(0);
  });

  it("propriété : fusion = somme des volumes, union des boîtes, variété conservée (solides disjoints)", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 1, max: 50, noNaN: true }), { minLength: 1, maxLength: 8 }), (sizes) => {
        const meshes = sizes.map((w, k) => box(100 * k, w));
        const merged = mergeMeshes(meshes);
        const vol = sizes.reduce((s, w) => s + w ** 3, 0);
        expect(Math.abs(signedVolume(merged) - vol)).toBeLessThan(1e-4 * vol);
        expect(bbox(merged)).toEqual(unionBbox(meshes.map(bbox)));
        expect(checkManifold(merged).ok).toBe(true);
        expect(merged.indices.length).toBe(meshes.reduce((s, m) => s + m.indices.length, 0));
      }),
    );
  });
});

describe("checkManifold — paramètres (revue)", () => {
  it("tolérance de soudure nulle, négative ou non finie : RangeError", () => {
    const m = box(0, 10);
    expect(() => checkManifold(m, 0)).toThrow(RangeError);
    expect(() => checkManifold(m, -1)).toThrow(RangeError);
    expect(() => checkManifold(m, Number.NaN)).toThrow(RangeError);
  });
});
