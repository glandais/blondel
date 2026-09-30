import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Vec2, Vec3 } from "@blondel/core";
import { checkManifold, signedVolume } from "./analysis.js";
import { GeometryError } from "./errors.js";
import { meshRuled } from "./ruled.js";
import { minNormalAgreement } from "./testing.js";

describe("meshRuled", () => {
  it("limon droit vertical : pavé L × h × e", () => {
    const a: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 3000, y: 0, z: 2000 },
    ];
    const b: Vec3[] = [
      { x: 0, y: 0, z: 300 },
      { x: 3000, y: 0, z: 2300 },
    ];
    const n: Vec2[] = [
      { x: 0, y: 1 },
      { x: 0, y: 1 },
    ];
    const m = meshRuled(a, b, 40, n);
    expect(checkManifold(m).ok).toBe(true);
    // Parallélogramme de base 3000 (horizontal) et hauteur 300 (verticale), épaisseur 40.
    expect(signedVolume(m)).toBeCloseTo(3000 * 300 * 40, 0);
  });

  it("propriété : limon hélicoïdal (jour circulaire) fermé, orienté, volume ≈ aire × e", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 200, max: 2000, noNaN: true }),
        fc.double({ min: 0.2, max: 1.9 * Math.PI, noNaN: true }), // < 1 tour : pas de recouvrement
        fc.integer({ min: 2, max: 80 }),
        fc.double({ min: 20, max: 80, noNaN: true }),
        fc.double({ min: 150, max: 400, noNaN: true }),
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        (R, sweep, n, e, h, climb, outward, reverse) => {
          // Pas angulaire ≤ 0,8 rad : au-delà, la facette plane n'approche plus l'arc (hors usage).
          fc.pre(sweep / (n - 1) <= 0.8);
          const a: Vec3[] = [];
          const b: Vec3[] = [];
          const normals: Vec2[] = [];
          for (let i = 0; i < n; i++) {
            const t = ((reverse ? -1 : 1) * (sweep * i)) / (n - 1);
            const z = (climb * i) / (n - 1);
            a.push({ x: R * Math.cos(t), y: R * Math.sin(t), z });
            b.push({ x: R * Math.cos(t), y: R * Math.sin(t), z: z + h });
            const s = outward ? 1 : -1;
            normals.push({ x: s * Math.cos(t), y: s * Math.sin(t) });
          }
          const m = meshRuled(a, b, e, normals);
          expect(checkManifold(m)).toMatchObject({ ok: true });
          // Volume ≈ aire de la couronne polygonale × h (prismes d'épaisseur e cisaillés
          // verticalement). Pas exact en rampe : les quadrilatères dessus / dessous, gauches, sont
          // triangulés selon des diagonales différentes ; l'écart par segment est borné par
          // 2 tétraèdres de volume |dz · sin(dθ)| · e² / 6.
          const dz = Math.abs(climb) / (n - 1);
          const twist = ((n - 1) * dz * Math.sin(sweep / (n - 1)) * e * e) / 3;
          const r1 = R,
            r2 = outward ? R + e : R - e;
          const segArea = 0.5 * Math.abs(r2 * r2 - r1 * r1) * Math.sin(sweep / (n - 1));
          expect(signedVolume(m)).toBeGreaterThan(0);
          expect(Math.abs(signedVolume(m) - segArea * (n - 1) * h)).toBeLessThan(
            1e-5 * segArea * (n - 1) * h + twist + 1,
          );
          expect(minNormalAgreement(m)).toBeGreaterThan(0.5);
        },
      ),
    );
  });

  it("entrées incohérentes : GeometryError", () => {
    const p = { x: 0, y: 0, z: 0 };
    expect(() => meshRuled([p], [p], 10, [{ x: 1, y: 0 }])).toThrow(GeometryError);
    expect(() =>
      meshRuled([p, p], [p], 10, [
        { x: 1, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toThrow(GeometryError);
    expect(() =>
      meshRuled([p, { x: 1, y: 0, z: 0 }], [p, p], 10, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toThrow(GeometryError);
  });
});

describe("meshRuled — dégénérescences (revue)", () => {
  const vertical = (pts: { x: number; y: number }[], z0: number, h: number) => ({
    a: pts.map((p) => ({ x: p.x, y: p.y, z: z0 })),
    b: pts.map((p) => ({ x: p.x, y: p.y, z: z0 + h })),
  });

  it("éventail autour d'un pivot (bord a immobile sur plusieurs rangées) : fermé, sans triangle dégénéré", () => {
    // a fixe au pivot (0, 0, 0), b décrit un quart de cercle en montant : limon « en éventail ».
    const n = 12;
    const a: Vec3[] = [];
    const b: Vec3[] = [];
    const normals: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const t = ((Math.PI / 2) * i) / (n - 1);
      a.push({ x: 0, y: 0, z: 0 });
      b.push({ x: 300 * Math.cos(t), y: 300 * Math.sin(t), z: 200 });
      normals.push({ x: -Math.sin(t), y: Math.cos(t) });
    }
    const m = meshRuled(a, b, 30, normals);
    expect(checkManifold(m)).toMatchObject({ ok: true, degenerateTriangles: 0 });
    expect(signedVolume(m)).toBeGreaterThan(0);
  });

  it("rangées répétées fusionnées : même maillage que sans répétition", () => {
    const { a, b } = vertical(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 500 },
      ],
      0,
      250,
    );
    const n: Vec2[] = [
      { x: 0, y: 1 },
      { x: -0.2, y: 1 },
      { x: -0.45, y: 0.9 },
    ];
    const ref = meshRuled(a, b, 40, n);
    const dup = meshRuled([a[0]!, ...a], [b[0]!, ...b], 40, [n[0]!, ...n]);
    expect(checkManifold(dup).ok).toBe(true);
    expect(dup.indices.length).toBe(ref.indices.length);
    expect(signedVolume(dup)).toBeCloseTo(signedVolume(ref), 3);
  });

  it("section plate (a = b, ou b − a selon la normale) : GeometryError", () => {
    const p = { x: 0, y: 0, z: 0 },
      q = { x: 1000, y: 0, z: 0 };
    const n: Vec2[] = [
      { x: 0, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(() => meshRuled([p, q], [p, { x: 1000, y: 0, z: 200 }], 40, n)).toThrow(GeometryError);
    // b − a horizontal et parallèle à la normale : parallélogramme d'aire nulle.
    expect(() =>
      meshRuled(
        [p, q],
        [
          { x: 0, y: 100, z: 0 },
          { x: 1000, y: 100, z: 0 },
        ],
        40,
        n,
      ),
    ).toThrow(GeometryError);
  });

  it("normales qui changent de côté, ou chemin qui rebrousse (solide replié) : GeometryError", () => {
    const { a, b } = vertical(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
      ],
      0,
      250,
    );
    const up: Vec2 = { x: 0, y: 1 };
    expect(() => meshRuled(a, b, 40, [up, up, up])).not.toThrow();
    // Épaississement basculé de l'autre côté au dernier point : faces qui se traversent.
    expect(() => meshRuled(a, b, 40, [up, up, { x: 0, y: -1 }])).toThrow(GeometryError);
    // Chemin qui revient en arrière : sections successives d'orientations opposées.
    const back = vertical(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 500, y: 0 },
      ],
      0,
      250,
    );
    expect(() => meshRuled(back.a, back.b, 40, [up, up, up])).toThrow(GeometryError);
  });

  it("angle de lissage invalide : GeometryError", () => {
    const { a, b } = vertical(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
      0,
      250,
    );
    expect(() =>
      meshRuled(
        a,
        b,
        40,
        [
          { x: 0, y: 1 },
          { x: 0, y: 1 },
        ],
        { creaseAngleDeg: 181 },
      ),
    ).toThrow(GeometryError);
  });

  it("épaisseur nulle : GeometryError (plus de maillage vide muet)", () => {
    const a: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1000, y: 0, z: 500 },
    ];
    const b: Vec3[] = a.map((p) => ({ ...p, z: p.z + 300 }));
    const n: Vec2[] = [
      { x: 0, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(() => meshRuled(a, b, 0, n)).toThrow(/épaisseur nulle/);
  });
});
