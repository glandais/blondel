import {
  curvePointAt,
  pointInPolygon,
  projectOnCurve,
  vec2,
  type Model,
  type Part,
  type Shape2,
  type Vec2,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layoutArb, quarterArb, straightArb } from "../testing/arbitraries.js";
import { entitiesOn, polylines, readDxf, type DxfFile } from "../testing/dxf-reader.js";
import {
  quarterTurnModel,
  sampleProject,
  sheetStringerPart,
  straightModel,
  treadPart,
} from "../testing/fixtures.js";
import { arcFromBulge } from "../path.js";
import { createDxfWriter } from "./create.js";
import { exportPartDxf } from "./part.js";
import { planLayers, exportPlanDxf } from "./plan.js";
import { encodeDxfText, sanitizeLayerName } from "./r12.js";
import type { DxfVersion } from "./writer.js";

const TOL = 0.01;
const VERSIONS: DxfVersion[] = ["R12", "AC1021"];
const close = (a: Vec2, b: Vec2): boolean => vec2.distance(a, b) <= TOL;

function checkClosedContours(f: DxfFile, layer: string): void {
  const pls = polylines(f, layer);
  expect(pls.length).toBeGreaterThan(0);
  for (const p of pls) {
    expect(p.closed).toBe(true);
    expect(p.vertices.length).toBeGreaterThanOrEqual(3);
  }
}

function checkPlan(m: Model, f: DxfFile): void {
  // Calques par fonction.
  for (const l of Object.values(planLayers())) expect(f.layers.has(l.name)).toBe(true);
  for (const e of f.entities) expect(e.layer === "0" || f.layers.has(e.layer)).toBe(true);
  checkClosedContours(f, "CONTOUR");
  checkClosedContours(f, "MARCHES");
  // Contour : sommets et milieux d'arcs (relus par renflement) sur le jour ou le mur à ±0,01 mm.
  const onEdge = (p: Vec2): number =>
    Math.min(
      vec2.distance(p, projectOnCurve(p, m.layout.inner).point),
      vec2.distance(p, projectOnCurve(p, m.layout.outer).point),
    );
  const [contour] = polylines(f, "CONTOUR");
  contour!.vertices.forEach((v, i) => {
    expect(onEdge(v)).toBeLessThanOrEqual(TOL);
    if (v.bulge === 0) return;
    const next = contour!.vertices[(i + 1) % contour!.vertices.length]!;
    const arc = arcFromBulge(v, next, v.bulge);
    const t = arc.startAngle + arc.sweep / 2;
    const mid = {
      x: arc.center.x + arc.radius * Math.cos(t),
      y: arc.center.y + arc.radius * Math.sin(t),
    };
    expect(onEdge(mid)).toBeLessThanOrEqual(TOL);
  });
  // Lignes de nez relues à ±0,01 mm.
  const nez = entitiesOn(f, "LINE", "NEZ");
  expect(nez).toHaveLength(m.stepping.nosings.length);
  m.stepping.nosings.forEach((n, i) => {
    expect(close(nez[i]!.a, n.q) && close(nez[i]!.b, n.r)).toBe(true);
  });
  // Surfaces de marche : mêmes sommets.
  const treads = polylines(f, "MARCHES");
  expect(treads).toHaveLength(m.stepping.treads.length);
  m.stepping.treads.forEach((t, i) => {
    const vs = treads[i]!.vertices;
    for (const p of t.walkingSurface) expect(vs.some((v) => close(v, p))).toBe(true);
  });
  // Cote d'emmarchement : une ligne de COTES de la longueur de la ligne de départ à ±0,01 mm.
  const E = vec2.distance(curvePointAt(m.layout.inner, 0), curvePointAt(m.layout.outer, 0));
  const cotes = entitiesOn(f, "LINE", "COTES");
  expect(cotes.some((l) => Math.abs(vec2.distance(l.a, l.b) - E) <= TOL)).toBe(true);
  // Numéros de marche.
  const numbers = entitiesOn(f, "TEXT", "TEXTE").filter((t) => /^\d+$/.test(t.value));
  expect(numbers.map((t) => Number(t.value))).toEqual(m.stepping.treads.map((t) => t.number));
}

describe("écrivains DXF", () => {
  it.each(VERSIONS)("%s : en-tête, unités mm, entités de base relues", (version) => {
    const w = createDxfWriter(version);
    w.addLayer({ name: "Pliage é", color: 1, lineType: "DASHED" });
    w.line({ x: 0.123456, y: 1 / 3 }, { x: 100, y: -50.5 }, "Pliage é");
    w.arc({ x: 10, y: 20 }, 5, 0, 90, "ARCS");
    w.circle({ x: -3, y: 4 }, 2.5, "ARCS");
    w.polyline(
      [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 1 },
        { x: 10, y: 10, bulge: 0 },
      ],
      true,
      "CONTOUR",
    );
    w.text({ x: 1, y: 2 }, 5, "Marche n° 3", "TEXTE", {
      align: "center",
      middle: true,
      rotationDeg: 30,
    });
    const text = w.toString();
    const f = readDxf(text);
    expect(f.header.get("$ACADVER")?.[0]?.[1]).toBe(version === "R12" ? "AC1009" : "AC1021");
    expect(f.header.get("$INSUNITS")?.[0]).toEqual([70, "4"]);
    expect(f.header.get("$MEASUREMENT")?.[0]).toEqual([70, "1"]);
    expect(f.layers.get("PLIAGE_E")).toEqual({ color: 1, lineType: "DASHED" });
    const [line] = entitiesOn(f, "LINE");
    expect(line!.layer).toBe("PLIAGE_E");
    expect(line!.a.y).toBeCloseTo(1 / 3, 5);
    expect(entitiesOn(f, "ARC")[0]).toMatchObject({ r: 5, start: 0, end: 90 });
    expect(entitiesOn(f, "CIRCLE")[0]).toMatchObject({ r: 2.5, c: { x: -3, y: 4 } });
    const [pl] = polylines(f, "CONTOUR");
    expect(pl!.closed).toBe(true);
    expect(pl!.vertices.map((v) => v.bulge)).toEqual([0, 1, 0]);
    const [t] = entitiesOn(f, "TEXT");
    expect(t!.at).toEqual({ x: 1, y: 2 });
    expect(t!.rotation).toBe(30);
    expect(t!.value).toBe(version === "R12" ? "Marche n\\U+00B0 3" : "Marche n° 3");
  });

  it("R12 : fichier ASCII pur, lignes CRLF, POLYLINE/VERTEX/SEQEND", () => {
    const w = createDxfWriter("R12");
    w.polyline(
      [
        { x: 0, y: 0, bulge: 0 },
        { x: 1, y: 0, bulge: 0 },
      ],
      false,
      "A",
    );
    w.text({ x: 0, y: 0 }, 1, "Élévation\nsuite", "A");
    const s = w.toString();
    expect(/^[\x20-\x7e\r\n]*$/.test(s)).toBe(true);
    expect(s.includes("\r\n")).toBe(true);
    expect(s).toContain("SEQEND");
    expect(s).not.toContain("LWPOLYLINE");
    expect(entitiesOn(readDxf(s), "TEXT")[0]!.value).toBe("\\U+00C9l\\U+00E9vation suite");
  });

  it("noms de calque et textes", () => {
    expect(sanitizeLayerName("Traçage fin")).toBe("TRACAGE_FIN");
    expect(sanitizeLayerName("")).toBe("0");
    expect(encodeDxfText("a°b")).toBe("a\\U+00B0b");
  });
});

describe("exportPlanDxf", () => {
  it.each(VERSIONS)("%s : droit avec trémie", (version) => {
    const m = straightModel();
    const f = readDxf(exportPlanDxf(m, { version, project: sampleProject() }));
    checkPlan(m, f);
    const tremie = polylines(f, "TREMIE");
    expect(tremie).toHaveLength(1);
    expect(tremie[0]!.closed).toBe(true);
    expect(tremie[0]!.vertices.some((v) => close(v, { x: 900, y: 3600 }))).toBe(true);
    expect(f.layers.get("TREMIE")?.lineType).toBe("DASHED");
    // Reculement coté.
    const run = m.stepping.run;
    expect(
      entitiesOn(f, "LINE", "COTES").some((l) => Math.abs(vec2.distance(l.a, l.b) - run) <= TOL),
    ).toBe(true);
    // Cartouche.
    const texts = entitiesOn(f, "TEXT", "TEXTE").map((t) => t.value);
    expect(texts.some((t) => t.startsWith("2h + g = 610,0"))).toBe(true);
  });

  it.each(VERSIONS)("%s : quart tournant, ligne de foulée à arc exact", (version) => {
    const m = quarterTurnModel();
    const f = readDxf(exportPlanDxf(m, { version }));
    checkPlan(m, f);
    const foulee = polylines(f, "FOULEE");
    const walk = foulee.find((p) => !p.closed)!;
    expect(walk.vertices.some((v) => Math.abs(v.bulge - Math.tan(Math.PI / 8)) < 1e-6)).toBe(true);
    expect(entitiesOn(f, "CIRCLE", "FOULEE")).toHaveLength(1);
  });

  it("propriété : plans relus à ±0,01 mm, contours fermés", () => {
    fc.assert(
      fc.property(
        fc.oneof(straightArb, quarterArb, layoutArb),
        fc.constantFrom(...VERSIONS),
        (m, version) => {
          checkPlan(m, readDxf(exportPlanDxf(m, { version })));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("exportPartDxf", () => {
  it.each(VERSIONS)("%s : développé de tôle pliée 1:1", (version) => {
    const part = sheetStringerPart();
    const f = readDxf(exportPartDxf(part, { version }));
    const [outer] = polylines(f, "CONTOUR");
    expect(outer!.closed).toBe(true);
    expect(outer!.vertices).toHaveLength(5);
    part.flat!.outline.outer.forEach((p, i) => expect(close(outer!.vertices[i]!, p)).toBe(true));
    const plis = entitiesOn(f, "LINE", "PLI");
    expect(plis).toHaveLength(2);
    expect(plis[1]!.a.y).toBeCloseTo(140.25, 6);
    expect(entitiesOn(f, "TEXT", "PLI").map((t) => t.value)).toEqual(
      version === "R12" ? ["90\\U+00B0 haut", "P2 90\\U+00B0 bas"] : ["90° haut", "P2 90° bas"],
    );
    expect(entitiesOn(f, "LINE", "TRACAGE")).toHaveLength(1);
    expect(entitiesOn(f, "LINE", "ROULAGE")).toHaveLength(1);
    expect(entitiesOn(f, "LINE", "JOINT")).toHaveLength(1);
    expect(entitiesOn(f, "TEXT", "TEXTE").map((t) => t.value)).toContain("LI1");
    // Informations hors pièce : libellé du matériau, pas son identifiant interne.
    const info = entitiesOn(f, "TEXT", "INFO").map((t) => t.value);
    expect(info.some((t) => t.includes("Acier peint"))).toBe(true);
    expect(info.some((t) => t.includes("steel-painted"))).toBe(false);
    expect(f.layers.get("PLI")?.lineType).toBe("DASHED");
  });

  it("contours intérieurs et textes du développé", () => {
    const f = readDxf(exportPartDxf(treadPart(5), { version: "R12" }));
    expect(polylines(f, "CONTOUR")).toHaveLength(2);
    const texts = entitiesOn(f, "TEXT", "TEXTE").map((t) => t.value);
    expect(texts).toEqual(["Dessus", "M5"]);
  });

  it.each(VERSIONS)("%s : repère gravé dans la matière (pièce en L, pièce ajourée)", (version) => {
    const L: Vec2[] = [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const square = (a: number, b: number): Vec2[] => [
      { x: a, y: a },
      { x: b, y: a },
      { x: b, y: b },
      { x: a, y: b },
    ];
    const shapes: Shape2[] = [
      { outer: L, holes: [] },
      { outer: square(0, 1000), holes: [square(100, 900).reverse()] },
    ];
    for (const outline of shapes) {
      const part: Part = { ...treadPart(1), flat: { outline, lines: [], thickness: 5 } };
      const f = readDxf(exportPartDxf(part, { version }));
      const mark = entitiesOn(f, "TEXT", "TEXTE").find((t) => t.value === "M1")!;
      // Centre de la boîte englobante (1 000 ; 1 000) / (500 ; 500) : hors matière.
      expect(pointInPolygon(mark.at, outline.outer)).toBe("inside");
      for (const h of outline.holes) expect(pointInPolygon(mark.at, h)).toBe("outside");
      // Le texte tient dans la matière (hauteur ≤ largeur locale).
      expect(mark.height).toBeLessThanOrEqual(100);
    }
  });

  it("pièce sans développé : erreur explicite", () => {
    const { flat: _flat, ...noFlat } = treadPart(1);
    expect(() => exportPartDxf(noFlat as Part)).toThrow(/développé/);
  });

  it("propriété : contour polygonal quelconque relu à ±0,01 mm", () => {
    const poly = fc
      .array(fc.double({ min: 0.1, max: 3000, noNaN: true }), { minLength: 3, maxLength: 24 })
      .map((radii) =>
        radii.map((r, i) => ({
          x: r * Math.cos((2 * Math.PI * i) / radii.length),
          y: r * Math.sin((2 * Math.PI * i) / radii.length),
        })),
      );
    fc.assert(
      fc.property(poly, fc.constantFrom(...VERSIONS), (outer, version) => {
        const base = treadPart(1);
        const part: Part = {
          ...base,
          flat: { outline: { outer, holes: [] }, lines: [], thickness: 3 },
        };
        const [pl] = polylines(readDxf(exportPartDxf(part, { version })), "CONTOUR");
        expect(pl!.closed).toBe(true);
        expect(pl!.vertices).toHaveLength(outer.length);
        outer.forEach((p, i) => expect(close(pl!.vertices[i]!, p)).toBe(true));
      }),
      { numRuns: 100 },
    );
  });
});

describe("versions par défaut (décision utilisateur du 2026-09-28)", () => {
  it("pièces en R12, plans en AC1021", () => {
    const part = readDxf(exportPartDxf(sheetStringerPart()));
    expect(part.header.get("$ACADVER")?.[0]?.[1]).toBe("AC1009");
    const plan = readDxf(exportPlanDxf(straightModel()));
    expect(plan.header.get("$ACADVER")?.[0]?.[1]).toBe("AC1021");
  });
});
