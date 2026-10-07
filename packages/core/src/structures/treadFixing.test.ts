import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pointInPolygon, signedArea } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { Part } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import type { ResolvedBend } from "../workshop/metal.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import { developFoldedTread, foldedFlatTransform, type FoldedTreadResult } from "./folded.js";
import { QUANTITY_MASS_KG, QUANTITY_VOLUME_M3 } from "./quantities.js";
import { verticalExtrusion } from "./housing.js";
import {
  QUANTITY_HOLES,
  QUANTITY_LASER_CUT_MM,
  QUANTITY_TREATED_SURFACE_M2,
  plateMeasures,
  steelQuantities,
} from "./steelCommon.js";
import {
  DEFAULT_TREAD_HOLE_DIAMETER,
  TreadFixingSchema,
  TreadHoleDiameterSchema,
  drillFoldedTread,
  treadSupportJoint,
} from "./treadFixing.js";

const profile = resolveWorkshopProfile(undefined);
const bend: ResolvedBend = {
  thickness: 5,
  innerRadius: 6.5,
  k: 0.33,
  minFlange: 0,
  method: "kFactor",
};

/** Marche Z (dessus W × D, nez sur y = 0) ou U balancée (arrière incliné). */
function tread(kind: "Z" | "U-skew"): { part: Part; result: FoldedTreadResult } {
  const W = 800;
  const D = 250;
  const plate: Vec2[] =
    kind === "Z"
      ? [V.vec(0, 0), V.vec(W, 0), V.vec(W, D), V.vec(0, D)]
      : [V.vec(0, 0), V.vec(W, 0), V.vec(W, D + 150), V.vec(0, D)];
  const rear =
    kind === "Z"
      ? { p: V.vec(0, D), dir: V.vec(1, 0) }
      : { p: V.vec(0, D), dir: V.normalize(V.vec(W, 150)) };
  const result = developFoldedTread({
    profile: kind === "Z" ? "Z" : "U",
    plate,
    front: { p: V.vec(0, 0), dir: V.vec(1, 0) },
    rear,
    bend,
    riserDrop: 180,
    returnLength: 40,
    noseHeight: 40,
    rearHeight: 40,
    mark: "M1",
  });
  const meas = plateMeasures(result.flat.outline, bend.thickness);
  const part: Part = {
    id: "tread-1",
    mark: "M1",
    category: "tread",
    name: { key: "part.wallHandrail.name" },
    material: "steel-painted",
    solid: verticalExtrusion(plate, 1000 - bend.thickness, bend.thickness),
    flat: result.flat,
    quantities: steelQuantities(
      {
        volumeMm3: meas.volumeMm3,
        treatedSurfaceMm2: meas.treatedSurfaceMm2,
        length: W,
        cuts: 1,
        laserCut: meas.laserCut,
        bends: 2,
      },
      profile,
    ),
  };
  return { part, result };
}

describe("paramètres A31", () => {
  it("vissée par défaut, perçage de 9 mm (M8 + 1 mm de jeu), à valider", () => {
    expect(TreadFixingSchema.parse(undefined)).toBe("screwed");
    expect(TreadFixingSchema.parse("welded")).toBe("welded");
    expect(() => TreadFixingSchema.parse("glued")).toThrow();
    expect(TreadHoleDiameterSchema.parse(undefined)).toBe(DEFAULT_TREAD_HOLE_DIAMETER);
    expect(DEFAULT_TREAD_HOLE_DIAMETER).toBe(9);
  });
});

describe("treadSupportJoint", () => {
  const spec = { fixing: "screwed", screws: 2, holeDiameter: 9 } as const;

  it("marche bois : vis à bois, perçages non dimensionnés, aucun cordon (fixation sans effet)", () => {
    for (const fixing of ["screwed", "welded"] as const) {
      expect(treadSupportJoint({ ...spec, fixing }, "wood", 300)).toEqual({
        fixings: [{ joint: "treadScrewed", points: 2 }],
        holes: 2,
        weld: 0,
      });
    }
  });

  it("marche en tôle vissée : vis à métaux au diamètre de perçage, aucun cordon", () => {
    expect(treadSupportJoint(spec, "steel", 300)).toEqual({
      fixings: [{ joint: "treadBolted", points: 2, holeDiameter: 9 }],
      holes: 2,
      weld: 0,
    });
  });

  it("marche en tôle soudée : ni perçage ni fixation, cordon = longueur d'appui", () => {
    expect(treadSupportJoint({ ...spec, fixing: "welded" }, "steel", 312.5)).toEqual({
      fixings: [],
      holes: 0,
      weld: 312.5,
    });
  });

  it("aucune vis ou valeurs dégénérées : rien, sans lever", () => {
    expect(treadSupportJoint({ ...spec, screws: 0 }, "steel", 300)).toEqual({
      fixings: [],
      holes: 0,
      weld: 0,
    });
    expect(treadSupportJoint({ ...spec, screws: Number.NaN }, "wood", 300).holes).toBe(0);
    expect(treadSupportJoint({ ...spec, fixing: "welded" }, "steel", Number.NaN).weld).toBe(0);
    expect(treadSupportJoint({ ...spec, screws: 2.7 }, "steel", 300).holes).toBe(2);
  });
});

describe("drillFoldedTread", () => {
  it("perce le développé aux points du dessus (même place que dans le plan)", () => {
    const { part, result } = tread("Z");
    const pts = [V.vec(100, 120), V.vec(700, 120)];
    const out = drillFoldedTread(part, result, pts, 9);
    const holes = out.flat!.outline.holes;
    expect(holes).toHaveLength(2);
    const T = foldedFlatTransform(result);
    holes.forEach((h, i) => {
      expect(signedArea(h)).toBeLessThan(0);
      for (const p of h) expect(pointInPolygon(p, out.flat!.outline.outer)).toBe("inside");
      const c = h.reduce((s, p) => V.add(s, p), V.ZERO);
      expect(V.distance(V.scale(c, 1 / h.length), T(pts[i]!))).toBeLessThan(1e-9);
    });
    expect(out.quantities[QUANTITY_HOLES]).toBe(2);
    // Découpe laser : périmètres des trous ajoutés ; masse proportionnelle au volume.
    expect(
      out.quantities[QUANTITY_LASER_CUT_MM]! - part.quantities[QUANTITY_LASER_CUT_MM]!,
    ).toBeCloseTo(2 * Math.PI * 9, 0);
    expect(out.quantities[QUANTITY_VOLUME_M3]!).toBeLessThan(part.quantities[QUANTITY_VOLUME_M3]!);
    expect(out.quantities[QUANTITY_MASS_KG]! / out.quantities[QUANTITY_VOLUME_M3]!).toBeCloseTo(
      part.quantities[QUANTITY_MASS_KG]! / part.quantities[QUANTITY_VOLUME_M3]!,
      9,
    );
    // Surface à traiter : − 2 × aire des trous + chants des trous (périmètre × t).
    expect(
      (out.quantities[QUANTITY_TREATED_SURFACE_M2]! -
        part.quantities[QUANTITY_TREATED_SURFACE_M2]!) *
        1e6,
    ).toBeCloseTo(2 * (Math.PI * 9 * 5 - 2 * Math.PI * 4.5 * 4.5), -1);
    // Solide extrudé du dessus : mêmes trous, dans le repère du solide.
    expect(out.solid.kind === "extrusion" && out.solid.profile.holes.length).toBe(2);
    // Pièce d'entrée inchangée (immuable).
    expect(part.flat!.outline.holes).toEqual([]);
  });

  it("ignore les points hors du dessus, trop près d'un pli ou d'un bord, ou d'un autre perçage", () => {
    const { part, result } = tread("Z");
    const out = drillFoldedTread(
      part,
      result,
      [
        V.vec(400, -30), // sous l'aile de nez (hors du dessus)
        V.vec(400, 15), // dans le dessus, à moins d'un diamètre de la ligne de tangence
        V.vec(4, 120), // bord latéral
        V.vec(400, 120),
        V.vec(404, 120), // chevauche le précédent
        V.vec(Number.NaN, 0),
      ],
      9,
    );
    expect(out.flat!.outline.holes).toHaveLength(1);
    expect(out.quantities[QUANTITY_HOLES]).toBe(1);
  });

  it("aucun point retenu, sans développé ou diamètre nul : pièce rendue telle quelle", () => {
    const { part, result } = tread("Z");
    expect(drillFoldedTread(part, result, [], 9)).toBe(part);
    expect(drillFoldedTread(part, result, [V.vec(400, 120)], 0)).toBe(part);
    const { flat: _flat, ...noFlat } = part;
    void _flat;
    expect(drillFoldedTread(noFlat, result, [V.vec(400, 120)], 9)).toBe(noFlat);
  });

  it("propriété : trous dans le contour développé, hors des zones de pli, quantité = trous dessinés", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"Z" | "U-skew">("Z", "U-skew"),
        fc.array(
          fc.record({
            x: fc.double({ min: -50, max: 850, noNaN: true }),
            y: fc.double({ min: -60, max: 450, noNaN: true }),
          }),
          { maxLength: 8 },
        ),
        fc.integer({ min: 5, max: 14 }),
        (kind, raw, d) => {
          const { part, result } = tread(kind);
          const out = drillFoldedTread(
            part,
            result,
            raw.map((p) => V.vec(p.x, p.y)),
            d,
          );
          const holes = out.flat!.outline.holes;
          expect(out.quantities[QUANTITY_HOLES]).toBe(holes.length);
          expect(holes.length).toBeLessThanOrEqual(raw.length);
          const T = foldedFlatTransform(result);
          const topFlat = result.top.map(T);
          const bends = out.flat!.lines.filter((l) => l.kind === "bend");
          for (const h of holes) {
            for (const p of h) {
              expect(pointInPolygon(p, out.flat!.outline.outer)).toBe("inside");
              // Dans la partie plane du dessus : aucun point de trou dans une zone de pli.
              expect(pointInPolygon(p, topFlat, 1e-6)).not.toBe("outside");
            }
            for (const l of bends) {
              const c = h.reduce((s, p) => V.add(s, p), V.ZERO);
              const center = V.scale(c, 1 / h.length);
              const dir = V.normalize(V.sub(l.b, l.a));
              expect(Math.abs(V.cross(dir, V.sub(center, l.a)))).toBeGreaterThan(d);
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
