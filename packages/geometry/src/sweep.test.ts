import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Vec3 } from "@blondel/core";
import { bbox, checkManifold, signedVolume } from "./analysis.js";
import { GeometryError } from "./errors.js";
import { shapeArea } from "./polygon.js";
import { meshSweep, parallelTransportFrames, polylineLength, uprightFrames } from "./sweep.js";
import { minNormalAgreement, rect, rel } from "./testing.js";
import { cross, dot, length, normalize, sub } from "./vec3.js";

const disc = (r: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    x: r * Math.cos((2 * Math.PI * i) / n),
    y: r * Math.sin((2 * Math.PI * i) / n),
  }));

const unit = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 0.2)
  .map(([x, y, z]) => normalize({ x, y, z }));

/**
 * Polyligne à virages ≤ 60°, segments de 300 à 2000 mm : avec une section de rayon ≤ 40 mm,
 * pas d'auto-intersection des coupes d'onglet.
 */
const gentlePath = fc
  .tuple(
    unit,
    fc.array(fc.tuple(unit, fc.double({ min: 300, max: 2000, noNaN: true })), {
      minLength: 1,
      maxLength: 12,
    }),
  )
  .map(([d0, steps]) => {
    const pts: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    let d = d0;
    for (const [perturb, len] of steps) {
      // Nouvelle direction : d + 0,5 · perturbation (angle ≤ 30° environ), renormalisée.
      d = normalize({
        x: d.x + 0.5 * perturb.x,
        y: d.y + 0.5 * perturb.y,
        z: d.z + 0.5 * perturb.z,
      });
      const p = pts[pts.length - 1]!;
      pts.push({ x: p.x + len * d.x, y: p.y + len * d.y, z: p.z + len * d.z });
    }
    return pts;
  });

describe("parallelTransportFrames", () => {
  it("chemin plan horizontal : la binormale reste verticale (aucune torsion)", () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 1000, y: 0, z: 0 },
      { x: 1500, y: 700, z: 0 },
      { x: 1200, y: 1500, z: 0 },
    ];
    for (const f of parallelTransportFrames(path)) {
      expect(f.binormal.z).toBeCloseTo(1, 12);
    }
  });

  it("propriété : repères orthonormés directs, binormale sans rotation autour de la tangente", () => {
    fc.assert(
      fc.property(gentlePath, (path) => {
        const frames = parallelTransportFrames(path);
        frames.forEach((f, k) => {
          expect(length(f.normal)).toBeCloseTo(1, 9);
          expect(length(f.binormal)).toBeCloseTo(1, 9);
          expect(dot(f.normal, f.binormal)).toBeCloseTo(0, 9);
          expect(dot(f.normal, f.tangent)).toBeCloseTo(0, 9);
          expect(dot(f.binormal, f.tangent)).toBeCloseTo(0, 9);
          if (k > 0) {
            // Transport parallèle : la composante de N selon l'axe de rotation k = T0 × T1 est conservée.
            const prev = frames[k - 1]!;
            const axis = {
              x: prev.tangent.y * f.tangent.z - prev.tangent.z * f.tangent.y,
              y: prev.tangent.z * f.tangent.x - prev.tangent.x * f.tangent.z,
              z: prev.tangent.x * f.tangent.y - prev.tangent.y * f.tangent.x,
            };
            expect(dot(prev.normal, axis)).toBeCloseTo(dot(f.normal, axis), 9);
          }
        });
      }),
    );
  });

  it("demi-tour : GeometryError", () => {
    expect(() =>
      parallelTransportFrames([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ]),
    ).toThrow(GeometryError);
  });
});

describe("meshSweep", () => {
  it("balayage droit d'un rectangle : pavé", () => {
    const m = meshSweep(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1000, y: 0, z: 0 },
      ],
      { outer: rect(0, 0, 40, 60), holes: [] },
    );
    expect(signedVolume(m)).toBeCloseTo(40 * 60 * 1000, 2);
    expect(checkManifold(m).ok).toBe(true);
    // Section « debout » : v = +Z, donc 60 mm en hauteur, 40 mm en largeur (u = −Y pour T = +X).
    const b = bbox(m)!;
    expect(b.max.z - b.min.z).toBeCloseTo(60, 4);
    expect(b.max.y - b.min.y).toBeCloseTo(40, 4);
  });

  it("propriété : balayage droit, volume = aire × longueur (tube avec trou)", () => {
    fc.assert(
      fc.property(
        unit,
        fc.double({ min: 10, max: 5000, noNaN: true }),
        fc.integer({ min: 3, max: 40 }),
        (d, len, n) => {
          const path = [
            { x: 10, y: -20, z: 30 },
            { x: 10 + len * d.x, y: -20 + len * d.y, z: 30 + len * d.z },
          ];
          const section = { outer: disc(25, n), holes: [disc(20, n).reverse()] };
          const m = meshSweep(path, section);
          expect(checkManifold(m).ok).toBe(true);
          expect(rel(signedVolume(m), shapeArea(section) * len)).toBeLessThan(1e-4);
        },
      ),
    );
  });

  it("propriété : polyligne quelconque, section centrée → fermé, orienté, volume = aire × longueur (transport parallèle)", () => {
    fc.assert(
      fc.property(gentlePath, fc.integer({ min: 3, max: 32 }), (path, n) => {
        const section = { outer: disc(40, n), holes: [] };
        const m = meshSweep(path, section, { sweepFrame: "parallel" });
        expect(checkManifold(m)).toMatchObject({ ok: true });
        expect(rel(signedVolume(m), shapeArea(section) * polylineLength(path))).toBeLessThan(1e-4);
        expect(minNormalAgreement(m)).toBeGreaterThan(0.5);
      }),
    );
  });

  it("points confondus ignorés ; moins de 2 points distincts : GeometryError", () => {
    const p = { x: 0, y: 0, z: 0 };
    expect(() => meshSweep([p, p], { outer: rect(0, 0, 1, 1), holes: [] })).toThrow(GeometryError);
    const m = meshSweep([p, p, { x: 0, y: 0, z: 100 }], { outer: rect(0, 0, 10, 10), holes: [] });
    expect(signedVolume(m)).toBeCloseTo(10000, 3);
    expect(
      length(
        sub({ x: 0, y: 0, z: 1 }, parallelTransportFrames([p, { x: 0, y: 0, z: 100 }])[0]!.tangent),
      ),
    ).toBe(0);
  });
});

/** Hélice (limon / main courante d'un escalier hélicoïdal) échantillonnée en `n` segments. */
const helix = (R: number, turns: number, climbPerTurn: number, n: number): Vec3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (2 * Math.PI * turns * i) / n;
    return { x: R * Math.cos(t), y: R * Math.sin(t), z: (climbPerTurn * turns * i) / n };
  });

describe("repère de section sur une hélice (main courante d'escalier hélicoïdal)", () => {
  it("transport parallèle : la section tourne autour de la tangente et finit retournée (défaut documenté)", () => {
    const frames = parallelTransportFrames(helix(600, 1, 3000, 200));
    expect(Math.min(...frames.map((f) => f.binormal.z))).toBeLessThan(0);
  });

  it("propriété : repère d'aplomb (défaut) — binormale dans le plan vertical de la tangente, vers le haut", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 300, max: 2000, noNaN: true }),
        fc.double({ min: 0.25, max: 2, noNaN: true }),
        fc.double({ min: -4000, max: 4000, noNaN: true }),
        (R, turns, climb) => {
          for (const f of uprightFrames(helix(R, turns, climb, 64))) {
            const h = normalize({ x: -f.tangent.y, y: f.tangent.x, z: 0 });
            expect(dot(f.binormal, h)).toBeCloseTo(0, 9);
            expect(f.binormal.z).toBeGreaterThan(0);
            expect(length(f.binormal)).toBeCloseTo(1, 9);
            expect(dot(f.binormal, f.tangent)).toBeCloseTo(0, 9);
            expect(length(cross(f.normal, f.binormal))).toBeCloseTo(1, 9);
            expect(dot(cross(f.normal, f.binormal), f.tangent)).toBeCloseTo(1, 9);
          }
        },
      ),
    );
  });

  it("propriété : balayage d'aplomb d'une section rectangulaire sur une hélice → fermé, volume ≈ aire × longueur", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 400, max: 2000, noNaN: true }),
        fc.double({ min: 0.25, max: 1.5, noNaN: true }),
        fc.double({ min: -4000, max: 4000, noNaN: true }),
        (R, turns, climb) => {
          // Au-delà d'un tour, les spires ne doivent pas se toucher (section de 40 mm de haut).
          fc.pre(turns < 0.95 || Math.abs(climb) > 100);
          const n = Math.ceil(48 * turns);
          const path = helix(R, turns, climb, n);
          const section = { outer: rect(0, 0, 60, 40), holes: [] };
          const m = meshSweep(path, section);
          expect(checkManifold(m)).toMatchObject({ ok: true });
          // Les faces d'une main courante d'aplomb sur une hélice sont gauches (hélicoïdes) :
          // chaque quadrilatère, tourné de ψ = 2π·sin(pente)·tours / n autour de la tangente, est
          // coupé selon une diagonale → volume par défaut, écart relatif ≈ 0,4·ψ (mesuré), borné
          // ici par 0,5·ψ. Le transport parallèle, lui, donne des faces planes et un volume exact.
          const L = polylineLength(path);
          const psi = (2 * Math.PI * turns * ((Math.abs(climb) * turns) / L)) / n;
          // Plancher de 1e-5 comme en transport parallèle : à pente nulle (ψ = 0), l'arrondi
          // flottant atteint 1,04e-6 (R ≈ 1 396, un quart de tour).
          expect(rel(signedVolume(m), shapeArea(section) * L)).toBeLessThan(0.5 * psi + 1e-5);
          expect(
            rel(
              signedVolume(meshSweep(path, section, { sweepFrame: "parallel" })),
              shapeArea(section) * L,
            ),
          ).toBeLessThan(1e-5);
          expect(minNormalAgreement(m)).toBeGreaterThan(0.5);
        },
      ),
    );
  });

  it("propriété : chemin quelconque en mode d'aplomb → fermé et orienté", () => {
    fc.assert(
      fc.property(gentlePath, fc.integer({ min: 3, max: 16 }), (path, n) => {
        const m = meshSweep(path, { outer: disc(40, n), holes: [] });
        expect(checkManifold(m)).toMatchObject({ ok: true });
        expect(signedVolume(m)).toBeGreaterThan(0);
      }),
    );
  });

  it("virage horizontal à 90° (main courante de palier) : exact et identique dans les deux modes", () => {
    const path = [
      { x: 0, y: 0, z: 900 },
      { x: 1000, y: 0, z: 900 },
      { x: 1000, y: 800, z: 900 },
    ];
    const section = { outer: rect(0, 0, 50, 70), holes: [] };
    for (const sweepFrame of ["upright", "parallel"] as const) {
      const m = meshSweep(path, section, { sweepFrame });
      expect(checkManifold(m).ok).toBe(true);
      expect(signedVolume(m)).toBeCloseTo(50 * 70 * 1800, 1);
      const b = bbox(m)!;
      expect(b.max.z - b.min.z).toBeCloseTo(70, 3);
    }
  });

  it("options invalides : GeometryError", () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ];
    const section = { outer: rect(0, 0, 10, 10), holes: [] };
    expect(() => meshSweep(path, section, { creaseAngleDeg: -5 })).toThrow(GeometryError);
    expect(() => meshSweep(path, section, { creaseAngleDeg: Number.NaN })).toThrow(GeometryError);
    expect(() => meshSweep(path, section, { sweepFrame: "frenet" as never })).toThrow(
      GeometryError,
    );
    expect(() => meshSweep(path, section, { maxPathPoints: 1 })).toThrow(GeometryError);
  });

  it("repère local : même maillage translaté, origine au centre de la boîte", () => {
    const path = [
      { x: 4000, y: 5000, z: 3000 },
      { x: 4800, y: 5000, z: 3400 },
      { x: 4800, y: 5900, z: 3800 },
    ];
    const section = { outer: disc(20, 16), holes: [] };
    const w = meshSweep(path, section);
    const l = meshSweep(path, section, { localOrigin: true });
    expect(l.origin).toBeDefined();
    expect(l.indices).toEqual(w.indices);
    expect(bbox(l)!.min.x).toBeCloseTo(bbox(w)!.min.x, 2);
    expect(Math.abs(signedVolume(l) / signedVolume(w) - 1)).toBeLessThan(1e-4);
    for (let i = 0; i < w.positions.length; i++) {
      const o = [l.origin!.x, l.origin!.y, l.origin!.z][i % 3]!;
      expect(Math.abs(l.positions[i]! + o - w.positions[i]!)).toBeLessThan(1e-3);
    }
  });
});
