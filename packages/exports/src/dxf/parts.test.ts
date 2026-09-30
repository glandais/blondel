import { textMessage } from "@blondel/i18n";
import { pointInPolygon, vec2, type Part, type Vec2 } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { entitiesOn, polylines, readDxf } from "../testing/dxf-reader.js";
import { sampleParts, treadPart, woodStringerPart } from "../testing/fixtures.js";
import {
  PART_LAYERS,
  closedLoops,
  engravingPoint,
  exportPartDxf,
  machinedSegments,
  partLineLayer,
} from "./part.js";
import { exportPartsDxf, safeFileStem } from "./parts.js";

const TOL = 0.01;

describe("exportPartDxf : limon bois à la française (développé synthétique)", () => {
  for (const version of ["R12", "AC1021"] as const) {
    it(`${version} : mortaises sur MORTAISE, reports sur TRACAGE, repère sur TEXTE`, () => {
      const part = woodStringerPart();
      const f = readDxf(exportPartDxf(part, { version }));
      expect(f.layers.has(PART_LAYERS.mortise.name)).toBe(true);
      const flat = part.flat!;
      const mortises = flat.lines.filter((l) => l.feature === "mortise");
      const generic = flat.lines.filter((l) => l.kind === "mark" && l.feature === undefined);
      const onMortise = entitiesOn(f, "LINE", "MORTAISE");
      const onMark = entitiesOn(f, "LINE", "TRACAGE");
      expect(onMortise).toHaveLength(mortises.length);
      expect(onMark).toHaveLength(generic.length);
      // Chaque segment de mortaise relu à ±0,01 mm.
      mortises.forEach((l, i) => {
        expect(vec2.distance(onMortise[i]!.a, l.a)).toBeLessThanOrEqual(TOL);
        expect(vec2.distance(onMortise[i]!.b, l.b)).toBeLessThanOrEqual(TOL);
      });
      // Libellé et profondeur des mortaises, sur leur calque.
      const labels = entitiesOn(f, "TEXT", "MORTAISE").map((t) => t.value);
      expect(labels).toContain("mortaise 1 prof. 15");
      // Repère gravé sur TEXTE, dans le contour.
      const texts = entitiesOn(f, "TEXT", "TEXTE").map((t) => t.value);
      expect(texts).toContain(part.mark);
      expect(texts).toContain("Face jour");
      const [contour] = polylines(f, "CONTOUR");
      expect(contour!.closed).toBe(true);
      expect(contour!.vertices).toHaveLength(4);
    });
  }

  it("repère gravé à distance des mortaises ; fibre de référence dans INFO", () => {
    const part = woodStringerPart({ riserCount: 8 });
    const flat = part.flat!;
    const segs = machinedSegments(flat);
    expect(segs).toHaveLength(flat.lines.filter((l) => l.feature === "mortise").length);
    const spot = engravingPoint(flat.outline, segs);
    const naive = engravingPoint(flat.outline);
    const dist = (p: { x: number; y: number }) =>
      Math.min(
        ...segs.map(([a, b]) => {
          const t = Math.max(
            0,
            Math.min(
              1,
              ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) /
                ((b.x - a.x) ** 2 + (b.y - a.y) ** 2),
            ),
          );
          return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
        }),
      );
    expect(dist(spot.at)).toBeGreaterThanOrEqual(spot.clearance - 1e-6);
    expect(spot.clearance).toBeGreaterThan(10);
    expect(dist(spot.at)).toBeGreaterThan(dist(naive.at));
    const withRef: Part = {
      ...part,
      flat: { ...flat, reference: { kind: "face", description: textMessage("face côté marches") } },
    };
    const f = readDxf(exportPartDxf(withRef, { version: "AC1021" }));
    expect(entitiesOn(f, "TEXT", "INFO").map((t) => t.value)).toContain(
      "Référence : face tracée (face côté marches)",
    );
  });

  it("repère jamais gravé au fond d'une mortaise (intérieur des contours usinés exclu)", () => {
    // Pièce étroite, longue mortaise : l'intérieur de la mortaise (40 mm du bord) est plus
    // dégagé que toute la matière restante ; le repère doit pourtant rester hors mortaise.
    const outer = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 100 },
      { x: 0, y: 100 },
    ];
    const r = [
      { x: 50, y: 10 },
      { x: 950, y: 10 },
      { x: 950, y: 90 },
      { x: 50, y: 90 },
    ];
    // Segments donnés dans le désordre et dans les deux sens.
    const segs = [3, 0, 2, 1].map((i): [Vec2, Vec2] =>
      i % 2 === 0 ? [r[i]!, r[(i + 1) % 4]!] : [r[(i + 1) % 4]!, r[i]!],
    );
    expect(closedLoops(segs)).toHaveLength(1);
    const spot = engravingPoint({ outer, holes: [] }, segs);
    const inside = spot.at.x > 50 && spot.at.x < 950 && spot.at.y > 10 && spot.at.y < 90;
    expect(inside).toBe(false);
    expect(spot.clearance).toBeGreaterThan(20);
    // Un trait isolé (chaîne ouverte) ne crée pas de zone interdite.
    expect(closedLoops([[r[0]!, r[1]!]])).toEqual([]);
  });

  it("propriété : repère du limon généré hors de toute mortaise", () => {
    fc.assert(
      fc.property(
        fc.record({
          riserCount: fc.integer({ min: 3, max: 12 }),
          rise: fc.double({ min: 150, max: 190, noNaN: true }),
          going: fc.double({ min: 220, max: 300, noNaN: true }),
          treadThickness: fc.double({ min: 30, max: 120, noNaN: true }),
          below: fc.double({ min: 40, max: 250, noNaN: true }),
        }),
        (o) => {
          const flat = woodStringerPart(o).flat!;
          const spot = engravingPoint(flat.outline, machinedSegments(flat));
          for (const loop of closedLoops(machinedSegments(flat))) {
            expect(pointInPolygon(spot.at, loop)).toBe("outside");
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("calque par nature de ligne", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    expect(partLineLayer({ kind: "mark", a, b, feature: "mortise" })).toBe("MORTAISE");
    expect(partLineLayer({ kind: "mark", a, b, feature: "tenon" })).toBe("TENON");
    expect(partLineLayer({ kind: "mark", a, b })).toBe("TRACAGE");
    expect(partLineLayer({ kind: "bend", a, b })).toBe("PLI");
  });

  it("quantité écrite dans INFO", () => {
    // R12 : « é » écrit \U+00E9.
    const f = readDxf(exportPartDxf(treadPart(1), { quantity: 3 }));
    expect(entitiesOn(f, "TEXT", "INFO").map((t) => t.value)).toContain("Quantit\\U+00E9 3");
    const g = readDxf(exportPartDxf(treadPart(1), { quantity: 3, version: "AC1021" }));
    expect(entitiesOn(g, "TEXT", "INFO").map((t) => t.value)).toContain("Quantité 3");
  });

  it("propriété : toute mortaise d'un limon généré est relue sur MORTAISE à ±0,01 mm", () => {
    fc.assert(
      fc.property(
        fc.record({
          riserCount: fc.integer({ min: 3, max: 18 }),
          rise: fc.double({ min: 150, max: 190, noNaN: true }),
          going: fc.double({ min: 220, max: 300, noNaN: true }),
          mortiseDepth: fc.double({ min: 8, max: 25, noNaN: true }),
        }),
        (o) => {
          const part = woodStringerPart(o);
          const f = readDxf(exportPartDxf(part));
          const want = part.flat!.lines.filter((l) => l.feature === "mortise");
          const got = entitiesOn(f, "LINE", "MORTAISE");
          expect(got).toHaveLength(want.length);
          want.forEach((l, i) => {
            expect(vec2.distance(got[i]!.a, l.a)).toBeLessThanOrEqual(TOL);
            expect(vec2.distance(got[i]!.b, l.b)).toBeLessThanOrEqual(TOL);
          });
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("exportPartsDxf", () => {
  it("un fichier par repère et développé, quantité des pièces identiques", () => {
    const files = exportPartsDxf({ parts: sampleParts() });
    // sampleParts : LI1, M2, M1, M10, et une seconde M2 (tread-3) de même développé.
    expect(files.map((f) => f.filename)).toEqual(["LI1.dxf", "M2.dxf", "M1.dxf", "M10.dxf"]);
    const m2 = files.find((f) => f.mark === "M2")!;
    expect(m2.quantity).toBe(2);
    expect(m2.partIds).toEqual(["tread-2", "tread-3"]);
    expect(entitiesOn(readDxf(m2.content), "TEXT", "INFO").map((t) => t.value)).toContain(
      "Quantit\\U+00E9 2",
    );
  });

  it("ignore les pièces sans développé ; même repère, développés différents : deux fichiers", () => {
    const noFlat: Part = { ...treadPart(4), flat: undefined } as Part;
    const a = woodStringerPart({ mark: "L/1" });
    const b = woodStringerPart({ mark: "L/1", riserCount: 8 });
    const files = exportPartsDxf({ parts: [noFlat, a, b] });
    expect(files.map((f) => f.filename)).toEqual(["L_1.dxf", "L_1-2.dxf"]);
    expect(files.every((f) => f.quantity === 1)).toBe(true);
  });

  it("noms de fichiers sûrs et uniques sans tenir compte de la casse", () => {
    expect(safeFileStem("Marche n°5 / é")).toBe("Marche_n_5_e");
    expect(safeFileStem("..")).toBe("piece");
    // Noms de périphériques Windows (repères courts plausibles) : jamais tels quels.
    for (const m of ["CON", "nul", "Com1", "LPT9", "AUX", "PRN"]) {
      expect(safeFileStem(m)).toBe(`${m}_`);
    }
    expect(safeFileStem("CONSOLE")).toBe("CONSOLE");
    const parts = [treadPart(1, "m1"), { ...treadPart(1, "M1"), id: "x" }].map((p, i) => ({
      ...p,
      flat: { ...p.flat!, thickness: 40 + i },
    }));
    const names = exportPartsDxf({ parts }).map((f) => f.filename.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
