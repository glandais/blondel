import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import { signedArea } from "../geom2d/polygon.js";
import {
  isSelfIntersecting,
  normalizeOpeningPoints,
  OpeningInputError,
  polygonOpening,
  validateOpeningPolygon,
} from "./opening.js";

const square = [
  { x: 0, y: 0 },
  { x: 0, y: 1000 },
  { x: 1000, y: 1000 },
  { x: 1000, y: 0 },
];

describe("trémie polygonale saisie", () => {
  it("forme canonique : sens trigonométrique, arrondi au dixième, doublons retirés", () => {
    const pts = normalizeOpeningPoints([
      ...square.map((p) => ({ x: p.x + 0.04, y: p.y })),
      { x: 0.02, y: 0 },
    ]);
    expect(pts).toHaveLength(4);
    expect(signedArea(pts)).toBeGreaterThan(0);
    expect(pts.every((p) => Number.isInteger(p.x * 10))).toBe(true);
  });

  it("contour en nœud papillon refusé ; repli sur lui-même refusé ; L concave accepté", () => {
    expect(
      isSelfIntersecting([
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
        { x: 1000, y: 0 },
        { x: 0, y: 1000 },
      ]),
    ).toBe(true);
    expect(
      isSelfIntersecting([
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 500, y: 0 },
        { x: 500, y: 500 },
      ]),
    ).toBe(true);
    const L = [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 900 },
      { x: 900, y: 900 },
      { x: 900, y: 2000 },
      { x: 0, y: 2000 },
    ];
    expect(validateOpeningPolygon(L)).toEqual([]);
  });

  it("moins de 3 sommets ou aire nulle : défauts lisibles ; polygonOpening lève", () => {
    expect(fr(validateOpeningPolygon(square.slice(0, 2))[0])).toMatch(/au moins 3/);
    expect(() => polygonOpening(square.slice(0, 2))).toThrow(
      "trémie : au moins 3 sommets distincts (2 saisis)",
    );
    expect(
      validateOpeningPolygon([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]).map((m) => m.key),
    ).toEqual(["site.opening.zeroArea"]);
    expect(
      fr(
        validateOpeningPolygon([
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ])[0],
      ),
    ).toMatch(/aire nulle/);
    expect(() => polygonOpening(square.slice(0, 2))).toThrow(OpeningInputError);
    expect(polygonOpening(square)).toMatchObject({ kind: "polygon" });
  });

  it("côtés non adjacents alignés qui se recouvrent (fente de largeur nulle) : refusé", () => {
    // Relecture : `segmentIntersect` ignore les parallèles, ce contour passait la validation.
    const slit = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 1000 },
      { x: 3000, y: 0 },
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
    ];
    expect(isSelfIntersecting(slit)).toBe(true);
    expect(fr(validateOpeningPolygon(slit)[0])).toMatch(/se recoupe/);
    // Sommets alignés sur un même côté (non adjacents mais disjoints) : toujours acceptés.
    const collinear = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 2000, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 1000 },
      { x: 0, y: 1000 },
    ];
    expect(validateOpeningPolygon(collinear)).toEqual([]);
  });
});
