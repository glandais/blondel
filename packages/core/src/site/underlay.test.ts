import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as V from "../geom2d/vec.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { serializeProject } from "../project/serialize.js";
import {
  withDxfUnderlay,
  withImageUnderlay,
  withOpeningPolygon,
  withUnderlayOpacity,
  withWall,
  withoutWall,
} from "./edit.js";
import {
  DxfUnderlaySchema,
  UNDERLAY_MAX_ENTITIES,
  UNDERLAY_MAX_VERTICES,
  type DxfUnderlay,
  type ImageUnderlay,
} from "./schema.js";
import {
  bulgeSegment,
  calibrateImage,
  CalibrationError,
  imageCorners,
  imagePixelToSite,
  placementCentering,
  placePoint,
  siteToImagePixel,
  underlaySegments,
  unplacePoint,
  segmentsBounds,
} from "./underlay.js";

/** PNG de 1 × 1 pixel. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const image = (o: Partial<ImageUnderlay> = {}): ImageUnderlay => ({
  name: "plan.png",
  dataUrl: PNG,
  widthPx: 800,
  heightPx: 600,
  mmPerPx: 10,
  placement: { origin: { x: -1000, y: 5000 }, rotation: 0 },
  ...o,
});

const dxf: DxfUnderlay = {
  name: "plan.dxf",
  unitScale: 1000,
  placement: { origin: { x: 100, y: 200 }, rotation: 90 },
  entities: [
    { kind: "line", layer: "MURS", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } },
    { kind: "circle", center: { x: 0, y: 0 }, radius: 100 },
  ],
};

describe("calque de fond — géométrie", () => {
  it("renflement 1 : demi-cercle trigonométrique ; −1 : horaire", () => {
    const s = bulgeSegment({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    expect(s.kind).toBe("arc");
    if (s.kind === "arc") {
      expect(s.center.x).toBeCloseTo(1, 12);
      expect(s.center.y).toBeCloseTo(0, 12);
      expect(s.sweep).toBeCloseTo(Math.PI, 12);
      // Un demi-cercle trigonométrique de (0,0) à (2,0) passe par (1, −1).
      expect(segmentsBounds([s])!.min.y).toBeCloseTo(-1, 12);
    }
    const t = bulgeSegment({ x: 0, y: 0 }, { x: 2, y: 0 }, -1);
    if (t.kind === "arc") expect(segmentsBounds([t])!.max.y).toBeCloseTo(1, 12);
  });

  it("placement : rotation puis translation, inverse exacte", () => {
    const segs = underlaySegments(dxf);
    const l = segs[0]!;
    expect(l.kind).toBe("line");
    if (l.kind === "line") {
      expect(l.b.x).toBeCloseTo(100, 9);
      expect(l.b.y).toBeCloseTo(1200, 9);
    }
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -360, max: 360, noNaN: true }),
        (x, y, rot) => {
          const pl = { origin: { x: 12, y: -7 }, rotation: rot };
          const back = unplacePoint(pl, placePoint(pl, { x, y }));
          expect(V.distance(back, { x, y })).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("recentrage : le centre du plan (coordonnées Lambert) tombe sur l'escalier", () => {
    const pl = placementCentering({ x: 6.5e8, y: 6.8e9 }, { x: 450, y: 1500 }, 30);
    const p = placePoint(pl, { x: 6.5e8, y: 6.8e9 });
    expect(p.x).toBeCloseTo(450, 3);
    expect(p.y).toBeCloseTo(1500, 3);
  });
});

describe("image calibrée — deux points et une distance", () => {
  it("pixel ↔ site : inverse exacte ; coin haut gauche au point d'origine, y vers le bas", () => {
    const img = image({ placement: { origin: { x: 10, y: 20 }, rotation: 25 } });
    expect(imageCorners(img)[0]).toEqual({ x: 10, y: 20 });
    const p = imagePixelToSite(img, { x: 123.5, y: 77 });
    const q = siteToImagePixel(img, p);
    expect(q.x).toBeCloseTo(123.5, 9);
    expect(q.y).toBeCloseTo(77, 9);
    const straight = image();
    expect(imagePixelToSite(straight, { x: 0, y: 100 }).y).toBe(5000 - 1000);
  });

  it("propriété : après calibration, |ab| dans le site = distance et a ne bouge pas", () => {
    const px = fc.record({
      x: fc.double({ min: 0, max: 4000, noNaN: true }),
      y: fc.double({ min: 0, max: 4000, noNaN: true }),
    });
    fc.assert(
      fc.property(
        px,
        px,
        fc.double({ min: 10, max: 50_000, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (a, b, d, rot) => {
          fc.pre(V.distance(a, b) >= 1);
          const img = image({ placement: { origin: { x: 300, y: -40 }, rotation: rot } });
          const before = imagePixelToSite(img, a);
          const c = calibrateImage(img, a, b, d);
          const pa = imagePixelToSite(c, a);
          const pb = imagePixelToSite(c, b);
          expect(V.distance(pa, pb)).toBeCloseTo(d, 6);
          expect(V.distance(pa, before)).toBeLessThan(1e-6);
          expect(c.calibration).toEqual({ a, b, distance: d });
        },
      ),
    );
  });

  it("ancre : le premier point est amené sur le point du site donné", () => {
    const c = calibrateImage(image(), { x: 0, y: 0 }, { x: 100, y: 0 }, 5000, { x: 7, y: 8 });
    expect(c.mmPerPx).toBe(50);
    expect(imagePixelToSite(c, { x: 0, y: 0 })).toEqual({ x: 7, y: 8 });
  });

  it("points confondus ou distance nulle : CalibrationError", () => {
    expect(() => calibrateImage(image(), { x: 1, y: 1 }, { x: 1.5, y: 1 }, 100)).toThrow(
      CalibrationError,
    );
    expect(() => calibrateImage(image(), { x: 1, y: 1 }, { x: 100, y: 1 }, 0)).toThrow(
      CalibrationError,
    );
  });
});

describe("site.underlay dans le projet (ajout rétrocompatible)", () => {
  const base = createProject("straight");

  it("un projet sans calque est sérialisé à l'identique (pas de champ ajouté)", () => {
    expect(base.site.underlay).toBeUndefined();
    expect(serializeProject(ProjectSchema.parse(JSON.parse(serializeProject(base))))).toBe(
      serializeProject(base),
    );
  });

  it("calque DXF + image : relu et resérialisé à l'identique", () => {
    let p: Project = withDxfUnderlay(base, dxf);
    p = withImageUnderlay(p, image());
    p = withUnderlayOpacity(p, 0.4);
    const parsed = ProjectSchema.parse(p);
    const text = serializeProject(parsed);
    expect(serializeProject(parseProjectText(text))).toBe(text);
    expect(parseProjectText(text).site.underlay?.dxf?.entities).toHaveLength(2);
  });

  it("retirer le DXF puis l'image supprime le calque", () => {
    let p = withImageUnderlay(withDxfUnderlay(base, dxf), image());
    p = withDxfUnderlay(p, undefined);
    expect(p.site.underlay).toEqual({ image: image() });
    p = withImageUnderlay(p, undefined);
    expect("underlay" in p.site).toBe(false);
  });

  it("bornes : trop d'entités ou de sommets, image non PNG/JPEG refusés", () => {
    const many = Array.from({ length: UNDERLAY_MAX_ENTITIES + 1 }, () => dxf.entities[0]!);
    expect(DxfUnderlaySchema.safeParse({ ...dxf, entities: many }).success).toBe(false);
    const heavy = {
      kind: "polyline" as const,
      points: Array.from({ length: UNDERLAY_MAX_VERTICES + 1 }, (_, i) => ({ x: i, y: 0 })),
    };
    expect(DxfUnderlaySchema.safeParse({ ...dxf, entities: [heavy] }).success).toBe(false);
    const gif = { ...image(), dataUrl: "data:image/gif;base64,R0lGOD" };
    expect(ProjectSchema.safeParse(withImageUnderlay(base, gif)).success).toBe(false);
  });

  it("saisie : trémie polygonale et murs", () => {
    const p = withOpeningPolygon(base, [
      { x: 0, y: 0 },
      { x: 0, y: 2000 },
      { x: 900, y: 2000 },
      { x: 900, y: 0 },
    ]);
    expect(p.site.opening?.kind).toBe("polygon");
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    const w = withWall(p, { x: -100, y: 0 }, { x: -100, y: 3000 }, 200);
    const w2 = withWall(w, { x: 1000, y: 0 }, { x: 1000, y: 3000 }, 150, true);
    expect(w2.site.walls.map((x) => x.id)).toEqual(["wall-1", "wall-2"]);
    expect(withoutWall(w2, "wall-1").site.walls.map((x) => x.id)).toEqual(["wall-2"]);
    expect(() => withWall(p, { x: 0, y: 0 }, { x: 0, y: 0 }, 200)).toThrow(RangeError);
    expect(() => withWall(p, { x: 0, y: 0 }, { x: 0, y: 10 }, 12.5)).toThrow(RangeError);
  });

  it("mur tracé sur son nu (plan DXF) : axe décalé d'une demi-épaisseur du côté du corps du mur", () => {
    // Relecture : un nu accroché au DXF donnait un axe sur ce nu, mur décalé de e / 2.
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 3000 };
    const left = withWall(base, a, b, 200, false, "left").site.walls.at(-1)!;
    expect(left.a).toEqual({ x: -100, y: 0 });
    expect(left.b).toEqual({ x: -100, y: 3000 });
    const right = withWall(base, a, b, 200, false, "right").site.walls.at(-1)!;
    expect(right.a).toEqual({ x: 100, y: 0 });
    const axis = withWall(base, a, b, 200).site.walls.at(-1)!;
    expect(axis.a).toEqual(a);
  });
});
