import type { Frame3, Vec3 } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GeometryError } from "./errors.js";
import { meshExtrusion } from "./extrude.js";
import type { Mesh } from "./mesh.js";
import { meshSweep } from "./sweep.js";
import { frame3, identityFrame, rect } from "./testing.js";
import { grainFrame, grainUVMesh, grainUVs, principalAxis, uvFace } from "./uv.js";
import { cross, dot, length } from "./vec3.js";

/** Direction non nulle quelconque. */
const direction: fc.Arbitrary<Vec3> = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 1e-3)
  .map(([x, y, z]) => ({ x, y, z }));

/** Pavé L × l × e posé dans `frame` : la longueur L suit `frame.xAxis`. */
function board(frame: Frame3, L: number, w: number, e: number): Mesh {
  return meshExtrusion(frame, { outer: rect(L / 2, w / 2, L, w), holes: [] }, e);
}

function vertex(m: Mesh, v: number): Vec3 {
  return { x: m.positions[3 * v]!, y: m.positions[3 * v + 1]!, z: m.positions[3 * v + 2]! };
}

function normal(m: Mesh, v: number): Vec3 {
  return { x: m.normals[3 * v]!, y: m.normals[3 * v + 1]!, z: m.normals[3 * v + 2]! };
}

describe("repère du fil", () => {
  it("propriété : orthonormé direct, premier axe = fil normalisé, travers horizontal", () => {
    fc.assert(
      fc.property(direction, (g) => {
        const f = grainFrame(g);
        for (const a of [f.along, f.across, f.third]) expect(length(a)).toBeCloseTo(1, 9);
        expect(dot(f.along, f.across)).toBeCloseTo(0, 9);
        expect(dot(f.along, f.third)).toBeCloseTo(0, 9);
        expect(dot(f.across, f.third)).toBeCloseTo(0, 9);
        const c = cross(f.along, f.across);
        expect(dot(c, f.third)).toBeCloseTo(1, 9);
        expect(dot(f.along, g) / length(g)).toBeCloseTo(1, 9);
        // Travers horizontal sauf fil (quasi) vertical.
        if (Math.hypot(g.x, g.y) / length(g) > 1e-3) expect(f.across.z).toBeCloseTo(0, 9);
      }),
    );
  });

  it("fil vertical : travers selon X ; fil nul ou non fini refusé", () => {
    const f = grainFrame({ x: 0, y: 0, z: 1 });
    expect(f.across.x).toBeCloseTo(1, 12);
    expect(() => grainFrame({ x: 0, y: 0, z: 0 })).toThrow(GeometryError);
    expect(() => grainFrame({ x: NaN, y: 0, z: 1 })).toThrow(GeometryError);
  });
});

describe("UV projetées selon le fil", () => {
  it("planche 1 000 × 300 × 40, fil selon X : veines le long de X sur les faces de fil, bois de bout aux extrémités", () => {
    const m = board(identityFrame, 1000, 300, 40);
    const uv = grainUVs(m, { x: 1, y: 0, z: 0 });
    expect(uv.length).toBe((m.positions.length / 3) * 2);
    let end = 0;
    for (let v = 0; v < m.positions.length / 3; v++) {
      const p = vertex(m, v);
      if (Math.abs(normal(m, v).x) > 0.5) {
        end++;
        continue;
      }
      expect(uv[2 * v]).toBeCloseTo(p.x / 1000, 6);
    }
    expect(end).toBe(8);
  });

  it("propriété : planche dans un repère quelconque, fil selon sa longueur — u = p·g / période sur les faces de fil, étendue de u = L, bois de bout = 2 faces", () => {
    fc.assert(
      fc.property(
        frame3,
        fc.double({ min: 200, max: 4000, noNaN: true }),
        fc.double({ min: 20, max: 190, noNaN: true }),
        fc.double({ min: 10, max: 60, noNaN: true }),
        fc.double({ min: 100, max: 2000, noNaN: true }),
        (frame, L, w, e, period) => {
          const m = board(frame, L, w, e);
          const g = frame.xAxis;
          const uv = grainUVs(m, g, { period });
          const f = grainFrame(g);
          let umin = Infinity;
          let umax = -Infinity;
          let end = 0;
          for (let v = 0; v < m.positions.length / 3; v++) {
            const face = uvFace(f, normal(m, v));
            if (face === "end") {
              end++;
              continue;
            }
            const u = uv[2 * v]!;
            expect(Math.abs(u - dot(vertex(m, v), f.along) / period)).toBeLessThan(1e-5);
            umin = Math.min(umin, u);
            umax = Math.max(umax, u);
          }
          expect(end).toBe(8);
          expect(Math.abs((umax - umin) * period - L)).toBeLessThan(0.05);
          for (const x of uv) expect(Number.isFinite(x)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("propriété : translation le long du fil → u décalé d'autant sur les faces de fil, v inchangé", () => {
    fc.assert(
      fc.property(frame3, fc.double({ min: -3000, max: 3000, noNaN: true }), (frame, t) => {
        const m1 = board(frame, 1200, 250, 40);
        const shifted: Frame3 = {
          ...frame,
          origin: {
            x: frame.origin.x + t * frame.xAxis.x,
            y: frame.origin.y + t * frame.xAxis.y,
            z: frame.origin.z + t * frame.xAxis.z,
          },
        };
        const m2 = board(shifted, 1200, 250, 40);
        const a = grainUVs(m1, frame.xAxis);
        const b = grainUVs(m2, frame.xAxis);
        const f = grainFrame(frame.xAxis);
        for (let v = 0; v < m1.positions.length / 3; v++) {
          if (uvFace(f, normal(m1, v)) === "end") continue;
          expect(Math.abs(b[2 * v]! - a[2 * v]! - t / 1000)).toBeLessThan(1e-5);
          expect(Math.abs(b[2 * v + 1]! - a[2 * v + 1]!)).toBeLessThan(1e-5);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("sans fil déclaré : axe principal du maillage (main courante le long de Y)", () => {
    const m = meshSweep(
      [
        { x: 0, y: 0, z: 900 },
        { x: 0, y: 3000, z: 900 },
      ],
      {
        outer: [
          { x: -20, y: -20 },
          { x: 20, y: -20 },
          { x: 20, y: 20 },
          { x: -20, y: 20 },
        ],
        holes: [],
      },
    );
    expect(principalAxis(m)).toEqual({ x: 0, y: 1, z: 0 });
    expect(Array.from(grainUVs(m))).toEqual(Array.from(grainUVs(m, { x: 0, y: 1, z: 0 })));
    expect(principalAxis({ ...m, positions: new Float32Array(0) })).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("période invalide refusée", () => {
    const m = board(identityFrame, 100, 50, 10);
    expect(() => grainUVs(m, { x: 1, y: 0, z: 0 }, { period: 0 })).toThrow(GeometryError);
  });
});

/** Main courante ronde (rayon r, `sides` facettes lissées) le long d'une hélice. */
function helicalRail(r: number, sides: number, radius: number, turn: number, rise: number): Mesh {
  const ring = Array.from({ length: sides }, (_, i) => ({
    x: r * Math.cos((2 * Math.PI * i) / sides),
    y: r * Math.sin((2 * Math.PI * i) / sides),
  }));
  const path = Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * turn;
    return { x: radius * Math.cos(a), y: radius * Math.sin(a), z: 900 + (i / 32) * rise };
  });
  return meshSweep(path, { outer: ring, holes: [] });
}

/** Plus grand rapport |Δuv| · période / |Δp| sur les arêtes des triangles. */
function worstStretch(m: Mesh, uv: Float32Array, period: number): number {
  let worst = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const i = m.indices[t + c]!;
      const j = m.indices[t + ((c + 1) % 3)]!;
      const dp = Math.hypot(
        m.positions[3 * i]! - m.positions[3 * j]!,
        m.positions[3 * i + 1]! - m.positions[3 * j + 1]!,
        m.positions[3 * i + 2]! - m.positions[3 * j + 2]!,
      );
      const du = Math.hypot(uv[2 * i]! - uv[2 * j]!, uv[2 * i + 1]! - uv[2 * j + 1]!) * period;
      if (dp > 1e-3) worst = Math.max(worst, du / dp);
    }
  }
  return worst;
}

describe("UV par triangle (coutures dupliquées)", () => {
  it("régression : main courante ronde lissée — la projection par sommet écrase la texture, pas la projection par triangle", () => {
    const m = helicalRail(21, 16, 1000, Math.PI, 2000);
    // Projection par sommet : triangles à cheval sur deux classes (étirement de plusieurs centaines).
    expect(worstStretch(m, grainUVs(m), 1000)).toBeGreaterThan(10);
    const r = grainUVMesh(m);
    expect(worstStretch(r.mesh, r.uvs, 1000)).toBeLessThan(1 + 1e-3);
  });

  it("propriété : |Δuv| ≤ |Δp| / période dans chaque triangle ; mêmes triangles, positions et normales", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 40, noNaN: true }),
        fc.integer({ min: 3, max: 24 }),
        fc.double({ min: 200, max: 2000, noNaN: true }),
        fc.double({ min: 0.2, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.option(direction, { nil: undefined }),
        fc.double({ min: 100, max: 2000, noNaN: true }),
        (r, sides, radius, turn, rise, grain, period) => {
          const m = helicalRail(r, sides, radius, turn, rise);
          const out = grainUVMesh(m, grain, { period });
          expect(out.uvs.length).toBe((out.mesh.positions.length / 3) * 2);
          expect(out.mesh.indices.length).toBe(m.indices.length);
          let same = true;
          for (let k = 0; k < m.indices.length; k++) {
            const i = m.indices[k]!;
            const j = out.mesh.indices[k]!;
            for (let c = 0; c < 3; c++) {
              same &&= out.mesh.positions[3 * j + c] === m.positions[3 * i + c];
              same &&= out.mesh.normals[3 * j + c] === m.normals[3 * i + c];
            }
          }
          expect(same).toBe(true);
          expect(worstStretch(out.mesh, out.uvs, period)).toBeLessThan(1 + 1e-3);
          expect(out.uvs.every(Number.isFinite)).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  }, 30_000);

  it("maillage à faces planes : aucune couture, maillage partagé et UV identiques à la projection par sommet", () => {
    fc.assert(
      fc.property(frame3, (frame) => {
        const m = board(frame, 1200, 250, 40);
        const out = grainUVMesh(m, frame.xAxis);
        expect(out.mesh).toBe(m);
        expect(Array.from(out.uvs)).toEqual(Array.from(grainUVs(m, frame.xAxis)));
      }),
      { numRuns: 50 },
    );
  });
});
