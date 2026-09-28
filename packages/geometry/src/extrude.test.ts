import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bbox, checkManifold, signedVolume } from "./analysis.js";
import { meshExtrusion } from "./extrude.js";
import { shapeArea } from "./polygon.js";
import { GeometryError } from "./errors.js";
import { frame3, identityFrame, minNormalAgreement, rect, shapeWithHoles } from "./testing.js";

describe("meshExtrusion", () => {
  it("pavé 1000 × 300 × 40 : volume, boîte, 12 triangles, 24 sommets (arêtes vives)", () => {
    const m = meshExtrusion(identityFrame, { outer: rect(500, 150, 1000, 300), holes: [] }, 40);
    expect(signedVolume(m)).toBeCloseTo(1000 * 300 * 40, 3);
    expect(bbox(m)).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 300, z: 40 } });
    expect(m.indices.length / 3).toBe(12);
    expect(m.positions.length / 3).toBe(24);
    expect(checkManifold(m).ok).toBe(true);
    expect(minNormalAgreement(m)).toBeGreaterThan(0.9999);
  });

  it("profondeur nulle : maillage vide", () => {
    expect(
      meshExtrusion(identityFrame, { outer: rect(0, 0, 1, 1), holes: [] }, 0).indices.length,
    ).toBe(0);
  });

  it("propriété : fermé, orienté, volume = aire × |profondeur| (trous, repère quelconque, profondeur signée)", () => {
    fc.assert(
      fc.property(
        shapeWithHoles,
        frame3,
        fc.double({ min: 1, max: 3000, noNaN: true }),
        fc.boolean(),
        (shape, frame, d, neg) => {
          const depth = neg ? -d : d;
          const m = meshExtrusion(frame, shape, depth);
          const report = checkManifold(m);
          expect(report).toMatchObject({ ok: true });
          // Tolérance : positions en float32 (≈ 2,4e-4 mm à 5 000 mm de l'origine) → aire × 1e-3 mm.
          const area = shapeArea(shape);
          expect(Math.abs(signedVolume(m) - area * d)).toBeLessThan(1e-5 * area * d + 1e-3 * area);
          expect(minNormalAgreement(m)).toBeGreaterThan(0.999);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("angle de lissage : un cylindre à 64 facettes a des normales latérales lissées", () => {
    const n = 64;
    const circle = Array.from({ length: n }, (_, i) => ({
      x: 50 * Math.cos((2 * Math.PI * i) / n),
      y: 50 * Math.sin((2 * Math.PI * i) / n),
    }));
    const flat = meshExtrusion(identityFrame, { outer: circle, holes: [] }, 100);
    const smooth = meshExtrusion(identityFrame, { outer: circle, holes: [] }, 100, {
      creaseAngleDeg: 30,
    });
    expect(flat.positions.length / 3).toBe(4 * n + 2 * n);
    expect(smooth.positions.length / 3).toBe(2 * n + 2 * n);
    expect(checkManifold(smooth).ok).toBe(true);
    // Normale d'un sommet latéral lissé : radiale.
    expect(Math.hypot(smooth.normals[0]!, smooth.normals[1]!)).toBeCloseTo(1, 5);
    expect(smooth.normals[0]!).toBeCloseTo(1, 5);
  });
});

describe("meshExtrusion — trous alignés (régression earcut)", () => {
  it("mortaises alignées : maillage fermé malgré les points alignés après pontage", () => {
    const holes = [0, 1, 2, 3, 4].map((k) => [...rect(-200 + 100 * k, 0, 30, 40)].reverse());
    const shape = { outer: rect(0, 0, 600, 200), holes };
    const m = meshExtrusion(identityFrame, shape, 20);
    expect(checkManifold(m).ok).toBe(true);
    expect(signedVolume(m)).toBeCloseTo((600 * 200 - 5 * 30 * 40) * 20, 2);
  });
});

describe("meshExtrusion — propriété, grilles de trous alignés", () => {
  it("fermé et volume exact pour une grille de trous (mortaises, perçages alignés)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 4 }),
        fc.double({ min: 2, max: 30, noNaN: true }),
        (nx, ny, w) => {
          const holes = [];
          for (let i = 0; i < nx; i++)
            for (let j = 0; j < ny; j++) holes.push(rect(100 * i, 80 * j, w, w * 1.5));
          const shape = { outer: rect(50 * (nx - 1), 40 * (ny - 1), 100 * nx, 80 * ny), holes };
          const m = meshExtrusion(identityFrame, shape, 25);
          expect(checkManifold(m).ok).toBe(true);
          expect(signedVolume(m)).toBeCloseTo(shapeArea(shape) * 25, 0);
        },
      ),
    );
  });
});

describe("meshExtrusion — entrées invalides ou quelconques (revue)", () => {
  const square = { outer: rect(0, 0, 100, 100), holes: [] };

  it("repère dégénéré ou non fini : GeometryError", () => {
    const X = { x: 1, y: 0, z: 0 };
    expect(() => meshExtrusion({ ...identityFrame, yAxis: X }, square, 10)).toThrow(GeometryError);
    expect(() =>
      meshExtrusion({ ...identityFrame, zAxis: { x: 0, y: 1, z: 0 } }, square, 10),
    ).toThrow(GeometryError);
    expect(() =>
      meshExtrusion({ ...identityFrame, zAxis: { x: 0, y: 0, z: 0 } }, square, 10),
    ).toThrow(GeometryError);
    expect(() =>
      meshExtrusion({ ...identityFrame, origin: { x: Number.NaN, y: 0, z: 0 } }, square, 10),
    ).toThrow(GeometryError);
    expect(() => meshExtrusion(identityFrame, square, Number.POSITIVE_INFINITY)).toThrow(
      GeometryError,
    );
  });

  it("angle de lissage hors de [0, 180] : GeometryError", () => {
    expect(() => meshExtrusion(identityFrame, square, 10, { creaseAngleDeg: 200 })).toThrow(
      GeometryError,
    );
    expect(() => meshExtrusion(identityFrame, square, 10, { creaseAngleDeg: -1 })).toThrow(
      GeometryError,
    );
  });

  it("propriété : trous quelconques (chevauchants, sortants, jointifs) → GeometryError ou maillage fermé au volume exact", () => {
    // Trous sur une grille de 10 mm : chevauchements, arêtes communes et points alignés fréquents.
    const hole = fc
      .tuple(
        fc.integer({ min: -6, max: 6 }),
        fc.integer({ min: -6, max: 6 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
      )
      .map(([cx, cy, w, h]) => rect(10 * cx, 10 * cy, 10 * w, 10 * h));
    let closed = 0;
    fc.assert(
      fc.property(fc.array(hole, { maxLength: 6 }), (holes) => {
        const shape = { outer: rect(0, 0, 120, 120), holes };
        let m;
        try {
          m = meshExtrusion(identityFrame, shape, 10);
        } catch (e) {
          expect(e).toBeInstanceOf(GeometryError);
          return;
        }
        closed++;
        expect(checkManifold(m)).toMatchObject({ ok: true });
        expect(signedVolume(m)).toBeCloseTo(shapeArea(shape) * 10, 3);
      }),
      { numRuns: 300 },
    );
    expect(closed).toBeGreaterThan(0);
  });
});
