import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bbox, checkManifold, signedVolume } from "./analysis.js";
import { meshExtrusion } from "./extrude.js";
import { shapeArea } from "./polygon.js";
import { GeometryError } from "./errors.js";
import {
  NORMAL_CHECK_MIN_HEIGHT,
  frame3,
  identityFrame,
  minNormalAgreement,
  rect,
  shapeWithHoles,
} from "./testing.js";

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

  it("profondeur nulle : GeometryError (pièce plate signalée, plus de maillage vide muet)", () => {
    expect(() => meshExtrusion(identityFrame, { outer: rect(0, 0, 1, 1), holes: [] }, 0)).toThrow(
      GeometryError,
    );
    expect(() =>
      meshExtrusion(identityFrame, { outer: rect(0, 0, 1, 1), holes: [] }, 1e-10),
    ).toThrow(/profondeur nulle/);
  });

  it("contour rond (poteau Ø 60 à 32 côtés) lissé à 30° ; rectangle et octogone gardent leurs arêtes vives", () => {
    const circle = Array.from({ length: 32 }, (_, i) => ({
      x: 30 * Math.cos((2 * Math.PI * i) / 32),
      y: 30 * Math.sin((2 * Math.PI * i) / 32),
    }));
    const round = meshExtrusion(identityFrame, { outer: circle, holes: [] }, 1000);
    // Faces latérales : 2 × 32 sommets partagés (lissés) au lieu de 2 × 2 × 32 (arêtes vives).
    const capVertices = 2 * 32;
    expect(round.positions.length / 3 - capVertices).toBe(2 * 32);
    // Normales latérales (premiers sommets) radiales, lissées : direction = position.
    expect(Math.hypot(round.normals[0]!, round.normals[1]!)).toBeCloseTo(1, 6);
    expect(round.normals[0]!).toBeCloseTo(1, 6);
    const box = meshExtrusion(identityFrame, { outer: rect(0, 0, 60, 60), holes: [] }, 1000);
    expect(box.positions.length / 3).toBe(24);
    const octagon = Array.from({ length: 8 }, (_, i) => ({
      x: 30 * Math.cos((2 * Math.PI * i) / 8),
      y: 30 * Math.sin((2 * Math.PI * i) / 8),
    }));
    // Octogone : virages de 45° > 30°, arêtes vives.
    const oct = meshExtrusion(identityFrame, { outer: octagon, holes: [] }, 1000);
    expect(oct.positions.length / 3).toBe(2 * 8 + 2 * 2 * 8);
    // Angle explicite : prioritaire (0 → facettes même sur un contour rond).
    const flat = meshExtrusion(identityFrame, { outer: circle, holes: [] }, 1000, {
      creaseAngleDeg: 0,
    });
    expect(flat.positions.length / 3).toBe(capVertices + 4 * 32);
  });

  it("repère local : positions relatives à l'origine, précises au 1e-3 mm à 5 m (float32 monde : ≈ 0,25 mm)", () => {
    const far = { ...identityFrame, origin: { x: 5000.123456, y: -4999.987654, z: 3000.4321 } };
    const shape = { outer: rect(0.3, 0.2, 0.6, 0.4), holes: [] };
    const local = meshExtrusion(far, shape, 0.7, { localOrigin: true });
    const world = meshExtrusion(far, shape, 0.7);
    expect(local.origin).toBeDefined();
    expect(world.origin).toBeUndefined();
    const o = local.origin!;
    // Sommet exact attendu : coin (0, 0) du rectangle, bas.
    let bestLocal = Infinity;
    let bestWorld = Infinity;
    for (let i = 0; i < local.positions.length; i += 3) {
      const d = Math.hypot(
        o.x + local.positions[i]! - 5000.123456,
        o.y + local.positions[i + 1]! + 4999.987654,
        o.z + local.positions[i + 2]! - 3000.4321,
      );
      bestLocal = Math.min(bestLocal, d);
      const dw = Math.hypot(
        world.positions[i]! - 5000.123456,
        world.positions[i + 1]! + 4999.987654,
        world.positions[i + 2]! - 3000.4321,
      );
      bestWorld = Math.min(bestWorld, dw);
    }
    expect(bestLocal).toBeLessThan(1e-6);
    expect(bestWorld).toBeGreaterThan(1e-5);
    // Volume identique (invariant par translation), boîte ramenée au monde.
    expect(signedVolume(local)).toBeCloseTo(signedVolume(world), 3);
    const b = bbox(local)!;
    expect(b.min.x).toBeCloseTo(5000.123456, 6);
    expect(b.max.z).toBeCloseTo(3000.4321 + 0.7, 6);
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

  it("angle de lissage : un cylindre à 64 facettes a des normales latérales lissées (défaut depuis D3 : contour rond)", () => {
    const n = 64;
    const circle = Array.from({ length: n }, (_, i) => ({
      x: 50 * Math.cos((2 * Math.PI * i) / n),
      y: 50 * Math.sin((2 * Math.PI * i) / n),
    }));
    const flat = meshExtrusion(identityFrame, { outer: circle, holes: [] }, 100, {
      creaseAngleDeg: 0,
    });
    expect(
      meshExtrusion(identityFrame, { outer: circle, holes: [] }, 100).positions.length / 3,
    ).toBe(2 * n + 2 * n);
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

describe("meshExtrusion — languette earcut quasi dégénérée (régression de test instable)", () => {
  it(`normales justes hors triangles de hauteur < ${NORMAL_CHECK_MIN_HEIGHT} mm`, () => {
    // Contre-exemple de la propriété ci-dessus (≈ 1 tirage sur 50 000) : earcut produit un
    // triangle de côtés 114,6 / 39,9 / 154,55 mm (hauteur ≈ 1,6 µm) ; en float32 à ≈ 3 000 mm,
    // sa normale recalculée s'écarte de 3° de la normale (juste) du couvercle.
    const shape = {
      outer: [
        { x: 396.87577797935387, y: 15.593291785560952 },
        { x: 317.3675722628686, y: 146.30845480765063 },
        { x: 109.28548570127496, y: 118.22437237020306 },
        { x: 110.07295604395802, y: 298.36580303725566 },
        { x: -3.9414547745053343, y: 100.31672282633309 },
        { x: -43.370767053455225, y: 94.07846638138197 },
        { x: -175.35892003374775, y: 162.10011830664843 },
        { x: -169.35224291903918, y: 62.47734090506842 },
        { x: -180.67920090679576, y: -7.098905137688184 },
        { x: -214.62819890060354, y: -98.94495494734052 },
        { x: -83.63065513062143, y: -90.47113301717494 },
        { x: -58.821459670494505, y: -159.44254321108485 },
        { x: 15.298220242569686, y: -389.36570571272244 },
        { x: 103.09738887795977, y: -223.6355243984714 },
        { x: 78.3908174094977, y: -72.4637262466543 },
        { x: 192.9186669446689, y: -71.17145373395223 },
      ],
      holes: [
        [
          { x: 11.83815229764038, y: 32.40513885904259 },
          { x: 38.16184770235962, y: 32.40513885904259 },
          { x: 38.16184770235962, y: 17.59486114095741 },
          { x: 11.83815229764038, y: 17.59486114095741 },
        ],
        [
          { x: -27.59086047444272, y: 34.87677622828902 },
          { x: -22.40913952555728, y: 34.87677622828902 },
          { x: -22.40913952555728, y: 15.123223771710983 },
          { x: -27.59086047444272, y: 15.123223771710983 },
        ],
        [
          { x: 19.928355923531285, y: -30.30578541724247 },
          { x: 30.071644076468715, y: -30.30578541724247 },
          { x: 30.071644076468715, y: -19.69421458275753 },
          { x: 19.928355923531285, y: -19.69421458275753 },
        ],
        [
          { x: -40.348471792991425, y: -18.159810808589196 },
          { x: -9.651528207008576, y: -18.159810808589196 },
          { x: -9.651528207008576, y: -31.840189191410804 },
          { x: -40.348471792991425, y: -31.840189191410804 },
        ],
      ],
    };
    const frame = {
      origin: { x: 1.7605688173030769e-273, y: -3.019104685763161e-121, z: 3.715343715783646e-36 },
      xAxis: { x: 0.9719962102044728, y: 6.332970539213938e-144, z: -0.2349965262469691 },
      yAxis: { x: 6.332970539213938e-144, y: -0.9999999999999998, z: -7.546799886523913e-145 },
      zAxis: { x: 0.2349965262469691, y: 7.546799886523913e-145, z: 0.9719962102044726 },
    };
    const m = meshExtrusion(frame, shape, -2818.517022758687);
    expect(checkManifold(m).ok).toBe(true);
    expect(minNormalAgreement(m)).toBeGreaterThan(0.999);
  });
});
