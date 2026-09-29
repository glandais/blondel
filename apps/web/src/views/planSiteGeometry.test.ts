import {
  createProject,
  ProjectSchema,
  buildModel,
  buildSnapIndex,
  snapPoint,
  underlaySegments,
  withDxfUnderlay,
  withOpeningPolygon,
  withWall,
  type DxfUnderlay,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  defaultDxfPlacement,
  defaultImagePlacement,
  dxfPathData,
  fitView,
  openingClick,
  projectSnapPoints,
  projectSnapSegments,
  screenToSite,
  segmentPath,
  siteBounds,
  viewBoxAttr,
  wallOutline,
  zoomAt,
} from "./planSiteGeometry.js";

const dxf: DxfUnderlay = {
  name: "plan.dxf",
  unitScale: 1,
  placement: { origin: { x: 0, y: 0 }, rotation: 0 },
  entities: [
    {
      kind: "polyline",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    },
    { kind: "circle", center: { x: 0, y: 0 }, radius: 50 },
  ],
};

describe("plan « Site et saisie » — géométrie d'affichage", () => {
  it("chemin du calque : polyligne continue en un sous-chemin, cercle en deux demi-arcs", () => {
    expect(dxfPathData(dxf)).toBe("M0 0L100 0L100 100M50 0A50 50 0 0 1 -50 0A50 50 0 0 1 50 0");
  });

  it("arc horaire : drapeau de balayage 0 ; grand arc : drapeau 1", () => {
    const d = segmentPath({
      kind: "arc",
      center: { x: 0, y: 0 },
      radius: 10,
      startAngle: 0,
      sweep: -1.5 * Math.PI,
    });
    expect(d).toMatch(/A10 10 0 1 0 /);
  });

  it("contour d'un mur : épaisseur de part et d'autre de l'axe", () => {
    const o = wallOutline({
      id: "w",
      a: { x: 0, y: 0 },
      b: { x: 1000, y: 0 },
      thickness: 200,
      loadBearing: false,
    });
    expect(o).toEqual([
      { x: 0, y: 100 },
      { x: 1000, y: 100 },
      { x: 1000, y: -100 },
      { x: 0, y: -100 },
    ]);
  });

  it("cadrage : la vue contient l'emprise ; écran ↔ site cohérents (y vers le haut)", () => {
    const v = fitView({ min: { x: 0, y: 0 }, max: { x: 4000, y: 1000 } }, 2);
    expect(v.width).toBeGreaterThanOrEqual(4000);
    expect(viewBoxAttr(v, 2).split(" ").map(Number)[3]).toBeCloseTo(v.width / 2, 6);
    const topLeft = screenToSite(v, 2, 0, 0);
    const bottomRight = screenToSite(v, 2, 1, 1);
    expect(topLeft.x).toBeLessThan(0);
    expect(topLeft.y).toBeGreaterThan(1000);
    expect(bottomRight.y).toBeLessThan(0);
  });

  it("propriété : le zoom garde fixe le point visé", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        (cx, cy, u, w, k) => {
          const v = { cx, cy, width: 10_000 };
          const p = screenToSite(v, 1.5, u, w);
          const z = zoomAt(v, p, k);
          const q = screenToSite(z, 1.5, u, w);
          expect(q.x).toBeCloseTo(p.x, 6);
          expect(q.y).toBeCloseTo(p.y, 6);
        },
      ),
    );
  });
});

describe("saisie assistée", () => {
  it("tracé de trémie : fermeture en recliquant le premier sommet (≥ 3 sommets)", () => {
    let d = openingClick([], { x: 0, y: 0 }, 10).draft;
    d = openingClick(d, { x: 1000, y: 0 }, 10).draft;
    // Retour sur le premier sommet avec deux sommets seulement : ni fermeture ni sommet répété.
    const early = openingClick(d, { x: 3, y: 2 }, 10);
    expect(early.closed).toBe(false);
    expect(early.draft).toEqual(d);
    d = openingClick(d, { x: 1000, y: 900 }, 10).draft;
    d = openingClick(d, { x: 1000, y: 900 }, 10).draft; // double clic : pas de doublon
    expect(d).toHaveLength(3);
    const r = openingClick(d, { x: 3, y: 2 }, 10);
    expect(r.closed).toBe(true);
    expect(r.draft).toHaveLength(3);
  });

  it("accroches : sommets de trémie, murs et calque DXF combinés", () => {
    let p = createProject("straight");
    p = withOpeningPolygon(p, [
      { x: 0, y: 1000 },
      { x: 900, y: 1000 },
      { x: 900, y: 3600 },
      { x: 0, y: 3600 },
    ]);
    p = withWall(p, { x: -100, y: 0 }, { x: -100, y: 4000 }, 200);
    p = withDxfUnderlay(p, dxf);
    const index = buildSnapIndex(
      [...underlaySegments(dxf), ...projectSnapSegments(p)],
      projectSnapPoints(p),
    );
    expect(snapPoint(index, { x: 905, y: 3595 }, 20)).toMatchObject({
      kind: "point",
      point: { x: 900, y: 3600 },
    });
    expect(snapPoint(index, { x: -3, y: 2003 }, 20)).toMatchObject({ kind: "midpoint" });
    expect(snapPoint(index, { x: 98, y: 3 }, 20)).toMatchObject({
      kind: "endpoint",
      point: { x: 100, y: 0 },
    });
  });

  it("emprise affichée : escalier, trémie, murs et calque ; projet valide après saisie", () => {
    const base = createProject("quarter-left");
    const p = withDxfUnderlay(withWall(base, { x: -5000, y: 0 }, { x: -5000, y: 100 }, 200), dxf);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    const b = siteBounds(p, buildModel(p))!;
    expect(b.min.x).toBeLessThanOrEqual(-5100);
    expect(siteBounds(p, null, false)!.min.x).toBeLessThanOrEqual(-5100);
  });
});

describe("réglages d'import", () => {
  const stair = { min: { x: 0, y: 0 }, max: { x: 1000, y: 3000 } };

  it("plan DXF proche : laissé en place ; plan en coordonnées lointaines : recentré", () => {
    expect(
      defaultDxfPlacement({ min: { x: -2000, y: -2000 }, max: { x: 9000, y: 9000 } }, stair).origin,
    ).toEqual({ x: 0, y: 0 });
    const far = { min: { x: 6.5e8, y: 6.8e9 }, max: { x: 6.5e8 + 20_000, y: 6.8e9 + 10_000 } };
    const pl = defaultDxfPlacement(far, stair);
    expect(far.min.x + 10_000 + pl.origin.x).toBeCloseTo(500, 3);
    expect(far.min.y + 5_000 + pl.origin.y).toBeCloseTo(1500, 3);
  });

  it("image non calibrée : centrée sur l'escalier, au moins 8 m de large", () => {
    const { mmPerPx, placement } = defaultImagePlacement(1000, 500, stair);
    expect(1000 * mmPerPx).toBe(9000);
    expect(placement.origin.x + 500 * mmPerPx).toBeCloseTo(500, 9);
    expect(placement.origin.y - 250 * mmPerPx).toBeCloseTo(1500, 9);
  });
});
